select pg_temp.cr_identity();
select controlled_review_v3.required();
do $cr_fixture$
declare refused boolean; actual_code text; actual_message text; returned jsonb; case_input jsonb; expected_value jsonb; expected_text text; item record;
begin
if exists(select 1 from pg_locks where pid=pg_backend_pid()and locktype='advisory')then raise exception 'record_fixture_baseline_advisory_locks';end if;
if(select array_agg(relname::text order by relname::text collate "C")from pg_class where relnamespace=pg_my_temp_schema()and relkind='r')is distinct from array['cr_baseline','cr_cases','cr_context','cr_guard_immutable_guard','cr_guard_refuse_insert','cr_guard_terminal_check','cr_proof','cr_render','cr_render_proof']::text[] or(select array_agg(proname::text order by proname::text collate "C")from pg_proc where pronamespace=pg_my_temp_schema())is distinct from array['cr_conserved','cr_identity','cr_session','cr_temp_structure','v3_gate_catalog','v3_gate_rows']::text[] then raise exception 'record_fixture_temp_scaffolding_inventory';end if;

end
$cr_fixture$;
insert into pg_temp.cr_baseline select jsonb_build_object('catalog',pg_temp.v3_gate_catalog(),'rows',pg_temp.v3_gate_rows(),
 'types',(select coalesce(jsonb_object_agg(n.nspname||'.'||t.typname,jsonb_build_object('attributes',to_jsonb(t),
  'enum',(select coalesce(jsonb_agg(to_jsonb(e)order by e.enumsortorder),'[]')from pg_enum e where e.enumtypid=t.oid),
  'constraints',(select coalesce(jsonb_agg(to_jsonb(c)order by c.conname),'[]')from pg_constraint c where c.contypid=t.oid))),'{}')from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname in ('public','auth','storage','extensions','supabase_migrations','controlled_review','controlled_review_cli_fixture','controlled_review_v3')),
 'ledger',(select jsonb_agg(to_jsonb(m)order by version)from supabase_migrations.schema_migrations m),
 'parent',public.controlled_stock_manifest_snapshot(),
 'parent_literal',(select jsonb_agg(to_jsonb(m))from public.controlled_stock_engine_manifests m),
 'parent_literal_hash_valid',(select count(*)=1 and bool_and(revision=1 and definition_hash=public.controlled_stock_hash(definition))from public.controlled_stock_engine_manifests),
 'private206',controlled_review.snapshot(),'private206_literal',(select jsonb_agg(to_jsonb(d))from controlled_review.descriptor d),'writers',(select jsonb_object_agg(signature,encode(sha256(convert_to(pg_get_functiondef(to_regprocedure(signature)),'UTF8')),'hex'))from public.stock_writer_manifests)),pg_temp.cr_session(),controlled_review_v3.snapshot(),pg_temp.cr_temp_structure();
select pg_temp.cr_conserved();
