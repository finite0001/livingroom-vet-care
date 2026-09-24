-- Disabled until explicitly reviewed policies AND the scheduler environment are enabled.
create table public.reminder_automation_policies (
 id uuid primary key,source_kind text not null check(source_kind in ('vaccine','lab','appointment')),channel text not null check(channel in ('EMAIL','SMS')),
 message_template_id uuid not null references public.care_message_templates(id),message_template_version integer not null,
 subject text not null default '',enabled boolean not null default false,review_note text not null check(length(trim(review_note)) between 1 and 2000),
 version integer not null default 1,approved_by uuid not null references public.profiles(id),approved_at timestamptz not null default now(),unique(source_kind,channel),
 check((channel='EMAIL' and length(trim(subject)) between 1 and 500)or(channel='SMS' and subject=''))
);
create table public.reminder_automation_policy_history (
 id bigint generated always as identity primary key,policy_id uuid not null references public.reminder_automation_policies(id),version integer not null,snapshot jsonb not null,unique(policy_id,version)
);
create table public.reminder_outbox_links (
 job_kind text not null check(job_kind in ('care','appointment')),job_id uuid not null,policy_id uuid not null references public.reminder_automation_policies(id),policy_version integer not null,
 outbox_id uuid unique references public.communication_outbox(id),approving_actor_id uuid references public.profiles(id),frozen_context jsonb,
 state text not null check(state in ('queued','blocked')),reason text,created_at timestamptz not null default now(),invalidated_at timestamptz,
 primary key(job_kind,job_id),check((state='queued' and outbox_id is not null and approving_actor_id is not null and frozen_context is not null)or(state='blocked' and outbox_id is null and reason is not null))
);
create function public.save_reminder_automation_policy(p_id uuid,p_expected_version integer,p_source_kind text,p_channel text,p_message_template_id uuid,p_message_template_version integer,p_subject text,p_enabled boolean,p_review_note text) returns public.reminder_automation_policies language plpgsql security definer set search_path=public as $$
declare actor uuid;r public.reminder_automation_policies;t public.care_message_templates;
begin actor=public.care_require_admin();if p_id is null then raise exception 'Stable policy ID required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,18));select * into r from public.reminder_automation_policies where id=p_id for update;
 if found then
  if r.approved_by=actor and r.version=coalesce(p_expected_version,0)+1 and row(r.source_kind,r.channel,r.message_template_id,r.message_template_version,r.subject,r.enabled,r.review_note) is not distinct from row(p_source_kind,p_channel,p_message_template_id,p_message_template_version,coalesce(p_subject,''),p_enabled,trim(p_review_note)) then return r;end if;
  if r.version is distinct from p_expected_version then raise exception 'Automation policy version conflict' using errcode='40001';end if;
  if row(r.source_kind,r.channel) is distinct from row(p_source_kind,p_channel) then raise exception 'Policy source and channel are immutable' using errcode='23514';end if;
 elsif p_expected_version is not null then raise exception 'Automation policy version conflict' using errcode='40001';end if;
 select * into t from public.care_message_templates where id=p_message_template_id for share;
 if t.id is null or not t.active or t.version is distinct from p_message_template_version or upper(t.channel) is distinct from p_channel then raise exception 'Select current reviewed wording for the policy channel' using errcode='23514';end if;
 if r.id is null then insert into public.reminder_automation_policies(id,source_kind,channel,message_template_id,message_template_version,subject,enabled,review_note,approved_by) values(p_id,p_source_kind,p_channel,t.id,t.version,coalesce(p_subject,''),p_enabled,trim(p_review_note),actor) returning * into r;
 else update public.reminder_automation_policies set message_template_id=t.id,message_template_version=t.version,subject=coalesce(p_subject,''),enabled=p_enabled,review_note=trim(p_review_note),version=version+1,approved_by=actor,approved_at=now() where id=p_id returning * into r;end if;
 insert into public.reminder_automation_policy_history(policy_id,version,snapshot) values(r.id,r.version,to_jsonb(r));return r;
end $$;
-- Internal validation/rendering is shared by enqueue and EVERY provider-attempt preflight.
create function public.reminder_delivery_context(p_job_kind text,p_job_id uuid,p_policy_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare policy public.reminder_automation_policies;t public.care_message_templates;j public.care_reminder_jobs;ar public.appointment_reminders;a public.appointments;v public.patient_vaccine_due_plans;l public.patient_lab_orders;p public.pets;c public.clients;actor uuid;source jsonb;body text;care_name text;due date;part record;recipient text;
begin
 select * into policy from public.reminder_automation_policies where id=p_policy_id for share;
 if policy.id is null or not policy.enabled or not public.is_active_staff(policy.approved_by) then return null;end if;
 select * into t from public.care_message_templates where id=policy.message_template_id for share;
 if t.id is null or not t.active or t.version<>policy.message_template_version or upper(t.channel)<>policy.channel or not public.is_active_staff(t.updated_by) then return null;end if;
 if p_job_kind='care' then
  select * into j from public.care_reminder_jobs where id=p_job_id for update;
  if j.id is null or j.status<>'pending' or j.source_kind<>policy.source_kind or upper(j.channel)<>policy.channel or j.message_template_id<>t.id or j.message_template_version<>t.version or j.scheduled_on>(now() at time zone 'America/Denver')::date then return null;end if;
  if j.source_kind='vaccine' then select * into v from public.patient_vaccine_due_plans where id=j.source_id for share;
   if v.id is null or v.version<>j.source_version or v.status<>'current' or not v.reminders_enabled or v.pet_id<>j.pet_id or v.current_due_on<>j.due_on or exists(select 1 from public.patient_treatment_corrections where treatment_id=v.treatment_id) then return null;end if;
   source=to_jsonb(v);actor=v.updated_by;
  else select * into l from public.patient_lab_orders where id=j.source_id for share;
   if l.id is null or l.version<>j.source_version or l.status not in ('planned','ordered') or l.pet_id<>j.pet_id or l.due_date is distinct from j.due_on then return null;end if;
   source=to_jsonb(l);actor=l.updated_by;
  end if;
  if source is distinct from j.source_snapshot or actor is distinct from (j.source_snapshot->>'updated_by')::uuid then return null;end if;
  select * into p from public.pets where id=j.pet_id for share;
  if p.client_id is distinct from j.client_id then return null;end if;body=j.rendered_body;due=j.due_on;
 elsif p_job_kind='appointment' then
  select * into ar from public.appointment_reminders where id=p_job_id for update;
  if ar.id is null or ar.status<>'PENDING' or ar.remind_at>now() or ar.channel<>policy.channel or policy.source_kind<>'appointment' then return null;end if;
  select * into a from public.appointments where id=ar.appointment_id for share;
  if a.id is null or a.version<>ar.appointment_version or a.status not in ('SCHEDULED','CONFIRMED') or a.scheduled_at<=now() or a.pet_id is null then return null;end if;
  actor=a.updated_by;source=to_jsonb(a);select * into p from public.pets where id=a.pet_id for share;
  if p.client_id is distinct from a.client_id then return null;end if;
  due=(a.scheduled_at at time zone 'America/Denver')::date;
  care_name=a.appointment_type||' · '||to_char(a.scheduled_at at time zone 'America/Denver','YYYY-MM-DD HH24:MI')||' America/Denver · '||a.address_snapshot;
  body='';for part in select m[1] token from regexp_matches(t.body,'(\{\{patient_name\}\}|\{\{care_name\}\}|\{\{due_date\}\}|[^{}]+)','g') m loop body=body||case part.token when '{{patient_name}}' then p.name when '{{care_name}}' then care_name when '{{due_date}}' then due::text else part.token end;end loop;
 else return null;end if;
 if p.id is null or p.archived_at is not null or p.deceased_at is not null or actor is null or not public.is_active_staff(actor) then return null;end if;
 select * into c from public.clients where id=p.client_id for share;
 recipient=public.communication_recipient(policy.channel,case when policy.channel='EMAIL' then c.primary_email else c.primary_phone end);
 if recipient is null or public.communication_is_suppressed(policy.channel,recipient,c.id) or length(body)<1 or (policy.channel='SMS' and length(body)>1600) then return null;end if;
 return jsonb_build_object('job_kind',p_job_kind,'job_id',p_job_id,'policy',to_jsonb(policy),'template',to_jsonb(t),'source',source,'actor_id',actor,'pet_id',p.id,'patient_name',p.name,'client_id',c.id,'recipient',recipient,'channel',policy.channel,'subject',policy.subject,'body',body,'due_on',due);
end $$;
create function public.block_reminder_job(p_job_kind text,p_job_id uuid,p_reason text) returns void language plpgsql security definer set search_path=public as $$
begin
 if p_job_kind='care' then update public.care_reminder_jobs set status='invalidated',invalidated_at=now(),invalidation_reason=p_reason where id=p_job_id and status='pending';
 else update public.appointment_reminders set status='SKIPPED',error_message=p_reason where id=p_job_id and status='PENDING';end if;
end $$;
create function public.queue_reminder_outbox(p_job_kind text,p_job_id uuid,p_policy_id uuid) returns public.reminder_outbox_links language plpgsql security definer set search_path=public as $$
declare context jsonb;r public.reminder_outbox_links;policy public.reminder_automation_policies;conversation uuid;msg uuid;outbox uuid;actor uuid;
begin perform public.communication_require_service();
 if p_job_kind not in ('care','appointment') or p_job_kind is null or p_job_id is null then raise exception 'Valid durable job identity required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_job_kind||p_job_id::text,19));select * into r from public.reminder_outbox_links where job_kind=p_job_kind and job_id=p_job_id;
 if found then if r.policy_id<>p_policy_id then raise exception 'Job already reviewed under another policy' using errcode='23505';end if;return r;end if;
 select * into policy from public.reminder_automation_policies where id=p_policy_id for share;
 if policy.id is null or not policy.enabled then raise exception 'Reminder policy disabled' using errcode='42501';end if;
 context=public.reminder_delivery_context(p_job_kind,p_job_id,p_policy_id);
 if context is null then
  perform public.block_reminder_job(p_job_kind,p_job_id,'Reminder source, consent or approval no longer eligible');
  insert into public.reminder_outbox_links(job_kind,job_id,policy_id,policy_version,state,reason) values(p_job_kind,p_job_id,policy.id,policy.version,'blocked','source_or_recipient_ineligible') returning * into r;return r;
 end if;
 actor=(context->>'actor_id')::uuid;
 -- Serialize household conversation creation; system origin remains linked to the approving staff actor.
 perform pg_advisory_xact_lock(hashtextextended(context->>'client_id',20));
 select id into conversation from public.conversations where client_id=(context->>'client_id')::uuid and status='ACTIVE' and archived_at is null order by created_at,id limit 1 for update;
 if conversation is null then insert into public.conversations(client_id,status) values((context->>'client_id')::uuid,'ACTIVE') returning id into conversation;end if;
 if exists(select 1 from public.communication_outbox where request_id=p_job_id) then raise exception 'Job UUID already belongs to another outbound intent' using errcode='23505';end if;
 insert into public.messages(conversation_id,content,type,sender_type,sender_id,is_internal) values(conversation,context->>'body',(context->>'channel')::public.message_type,'SYSTEM',actor,false) returning id into msg;
 insert into public.communication_outbox(request_id,conversation_id,client_id,message_id,created_by,channel,recipient,subject,body,provider) values(p_job_id,conversation,(context->>'client_id')::uuid,msg,actor,context->>'channel',context->>'recipient',context->>'subject',context->>'body',case when context->>'channel'='EMAIL' then 'resend' else 'twilio' end) returning id into outbox;
 insert into public.reminder_outbox_links(job_kind,job_id,policy_id,policy_version,outbox_id,approving_actor_id,frozen_context,state) values(p_job_kind,p_job_id,policy.id,policy.version,outbox,actor,context,'queued') returning * into r;
 update public.conversations set last_message_at=now(),is_read=true where id=conversation;return r;
end $$;
-- Preserve all existing provider/suppression/idempotency checks. The base is not service-callable.
alter function public.start_communication_attempt(uuid,uuid,jsonb) rename to start_communication_attempt_without_reminder_guard;
revoke all on function public.start_communication_attempt_without_reminder_guard(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
create function public.start_communication_attempt(p_id uuid,p_lease_token uuid,p_provider_config jsonb) returns public.communication_outbox language plpgsql security definer set search_path=public as $$
declare r public.communication_outbox;link public.reminder_outbox_links;context jsonb;
begin perform public.communication_require_service();select * into r from public.communication_outbox where id=p_id for update;
 if r.id is null or r.state<>'claimed' or r.lease_token is distinct from p_lease_token or r.lease_expires_at<=now() or r.attempt_started_at is not null then raise exception 'Outbox lease is unavailable' using errcode='40001';end if;
 select * into link from public.reminder_outbox_links where outbox_id=p_id for update;
 if found then
  if link.invalidated_at is null then context=public.reminder_delivery_context(link.job_kind,link.job_id,link.policy_id);end if;
  if context is null or context is distinct from link.frozen_context then
   update public.reminder_outbox_links set invalidated_at=coalesce(invalidated_at,now()),reason='final_preflight_source_or_recipient_ineligible' where outbox_id=p_id;
   perform public.block_reminder_job(link.job_kind,link.job_id,'Reminder invalidated before provider attempt');
   update public.communication_outbox set state='failed',last_error='reminder_source_or_recipient_ineligible',lease_token=null,lease_expires_at=null,updated_at=now() where id=p_id returning * into r;return r;
  end if;
 end if;
 r=public.start_communication_attempt_without_reminder_guard(p_id,p_lease_token,p_provider_config);
 if link.outbox_id is not null and r.state='failed' and r.last_error='recipient_or_actor_ineligible' then
  update public.reminder_outbox_links set invalidated_at=coalesce(invalidated_at,now()),reason='final_preflight_recipient_or_actor_ineligible' where outbox_id=p_id;
  perform public.block_reminder_job(link.job_kind,link.job_id,'Reminder invalidated by final recipient or actor check');
 end if;
 return r;
end $$;
create function public.queue_due_reminders(p_limit integer default 25) returns jsonb language plpgsql security definer set search_path=public as $$
declare candidate record;job public.care_reminder_jobs;link public.reminder_outbox_links;queued integer=0;blocked integer=0;skipped integer=0;
begin perform public.communication_require_service();if p_limit is null or p_limit not between 1 and 100 then raise exception 'Queue limit must be 1 to 100' using errcode='23514';end if;
 for candidate in
 select x.* from (
  select 'care'::text job_kind,j.id job_id,p.id policy_id,v.id source_id,'vaccine'::text source_kind,v.version source_version,t.id template_id,t.version template_version
  from public.reminder_automation_policies p join public.care_message_templates t on t.id=p.message_template_id and t.version=p.message_template_version and t.active
  join public.patient_vaccine_due_plans v on p.source_kind='vaccine' and v.status='current' and v.reminders_enabled and v.current_due_on<=(now() at time zone 'America/Denver')::date+t.days_before
  left join public.care_reminder_jobs j on j.source_kind='vaccine' and j.source_id=v.id and j.source_version=v.version and j.message_template_id=t.id and j.message_template_version=t.version
  where p.enabled and exists(select 1 from public.pets patient where patient.id=v.pet_id and patient.archived_at is null and patient.deceased_at is null) and (j.id is null or j.status='pending') and not exists(select 1 from public.reminder_outbox_links h where h.job_kind='care' and h.job_id=j.id)
  union all
  select 'care',j.id,p.id,l.id,'lab',l.version,t.id,t.version
  from public.reminder_automation_policies p join public.care_message_templates t on t.id=p.message_template_id and t.version=p.message_template_version and t.active
  join public.patient_lab_orders l on p.source_kind='lab' and l.status in ('planned','ordered') and l.due_date<=(now() at time zone 'America/Denver')::date+t.days_before
  left join public.care_reminder_jobs j on j.source_kind='lab' and j.source_id=l.id and j.source_version=l.version and j.message_template_id=t.id and j.message_template_version=t.version
  where p.enabled and exists(select 1 from public.pets patient where patient.id=l.pet_id and patient.archived_at is null and patient.deceased_at is null) and (j.id is null or j.status='pending') and not exists(select 1 from public.reminder_outbox_links h where h.job_kind='care' and h.job_id=j.id)
  union all
  select 'appointment',ar.id,p.id,a.id,'appointment',a.version,t.id,t.version
  from public.reminder_automation_policies p join public.care_message_templates t on t.id=p.message_template_id and t.version=p.message_template_version and t.active
  join public.appointment_reminders ar on p.source_kind='appointment' and ar.channel=p.channel and ar.status='PENDING' and ar.remind_at<=now()
  join public.appointments a on a.id=ar.appointment_id and a.version=ar.appointment_version and a.status in ('SCHEDULED','CONFIRMED') and a.scheduled_at>now()
  where p.enabled and not exists(select 1 from public.reminder_outbox_links h where h.job_kind='appointment' and h.job_id=ar.id)
 ) x order by x.job_kind,x.source_kind,x.source_id limit p_limit
 loop
  begin
   if candidate.job_kind='care' then job=public.enqueue_care_reminder(coalesce(candidate.job_id,gen_random_uuid()),candidate.source_kind,candidate.source_id,candidate.source_version,candidate.template_id,candidate.template_version);candidate.job_id=job.id;end if;
   link=public.queue_reminder_outbox(candidate.job_kind,candidate.job_id,candidate.policy_id);
   if link.state='queued' then queued=queued+1;else blocked=blocked+1;end if;
  exception when sqlstate '40001' or sqlstate '23514' or sqlstate '42501' then skipped=skipped+1;end;
 end loop;return jsonb_build_object('queued',queued,'blocked',blocked,'skipped',skipped,'dispatched',false);
end $$;
do $$ declare t text;begin foreach t in array array['reminder_automation_policies','reminder_automation_policy_history','reminder_outbox_links'] loop
 execute format('alter table public.%I enable row level security',t);execute format('revoke all on table public.%I from public,anon,authenticated,service_role',t);execute format('grant select on table public.%I to authenticated,service_role',t);execute format('create policy "Active staff read reminder automation audit" on public.%I for select to authenticated using(public.is_active_staff(auth.uid()))',t);
end loop;end $$;
revoke all on function public.reminder_delivery_context(text,uuid,uuid),public.block_reminder_job(text,uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.save_reminder_automation_policy(uuid,integer,text,text,uuid,integer,text,boolean,text) from public,anon,service_role;
grant execute on function public.save_reminder_automation_policy(uuid,integer,text,text,uuid,integer,text,boolean,text) to authenticated;
revoke all on function public.queue_reminder_outbox(text,uuid,uuid),public.queue_due_reminders(integer),public.start_communication_attempt(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.queue_reminder_outbox(text,uuid,uuid),public.queue_due_reminders(integer),public.start_communication_attempt(uuid,uuid,jsonb) to service_role;
