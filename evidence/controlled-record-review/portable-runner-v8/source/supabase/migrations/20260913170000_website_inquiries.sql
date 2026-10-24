-- Public submissions remain private, immutable originals. Staff triage is separate.
create function public.guard_contact_submission() returns trigger language plpgsql set search_path=public as $$
begin
 if TG_OP<>'INSERT' then raise exception 'Original website submissions are immutable' using errcode='23514';end if;
 if length(trim(NEW.name)) not between 1 and 100 or length(NEW.email) not between 3 and 255 or NEW.email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
 or coalesce(length(NEW.phone),0)>20 or length(trim(NEW.subject)) not between 1 and 200 or length(trim(NEW.message)) not between 1 and 2000 then raise exception 'Invalid website contact fields' using errcode='23514';end if;
 return NEW;
end $$;
create trigger guard_contact_submission before insert or update or delete on public.contact_submissions for each row execute function public.guard_contact_submission();
revoke insert,update,delete on public.contact_submissions from anon,authenticated,service_role;
grant insert(name,email,phone,subject,message) on public.contact_submissions to anon,authenticated;
create table public.website_inquiry_triage (
 inquiry_id uuid primary key references public.contact_submissions(id),status text not null default 'new' check(status in ('new','in_progress','resolved','spam')),
 assigned_to_id uuid references public.profiles(id),version integer not null default 1,
 client_id uuid references public.clients(id),reply_channel text check(reply_channel in ('EMAIL','SMS')),reply_recipient text,
 reviewed_by uuid references auth.users(id),reviewed_at timestamptz,updated_at timestamptz not null default now(),
 check((client_id is null and reply_channel is null and reply_recipient is null and reviewed_by is null and reviewed_at is null) or (client_id is not null and reply_channel is not null and reply_recipient is not null and reviewed_by is not null and reviewed_at is not null))
);
create table public.website_inquiry_history (
 id uuid primary key default gen_random_uuid(),inquiry_id uuid not null references public.website_inquiry_triage(inquiry_id),
 actor_id uuid not null references auth.users(id),action text not null,reason text not null,before_value jsonb,after_value jsonb,created_at timestamptz not null default now()
);
create index website_inquiries_status_idx on public.website_inquiry_triage(status,inquiry_id);
create index website_inquiry_history_idx on public.website_inquiry_history(inquiry_id,created_at,id);
insert into public.website_inquiry_triage(inquiry_id) select id from public.contact_submissions;
create function public.initialize_website_inquiry() returns trigger language plpgsql security definer set search_path=public as $$
begin insert into public.website_inquiry_triage(inquiry_id) values(NEW.id);return NEW;end $$;
create trigger initialize_website_inquiry after insert on public.contact_submissions for each row execute function public.initialize_website_inquiry();
create function public.guard_inquiry_history() returns trigger language plpgsql set search_path=public as $$
begin raise exception 'Inquiry history is immutable' using errcode='23514';end $$;
create trigger guard_inquiry_history before update or delete on public.website_inquiry_history for each row execute function public.guard_inquiry_history();
do $$ declare t text;begin
 foreach t in array array['website_inquiry_triage','website_inquiry_history'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('create policy "Active staff inquiry read" on public.%I for select to authenticated using(public.is_active_staff(auth.uid()))',t);
 end loop;
end $$;

create function public.list_website_inquiries(p_status text default 'open',p_search text default '',p_assigned_to_id uuid default null,p_before_at timestamptz default null,p_before_id uuid default null,p_limit integer default 25)
returns table(inquiry_id uuid,submitted_at timestamptz,claimed_name text,subject text,status text,assigned_to_id uuid,version integer,client_id uuid)
language plpgsql stable security definer set search_path=public as $$
begin
 perform public.clinical_require_staff();
 if p_status is null or p_status not in ('open','all','new','in_progress','resolved','spam') or length(coalesce(p_search,''))>200 or p_limit is null or p_limit not between 1 and 100 or (p_before_at is null)<>(p_before_id is null) then raise exception 'Invalid inquiry filters or cursor' using errcode='23514';end if;
 return query select s.id,s.created_at,s.name,s.subject,t.status,t.assigned_to_id,t.version,t.client_id
 from public.contact_submissions s join public.website_inquiry_triage t on t.inquiry_id=s.id
 where (p_status='all' or (p_status='open' and t.status in ('new','in_progress')) or t.status=p_status)
 and (p_assigned_to_id is null or t.assigned_to_id=p_assigned_to_id)
 and (p_before_at is null or (s.created_at,s.id)<(p_before_at,p_before_id))
 and (coalesce(trim(p_search),'')='' or s.name ilike '%'||trim(p_search)||'%' or s.email ilike '%'||trim(p_search)||'%' or s.subject ilike '%'||trim(p_search)||'%')
 order by s.created_at desc,s.id desc limit p_limit;
end $$;
create function public.website_inquiry_open_count() returns bigint language plpgsql stable security definer set search_path=public as $$
begin perform public.clinical_require_staff();return (select count(*) from public.website_inquiry_triage where status in ('new','in_progress'));end $$;
create function public.read_website_inquiry(p_id uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb;begin
 perform public.clinical_require_staff();
 select jsonb_build_object('submission',to_jsonb(s),'triage',to_jsonb(t),'household_name',c.full_name)
 into result from public.contact_submissions s join public.website_inquiry_triage t on t.inquiry_id=s.id left join public.clients c on c.id=t.client_id where s.id=p_id;
 if result is null then raise exception 'Inquiry not found' using errcode='42501';end if;
 return result;
end $$;
create function public.update_website_inquiry(p_actor_id uuid,p_id uuid,p_expected_version integer,p_status text,p_assigned_to_id uuid,p_reason text) returns public.website_inquiry_triage language plpgsql security definer set search_path=public as $$
declare actor uuid;original public.website_inquiry_triage;result public.website_inquiry_triage;
begin
 actor:=public.clinical_require_staff();if actor is distinct from p_actor_id then raise exception 'Actor mismatch' using errcode='42501';end if;
 select * into original from public.website_inquiry_triage where inquiry_id=p_id for update;
 if not found or original.version is distinct from p_expected_version then raise exception 'Inquiry changed; reload before saving' using errcode='40001';end if;
 if p_status is null or p_status not in ('new','in_progress','resolved','spam') or p_reason is null or length(trim(p_reason)) not between 5 and 1000 or (p_assigned_to_id is not null and not public.is_active_staff(p_assigned_to_id)) then raise exception 'Valid status, active assignee and review reason required' using errcode='23514';end if;
 update public.website_inquiry_triage set status=p_status,assigned_to_id=p_assigned_to_id,version=version+1,updated_at=now() where inquiry_id=p_id returning * into result;
 insert into public.website_inquiry_history(inquiry_id,actor_id,action,reason,before_value,after_value) values(p_id,actor,'triage',trim(p_reason),to_jsonb(original),to_jsonb(result));
 return result;
end $$;
create function public.review_website_inquiry_household(p_actor_id uuid,p_id uuid,p_expected_version integer,p_client_id uuid,p_channel text,p_recipient text,p_confirmed boolean,p_evidence text) returns public.website_inquiry_triage language plpgsql security definer set search_path=public as $$
declare actor uuid;original public.website_inquiry_triage;result public.website_inquiry_triage;recipient text;household public.clients;
begin
 actor:=public.clinical_require_staff();if actor is distinct from p_actor_id then raise exception 'Actor mismatch' using errcode='42501';end if;
 select * into original from public.website_inquiry_triage where inquiry_id=p_id for update;
 if not found or original.version is distinct from p_expected_version then raise exception 'Inquiry changed; reload before linking' using errcode='40001';end if;
 recipient:=public.communication_recipient(p_channel,p_recipient);
 select * into household from public.clients where id=p_client_id;
 if not found or p_confirmed is distinct from true or p_evidence is null or length(trim(p_evidence)) not between 5 and 1000 or recipient is null or recipient is distinct from public.communication_recipient(p_channel,case when p_channel='EMAIL' then household.primary_email else household.primary_phone end) then raise exception 'Independently confirm the household and its current reply destination' using errcode='23514';end if;
 update public.website_inquiry_triage set status='in_progress',client_id=p_client_id,reply_channel=p_channel,reply_recipient=recipient,reviewed_by=actor,reviewed_at=now(),version=version+1,updated_at=now() where inquiry_id=p_id returning * into result;
 insert into public.website_inquiry_history(inquiry_id,actor_id,action,reason,before_value,after_value) values(p_id,actor,'household_review',trim(p_evidence),to_jsonb(original),to_jsonb(result)||jsonb_build_object('household_name',household.full_name));
 return result;
end $$;
create function public.authorize_website_inquiry_reply(p_actor_id uuid,p_id uuid,p_expected_version integer) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid;review public.website_inquiry_triage;household public.clients;conversation public.conversations;
begin
 actor:=public.clinical_require_staff();if actor is distinct from p_actor_id then raise exception 'Actor mismatch' using errcode='42501';end if;
 select * into review from public.website_inquiry_triage where inquiry_id=p_id for update;
 if not found or review.version is distinct from p_expected_version then raise exception 'Inquiry changed; reload before replying' using errcode='40001';end if;
 select * into household from public.clients where id=review.client_id;
 if review.status<>'in_progress' or review.reviewed_by is null or household.id is null or review.reply_recipient is distinct from public.communication_recipient(review.reply_channel,case when review.reply_channel='EMAIL' then household.primary_email else household.primary_phone end) or public.communication_is_suppressed(review.reply_channel,review.reply_recipient,household.id) then raise exception 'Review the current household destination and channel permission before replying' using errcode='42501';end if;
 conversation:=public.ensure_active_conversation(household.id);
 insert into public.website_inquiry_history(inquiry_id,actor_id,action,reason,after_value) values(p_id,actor,'reply_handoff','Authorized composer handoff; this does not send a message',jsonb_build_object('conversation_id',conversation.id,'client_id',household.id,'channel',review.reply_channel,'recipient',review.reply_recipient,'review_version',review.version));
 return jsonb_build_object('conversation_id',conversation.id,'client_id',household.id,'channel',review.reply_channel,'recipient',review.reply_recipient);
end $$;

do $$ declare f record;begin
 for f in select p.oid::regprocedure signature,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('guard_contact_submission','initialize_website_inquiry','guard_inquiry_history','list_website_inquiries','website_inquiry_open_count','read_website_inquiry','update_website_inquiry','review_website_inquiry_household','authorize_website_inquiry_reply') loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  if f.proname not in ('guard_contact_submission','initialize_website_inquiry','guard_inquiry_history') then execute format('grant execute on function %s to authenticated',f.signature);end if;
 end loop;
end $$;
