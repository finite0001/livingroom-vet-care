"""Callback-only proof of the pinned local CLI's migration/ledger atomicity.

The caller supplies fresh ownership-checked SQL and real CLI callbacks. This
module never starts a process, connects to a database or publishes raw catalogs.
The two failing migrations and clean installation run in one disposable local
204 database; clean 205 is last, followed by an exact no-op retry.
"""
import hashlib
import json
import re

import release_rehearsal as release
from release_assembly import PRIVATE_ACCESS_PREDICATE_SQL
from cli_migration_body import BODY_SHA256, audit_cli_statements

CASES = ('late_body', 'ledgerfault', 'clean205', 'clean205_retry')
OBSERVER_FLAGS = ('ledger_backend_wait_observed', 'engine_exclusive_lock_observed',
                  'independent_shared_lock_refused', 'same_owned_database_verified',
                  'gate_released', 'observer_closed')
FIXTURE = 'controlled_cli_atomicity_fixture'
TRIGGER = 'controlled_cli_atomicity_205'
LATE_MESSAGE = 'Synthetic controlled CLI late body failure'
LEDGER_MESSAGE = 'Synthetic controlled CLI ledger insert failure'


def migration_body(body):
    """Accept only the reviewed body, with outer transaction already removed."""
    assert isinstance(body, str) and hashlib.sha256(body.encode()).hexdigest() == BODY_SHA256
    assert body.startswith('select pg_advisory_xact_lock(90271040,0);\n')
    assert body.count(release.MARKERS['before_commit']) == 1
    audit_cli_statements(body)
    return body


# Include all public and ledger relation/function metadata, including direct
# column ACLs and trigger enable state. OIDs/owners/ACLs remain private.
# Planner hints/statistics (e.g. sticky relhastriggers after DROP TRIGGER) are
# excluded; actual trigger definitions and enable states are compared exactly.
CATALOG_SQL = r"""
create function pg_temp.cli_atomicity_catalog()returns jsonb language sql stable as $catalog$
select jsonb_build_object(
 'schemas',(select coalesce(jsonb_object_agg(n.nspname,to_jsonb(n)),'{}')from pg_namespace n where n.nspname in('public','auth','storage','extensions','supabase_migrations','controlled_cli_atomicity_fixture')),
 'functions',(select coalesce(jsonb_object_agg(n.nspname||'.'||p.oid::regprocedure::text,jsonb_build_object('attributes',to_jsonb(p),'definition',pg_get_functiondef(p.oid))),'{}')from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','supabase_migrations','controlled_cli_atomicity_fixture')and p.prokind in('f','p','w')),
 'relations',(select coalesce(jsonb_object_agg(n.nspname||'.'||c.relname,jsonb_build_object(
  'attributes',jsonb_build_object('kind',c.relkind,'owner',c.relowner,'access_method',c.relam,'tablespace',c.reltablespace,'persistence',c.relpersistence,'row_security',c.relrowsecurity,'force_row_security',c.relforcerowsecurity,'replica_identity',c.relreplident,'partition',c.relispartition,'options',to_jsonb(c.reloptions),'acl',to_jsonb(c.relacl),'partition_bound',pg_get_expr(c.relpartbound,c.oid)),'view',case when c.relkind in('v','m')then pg_get_viewdef(c.oid,true)else null end,
  'columns',(select coalesce(jsonb_agg(jsonb_build_object('attributes',to_jsonb(a),'default',pg_get_expr(d.adbin,d.adrelid))order by a.attnum),'[]')from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
  'constraints',(select coalesce(jsonb_agg(jsonb_build_object('attributes',to_jsonb(k),'definition',pg_get_constraintdef(k.oid,true))order by k.conname),'[]')from pg_constraint k where k.conrelid=c.oid),
  'triggers',(select coalesce(jsonb_agg(jsonb_build_object('attributes',to_jsonb(t),'definition',pg_get_triggerdef(t.oid,true))order by t.tgname),'[]')from pg_trigger t where t.tgrelid=c.oid),
  'policies',(select coalesce(jsonb_agg(to_jsonb(p)order by p.polname),'[]')from pg_policy p where p.polrelid=c.oid),
  'indexes',(select coalesce(jsonb_agg(jsonb_build_object('attributes',to_jsonb(i),'definition',pg_get_indexdef(i.indexrelid))order by i.indexrelid),'[]')from pg_index i where i.indrelid=c.oid))),'{}')from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','supabase_migrations','controlled_cli_atomicity_fixture')));
$catalog$;
"""


def snapshot_sql(prior_sql='', *, include_prior=False):
    query = release._snapshot_sql(prior_sql, include_prior=include_prior)
    target = "select jsonb_build_object('relations',"
    assert query.count(target) == 1
    return CATALOG_SQL + query.replace(target, "select jsonb_build_object('catalog',pg_temp.cli_atomicity_catalog())||jsonb_build_object('relations',", 1)


def _snapshot(sql, prior_sql='', *, include_prior=False):
    value = release._json(sql(snapshot_sql(prior_sql, include_prior=include_prior)))
    assert set(value) == {'catalog', 'relations', 'prior', 'writers', 'ledger', 'engine_catalog'}
    assert isinstance(value['catalog'], dict) and set(value['catalog']) == {'schemas', 'functions', 'relations'}
    assert all(isinstance(v, dict) and v for v in value['catalog'].values())
    assert set(release.SCHEMAS) | {'supabase_migrations'} <= set(value['catalog']['schemas'])
    assert isinstance(value['ledger'], list) and len(value['ledger']) in (204, 205)
    versions = [row.get('version') for row in value['ledger'] if isinstance(row, dict)]
    assert len(versions) == len(value['ledger']) and all(isinstance(v, str) and re.fullmatch(r'[0-9]{14}', v) for v in versions)
    assert versions == sorted(set(versions)), 'Exact ordered unique migration versions required'
    copy = dict(value)
    copy.pop('catalog')
    copy['ledger'] = copy['ledger'][:204]
    release._validate_snapshot(copy, allow_missing_prior=not include_prior)
    return value


def capture_baseline(sql, prior_sql, trusted):
    """Capture untouched 204 data/catalogs privately before fixture creation."""
    assert callable(sql) and isinstance(trusted, dict)
    value = _snapshot(sql, prior_sql, include_prior=True)
    assert len(value['ledger']) == 204 and value['prior'] == trusted['definition']
    assert not any(value['engine_catalog'].values()), 'Empty candidate required'
    assert FIXTURE not in value['catalog']['schemas'], 'Preexisting CLI fixture forbidden'
    assert not any(k.startswith('public.controlled_stock_') for k in value['relations'])
    assert {'public', 'auth', 'storage'} <= {n.split('.', 1)[0] for n in value['relations']} <= set(release.SCHEMAS)
    assert value['relations'].get('auth.users', {}).get('count') == 0
    return value


def _literal(value):
    return "'" + json.dumps(value, sort_keys=True).replace("'", "''") + "'::jsonb"


def installed_checks_sql(expected_release):
    expected = expected_release['expected_technical_manifest']
    assert expected_release['kind'] == 'controlled-stock-release-expected-204-v2'
    assert expected['version'] == 2 and len(expected['functions']) == 171 and len(expected['relations']) == 51
    return r"""
create function pg_temp.cli_atomicity_installed_checks()returns boolean language plpgsql volatile as $checks$
declare r record;n bigint;families integer:=0;begin
 perform public.controlled_stock_manifest_required();
 if public.controlled_stock_manifest_snapshot()<>__EXPECTED__
 or(select count(*)<>1 or not bool_and(revision=1 and definition=__EXPECTED__ and definition_hash=public.controlled_stock_hash(__EXPECTED__))from public.controlled_stock_engine_manifests)
 or not(__PRIVATE__)then return false;end if;
 if(select count(*)<>10 or jsonb_object_agg(signature,encode(sha256(convert_to(pg_get_functiondef(to_regprocedure(signature)),'UTF8')),'hex'))<>__WRITERS__ from public.stock_writer_manifests)then return false;end if;
 for r in select c.relname from pg_class c where c.relnamespace='public'::regnamespace and c.relkind in('r','p')and left(c.relname,17)='controlled_stock_'loop
  families:=families+1;
  if r.relname<>'controlled_stock_engine_manifests'then
   execute format('select count(*)from public.%I',r.relname)into n;
   if n<>0 then return false;end if;
  end if;
 end loop;
 return families=21;
end$checks$;
""".replace('__EXPECTED__', _literal(expected)).replace('__WRITERS__', _literal(expected_release['canonical_writer_definition_hashes'])).replace('__PRIVATE__', PRIVATE_ACCESS_PREDICATE_SQL)


def _scaffold_sql(mode, version, expected_release, migration_name='controlled_stock_cli_atomicity'):
    assert mode in ('ledgerfault', 'clean205') and re.fullmatch(r'[0-9]{14}', version)
    assert re.fullmatch(r'[a-z][a-z0-9_]*', migration_name)
    # Trigger checks run in the actual CLI INSERT backend, after the unchanged
    # body. A shared-lock try in a distinct observer proves the barrier remains.
    checks = installed_checks_sql(expected_release)
    checks = checks.replace('pg_temp.cli_atomicity_installed_checks', FIXTURE + '.installed_checks')
    action = 'perform pg_advisory_xact_lock(90271041,0);'
    if mode == 'ledgerfault':
        action += "raise exception '" + LEDGER_MESSAGE + "'using errcode='P0001';"
    return "begin;create schema " + FIXTURE + ";\n" + checks + r"""
create function controlled_cli_atomicity_fixture.ledger_guard()returns trigger language plpgsql as $guard$
begin
 if new.version='__VERSION__'then
  if new.name is distinct from '__NAME__'then raise exception 'CLI fixture migration name differs'using errcode='P0003';end if;
  if controlled_cli_atomicity_fixture.installed_checks()is distinct from true then raise exception 'CLI fixture installed checks failed'using errcode='P0003';end if;
  if not exists(select 1 from pg_locks where pid=pg_backend_pid()and locktype='advisory'and classid=90271040::oid and objid=0::oid and objsubid=2 and mode='ExclusiveLock'and granted)then raise exception 'CLI fixture transaction barrier missing'using errcode='P0003';end if;
  raise notice 'Controlled CLI atomicity ledger armed: __MODE__';
  __ACTION__
 end if;
 return new;
end$guard$;
create trigger controlled_cli_atomicity_205 before insert on supabase_migrations.schema_migrations for each row execute function controlled_cli_atomicity_fixture.ledger_guard();
commit;
""".replace('__VERSION__', version).replace('__NAME__', migration_name).replace('__MODE__', mode).replace('__ACTION__', action)


DROP_SQL = 'begin;drop trigger controlled_cli_atomicity_205 on supabase_migrations.schema_migrations;drop schema controlled_cli_atomicity_fixture cascade;commit;'


def _drop_fixture(sql, primary=None):
    try:
        sql(DROP_SQL)
    except BaseException as cleanup:
        if primary is None:
            raise
        primary.add_note('Owned CLI fixture cleanup also failed: ' + type(cleanup).__name__)


def _failure(result, case):
    assert case in ('late_body', 'ledgerfault')
    assert type(result.returncode) is int and result.returncode != 0, 'CLI failure required'
    assert isinstance(result.stdout, str) and isinstance(result.stderr, str)
    # The pinned CLI returns one JSON error envelope, not psql's text output.
    # Decode escaped newlines before inspecting ONLY the primary message line;
    # echoed migration SQL/context can never supply the required ERROR record.
    envelopes = []
    for line in (result.stdout + '\n' + result.stderr).splitlines():
        if line.lstrip().startswith('{'):
            envelopes.append(json.loads(line, object_pairs_hook=release._unique))
    assert len(envelopes) == 1, 'Exactly one structured CLI failure required'
    envelope = envelopes[0]
    assert isinstance(envelope, dict) and set(envelope) == {'_tag', 'error'}
    assert envelope['_tag'] == 'Error'
    error = envelope['error']
    assert isinstance(error, dict) and set(error) == {'code', 'message'}
    assert error['code'] == 'MigrationApplyError' and isinstance(error['message'], str)
    message = LATE_MESSAGE if case == 'late_body' else LEDGER_MESSAGE
    primary = error['message'].splitlines()
    assert primary and primary[0] == 'ERROR: ' + message + ' (SQLSTATE P0001)', 'Exact primary CLI SQLSTATE/message required'


def _run(run_cli, case, body):
    result = run_cli(case, body)
    assert isinstance(result, dict) and set(result) == {'result', 'barrier_observation'}
    process = result['result']
    assert type(process.returncode) is int and isinstance(process.stdout, str) and isinstance(process.stderr, str)
    observer = result['barrier_observation']
    if case in ('ledgerfault', 'clean205'):
        assert isinstance(observer, dict) and set(observer) == set(OBSERVER_FLAGS)
        assert all(v is True for v in observer.values()), 'Actual independent ledger/barrier observation required'
    else:
        assert observer is None
    return process


def _without_prior(value):
    copy = dict(value)
    copy['prior'] = None
    return copy


def rehearse(sql, run_cli, body, expected_release, baseline, *, migration_version, expected_statements, migration_name='controlled_stock_cli_atomicity'):
    """Execute two refused CLI migrations, clean 205 and an exact no-op retry.

    run_cli(case, body) writes that exact body in the owned temporary project and
    executes the pinned real local CLI. It owns gate-holder/observer lifecycles.
    Its six strict flags describe actual ledgerfault/clean independent observations.
    The pinned CLI does not forward NOTICE; fixed errors follow stage assertions.
    """
    assert callable(sql) and callable(run_cli)
    assert re.fullmatch(r'[0-9]{14}', migration_version) and re.fullmatch(r'[a-z][a-z0-9_]*', migration_name)
    assert len(baseline['ledger']) == 204 and expected_release['canonical_writer_definition_hashes'] == baseline['writers']
    assert migration_version not in [r['version'] for r in baseline['ledger']]
    assert max(r['version'] for r in baseline['ledger']) < migration_version
    body = migration_body(body)
    from cli_migration_body import STATEMENT_ARRAY_SHA256
    assert isinstance(expected_statements, list) and expected_statements and all(isinstance(item, str) and item.strip() for item in expected_statements)
    assert release._digest(expected_statements) == STATEMENT_ARRAY_SHA256, 'Independently pinned CLI statement array required'
    original = _without_prior(baseline)
    assert _snapshot(sql) == original
    outcomes = []
    for case in ('late_body', 'ledgerfault'):
        if case == 'late_body':
            injected = installed_checks_sql(expected_release) + "do $$begin if pg_temp.cli_atomicity_installed_checks()is distinct from true or not exists(select 1 from pg_locks where pid=pg_backend_pid()and locktype='advisory'and classid=90271040::oid and objid=0::oid and objsubid=2 and mode='ExclusiveLock'and granted)then raise exception 'CLI fixture late body stage missing'using errcode='P0003';end if;raise notice 'Controlled CLI atomicity body armed: late_body';raise exception '" + LATE_MESSAGE + "'using errcode='P0001';end$$;\n"
            candidate = body.replace(release.MARKERS['before_commit'], injected + release.MARKERS['before_commit'])
        else:
            sql(_scaffold_sql(case, migration_version, expected_release, migration_name))
            candidate = body
        armed = _snapshot(sql)
        try:
            _failure(_run(run_cli, case, candidate), case)
            assert _snapshot(sql) == armed, 'Failed CLI migration did not roll back all data/catalogs/ledger'
        except BaseException as primary:
            if case == 'ledgerfault':
                _drop_fixture(sql, primary)
            raise
        else:
            if case == 'ledgerfault':
                _drop_fixture(sql)
        assert _snapshot(sql) == original, 'CLI fixture removal did not restore untouched baseline'
        outcomes.append({'case': case, 'sqlstate': 'P0001', 'stage_assertions_before_fixed_failure': True, 'exact_full_baseline_restored': True})
    sql(_scaffold_sql('clean205', migration_version, expected_release, migration_name))
    try:
        clean = _run(run_cli, 'clean205', body)
        assert clean.returncode == 0, 'Clean real CLI migration failed'
    except BaseException as primary:
        _drop_fixture(sql, primary)
        raise
    else:
        _drop_fixture(sql)
    assert release._json(sql(installed_checks_sql(expected_release) + "select jsonb_build_object('passed',pg_temp.cli_atomicity_installed_checks());")) == {'passed': True}
    installed = _snapshot(sql)
    assert installed['writers'] == baseline['writers']
    for name, value in baseline['relations'].items():
        assert installed['relations'].get(name) == value, 'CLI success changed original source rows'
    added = set(installed['relations']) - set(baseline['relations'])
    assert len(added) == 21 and all(n.startswith('public.controlled_stock_') for n in added)
    assert FIXTURE not in installed['catalog']['schemas']
    # The ledger's actual trigger/column/function catalog returns exactly to the
    # baseline after the test scaffold is removed; only its 205 data row remains.
    assert {k: v for k, v in installed['catalog']['relations'].items() if k.startswith('supabase_migrations.')} == {k: v for k, v in baseline['catalog']['relations'].items() if k.startswith('supabase_migrations.')}
    for schema in (*release.SCHEMAS, 'supabase_migrations'):
        assert installed['catalog']['schemas'][schema] == baseline['catalog']['schemas'][schema]
    assert {k: v for k, v in installed['catalog']['functions'].items() if k.startswith('supabase_migrations.')} == {k: v for k, v in baseline['catalog']['functions'].items() if k.startswith('supabase_migrations.')}
    ledger = installed['ledger']
    assert len(ledger) == 205 and ledger[:204] == baseline['ledger']
    row = ledger[-1]
    assert row.get('version') == migration_version and row.get('name') == migration_name
    assert row.get('statements') == expected_statements, 'CLI ledger statements differ from independently reviewed parser output'
    assert _run(run_cli, 'clean205_retry', body).returncode == 0
    assert _snapshot(sql) == installed, 'Already-applied CLI retry changed database state'
    return validate_proof({'kind': 'controlled-cli-atomicity-v1', 'passed': True, 'failure_cases': outcomes,
        'failure_count': 2, 'clean_install_migration_count': 205, 'original_migration_count': 204,
        'original_relation_count': len(baseline['relations']), 'new_engine_relation_count': 21,
        'canonical_writers': 10, 'literal_manifest_version': 2,
        'statement_array_sha256': STATEMENT_ARRAY_SHA256, 'body_sha256': hashlib.sha256(body.encode()).hexdigest(), 'ledger_record_sha256': release._digest(row),
        'baseline_sha256': release._digest(baseline), 'reviewed_manifest_sha256': release._digest(expected_release['expected_technical_manifest']),
        'exact_clean_body_used': True, 'same_backend_engine_barrier_at_ledger_insert': True,
        'independent_shared_lock_refused': True, 'ledger_fixture_removed': True,
        'original_204_ledger_rows_preserved': True, 'original_source_rows_preserved': True,
        'literal_manifest_and_private_zero_activation_verified': True, 'retry_exact_noop': True,
        'hosted_writes': 0, 'clinical_or_register_activation': False})


def validate_proof(value):
    flags = {'exact_clean_body_used', 'same_backend_engine_barrier_at_ledger_insert', 'independent_shared_lock_refused',
             'ledger_fixture_removed', 'original_204_ledger_rows_preserved', 'original_source_rows_preserved',
             'literal_manifest_and_private_zero_activation_verified', 'retry_exact_noop'}
    hashes = {'statement_array_sha256', 'body_sha256', 'ledger_record_sha256', 'baseline_sha256', 'reviewed_manifest_sha256'}
    ints = {'failure_count': 2, 'clean_install_migration_count': 205, 'original_migration_count': 204,
            'new_engine_relation_count': 21, 'canonical_writers': 10, 'literal_manifest_version': 2, 'hosted_writes': 0}
    assert isinstance(value, dict) and set(value) == flags | hashes | set(ints) | {'kind', 'passed', 'failure_cases', 'original_relation_count', 'clinical_or_register_activation'}
    assert value['kind'] == 'controlled-cli-atomicity-v1' and value['passed'] is True
    assert all(value[k] is True for k in flags)
    assert all(isinstance(value[k], str) and release.HEX.fullmatch(value[k]) for k in hashes)
    from cli_migration_body import STATEMENT_ARRAY_SHA256
    assert value['body_sha256'] == BODY_SHA256 and value['statement_array_sha256'] == STATEMENT_ARRAY_SHA256
    assert all(type(value[k]) is int and value[k] == n for k, n in ints.items())
    assert type(value['original_relation_count']) is int and value['original_relation_count'] > 0
    assert value['clinical_or_register_activation'] is False
    assert isinstance(value['failure_cases'], list) and len(value['failure_cases']) == 2
    for case, actual in zip(('late_body', 'ledgerfault'), value['failure_cases']):
        assert actual == {'case': case, 'sqlstate': 'P0001', 'stage_assertions_before_fixed_failure': True, 'exact_full_baseline_restored': True}
        assert actual['stage_assertions_before_fixed_failure'] is True and actual['exact_full_baseline_restored'] is True
    return value
