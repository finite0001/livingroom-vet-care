-- Read-only monitor. Dispatch, retry eligibility, provider configuration and clinical rules are unchanged.
-- Explicit projection prevents capabilities, message bodies, lease tokens and raw provider errors leaving this RPC.
create function public.daily_communication_rows_internal() returns table(
 source text,id uuid,activity_at timestamptz,created_at timestamptz,updated_at timestamptz,
 channel text,status text,summary text,client_id uuid,client_name text,pet_id uuid,patient_name text,
 conversation_id uuid,recipient text,attempt_count integer,accepted_at timestamptz,delivered_at timestamptz,
 reason text,source_href text
) language sql stable security invoker set search_path=public as $$
 with canonical as (
  select 'outbox'::text source,o.id,coalesce(last_attempt.started_at,o.first_attempt_at,o.created_at) activity_at,
   o.created_at,o.updated_at,o.channel,
   case when o.state='failed' and o.first_attempt_at is null and (rl.invalidated_at is not null or o.last_error='recipient_or_actor_ineligible') then 'suppressed'
    when o.state='pending' then 'queued' when o.state='claimed' then 'processing' else o.state end status,
   case when rl.job_kind='appointment' then 'Appointment reminder'
    when rl.job_kind='care' and cj.source_kind='vaccine' then 'Vaccine reminder'
    when rl.job_kind='care' then 'Lab reminder'
    when dl.outbox_id is not null then 'Protected document link'
    when pay.outbox_id is not null then 'Invoice payment link'
    when rel.outbox_id is not null then 'Records email'
    when inv.outbox_id is not null then 'Invoice email' else 'Staff message' end summary,
   o.client_id,c.full_name client_name,coalesce(cj.pet_id,ap.pet_id,release.pet_id,linked_release.pet_id) pet_id,
   p.name patient_name,o.conversation_id,o.recipient,o.attempt_count,o.accepted_at,o.delivered_at,
   case when o.state='failed' and o.first_attempt_at is null and (rl.invalidated_at is not null or o.last_error='recipient_or_actor_ineligible') then 'Eligibility check blocked this send'
    when o.state='uncertain' then 'Delivery is unconfirmed; do not resend without reconciliation'
    when o.state='failed' then 'Recorded failure; review the source before retrying' else null end reason,
   '/hub/conversation/'||o.conversation_id::text source_href
  from public.communication_outbox o join public.clients c on c.id=o.client_id
  left join lateral(select a.started_at from public.communication_attempts a where a.outbox_id=o.id order by a.attempt_number desc limit 1) last_attempt on true
  left join public.reminder_outbox_links rl on rl.outbox_id=o.id
  left join public.care_reminder_jobs cj on rl.job_kind='care' and cj.id=rl.job_id
  left join public.appointment_reminders ar on rl.job_kind='appointment' and ar.id=rl.job_id
  left join public.appointments ap on ap.id=ar.appointment_id
  left join public.document_link_outbox_links dl on dl.outbox_id=o.id
  left join public.document_link_grants dg on dg.id=dl.grant_id
  left join public.record_releases linked_release on dg.family='record_release' and linked_release.id=dg.source_id and linked_release.client_id=o.client_id
  left join public.payment_delivery_outbox_links pay on pay.outbox_id=o.id
  left join public.release_email_outbox_links rel on rel.outbox_id=o.id
  left join public.release_email_requests rr on rr.id=rel.request_id
  left join public.record_releases release on release.id=rr.release_id
  left join public.invoice_email_outbox_links inv on inv.outbox_id=o.id
  left join public.pets p on p.id=coalesce(cj.pet_id,ap.pet_id,release.pet_id,linked_release.pet_id)
 ), retained as (
  select 'legacy'::text,d.id,coalesce(d.leased_at,d.scheduled_at,d.created_at),d.created_at,d.updated_at,d.channel::text,
   case d.status when 'QUEUED' then case when d.scheduled_at>statement_timestamp() then 'scheduled' else 'queued' end
    when 'LEASED' then 'processing' when 'ACCEPTED' then 'accepted' when 'DELIVERED' then 'delivered'
    when 'FAILED' then 'failed' when 'CANCELED' then 'cancelled' else 'uncertain' end,
   case when d.appointment_reminder_id is not null then 'Retained appointment reminder' else 'Retained staff delivery' end,
   d.client_id,c.full_name,a.pet_id,p.name,coalesce(d.conversation_id,m.conversation_id),d.recipient,d.attempt_count,d.accepted_at,d.delivered_at,
   case when d.status='UNKNOWN' then 'Delivery is unconfirmed; do not resend without reconciliation'
    when d.status='FAILED' then 'Recorded failure; review the source before retrying'
    when coalesce(d.conversation_id,m.conversation_id) is null and ar.id is null then 'No linked source remains; review the retained delivery metadata' else null end,
   case when coalesce(d.conversation_id,m.conversation_id) is not null then '/hub/conversation/'||coalesce(d.conversation_id,m.conversation_id)::text when ar.id is not null then '/hub/schedule' else null end
  from public.outbound_deliveries d left join public.clients c on c.id=d.client_id
  left join public.messages m on m.id=d.message_id
  left join public.appointment_reminders ar on ar.id=d.appointment_reminder_id
  left join public.appointments a on a.id=ar.appointment_id left join public.pets p on p.id=a.pet_id
  where not exists(select 1 from public.communication_outbox o where (o.message_id=d.message_id and o.channel=d.channel::text)
   or (o.provider=d.provider and o.provider_message_id=d.provider_message_id and o.channel=d.channel::text))
   and not exists(select 1 from public.reminder_outbox_links r where r.job_kind='appointment' and r.job_id=d.appointment_reminder_id and r.outbox_id is not null)
 ), care as (
  select 'care'::text,j.id,j.scheduled_on::timestamp at time zone 'America/Denver',j.created_at,
   coalesce(j.invalidated_at,j.created_at),upper(j.channel),
   case when j.status='invalidated' or r.state='blocked' then 'suppressed' else 'scheduled' end,
   case when j.source_kind='vaccine' then 'Vaccine reminder' else 'Lab reminder' end,
   j.client_id,c.full_name,j.pet_id,p.name,null::uuid,
   case when upper(j.channel)='EMAIL' then c.primary_email else c.primary_phone end,0,null::timestamptz,null::timestamptz,
   case when j.status='invalidated' or r.state='blocked' then 'Reminder blocked or invalidated; review the care plan'
    else 'Scheduled reminder job; delivery depends on current automation policy and final eligibility' end,
   '/hub/tools/care-reminders'
  from public.care_reminder_jobs j join public.clients c on c.id=j.client_id join public.pets p on p.id=j.pet_id
  left join public.reminder_outbox_links r on r.job_kind='care' and r.job_id=j.id
  where r.outbox_id is null
 ), appointments as (
  select 'appointment'::text,r.id,r.remind_at,r.created_at,r.updated_at,r.channel,
   case when link.state='blocked' or r.status='SKIPPED' then 'suppressed'
    when r.status='FAILED' then 'failed' when r.status='SENT' then 'uncertain'
    when r.status='QUEUED' then 'queued' else 'scheduled' end,
   'Appointment reminder',a.client_id,c.full_name,a.pet_id,p.name,null::uuid,
   case when r.channel='EMAIL' then c.primary_email else c.primary_phone end,0,null::timestamptz,null::timestamptz,
   case when link.state='blocked' or r.status='SKIPPED' then 'Reminder blocked or skipped; review the appointment'
    when r.status='SENT' then 'Historical sent status has no linked delivery evidence'
    else 'Reminder job; delivery depends on current automation policy and final eligibility' end,
   '/hub/schedule'
  from public.appointment_reminders r join public.appointments a on a.id=r.appointment_id
  join public.clients c on c.id=a.client_id left join public.pets p on p.id=a.pet_id
  left join public.reminder_outbox_links link on link.job_kind='appointment' and link.job_id=r.id
  where link.outbox_id is null and not exists(select 1 from public.outbound_deliveries d where d.appointment_reminder_id=r.id or d.id=r.outbound_delivery_id)
 ) select * from canonical union all select * from retained union all select * from care union all select * from appointments
$$;
revoke all on function public.daily_communication_rows_internal() from public,anon,authenticated,service_role;

create function public.list_daily_communications(
 p_from date default (statement_timestamp() at time zone 'America/Denver')::date,
 p_to date default (statement_timestamp() at time zone 'America/Denver')::date,
 p_channel text default null,p_status text default null,p_search text default '',
 p_before jsonb default null,p_limit integer default 50
) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb;before_at timestamptz;before_source text;before_id uuid;
begin
 perform public.clinical_require_staff();
 if p_from is null or p_to is null or not isfinite(p_from) or not isfinite(p_to) or p_to<p_from or p_to-p_from>365
  or p_limit is null or p_limit not between 1 and 100 or p_search is null or length(p_search)>200
  or (p_channel is not null and p_channel not in ('EMAIL','SMS'))
  or (p_status is not null and p_status not in ('scheduled','queued','processing','accepted','delivered','failed','uncertain','suppressed','cancelled'))
 then raise exception 'Valid dates (up to 366 days), channel, status and bounded search required' using errcode='23514';end if;
 if p_before is not null then
  perform public.native_rx_keys(p_before,array['activity_at','source','id']);
  before_at:=public.native_correction_instant(p_before->'activity_at');before_source:=p_before->>'source';before_id:=public.native_rx_uuid(p_before->'id');
  if before_source is null or before_source not in ('outbox','legacy','care','appointment') then raise exception 'Invalid communication cursor' using errcode='23514';end if;
 end if;
 with filtered as (
  select r.* from public.daily_communication_rows_internal() r
  where r.activity_at >= (p_from::timestamp at time zone 'America/Denver')
   and r.activity_at < ((p_to+1)::timestamp at time zone 'America/Denver')
   and (p_channel is null or r.channel=p_channel) and (p_status is null or r.status=p_status)
   and (trim(p_search)='' or strpos(lower(coalesce(r.client_name,'')),lower(trim(p_search)))>0
    or strpos(lower(coalesce(r.patient_name,'')),lower(trim(p_search)))>0)
   and (p_before is null or (r.activity_at,r.source,r.id)<(before_at,before_source,before_id))
  order by r.activity_at desc,r.source desc,r.id desc limit p_limit+1
 ), page as (select * from filtered order by activity_at desc,source desc,id desc limit p_limit)
 select jsonb_build_object('read_at',statement_timestamp(),'rows',coalesce((select jsonb_agg(to_jsonb(page) order by activity_at desc,source desc,id desc) from page),'[]'),
  'next',case when (select count(*) from filtered)>p_limit then (select jsonb_build_object('activity_at',activity_at,'source',source,'id',id) from page order by activity_at,source,id limit 1) else null end) into result;
 return result;
end $$;
create function public.read_daily_communication(p_source text,p_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare result jsonb;begin
 perform public.clinical_require_staff();
 if p_source is null or p_source not in ('outbox','legacy','care','appointment') or p_id is null then raise exception 'Communication identity required' using errcode='23514';end if;
 select jsonb_build_object('record',to_jsonb(r),'attempts',case when p_source='outbox' then coalesce((
  select jsonb_agg(jsonb_build_object('attempt_number',a.attempt_number,'started_at',a.started_at,'finished_at',a.finished_at,'outcome',a.outcome) order by a.attempt_number)
  from public.communication_attempts a where a.outbox_id=p_id),'[]') else '[]'::jsonb end) into result
 from public.daily_communication_rows_internal() r where r.source=p_source and r.id=p_id;
 return result;
end $$;
revoke all on function public.list_daily_communications(date,date,text,text,text,jsonb,integer),public.read_daily_communication(text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.list_daily_communications(date,date,text,text,text,jsonb,integer),public.read_daily_communication(text,uuid) to authenticated;
create index communication_outbox_daily_created_idx on public.communication_outbox(created_at desc,id desc);
create index outbound_deliveries_daily_scheduled_idx on public.outbound_deliveries(scheduled_at desc,id desc);
create index care_reminder_jobs_daily_scheduled_idx on public.care_reminder_jobs(scheduled_on desc,id desc);
create index appointment_reminders_daily_remind_idx on public.appointment_reminders(remind_at desc,id desc);
