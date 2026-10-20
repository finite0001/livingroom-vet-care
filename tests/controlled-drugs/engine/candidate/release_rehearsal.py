"""Callback-only atomic release rehearsal for an empty, caller-owned local replay.

This module has no CLI, network or subprocess entry point. The caller supplies
ownership-checked SQL callbacks, each using a fresh backend. Private snapshots
stay in memory; only fixed labels, hashes, counts and booleans leave as proof.
"""
import hashlib
import json
import re

SCHEMAS = ('public', 'auth', 'storage', 'extensions')
MARKERS = {
    'preflight': '-- CONTROLLED_RELEASE_BEFORE_PREFLIGHT --',
    'after_schema': '-- CONTROLLED_RELEASE_AFTER_SCHEMA --',
    'after_hooks': '-- CONTROLLED_RELEASE_AFTER_HOOKS --',
    'before_postcheck': '-- CONTROLLED_RELEASE_BEFORE_POSTCHECK --',
    'before_commit': '-- CONTROLLED_RELEASE_BEFORE_COMMIT --',
}
DRIFT_MESSAGE = 'Controlled upgrade prior definitions or grants drifted; review required'
INJECTED_MESSAGE = 'Synthetic controlled release injected failure'
MUTATIONS = {
    'helper_definition': ("alter function public.stock_writer_current()set statement_timeout='200ms';", DRIFT_MESSAGE),
    'private_helper_grant': ('grant execute on function public.stock_writer_current()to authenticated;', DRIFT_MESSAGE),
    'private_relation_rls': ('alter table public.stock_writer_admissions disable row level security;', DRIFT_MESSAGE),
    'immutable_trigger': ('alter table public.stock_movement_sources disable trigger immutable;', DRIFT_MESSAGE),
    'partial_engine': ('create table public.controlled_stock_release_partial_fixture(id integer);', 'Controlled release partial engine exists'),
    'migration_ledger': ('delete from supabase_migrations.schema_migrations where version=(select max(version)from supabase_migrations.schema_migrations);', 'Controlled release migration ledger mismatch'),
}
POST_MUTATIONS = {
    'post_helper_definition': ("alter function public.controlled_stock_hash(jsonb)set statement_timeout='200ms';", 'Controlled release installed metadata differs from reviewed artifact'),
    'post_helper_grant': ('grant execute on function public.controlled_stock_hash(jsonb)to authenticated;', 'Controlled release installed metadata differs from reviewed artifact'),
    'post_relation_rls': ('alter table public.controlled_stock_events disable row level security;', 'Controlled release installed metadata differs from reviewed artifact'),
    'post_immutable_trigger': ('alter table public.controlled_stock_events disable trigger immutable;', 'Controlled release installed metadata differs from reviewed artifact'),
    'post_column_grant': ('grant select(id)on public.controlled_stock_events to authenticated;', 'Controlled release private access or RLS changed'),
}
PHASES = ('after_schema', 'after_hooks', 'before_commit')
CASE_ORDER = (*MUTATIONS, *PHASES, *POST_MUTATIONS)
HEX = re.compile(r'[0-9a-f]{64}')


def _unique(pairs):
    result = {}
    for key, value in pairs:
        assert key not in result, 'Duplicate release observation field'
        result[key] = value
    return result


def _json(output):
    assert isinstance(output, str), 'Text release observation required'
    lines = [line for line in output.splitlines() if line.strip()]
    assert len(lines) == 1, 'Exactly one release snapshot required'
    value = json.loads(lines[0], object_pairs_hook=_unique)
    assert isinstance(value, dict), 'Object release observation required'
    return value


def _digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def _snapshot_sql(prior_sql, include_prior=True):
    assert isinstance(prior_sql, str)
    assert not include_prior or 'pg_temp.controlled_stock_prior_snapshot' in prior_sql
    query = "set timezone='UTC';\n" + prior_sql + r"""
create function pg_temp.controlled_release_rows()returns jsonb language plpgsql volatile as $$
declare r record;v jsonb;result jsonb:='{}';begin
 for r in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname in('public','auth','storage','extensions')and c.relkind in('r','p')order by n.nspname,c.relname loop
 execute format('select jsonb_build_object(''count'',count(*),''hash'',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,''|''order by to_jsonb(t)::text),''''),''UTF8'')),''hex''))from %I.%I t',r.nspname,r.relname)into v;
 result:=result||jsonb_build_object(r.nspname||'.'||r.relname,v);end loop;return result;end$$;
select jsonb_build_object('relations',pg_temp.controlled_release_rows(),
 'prior',pg_temp.controlled_stock_prior_snapshot(),
 'writers',(select jsonb_object_agg(signature,encode(sha256(convert_to(pg_get_functiondef(to_regprocedure(signature)),'UTF8')),'hex'))from stock_writer_manifests),
 'ledger',(select coalesce(jsonb_agg(to_jsonb(m)order by version),'[]')from supabase_migrations.schema_migrations m),
 'engine_catalog',jsonb_build_object(
  'relations',(select coalesce(jsonb_agg(c.relname order by c.relname),'[]')from pg_class c where c.relnamespace='public'::regnamespace and left(c.relname,17)='controlled_stock_'),
  'functions',(select coalesce(jsonb_agg(p.oid::regprocedure::text order by p.oid::regprocedure::text),'[]')from pg_proc p where p.pronamespace='public'::regnamespace and(left(p.proname,17)='controlled_stock_'or p.proname in('read_controlled_stock_action','prepare_controlled_stock_action','execute_controlled_stock_action','cancel_controlled_stock_action'))),
  'triggers',(select coalesce(jsonb_agg(jsonb_build_object('relation',t.tgrelid::regclass::text,'name',t.tgname,'definition',pg_get_triggerdef(t.oid))order by t.tgrelid::regclass::text,t.tgname),'[]')from pg_trigger t where not t.tgisinternal and(t.tgname='controlled_guard'or left(t.tgname,17)='controlled_stock_'))));
"""
    if not include_prior:
        query = query.replace('pg_temp.controlled_stock_prior_snapshot()', 'null')
    return query


def _validate_snapshot(value, allow_missing_prior=False):
    assert set(value) == {'relations', 'prior', 'writers', 'ledger', 'engine_catalog'}
    assert isinstance(value['relations'], dict) and value['relations']
    assert {name.split('.', 1)[0] for name in value['relations']} <= set(SCHEMAS)
    assert any(name.startswith('public.') for name in value['relations'])
    for name, item in value['relations'].items():
        assert isinstance(name, str) and isinstance(item, dict) and set(item) == {'count', 'hash'}
        assert type(item['count']) is int and item['count'] >= 0
        assert isinstance(item['hash'], str) and HEX.fullmatch(item['hash'])
    assert isinstance(value['prior'], dict) or (allow_missing_prior and value['prior'] is None)
    assert isinstance(value['writers'], dict) and len(value['writers']) == 10
    assert all(isinstance(k, str) and isinstance(v, str) and HEX.fullmatch(v) for k, v in value['writers'].items())
    assert isinstance(value['ledger'], list) and len(value['ledger']) == 204
    assert all(isinstance(row, dict) for row in value['ledger'])
    assert isinstance(value['engine_catalog'], dict) and set(value['engine_catalog']) == {'relations', 'functions', 'triggers'}
    assert all(isinstance(items, list) for items in value['engine_catalog'].values())
    return value


def capture_baseline(sql, prior_sql, trusted):
    """Return a PRIVATE empty-replay snapshot before any deliberate mutation."""
    assert callable(sql) and isinstance(trusted, dict) and isinstance(trusted.get('definition'), dict)
    value = _validate_snapshot(_json(sql(_snapshot_sql(prior_sql))))
    assert value['prior'] == trusted['definition'], 'Untouched release prior metadata differs'
    assert all(not items for items in value['engine_catalog'].values()), 'Release rehearsal requires an empty engine catalog'
    assert not any(name.startswith('public.controlled_stock_') for name in value['relations'])
    assert value['relations'].get('auth.users', {}).get('count') == 0, 'Release rehearsal requires empty synthetic Auth'
    return value


def _armed(label):
    assert label in CASE_ORDER
    return "do $$begin raise notice 'Controlled release rehearsal armed: " + label + "';end$$;\n"


def _check_failure(result, label, state, message):
    assert type(result.returncode) is int and result.returncode != 0, 'Release refusal must fail its backend'
    assert isinstance(result.stdout, str) and isinstance(result.stderr, str)
    assert re.search(r'(?:^|\n)NOTICE:\s+(?:00000: )?Controlled release rehearsal armed: ' + re.escape(label) + r'\s*(?:\n|$)', result.stderr), 'Release refusal did not reach its armed stage'
    # Match the actual VERBOSITY verbose ERROR line, not SQL echoed in CONTEXT.
    assert re.search(r'(?:^|\n)ERROR:\s+' + re.escape(state) + ': ' + re.escape(message) + r'\s*(?:\n|$)', result.stderr), 'Exact release SQLSTATE/message required'


def rehearse_failures(sql, raw_sql, artifact, prior_sql, trusted, baseline):
    """Fourteen fresh-backend failures; every source/catalog must survive."""
    assert callable(sql) and callable(raw_sql) and isinstance(artifact, str)
    assert artifact.startswith('begin;\n') and artifact.rstrip().endswith('commit;'), 'Atomic release transaction required'
    _validate_snapshot(baseline)
    assert all(not items for items in baseline['engine_catalog'].values()), 'Untouched empty engine baseline required'
    assert not any(name.startswith('public.controlled_stock_') for name in baseline['relations'])
    assert baseline['prior'] == trusted['definition']
    for marker in MARKERS.values():
        assert artifact.count(marker) == 1, 'Unique release stage marker required'
    assert [artifact.index(MARKERS[key]) for key in MARKERS] == sorted(artifact.index(marker) for marker in MARKERS.values())
    outcomes = []
    for label in CASE_ORDER:
        if label in MUTATIONS or label in POST_MUTATIONS:
            cases = MUTATIONS if label in MUTATIONS else POST_MUTATIONS
            stage = 'preflight' if label in MUTATIONS else 'before_postcheck'
            mutation, message = cases[label]
            injected = mutation + '\n' + _armed(label)
            query = artifact.replace(MARKERS[stage], injected + MARKERS[stage], 1)
            state = '23514'
        else:
            stage = label
            query = artifact.replace(MARKERS[label], _armed(label) + "do $$begin raise exception '" + INJECTED_MESSAGE + "'using errcode='P0001';end$$;\n" + MARKERS[label], 1)
            state, message = 'P0001', INJECTED_MESSAGE
        result = raw_sql('\\set VERBOSITY verbose\n' + query)
        _check_failure(result, label, state, message)
        restored = _validate_snapshot(_json(sql(_snapshot_sql(prior_sql))))
        assert restored == baseline, 'Release failure did not restore exact private baseline: ' + label
        outcomes.append({'case': label, 'stage': stage, 'sqlstate': state, 'message': message, 'armed_before_failure': True,
                         'all_relations_prior_writers_ledger_and_engine_catalog_rolled_back': True})
    return validate_failure_proof({'kind': 'controlled-release-atomic-rehearsal-v1', 'passed': True,
        'failure_cases': outcomes, 'failure_count': 14, 'selected_schemas': list(SCHEMAS),
        'baseline_relation_count': len(baseline['relations']), 'baseline_sha256': _digest(baseline),
        'fresh_backend_per_callback_required': True, 'empty_engine_catalog_after_every_failure': True,
        'hosted_writes': 0, 'clinical_or_register_activation': False})


def validate_failure_proof(proof):
    assert isinstance(proof, dict)
    assert set(proof) == {'kind', 'passed', 'failure_cases', 'failure_count', 'selected_schemas', 'baseline_relation_count',
                          'baseline_sha256', 'fresh_backend_per_callback_required', 'empty_engine_catalog_after_every_failure',
                          'hosted_writes', 'clinical_or_register_activation'}
    assert proof['kind'] == 'controlled-release-atomic-rehearsal-v1' and proof['passed'] is True
    assert type(proof['failure_count']) is int and proof['failure_count'] == 14
    assert proof['selected_schemas'] == list(SCHEMAS)
    assert type(proof['baseline_relation_count']) is int and proof['baseline_relation_count'] > 0
    assert isinstance(proof['baseline_sha256'], str) and HEX.fullmatch(proof['baseline_sha256'])
    assert proof['fresh_backend_per_callback_required'] is True and proof['empty_engine_catalog_after_every_failure'] is True
    assert type(proof['hosted_writes']) is int and proof['hosted_writes'] == 0 and proof['clinical_or_register_activation'] is False
    assert isinstance(proof['failure_cases'], list) and len(proof['failure_cases']) == 14
    for outcome, label in zip(proof['failure_cases'], CASE_ORDER):
        if label in MUTATIONS or label in POST_MUTATIONS:
            cases = MUTATIONS if label in MUTATIONS else POST_MUTATIONS
            stage = 'preflight' if label in MUTATIONS else 'before_postcheck'
            expected_state, expected_message = '23514', cases[label][1]
        else:
            stage = label
            expected_state, expected_message = 'P0001', INJECTED_MESSAGE
        assert outcome == {'case': label, 'stage': stage, 'sqlstate': expected_state, 'message': expected_message,
                           'armed_before_failure': True, 'all_relations_prior_writers_ledger_and_engine_catalog_rolled_back': True}
        assert outcome['armed_before_failure'] is True and outcome['all_relations_prior_writers_ledger_and_engine_catalog_rolled_back'] is True
    return proof


def verify_installed(sql, expected_release, baseline):
    """Verify a separately successful install against the independently frozen pin.

    expected_release is the parsed release-expected-204.json, not a catalog
    recaptured from this installation. Raw snapshots never enter the return value.
    """
    assert callable(sql) and isinstance(expected_release, dict)
    _validate_snapshot(baseline)
    assert all(not items for items in baseline['engine_catalog'].values()), 'Untouched empty engine baseline required'
    assert not any(name.startswith('public.controlled_stock_') for name in baseline['relations'])
    assert expected_release.get('kind') == 'controlled-stock-release-expected-204-v1'
    assert type(expected_release.get('baseline_migration_count')) is int and expected_release['baseline_migration_count'] == 204
    expected = expected_release.get('expected_technical_manifest')
    writers = expected_release.get('canonical_writer_definition_hashes')
    assert isinstance(expected, dict) and set(expected) == {'version', 'functions', 'relations'}
    assert type(expected['version']) is int and expected['version'] == 1
    assert isinstance(expected['functions'], dict) and expected['functions']
    assert isinstance(expected['relations'], dict) and expected['relations']
    assert writers == baseline['writers'], 'Reviewed canonical writer pin differs from untouched replay'
    literal = "'" + json.dumps(expected, sort_keys=True).replace("'", "''") + "'::jsonb"
    checks = _json(sql(r"""
set timezone='UTC';
create function pg_temp.controlled_release_empty()returns boolean language plpgsql volatile as $$declare r record;n bigint;begin
 for r in select c.relname from pg_class c where c.relnamespace='public'::regnamespace and c.relkind in('r','p')and left(c.relname,17)='controlled_stock_'and c.relname<>'controlled_stock_engine_manifests'loop
 execute format('select count(*)from public.%I',r.relname)into n;if n<>0 then return false;end if;end loop;return true;end$$;
select jsonb_build_object(
 'manifest_rows',(select count(*)from controlled_stock_engine_manifests),
 'literal_manifest_matches',(select count(*)=1 and bool_and(revision=1 and definition=__EXPECTED__ and definition_hash=controlled_stock_hash(__EXPECTED__))from controlled_stock_engine_manifests),
 'live_manifest_matches',controlled_stock_manifest_snapshot()=__EXPECTED__,
 'all_ten_hooks_pinned',(select count(*)=10 and bool_and(definition_sha256=encode(sha256(convert_to(pg_get_functiondef(to_regprocedure(signature)),'UTF8')),'hex')and strpos(pg_get_functiondef(to_regprocedure(signature)),'stock_writer_enter')>0)from stock_writer_manifests),
 'raw_rpcs_private',not exists(select 1 from pg_proc p where p.pronamespace='public'::regnamespace and(left(p.proname,17)='controlled_stock_'or p.proname in('read_controlled_stock_action','prepare_controlled_stock_action','execute_controlled_stock_action','cancel_controlled_stock_action'))and(
  has_function_privilege('anon',p.oid,'execute')or has_function_privilege('authenticated',p.oid,'execute')or has_function_privilege('service_role',p.oid,'execute')or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))a where a.grantee=0 and a.privilege_type='EXECUTE'))),
 'raw_tables_private',not exists(select 1 from pg_class c where c.relnamespace='public'::regnamespace and c.relkind in('r','p')and left(c.relname,17)='controlled_stock_'and(
  not c.relrowsecurity or has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')or has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')or has_table_privilege('service_role',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')or exists(select 1 from unnest(array['anon','authenticated','service_role'])role_name where has_any_column_privilege(role_name,c.oid,'SELECT,INSERT,UPDATE,REFERENCES'))or exists(select 1 from pg_attribute col cross join lateral aclexplode(col.attacl)a where col.attrelid=c.oid and col.attnum>0 and not col.attisdropped and a.grantee<>c.relowner)or exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner)))a where a.grantee=0))),
 'zero_configuration_events_and_activation',pg_temp.controlled_release_empty());
""".replace('__EXPECTED__', literal)))
    assert set(checks) == {'manifest_rows', 'literal_manifest_matches', 'live_manifest_matches', 'all_ten_hooks_pinned',
                           'raw_rpcs_private', 'raw_tables_private', 'zero_configuration_events_and_activation'}
    assert type(checks['manifest_rows']) is int and checks['manifest_rows'] == 1
    assert all(value is True for key, value in checks.items() if key != 'manifest_rows'), 'Installed release verification failed'
    installed = _validate_snapshot(_json(sql(_snapshot_sql('', include_prior=False))), allow_missing_prior=True)
    assert installed['prior'] is None
    assert installed['writers'] == baseline['writers'], 'Install changed canonical writer definitions'
    assert installed['ledger'] == baseline['ledger'], 'Install changed canonical migration ledger'
    for name, value in baseline['relations'].items():
        assert installed['relations'].get(name) == value, 'Install changed original source relation'
    added = set(installed['relations']) - set(baseline['relations'])
    assert added and all(name.startswith('public.controlled_stock_') for name in added), 'Unexpected installed source relation'
    assert installed['engine_catalog']['relations'] and installed['engine_catalog']['functions']
    return validate_installed_proof({'kind': 'controlled-release-installed-verification-v1', 'passed': True,
        'reviewed_manifest_sha256': _digest(expected), 'canonical_writers': 10,
        'original_relation_count': len(baseline['relations']), 'new_engine_relation_count': len(added),
        'literal_manifest_matches': True, 'live_manifest_matches': True, 'all_ten_hooks_pinned': True,
        'raw_rpcs_and_tables_private': True, 'zero_configuration_events_and_activation': True,
        'original_source_relations_and_ledger_preserved': True, 'hosted_writes': 0,
        'clinical_or_register_activation': False})


def validate_installed_proof(proof):
    assert isinstance(proof, dict)
    flags = {'literal_manifest_matches', 'live_manifest_matches', 'all_ten_hooks_pinned', 'raw_rpcs_and_tables_private',
             'zero_configuration_events_and_activation', 'original_source_relations_and_ledger_preserved'}
    assert set(proof) == flags | {'kind', 'passed', 'reviewed_manifest_sha256', 'canonical_writers',
                                  'original_relation_count', 'new_engine_relation_count', 'hosted_writes', 'clinical_or_register_activation'}
    assert proof['kind'] == 'controlled-release-installed-verification-v1' and proof['passed'] is True
    assert all(proof[key] is True for key in flags)
    assert isinstance(proof['reviewed_manifest_sha256'], str) and HEX.fullmatch(proof['reviewed_manifest_sha256'])
    assert type(proof['canonical_writers']) is int and proof['canonical_writers'] == 10
    for key in ('original_relation_count', 'new_engine_relation_count'):
        assert type(proof[key]) is int and proof[key] > 0
    assert type(proof['hosted_writes']) is int and proof['hosted_writes'] == 0
    assert proof['clinical_or_register_activation'] is False
    return proof
