-- Audited processing retries do not resolve financial evidence or alter signed receipts.
alter table public.stripe_event_work add column cycle_no integer not null default 0 check(cycle_no>=0),add column cycle_attempt_count integer not null default 0 check(cycle_attempt_count between 0 and 5);
update public.stripe_event_work set cycle_attempt_count=attempt_count;
do $$declare r record;begin
 for r in select conname from pg_constraint where conrelid='public.stripe_event_work'::regclass and contype='c' and pg_get_constraintdef(oid) like '%attempt_count >= 0%attempt_count <= 5%' and pg_get_constraintdef(oid) not like '%cycle_attempt_count%' loop
 execute format('alter table public.stripe_event_work drop constraint %I',r.conname);end loop;
end $$;
alter table public.stripe_event_work add constraint stripe_event_lifetime_attempts check(attempt_count>=0);
alter table public.stripe_event_work_history add column cycle_no integer not null default 0,add column cycle_attempt_count integer,add column lease_token uuid;
revoke select on public.stripe_event_work_history from authenticated;
grant select(id,receipt_id,action,attempt_count,reason,created_at,cycle_no,cycle_attempt_count) on public.stripe_event_work_history to authenticated;
-- Legacy history has cycle zero and null per-cycle/lease additions: its original count remains authoritative.
create table public.stripe_event_retry_cycles (
 id uuid primary key,receipt_id uuid not null references public.stripe_event_receipts(id),actor_id uuid not null references auth.users(id),cycle_no integer not null check(cycle_no>0),
 expected_work_hash text not null check(expected_work_hash ~ '^[a-f0-9]{64}$'),reason text not null check(reason in ('provider_recovered','rate_limit_resolved','processor_repaired')),
 previous_attempt_count integer not null,previous_cycle_attempt_count integer not null check(previous_cycle_attempt_count=5),created_at timestamptz not null default clock_timestamp(),unique(receipt_id,cycle_no)
);
alter table public.stripe_event_retry_cycles enable row level security;
revoke all on public.stripe_event_retry_cycles from public,anon,authenticated,service_role;
create trigger immutable_retry_cycle before update or delete on public.stripe_event_retry_cycles for each row execute function public.payment_immutable();
create function public.stripe_event_retry_target(p_receipt_id uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare r public.stripe_event_receipts;w public.stripe_event_work;c jsonb;invoice uuid;family text;last_reason text;
begin
 select * into r from public.stripe_event_receipts where id=p_receipt_id;
 select * into w from public.stripe_event_work where receipt_id=p_receipt_id;
 if r.id is null or r.disposition<>'queued' or w.state<>'quarantined' or w.reason<>'retry_exhausted' or w.cycle_attempt_count<>5 or w.lease_token is not null then raise exception 'Receipt is not eligible for audited retry' using errcode='23514';end if;
 select reason into last_reason from public.stripe_event_work_history where receipt_id=r.id and action='exhausted' and cycle_no=w.cycle_no order by created_at desc,id desc limit 1;
 if last_reason is null or last_reason not in ('provider_unavailable','rate_limited','transport_unknown','processing_error') then raise exception 'Documented recoverable processing failure required' using errcode='23514';end if;
 if not exists(select 1 from public.payment_provider_profiles where account_id=r.account_id and livemode=r.livemode) then raise exception 'Receipt provider configuration differs' using errcode='23514';end if;
 if r.event_type in ('checkout.session.completed','checkout.session.expired','checkout.session.async_payment_succeeded','checkout.session.async_payment_failed') then family:='checkout';c:=public.provider_checkout_context(r.request_id);
 elsif r.event_type in ('refund.created','refund.updated','refund.failed') then family:='refund';c:=public.provider_refund_context(r.request_id);
 else raise exception 'Unsupported receipt cannot be requeued' using errcode='23514';end if;
 if row(c->>'account_id',c->'livemode') is distinct from row(r.account_id,to_jsonb(r.livemode)) then raise exception 'Receipt provider configuration differs' using errcode='23514';end if;
 invoice:=(c->>'invoice_id')::uuid;
 -- Requires an accepted matching object and preserves all 3500 mismatch exclusions.
 perform public.payment_reconciliation_target_internal(invoice,family,r.request_id,r.object_id);
 return jsonb_build_object('invoice_id',invoice,'family',family,'request_id',r.request_id,'object_id',r.object_id,'last_failure',last_reason);
end $$;
create function public.stripe_event_retry_hash(p_receipt_id uuid) returns text language sql stable security definer set search_path=public,extensions as $$
 select encode(digest(jsonb_build_object('receipt',to_jsonb(r),'work',to_jsonb(w),
 'history',coalesce((select jsonb_agg(to_jsonb(h) order by created_at,id) from public.stripe_event_work_history h where receipt_id=r.id),'[]'::jsonb),
 'cycles',coalesce((select jsonb_agg(to_jsonb(c) order by cycle_no) from public.stripe_event_retry_cycles c where receipt_id=r.id),'[]'::jsonb),
 'invoice_hash',public.payment_reconciliation_hash_internal(coalesce((select invoice_id from public.invoice_checkout_attempts where id=r.request_id),(select invoice_id from public.invoice_refund_requests where id=r.request_id))))::text,'sha256'),'hex')
 from public.stripe_event_receipts r join public.stripe_event_work w on w.receipt_id=r.id where r.id=p_receipt_id
$$;
create function public.preview_stripe_event_retry(p_receipt_id uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare target jsonb;eligible boolean:=true;
begin perform public.payment_require_admin();
 if not exists(select 1 from public.stripe_event_receipts where id=p_receipt_id) then raise exception 'Receipt unavailable' using errcode='42501';end if;
 begin target:=public.stripe_event_retry_target(p_receipt_id);exception when check_violation or insufficient_privilege then eligible:=false;target:=null;end;
 return jsonb_build_object('receipt',(select to_jsonb(r) from public.stripe_event_receipts r where id=p_receipt_id),'work',(select to_jsonb(w)-array['lease_token'] from public.stripe_event_work w where receipt_id=p_receipt_id),'eligible',eligible,'target',target,'expected_work_hash',public.stripe_event_retry_hash(p_receipt_id),
 'cycles',coalesce((select jsonb_agg(to_jsonb(c) order by cycle_no) from public.stripe_event_retry_cycles c where receipt_id=p_receipt_id),'[]'::jsonb),
 'history',coalesce((select jsonb_agg((to_jsonb(h)-'lease_token')||jsonb_build_object('cycle_attempt_count',coalesce(h.cycle_attempt_count,h.attempt_count)) order by created_at,id) from public.stripe_event_work_history h where receipt_id=p_receipt_id),'[]'::jsonb));
end $$;
create function public.requeue_stripe_event(p_resolution_id uuid,p_receipt_id uuid,p_expected_work_hash text,p_reason text,p_attest boolean) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.payment_require_admin();saved public.stripe_event_retry_cycles;w public.stripe_event_work;target jsonb;
begin
 if p_resolution_id is null or p_attest is distinct from true or p_expected_work_hash is null or p_expected_work_hash !~ '^[a-f0-9]{64}$' or p_reason is null or p_reason not in ('provider_recovered','rate_limit_resolved','processor_repaired') then raise exception 'Exact administrator retry review required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_resolution_id::text,4000));
 select * into saved from public.stripe_event_retry_cycles where id=p_resolution_id;
 if found then
 if row(saved.receipt_id,saved.actor_id,saved.expected_work_hash,saved.reason) is distinct from row(p_receipt_id,actor,p_expected_work_hash,p_reason) then raise exception 'Retry review identifier already used' using errcode='23505';end if;
 return to_jsonb(saved);end if;
 select * into w from public.stripe_event_work where receipt_id=p_receipt_id for update;
 if not found then raise exception 'Receipt unavailable' using errcode='42501';end if;
 target:=public.stripe_event_retry_target(p_receipt_id);
 perform 1 from public.billing_invoices where id=(target->>'invoice_id')::uuid for update;
 if public.stripe_event_retry_hash(p_receipt_id) is distinct from p_expected_work_hash then raise exception 'Retry work or financial context changed' using errcode='40001';end if;
 perform public.stripe_event_retry_target(p_receipt_id);
 insert into public.stripe_event_retry_cycles(id,receipt_id,actor_id,cycle_no,expected_work_hash,reason,previous_attempt_count,previous_cycle_attempt_count) values(p_resolution_id,p_receipt_id,actor,w.cycle_no+1,p_expected_work_hash,p_reason,w.attempt_count,w.cycle_attempt_count) returning * into saved;
 update public.stripe_event_work set state='queued',cycle_no=w.cycle_no+1,cycle_attempt_count=0,available_at=clock_timestamp(),reason='',lease_token=null,lease_expires_at=null,updated_at=clock_timestamp() where receipt_id=p_receipt_id;
 return to_jsonb(saved);
end $$;
create or replace function public.claim_stripe_event() returns jsonb language plpgsql security definer set search_path=public as $$
declare w public.stripe_event_work;r public.stripe_event_receipts;
begin
 select * into w from public.stripe_event_work where (state='queued' and available_at<=clock_timestamp()) or (state='processing' and lease_expires_at<=clock_timestamp()) order by available_at,receipt_id for update skip locked limit 1;
 if not found then return null;end if;
 if w.cycle_attempt_count>=5 then
 update public.stripe_event_work set state='quarantined',lease_token=null,lease_expires_at=null,reason='retry_exhausted',updated_at=clock_timestamp() where receipt_id=w.receipt_id;
 insert into public.stripe_event_work_history(receipt_id,action,attempt_count,reason,cycle_no,cycle_attempt_count,lease_token) values(w.receipt_id,'exhausted',w.attempt_count,'retry_exhausted',w.cycle_no,w.cycle_attempt_count,w.lease_token);return null;
 end if;
 update public.stripe_event_work set state='processing',attempt_count=attempt_count+1,cycle_attempt_count=cycle_attempt_count+1,lease_token=gen_random_uuid(),lease_expires_at=clock_timestamp()+interval '2 minutes',updated_at=clock_timestamp() where receipt_id=w.receipt_id returning * into w;
 insert into public.stripe_event_work_history(receipt_id,action,attempt_count,reason,cycle_no,cycle_attempt_count,lease_token) values(w.receipt_id,'claimed',w.attempt_count,'',w.cycle_no,w.cycle_attempt_count,w.lease_token);
 select * into strict r from public.stripe_event_receipts where id=w.receipt_id;
 return jsonb_build_object('receipt',to_jsonb(r),'lease_token',w.lease_token,'lease_expires_at',w.lease_expires_at,'attempt_count',w.attempt_count,'cycle_no',w.cycle_no,'cycle_attempt_count',w.cycle_attempt_count);
end $$;
create or replace function public.retry_stripe_event(p_receipt_id uuid,p_lease_token uuid,p_reason text) returns text language plpgsql security definer set search_path=public as $$
declare w public.stripe_event_work;next_state text;
begin
 if p_reason is null or p_reason not in ('provider_unavailable','rate_limited','transport_unknown','processing_error') then raise exception 'Invalid Stripe retry reason' using errcode='23514';end if;
 select * into w from public.stripe_event_work where receipt_id=p_receipt_id for update;
 if not found or w.state<>'processing' or w.lease_token is distinct from p_lease_token or w.lease_expires_at<=clock_timestamp() then raise exception 'Stripe worker lease is unavailable' using errcode='42501';end if;
 next_state:=case when w.cycle_attempt_count>=5 then 'quarantined' else 'queued' end;
 update public.stripe_event_work set state=next_state,reason=case when next_state='quarantined' then 'retry_exhausted' else p_reason end,available_at=clock_timestamp()+make_interval(secs=>least(3600,30*(2^w.cycle_attempt_count)::integer)),lease_token=null,lease_expires_at=null,updated_at=clock_timestamp() where receipt_id=w.receipt_id;
 insert into public.stripe_event_work_history(receipt_id,action,attempt_count,reason,cycle_no,cycle_attempt_count,lease_token) values(w.receipt_id,case when next_state='quarantined' then 'exhausted' else 'retry' end,w.attempt_count,p_reason,w.cycle_no,w.cycle_attempt_count,w.lease_token);
 return next_state;
end $$;
do $$declare definition text;old text:='insert into public.stripe_event_work_history(receipt_id,action,attempt_count,reason) values(w.receipt_id,outcome_state,w.attempt_count,outcome_reason);';begin
 select pg_get_functiondef('public.finish_stripe_event(uuid,uuid,jsonb)'::regprocedure) into definition;
 if strpos(definition,old)=0 then raise exception 'Stripe completion history definition drifted';end if;
 execute replace(definition,old,'insert into public.stripe_event_work_history(receipt_id,action,attempt_count,reason,cycle_no,cycle_attempt_count,lease_token) values(w.receipt_id,outcome_state,w.attempt_count,outcome_reason,w.cycle_no,w.cycle_attempt_count,w.lease_token);');
end $$;
create or replace function public.read_stripe_event_queue(p_limit integer default 100) returns jsonb language plpgsql stable security definer set search_path=public as $$
begin perform public.clinical_require_staff();
 return coalesce((select jsonb_agg(item order by created_at desc,id) from (select r.id,r.created_at,to_jsonb(r)||jsonb_build_object('work_state',w.state,'attempt_count',w.attempt_count,'cycle_no',w.cycle_no,'cycle_attempt_count',w.cycle_attempt_count,'work_reason',w.reason,'available_at',w.available_at) item from public.stripe_event_receipts r join public.stripe_event_work w on w.receipt_id=r.id order by r.created_at desc,r.id limit greatest(1,least(coalesce(p_limit,100),250))) selected),'[]'::jsonb);
end $$;
revoke all on function public.stripe_event_retry_target(uuid),public.stripe_event_retry_hash(uuid),public.preview_stripe_event_retry(uuid),public.requeue_stripe_event(uuid,uuid,text,text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.preview_stripe_event_retry(uuid),public.requeue_stripe_event(uuid,uuid,text,text,boolean) to authenticated;
