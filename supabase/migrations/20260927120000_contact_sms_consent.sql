-- A2P 10DLC website opt-in. Consent is optional, unchecked by default and
-- recorded with the original submission. The disclosure text and consent time
-- are server-owned; a client can only say yes or no.
create function public.contact_sms_consent_disclosure() returns text language sql immutable set search_path=public as $$
 select 'I agree to receive text messages from The Living Room Vet at the phone number provided, including appointment reminders, visit follow-ups, prescription notices, and replies to my questions. Message frequency varies. Message and data rates may apply. Reply STOP to opt out or HELP for help. Consent is not a condition of service. See our Privacy Policy and Terms.'::text
$$;
revoke all on function public.contact_sms_consent_disclosure() from public,anon,authenticated,service_role;

-- Existing rows take the default (no consent, no text, no time) and stay valid.
alter table public.contact_submissions
 add column sms_consent boolean not null default false,
 add column sms_consent_text text,
 add column sms_consent_at timestamptz,
 add constraint contact_submissions_sms_consent_check check(
  (sms_consent and phone is not null and btrim(phone)<>'' and sms_consent_text is not null and length(sms_consent_text) between 1 and 2000 and sms_consent_at is not null)
  or (not sms_consent and sms_consent_text is null and sms_consent_at is null)
 );

-- Consent evidence is part of the immutable original. Otherwise unchanged from
-- 20260926031324_restore_verified_contact_intake_boundary.sql.
create or replace function public.guard_contact_submission()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Original website submissions are immutable' using errcode = '23514';
  end if;

  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id
      or new.name is distinct from old.name
      or new.email is distinct from old.email
      or new.phone is distinct from old.phone
      or new.subject is distinct from old.subject
      or new.message is distinct from old.message
      or new.sms_consent is distinct from old.sms_consent
      or new.sms_consent_text is distinct from old.sms_consent_text
      or new.sms_consent_at is distinct from old.sms_consent_at
      or new.created_at is distinct from old.created_at
    then
      raise exception 'Original website submissions are immutable' using errcode = '23514';
    end if;

    if (new.reviewed_by is not null and new.reviewed_by is distinct from old.reviewed_by and new.reviewed_by is distinct from auth.uid())
      or (new.contacted_by is not null and new.contacted_by is distinct from old.contacted_by and new.contacted_by is distinct from auth.uid())
      or (new.closed_by is not null and new.closed_by is distinct from old.closed_by and new.closed_by is distinct from auth.uid())
    then
      raise exception 'Contact submission triage actor must match authenticated user' using errcode = '23514';
    end if;

    return new;
  end if;

  if length(trim(new.name)) not between 1 and 100
    or length(new.email) not between 3 and 255
    or new.email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    or coalesce(length(new.phone), 0) > 20
    or length(trim(new.subject)) not between 1 and 200
    or length(trim(new.message)) not between 1 and 2000
  then
    raise exception 'Invalid website contact fields' using errcode = '23514';
  end if;

  return new;
end
$$;
revoke all on function public.guard_contact_submission() from public,anon,authenticated,service_role;

-- sms_consent joins the exact-replay payload. A payload without it (an edge
-- function deployed before this migration, or a receipt stored before it) is
-- normalized to sms_consent=false on both sides of the replay comparison.
create or replace function public.accept_contact_intake(p_request_id uuid,p_capability_hash text,p_email_budget_hash text,p_payload jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare prior public.contact_intake_requests;submission uuid;attempt_count integer;body jsonb;consent boolean;
begin
 if p_request_id is null or p_capability_hash is null or p_capability_hash !~ '^[a-f0-9]{64}$' or p_email_budget_hash is null or p_email_budget_hash !~ '^[a-f0-9]{64}$' or p_payload is null or jsonb_typeof(p_payload)<>'object' or p_payload-array['name','email','phone','subject','message','sms_consent']<>'{}'::jsonb or not(p_payload ?& array['name','email','phone','subject','message']) then raise exception 'Invalid intake payload' using errcode='23514';end if;
 body:=p_payload||jsonb_build_object('sms_consent',coalesce(p_payload->'sms_consent','false'::jsonb));
 if jsonb_typeof(body->'name')<>'string' or jsonb_typeof(body->'email')<>'string' or jsonb_typeof(body->'subject')<>'string' or jsonb_typeof(body->'message')<>'string' or jsonb_typeof(body->'phone') not in ('string','null') or jsonb_typeof(body->'sms_consent')<>'boolean' then raise exception 'Invalid intake field types' using errcode='23514';end if;
 consent:=(body->>'sms_consent')::boolean;
 if consent and coalesce(btrim(body->>'phone'),'')='' then raise exception 'Text message consent requires a phone number' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended('contact-intake:'||p_request_id::text,0));
 select * into prior from contact_intake_requests where request_id=p_request_id;
 if found then
  if prior.capability_hash<>p_capability_hash or (prior.payload||jsonb_build_object('sms_consent',coalesce(prior.payload->'sms_consent','false'::jsonb)))<>body then raise exception 'Request ID already used with different content or proof' using errcode='23505';end if;
  return jsonb_build_object('received',true);
 end if;
 -- Claimed email is an abuse bucket, never sender authentication or consent.
 insert into contact_intake_budgets values('email:'||p_email_budget_hash,date_trunc('hour',now()),1) on conflict(bucket,window_start) do update set attempts=least(contact_intake_budgets.attempts+1,1000000) returning attempts into attempt_count;
 if attempt_count>5 then return jsonb_build_object('received',false,'limited',true);end if;
 insert into contact_submissions(name,email,phone,subject,message,sms_consent,sms_consent_text,sms_consent_at) values(body->>'name',body->>'email',body->>'phone',body->>'subject',body->>'message',consent,case when consent then contact_sms_consent_disclosure() end,case when consent then now() end) returning id into submission;
 insert into contact_intake_requests(request_id,capability_hash,payload,submission_id) values(p_request_id,p_capability_hash,body,submission);
 return jsonb_build_object('received',true);
end $$;
do $$ declare f record;begin
 for f in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and proname='accept_contact_intake' loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
 execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
