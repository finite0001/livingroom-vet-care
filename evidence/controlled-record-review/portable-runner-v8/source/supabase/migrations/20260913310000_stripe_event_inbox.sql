-- Minimal signed-envelope receipts; raw provider bodies and Checkout URLs never enter this inbox.
create table public.stripe_event_receipts (
 id uuid primary key default gen_random_uuid(), event_id text not null check(event_id ~ '^evt_[A-Za-z0-9]{1,196}$'),
 event_type text not null check(event_type ~ '^[a-z][a-z0-9_.]{0,99}$'), provider_created_at bigint not null check(provider_created_at between 0 and 253402300799),
 account_id text not null check(account_id ~ '^acct_[A-Za-z0-9]{1,195}$'), livemode boolean not null,
 object_id text check(object_id ~ '^(cs_|re_|pi_|ch_|dp_)[A-Za-z0-9_]{1,190}$'), request_id uuid,
 raw_sha256 text not null check(raw_sha256 ~ '^[a-f0-9]{64}$'),
 received_disposition text not null, received_reason text not null,
 disposition text not null check(disposition in ('queued','quarantined','ignored')),
 reason text not null check(reason in ('','account_or_mode_mismatch','api_version_mismatch','unattributed_provider_object','external_adjustment_review','unsupported_event','provider_not_configured')),
 created_at timestamptz not null default now(), unique(account_id,livemode,event_id)
);
create table public.stripe_event_work (
 receipt_id uuid primary key references public.stripe_event_receipts(id),
 state text not null check(state in ('queued','processing','completed','quarantined','ignored')),
 attempt_count integer not null default 0 check(attempt_count between 0 and 5),
 available_at timestamptz not null default now(), lease_token uuid, lease_expires_at timestamptz,
 reason text not null default '', updated_at timestamptz not null default now(),
 check((state='processing' and lease_token is not null and lease_expires_at is not null) or (state<>'processing' and lease_token is null and lease_expires_at is null))
);
create table public.stripe_event_work_history (
 id uuid primary key default gen_random_uuid(), receipt_id uuid not null references public.stripe_event_receipts(id),
 action text not null check(action in ('claimed','retry','completed','quarantined','exhausted')),
 attempt_count integer not null, reason text not null, created_at timestamptz not null default now()
);
create index stripe_event_work_claim_idx on public.stripe_event_work(available_at,receipt_id) where state in ('queued','processing');
create index stripe_event_receipt_request_idx on public.stripe_event_receipts(request_id);
create index stripe_event_work_history_receipt_idx on public.stripe_event_work_history(receipt_id);
alter table public.stripe_event_receipts enable row level security;
alter table public.stripe_event_work enable row level security;
alter table public.stripe_event_work_history enable row level security;
revoke all on public.stripe_event_receipts,public.stripe_event_work,public.stripe_event_work_history from public,anon,authenticated,service_role;
grant select on public.stripe_event_receipts,public.stripe_event_work_history to authenticated;
create policy "Active staff read receipts" on public.stripe_event_receipts for select to authenticated using(public.is_active_staff(auth.uid()));
create policy "Active staff read worker history" on public.stripe_event_work_history for select to authenticated using(public.is_active_staff(auth.uid()));
create trigger immutable_stripe_receipt before update or delete on public.stripe_event_receipts for each row execute function public.payment_immutable();
create trigger immutable_stripe_history before update or delete on public.stripe_event_work_history for each row execute function public.payment_immutable();

create function public.receive_stripe_event(p_receipt jsonb) returns uuid language plpgsql security definer set search_path=public as $$
declare r public.stripe_event_receipts; supplied public.stripe_event_receipts; disposition text;reason text;request uuid;
begin
 if jsonb_typeof(p_receipt) is distinct from 'object' or octet_length(p_receipt::text)>4096 then raise exception 'Invalid Stripe receipt' using errcode='23514';end if;
 if (select count(*) from jsonb_object_keys(p_receipt))<>10 or exists(select 1 from jsonb_object_keys(p_receipt) k where k not in ('event_id','event_type','provider_created_at','account_id','livemode','object_id','request_id','raw_sha256','disposition','reason')) then raise exception 'Invalid Stripe receipt keys' using errcode='23514';end if;
 if exists(select 1 from unnest(array['event_id','event_type','account_id','raw_sha256','disposition','reason']) k where jsonb_typeof(p_receipt->k) is distinct from 'string') or jsonb_typeof(p_receipt->'livemode') is distinct from 'boolean' or jsonb_typeof(p_receipt->'provider_created_at') is distinct from 'number' or (p_receipt->>'provider_created_at') !~ '^[0-9]{1,12}$' or jsonb_typeof(p_receipt->'object_id') not in ('string','null') or jsonb_typeof(p_receipt->'request_id') not in ('string','null') then raise exception 'Invalid Stripe receipt types' using errcode='23514';end if;
 if p_receipt->>'raw_sha256' !~ '^[a-f0-9]{64}$' then raise exception 'Invalid Stripe receipt hash' using errcode='23514';end if;
 supplied:=jsonb_populate_record(null::public.stripe_event_receipts,p_receipt);
 perform pg_advisory_xact_lock(hashtextextended(supplied.account_id||':'||supplied.livemode::text||':'||supplied.event_id,3100));
 select * into r from public.stripe_event_receipts where account_id=supplied.account_id and livemode=supplied.livemode and event_id=supplied.event_id;
 if found then
 -- Dedupe against the supplied envelope, not a silently modified provider payload.
 if row(r.event_type,r.provider_created_at,r.object_id,r.request_id,r.received_disposition,r.received_reason) is distinct from row(supplied.event_type,supplied.provider_created_at,supplied.object_id,supplied.request_id,supplied.disposition,supplied.reason) then raise exception 'Stripe event identifier conflict; reconcile delivery' using errcode='23514';end if;
 return r.id;end if;
 disposition:=supplied.disposition;reason:=supplied.reason;
 if disposition not in ('queued','quarantined','ignored') or reason not in ('','account_or_mode_mismatch','api_version_mismatch','unattributed_provider_object','external_adjustment_review','unsupported_event') then raise exception 'Invalid Stripe receipt disposition' using errcode='23514';end if;
 if disposition='queued' and reason<>'' then raise exception 'Queued Stripe receipt has a rejection reason' using errcode='23514';end if;
 if not exists(select 1 from public.payment_provider_profiles where account_id=supplied.account_id and livemode=supplied.livemode) then disposition:='quarantined';reason:='provider_not_configured';
 elsif disposition='queued' then
 if supplied.event_type in ('checkout.session.completed','checkout.session.expired','checkout.session.async_payment_succeeded','checkout.session.async_payment_failed') then
 if supplied.object_id is null or supplied.object_id not like 'cs_%' or not exists(select 1 from public.invoice_checkout_attempts where id=supplied.request_id and account_id=supplied.account_id and livemode=supplied.livemode) then disposition:='quarantined';reason:='unattributed_provider_object';end if;
 elsif supplied.event_type in ('refund.created','refund.updated','refund.failed') then
 if supplied.object_id is null or supplied.object_id not like 're_%' or not exists(select 1 from public.invoice_refund_requests rr join public.invoice_payments p on p.id=rr.payment_id where rr.id=supplied.request_id and p.account_id=supplied.account_id and p.livemode=supplied.livemode) then disposition:='quarantined';reason:='unattributed_provider_object';end if;
 else disposition:='quarantined';reason:='unsupported_event';end if;
 end if;
 insert into public.stripe_event_receipts(event_id,event_type,provider_created_at,account_id,livemode,object_id,request_id,raw_sha256,received_disposition,received_reason,disposition,reason)
 values(supplied.event_id,supplied.event_type,supplied.provider_created_at,supplied.account_id,supplied.livemode,supplied.object_id,supplied.request_id,supplied.raw_sha256,supplied.disposition,supplied.reason,disposition,reason) returning * into r;
 insert into public.stripe_event_work(receipt_id,state,reason) values(r.id,case when disposition='queued' then 'queued' else disposition end,reason);
 return r.id;
end $$;

create function public.claim_stripe_event() returns jsonb language plpgsql security definer set search_path=public as $$
declare w public.stripe_event_work;r public.stripe_event_receipts;
begin
 -- At most one candidate per call. An expired fifth lease becomes visible quarantine.
 select * into w from public.stripe_event_work where (state='queued' and available_at<=clock_timestamp()) or (state='processing' and lease_expires_at<=clock_timestamp()) order by available_at,receipt_id for update skip locked limit 1;
 if not found then return null;end if;
 if w.attempt_count>=5 then
 update public.stripe_event_work set state='quarantined',lease_token=null,lease_expires_at=null,reason='retry_exhausted',updated_at=clock_timestamp() where receipt_id=w.receipt_id;
 insert into public.stripe_event_work_history(receipt_id,action,attempt_count,reason) values(w.receipt_id,'exhausted',w.attempt_count,'retry_exhausted');return null;
 end if;
 update public.stripe_event_work set state='processing',attempt_count=attempt_count+1,lease_token=gen_random_uuid(),lease_expires_at=clock_timestamp()+interval '2 minutes',updated_at=clock_timestamp() where receipt_id=w.receipt_id returning * into w;
 insert into public.stripe_event_work_history(receipt_id,action,attempt_count,reason) values(w.receipt_id,'claimed',w.attempt_count,'');
 select * into strict r from public.stripe_event_receipts where id=w.receipt_id;
 return jsonb_build_object('receipt',to_jsonb(r),'lease_token',w.lease_token,'lease_expires_at',w.lease_expires_at,'attempt_count',w.attempt_count);
end $$;

create function public.finish_stripe_event(p_receipt_id uuid,p_lease_token uuid,p_evidence jsonb) returns text language plpgsql security definer set search_path=public as $$
declare w public.stripe_event_work;r public.stripe_event_receipts;checkout public.invoice_payment_evidence;refund public.invoice_refund_evidence;outcome_reason text:='';outcome_state text:='completed';family text;
begin
 select * into w from public.stripe_event_work where receipt_id=p_receipt_id for update;
 if not found or w.state<>'processing' or w.lease_token is distinct from p_lease_token or w.lease_expires_at<=clock_timestamp() then raise exception 'Stripe worker lease is unavailable' using errcode='42501';end if;
 select * into strict r from public.stripe_event_receipts where id=p_receipt_id;
 if jsonb_typeof(p_evidence) is distinct from 'object' or octet_length(p_evidence::text)>4096 then raise exception 'Invalid Stripe completion' using errcode='23514';end if;
 family:=p_evidence->>'family';
 if family='quarantine' then
 if (select count(*) from jsonb_object_keys(p_evidence))<>2 or exists(select 1 from jsonb_object_keys(p_evidence) k where k not in ('family','reason')) or p_evidence->>'reason' not in ('provider_context_mismatch','provider_object_unavailable','unattributed_provider_object','unsupported_event','external_adjustment_review','provider_reconciliation_required') then raise exception 'Invalid Stripe quarantine' using errcode='23514';end if;
 outcome_reason:=p_evidence->>'reason';outcome_state:='quarantined';
 elsif family in ('checkout','refund') then
 if jsonb_typeof(p_evidence->'account_id') is distinct from 'string' or jsonb_typeof(p_evidence->'livemode') is distinct from 'boolean' or jsonb_typeof(p_evidence->'amount_cents') is distinct from 'string' or (p_evidence->>'amount_cents') !~ '^[0-9]{1,8}$' or jsonb_typeof(p_evidence->'currency') is distinct from 'string' then raise exception 'Invalid Stripe completion types' using errcode='23514';end if;
 if row(p_evidence->>'account_id',(p_evidence->>'livemode')::boolean) is distinct from row(r.account_id,r.livemode) then raise exception 'Stripe receipt context mismatch' using errcode='23514';end if;
 if family='checkout' then
 if exists(select 1 from unnest(array['kind','session_id','source_hash']) k where jsonb_typeof(p_evidence->k) is distinct from 'string') or jsonb_typeof(p_evidence->'payment_id') not in ('string','null') then raise exception 'Invalid Checkout completion types' using errcode='23514';end if;
 if (select count(*) from jsonb_object_keys(p_evidence))<>9 or exists(select 1 from jsonb_object_keys(p_evidence) k where k not in ('family','account_id','livemode','kind','session_id','payment_id','amount_cents','currency','source_hash')) then raise exception 'Invalid Checkout completion keys' using errcode='23514';end if;
 if r.event_type not in ('checkout.session.completed','checkout.session.expired','checkout.session.async_payment_succeeded','checkout.session.async_payment_failed') or p_evidence->>'session_id' is distinct from r.object_id then raise exception 'Stripe Checkout receipt object mismatch' using errcode='23514';end if;
 checkout:=public.apply_checkout_evidence(r.event_id,r.request_id,r.account_id,r.livemode,p_evidence->>'kind',p_evidence->>'session_id',p_evidence->>'payment_id',(p_evidence->>'amount_cents')::bigint,p_evidence->>'currency',p_evidence->>'source_hash');
 if checkout.disposition='quarantined' then outcome_state:='quarantined';outcome_reason:=checkout.reason;end if;
 else
 if exists(select 1 from unnest(array['refund_id','provider_payment_id','status']) k where jsonb_typeof(p_evidence->k) is distinct from 'string') then raise exception 'Invalid refund completion types' using errcode='23514';end if;
 if (select count(*) from jsonb_object_keys(p_evidence))<>8 or exists(select 1 from jsonb_object_keys(p_evidence) k where k not in ('family','account_id','livemode','refund_id','provider_payment_id','amount_cents','currency','status')) then raise exception 'Invalid refund completion keys' using errcode='23514';end if;
 if r.event_type not in ('refund.created','refund.updated','refund.failed') or p_evidence->>'refund_id' is distinct from r.object_id then raise exception 'Stripe refund receipt object mismatch' using errcode='23514';end if;
 refund:=public.apply_refund_evidence(r.event_id,r.request_id,r.account_id,r.livemode,p_evidence->>'refund_id',p_evidence->>'provider_payment_id',(p_evidence->>'amount_cents')::bigint,p_evidence->>'currency',p_evidence->>'status');
 if refund.disposition='quarantined' then outcome_state:='quarantined';outcome_reason:=refund.reason;end if;
 end if;
 else raise exception 'Invalid Stripe completion family' using errcode='23514';end if;
 update public.stripe_event_work set state=outcome_state,reason=outcome_reason,lease_token=null,lease_expires_at=null,updated_at=clock_timestamp() where receipt_id=w.receipt_id;
 insert into public.stripe_event_work_history(receipt_id,action,attempt_count,reason) values(w.receipt_id,outcome_state,w.attempt_count,outcome_reason);
 return outcome_state;
end $$;

create function public.retry_stripe_event(p_receipt_id uuid,p_lease_token uuid,p_reason text) returns text language plpgsql security definer set search_path=public as $$
declare w public.stripe_event_work;next_state text;
begin
 if p_reason is null or p_reason not in ('provider_unavailable','rate_limited','transport_unknown','processing_error') then raise exception 'Invalid Stripe retry reason' using errcode='23514';end if;
 select * into w from public.stripe_event_work where receipt_id=p_receipt_id for update;
 if not found or w.state<>'processing' or w.lease_token is distinct from p_lease_token or w.lease_expires_at<=clock_timestamp() then raise exception 'Stripe worker lease is unavailable' using errcode='42501';end if;
 next_state:=case when w.attempt_count>=5 then 'quarantined' else 'queued' end;
 update public.stripe_event_work set state=next_state,reason=case when next_state='quarantined' then 'retry_exhausted' else p_reason end,available_at=clock_timestamp()+make_interval(secs=>least(3600,30*(2^w.attempt_count)::integer)),lease_token=null,lease_expires_at=null,updated_at=clock_timestamp() where receipt_id=w.receipt_id;
 insert into public.stripe_event_work_history(receipt_id,action,attempt_count,reason) values(w.receipt_id,case when next_state='quarantined' then 'exhausted' else 'retry' end,w.attempt_count,p_reason);
 return next_state;
end $$;
create function public.read_stripe_event_queue(p_limit integer default 100) returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
 perform public.clinical_require_staff();
 return coalesce((select jsonb_agg(item order by created_at desc,id) from (select r.id,r.created_at,to_jsonb(r)||jsonb_build_object('work_state',w.state,'attempt_count',w.attempt_count,'work_reason',w.reason,'available_at',w.available_at) item from public.stripe_event_receipts r join public.stripe_event_work w on w.receipt_id=r.id order by r.created_at desc,r.id limit greatest(1,least(coalesce(p_limit,100),250))) selected),'[]'::jsonb);
end $$;
do $$declare f record;begin
 for f in select oid::regprocedure signature,proname from pg_proc where pronamespace='public'::regnamespace and proname in ('receive_stripe_event','claim_stripe_event','finish_stripe_event','retry_stripe_event','read_stripe_event_queue') loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
 if f.proname='read_stripe_event_queue' then execute format('grant execute on function %s to authenticated',f.signature);
 else execute format('grant execute on function %s to service_role',f.signature);end if;
 end loop;
end $$;
