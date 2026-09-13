-- Matching known provider objects only. No staff-supplied paid flag or absence proof.
create table public.payment_reconciliation_cases (
 id uuid primary key,invoice_id uuid not null references public.billing_invoices(id),actor_id uuid not null references auth.users(id),
 family text not null check(family in ('checkout','refund')),request_id uuid not null,provider_object_id text not null,
 blocker_refs jsonb not null check(jsonb_typeof(blocker_refs)='array'),snapshot_hash text not null check(snapshot_hash ~ '^[a-f0-9]{64}$'),created_at timestamptz not null default now()
);
create table public.payment_reconciliation_captures (
 case_id uuid primary key references public.payment_reconciliation_cases(id),evidence jsonb not null,
 proof_hash text not null check(proof_hash ~ '^[a-f0-9]{64}$'),provider_observed_at timestamptz not null,created_at timestamptz not null default clock_timestamp()
);
create table public.payment_reconciliation_resolutions (
 case_id uuid primary key references public.payment_reconciliation_cases(id),actor_id uuid not null references auth.users(id),
 proof_hash text not null,ledger_evidence_id uuid not null,created_at timestamptz not null default clock_timestamp()
);
create table public.payment_reconciliation_resolved_blockers (
 kind text not null check(kind in ('observation','checkout_evidence','refund_evidence')),blocker_id uuid not null,
 case_id uuid not null references public.payment_reconciliation_resolutions(case_id),primary key(kind,blocker_id)
);
create index reconciliation_cases_invoice_idx on public.payment_reconciliation_cases(invoice_id,created_at);
create index reconciliation_targets_case_idx on public.payment_reconciliation_resolved_blockers(case_id);
do $$declare t text;begin
 foreach t in array array['payment_reconciliation_cases','payment_reconciliation_captures','payment_reconciliation_resolutions','payment_reconciliation_resolved_blockers'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
 execute format('create trigger financial_history_immutable before update or delete on public.%I for each row execute function public.payment_immutable()',t);
 end loop;
end $$;
create function public.payment_require_admin() returns uuid language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff();begin
 if not public.has_role(actor,'ADMIN') then raise exception 'Active payment administrator required' using errcode='42501';end if;return actor;
end $$;
create function public.payment_blocker_is_open(p_kind text,p_id uuid) returns boolean language sql stable security definer set search_path=public as $$
 select not exists(select 1 from public.payment_reconciliation_resolved_blockers where kind=p_kind and blocker_id=p_id)
$$;
create function public.payment_invoice_has_observations(p_invoice_id uuid) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.payment_reconciliation_observations where invoice_id=p_invoice_id and public.payment_blocker_is_open('observation',id))
$$;
create function public.payment_reconciliation_hash_internal(p_invoice_id uuid) returns text language sql stable security definer set search_path=public,extensions as $$
 select encode(digest(jsonb_build_object(
 'invoice',public.payment_source_hash_internal(i.id,i.client_id),
 'checkout',coalesce((select jsonb_agg(to_jsonb(a) order by a.id) from public.invoice_checkout_attempts a where a.invoice_id=i.id),'[]'::jsonb),
 'checkout_evidence',coalesce((select jsonb_agg(to_jsonb(e) order by e.id) from public.invoice_payment_evidence e join public.invoice_checkout_attempts a on a.id=e.request_id where a.invoice_id=i.id),'[]'::jsonb),
 'refund',coalesce((select jsonb_agg(to_jsonb(r) order by r.id) from public.invoice_refund_requests r where r.invoice_id=i.id),'[]'::jsonb),
 'refund_evidence',coalesce((select jsonb_agg(to_jsonb(e) order by e.id) from public.invoice_refund_evidence e join public.invoice_refund_requests r on r.id=e.request_id where r.invoice_id=i.id),'[]'::jsonb),
 'observations',coalesce((select jsonb_agg(to_jsonb(o)||jsonb_build_object('open',public.payment_blocker_is_open('observation',o.id)) order by o.id) from public.payment_reconciliation_observations o where o.invoice_id=i.id),'[]'::jsonb),
 'resolutions',coalesce((select jsonb_agg(to_jsonb(r) order by r.case_id) from public.payment_reconciliation_resolutions r join public.payment_reconciliation_cases c on c.id=r.case_id where c.invoice_id=i.id),'[]'::jsonb)
 )::text,'sha256'),'hex') from public.billing_invoices i where i.id=p_invoice_id
$$;
create function public.payment_reconciliation_target_internal(p_invoice_id uuid,p_family text,p_request_id uuid,p_object_id text) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare context jsonb;known text;refs jsonb;
begin
 if exists(select 1 from public.payment_reconciliation_observations where invoice_id=p_invoice_id and family=p_family and request_id=p_request_id and reason='provider_context_mismatch' and public.payment_blocker_is_open('observation',id)) then raise exception 'Conflicting provider observation requires separate review' using errcode='23514';end if;
 if p_family='checkout' then
 context:=public.provider_checkout_context(p_request_id);known:=context->>'session_id';
 if exists(select 1 from public.invoice_payment_evidence where request_id=p_request_id and disposition='quarantined' and reason<>'provider_reconciliation_required' and public.payment_blocker_is_open('checkout_evidence',id)) then raise exception 'Conflicting financial evidence requires separate review' using errcode='23514';end if;
 elsif p_family='refund' then
 context:=public.provider_refund_context(p_request_id);known:=context->>'refund_id';
 if exists(select 1 from public.invoice_refund_evidence where request_id=p_request_id and disposition='quarantined' and public.payment_blocker_is_open('refund_evidence',id)) or
 (exists(select 1 from public.invoice_refund_evidence where request_id=p_request_id and disposition='accepted' and status='failed') and not exists(select 1 from public.invoice_refunds where request_id=p_request_id)) then raise exception 'Conflicting or released refund requires separate review' using errcode='23514';end if;
 else raise exception 'Unsupported reconciliation family' using errcode='23514';end if;
 if context->>'invoice_id' is distinct from p_invoice_id::text or known is null or known is distinct from p_object_id then raise exception 'Known matching provider object required' using errcode='23514';end if;
 select coalesce(jsonb_agg(ref order by ref->>'kind',ref->>'id'),'[]'::jsonb) into refs from (
 select jsonb_build_object('kind','observation','id',id) ref from public.payment_reconciliation_observations where invoice_id=p_invoice_id and family=p_family and request_id=p_request_id and reason in ('provider_object_unavailable','provider_reconciliation_required') and public.payment_blocker_is_open('observation',id)
 union all select jsonb_build_object('kind','checkout_evidence','id',id) from public.invoice_payment_evidence where p_family='checkout' and request_id=p_request_id and disposition='quarantined' and reason='provider_reconciliation_required' and public.payment_blocker_is_open('checkout_evidence',id)
 ) targets;
 return jsonb_build_object('context',context,'blocker_refs',refs,'snapshot_hash',public.payment_reconciliation_hash_internal(p_invoice_id));
end $$;
create function public.preview_payment_reconciliation(p_invoice_id uuid,p_family text,p_request_id uuid,p_provider_object_id text) returns jsonb language plpgsql stable security definer set search_path=public as $$
begin perform public.payment_require_admin();return public.payment_reconciliation_target_internal(p_invoice_id,p_family,p_request_id,p_provider_object_id);end $$;
create function public.read_payment_reconciliation(p_case_id uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
begin perform public.payment_require_admin();return (select jsonb_build_object('case',to_jsonb(c),'capture',(select to_jsonb(p) from public.payment_reconciliation_captures p where p.case_id=c.id),'resolution',(select to_jsonb(r) from public.payment_reconciliation_resolutions r where r.case_id=c.id)) from public.payment_reconciliation_cases c where c.id=p_case_id);end $$;
create function public.prepare_payment_reconciliation(p_case_id uuid,p_invoice_id uuid,p_family text,p_request_id uuid,p_provider_object_id text,p_blocker_refs jsonb,p_expected_case_hash text) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.payment_require_admin();c public.payment_reconciliation_cases;target jsonb;refs jsonb;
begin
 if jsonb_typeof(p_blocker_refs) is distinct from 'array' or jsonb_array_length(p_blocker_refs) not between 1 and 100 then raise exception 'Explicit bounded blocker review required' using errcode='23514';end if;
 if exists(select 1 from jsonb_array_elements(p_blocker_refs) r where jsonb_typeof(r)<>'object' or (select count(*) from jsonb_object_keys(r))<>2 or not r ?& array['kind','id'] or r->>'kind' not in ('observation','checkout_evidence','refund_evidence') or r->>'id' !~ '^[a-f0-9-]{36}$') then raise exception 'Invalid blocker references' using errcode='23514';end if;
 select jsonb_agg(r order by r->>'kind',r->>'id') into refs from jsonb_array_elements(p_blocker_refs) r;
 if (select count(distinct r) from jsonb_array_elements(refs) r)<>jsonb_array_length(refs) then raise exception 'Duplicate blocker reference' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_case_id::text,3500));
 select * into c from public.payment_reconciliation_cases where id=p_case_id;
 if found then
 if row(c.actor_id,c.invoice_id,c.family,c.request_id,c.provider_object_id,c.blocker_refs,c.snapshot_hash) is distinct from row(actor,p_invoice_id,p_family,p_request_id,p_provider_object_id,refs,p_expected_case_hash) then raise exception 'Reconciliation review identifier already used' using errcode='23514';end if;return public.read_payment_reconciliation(c.id);end if;
 perform 1 from public.billing_invoices where id=p_invoice_id for update;
 if not found then raise exception 'Invoice unavailable' using errcode='42501';end if;
 target:=public.payment_reconciliation_target_internal(p_invoice_id,p_family,p_request_id,p_provider_object_id);
 if p_expected_case_hash is distinct from target->>'snapshot_hash' then raise exception 'Reconciliation facts changed' using errcode='40001';end if;
 if exists(select 1 from jsonb_array_elements(refs) r where not (target->'blocker_refs') @> jsonb_build_array(r)) then raise exception 'Blocker is not eligible for this review' using errcode='23514';end if;
 insert into public.payment_reconciliation_cases(id,invoice_id,actor_id,family,request_id,provider_object_id,blocker_refs,snapshot_hash) values(p_case_id,p_invoice_id,actor,p_family,p_request_id,p_provider_object_id,refs,p_expected_case_hash);
 return public.read_payment_reconciliation(p_case_id);
end $$;
create function public.capture_payment_reconciliation(p_case_id uuid,p_reviewer_id uuid,p_provider_evidence jsonb) returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare c public.payment_reconciliation_cases;p public.payment_reconciliation_captures;context jsonb;observed timestamptz;proof text;
begin
 select * into c from public.payment_reconciliation_cases where id=p_case_id and actor_id=p_reviewer_id for update;
 if not found or not public.is_active_staff(p_reviewer_id) or not public.has_role(p_reviewer_id,'ADMIN') then raise exception 'Reconciliation capture unavailable' using errcode='42501';end if;
 select * into p from public.payment_reconciliation_captures where case_id=c.id;
 if found then if p.evidence is distinct from p_provider_evidence then raise exception 'Captured proof is immutable; prepare another review' using errcode='23514';end if;return to_jsonb(p);end if;
 perform 1 from public.billing_invoices where id=c.invoice_id for update;
 if c.snapshot_hash is distinct from public.payment_reconciliation_hash_internal(c.invoice_id) then raise exception 'Reconciliation facts changed' using errcode='40001';end if;
 context:=public.payment_reconciliation_target_internal(c.invoice_id,c.family,c.request_id,c.provider_object_id)->'context';
 if jsonb_typeof(p_provider_evidence) is distinct from 'object' or octet_length(p_provider_evidence::text)>4096 then raise exception 'Invalid verified proof' using errcode='23514';end if;
 if exists(select 1 from unnest(array['family','request_id','object_id','account_id','amount_cents','currency','provider_observed_at','status']) k where jsonb_typeof(p_provider_evidence->k) is distinct from 'string') or jsonb_typeof(p_provider_evidence->'livemode') is distinct from 'boolean' then raise exception 'Invalid verified proof types' using errcode='23514';end if;
 if row(p_provider_evidence->>'family',p_provider_evidence->>'request_id',p_provider_evidence->>'object_id',p_provider_evidence->>'account_id',p_provider_evidence->'livemode',p_provider_evidence->>'amount_cents',p_provider_evidence->>'currency') is distinct from row(c.family,c.request_id::text,c.provider_object_id,context->>'account_id',context->'livemode',context->>'amount_cents',context->>'currency') then raise exception 'Provider proof does not match immutable request' using errcode='23514';end if;
 observed:=(p_provider_evidence->>'provider_observed_at')::timestamptz;
 if not isfinite(observed) or observed>clock_timestamp() or observed<clock_timestamp()-interval '5 minutes' then raise exception 'Fresh provider proof required' using errcode='23514';end if;
 if c.family='checkout' then
 if (select count(*) from jsonb_object_keys(p_provider_evidence))<>11 or exists(select 1 from jsonb_object_keys(p_provider_evidence) k where k not in ('family','request_id','object_id','account_id','livemode','amount_cents','currency','provider_observed_at','status','payment_id','source_hash')) or p_provider_evidence->>'source_hash' is distinct from context->>'source_hash' or p_provider_evidence->>'status' not in ('session_open','session_expired','payment_succeeded') or jsonb_typeof(p_provider_evidence->'payment_id') not in ('null','string') then raise exception 'Invalid matching Checkout proof' using errcode='23514';end if;
 if (p_provider_evidence->>'status'='session_open' and exists(select 1 from public.invoice_payment_evidence where request_id=c.request_id and disposition='accepted' and kind='session_expired')) or
 (p_provider_evidence->>'status'<>'payment_succeeded' and exists(select 1 from public.invoice_payments where request_id=c.request_id)) then raise exception 'Provider proof conflicts with terminal financial evidence' using errcode='23514';end if;
 if p_provider_evidence->>'status'='payment_succeeded' and coalesce(p_provider_evidence->>'payment_id','') !~ '^pi_[A-Za-z0-9]+$' then raise exception 'Verified payment identifier required' using errcode='23514';end if;
 else
 if (select count(*) from jsonb_object_keys(p_provider_evidence))<>10 or exists(select 1 from jsonb_object_keys(p_provider_evidence) k where k not in ('family','request_id','object_id','account_id','livemode','amount_cents','currency','provider_observed_at','status','provider_payment_id')) or p_provider_evidence->>'provider_payment_id' is distinct from context->>'provider_payment_id' or p_provider_evidence->>'status' not in ('pending','failed','succeeded') then raise exception 'Invalid matching refund proof' using errcode='23514';end if;
 if p_provider_evidence->>'status'<>'succeeded' and exists(select 1 from public.invoice_refunds where request_id=c.request_id) then raise exception 'Provider proof conflicts with terminal financial evidence' using errcode='23514';end if;
 end if;
 proof:=encode(digest(jsonb_build_object('case_id',c.id,'snapshot_hash',c.snapshot_hash,'blockers',c.blocker_refs,'evidence',p_provider_evidence)::text,'sha256'),'hex');
 insert into public.payment_reconciliation_captures(case_id,evidence,proof_hash,provider_observed_at) values(c.id,p_provider_evidence,proof,observed) returning * into p;
 return to_jsonb(p);
end $$;
create function public.complete_payment_reconciliation(p_case_id uuid,p_reviewed_proof_hash text,p_expected_case_hash text,p_attest boolean) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.payment_require_admin();c public.payment_reconciliation_cases;p public.payment_reconciliation_captures;r public.payment_reconciliation_resolutions;e jsonb;applied_id uuid;disposition text;target jsonb;
begin
 select * into c from public.payment_reconciliation_cases where id=p_case_id and actor_id=actor for update;
 if not found then raise exception 'Reconciliation review unavailable' using errcode='42501';end if;
 select * into p from public.payment_reconciliation_captures where case_id=c.id;
 if not found or p_attest is distinct from true or p.proof_hash is distinct from p_reviewed_proof_hash or c.snapshot_hash is distinct from p_expected_case_hash then raise exception 'Exact captured review required' using errcode='23514';end if;
 select * into r from public.payment_reconciliation_resolutions where case_id=c.id;
 if found then return public.read_payment_reconciliation(c.id);end if;
 perform 1 from public.billing_invoices where id=c.invoice_id for update;
 if c.snapshot_hash is distinct from public.payment_reconciliation_hash_internal(c.invoice_id) then raise exception 'Reconciliation facts changed' using errcode='40001';end if;
 if p.provider_observed_at<clock_timestamp()-interval '5 minutes' then raise exception 'Provider proof expired; prepare another review' using errcode='23514';end if;
 target:=public.payment_reconciliation_target_internal(c.invoice_id,c.family,c.request_id,c.provider_object_id);
 if exists(select 1 from jsonb_array_elements(c.blocker_refs) ref where not (target->'blocker_refs') @> jsonb_build_array(ref)) then raise exception 'Reconciliation blockers changed' using errcode='40001';end if;
 e:=p.evidence;
 if c.family='checkout' then
 select x.id,x.disposition into applied_id,disposition from public.apply_checkout_evidence('reconcile:'||c.id,c.request_id,e->>'account_id',(e->>'livemode')::boolean,e->>'status',e->>'object_id',e->>'payment_id',(e->>'amount_cents')::bigint,e->>'currency',e->>'source_hash') x;
 else
 select x.id,x.disposition into applied_id,disposition from public.apply_refund_evidence('reconcile:'||c.id,c.request_id,e->>'account_id',(e->>'livemode')::boolean,e->>'object_id',e->>'provider_payment_id',(e->>'amount_cents')::bigint,e->>'currency',e->>'status') x;
 end if;
 if disposition is distinct from 'accepted' then raise exception 'Financial evidence still requires separate review' using errcode='23514';end if;
 insert into public.payment_reconciliation_resolutions(case_id,actor_id,proof_hash,ledger_evidence_id) values(c.id,actor,p.proof_hash,applied_id);
 insert into public.payment_reconciliation_resolved_blockers(kind,blocker_id,case_id) select ref->>'kind',(ref->>'id')::uuid,c.id from jsonb_array_elements(c.blocker_refs) ref;
 return public.read_payment_reconciliation(c.id);
end $$;

-- Resolved history remains immutable. A recurrence is a new unresolved occurrence.
do $$declare c record;begin for c in select conname from pg_constraint where conrelid='public.payment_reconciliation_observations'::regclass and contype='u' loop execute format('alter table public.payment_reconciliation_observations drop constraint %I',c.conname);end loop;end $$;
create or replace function public.record_payment_reconciliation(p_family text,p_request_id uuid,p_reason text) returns public.payment_reconciliation_observations language plpgsql security definer set search_path=public as $$
declare invoice uuid;result public.payment_reconciliation_observations;
begin
 if p_family is null or p_family not in ('checkout','refund') or p_reason is null or p_reason not in ('provider_context_mismatch','provider_object_unavailable','provider_reconciliation_required') then raise exception 'Invalid payment reconciliation observation' using errcode='23514';end if;
 if p_family='checkout' then select invoice_id into invoice from public.invoice_checkout_attempts where id=p_request_id;else select invoice_id into invoice from public.invoice_refund_requests where id=p_request_id;end if;
 if invoice is null then raise exception 'Payment request unavailable' using errcode='42501';end if;
 perform 1 from public.billing_invoices where id=invoice for update;
 select * into result from public.payment_reconciliation_observations where family=p_family and request_id=p_request_id and reason=p_reason and public.payment_blocker_is_open('observation',id) order by created_at,id limit 1;
 if found then return result;end if;
 insert into public.payment_reconciliation_observations(family,request_id,invoice_id,reason) values(p_family,p_request_id,invoice,p_reason) returning * into result;return result;
end $$;
-- Update the live function definitions without editing prior migration files.
do $$declare signature text;definition text;original text;required text;begin
 foreach signature in array array['public.checkout_state_internal(uuid)','public.refund_state_internal(uuid)','public.guard_payment_reconciliation()','public.inspect_payment_collection(uuid,text,text,text)','public.read_invoice_payment_state(uuid,uuid)'] loop
 select pg_get_functiondef(signature::regprocedure) into definition;
 original:=definition;
 required:=case signature
 when 'public.checkout_state_internal(uuid)' then 'where family=''checkout'' and request_id=p_request_id)'
 when 'public.refund_state_internal(uuid)' then 'where family=''refund'' and request_id=p_request_id)'
 when 'public.guard_payment_reconciliation()' then 'exists(select 1 from public.payment_reconciliation_observations where invoice_id=invoice)'
 when 'public.inspect_payment_collection(uuid,text,text,text)' then 'exists(select 1 from public.payment_reconciliation_observations where invoice_id=g.invoice_id)'
 else 'jsonb_agg(to_jsonb(o) order by o.created_at,o.id)' end;
 if strpos(definition,required)=0 or (signature in ('public.checkout_state_internal(uuid)','public.refund_state_internal(uuid)') and strpos(definition,'and disposition=''quarantined'')')=0) then raise exception 'Reconciliation migration expected definition pattern missing: %',signature;end if;
 definition:=replace(definition,'where family=''checkout'' and request_id=p_request_id)','where family=''checkout'' and request_id=p_request_id and public.payment_blocker_is_open(''observation'',id))');
 definition:=replace(definition,'where family=''refund'' and request_id=p_request_id)','where family=''refund'' and request_id=p_request_id and public.payment_blocker_is_open(''observation'',id))');
 if signature='public.checkout_state_internal(uuid)' then definition:=replace(definition,'and disposition=''quarantined'')','and disposition=''quarantined'' and public.payment_blocker_is_open(''checkout_evidence'',id))');end if;
 if signature='public.refund_state_internal(uuid)' then definition:=replace(definition,'and disposition=''quarantined'')','and disposition=''quarantined'' and public.payment_blocker_is_open(''refund_evidence'',id))');end if;
 definition:=replace(definition,'exists(select 1 from public.payment_reconciliation_observations where invoice_id=invoice)','public.payment_invoice_has_observations(invoice)');
 definition:=replace(definition,'exists(select 1 from public.payment_reconciliation_observations where invoice_id=g.invoice_id)','public.payment_invoice_has_observations(g.invoice_id)');
 definition:=replace(definition,'jsonb_agg(to_jsonb(o) order by o.created_at,o.id)','jsonb_agg(to_jsonb(o)||jsonb_build_object(''resolved'',not public.payment_blocker_is_open(''observation'',o.id)) order by o.created_at,o.id)');
 if definition=original then raise exception 'Reconciliation migration expected definition pattern missing: %',signature;end if;
 execute definition;
 end loop;
end $$;
do $$declare f record;begin
 for f in select oid::regprocedure signature,proname from pg_proc where pronamespace='public'::regnamespace and proname in ('payment_require_admin','payment_blocker_is_open','payment_invoice_has_observations','payment_reconciliation_hash_internal','payment_reconciliation_target_internal','preview_payment_reconciliation','read_payment_reconciliation','prepare_payment_reconciliation','capture_payment_reconciliation','complete_payment_reconciliation') loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
 if f.proname in ('preview_payment_reconciliation','read_payment_reconciliation','prepare_payment_reconciliation','complete_payment_reconciliation') then execute format('grant execute on function %s to authenticated',f.signature);end if;
 if f.proname='capture_payment_reconciliation' then execute format('grant execute on function %s to service_role',f.signature);end if;
 end loop;
end $$;
