-- A reviewed seven-day authorization is distinct from its shorter provider sessions.
create table public.payment_collection_grants (
 id uuid primary key, invoice_id uuid not null references public.billing_invoices(id),
 client_id uuid not null references public.clients(id), actor_id uuid not null references auth.users(id),
 source_hash text not null check(source_hash ~ '^[a-f0-9]{64}$'),
 amount_cents bigint not null check(amount_cents between 50 and 99999999), currency text not null default 'usd' check(currency='usd'),
 expires_at timestamptz not null check(isfinite(expires_at)),
 status_expires_at timestamptz not null check(isfinite(status_expires_at)),
 created_at timestamptz not null default now(), check(status_expires_at=expires_at+interval '30 days')
);
create table public.payment_collection_captures (
 grant_id uuid primary key references public.payment_collection_grants(id),
 origin text not null check(origin ~ '^https://[a-z0-9.-]+(:[0-9]+)?$'),
 key_version text not null check(key_version ~ '^[A-Za-z0-9_-]{1,40}$'),
 context_version integer not null default 2 check(context_version=2),
 capability_context text not null, context_hash text not null check(context_hash ~ '^[a-f0-9]{64}$'),
 collection_token_hash text not null check(collection_token_hash ~ '^[a-f0-9]{64}$'),
 status_token_hash text not null check(status_token_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz not null default now(), check(collection_token_hash<>status_token_hash)
);
create table public.payment_collection_events (
 id uuid primary key default gen_random_uuid(),grant_id uuid not null references public.payment_collection_grants(id),
 actor_id uuid not null references auth.users(id),kind text not null check(kind in ('reviewed','revoked')),
 context_hash text,reason text,created_at timestamptz not null default now(),
 check((kind='reviewed' and context_hash ~ '^[a-f0-9]{64}$' and reason is null) or (kind='revoked' and context_hash is null and length(trim(reason)) between 1 and 1000)),
 unique(grant_id,kind)
);
create table public.payment_collection_attempts (
 grant_id uuid not null references public.payment_collection_grants(id),
 request_id uuid primary key references public.invoice_checkout_attempts(id),
 created_at timestamptz not null default now()
);
create index payment_collection_source_idx on public.payment_collection_grants(actor_id,invoice_id,created_at);
create index payment_collection_attempt_grant_idx on public.payment_collection_attempts(grant_id);
alter table public.invoice_checkout_attempts add column return_context_version integer not null default 1 check(return_context_version in (1,2)),
 add column return_key_version text, add column return_origin text,
 add column return_scope_id uuid references public.payment_collection_grants(id);
alter table public.invoice_checkout_attempts add constraint checkout_return_context_shape check(
 (return_context_version=1 and return_key_version is null and return_origin is null and return_scope_id is null) or
 (return_context_version=2 and return_scope_id is not null and return_key_version is not null and return_origin is not null and return_key_version ~ '^[A-Za-z0-9_-]{1,40}$' and return_origin ~ '^https://[a-z0-9.-]+(:[0-9]+)?$'));
do $$declare t text;begin
 foreach t in array array['payment_collection_grants','payment_collection_captures','payment_collection_events','payment_collection_attempts'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
 execute format('create trigger financial_history_immutable before update or delete on public.%I for each row execute function public.payment_immutable()',t);
 end loop;
end $$;

create function public.payment_collection_state_internal(p_id uuid) returns text language sql stable security definer set search_path=public as $$
 select case when exists(select 1 from public.payment_collection_events where grant_id=p_id and kind='revoked') then 'revoked'
 when exists(select 1 from public.payment_collection_events where grant_id=p_id and kind='reviewed') then 'reviewed'
 when exists(select 1 from public.payment_collection_captures where grant_id=p_id) then 'captured' else 'preparing' end
$$;
create function public.payment_collection_read_internal(p_id uuid) returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('grant',to_jsonb(g)||jsonb_build_object('amount_cents',g.amount_cents::text,'state',public.payment_collection_state_internal(g.id),'origin',(select origin from public.payment_collection_captures where grant_id=g.id),'key_version',(select key_version from public.payment_collection_captures where grant_id=g.id)),
 'capture',(select to_jsonb(c)-array['collection_token_hash','status_token_hash'] from public.payment_collection_captures c where grant_id=g.id),
 'events',coalesce((select jsonb_agg(to_jsonb(e) order by created_at,id) from public.payment_collection_events e where grant_id=g.id),'[]'::jsonb),
 'attempts',coalesce((select jsonb_agg(jsonb_build_object('request_id',a.request_id,'state',public.checkout_state_internal(a.request_id),'created_at',a.created_at) order by a.created_at,a.request_id) from public.payment_collection_attempts a where grant_id=g.id),'[]'::jsonb),'receipt',null)
 from public.payment_collection_grants g where id=p_id
$$;
create function public.recover_payment_collection(p_invoice_id uuid,p_request_id uuid default null) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff(); id uuid;
begin
 select g.id into id from public.payment_collection_grants g where actor_id=actor and invoice_id=p_invoice_id and (p_request_id is null or g.id=p_request_id) order by created_at desc,g.id limit 1;
 return public.payment_collection_read_internal(id);
end $$;
create function public.list_payment_collections(p_invoice_id uuid,p_client_id uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff();
begin
 perform public.invoice_document_internal(p_invoice_id,p_client_id);
 return coalesce((select jsonb_agg(public.payment_collection_read_internal(g.id) order by created_at desc,g.id) from public.payment_collection_grants g where invoice_id=p_invoice_id and client_id=p_client_id and actor_id=actor),'[]'::jsonb);
end $$;
create function public.prepare_payment_collection(p_request_id uuid,p_invoice_id uuid,p_client_id uuid,p_source_hash text,p_amount_cents bigint,p_expires_at timestamptz) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff();g public.payment_collection_grants;i public.billing_invoices;
begin
 perform pg_advisory_xact_lock(hashtextextended('payment-collection:'||p_request_id::text,3400));
 select * into g from public.payment_collection_grants where id=p_request_id;
 if found then
 if row(g.actor_id,g.invoice_id,g.client_id,g.source_hash,g.amount_cents,g.expires_at) is distinct from row(actor,p_invoice_id,p_client_id,p_source_hash,p_amount_cents,p_expires_at) then raise exception 'Immutable payment collection intent differs' using errcode='23505';end if;
 return public.payment_collection_read_internal(g.id);end if;
 if p_expires_at is null or not isfinite(p_expires_at) or p_expires_at<=clock_timestamp() or p_expires_at>clock_timestamp()+interval '7 days' then raise exception 'Expiry must be within seven days' using errcode='23514';end if;
 -- Serialize preparation only for this brief transaction, never for the link lifetime.
 select * into i from public.billing_invoices where id=p_invoice_id and client_id=p_client_id for update;
 if not found or i.status<>'issued' then raise exception 'Issued invoice unavailable' using errcode='42501';end if;
 if exists(select 1 from public.payment_collection_grants where actor_id=actor and invoice_id=p_invoice_id and public.payment_collection_state_internal(id) in ('preparing','captured')) then raise exception 'Recover existing payment collection draft' using errcode='23514';end if;
 if p_source_hash is distinct from public.payment_source_hash_internal(i.id,i.client_id) or p_amount_cents is distinct from (public.payment_balance_internal(i.id)->>'outstanding_cents')::bigint then raise exception 'Invoice payment balance changed' using errcode='40001';end if;
 insert into public.payment_collection_grants(id,invoice_id,client_id,actor_id,source_hash,amount_cents,expires_at,status_expires_at)
 values(p_request_id,i.id,i.client_id,actor,p_source_hash,p_amount_cents,p_expires_at,p_expires_at+interval '30 days');
 return public.payment_collection_read_internal(p_request_id);
end $$;
create function public.payment_collection_capture_context(p_request_id uuid,p_actor_id uuid,p_origin text,p_key_version text) returns jsonb language plpgsql stable security definer set search_path=public,extensions as $$
declare g public.payment_collection_grants;c public.payment_collection_captures;context text;
begin
 select * into g from public.payment_collection_grants where id=p_request_id and actor_id=p_actor_id;
 if not found or not public.is_active_staff(p_actor_id) then raise exception 'Payment collection unavailable' using errcode='42501';end if;
 select * into c from public.payment_collection_captures where grant_id=g.id;
 if found then
 if c.origin is distinct from p_origin or c.key_version is distinct from p_key_version then raise exception 'Immutable payment capability differs' using errcode='23505';end if;
 return public.payment_collection_read_internal(g.id);end if;
 if p_origin is null or p_key_version is null or p_key_version !~ '^[A-Za-z0-9_-]{1,40}$' or not exists(select 1 from public.payment_provider_profiles where return_origin=p_origin) then raise exception 'Payment capability configuration unavailable' using errcode='42501';end if;
 context:=jsonb_build_object('domain','lrv-payment-collection/v2','grant',to_jsonb(g)||jsonb_build_object('amount_cents',g.amount_cents::text),'origin',p_origin,'key_version',p_key_version,'context_version',2)::text;
 return public.payment_collection_read_internal(g.id)||jsonb_build_object('capture',jsonb_build_object('grant_id',g.id,'origin',p_origin,'key_version',p_key_version,'context_version',2,'capability_context',context,'context_hash',encode(digest(context,'sha256'),'hex')));
end $$;
create function public.capture_payment_collection(p_request_id uuid,p_actor_id uuid,p_origin text,p_key_version text,p_collection_token_hash text,p_status_token_hash text) returns jsonb language plpgsql security definer set search_path=public as $$
declare g public.payment_collection_grants;c public.payment_collection_captures;b jsonb;
begin
 select * into g from public.payment_collection_grants where id=p_request_id and actor_id=p_actor_id for update;
 if not found or not public.is_active_staff(p_actor_id) then raise exception 'Payment collection unavailable' using errcode='42501';end if;
 b:=public.payment_collection_capture_context(g.id,p_actor_id,p_origin,p_key_version);
 select * into c from public.payment_collection_captures where grant_id=g.id;
 if found then
 if c.collection_token_hash is distinct from p_collection_token_hash or c.status_token_hash is distinct from p_status_token_hash then raise exception 'Immutable payment capability differs' using errcode='23505';end if;
 return public.payment_collection_read_internal(g.id);end if;
 if public.payment_collection_state_internal(g.id)<>'preparing' or g.expires_at<=clock_timestamp() then raise exception 'Payment collection unavailable' using errcode='42501';end if;
 insert into public.payment_collection_captures(grant_id,origin,key_version,capability_context,context_hash,collection_token_hash,status_token_hash)
 values(g.id,p_origin,p_key_version,b#>>'{capture,capability_context}',b#>>'{capture,context_hash}',p_collection_token_hash,p_status_token_hash);
 return public.payment_collection_read_internal(g.id);
end $$;
create function public.attest_payment_collection(p_request_id uuid,p_reviewed_context_hash text,p_attest boolean) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff();g public.payment_collection_grants;c public.payment_collection_captures;
begin
 select * into g from public.payment_collection_grants where id=p_request_id and actor_id=actor for update;
 if not found then raise exception 'Payment collection unavailable' using errcode='42501';end if;
 select * into c from public.payment_collection_captures where grant_id=g.id;
 if not found or p_attest is distinct from true or p_reviewed_context_hash is distinct from c.context_hash then raise exception 'Exact payment collection review required' using errcode='23514';end if;
 if exists(select 1 from public.payment_collection_events where grant_id=g.id and kind='reviewed') then return public.payment_collection_read_internal(g.id);end if;
 perform 1 from public.billing_invoices where id=g.invoice_id and status='issued' for update;
 if not found or public.payment_collection_state_internal(g.id)<>'captured' or g.expires_at<=clock_timestamp() or g.source_hash is distinct from public.payment_source_hash_internal(g.invoice_id,g.client_id) or g.amount_cents is distinct from (public.payment_balance_internal(g.invoice_id)->>'outstanding_cents')::bigint then raise exception 'Payment collection source changed' using errcode='42501';end if;
 insert into public.payment_collection_events(grant_id,actor_id,kind,context_hash) values(g.id,actor,'reviewed',c.context_hash);
 return public.payment_collection_read_internal(g.id);
end $$;
create function public.revoke_payment_collection(p_request_id uuid,p_reason text) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff();g public.payment_collection_grants;
begin
 select * into g from public.payment_collection_grants where id=p_request_id and actor_id=actor for update;
 if not found then raise exception 'Payment collection unavailable' using errcode='42501';end if;
 if p_reason is null or length(trim(p_reason)) not between 1 and 1000 then raise exception 'Revocation reason required' using errcode='23514';end if;
 if not exists(select 1 from public.payment_collection_events where grant_id=g.id and kind='revoked') then insert into public.payment_collection_events(grant_id,actor_id,kind,reason) values(g.id,actor,'revoked',trim(p_reason));end if;
 return public.payment_collection_read_internal(g.id);
end $$;

-- Service-only metadata permits HMAC reconstruction in Edge memory, never browser access.
create function public.payment_collection_access_context(p_grant_id uuid) returns jsonb language sql stable security definer set search_path=public as $$
 select public.payment_collection_read_internal(g.id)||jsonb_build_object('capture',to_jsonb(c)) from public.payment_collection_grants g join public.payment_collection_captures c on c.grant_id=g.id where g.id=p_grant_id
$$;
create function public.payment_collection_status_internal(p_grant_id uuid) returns jsonb language sql stable security definer set search_path=public as $$
 with cash as (select coalesce(sum(p.amount_cents),0) paid,coalesce(sum((select coalesce(sum(r.amount_cents),0) from public.invoice_refunds r where r.payment_id=p.id)),0) refunded from public.invoice_payments p join public.payment_collection_attempts a on a.request_id=p.request_id where a.grant_id=p_grant_id)
 select jsonb_build_object('amount_cents',g.amount_cents::text,'currency',g.currency,'expires_at',g.expires_at,'status_expires_at',g.status_expires_at,
 'confirmed_paid_cents',cash.paid::text,'confirmed_refunded_cents',cash.refunded::text,
 'state',case when exists(select 1 from public.payment_collection_attempts a where grant_id=g.id and public.checkout_state_internal(a.request_id)='reconciliation') then 'reconciliation'
 when cash.refunded>0 and cash.refunded<cash.paid then 'partially_refunded' when cash.refunded>0 then 'refunded' when cash.paid>=g.amount_cents then 'paid'
 when exists(select 1 from public.payment_collection_attempts a where grant_id=g.id and public.checkout_state_internal(a.request_id) in ('prepared','open')) then 'confirmation_pending' else 'ready' end)
 from public.payment_collection_grants g cross join cash where g.id=p_grant_id
$$;
create function public.read_payment_collection_status(p_grant_id uuid,p_status_token_hash text,p_origin text,p_key_version text) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare g public.payment_collection_grants;c public.payment_collection_captures;
begin
 select * into g from public.payment_collection_grants where id=p_grant_id;
 select * into c from public.payment_collection_captures where grant_id=p_grant_id;
 if g.id is null or c.grant_id is null or p_status_token_hash is null or c.status_token_hash is distinct from p_status_token_hash or c.origin is distinct from p_origin or c.key_version is distinct from p_key_version or g.status_expires_at<=clock_timestamp() or not exists(select 1 from public.payment_collection_events where grant_id=g.id and kind='reviewed') then raise exception 'Payment status unavailable' using errcode='42501';end if;
 return public.payment_collection_status_internal(g.id);
end $$;
create function public.inspect_payment_collection(p_grant_id uuid,p_collection_token_hash text,p_origin text,p_key_version text) returns jsonb language plpgsql security definer set search_path=public as $$
declare g public.payment_collection_grants;c public.payment_collection_captures;s jsonb;i public.billing_invoices;
begin
 select * into g from public.payment_collection_grants where id=p_grant_id for share;
 select * into c from public.payment_collection_captures where grant_id=p_grant_id;
 if g.id is null or c.grant_id is null or p_collection_token_hash is null or c.collection_token_hash is distinct from p_collection_token_hash or c.origin is distinct from p_origin or c.key_version is distinct from p_key_version or g.expires_at<=clock_timestamp() or not public.is_active_staff(g.actor_id) or public.payment_collection_state_internal(g.id)<>'reviewed' then raise exception 'Payment collection unavailable' using errcode='42501';end if;
 s:=public.payment_collection_status_internal(g.id);
 if s->>'state' in ('paid','partially_refunded','refunded','reconciliation') then return s;end if;
 if exists(select 1 from public.payment_reconciliation_observations where invoice_id=g.invoice_id) or exists(select 1 from public.invoice_refund_requests where invoice_id=g.invoice_id and public.refund_state_internal(id) in ('pending','reconciliation')) then raise exception 'Payment collection requires reconciliation' using errcode='42501';end if;
 select * into i from public.billing_invoices where id=g.invoice_id and client_id=g.client_id for share;
 if not found or i.status<>'issued' or g.source_hash is distinct from public.payment_source_hash_internal(g.invoice_id,g.client_id) or g.amount_cents is distinct from (public.payment_balance_internal(g.invoice_id)->>'outstanding_cents')::bigint then raise exception 'Payment collection source changed' using errcode='42501';end if;
 return s;
end $$;
create function public.activate_payment_collection(p_grant_id uuid,p_collection_token_hash text,p_origin text,p_key_version text,p_allow_create boolean default false) returns jsonb language plpgsql security definer set search_path=public as $$
declare g public.payment_collection_grants;c public.payment_collection_captures;a public.invoice_checkout_attempts;s jsonb;profile public.payment_provider_profiles;new_request_id uuid;
begin
 select * into g from public.payment_collection_grants where id=p_grant_id for update;
 if not found then raise exception 'Payment collection unavailable' using errcode='42501';end if;
 perform 1 from public.billing_invoices where id=g.invoice_id for update;
 s:=public.inspect_payment_collection(p_grant_id,p_collection_token_hash,p_origin,p_key_version);
 if s->>'state' in ('paid','partially_refunded','refunded','reconciliation') then return jsonb_build_object('state',s->>'state','status',s,'attempt',null);end if;
 select ca.* into a from public.invoice_checkout_attempts ca join public.payment_collection_attempts link on link.request_id=ca.id where link.grant_id=g.id order by (public.checkout_state_internal(ca.id)<>'expired') desc,ca.created_at desc,ca.id desc limit 1;
 if found and public.checkout_state_internal(a.id)<>'expired' then return jsonb_build_object('state',public.checkout_state_internal(a.id),'status',s,'attempt',public.provider_checkout_context(a.id),'grant_id',g.id);end if;
 if p_allow_create is distinct from true then raise exception 'Payment collection creation paused' using errcode='42501';end if;
 -- A local deadline cannot release this guard: expiry comes only from accepted evidence.
 if exists(select 1 from public.invoice_checkout_attempts where invoice_id=g.invoice_id and public.checkout_state_internal(id) not in ('paid','expired')) then raise exception 'Resolve existing checkout first' using errcode='23514';end if;
 if exists(select 1 from public.invoice_refund_requests where invoice_id=g.invoice_id and public.refund_state_internal(id) in ('pending','reconciliation')) then raise exception 'Resolve existing refund first' using errcode='23514';end if;
 select * into strict c from public.payment_collection_captures where grant_id=g.id;
 select * into profile from public.payment_provider_profiles where return_origin=c.origin;
 if not found then raise exception 'Payment provider unavailable' using errcode='42501';end if;
 if g.expires_at<clock_timestamp()+interval '31 minutes' then raise exception 'Payment collection deadline too close' using errcode='42501';end if;
 new_request_id:=gen_random_uuid();
 insert into public.invoice_checkout_attempts(id,invoice_id,client_id,actor_id,source_hash,amount_cents,account_id,livemode,success_url,cancel_url,idempotency_key,return_context_version,return_key_version,return_origin,return_scope_id,session_expires_at)
 values(new_request_id,g.invoice_id,g.client_id,g.actor_id,g.source_hash,g.amount_cents,profile.account_id,profile.livemode,
 c.origin||'/payment/return/'||g.id||'#{{payment_status}}',c.origin||'/payment/cancel/'||g.id||'#{{payment_status}}','lrv-checkout-'||new_request_id,2,c.key_version,c.origin,g.id,least(now()+interval '2 hours',g.expires_at));
 insert into public.payment_collection_attempts(grant_id,request_id) values(g.id,new_request_id);
 return jsonb_build_object('state','prepared','status',s,'attempt',public.provider_checkout_context(new_request_id),'grant_id',g.id);
end $$;

do $$declare f record;begin
 for f in select oid::regprocedure signature,proname from pg_proc where pronamespace='public'::regnamespace and proname in (
 'payment_collection_state_internal','payment_collection_read_internal','recover_payment_collection','list_payment_collections','prepare_payment_collection','payment_collection_capture_context','capture_payment_collection','attest_payment_collection','revoke_payment_collection','payment_collection_access_context','payment_collection_status_internal','read_payment_collection_status','inspect_payment_collection','activate_payment_collection') loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
 if f.proname in ('recover_payment_collection','list_payment_collections','prepare_payment_collection','attest_payment_collection','revoke_payment_collection') then execute format('grant execute on function %s to authenticated',f.signature);end if;
 if f.proname in ('payment_collection_capture_context','capture_payment_collection','payment_collection_access_context','read_payment_collection_status','inspect_payment_collection','activate_payment_collection') then execute format('grant execute on function %s to service_role',f.signature);end if;
 end loop;
end $$;
