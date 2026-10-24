begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(4);

-- PostgREST (before v16.0) re-runs the whole request transaction, without limit, when
-- the server reports SQLSTATE 40001 or 40P01 (hasql-transaction inRetryingTransaction).
-- A function that raises either code for a condition that does not change on retry turns
-- one request into an infinite in-database loop (2026-09-28 production incident).
-- Permanent "changed; reload" / "not eligible" conditions use PT409 instead.
-- See docs/postgrest-retryable-sqlstates.md.

select is(
  (select string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosrc ~ '40001'),
  null,
  'No public function raises or catches SQLSTATE 40001 (PostgREST retries it forever)'
);

select is(
  (select string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosrc ~* '40P01'),
  null,
  'No public function raises or catches SQLSTATE 40P01 (PostgREST retries it forever)'
);

select is(
  (select string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prosrc ~* '(errcode\s*=\s*|raise\s+(exception\s+)?)''?(serialization_failure|deadlock_detected)'),
  null,
  'No public function raises serialization_failure / deadlock_detected by condition name'
);

select is(
  (select (public.record_outbound_delivery_callback(
      'resend', 'guard-unknown-provider-message', 'DELIVERED', 'guard', null, now())).id),
  null::uuid,
  'An unknown provider receipt is an acknowledged no-op, not an error'
);

select * from finish();
rollback;
