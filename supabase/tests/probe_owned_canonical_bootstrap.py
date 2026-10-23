"""Owned real scheduler/interleaving proof; never attributes an unretained CI delta."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'tests/controlled-drugs/engine/candidate'
sys.path.insert(0, str(SOURCE))
sys.path.insert(0, str(ROOT / 'scripts'))
import owned_canonical_bootstrap as owned
from canonical_review_prefix import admit_canonical206
from secondary_review_cli_body import check_cli_body
from secondary_review_gate_a import HeldBackend
from secondary_review_ledger import unique
import canonical_post206 as post
spec = importlib.util.spec_from_file_location('owned_scheduler_base', SOURCE / 'probe-secondary-review.py')
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)

WORK_SECONDS = 900
CLEANUP_SECONDS = 180
MESSAGE = 'Secondary-review original rows ledger or raw catalog changed'
TIMER_TABLES = {'public.scheduler_job_runs', 'public.scheduler_job_results'}
JOB_NAME = 'owned-canonical206-timer-proof'
JOB_COMMAND = "select public.scheduler_dispatch('dispatch-outbox')"


def source_inputs():
    result = {**base.source_inputs(), **owned.bootstrap_inputs(ROOT)}
    for name in ('supabase/tests/probe_owned_canonical_bootstrap.py',
                 'supabase/tests/test_owned_canonical_bootstrap_probe_harness.py',
                 'supabase/tests/test_owned_canonical_bootstrap_harness.py',
                 'scripts/restore-rehearsal/routine-inventory.sql',
                 'scripts/restore-rehearsal/access-inventory.sql'):
        result[name] = hashlib.sha256((ROOT / name).read_bytes()).hexdigest()
    return result


def saved_inputs(folder):
    files = list((folder / 'inputs').rglob('*'))
    assert not any(p.is_symlink() for p in files), 'Saved source links forbidden'
    return {str(p.relative_to(folder / 'inputs')): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in files if p.is_file()}


def lockpoint_source_check():
    """Prove the actual frozen statement order, never inject a new migration hook."""
    package = check_cli_body(SOURCE)
    statements = package['expected_statements']
    baseline = [i for i, s in enumerate(statements) if s.startswith('create temporary table controlled_review_release_before on commit drop as')]
    blocked = [i for i, s in enumerate(statements) if s.startswith('create table controlled_review.definitions(')]
    assert len(baseline) == len(blocked) == 1 and baseline[0] < blocked[0]
    assert 'FOREIGN KEY (product_id) REFERENCES public.catalog_products(id)' in statements[blocked[0]]
    assert not any('REFERENCES public.catalog_products' in s for s in statements[baseline[0] + 1:blocked[0]])
    return {'baseline_statement_index': baseline[0], 'blocked_statement_index': blocked[0],
            'blocked_statement_sha256': hashlib.sha256(statements[blocked[0]].encode()).hexdigest(),
            'body_sha256': package['body_sha256']}


def exact_primary_failure(result):
    assert result.returncode != 0, 'Unpaused installer must refuse changed original rows'
    envelopes = [json.loads(line, object_pairs_hook=unique)
                 for line in (result.stdout + '\n' + result.stderr).splitlines()
                 if line.lstrip().startswith('{')]
    assert len(envelopes) == 1, 'Exactly one structured CLI error required'
    value = envelopes[0]
    assert set(value) == {'_tag', 'error'} and value['_tag'] == 'Error'
    error = value['error']
    assert set(error) == {'code', 'message'} and error['code'] == 'MigrationApplyError'
    assert error['message'].splitlines()[0] == 'ERROR: ' + MESSAGE + ' (SQLSTATE 23514)', 'Exact primary preservation refusal required'
    return error['message'].splitlines()[0]


def verify_timer_delta(before, after):
    """Every original row/catalog participates; only the two genuine receipt tables differ."""
    assert set(before) == set(after)
    for key in set(before) - {'rows'}:
        assert before[key] == after[key], 'Rollback changed original component: ' + key
    assert set(before['rows']) == set(after['rows']), 'Rollback left new relations or lost originals'
    changed = {name for name in before['rows'] if before['rows'][name] != after['rows'][name]}
    assert changed == TIMER_TABLES, 'Unexpected original row delta: ' + ', '.join(sorted(changed))
    assert before['rows']['public.scheduler_job_runs'] == before['rows']['public.scheduler_job_results'] == []
    runs = after['rows']['public.scheduler_job_runs']
    results = after['rows']['public.scheduler_job_results']
    assert runs and len(runs) == len(results)
    assert {r['id'] for r in runs} == {r['run_id'] for r in results}
    assert any(r['job'] == 'dispatch-outbox' for r in runs)
    assert all(r['request_id'] is None and r['url_path'] == '/functions/v1/' + r['job'] for r in runs)
    assert all(r['outcome'] == 'configuration_missing' and r['status_code'] is None
               and r['error_message'] == 'Missing Vault secret(s): project_url, scheduler_worker_key' for r in results)
    return {name: {'before': before['rows'][name], 'after': after['rows'][name]} for name in sorted(changed)}


class Runtime(base.OwnedRuntime):
    def start(self, files):
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
        helper_evidence = self.folder / 'fresh-bootstrap'
        self.helper_failed_unverified = True
        try:
            self.command([sys.executable, '-B', str(ROOT / 'scripts/owned_canonical_bootstrap.py'),
                      '--run-synthetic-local', '--workdir', str(self.project),
                      '--migration-count', str(len(files)), '--evidence', str(helper_evidence),
                      '--exclude', 'realtime,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'], timeout=600)
        except BaseException:
            result = helper_evidence / 'result.json'
            if result.is_file() and json.loads(result.read_text()).get('failure_cleanup_complete') is True:
                self.helper_failed_unverified = False
            raise
        self.helper_failed_unverified = False
        self.started = True
        receipt = json.loads((helper_evidence / 'result.json').read_text())
        assert receipt['passed'] and receipt['scheduler_paused'] and receipt['migration_count'] == len(files) and len(files) in (204, 206)
        observed = self.verify()
        self.bind_container(receipt, observed)
        self.bootstrap_receipt = receipt
        self.record['bootstrap_receipt'] = str(helper_evidence / 'result.json')
        self.record['bootstrap_container_id'] = observed['Id']
        self.save()

    def bind_container(self, receipt, observed):
        assert observed['Id'] == receipt['container_id'], 'Owned bootstrap receipt/container mismatch'
        self.container = observed['Id']
        self.record['bootstrap_container_id'] = observed['Id']

    def verify(self, name=None):
        if (self.folder / 'fresh-bootstrap/config.toml').is_file():
            assert (self.project / 'supabase/config.toml').read_bytes() == (self.folder / 'fresh-bootstrap/config.toml').read_bytes(), 'Owned probe config changed'
            assert not any((directory / filename).exists() or (directory / filename).is_symlink()
                           for directory in (self.project, self.project / 'supabase')
                           for filename in ('.env.development.local', '.env.local', '.env.development', '.env')), 'Owned probe dotenv appeared'
        observed = super().verify(name)
        if name is None and 'bootstrap_container_id' in self.record:
            assert observed['Id'] == self.record['bootstrap_container_id'], 'Owned probe database replaced'
        return observed


class CliChild:
    def __init__(self, runtime, label):
        self.runtime, self.label = runtime, label
        self.stdout_path = runtime.folder / (label + '-stdout.log')
        self.stderr_path = runtime.folder / (label + '-stderr.log')
        self.stdout = self.stdout_path.open('x')
        self.stderr = self.stderr_path.open('x')
        self.argv = ['supabase', 'migration', 'up', '--local', '--workdir', str(runtime.project),
                     '--experimental=false', '--yes', '--output-format', 'json']
        (runtime.folder / (label + '-command.json')).write_text(json.dumps(self.argv))
        runtime.verify()
        owned.selected_inputs(ROOT, runtime.project, 206)
        self.process = subprocess.Popen(self.argv, stdout=self.stdout, stderr=self.stderr, text=True, cwd=ROOT)

    def collect(self):
        self.process.wait(timeout=self.runtime.remaining(180))
        self.stdout.close()
        self.stderr.close()
        return subprocess.CompletedProcess(self.argv, self.process.returncode,
                                           self.stdout_path.read_text(), self.stderr_path.read_text())

    def cleanup(self):
        if self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=self.runtime.remaining(10))
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=self.runtime.remaining(10))
        self.stdout.close()
        self.stderr.close()


def wait_for(runtime, query, seconds=20):
    until = time.monotonic() + runtime.remaining(seconds)
    while time.monotonic() < until:
        if runtime.query(query).strip() == 't':
            return
        time.sleep(.05)
    raise AssertionError('Owned scheduler observation deadline exceeded')


def observe_installer_wait(runtime, holder, child):
    pid = holder.identity['held_backend']
    until = time.monotonic() + runtime.remaining(120)
    while time.monotonic() < until:
        assert holder.process.poll() is None and child.process.poll() is None, 'Owned lock/CLI exited before observed wait'
        query = """select coalesce(jsonb_agg(jsonb_build_object(
 'pid',a.pid,'backend_start',a.backend_start,'query_start',a.query_start,'query',a.query,
 'relation',l.relation::regclass::text,'mode',l.mode,'blockers',to_jsonb(pg_blocking_pids(a.pid)),
 'holder_backend_start',(select backend_start from pg_stat_activity where pid=__PID__))), '[]')
from pg_stat_activity a join pg_locks l on l.pid=a.pid where a.datname='postgres'
and a.wait_event_type='Lock' and l.locktype='relation'
and l.relation='public.catalog_products'::regclass and l.mode='ShareRowExclusiveLock' and not l.granted
and __PID__=any(pg_blocking_pids(a.pid))
and exists(select 1 from pg_locks barrier where barrier.pid=a.pid and barrier.locktype='advisory'
 and barrier.classid=90271040 and barrier.objid=0 and barrier.objsubid=2 and barrier.granted and barrier.mode='ExclusiveLock');""".replace('__PID__', str(pid))
        values = json.loads(runtime.query(query))
        if len(values) == 1:
            value = values[0]
            assert value['holder_backend_start'] == holder.identity['backend_start']
            assert value['backend_start'] and value['query_start'] and value['pid'] != pid
            assert value['query'].startswith('create table controlled_review.definitions('), 'Wrong installer statement blocked'
            return value
        assert not values, 'Ambiguous installer backend wait'
        time.sleep(.05)
    raise AssertionError('Actual post-baseline foreign-key lock wait not observed')


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, newurl):
        raise RuntimeError('Owned health endpoint redirect refused')


def fresh_observations(runtime, folder, save, proof):
    runtime.start(sorted((ROOT / 'supabase/migrations').glob('*.sql')))
    for name in ('routine-inventory', 'access-inventory'):
        raw = runtime.query((ROOT / 'scripts/restore-rehearsal' / (name + '.sql')).read_text())
        (folder / ('fresh-' + name + '.json')).write_text(raw + '\n')
    # Retain owner and ACL statements. Raw catalogs and schema dumps are evidence,
    # not newly minted independent expectations or a cross-runtime equality claim.
    schemas = json.loads(runtime.query("select jsonb_agg(nspname order by nspname) from pg_namespace where nspname in('public','auth','storage','extensions','supabase_migrations','controlled_stock','controlled_review');"))
    assert set(schemas) == {'public', 'auth', 'storage', 'extensions', 'supabase_migrations', 'controlled_review'}
    save('fresh-selected-schemas', schemas)
    runtime.verify()
    dump = runtime.command(['docker', 'exec', runtime.record['bootstrap_container_id'], 'pg_dump',
                            '-U', 'postgres', '-d', 'postgres', '--schema-only']
                           + ['--schema=' + name for name in schemas], timeout=120)
    (folder / 'fresh-schema-owner-acl.sql').write_text(dump.stdout)
    save('fresh-full-post206-snapshot', post.snapshot(runtime.query))
    status = json.loads(runtime.command(['supabase', 'status', '--workdir', str(runtime.project), '--output', 'json']).stdout)
    assert status['API_URL'] == 'http://127.0.0.1:64661'
    assert isinstance(status['SERVICE_ROLE_KEY'], str) and status['SERVICE_ROLE_KEY']
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    observations = []
    for label, path in (('auth', '/auth/v1/health'), ('rest', '/rest/v1/'), ('storage', '/storage/v1/status')):
        url = status['API_URL'] + path
        request = urllib.request.Request(url, headers={'apikey': status['SERVICE_ROLE_KEY'],
                    'Authorization': 'Bearer ' + status['SERVICE_ROLE_KEY']}, method='GET')
        with opener.open(request, timeout=runtime.remaining(30)) as response:
            assert response.status == 200 and response.geturl() == url
            raw = response.read(1024 * 1024 + 1)
            assert len(raw) <= 1024 * 1024, 'Owned health response exceeded bound'
        (folder / ('fresh-health-' + label + '.bin')).write_bytes(raw)
        observations.append({'endpoint': path, 'status': 200, 'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()})
    save('fresh-readonly-health', observations)
    runtime.query(owned.SAFE_SQL)
    wait_for(runtime, owned.DRAIN_SQL)
    proof['fresh206_exact_ledger_parent_and_private_seals'] = True
    proof['readonly_auth_rest_storage_health'] = True
    proof['raw_inventory_equivalence_claimed'] = False


def run(fresh_only=False):
    os.umask(0o077)
    folder = Path(tempfile.mkdtemp(prefix='lrv-owned-bootstrap-interleaving-evidence-'))
    print('Private evidence: ' + str(folder), flush=True)
    hashes = source_inputs()
    for name, digest in hashes.items():
        target = folder / 'inputs' / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / name, target)
        assert hashlib.sha256(target.read_bytes()).hexdigest() == digest
    (folder / 'source-hashes.json').write_text(json.dumps(hashes, sort_keys=True, indent=2))
    def save(name, value):
        (folder / (name + '.json')).write_text(json.dumps(value, sort_keys=True, indent=2) + '\n')
    proof = {'kind': 'owned-canonical206-fresh-observation-v1' if fresh_only else 'owned-canonical206-scheduler-interleaving-v1', 'passed': False,
             'workload_budget_seconds': WORK_SECONDS, 'cleanup_reserve_seconds': CLEANUP_SECONDS,
             'original_ci_delta_proven': False, 'hosted_writes': 0, 'provider_requests': 0}
    runtime = Runtime(folder, workload_seconds=WORK_SECONDS)
    holder = child = None
    original_endpoint = os.environ.get('DOCKER_HOST')
    original_context = os.environ.get('DOCKER_CONTEXT')
    began = time.monotonic()
    try:
        assert not (original_endpoint and original_context), 'Ambiguous Docker host/context overrides forbidden'
        endpoint = original_endpoint
        if endpoint is None:
            contexts = json.loads(runtime.command(['docker', 'context', 'inspect']).stdout)
            assert len(contexts) == 1
            endpoint = contexts[0]['Endpoints']['docker']['Host']
        assert isinstance(endpoint, str) and endpoint.startswith('unix:///'), 'Local Unix Docker required'
        # This is a standalone proof process. Pin its inherited CLI/held-backend
        # children to the same local endpoint for their complete lifetime.
        os.environ['DOCKER_HOST'] = endpoint
        os.environ.pop('DOCKER_CONTEXT', None)
        proof['docker_endpoint'] = endpoint
        if fresh_only:
            fresh_observations(runtime, folder, save, proof)
        else:
            proof['lockpoint_source'] = lockpoint_source_check()
            base.bootstrap(runtime)
            assert source_inputs() == hashes
            runtime.query(owned.SAFE_SQL)
            assert runtime.query("select current_setting('cron.launch_active_jobs')='off' and not exists(select 1 from public.scheduler_job_runs) and not exists(select 1 from public.scheduler_job_results);").strip() == 't'
            assert runtime.query("select not exists(select 1 from cron.job where jobname='" + JOB_NAME + "');").strip() == 't'
            job = int(runtime.query("select cron.schedule('" + JOB_NAME + "','1 second',$command$" + JOB_COMMAND + "$command$);").strip())
            schedules = runtime.query("select coalesce(jsonb_agg(to_jsonb(j) order by jobid),'[]') from cron.job j;")
            save('schedules', json.loads(schedules))
            before = post.snapshot(runtime.query)
            save('before-unpaused-attempt', before)
            assert 'controlled_review' not in before['catalog']['schemas']
            holder = HeldBackend(runtime, 'begin;lock table public.catalog_products in share mode;', 'catalog-products-holder')
            admitted = admit_canonical206(SOURCE, sorted((ROOT / 'supabase/migrations').glob('*.sql')))
            binding = admitted['binding206']
            migration = ROOT / binding['canonical_path']
            shutil.copy2(migration, runtime.project / 'supabase/migrations' / migration.name)
            assert hashlib.sha256(migration.read_bytes()).hexdigest() == binding['body_sha256']
            child = CliChild(runtime, 'unpaused206')
            observed = observe_installer_wait(runtime, holder, child)
            save('observed-after-baseline-wait', observed)
            runtime.sql('alter system set cron.launch_active_jobs=on;select pg_reload_conf();', user='supabase_admin')
            wait_for(runtime, "select exists(select 1 from public.scheduler_job_runs r join public.scheduler_job_results s on s.run_id=r.id where r.job='dispatch-outbox' and r.request_id is null and s.outcome='configuration_missing') and exists(select 1 from cron.job_run_details where jobid=" + str(job) + " and status='succeeded');")
            runtime.sql('alter system set cron.launch_active_jobs=off;select pg_reload_conf();', user='supabase_admin')
            wait_for(runtime, owned.DRAIN_SQL)
            save('actual-timer-runs', json.loads(runtime.query('select coalesce(jsonb_agg(to_jsonb(j) order by runid),\'[]\') from cron.job_run_details j where jobid=' + str(job) + ';')))
            runtime.query(owned.SAFE_SQL)
            holder.finish()
            holder = None
            refusal = child.collect()
            child = None
            proof['primary_refusal'] = exact_primary_failure(refusal)
            after = post.snapshot(runtime.query)
            save('after-refused-install', after)
            save('actual-original-row-delta', verify_timer_delta(before, after))
            assert runtime.query("select to_regnamespace('controlled_review') is null;").strip() == 't'
            assert runtime.query("select coalesce(jsonb_agg(to_jsonb(j) order by jobid),'[]') from cron.job j;") == schedules
            proof['real_scheduler_change_and_complete_installer_rollback'] = True
            # The same exact206 bytes now install with cron still paused. The proof
            # job and all existing schedules remain present and unchanged.
            assert source_inputs() == hashes
            paused_before = post.snapshot(runtime.query)
            save('before-paused-install', paused_before)
            child = CliChild(runtime, 'paused206')
            success = child.collect()
            child = None
            assert success.returncode == 0, 'Paused official206 installation failed'
            parent = json.loads((SOURCE / 'release-expected-204.json').read_text())
            installed = post.verify_installed(runtime.query, SOURCE, paused_before, binding, parent)
            save('after-paused-install', installed)
            runtime.query(owned.SAFE_SQL)
            wait_for(runtime, owned.DRAIN_SQL)
            assert runtime.query("select coalesce(jsonb_agg(to_jsonb(j) order by jobid),'[]') from cron.job j;") == schedules
            assert source_inputs() == hashes
            assert saved_inputs(folder) == hashes, 'Complete saved source keyset/bytes changed'
            proof['paused_exact_ledger_seals_and_original_rows_preserved'] = True
        assert source_inputs() == hashes
        assert saved_inputs(folder) == hashes, 'Complete saved source keyset/bytes changed'
        proof['workload_seconds'] = round(time.monotonic() - began, 3)
        runtime.remaining(1)
        proof['passed'] = True
    finally:
        cleanup_began = time.monotonic()
        cleanup_deadline = cleanup_began + CLEANUP_SECONDS
        runtime.cleanup_mode = True
        runtime.deadline = cleanup_deadline
        try:
            if child is not None:
                child.cleanup()
            if holder is not None and holder.process.poll() is None:
                holder.finish('rollback;')
            assert not getattr(runtime, 'helper_failed_unverified', False), 'Bootstrap cleanup was not verified; retain owned workdir for investigation'
            guard = None
            if runtime.started:
                guard = owned.Bootstrap(ROOT, runtime.project, 0, '', False, folder / 'cleanup-verification', subprocess.run)
                assert guard.config_bytes == (folder / 'fresh-bootstrap/config.toml').read_bytes(), 'Original owned config changed before cleanup'
                guard.endpoint = endpoint
                guard.deadline = runtime.deadline
                guard.resources = runtime.bootstrap_receipt['resources']
                guard.container_id = runtime.bootstrap_receipt['container_id']
                guard.owned_resources()
            base.CLEANUP_RESERVE_SECONDS = runtime.remaining(CLEANUP_SECONDS)
            runtime.cleanup()
            if guard is not None:
                assert not any(guard.inventory()), 'Owned resources survived cleanup'
            assert source_inputs() == hashes, 'Source inputs changed through cleanup'
            assert saved_inputs(folder) == hashes, 'Saved source keyset/bytes changed through cleanup'
            assert time.monotonic() < cleanup_deadline, 'Shared cleanup deadline exceeded'
            proof['cleanup_seconds'] = round(time.monotonic() - cleanup_began, 3)
            proof['owned_cleanup_verified'] = runtime.record['removed']
        except BaseException:
            proof['passed'] = False
            raise
        finally:
            save('result', proof)
            if not runtime.log.closed:
                runtime.log.close()
            for key, original in (('DOCKER_HOST', original_endpoint), ('DOCKER_CONTEXT', original_context)):
                if original is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = original
    assert proof['passed'] and proof['owned_cleanup_verified']
    print(('Owned fresh206 observation passed.' if fresh_only else 'Owned scheduler interference reproduced; paused canonical206 installation passed.') + ' Private evidence: ' + str(folder), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run-synthetic-local', action='store_true', required=True)
    parser.add_argument('--fresh-only', action='store_true', help='Fresh206 inventory and read-only health only; no timer interleaving')
    args = parser.parse_args()
    run(fresh_only=args.fresh_only)
