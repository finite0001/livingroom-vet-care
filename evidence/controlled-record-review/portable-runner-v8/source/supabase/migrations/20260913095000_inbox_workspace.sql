-- Staff inbox mutations and actor-owned read state. No provider transport here.
alter table public.conversations add column revision integer not null default 1;
create table public.conversation_activity_audit (
 id uuid primary key default gen_random_uuid(), conversation_id uuid not null references public.conversations(id),
 actor_id uuid references auth.users(id), action text not null, before_value jsonb, after_value jsonb,
 created_at timestamptz not null default now()
);
create table public.conversation_unread_flags (
 user_id uuid not null references auth.users(id), conversation_id uuid not null references public.conversations(id),
 revision bigint not null default 1, forced boolean not null default false, primary key(user_id,conversation_id)
);
create table public.inbox_read_snapshots (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
 boundaries jsonb not null, created_at timestamptz not null default now(), applied_at timestamptz
);
do $$ declare t text; begin
 foreach t in array array['conversation_activity_audit','conversation_unread_flags','inbox_read_snapshots'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon,authenticated,service_role',t);
  execute format('grant select on public.%I to authenticated',t);
  if t='conversation_activity_audit' then
   execute format('create policy "Staff audit read" on public.%I for select to authenticated using(public.is_active_staff(auth.uid()))',t);
  else
   execute format('create policy "Own inbox state" on public.%I for select to authenticated using(user_id=auth.uid() and public.is_active_staff(auth.uid()))',t);
  end if;
 end loop;
end $$;

create function public.guard_conversation_history() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if TG_OP='DELETE' then raise exception 'Conversation history must be archived, not deleted' using errcode='23514';end if;
 if TG_OP='UPDATE' and NEW.client_id is distinct from OLD.client_id then raise exception 'Conversation household is immutable' using errcode='23514';end if;
 if TG_OP='INSERT' or NEW.status is distinct from OLD.status then
  perform pg_advisory_xact_lock(hashtextextended('conversation:'||NEW.client_id::text,950));
  if NEW.status='ACTIVE' and exists(select 1 from public.conversations where client_id=NEW.client_id and status='ACTIVE' and id<>NEW.id) then
   raise exception 'Household already has an active conversation' using errcode='23514';
  end if;
 end if;
 return NEW;
end $$;
create trigger guard_conversation_history before insert or update or delete on public.conversations for each row execute function public.guard_conversation_history();
revoke insert,update,delete on public.conversations from authenticated,service_role;
revoke all on function public.delete_conversation_cascade(uuid) from public,anon,authenticated,service_role;

create function public.ensure_active_conversation(p_client_id uuid) returns public.conversations language plpgsql security definer set search_path=public as $$
declare actor uuid; result public.conversations; matches integer;
begin
 actor:=public.clinical_require_staff();
 perform pg_advisory_xact_lock(hashtextextended('conversation:'||p_client_id::text,950));
 if not exists(select 1 from public.clients where id=p_client_id) then raise exception 'Household not found' using errcode='23503';end if;
 select count(*) into matches from public.conversations where client_id=p_client_id and status='ACTIVE';
 if matches>1 then raise exception 'Select an existing conversation; household has multiple active threads' using errcode='23514';end if;
 select * into result from public.conversations where client_id=p_client_id and status='ACTIVE';
 if matches=0 then
  insert into public.conversations(client_id) values(p_client_id) returning * into result;
  insert into public.conversation_activity_audit(conversation_id,actor_id,action,after_value) values(result.id,actor,'created',to_jsonb(result));
 end if;
 return result;
end $$;

create function public.update_conversation_metadata(p_actor_id uuid,p_conversation_id uuid,p_expected_revision integer,p_status public.conversation_status,p_assigned_to_id uuid,p_priority public.conversation_priority,p_tags text[]) returns public.conversations language plpgsql security definer set search_path=public as $$
declare actor uuid; original public.conversations; result public.conversations;
begin
 actor:=public.clinical_require_staff();
 if actor is distinct from p_actor_id then raise exception 'Actor mismatch' using errcode='42501';end if;
 select * into original from public.conversations where id=p_conversation_id;
 perform pg_advisory_xact_lock(hashtextextended('conversation:'||original.client_id::text,950));
 select * into original from public.conversations where id=p_conversation_id for update;
 if not found then raise exception 'Conversation not found' using errcode='23503';end if;
 if original.revision is distinct from p_expected_revision then raise exception 'Conversation changed; reload' using errcode='40001';end if;
 if p_status is null or p_priority is null or p_tags is null or cardinality(p_tags)>20 or exists(select 1 from unnest(p_tags)t where t is null or length(trim(t)) not between 1 and 40) then raise exception 'Invalid conversation metadata' using errcode='23514';end if;
 if p_assigned_to_id is not null and not public.is_active_staff(p_assigned_to_id) then raise exception 'Assignee must be active staff' using errcode='23514';end if;
 update public.conversations set status=p_status,assigned_to_id=p_assigned_to_id,priority=p_priority,
 tags=array(select distinct trim(t) from unnest(p_tags)t order by 1),revision=revision+1,
 archived_at=case when p_status='ARCHIVED' then coalesce(archived_at,now()) else null end
 where id=p_conversation_id returning * into result;
 insert into public.conversation_activity_audit(conversation_id,actor_id,action,before_value,after_value) values(result.id,actor,'metadata',to_jsonb(original),to_jsonb(result));
 return result;
end $$;

create or replace function public.mark_conversation_read(p_actor_id uuid,p_conversation_id uuid,p_message_id uuid) returns void language plpgsql security definer set search_path=public as $$
declare actor uuid; message public.messages;
begin
 actor:=public.clinical_require_staff();if actor is distinct from p_actor_id then raise exception 'Actor mismatch' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(actor::text||':'||p_conversation_id::text,951));
 select * into message from public.messages where id=p_message_id and conversation_id=p_conversation_id;
 if not found then raise exception 'Message does not belong to conversation' using errcode='23514';end if;
 insert into public.conversation_read_cursors(user_id,conversation_id,read_at,message_id) values(actor,p_conversation_id,message.created_at,message.id)
 on conflict(user_id,conversation_id) do update set read_at=excluded.read_at,message_id=excluded.message_id where (conversation_read_cursors.read_at,conversation_read_cursors.message_id)<(excluded.read_at,excluded.message_id);
 insert into public.conversation_unread_flags(user_id,conversation_id,forced) values(actor,p_conversation_id,false)
 on conflict(user_id,conversation_id) do update set forced=false,revision=conversation_unread_flags.revision+1;
end $$;
create function public.mark_conversation_unread(p_actor_id uuid,p_conversation_id uuid) returns void language plpgsql security definer set search_path=public as $$
declare actor uuid;begin
 actor:=public.clinical_require_staff();if actor is distinct from p_actor_id then raise exception 'Actor mismatch' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(actor::text||':'||p_conversation_id::text,951));
 insert into public.conversation_unread_flags(user_id,conversation_id,forced) values(actor,p_conversation_id,true)
 on conflict(user_id,conversation_id) do update set forced=true,revision=conversation_unread_flags.revision+1;
end $$;
create function public.capture_inbox_read_snapshot() returns uuid language plpgsql security definer set search_path=public as $$
declare actor uuid;result uuid;begin
 actor:=public.clinical_require_staff();
 insert into public.inbox_read_snapshots(user_id,boundaries)
 select actor,coalesce(jsonb_agg(jsonb_build_object('conversation',c.id,'message',m.id,'revision',coalesce(f.revision,0))),'[]')
 from public.conversations c
 left join lateral(select id from public.messages where conversation_id=c.id order by created_at desc,id desc limit 1)m on true
 left join public.conversation_unread_flags f on f.user_id=actor and f.conversation_id=c.id
 where c.status='ACTIVE' returning id into result;
 return result;
end $$;
create function public.apply_inbox_read_snapshot(p_actor_id uuid,p_snapshot_id uuid) returns void language plpgsql security definer set search_path=public as $$
declare actor uuid;snapshot public.inbox_read_snapshots;b jsonb;current_revision bigint;begin
 actor:=public.clinical_require_staff();if actor is distinct from p_actor_id then raise exception 'Actor mismatch' using errcode='42501';end if;
 select * into snapshot from public.inbox_read_snapshots where id=p_snapshot_id and user_id=actor for update;
 if not found or snapshot.created_at<now()-interval '15 minutes' then raise exception 'Read snapshot missing or expired' using errcode='23514';end if;
 if snapshot.applied_at is not null then return;end if;
 for b in select value from jsonb_array_elements(snapshot.boundaries) order by value->>'conversation' loop
  perform pg_advisory_xact_lock(hashtextextended(actor::text||':'||(b->>'conversation'),951));
  select revision into current_revision from public.conversation_unread_flags where user_id=actor and conversation_id=(b->>'conversation')::uuid;
  if coalesce(current_revision,0)=(b->>'revision')::bigint then
   if b->>'message' is not null then
    perform public.mark_conversation_read(actor,(b->>'conversation')::uuid,(b->>'message')::uuid);
   else
    update public.conversation_unread_flags set forced=false,revision=revision+1 where user_id=actor and conversation_id=(b->>'conversation')::uuid;
   end if;
  end if;
 end loop;
 update public.inbox_read_snapshots set applied_at=now() where id=snapshot.id;
end $$;

create view public.inbox_workspace_rows as
select c.id conversation_id,c.client_id,cl.full_name client_name,cl.primary_phone,cl.primary_email,
 c.last_message_at updated_at,c.status,c.assigned_to_id,c.priority,c.tags,c.revision,
 m.id latest_message_id,m.content latest_content,m.type latest_type,
 n.unread_count,(n.unread_count>0 or coalesce(f.forced,false)) is_unread
from public.conversations c join public.clients cl on cl.id=c.client_id
left join lateral(select mm.id,mm.content,mm.type from public.messages mm where mm.conversation_id=c.id order by mm.created_at desc,mm.id desc limit 1)m on true
left join public.conversation_read_cursors r on r.user_id=auth.uid() and r.conversation_id=c.id
left join public.conversation_unread_flags f on f.user_id=auth.uid() and f.conversation_id=c.id
cross join lateral(select count(*) unread_count from public.messages un where un.conversation_id=c.id and un.sender_type='CLIENT' and (r.message_id is null or (un.created_at,un.id)>(r.read_at,r.message_id)))n;
revoke all on public.inbox_workspace_rows from public,anon,authenticated,service_role;

create function public.list_inbox_workspace(
 p_search text default '',p_status public.conversation_status default 'ACTIVE',
 p_assignment text default 'all',p_assigned_to_id uuid default null,
 p_priority public.conversation_priority default null,p_tags text[] default '{}',
 p_channel public.message_type default null,p_read text default 'all',
 p_before_at timestamptz default null,p_before_id uuid default null,p_limit integer default 50
) returns setof public.inbox_workspace_rows language plpgsql security definer set search_path=public as $$
begin
 perform public.clinical_require_staff();
 if p_limit is null or p_limit not between 1 and 100 or length(coalesce(p_search,''))>200
 or (p_before_at is null)<>(p_before_id is null) or p_assignment is null or p_assignment not in ('all','unassigned','staff')
 or (p_assignment='staff' and p_assigned_to_id is null) or p_read is null or p_read not in ('all','read','unread')
 or p_tags is null or cardinality(p_tags)>20 then raise exception 'Invalid inbox filters or cursor' using errcode='23514';end if;
 return query select w.* from public.inbox_workspace_rows w
 where (p_status is null or w.status=p_status)
 and (p_assignment='all' or (p_assignment='unassigned' and w.assigned_to_id is null) or (p_assignment='staff' and w.assigned_to_id=p_assigned_to_id))
 and (p_priority is null or w.priority=p_priority) and w.tags @> p_tags
 and (p_channel is null or exists(select 1 from public.messages cm where cm.conversation_id=w.conversation_id and cm.type=p_channel))
 and (p_read='all' or (p_read='unread' and w.is_unread) or (p_read='read' and not w.is_unread))
 and (p_before_at is null or (w.updated_at,w.conversation_id)<(p_before_at,p_before_id))
 and (coalesce(trim(p_search),'')='' or w.client_name ilike '%'||trim(p_search)||'%'
  or w.primary_phone ilike '%'||trim(p_search)||'%' or w.primary_email ilike '%'||trim(p_search)||'%'
  or exists(select 1 from public.pets p where p.client_id=w.client_id and p.name ilike '%'||trim(p_search)||'%')
  or exists(select 1 from public.messages sm where sm.conversation_id=w.conversation_id and sm.content ilike '%'||trim(p_search)||'%'))
 order by w.updated_at desc,w.conversation_id desc limit p_limit;
end $$;
create function public.inbox_unread_totals() returns table(unread_conversations bigint,unread_messages bigint) language plpgsql security definer set search_path=public as $$
begin
 perform public.clinical_require_staff();
 return query select count(*) filter(where is_unread),coalesce(sum(unread_count),0)::bigint from public.inbox_workspace_rows where status='ACTIVE';
end $$;

do $$ declare f record;begin
 for f in select p.oid::regprocedure signature,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in ('guard_conversation_history','ensure_active_conversation','update_conversation_metadata','mark_conversation_read','mark_conversation_unread','capture_inbox_read_snapshot','apply_inbox_read_snapshot','list_inbox_workspace','inbox_unread_totals') loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  if f.proname<>'guard_conversation_history' then execute format('grant execute on function %s to authenticated',f.signature);end if;
 end loop;
end $$;
