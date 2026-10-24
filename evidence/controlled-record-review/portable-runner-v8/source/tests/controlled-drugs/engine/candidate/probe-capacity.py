"""Synthetic opening-capacity characterization in one marked disposable clone."""
import json
import os
from pathlib import Path
import re
import subprocess
import time
import uuid


SCHEMAS = ('public', 'auth', 'storage', 'extensions')


def literal(value):
    return "'" + value.replace("'", "''") + "'"


def verify_database(runtime, target, marker):
    assert re.fullmatch(r'owned_controlled_capacity_[0-9a-f]{10}', target), 'Unsafe capacity database target'
    assert re.fullmatch(r'[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}', marker), 'Invalid capacity ownership marker'
    runtime.verify()
    actual = runtime.raw_sql("select shobj_description(oid,'pg_database')from pg_database where datname=" + literal(target) + ';').strip()
    assert actual == marker, 'Capacity database ownership marker mismatch'


def drop_database(runtime, target, marker):
    verify_database(runtime, target, marker)
    runtime.raw_sql('drop database "' + target + '" with(force);')
    assert runtime.raw_sql('select count(*)from pg_database where datname=' + literal(target) + ';').strip() == '0', 'Owned capacity database remains'


class Runtime:
    def __init__(self, folder):
        record = json.loads((folder / 'runtime.json').read_text())
        self.folder = folder
        self.identity = record['identity']
        assert re.fullmatch(r'lrv-controlled-engine-[0-9a-f]{10}', self.identity) and not record['removed']
        self.project = Path(record['project']).resolve()
        self.container = 'supabase_db_' + self.identity
        self.log = (folder / 'engine-capacity-v1.log').open('x')
        self.database = 'owned_controlled_capacity_' + uuid.uuid4().hex[:10]
        self.marker = str(uuid.uuid4())

    def command(self, argv, query=None, timeout=180):
        result = subprocess.run(argv, input=query, capture_output=True, text=True, timeout=timeout)
        self.log.write('COMMAND ' + argv[0] + '\n' + (
            '[Owned Docker inspection withheld]\n' if argv[:2] == ['docker', 'inspect']
            else result.stdout + result.stderr) + '\n')
        self.log.flush()
        if result.returncode:
            raise RuntimeError('Owned capacity probe failed; private log retained')
        return result.stdout

    def capture_failure(self, stage):
        """Collect protected diagnostics without replacing the triggering error.

        Database recovery may reject every SQL query. Docker labels establish
        ownership before reading logs, independently of database availability.
        """
        try:
            assert re.fullmatch(r'[a-z0-9_-]+', stage)
            self.verify()
            result = subprocess.run(['docker', 'logs', '--tail', '400', self.container],
                                    capture_output=True, text=True, errors='replace', timeout=10)
            with (self.folder / ('engine-capacity-diagnostic-' + stage + '-' + str(time.monotonic_ns()) + '.log')).open('x') as stream:
                stream.write('Docker database logs; returncode=' + str(result.returncode) + '\n')
                stream.write(result.stdout)
                stream.write(result.stderr)
        except BaseException as diagnostic_error:
            # A missing/mismatched runtime must never authorize log collection.
            # Diagnostic failure cannot hide the original SQL/cleanup exception.
            try:
                self.log.write('Failure diagnostics unavailable (' + stage + '): ' + type(diagnostic_error).__name__ + '\n')
                self.log.flush()
            except BaseException:
                pass

    def verify(self):
        labels = json.loads(self.command(['docker', 'inspect', self.container], timeout=15))[0]['Config']['Labels']
        assert labels['com.supabase.cli.project'] == self.identity
        assert Path(labels['com.supabase.cli.workdir']).resolve() == self.project

    def raw_sql(self, query, target='postgres', timeout=180):
        self.verify()
        return self.command(['docker', 'exec', '-i', self.container, 'psql', '-X', '-qAt', '-U', 'postgres', '-d', target,
                             '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'], query, timeout=timeout)

    def sql(self, query, target='postgres', timeout=180):
        assert target in ('postgres', self.database), 'Unexpected capacity SQL target'
        if target != 'postgres':
            verify_database(self, target, self.marker)
        return self.raw_sql(query, target, timeout)

    def snapshot(self, target='postgres'):
        query = """create temp table capacity_snapshot(name text,value jsonb);
        do $$declare r record;v jsonb;begin
        for r in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where n.nspname in('public','auth','storage','extensions')and c.relkind in('r','p')order by 1,2 loop
        execute format('select jsonb_build_object(''count'',count(*),''hash'',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,''|''order by to_jsonb(t)::text),''''),''UTF8'')),''hex''))from %I.%I t',r.nspname,r.relname)into v;
        insert into capacity_snapshot values(r.nspname||'.'||r.relname,v);end loop;end$$;
        select jsonb_object_agg(name,value)from capacity_snapshot;"""
        return json.loads(self.sql("begin;set local timezone='UTC';" + query + 'rollback;', target).splitlines()[-1])

    def technical(self, target='postgres'):
        return json.loads(self.sql('select controlled_stock_manifest_required();'
                                   "select jsonb_build_object('manifest',(select jsonb_agg(to_jsonb(m)order by revision)from controlled_stock_engine_manifests m),"
                                   "'writers',(select jsonb_object_agg(signature,encode(sha256(convert_to(pg_get_functiondef(to_regprocedure(signature)),'UTF8')),'hex'))from stock_writer_manifests));", target).splitlines()[-1])

    def dump(self):
        self.verify()
        argv = ['docker', 'exec', self.container, 'pg_dump', '-U', 'postgres', '--no-owner']
        argv.extend('--schema=' + schema for schema in SCHEMAS)
        output = self.command([*argv, 'postgres'], timeout=90)
        return '\n'.join(line for line in output.splitlines() if not line.startswith('ALTER DEFAULT PRIVILEGES')).replace(
            'CREATE SCHEMA extensions;', 'CREATE SCHEMA IF NOT EXISTS extensions;')


def capacity_fixture(root, source, filename, configuration_markers):
    canonical = (root / 'supabase/tests/native_fulfillment.test.sql').read_text()
    target = "insert into data select 'target',"
    assert canonical.count(target) == 1
    prefix = canonical[:canonical.index(target)].replace('select no_plan();', '')
    config = (source / 'native-config.sql').read_text()
    opening = 'insert into controlled_stock_openings('
    assert config.count(opening) == 1
    config = config[:config.index(opening)]
    transaction = "begin;set local timezone='UTC';"
    assert config.count(transaction) == 1
    config = config.replace(transaction, '', 1)
    fixture = (source / filename).read_text()
    marker = '-- CAPACITY_PRIVATE_CONFIGURATION --'
    assert fixture.count(marker) == configuration_markers
    return prefix + '\n' + fixture.replace(marker, config)


def observation_result(output, scenario):
    observations = [json.loads(line) for line in output.splitlines() if line.startswith('{')]
    def exactly(kind):
        matches = [item for item in observations if item.get('kind') == kind]
        assert len(matches) == 1, 'Exactly one capacity phase observation required: ' + kind
        return matches[0]
    positive = exactly('controlled-opening-capacity-positive-v1')
    summary = exactly('controlled-opening-capacity-observation-v1')
    baseline = exactly('controlled-opening-capacity-canonical-baseline-v1')
    assert positive['genuine_dispenses'] == scenario['positive_dispenses']
    assert positive['genuine_max_allocations'] == scenario['max_allocations']
    assert positive['full_opening_validated'] is True and positive['unattached_frozen_only'] is True
    assert positive['genuine1000_event_chains_tested'] is False
    assert positive['structural_byte_probes_are_valid_openings'] is False
    assert positive['corrupt_event_rows_are_canonical_history'] is False
    assert summary['genuine_dispenses'] == baseline['native_dispenses'] == scenario['final_dispenses']
    if scenario['final_dispenses'] == 201:
        assert summary['retained_boundary_entries'] == 200
        assert summary['complete_product_count_refused_without_truncation'] is True
    results = {}
    for phase in (positive, summary):
        assert isinstance(phase['outcomes'], list) and phase['sql_checks'] == len(phase['outcomes'])
        assert phase['refusals'] == sum(item['outcome'] == 'refused' for item in phase['outcomes'])
        assert len({item['label'] for item in phase['outcomes']}) == len(phase['outcomes'])
        for item in phase['outcomes']:
            label = item['label']
            value = {key: value for key, value in item.items() if key != 'label'}
            assert label not in results or results[label] == value, 'Conflicting capacity phase evidence'
            results[label] = value
    assert results
    refusals = [value for value in results.values() if value['outcome'] == 'refused']
    assert all(value['sqlstate'] == '23514' and value['armed_before_observation'] is True and
               value['four_schema_and_manifest_rollback'] is True for value in refusals)
    return {'scenario': scenario['name'], 'genuine_capacity_positive': positive,
            'final_observation': summary, 'unique_results': results,
            'unique_sql_checks': len(results), 'unique_refusals': len(refusals),
            'unique_positive_assertions': sum(value['outcome'] == 'accepted_assertion' for value in results.values())}, baseline


def cleanup_scenario(runtime, original, created, prior_failure, name):
    """Retain the first error if recovery prevents marker-safe clone cleanup."""
    if created:
        try:
            drop_database(runtime, runtime.database, runtime.marker)
        except BaseException:
            runtime.capture_failure(name + '-cleanup')
            if not prior_failure:
                raise
    if original is not None:
        try:
            assert runtime.snapshot() == original
        except BaseException:
            runtime.capture_failure(name + '-source-check')
            if not prior_failure:
                raise


def main():
    os.umask(0o077)
    source = Path(__file__).resolve().parent
    root = source.parents[3]
    folder = Path(os.environ['CONTROLLED_ENGINE_RESULT_DIR']).resolve()
    runtime = Runtime(folder)
    original = None
    outcomes = []
    preservation = {}
    # One global wall-clock budget, not a new 900-second budget for each clone.
    deadline = time.monotonic() + 900
    scenarios = [
        {'name': 'maximum_allocations', 'filename': 'opening-capacity-allocations.sql',
         'configuration_markers': 1, 'positive_dispenses': 1, 'max_allocations': 100, 'final_dispenses': 1},
        {'name': 'maximum_dispenses', 'filename': 'opening-capacity.sql',
         'configuration_markers': 2, 'positive_dispenses': 200, 'max_allocations': 1, 'final_dispenses': 201},
    ]
    try:
        original = runtime.snapshot()
        technical = runtime.technical()
        assert len(technical['writers']) == 10 and original['auth.users']['count'] == 0
        dump = runtime.dump()
        for scenario in scenarios:
            runtime.database = 'owned_controlled_capacity_' + uuid.uuid4().hex[:10]
            runtime.marker = str(uuid.uuid4())
            created = False
            scenario_failed = False
            try:
                assert time.monotonic() < deadline, 'Global capacity probe deadline reached before next scenario'
                runtime.sql('create database "' + runtime.database + '";')
                created = True
                runtime.sql('comment on database "' + runtime.database + '" is ' + literal(runtime.marker) + ';')
                verify_database(runtime, runtime.database, runtime.marker)
                runtime.sql('drop schema public;create schema extensions;create extension pgcrypto with schema extensions;'
                            'create extension "uuid-ossp"with schema extensions;', runtime.database)
                runtime.sql(dump, runtime.database)
                assert runtime.snapshot(runtime.database) == original
                assert runtime.technical(runtime.database) == technical
                fixture = capacity_fixture(root, source, scenario['filename'], scenario['configuration_markers'])
                remaining = deadline - time.monotonic()
                assert remaining > 0, 'Global capacity probe SQL budget exhausted'
                started = time.monotonic()
                output = runtime.sql(fixture, runtime.database, timeout=remaining)
                elapsed = time.monotonic() - started
                outcome, baseline = observation_result(output, scenario)
                assert runtime.snapshot(runtime.database) == baseline['fingerprint'], 'Configuration did not roll back to canonical baseline'
                controlled_original = {name: value for name, value in original.items() if name.startswith(('public.controlled_stock_', 'public.controlled_draft_'))}
                controlled_after = {name: value for name, value in baseline['fingerprint'].items() if name.startswith(('public.controlled_stock_', 'public.controlled_draft_'))}
                assert controlled_after == controlled_original
                assert runtime.technical(runtime.database) == technical
                assert runtime.snapshot() == original
                preservation[scenario['name']] = baseline['fingerprint']
                outcome.update(fixture_elapsed_seconds=round(elapsed, 3), canonical_fixture_committed_only_inside_owned_clone=True,
                               clone_configuration_all_relations_rolled_back_to_canonical_baseline=True,
                               controlled_configuration_and_events_match_original_empty_source=True,
                               technical_manifest_and_ten_canonical_writers_unchanged=True,
                               source_runtime_all_relations_unchanged=True)
            except BaseException:
                scenario_failed = True
                # Collect Docker evidence before marker SQL, which may itself
                # fail while PostgreSQL is recovering from the original error.
                runtime.capture_failure(scenario['name'] + '-execution')
                raise
            finally:
                cleanup_scenario(runtime, original, created, scenario_failed, scenario['name'])
            outcome['marked_capacity_database_removed'] = True
            outcomes.append(outcome)
        assert len(outcomes) == 2
        # Namespace labels by scenario; identical assertions in two independent
        # datasets remain separate executions, never a combined maximum claim.
        results = {outcome['scenario'] + ':' + label: value for outcome in outcomes
                   for label, value in outcome['unique_results'].items()}
        proof = dict(kind='controlled-opening-capacity-independent-scenarios-v1', scenarios=outcomes,
                     scenario_count=2, unique_results=results, unique_sql_checks=len(results),
                     unique_refusals=sum(value['outcome'] == 'refused' for value in results.values()),
                     unique_positive_assertions=sum(value['outcome'] == 'accepted_assertion' for value in results.values()),
                     combined_maximum_dispenses_and_allocations_tested=False,
                     global_probe_budget_seconds=900, elapsed_is_production_benchmark=False,
                     selected_schemas=list(SCHEMAS), source_clone_exact_relation_fingerprints=len(original),
                     source_runtime_all_relations_unchanged=True, all_marked_capacity_databases_removed=True,
                     synthetic_only=True, sql_only=True, genuine_auth_api=False, canonical_migration=False,
                     actual_practice_rules=False, clinical_or_register_activation=False,
                     production_capacity_approved=False, genuine_1000_event_history_chains_proven=False,
                     physical_post_backup_reconciliation_proven=False, storage_binary_restore_proven=False,
                     hosted_writes=0, provider_requests=0)
        with (folder / 'engine-capacity-v1-preservation.json').open('x') as stream:
            json.dump({'original_source_and_clones': original, 'scenario_canonical_baselines': preservation,
                       'manifest_and_writers': technical}, stream, indent=2)
            stream.write('\n')
    finally:
        runtime.log.close()
    with (folder / 'engine-capacity-v1-proof.json').open('x') as stream:
        json.dump(proof, stream, indent=2)
        stream.write('\n')
    print(json.dumps(proof))


if __name__ == '__main__':
    main()
