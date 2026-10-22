"""Owned, synthetic Gate A feasibility; no hosted installation or protocol claim.

Reference runs compare independently assembled expected metadata with PostgreSQL
rendering. Observed catalogs never become expected inputs. Every attempt retains
private source bytes/logs and verifies cleanup before it can report success.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import traceback
import uuid

SOURCE = Path(__file__).resolve().parent
ROOT = SOURCE.parents[3]
MEASUREMENT_WORKLOAD_SECONDS = 1200
CLEANUP_RESERVE_SECONDS = 180
GATE_A_WORKLOAD_SECONDS = 600


def literal(value):
    return "'" + str(value).replace("'", "''") + "'"


def json_output(output):
    records = [json.loads(line) for line in output.splitlines() if line.startswith('{')]
    assert len(records) == 1, 'Exactly one JSON object observation required'
    return records[0]


def source_inputs():
    from canonical_prefix import canonical_admission_inputs
    files = sorted((ROOT / 'supabase/migrations').glob('*.sql'))
    admission = canonical_admission_inputs(SOURCE, files)
    files += sorted(p for p in SOURCE.iterdir() if p.suffix in ('.py', '.sql', '.json'))
    files += sorted((SOURCE.parent / 'release').glob('*.sql'))
    files += [ROOT / 'supabase/tests/test_controlled_secondary_review_harness.py', ROOT / 'supabase/tests/native_fulfillment.test.sql', SOURCE.parent / 'source-reader.sql', SOURCE.parent / 'source-effects.sql', ROOT / '.github/workflows/ci.yml']
    assert all(p.is_file() for p in files), 'Every declared executable input is required'
    sys.path.insert(0, str(ROOT / 'scripts'))
    from owned_canonical_bootstrap import bootstrap_inputs
    return {**{str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in files}, **admission, **bootstrap_inputs(ROOT)}


def freeze_inputs(folder):
    hashes = source_inputs()
    for name in hashes:
        target = folder / 'inputs' / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / name, target)
    (folder / 'source-hashes.json').write_text(json.dumps(hashes, sort_keys=True, indent=2) + '\n')
    return hashes


ROWS_SQL = """
set timezone='UTC';
create function pg_temp.secondary_review_all_rows()returns jsonb language plpgsql as $$
declare r record;v jsonb;answer jsonb:='{}';begin
 for r in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname in('public','auth','storage','extensions','supabase_migrations')and c.relkind in('r','p')order by 1,2 loop
  execute format('select coalesce(jsonb_agg(to_jsonb(t)order by to_jsonb(t)::text),''[]'')from %I.%I t',r.nspname,r.relname)into v;
  answer:=answer||jsonb_build_object(r.nspname||'.'||r.relname,v);
 end loop;return answer;end$$;
select pg_temp.secondary_review_all_rows();
"""


class OwnedRuntime:
    def __init__(self, folder, workload_seconds=MEASUREMENT_WORKLOAD_SECONDS):
        self.folder = folder
        self.identity = 'lrv-controlled-review-' + uuid.uuid4().hex[:10]
        self.work = Path(tempfile.mkdtemp(prefix=self.identity + '-'))
        self.project = self.work / 'project'
        self.container = 'supabase_db_' + self.identity
        self.log = (folder / 'runner.log').open('x')
        self.started = False
        self.deadline = time.monotonic() + workload_seconds
        self.cleanup_mode = False
        self.databases = {}
        self.command_number = 0
        self.record = {'identity': self.identity, 'work': str(self.work), 'project': str(self.project),
                       'removed': False, 'workload_seconds': workload_seconds,
                       'cleanup_reserve_seconds': CLEANUP_RESERVE_SECONDS}
        self.save()

    def save(self):
        (self.folder / 'runtime.json').write_text(json.dumps(self.record, indent=2) + '\n')

    def remaining(self, limit):
        remaining = self.deadline - time.monotonic()
        assert remaining > 0, 'Owned feasibility deadline expired; no PASS permitted'
        return min(limit, remaining)

    def command(self, argv, text=None, timeout=120, fail=True):
        self.command_number += 1
        stem = f"{self.command_number:04d}"
        if text is not None:
            (self.folder / (stem + "-executed.sql")).write_text(text)
        (self.folder / (stem + "-command.json")).write_text(json.dumps(argv) + "\n")
        process = subprocess.run(argv, input=text, capture_output=True, text=True, cwd=ROOT,
                                 timeout=self.remaining(timeout))
        self.log.write('COMMAND ' + json.dumps(argv[:2]) + '\n' +
                       ('[Owned inspection withheld]\n' if argv[:2] == ['docker', 'inspect']
                        else process.stdout + process.stderr) + '\n')
        self.log.flush()
        (self.folder / (stem + "-stdout.log")).write_text(process.stdout)
        (self.folder / (stem + "-stderr.log")).write_text(process.stderr)
        if fail and process.returncode:
            raise RuntimeError('Owned feasibility command failed; see private runner.log')
        return process

    def verify(self, name=None):
        inspected = json.loads(self.command(['docker', 'inspect', name or self.container]).stdout)[0]
        labels = inspected['Config']['Labels']
        assert labels['com.supabase.cli.project'] == self.identity
        assert Path(labels['com.supabase.cli.workdir']).resolve() == self.project.resolve()
        return inspected

    def sql(self, query, database='postgres', fail=True, user='postgres'):
        self.verify()
        assert user in ('postgres','supabase_admin'), 'Only reviewed owned local SQL roles permitted'
        if database != 'postgres':
            assert database in self.databases and re.fullmatch(r'owned_review_restore_[0-9a-f]{10}', database), 'Unregistered owned clone'
            marker = self.query("select shobj_description(oid,'pg_database')from pg_database where datname=" + literal(database) + ';').strip()
            assert marker == self.databases[database], 'Owned clone marker differs'
        return self.command(['docker', 'exec', '-i', self.container, 'psql', '-X', '-qAt',
                             '-U', user, '-d', database, '-v', 'ON_ERROR_STOP=1',
                             '-v', 'VERBOSITY=verbose'], query, fail=fail)

    def query(self, query, database='postgres'):
        return self.sql(query, database).stdout

    def json(self, query, database='postgres'):
        return json_output(self.query(query, database))

    def start(self, files):
        assert self.command(['supabase', '--version']).stdout.strip() == '2.118.0'
        for port in (64660, 64661, 64662, 64664):
            with socket.socket() as sock:
                sock.bind(('127.0.0.1', port))
        migrations = self.project / 'supabase/migrations'
        migrations.mkdir(parents=True)
        for path in files:
            shutil.copy2(path, migrations / path.name)
        (self.project / 'supabase/config.toml').write_text(f'''project_id = "{self.identity}"
[api]
port = 64661
[db]
port = 64662
shadow_port = 64660
major_version = 17
[studio]
enabled = false
[analytics]
enabled = false
[inbucket]
port = 64664
[auth]
site_url = "http://127.0.0.1:64661"
enable_signup = false
[storage]
enabled = true
[edge_runtime]
enabled = false
''')
        shutil.copy2(self.project / 'supabase/config.toml', self.folder / 'generated-supabase-config.toml')
        self.helper_failed_unverified = True
        try:
            self.command([sys.executable, '-B', str(ROOT / 'scripts/owned_canonical_bootstrap.py'),
                          '--run-synthetic-local', '--migration-count', str(len(files)),
                          '--evidence', str(self.folder / 'bootstrap'), '--workdir', str(self.project), '--exclude',
                          'realtime,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'], timeout=600)
        except BaseException:
            result = self.folder / 'bootstrap/result.json'
            if result.is_file() and json.loads(result.read_text()).get('failure_cleanup_complete') is True:
                self.helper_failed_unverified = False
            raise
        self.helper_failed_unverified = False
        self.started = True
        from history_environment import assert_bootstrap_image
        inspected = self.verify()
        image = json.loads(self.command(['docker', 'image', 'inspect', inspected['Image']]).stdout)[0]
        self.record['bootstrap_image'] = assert_bootstrap_image(inspected['Config']['Image'], image)
        self.save()
        self.command(['docker', 'exec', '-i', self.container, 'psql', '-X', '-qAt', '-U',
                      'supabase_admin', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'],
                     'alter system set cron.launch_active_jobs=off;select pg_reload_conf();')
        until = time.monotonic() + 10
        while time.monotonic() < until:
            if self.query("select current_setting('cron.launch_active_jobs')='off'and not exists(select 1 from pg_stat_activity where application_name='pg_cron'and state='active');").strip() == 't':
                break
            time.sleep(.05)
        else:
            raise AssertionError('Owned scheduler pause did not settle')

    def cleanup(self):
        # Cleanup receives its own predeclared reserve, never extends workload.
        self.cleanup_mode = True
        self.deadline = time.monotonic() + CLEANUP_RESERVE_SECONDS
        try:
            if getattr(self, 'helper_failed_unverified', False):
                raise RuntimeError('Bootstrap cleanup was not verified; retain owned workdir for investigation')
            if self.started:
                for database, marker in list(self.databases.items()):
                    assert self.query("select shobj_description(oid,'pg_database')from pg_database where datname=" + literal(database) + ';').strip() == marker
                    self.query('drop database ' + database + ' with(force);')
                    assert self.query('select count(*)from pg_database where datname=' + literal(database) + ';').strip() == '0'
                    del self.databases[database]
                names = self.command(['docker', 'ps', '-a', '--filter',
                                      'label=com.supabase.cli.project=' + self.identity,
                                      '--format', '{{.Names}}']).stdout.splitlines()
                for name in names:
                    self.verify(name)
                self.command(['supabase', 'stop', '--workdir', str(self.project), '--no-backup'], timeout=150)
                for argv in (['docker', 'ps', '-aq'], ['docker', 'volume', 'ls', '-q']):
                    assert not self.command(argv + ['--filter', 'label=com.supabase.cli.project=' + self.identity]).stdout.strip()
            shutil.rmtree(self.work)
            assert not self.work.exists()
            self.record['removed'] = True
            self.save()
            (self.folder / 'cleanup.json').write_text(json.dumps({'identity': self.identity,
                'containers_volumes_workdir_removed': True}, indent=2) + '\n')
        finally:
            self.log.close()


def bootstrap(runtime):
    from canonical_prefix import canonical_prefix, canonical_binding, canonical205_files
    from canonical_post205 import capture_pre204, verify_canonical_installed
    from local_install import build_install
    files = sorted((ROOT / 'supabase/migrations').glob('*.sql'))
    admitted205 = canonical205_files(SOURCE, files)
    prefix = canonical_prefix(SOURCE, files)
    binding = canonical_binding(SOURCE, files)
    runtime.start(prefix)
    bundle = build_install(SOURCE, prefix)
    before = capture_pre204(runtime.query, bundle['prior_sql'], bundle['trusted'], phase='ordinary')
    (runtime.folder / 'pre204.json').write_text(json.dumps(before, sort_keys=True) + '\n')
    assert admitted205[-1].name == binding['filename']
    shutil.copy2(admitted205[-1], runtime.project / 'supabase/migrations' / binding['filename'])
    runtime.verify()
    runtime.command(['supabase', 'migration', 'up', '--local', '--workdir', str(runtime.project),
                     '--yes', '--output-format', 'json'], timeout=240)
    expected = json.loads((SOURCE / 'release-expected-204.json').read_text())
    proof = verify_canonical_installed(runtime.query, expected, before, binding)
    (runtime.folder / 'canonical205-admission.json').write_text(json.dumps(proof, indent=2) + '\n')
    return binding, before, expected



def independent_preflight(binding, baseline, expected):
    # All expectations originate in pinned source or actual pre204 capture,
    # never a postinstallation live snapshot used to authorize new metadata.
    ledger = baseline['ledger'] + [{'version': binding['version'], 'name': binding['name'],
                                    'statements': binding['expected_statements']}]
    def value(item):
        return literal(json.dumps(item, sort_keys=True)) + '::jsonb'
    return """select pg_advisory_xact_lock(90271040,0);
 do $preflight$ begin
 perform public.controlled_stock_manifest_required();
 if public.controlled_stock_manifest_snapshot() is distinct from __PARENT__
 or (select count(*)<>1 or not bool_and(revision=1 and definition=__PARENT__ and definition_hash=public.controlled_stock_hash(__PARENT__)) from public.controlled_stock_engine_manifests)
 or (select jsonb_agg(to_jsonb(m) order by version)from supabase_migrations.schema_migrations m) is distinct from __LEDGER__
 or (select jsonb_object_agg(signature,encode(sha256(convert_to(pg_get_functiondef(to_regprocedure(signature)),'UTF8')),'hex'))from public.stock_writer_manifests) is distinct from __WRITERS__ then
  raise exception 'Secondary-review exact canonical205 admission failed' using errcode='23514';
 end if;
 end $preflight$;
""".replace('__PARENT__', value(expected['expected_technical_manifest'])).replace('__LEDGER__', value(ledger)).replace('__WRITERS__', value(expected['canonical_writer_definition_hashes']))


def reference(runtime, binding, baseline, expected):
    from secondary_review_descriptor import build
    from cli_atomicity import _snapshot
    package = build()
    (runtime.folder / 'independent-extension-expected.json').write_text(json.dumps(package['expected'], sort_keys=True, indent=2) + '\n')
    before = _snapshot(runtime.query)
    rows = runtime.json(ROWS_SQL)
    parent = runtime.json('select public.controlled_stock_manifest_snapshot();')
    (runtime.folder / 'reference-before.json').write_text(json.dumps(before, sort_keys=True) + '\n')
    (runtime.folder / 'reference-original-rows.json').write_text(json.dumps(rows, sort_keys=True) + '\n')
    runtime.query('begin;\n' + independent_preflight(binding, baseline, expected) + package['ddl'] + '\n' + package['descriptor_insert'] + '\ncommit;')
    actual = runtime.json(package['snapshot_sql'])
    (runtime.folder / 'reference-observed.json').write_text(json.dumps(actual, sort_keys=True, indent=2) + '\n')
    assert actual == package['expected'], 'Reference PostgreSQL rendering differs from independently derived expectation'
    runtime.query('select controlled_review.required();')
    assert runtime.json('select public.controlled_stock_manifest_snapshot();') == parent
    assert runtime.json(ROWS_SQL) == rows
    after = _snapshot(runtime.query)
    (runtime.folder / 'reference-after.json').write_text(json.dumps(after, sort_keys=True) + '\n')
    for name in ('relations', 'writers', 'ledger', 'engine_catalog'):
        assert before[name] == after[name], 'Reference installation changed parent ' + name
    return {'expected_definition_sha256': package['expected_sha256'], 'independent_rendering_matches': True,
            'unchanged_parent_manifest': True, 'unchanged_original_rows_and_ledger': True,
            'protocol_implemented': False, 'acceptance': False}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run-synthetic-local', action='store_true', required=True)
    parser.add_argument('--measure-bootstrap', action='store_true')
    parser.add_argument('--reference', action='store_true')
    parser.add_argument('--gate-a', action='store_true')
    args = parser.parse_args()
    assert sum((args.measure_bootstrap,args.reference,args.gate_a))==1, 'Exactly one explicit run mode required'
    if args.gate_a:
        from secondary_review_gate_a import run, frozen_package
        frozen_package(SOURCE)
    os.umask(0o077)
    folder = Path(tempfile.mkdtemp(prefix='lrv-controlled-review-evidence-'))
    hashes = freeze_inputs(folder)
    runtime = OwnedRuntime(folder, GATE_A_WORKLOAD_SECONDS if args.gate_a else MEASUREMENT_WORKLOAD_SECONDS)
    started = time.monotonic()
    proof = {'kind': 'controlled-secondary-review-feasibility-v1', 'passed': False,
             'acceptance': False, 'synthetic_only': True, 'hosted_writes': 0,
             'provider_requests': 0, 'clinical_or_register_activation': False}
    print('Protected evidence: ' + str(folder), flush=True)
    try:
        binding, before, expected = bootstrap(runtime)
        proof['canonical205_admission'] = True
        if args.reference:
            proof['reference'] = reference(runtime, binding, before, expected)
        if args.gate_a:
            proof['gate_a'] = run(runtime,SOURCE,binding,before,expected,independent_preflight,ROWS_SQL)
            proof['acceptance'] = True
        assert source_inputs() == hashes, 'Proof source inventory or bytes changed during execution'
        assert all(hashlib.sha256((folder / 'inputs' / name).read_bytes()).hexdigest() == value for name, value in hashes.items()), 'Executed source copy changed'
        runtime.remaining(1)
        proof['workload_seconds'] = round(time.monotonic() - started, 3)
        proof['passed'] = True
    except BaseException as error:
        proof['failure_type'] = type(error).__name__
        proof['workload_seconds'] = round(time.monotonic() - started, 3)
        (folder / 'traceback.log').write_text(traceback.format_exc())
        (folder / 'failed-attempt.json').write_text(json.dumps(proof, indent=2) + '\n')
        raise
    finally:
        try:
            runtime.cleanup()
        except BaseException:
            proof['passed'] = False
            proof['cleanup_failed'] = True
            raise
        finally:
            (folder / 'result.json').write_text(json.dumps(proof, indent=2) + '\n')
    print(json.dumps(proof), flush=True)


if __name__ == '__main__':
    main()
