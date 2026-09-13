-- Checkout requests and provider receipts are immutable. Only provider evidence releases a collection lock.
create table public.payment_provider_profiles (
 singleton boolean not null default true unique check(singleton),
 account_id text not null check(account_id ~ '^acct_[A-Za-z0-9]+$'), livemode boolean not null,
 return_origin text not null check(return_origin ~ '^https://[a-z0-9.-]+(:[0-9]+)?$'),
 created_at timestamptz not null default now(), primary key(account_id,livemode)
);
create table public.invoice_checkout_attempts (
 id uuid primary key, invoice_id uuid not null references public.billing_invoices(id), client_id uuid not null references public.clients(id),
 actor_id uuid not null references auth.users(id), source_hash text not null check(source_hash ~ '^[a-f0-9]{64}$'),
 amount_cents bigint not null check(amount_cents between 50 and 99999999), currency text not null default 'usd' check(currency='usd'),
 account_id text not null check(account_id ~ '^acct_[A-Za-z0-9]+$'), livemode boolean not null,
 success_url text not null check(length(success_url)<=2000 and success_url ~ '^https://[^[:space:]]+$'),
 cancel_url text not null check(length(cancel_url)<=2000 and cancel_url ~ '^https://[^[:space:]]+$'),
 idempotency_key text not null unique, created_at timestamptz not null default now(),
 retry_before timestamptz not null default now()+interval '23 hours',
 session_expires_at timestamptz not null default now()+interval '2 hours'
);
create table public.invoice_payment_evidence (
 id uuid primary key default gen_random_uuid(), event_id text not null check(length(event_id) between 1 and 200),
 request_id uuid not null references public.invoice_checkout_attempts(id),
 account_id text not null check(length(account_id) between 1 and 200), livemode boolean not null,
 kind text not null check(kind in ('session_open','session_expired','payment_succeeded','reconciliation')),
 session_id text, payment_id text, amount_cents bigint, currency text, source_hash text,
 disposition text not null check(disposition in ('accepted','quarantined')), reason text not null,
 created_at timestamptz not null default now(), unique(account_id,livemode,event_id)
);
create table public.invoice_payments (
 id uuid primary key default gen_random_uuid(), request_id uuid not null references public.invoice_checkout_attempts(id),
 evidence_id uuid not null unique references public.invoice_payment_evidence(id), invoice_id uuid not null references public.billing_invoices(id),
 account_id text not null, livemode boolean not null, payment_id text not null,
 amount_cents bigint not null check(amount_cents>0), currency text not null check(currency='usd'), created_at timestamptz not null default now(),
 unique(account_id,livemode,payment_id)
);
create table public.invoice_refund_requests (
 id uuid primary key, invoice_id uuid not null references public.billing_invoices(id), payment_id uuid not null references public.invoice_payments(id),
 actor_id uuid not null references auth.users(id), amount_cents bigint not null check(amount_cents>0), reason text not null check(length(trim(reason)) between 1 and 2000),
 idempotency_key text not null unique, created_at timestamptz not null default now(), retry_before timestamptz not null default now()+interval '23 hours'
);
create table public.invoice_refund_evidence (
 id uuid primary key default gen_random_uuid(), request_id uuid not null references public.invoice_refund_requests(id),
 event_id text not null check(length(event_id) between 1 and 200), account_id text not null, livemode boolean not null,
 refund_id text not null check(length(refund_id) between 1 and 200), provider_payment_id text not null,
 amount_cents bigint not null, currency text not null, status text not null check(status in ('pending','failed','succeeded')),
 disposition text not null check(disposition in ('accepted','quarantined')), reason text not null,
 created_at timestamptz not null default now(), unique(account_id,livemode,event_id)
);
create table public.invoice_refunds (
 id uuid primary key default gen_random_uuid(), request_id uuid not null unique references public.invoice_refund_requests(id),
 evidence_id uuid not null unique references public.invoice_refund_evidence(id), invoice_id uuid not null references public.billing_invoices(id),
 payment_id uuid not null references public.invoice_payments(id), account_id text not null, livemode boolean not null,
 refund_id text not null, amount_cents bigint not null check(amount_cents>0), created_at timestamptz not null default now(), unique(account_id,livemode,refund_id)
);
create index checkout_invoice_idx on public.invoice_checkout_attempts(invoice_id);
create index checkout_evidence_request_idx on public.invoice_payment_evidence(request_id);
create index payment_invoice_idx on public.invoice_payments(invoice_id);
create index refund_request_invoice_idx on public.invoice_refund_requests(invoice_id);
create index refund_evidence_request_idx on public.invoice_refund_evidence(request_id);
create index refund_invoice_idx on public.invoice_refunds(invoice_id);
create function public.payment_immutable() returns trigger language plpgsql as $$
begin raise exception 'Financial history is append-only' using errcode='23514'; end $$;
do $$declare t text;begin
 foreach t in array array['payment_provider_profiles','invoice_checkout_attempts','invoice_payment_evidence','invoice_payments','invoice_refund_requests','invoice_refund_evidence','invoice_refunds'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('create policy "Active staff read" on public.%I for select to authenticated using(public.is_active_staff(auth.uid()))',t);
 execute format('create trigger financial_history_immutable before update or delete on public.%I for each row execute function public.payment_immutable()',t);
 end loop;
end $$;

create function public.configure_payment_provider(p_account_id text,p_livemode boolean,p_return_origin text) returns public.payment_provider_profiles language plpgsql security definer set search_path=public as $$
declare result public.payment_provider_profiles;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_account_id||':'||p_livemode::text,3006));
 select * into result from public.payment_provider_profiles where account_id=p_account_id and livemode=p_livemode;
 if found then
 if result.return_origin is distinct from p_return_origin then raise exception 'Payment provider profile already configured' using errcode='23514';end if;return result;end if;
 insert into public.payment_provider_profiles(account_id,livemode,return_origin) values(p_account_id,p_livemode,p_return_origin) returning * into result;return result;
end $$;

create function public.checkout_state_internal(p_request_id uuid) returns text language sql stable security definer set search_path=public as $$
 select case
 when exists(select 1 from public.invoice_payment_evidence where request_id=p_request_id and disposition='quarantined') then 'reconciliation'
 when exists(select 1 from public.invoice_payments where request_id=p_request_id) then 'paid'
 when exists(select 1 from public.invoice_payment_evidence where request_id=p_request_id and disposition='accepted' and kind='session_expired') then 'expired'
 when exists(select 1 from public.invoice_payment_evidence where request_id=p_request_id and disposition='accepted' and kind='session_open') then 'open'
 else 'prepared' end
$$;
create function public.refund_state_internal(p_request_id uuid) returns text language sql stable security definer set search_path=public as $$
 select case
 when exists(select 1 from public.invoice_refund_evidence where request_id=p_request_id and disposition='quarantined') then 'reconciliation'
 when exists(select 1 from public.invoice_refunds where request_id=p_request_id) then 'succeeded'
 when exists(select 1 from public.invoice_refund_evidence where request_id=p_request_id and disposition='accepted' and status='failed') then 'failed'
 else 'pending' end
$$;
create function public.payment_balance_internal(p_invoice_id uuid) returns jsonb language sql stable security definer set search_path=public as $$
 with amounts as (
 select i.total_cents-coalesce((select sum(amount_cents) from public.billing_credits where invoice_id=i.id),0) obligation,
 coalesce((select sum(amount_cents) from public.invoice_payments where invoice_id=i.id),0) paid,
 coalesce((select sum(amount_cents) from public.invoice_refunds where invoice_id=i.id),0) refunded,
 coalesce((select sum(amount_cents) from public.invoice_refund_requests where invoice_id=i.id and public.refund_state_internal(id) in ('pending','reconciliation')),0) reserved
 from public.billing_invoices i where i.id=p_invoice_id)
 select jsonb_build_object('obligation_cents',obligation::text,'paid_cents',paid::text,'refunded_cents',refunded::text,
 'net_cash_cents',(paid-refunded)::text,'outstanding_cents',greatest(0,obligation-paid+refunded)::text,
 'pending_refund_cents',reserved::text,'refundable_cents',greatest(0,paid-refunded-obligation-reserved)::text) from amounts
$$;
create function public.payment_source_hash_internal(p_invoice_id uuid,p_client_id uuid) returns text language sql stable security definer set search_path=public,extensions as $$
 select encode(digest(jsonb_build_object('document',public.invoice_document_internal(p_invoice_id,p_client_id)-'rendered_at','balance',public.payment_balance_internal(p_invoice_id))::text,'sha256'),'hex')
$$;
create function public.read_invoice_payment_state(p_invoice_id uuid,p_client_id uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
 perform public.clinical_require_staff();
 perform public.invoice_document_internal(p_invoice_id,p_client_id);
 return jsonb_build_object('invoice_id',p_invoice_id,'client_id',p_client_id,'source_hash',public.payment_source_hash_internal(p_invoice_id,p_client_id),
 'balance',public.payment_balance_internal(p_invoice_id),
 'attempts',coalesce((select jsonb_agg(to_jsonb(a)||jsonb_build_object('amount_cents',a.amount_cents::text,'state',public.checkout_state_internal(a.id)) order by a.created_at,a.id) from public.invoice_checkout_attempts a where a.invoice_id=p_invoice_id),'[]'::jsonb),
 'payments',coalesce((select jsonb_agg(to_jsonb(p)||jsonb_build_object('amount_cents',p.amount_cents::text) order by p.created_at,p.id) from public.invoice_payments p where p.invoice_id=p_invoice_id),'[]'::jsonb),
 'refund_requests',coalesce((select jsonb_agg(to_jsonb(r)||jsonb_build_object('amount_cents',r.amount_cents::text,'state',public.refund_state_internal(r.id)) order by r.created_at,r.id) from public.invoice_refund_requests r where r.invoice_id=p_invoice_id),'[]'::jsonb),
 'evidence',coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at,e.id) from public.invoice_payment_evidence e join public.invoice_checkout_attempts a on a.id=e.request_id where a.invoice_id=p_invoice_id),'[]'::jsonb),
 'refund_evidence',coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at,e.id) from public.invoice_refund_evidence e join public.invoice_refund_requests r on r.id=e.request_id where r.invoice_id=p_invoice_id),'[]'::jsonb));
end $$;
create function public.prepare_invoice_checkout(p_request_id uuid,p_invoice_id uuid,p_client_id uuid,p_source_hash text,p_amount_cents bigint,p_account_id text,p_livemode boolean,p_success_url text,p_cancel_url text)
returns public.invoice_checkout_attempts language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff(); a public.invoice_checkout_attempts; i public.billing_invoices;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,3000));
 select * into a from public.invoice_checkout_attempts where id=p_request_id;
 if found then
 if row(a.actor_id,a.invoice_id,a.client_id,a.source_hash,a.amount_cents,a.account_id,a.livemode,a.success_url,a.cancel_url) is distinct from row(actor,p_invoice_id,p_client_id,p_source_hash,p_amount_cents,p_account_id,p_livemode,p_success_url,p_cancel_url) then raise exception 'Checkout identifier already used' using errcode='23514';end if;
 return a;end if;
 if not exists(select 1 from public.payment_provider_profiles where account_id=p_account_id and livemode=p_livemode and p_success_url=return_origin||'/payment/return' and p_cancel_url=return_origin||'/payment/cancel') then raise exception 'Payment provider or return destination not configured' using errcode='23514';end if;
 select * into i from public.billing_invoices where id=p_invoice_id and client_id=p_client_id for update;
 if not found or i.status<>'issued' then raise exception 'Issued invoice required' using errcode='23514';end if;
 if exists(select 1 from public.invoice_checkout_attempts where invoice_id=i.id and public.checkout_state_internal(id) not in ('paid','expired')) then raise exception 'Resolve existing checkout first' using errcode='23514';end if;
 if exists(select 1 from public.invoice_refund_requests where invoice_id=i.id and public.refund_state_internal(id) in ('pending','reconciliation')) then raise exception 'Resolve existing refund first' using errcode='23514';end if;
 if p_source_hash is distinct from public.payment_source_hash_internal(i.id,i.client_id) or p_amount_cents is distinct from (public.payment_balance_internal(i.id)->>'outstanding_cents')::bigint then raise exception 'Invoice payment balance changed' using errcode='40001';end if;
 insert into public.invoice_checkout_attempts(id,invoice_id,client_id,actor_id,source_hash,amount_cents,account_id,livemode,success_url,cancel_url,idempotency_key)
 values(p_request_id,i.id,i.client_id,actor,p_source_hash,p_amount_cents,p_account_id,p_livemode,p_success_url,p_cancel_url,'lrv-checkout-'||p_request_id) returning * into a;
 return a;
end $$;
create function public.provider_checkout_context(p_request_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare a public.invoice_checkout_attempts;
begin
 select * into a from public.invoice_checkout_attempts where id=p_request_id;
 if not found then raise exception 'Checkout unavailable' using errcode='42501';end if;
 return to_jsonb(a)||jsonb_build_object('amount_cents',a.amount_cents::text,'state',public.checkout_state_internal(a.id),
 'current_source_matches',a.source_hash=public.payment_source_hash_internal(a.invoice_id,a.client_id),
 'session_id',(select session_id from public.invoice_payment_evidence where request_id=a.id and disposition='accepted' and session_id is not null order by created_at,id limit 1),
 'payment_id',(select payment_id from public.invoice_payments where request_id=a.id order by created_at,id limit 1));
end $$;
create function public.checkout_payment_context(p_request_id uuid,p_actor_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
begin
 if not public.is_active_staff(p_actor_id) or not exists(select 1 from public.invoice_checkout_attempts where id=p_request_id and actor_id=p_actor_id) then raise exception 'Checkout unavailable' using errcode='42501';end if;
 return public.provider_checkout_context(p_request_id);
end $$;
create function public.apply_checkout_evidence(p_event_id text,p_request_id uuid,p_account_id text,p_livemode boolean,p_kind text,p_session_id text,p_payment_id text,p_amount_cents bigint,p_currency text,p_source_hash text)
returns public.invoice_payment_evidence language plpgsql security definer set search_path=public as $$
declare a public.invoice_checkout_attempts; e public.invoice_payment_evidence; reason text:=''; prior_session text; paid public.invoice_payments;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_account_id||':'||p_livemode::text||':'||p_event_id,3001));
 select * into e from public.invoice_payment_evidence where account_id=p_account_id and livemode=p_livemode and event_id=p_event_id;
 if found then
 if row(e.request_id,e.kind,e.session_id,e.payment_id,e.amount_cents,e.currency,e.source_hash) is distinct from row(p_request_id,p_kind,p_session_id,p_payment_id,p_amount_cents,p_currency,p_source_hash) then raise exception 'Provider event identifier already used' using errcode='23514';end if;
 return e;end if;
 select * into strict a from public.invoice_checkout_attempts where id=p_request_id;
 perform 1 from public.billing_invoices where id=a.invoice_id for update;
 -- Serialize the same provider payment across invoices as well as events.
 if p_payment_id is not null then perform pg_advisory_xact_lock(hashtextextended(p_account_id||':'||p_livemode::text||':'||p_payment_id,3002));end if;
 select session_id into prior_session from public.invoice_payment_evidence where request_id=a.id and disposition='accepted' and session_id is not null limit 1;
 if row(p_account_id,p_livemode,p_amount_cents,p_currency,p_source_hash) is distinct from row(a.account_id,a.livemode,a.amount_cents,a.currency,a.source_hash) then reason:='provider_context_mismatch';
 elsif p_session_id is null or p_session_id !~ '^cs_[A-Za-z0-9_]+$' then reason:='invalid_session';
 elsif prior_session is not null and prior_session<>p_session_id then reason:='session_mismatch';
 elsif p_kind='reconciliation' then reason:='provider_reconciliation_required';
 elsif p_kind='payment_succeeded' and (p_payment_id is null or p_payment_id !~ '^pi_[A-Za-z0-9]+$') then reason:='invalid_payment';
 elsif p_kind='payment_succeeded' and exists(select 1 from public.invoice_payments where request_id=a.id and payment_id<>p_payment_id) then reason:='multiple_payments_for_checkout';
 elsif p_kind='payment_succeeded' and exists(select 1 from public.invoice_payments where account_id=p_account_id and livemode=p_livemode and payment_id=p_payment_id and request_id<>a.id) then reason:='payment_already_attributed';
 elsif p_kind='payment_succeeded' and not exists(select 1 from public.invoice_payments where request_id=a.id) and a.source_hash is distinct from public.payment_source_hash_internal(a.invoice_id,a.client_id) then reason:='invoice_source_changed';
 end if;
 insert into public.invoice_payment_evidence(event_id,request_id,account_id,livemode,kind,session_id,payment_id,amount_cents,currency,source_hash,disposition,reason)
 values(p_event_id,a.id,p_account_id,p_livemode,p_kind,p_session_id,p_payment_id,p_amount_cents,p_currency,p_source_hash,case when reason='' then 'accepted' else 'quarantined' end,reason) returning * into e;
 if reason='' and p_kind='payment_succeeded' then
 insert into public.invoice_payments(request_id,evidence_id,invoice_id,account_id,livemode,payment_id,amount_cents,currency)
 values(a.id,e.id,a.invoice_id,a.account_id,a.livemode,p_payment_id,a.amount_cents,a.currency) on conflict(account_id,livemode,payment_id) do nothing;
 end if;
 return e;
end $$;

create function public.prepare_invoice_refund(p_request_id uuid,p_invoice_id uuid,p_payment_id uuid,p_amount_cents bigint,p_reason text)
returns public.invoice_refund_requests language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff(); r public.invoice_refund_requests; p public.invoice_payments; remaining bigint;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,3003));
 select * into r from public.invoice_refund_requests where id=p_request_id;
 if found then
 if row(r.actor_id,r.invoice_id,r.payment_id,r.amount_cents,r.reason) is distinct from row(actor,p_invoice_id,p_payment_id,p_amount_cents,p_reason) then raise exception 'Refund identifier already used' using errcode='23514';end if;return r;end if;
 perform 1 from public.billing_invoices where id=p_invoice_id and status='issued' for update;
 if not found then raise exception 'Issued invoice required' using errcode='23514';end if;
 if exists(select 1 from public.invoice_checkout_attempts where invoice_id=p_invoice_id and public.checkout_state_internal(id) not in ('paid','expired')) then raise exception 'Resolve existing checkout first' using errcode='23514';end if;
 select * into p from public.invoice_payments where id=p_payment_id and invoice_id=p_invoice_id;
 if not found then raise exception 'Captured payment required' using errcode='23514';end if;
 remaining:=p.amount_cents-coalesce((select sum(amount_cents) from public.invoice_refund_requests where payment_id=p.id and public.refund_state_internal(id)<>'failed'),0);
 if p_amount_cents is null or p_amount_cents<=0 or p_amount_cents>remaining or p_amount_cents>(public.payment_balance_internal(p_invoice_id)->>'refundable_cents')::bigint then raise exception 'Refund exceeds credited or unreserved cash' using errcode='23514';end if;
 insert into public.invoice_refund_requests(id,invoice_id,payment_id,actor_id,amount_cents,reason,idempotency_key)
 values(p_request_id,p_invoice_id,p_payment_id,actor,p_amount_cents,p_reason,'lrv-refund-'||p_request_id) returning * into r;return r;
end $$;
create function public.provider_refund_context(p_request_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.invoice_refund_requests;p public.invoice_payments;
begin
 select * into r from public.invoice_refund_requests where id=p_request_id;
 if not found then raise exception 'Refund unavailable' using errcode='42501';end if;
 select * into strict p from public.invoice_payments where id=r.payment_id;
 return to_jsonb(r)||jsonb_build_object('amount_cents',r.amount_cents::text,'state',public.refund_state_internal(r.id),'provider_payment_id',p.payment_id,'account_id',p.account_id,'livemode',p.livemode,'currency',p.currency,
 'refund_id',(select refund_id from public.invoice_refund_evidence where request_id=r.id and disposition='accepted' order by created_at,id limit 1));
end $$;
create function public.refund_payment_context(p_request_id uuid,p_actor_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
begin
 if not public.is_active_staff(p_actor_id) or not exists(select 1 from public.invoice_refund_requests where id=p_request_id and actor_id=p_actor_id) then raise exception 'Refund unavailable' using errcode='42501';end if;
 return public.provider_refund_context(p_request_id);
end $$;
create function public.apply_refund_evidence(p_event_id text,p_request_id uuid,p_account_id text,p_livemode boolean,p_refund_id text,p_provider_payment_id text,p_amount_cents bigint,p_currency text,p_status text)
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
 elsif p_status='succeeded' and public.refund_state_internal(r.id)='failed' then reason:='success_after_terminal_failure';
 end if;
 insert into public.invoice_refund_evidence(request_id,event_id,account_id,livemode,refund_id,provider_payment_id,amount_cents,currency,status,disposition,reason)
 values(r.id,p_event_id,p_account_id,p_livemode,p_refund_id,p_provider_payment_id,p_amount_cents,p_currency,p_status,case when reason='' then 'accepted' else 'quarantined' end,reason) returning * into e;
 if reason='' and p_status='succeeded' then
 insert into public.invoice_refunds(request_id,evidence_id,invoice_id,payment_id,account_id,livemode,refund_id,amount_cents)
 values(r.id,e.id,r.invoice_id,p.id,p.account_id,p.livemode,p_refund_id,r.amount_cents) on conflict(request_id) do nothing;
 end if;return e;
end $$;

-- Guards apply to the existing RPCs and any future write paths, using the same invoice row lock.
create function public.guard_invoice_collection() returns trigger language plpgsql security definer set search_path=public as $$
declare invoice uuid;
begin
 if TG_TABLE_NAME='billing_credits' then invoice:=NEW.invoice_id;
 else
 invoice:=NEW.id;
 if NEW.status is not distinct from OLD.status or NEW.status<>'void' then return NEW;end if;
 end if;
 perform 1 from public.billing_invoices where id=invoice for update;
 if exists(select 1 from public.invoice_checkout_attempts where invoice_id=invoice and public.checkout_state_internal(id) not in ('paid','expired')) then raise exception 'Resolve existing checkout first' using errcode='23514';end if;
 if TG_TABLE_NAME='billing_invoices' and exists(select 1 from public.invoice_payments where invoice_id=invoice) then raise exception 'Invoices with payment history cannot be voided' using errcode='23514';end if;
 return NEW;
end $$;
create trigger guard_credit_collection before insert on public.billing_credits for each row execute function public.guard_invoice_collection();
create trigger guard_void_collection before update on public.billing_invoices for each row execute function public.guard_invoice_collection();

do $$declare f record;begin
 for f in select oid::regprocedure signature,proname from pg_proc where pronamespace='public'::regnamespace and proname in (
 'provider_checkout_context','provider_refund_context','configure_payment_provider','payment_immutable','checkout_state_internal','refund_state_internal','payment_balance_internal','payment_source_hash_internal','read_invoice_payment_state','prepare_invoice_checkout','checkout_payment_context','apply_checkout_evidence','prepare_invoice_refund','refund_payment_context','apply_refund_evidence','guard_invoice_collection') loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
 if f.proname in ('read_invoice_payment_state','prepare_invoice_checkout','prepare_invoice_refund') then execute format('grant execute on function %s to authenticated',f.signature);end if;
 if f.proname in ('provider_checkout_context','provider_refund_context','configure_payment_provider','checkout_payment_context','apply_checkout_evidence','refund_payment_context','apply_refund_evidence') then execute format('grant execute on function %s to service_role',f.signature);end if;
 end loop;
end $$;
