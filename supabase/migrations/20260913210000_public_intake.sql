-- Public intake is now only through a server-verified challenge endpoint.
revoke insert on public.contact_submissions from public,anon,authenticated,service_role;
revoke insert(name,email,phone,subject,message) on public.contact_submissions from public,anon,authenticated,service_role;
create table public.contact_intake_requests (
 request_id uuid primary key,capability_hash text not null check(capability_hash ~ '^[a-f0-9]{64}$'),
 payload jsonb not null,submission_id uuid not null unique references public.contact_submissions(id),created_at timestamptz not null default now()
);
create table public.contact_intake_budgets (
 bucket text not null,window_start timestamptz not null,attempts integer not null check(attempts>0),primary key(bucket,window_start)
);
alter table public.contact_intake_requests enable row level security;
alter table public.contact_intake_budgets enable row level security;
revoke all on public.contact_intake_requests,public.contact_intake_budgets from public,anon,authenticated,service_role;
create function public.consume_contact_intake_budget() returns boolean language plpgsql security definer set search_path=public as $$
declare minute_count integer;hour_count integer;
begin
 -- Global limits intentionally make no claim of verified per-person identity.
 insert into contact_intake_budgets values('global-minute',date_trunc('minute',now()),1) on conflict(bucket,window_start) do update set attempts=least(contact_intake_budgets.attempts+1,1000000) returning attempts into minute_count;
 insert into contact_intake_budgets values('global-hour',date_trunc('hour',now()),1) on conflict(bucket,window_start) do update set attempts=least(contact_intake_budgets.attempts+1,1000000) returning attempts into hour_count;
 delete from contact_intake_budgets where window_start<now()-interval '2 days';
 return minute_count<=120 and hour_count<=1000;
end $$;
create function public.contact_intake_receipt(p_request_id uuid,p_capability_hash text) returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
 if p_request_id is null or p_capability_hash is null or p_capability_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid request proof' using errcode='23514';end if;
 return jsonb_build_object('received',exists(select 1 from contact_intake_requests where request_id=p_request_id and capability_hash=p_capability_hash));
end $$;
create or replace function public.accept_contact_intake(p_request_id uuid,p_capability_hash text,p_email_budget_hash text,p_payload jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare prior public.contact_intake_requests;submission uuid;attempt_count integer;
begin
 if p_request_id is null or p_capability_hash is null or p_capability_hash !~ '^[a-f0-9]{64}$' or p_email_budget_hash is null or p_email_budget_hash !~ '^[a-f0-9]{64}$' or p_payload is null or jsonb_typeof(p_payload)<>'object' or p_payload-array['name','email','phone','subject','message']<>'{}'::jsonb or not(p_payload ?& array['name','email','phone','subject','message']) then raise exception 'Invalid intake payload' using errcode='23514';end if;
 if jsonb_typeof(p_payload->'name')<>'string' or jsonb_typeof(p_payload->'email')<>'string' or jsonb_typeof(p_payload->'subject')<>'string' or jsonb_typeof(p_payload->'message')<>'string' or jsonb_typeof(p_payload->'phone') not in ('string','null') then raise exception 'Invalid intake field types' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended('contact-intake:'||p_request_id::text,0));
 select * into prior from contact_intake_requests where request_id=p_request_id;
 if found then
  if prior.capability_hash<>p_capability_hash or prior.payload<>p_payload then raise exception 'Request ID already used with different content or proof' using errcode='23505';end if;
  return jsonb_build_object('received',true);
 end if;
 -- Claimed email is an abuse bucket, never sender authentication or consent.
 insert into contact_intake_budgets values('email:'||p_email_budget_hash,date_trunc('hour',now()),1) on conflict(bucket,window_start) do update set attempts=least(contact_intake_budgets.attempts+1,1000000) returning attempts into attempt_count;
 if attempt_count>5 then return jsonb_build_object('received',false,'limited',true);end if;
 insert into contact_submissions(name,email,phone,subject,message) values(p_payload->>'name',p_payload->>'email',p_payload->>'phone',p_payload->>'subject',p_payload->>'message') returning id into submission;
 insert into contact_intake_requests(request_id,capability_hash,payload,submission_id) values(p_request_id,p_capability_hash,p_payload,submission);
 return jsonb_build_object('received',true);
end $$;
create trigger immutable_contact_intake_request before update or delete on public.contact_intake_requests for each row execute function public.guard_inquiry_history();
do $$ declare f record;begin
 for f in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and proname in ('consume_contact_intake_budget','contact_intake_receipt','accept_contact_intake') loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
 execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
