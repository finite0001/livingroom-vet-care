-- Invoice reminder policy approvals do not alter payment/clinical ledgers.
create table public.invoice_reminder_policies(
 id uuid primary key,version integer not null unique check(version>0),actor_id uuid not null references auth.users(id),
 definition jsonb not null,created_at timestamptz not null default clock_timestamp()
);
create table public.invoice_reminder_terms(
 id uuid primary key,invoice_id uuid not null references public.billing_invoices(id),client_id uuid not null references public.clients(id),
 version integer not null check(version>0),actor_id uuid not null references auth.users(id),
 due_on date not null check(isfinite(due_on)),enabled boolean not null,channel text not null check(channel in('EMAIL','SMS')),
 hold_kind text not null check(hold_kind in('none','paused','disputed','bereavement')),hold_reason text not null,
 created_at timestamptz not null default clock_timestamp(),unique(invoice_id,version),
 check((hold_kind='none' and hold_reason='') or (hold_kind<>'none' and length(trim(hold_reason)) between 1 and 1000))
);
create index invoice_reminder_terms_current on public.invoice_reminder_terms(invoice_id,version desc);
create table public.invoice_reminder_actions(
 id uuid primary key,actor_id uuid not null references auth.users(id),kind text not null check(kind in('policy','terms')),
 request jsonb not null,receipt jsonb not null,created_at timestamptz not null default clock_timestamp()
);
create table public.invoice_reminder_jobs(
 id uuid primary key,invoice_id uuid not null references public.billing_invoices(id),client_id uuid not null references public.clients(id),
 terms_id uuid not null references public.invoice_reminder_terms(id),policy_id uuid not null references public.invoice_reminder_policies(id),
 offset_days integer not null check(offset_days between 1 and 365),context_hash text not null check(context_hash ~ '^[a-f0-9]{64}$'),
 frozen_context jsonb not null,outbox_id uuid not null unique references public.communication_outbox(id),
 created_at timestamptz not null default clock_timestamp()
);
create index invoice_reminder_jobs_invoice on public.invoice_reminder_jobs(invoice_id,created_at desc,id desc);
do $$declare t text;begin
 foreach t in array array['invoice_reminder_policies','invoice_reminder_terms','invoice_reminder_actions','invoice_reminder_jobs'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
 execute format('create trigger invoice_reminder_immutable before update or delete on public.%I for each row execute function public.guard_inquiry_history()',t);
 execute format('create trigger invoice_reminder_audit after insert on public.%I for each row execute function public.appointment_catalog_audit()',t);
 end loop;
end $$;

create function public.invoice_reminder_lock() returns void language plpgsql set search_path=public as $$
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'Invoice reminders require READ COMMITTED' using errcode='23514';end if;
 perform pg_advisory_xact_lock(80261015);
end $$;
revoke all on function public.invoice_reminder_lock() from public,anon,authenticated,service_role;

create function public.invoice_reminder_actor(p_actor uuid,p_admin boolean default false) returns uuid language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff();begin
 perform public.next_visit_review_session();
 if actor is distinct from p_actor or (p_admin and not public.has_role(actor,'ADMIN')) then raise exception 'Matched current authorized invoice operator required' using errcode='42501';end if;
 return actor;
end $$;
create function public.invoice_reminder_validate_policy(d jsonb) returns void language plpgsql set search_path=public as $$
declare k text;x jsonb;last_day integer:=0;day integer;begin
 perform public.native_rx_keys(d,array['enabled','default_due_days','offset_days','email_subject','email_body','sms_body','practice_contact']);
 if jsonb_typeof(d->'enabled') is distinct from 'boolean' then raise exception 'Explicit reminder enablement required' using errcode='23514';end if;
 perform public.appointment_catalog_integer(d->'default_due_days',0,365);
 if jsonb_typeof(d->'offset_days') is distinct from 'array' or jsonb_array_length(d->'offset_days') not between 1 and 12 then raise exception 'One to twelve ordered overdue offsets required' using errcode='23514';end if;
 for x in select value from jsonb_array_elements(d->'offset_days') loop
 day:=public.appointment_catalog_integer(x,1,365);
 if day<=last_day then raise exception 'Overdue offsets must be unique and ascending' using errcode='23514';end if;last_day:=day;
 end loop;
 foreach k in array array['email_subject','email_body','sms_body','practice_contact'] loop
 if jsonb_typeof(d->k) is distinct from 'string' or length(trim(d->>k)) not between 1 and (case k when 'sms_body' then 800 when 'practice_contact' then 200 when 'email_subject' then 200 else 6000 end) then raise exception 'Bounded reminder wording/contact required' using errcode='23514';end if;
 end loop;
 -- Replacements are literal, single-pass and never interpret client data as templates.
 if (d->>'practice_contact') ~ '[{}]' then raise exception 'Practice contact must be literal text' using errcode='23514';end if;
 foreach k in array array['email_subject','email_body','sms_body'] loop
 if regexp_replace(d->>k,'\{\{(invoice_reference|amount_due|due_date|practice_contact)\}\}','','g') ~ '[{}]' then raise exception 'Unknown invoice reminder placeholder' using errcode='23514';end if;
 end loop;
 if (d->>'email_subject') ~ E'[\r\n]' then raise exception 'Email subject cannot contain line breaks' using errcode='23514';end if;
end $$;
create function public.invoice_reminder_render(template text,invoice uuid,amount bigint,due date,contact text) returns text language plpgsql immutable set search_path=public as $$
declare piece record;result text:='';begin
 for piece in select m[1] token from regexp_matches(template,'(\{\{invoice_reference\}\}|\{\{amount_due\}\}|\{\{due_date\}\}|\{\{practice_contact\}\}|[^{}]+)','g') m loop
 result:=result||case piece.token when '{{invoice_reference}}' then left(invoice::text,8) when '{{amount_due}}' then (amount/100)::text||'.'||lpad((amount%100)::text,2,'0') when '{{due_date}}' then due::text when '{{practice_contact}}' then contact else piece.token end;
 end loop;return result;
end $$;
create function public.invoice_reminder_context(p_invoice_id uuid,p_offset integer default null) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare i billing_invoices;t invoice_reminder_terms;p invoice_reminder_policies;c clients;b jsonb;days integer;offset_day integer;reason text;recipient text;subject text;body text;amount bigint;begin
 select * into i from billing_invoices where id=p_invoice_id;
 if not found then return null;end if;
 select * into t from invoice_reminder_terms where invoice_id=i.id order by version desc limit 1;
 select * into p from invoice_reminder_policies order by version desc limit 1;
 select * into c from clients where id=i.client_id;
 b:=public.payment_balance_internal(i.id);amount:=(b->>'outstanding_cents')::bigint;
 days:=(statement_timestamp() at time zone 'America/Denver')::date-t.due_on;
 select max(value::integer) into offset_day from jsonb_array_elements_text(p.definition->'offset_days') where value::integer<=days;
 if p_offset is not null then offset_day:=p_offset;end if;
 recipient:=public.communication_recipient(t.channel,case when t.channel='EMAIL' then c.primary_email else c.primary_phone end);
 reason:=case when t.id is null then 'not_enrolled' when i.status<>'issued' then 'invoice_not_issued'
 when not t.enabled then 'invoice_reminders_off' when t.hold_kind<>'none' then t.hold_kind
 when p.id is null or (p.definition->>'enabled')::boolean is distinct from true then 'practice_reminders_off'
 when not public.is_active_staff(p.actor_id) or not public.has_role(p.actor_id,'ADMIN') or not public.is_active_staff(t.actor_id) then 'approver_inactive'
 when amount<=0 then 'paid_or_credited' when amount>999999999999 then 'balance_requires_review'
 when public.payment_invoice_has_observations(i.id) then 'payment_reconciliation'
 when exists(select 1 from invoice_checkout_attempts where invoice_id=i.id and public.checkout_state_internal(id) in('prepared','open','reconciliation')) then 'payment_pending'
 when exists(select 1 from invoice_refund_requests where invoice_id=i.id and public.refund_state_internal(id) in('pending','reconciliation')) then 'refund_pending'
 when offset_day is null or days<offset_day or not(p.definition->'offset_days' @> to_jsonb(array[offset_day])) then 'not_due'
 when recipient is null or public.communication_is_suppressed(t.channel,recipient,i.client_id) then 'contact_or_consent_unavailable'
 else null end;
 subject:=case when t.channel='EMAIL' then public.invoice_reminder_render(p.definition->>'email_subject',i.id,amount,t.due_on,p.definition->>'practice_contact') else '' end;
 body:=public.invoice_reminder_render(p.definition->>case when t.channel='EMAIL' then 'email_body' else 'sms_body' end,i.id,amount,t.due_on,p.definition->>'practice_contact');
 if reason is null and (length(body) not between 1 and case when t.channel='SMS' then 1600 else 100000 end or (t.channel='EMAIL' and length(subject) not between 1 and 500)) then reason:='rendered_message_invalid';end if;
 return jsonb_build_object('invoice_id',i.id,'client_id',i.client_id,'terms_id',t.id,'policy_id',p.id,'offset_days',offset_day,'due_on',t.due_on,'days_overdue',days,
 'amount_cents',amount::text,'source_hash',public.payment_source_hash_internal(i.id,i.client_id),'channel',t.channel,'recipient',recipient,'subject',subject,'body',body,'actor_id',t.actor_id,'reason',reason);
end $$;
create function public.invoice_reminder_scheduler_status() returns jsonb language plpgsql stable set search_path=public as $$
declare active boolean:=false;begin
 if to_regclass('cron.job') is not null then execute 'select active from cron.job where jobname=$1' into active using 'queue-invoice-reminders';end if;
 return jsonb_build_object('cron_active',coalesce(active,false),'last_run',(select recorded_at from invoice_reminder_runs order by recorded_at desc limit 1));
end $$;
revoke all on function public.invoice_reminder_scheduler_status() from public,anon,authenticated,service_role;

create function public.read_invoice_reminders(p_actor_id uuid,p_invoice_id uuid,p_client_id uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
 perform public.invoice_reminder_actor(p_actor_id);perform 1 from billing_invoices where id=p_invoice_id and client_id=p_client_id;
 if not found then raise exception 'Invoice household mismatch' using errcode='42501';end if;
 return jsonb_build_object('invoice_id',p_invoice_id,'client_id',p_client_id,
 'policy',(select to_jsonb(p) from invoice_reminder_policies p order by version desc limit 1),
 'terms',(select to_jsonb(t) from invoice_reminder_terms t where invoice_id=p_invoice_id order by version desc limit 1),
 'context',public.invoice_reminder_context(p_invoice_id),
 'scheduler',public.invoice_reminder_scheduler_status(),
 'history',coalesce((select jsonb_agg(r order by created_at desc,id desc) from (select j.id,j.created_at,j.offset_days,j.frozen_context->>'amount_cents' amount_cents,o.state,o.last_error,o.attempt_count,o.accepted_at,o.delivered_at,o.id outbox_id from invoice_reminder_jobs j join communication_outbox o on o.id=j.outbox_id where j.invoice_id=p_invoice_id order by j.created_at desc,j.id desc limit 20)r),'[]'),
 'has_more',(select count(*)>20 from invoice_reminder_jobs where invoice_id=p_invoice_id));
end $$;
create function public.recover_invoice_reminder_action(p_actor_id uuid,p_id uuid,p_kind text,p_request jsonb) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare r invoice_reminder_actions;begin
 perform public.invoice_reminder_actor(p_actor_id);
 select * into r from invoice_reminder_actions where id=p_id;
 if not found then return null;end if;
 if r.actor_id<>p_actor_id or r.kind<>p_kind or r.request is distinct from p_request then raise exception 'Reminder action UUID belongs to different work' using errcode='23505';end if;
 return r.receipt;
end $$;
create function public.save_invoice_reminder_policy(p_actor_id uuid,p_id uuid,p_expected_version integer,p_definition jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid;version integer;req jsonb:=jsonb_build_object('expected_version',p_expected_version,'definition',p_definition);receipt jsonb;begin
 actor:=public.invoice_reminder_actor(p_actor_id,true);
 perform public.invoice_reminder_lock();perform public.invoice_reminder_actor(actor,true);
 receipt:=public.recover_invoice_reminder_action(actor,p_id,'policy',req);if receipt is not null then return receipt;end if;
 perform public.invoice_reminder_validate_policy(p_definition);
 select coalesce(max(p.version),0) into version from invoice_reminder_policies p;
 if p_expected_version is distinct from version then raise exception 'Practice reminder settings changed; reload' using errcode='PT409';end if;
 insert into invoice_reminder_policies(id,version,actor_id,definition) values(p_id,version+1,actor,p_definition);
 receipt:=jsonb_build_object('id',p_id,'version',version+1,'actor_id',actor,'definition',p_definition);
 insert into invoice_reminder_actions(id,actor_id,kind,request,receipt) values(p_id,actor,'policy',req,receipt);return receipt;
end $$;
create function public.save_invoice_reminder_terms(p_actor_id uuid,p_id uuid,p_invoice_id uuid,p_client_id uuid,p_expected_version integer,p_values jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid;version integer;req jsonb:=jsonb_build_object('invoice_id',p_invoice_id,'client_id',p_client_id,'expected_version',p_expected_version,'values',p_values);receipt jsonb;due date;begin
 actor:=public.invoice_reminder_actor(p_actor_id);perform public.invoice_reminder_lock();perform public.invoice_reminder_actor(actor);
 receipt:=public.recover_invoice_reminder_action(actor,p_id,'terms',req);if receipt is not null then return receipt;end if;
 perform public.native_rx_keys(p_values,array['due_on','enabled','channel','hold_kind','hold_reason']);
 if jsonb_typeof(p_values->'enabled') is distinct from 'boolean' or jsonb_typeof(p_values->'due_on') is distinct from 'string' or p_values->>'due_on' !~ '^\d{4}-\d{2}-\d{2}$'
 or jsonb_typeof(p_values->'channel') is distinct from 'string' or p_values->>'channel' not in('EMAIL','SMS')
 or jsonb_typeof(p_values->'hold_kind') is distinct from 'string' or p_values->>'hold_kind' not in('none','paused','disputed','bereavement')
 or jsonb_typeof(p_values->'hold_reason') is distinct from 'string' then raise exception 'Explicit due date, enrollment, channel and hold required' using errcode='23514';end if;
 due:=(p_values->>'due_on')::date;
 perform 1 from billing_invoices where id=p_invoice_id and client_id=p_client_id and status='issued' for update;
 if not found then raise exception 'Issued invoice household unavailable' using errcode='42501';end if;
 select coalesce(max(t.version),0) into version from invoice_reminder_terms t where invoice_id=p_invoice_id;
 if p_expected_version is distinct from version then raise exception 'Invoice reminder settings changed; reload' using errcode='PT409';end if;
 insert into invoice_reminder_terms(id,invoice_id,client_id,version,actor_id,due_on,enabled,channel,hold_kind,hold_reason)
 values(p_id,p_invoice_id,p_client_id,version+1,actor,due,(p_values->>'enabled')::boolean,p_values->>'channel',p_values->>'hold_kind',trim(p_values->>'hold_reason'));
 receipt:=jsonb_build_object('id',p_id,'invoice_id',p_invoice_id,'client_id',p_client_id,'version',version+1,'values',p_values,'actor_id',actor);
 insert into invoice_reminder_actions(id,actor_id,kind,request,receipt) values(p_id,actor,'terms',req,receipt);return receipt;
end $$;

create function public.queue_due_invoice_reminders(p_limit integer default 25) returns jsonb language plpgsql security definer set search_path=public as $$
declare row record;ctx jsonb;digest text;conversation uuid;msg uuid;oid uuid;jid uuid;queued integer:=0;begin
 perform public.communication_require_service();
 if p_limit is null or p_limit not between 1 and 100 then raise exception 'Bounded invoice reminder batch required' using errcode='23514';end if;
 perform public.invoice_reminder_lock();
 for row in select i.id from billing_invoices i join lateral(select * from invoice_reminder_terms where invoice_id=i.id order by version desc limit 1)t on true
 where i.status='issued' and t.enabled and t.hold_kind='none' and t.due_on<(statement_timestamp() at time zone 'America/Denver')::date order by t.due_on,i.id loop
  exit when queued>=p_limit;
  -- Same order as final attempt and ledger writers: invoice before outbox.
  perform 1 from billing_invoices where id=row.id for update;
  ctx:=public.invoice_reminder_context(row.id);
  if ctx->>'reason' is not null then continue;end if;
  digest:=encode(sha256(convert_to(ctx::text,'UTF8')),'hex');
  if exists(select 1 from invoice_reminder_jobs j join communication_outbox o on o.id=j.outbox_id where j.invoice_id=row.id and
    ((j.offset_days=(ctx->>'offset_days')::integer and j.frozen_context->>'due_on'=ctx->>'due_on' and o.first_attempt_at is not null)
    or o.first_attempt_at>clock_timestamp()-interval '24 hours' or o.state='uncertain'
    or (j.context_hash=digest and (o.state<>'failed' or o.first_attempt_at is not null or coalesce(o.last_error,'') not in('invoice_reminder_source_ineligible','invoice_reminder_superseded'))))) then continue;end if;
  -- A changed unattempted message is never edited or sent with an obsolete amount.
  update communication_outbox o set state='failed',last_error='invoice_reminder_superseded',lease_token=null,lease_expires_at=null,updated_at=clock_timestamp()
  from invoice_reminder_jobs j where j.outbox_id=o.id and j.invoice_id=row.id and o.first_attempt_at is null and o.attempt_started_at is null and o.state in('pending','claimed');
  perform pg_advisory_xact_lock(hashtextextended(ctx->>'client_id',20));
  select id into conversation from conversations where client_id=(ctx->>'client_id')::uuid and status='ACTIVE' and archived_at is null order by created_at,id limit 1;
  if conversation is null then insert into conversations(client_id,status) values((ctx->>'client_id')::uuid,'ACTIVE') returning id into conversation;end if;
  jid:=gen_random_uuid();
  insert into messages(conversation_id,content,type,sender_type,sender_id,is_internal)
  values(conversation,ctx->>'body',(ctx->>'channel')::message_type,'SYSTEM',(ctx->>'actor_id')::uuid,false) returning id into msg;
  insert into communication_outbox(request_id,conversation_id,client_id,message_id,created_by,channel,recipient,subject,body,provider)
  values(jid,conversation,(ctx->>'client_id')::uuid,msg,(ctx->>'actor_id')::uuid,ctx->>'channel',ctx->>'recipient',ctx->>'subject',ctx->>'body',
   case when ctx->>'channel'='EMAIL' then 'resend' else public.communication_sms_provider() end) returning id into oid;
  insert into invoice_reminder_jobs(id,invoice_id,client_id,terms_id,policy_id,offset_days,context_hash,frozen_context,outbox_id)
  values(jid,row.id,(ctx->>'client_id')::uuid,(ctx->>'terms_id')::uuid,(ctx->>'policy_id')::uuid,(ctx->>'offset_days')::integer,digest,ctx,oid);
  update conversations set last_message_at=clock_timestamp(),is_read=true where id=conversation;
  queued:=queued+1;
 end loop;
 return jsonb_build_object('queued',queued,'dispatched',false);
end $$;

-- Hold and ledger changes commit before an attempt, or the attempt precedes them.
-- No trigger takes an outbox lock while holding an invoice in the opposite order.
alter function public.start_communication_attempt(uuid,uuid,jsonb) rename to start_communication_attempt_before_invoice_reminders;
revoke all on function public.start_communication_attempt_before_invoice_reminders(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
create function public.start_communication_attempt(p_id uuid,p_lease_token uuid,p_provider_config jsonb) returns public.communication_outbox language plpgsql security definer set search_path=public as $$
declare j invoice_reminder_jobs;o communication_outbox;ctx jsonb;begin
 perform public.communication_require_service();
 select * into j from invoice_reminder_jobs where outbox_id=p_id;
 if found then
  perform public.invoice_reminder_lock();
  perform 1 from billing_invoices where id=j.invoice_id for update;
  select * into o from communication_outbox where id=p_id for update;
  if o.state is distinct from 'claimed' or o.lease_token is distinct from p_lease_token or o.lease_expires_at<=clock_timestamp() or o.attempt_started_at is not null then raise exception 'Outbox lease unavailable' using errcode='PT409';end if;
  ctx:=public.invoice_reminder_context(j.invoice_id,j.offset_days);
  if ctx is distinct from j.frozen_context or ctx->>'reason' is not null or exists(select 1 from invoice_reminder_jobs other join communication_outbox box on box.id=other.outbox_id where other.invoice_id=j.invoice_id and other.id<>j.id and (box.state='uncertain' or box.first_attempt_at>clock_timestamp()-interval '24 hours')) then
   update communication_outbox set state='failed',last_error='invoice_reminder_source_ineligible',lease_token=null,lease_expires_at=null,updated_at=clock_timestamp() where id=o.id returning * into o;return o;
  end if;
 end if;
 return public.start_communication_attempt_before_invoice_reminders(p_id,p_lease_token,p_provider_config);
end $$;
revoke all on function public.start_communication_attempt(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.start_communication_attempt(uuid,uuid,jsonb) to service_role;

-- Label the canonical reminder in Daily communications without duplicating history.
alter function public.daily_communication_rows_internal() rename to daily_communication_rows_before_invoice_reminders;
revoke all on function public.daily_communication_rows_before_invoice_reminders() from public,anon,authenticated,service_role;
create function public.daily_communication_rows_internal()
returns table(source text,id uuid,activity_at timestamptz,created_at timestamptz,updated_at timestamptz,channel text,status text,summary text,client_id uuid,client_name text,pet_id uuid,patient_name text,conversation_id uuid,recipient text,attempt_count integer,accepted_at timestamptz,delivered_at timestamptz,reason text,source_href text)
language sql stable security definer set search_path=public as $$
 select r.source,r.id,r.activity_at,r.created_at,r.updated_at,r.channel,
 case when j.id is not null and o.last_error in('invoice_reminder_source_ineligible','invoice_reminder_superseded') and o.first_attempt_at is null then 'suppressed' else r.status end,
 case when j.id is not null then 'Unpaid invoice reminder' else r.summary end,
 r.client_id,r.client_name,r.pet_id,r.patient_name,r.conversation_id,r.recipient,r.attempt_count,r.accepted_at,r.delivered_at,
 case when j.id is not null and o.last_error in('invoice_reminder_source_ineligible','invoice_reminder_superseded') then 'Invoice balance, terms or reminder eligibility changed before sending' else r.reason end,r.source_href
 from public.daily_communication_rows_before_invoice_reminders()r
 left join invoice_reminder_jobs j on r.source='outbox' and j.outbox_id=r.id left join communication_outbox o on o.id=j.outbox_id
$$;
revoke all on function public.daily_communication_rows_internal() from public,anon,authenticated,service_role;

do $$declare r record;begin
 for r in select p.oid::regprocedure signature,p.proname from pg_proc p where p.pronamespace='public'::regnamespace and p.proname=any(array[
 'invoice_reminder_actor','invoice_reminder_validate_policy','invoice_reminder_render','invoice_reminder_context','read_invoice_reminders','recover_invoice_reminder_action','save_invoice_reminder_policy','save_invoice_reminder_terms','queue_due_invoice_reminders']) loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',r.signature);
 if r.proname in('read_invoice_reminders','recover_invoice_reminder_action','save_invoice_reminder_policy','save_invoice_reminder_terms') then execute format('grant execute on function %s to authenticated',r.signature);
 elsif r.proname='queue_due_invoice_reminders' then execute format('grant execute on function %s to service_role',r.signature);end if;
 end loop;
end $$;

create table public.invoice_reminder_runs(
 id uuid primary key,requested_limit integer not null check(requested_limit between 1 and 100),
 queued integer not null check(queued between 0 and 100),recorded_at timestamptz not null default clock_timestamp()
);
alter table public.invoice_reminder_runs enable row level security;
revoke all on public.invoice_reminder_runs from public,anon,authenticated,service_role;
create trigger invoice_reminder_runs_immutable before update or delete on public.invoice_reminder_runs for each row execute function public.guard_inquiry_history();
create function public.recover_invoice_reminder_run(p_run_id uuid,p_limit integer) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare r invoice_reminder_runs;begin
 perform public.communication_require_service();select * into r from invoice_reminder_runs where id=p_run_id;
 if not found then return null;end if;
 if r.requested_limit is distinct from p_limit then raise exception 'Run identity has different batch size' using errcode='23505';end if;
 return jsonb_build_object('run_id',r.id,'requested_limit',r.requested_limit,'queued',r.queued,'dispatched',false);
end $$;
create function public.execute_invoice_reminder_run(p_run_id uuid,p_limit integer) returns jsonb language plpgsql security definer set search_path=public as $$
declare receipt jsonb;begin
 perform public.communication_require_service();
 if p_run_id is null or p_limit is null or p_limit not between 1 and 100 then raise exception 'Run identity and bounded batch required' using errcode='23514';end if;
 perform public.invoice_reminder_lock();
 receipt:=public.recover_invoice_reminder_run(p_run_id,p_limit);if receipt is not null then return receipt;end if;
 receipt:=public.queue_due_invoice_reminders(p_limit);
 insert into invoice_reminder_runs(id,requested_limit,queued)values(p_run_id,p_limit,(receipt->>'queued')::integer);
 return public.recover_invoice_reminder_run(p_run_id,p_limit);
end $$;
revoke all on function public.execute_invoice_reminder_run(uuid,integer),public.recover_invoice_reminder_run(uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.execute_invoice_reminder_run(uuid,integer),public.recover_invoice_reminder_run(uuid,integer) to service_role;

create function public.scheduler_dispatch_invoice_reminders() returns void language plpgsql security definer set search_path=public,extensions as $$
declare project_url text;worker_key text;begin
 if (select (definition->>'enabled')::boolean from invoice_reminder_policies order by version desc limit 1) is distinct from true then return;end if;
 -- Daily email jobs are discovered during Denver business hours only. Outbox
 -- transport and global live/test mode remain the existing dispatcher's job.
 if extract(hour from clock_timestamp() at time zone 'America/Denver') not between 9 and 16 then return;end if;
 select decrypted_secret into project_url from vault.decrypted_secrets where name='project_url' limit 1;
 select decrypted_secret into worker_key from vault.decrypted_secrets where name='scheduler_worker_key' limit 1;
 if project_url is null or worker_key is null then return;end if;
 if project_url !~ '^https://(mgadheotkdnrsatfivjy|kothoqicubowyhwfsrte)\.supabase\.co$' then raise exception 'Known practice scheduler backend required' using errcode='23514';end if;
 perform net.http_post(url:=project_url||'/functions/v1/queue-invoice-reminders',headers:=jsonb_build_object('apikey',worker_key,'Content-Type','application/json'),body:=jsonb_build_object('run_id',gen_random_uuid(),'limit',25),timeout_milliseconds:=30000);
end $$;
revoke all on function public.scheduler_dispatch_invoice_reminders() from public,anon,authenticated,service_role;
do $$declare job_id bigint;begin
 if current_database()<>coalesce(current_setting('cron.database_name',true),'postgres') then return;end if;
 create extension if not exists pg_cron;
 job_id:=cron.schedule('queue-invoice-reminders','0 * * * *',$cmd$select public.scheduler_dispatch_invoice_reminders()$cmd$);
 perform cron.alter_job(job_id,active:=false);
end $$;
