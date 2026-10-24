-- A malformed provider response can require review without supplying usable financial evidence.
create table public.payment_reconciliation_observations (
 id uuid primary key default gen_random_uuid(),
 family text not null check(family in ('checkout','refund')),
 request_id uuid not null,
 invoice_id uuid not null references public.billing_invoices(id),
 reason text not null check(reason in ('provider_context_mismatch','provider_object_unavailable','provider_reconciliation_required')),
 created_at timestamptz not null default now(),
 unique(family,request_id,reason)
);
create index payment_reconciliation_invoice_idx on public.payment_reconciliation_observations(invoice_id);
alter table public.payment_reconciliation_observations enable row level security;
revoke all on public.payment_reconciliation_observations from public,anon,authenticated,service_role;
grant select on public.payment_reconciliation_observations to authenticated;
create policy "Active staff read" on public.payment_reconciliation_observations for select to authenticated using(public.is_active_staff(auth.uid()));
create trigger financial_history_immutable before update or delete on public.payment_reconciliation_observations for each row execute function public.payment_immutable();

create function public.record_payment_reconciliation(p_family text,p_request_id uuid,p_reason text)
returns public.payment_reconciliation_observations language plpgsql security definer set search_path=public as $$
declare invoice uuid; result public.payment_reconciliation_observations;
begin
 if p_family is null or p_family not in ('checkout','refund') or p_reason is null or p_reason not in ('provider_context_mismatch','provider_object_unavailable','provider_reconciliation_required') then
 raise exception 'Invalid payment reconciliation observation' using errcode='23514';end if;
 if p_family='checkout' then select invoice_id into invoice from public.invoice_checkout_attempts where id=p_request_id;
 else select invoice_id into invoice from public.invoice_refund_requests where id=p_request_id;end if;
 if invoice is null then raise exception 'Payment request unavailable' using errcode='42501';end if;
 perform 1 from public.billing_invoices where id=invoice for update;
 select * into result from public.payment_reconciliation_observations where family=p_family and request_id=p_request_id and reason=p_reason;
 if found then return result;end if;
 insert into public.payment_reconciliation_observations(family,request_id,invoice_id,reason)
 values(p_family,p_request_id,invoice,p_reason) returning * into result;
 return result;
end $$;
revoke all on function public.record_payment_reconciliation(text,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.record_payment_reconciliation(text,uuid,text) to service_role;

create or replace function public.checkout_state_internal(p_request_id uuid) returns text language sql stable security definer set search_path=public as $$
 select case
 when exists(select 1 from public.payment_reconciliation_observations where family='checkout' and request_id=p_request_id) then 'reconciliation'
 when exists(select 1 from public.invoice_payment_evidence where request_id=p_request_id and disposition='quarantined') then 'reconciliation'
 when exists(select 1 from public.invoice_payments where request_id=p_request_id) then 'paid'
 when exists(select 1 from public.invoice_payment_evidence where request_id=p_request_id and disposition='accepted' and kind='session_expired') then 'expired'
 when exists(select 1 from public.invoice_payment_evidence where request_id=p_request_id and disposition='accepted' and kind='session_open') then 'open'
 else 'prepared' end
$$;
create or replace function public.refund_state_internal(p_request_id uuid) returns text language sql stable security definer set search_path=public as $$
 select case
 when exists(select 1 from public.payment_reconciliation_observations where family='refund' and request_id=p_request_id) then 'reconciliation'
 when exists(select 1 from public.invoice_refund_evidence where request_id=p_request_id and disposition='quarantined') then 'reconciliation'
 when exists(select 1 from public.invoice_refunds where request_id=p_request_id) then 'succeeded'
 when exists(select 1 from public.invoice_refund_evidence where request_id=p_request_id and disposition='accepted' and status='failed') then 'failed'
 else 'pending' end
$$;
create or replace function public.read_invoice_payment_state(p_invoice_id uuid,p_client_id uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
 perform public.clinical_require_staff();
 perform public.invoice_document_internal(p_invoice_id,p_client_id);
 return jsonb_build_object('invoice_id',p_invoice_id,'client_id',p_client_id,'source_hash',public.payment_source_hash_internal(p_invoice_id,p_client_id),
 'balance',public.payment_balance_internal(p_invoice_id),
 'reconciliation_observations',coalesce((select jsonb_agg(to_jsonb(o) order by o.created_at,o.id) from public.payment_reconciliation_observations o where o.invoice_id=p_invoice_id),'[]'::jsonb),
 'attempts',coalesce((select jsonb_agg(to_jsonb(a)||jsonb_build_object('amount_cents',a.amount_cents::text,'state',public.checkout_state_internal(a.id)) order by a.created_at,a.id) from public.invoice_checkout_attempts a where a.invoice_id=p_invoice_id),'[]'::jsonb),
 'payments',coalesce((select jsonb_agg(to_jsonb(p)||jsonb_build_object('amount_cents',p.amount_cents::text) order by p.created_at,p.id) from public.invoice_payments p where p.invoice_id=p_invoice_id),'[]'::jsonb),
 'refund_requests',coalesce((select jsonb_agg(to_jsonb(r)||jsonb_build_object('amount_cents',r.amount_cents::text,'state',public.refund_state_internal(r.id)) order by r.created_at,r.id) from public.invoice_refund_requests r where r.invoice_id=p_invoice_id),'[]'::jsonb),
 'evidence',coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at,e.id) from public.invoice_payment_evidence e join public.invoice_checkout_attempts a on a.id=e.request_id where a.invoice_id=p_invoice_id),'[]'::jsonb),
 'refund_evidence',coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at,e.id) from public.invoice_refund_evidence e join public.invoice_refund_requests r on r.id=e.request_id where r.invoice_id=p_invoice_id),'[]'::jsonb));
end $$;

-- All new money/obligation changes serialize with observation recording. Existing
-- intent retries remain readable, and provider settlement evidence may still arrive.
create function public.guard_payment_reconciliation() returns trigger language plpgsql security definer set search_path=public as $$
declare invoice uuid;
begin
 if TG_TABLE_NAME='billing_invoices' then
 if NEW.status is not distinct from OLD.status or NEW.status<>'void' then return NEW;end if;
 invoice:=NEW.id;
 else invoice:=NEW.invoice_id;end if;
 perform 1 from public.billing_invoices where id=invoice for update;
 if exists(select 1 from public.payment_reconciliation_observations where invoice_id=invoice) then
 raise exception 'Resolve payment reconciliation first' using errcode='23514';end if;
 return NEW;
end $$;
revoke all on function public.guard_payment_reconciliation() from public,anon,authenticated,service_role;
create trigger guard_payment_reconciliation before insert on public.invoice_checkout_attempts for each row execute function public.guard_payment_reconciliation();
create trigger guard_payment_reconciliation before insert on public.invoice_refund_requests for each row execute function public.guard_payment_reconciliation();
create trigger guard_payment_reconciliation before insert on public.billing_credits for each row execute function public.guard_payment_reconciliation();
create trigger guard_payment_reconciliation before update on public.billing_invoices for each row execute function public.guard_payment_reconciliation();

-- Presentation reconciliation must not hide a terminal failure that released refund capacity.
create or replace function public.apply_refund_evidence(p_event_id text,p_request_id uuid,p_account_id text,p_livemode boolean,p_refund_id text,p_provider_payment_id text,p_amount_cents bigint,p_currency text,p_status text)
returns public.invoice_refund_evidence language plpgsql security definer set search_path=public as $$
declare r public.invoice_refund_requests;p public.invoice_payments;e public.invoice_refund_evidence;reason text:='';prior_refund text;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_account_id||':'||p_livemode::text||':'||p_event_id,3004));
 select * into e from public.invoice_refund_evidence where account_id=p_account_id and livemode=p_livemode and event_id=p_event_id;
 if found then
 if row(e.request_id,e.refund_id,e.provider_payment_id,e.amount_cents,e.currency,e.status) is distinct from row(p_request_id,p_refund_id,p_provider_payment_id,p_amount_cents,p_currency,p_status) then raise exception 'Provider refund event identifier already used' using errcode='23514';end if;return e;end if;
 select * into strict r from public.invoice_refund_requests where id=p_request_id;
 perform 1 from public.billing_invoices where id=r.invoice_id for update;
 select * into strict p from public.invoice_payments where id=r.payment_id;
 perform pg_advisory_xact_lock(hashtextextended(p_account_id||':'||p_livemode::text||':'||p_refund_id,3005));
 select refund_id into prior_refund from public.invoice_refund_evidence where request_id=r.id and disposition='accepted' limit 1;
 if row(p_account_id,p_livemode,p_provider_payment_id,p_amount_cents,p_currency) is distinct from row(p.account_id,p.livemode,p.payment_id,r.amount_cents,p.currency) then reason:='provider_context_mismatch';
 elsif p_refund_id !~ '^re_[A-Za-z0-9]+$' then reason:='invalid_refund';
 elsif prior_refund is not null and prior_refund<>p_refund_id then reason:='refund_mismatch';
 elsif exists(select 1 from public.invoice_refunds where account_id=p_account_id and livemode=p_livemode and refund_id=p_refund_id and request_id<>r.id) then reason:='refund_already_attributed';
 elsif p_status='succeeded'
 and exists(select 1 from public.invoice_refund_evidence where request_id=r.id and disposition='accepted' and status='failed')
 and not exists(select 1 from public.invoice_refunds where request_id=r.id)
 then reason:='success_after_terminal_failure';
 end if;
 insert into public.invoice_refund_evidence(request_id,event_id,account_id,livemode,refund_id,provider_payment_id,amount_cents,currency,status,disposition,reason)
 values(r.id,p_event_id,p_account_id,p_livemode,p_refund_id,p_provider_payment_id,p_amount_cents,p_currency,p_status,case when reason='' then 'accepted' else 'quarantined' end,reason) returning * into e;
 if reason='' and p_status='succeeded' then
 insert into public.invoice_refunds(request_id,evidence_id,invoice_id,payment_id,account_id,livemode,refund_id,amount_cents)
 values(r.id,e.id,r.invoice_id,p.id,p.account_id,p.livemode,p_refund_id,r.amount_cents) on conflict(request_id) do nothing;
 end if;return e;
end $$;


-- Settled refunds are cash history, not a second pending reservation even during review.
create or replace function public.payment_balance_internal(p_invoice_id uuid) returns jsonb language sql stable security definer set search_path=public as $$
 with amounts as (
 select i.total_cents-coalesce((select sum(amount_cents) from public.billing_credits where invoice_id=i.id),0) obligation,
 coalesce((select sum(amount_cents) from public.invoice_payments where invoice_id=i.id),0) paid,
 coalesce((select sum(amount_cents) from public.invoice_refunds where invoice_id=i.id),0) refunded,
 coalesce((select sum(amount_cents) from public.invoice_refund_requests where invoice_id=i.id and public.refund_state_internal(id) in ('pending','reconciliation')
 and not exists(select 1 from public.invoice_refunds settled where settled.request_id=invoice_refund_requests.id)),0) reserved
 from public.billing_invoices i where i.id=p_invoice_id)
 select jsonb_build_object('obligation_cents',obligation::text,'paid_cents',paid::text,'refunded_cents',refunded::text,
 'net_cash_cents',(paid-refunded)::text,'outstanding_cents',greatest(0,obligation-paid+refunded)::text,
 'pending_refund_cents',reserved::text,'refundable_cents',greatest(0,paid-refunded-obligation-reserved)::text) from amounts
$$;
