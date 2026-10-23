"""Fresh local canonical bootstrap; defer project SQL until the scheduler is paused.

Only explicitly owned disposable projects are admitted. Canonical source and
independent ledger/seal expectations remain untouched. Success leaves the local
runtime running with cron paused; the caller owns normal cleanup.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time
import tomllib

ROOT = Path(__file__).resolve().parents[1]
CANDIDATE = 'tests/controlled-drugs/engine/candidate'
WORK_SECONDS = 420
CLEANUP_SECONDS = 120


def require(value, message):
    if not value:
        raise RuntimeError(message)


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def admission(root):
    require(not sys.flags.optimize and not os.environ.get('PYTHONOPTIMIZE'), 'Canonical admission requires Python assertions enabled')
    source = Path(root).resolve() / CANDIDATE
    # Every imported candidate module is bound by the existing complete admission.
    sys.path.insert(0, str(source))
    from canonical_review_prefix import admit_canonical206
    result = admit_canonical206(source, sorted((Path(root) / 'supabase/migrations').glob('*.sql')))
    for name in result['input_source_hashes']:
        path = Path(root).resolve() / name
        module = sys.modules.get(path.stem) if path.suffix == '.py' else None
        if module is not None:
            require(Path(module.__file__).resolve() == path, 'Canonical module imported from another checkout')
    return result


def bootstrap_inputs(root):
    root = Path(root).resolve()
    values = dict(admission(root)['input_source_hashes'])
    for name in ('scripts/owned_canonical_bootstrap.py', CANDIDATE + '/history_environment.py'):
        values[name] = digest((root / name).read_bytes())
    return values


def selected_inputs(root, project, count, versions=None):
    require(type(count) is int and 0 <= count <= 206, 'Explicit canonical prefix must be between 0 and 206')
    canonical = sorted((root / 'supabase/migrations').glob('*.sql'))
    if versions is None:
        canonical = canonical[:count]
    else:
        require(isinstance(versions, list) and len(versions) == count
                and all(isinstance(v, str) and re.fullmatch(r'[0-9]{14}', v) for v in versions)
                and versions == sorted(set(versions)), 'Explicit versions must be ordered, unique and count-bound')
        canonical = [p for p in canonical if p.name.split('_', 1)[0] in versions]
        require([p.name.split('_', 1)[0] for p in canonical] == versions, 'Unknown canonical migration version')
    selected = sorted((project / 'supabase/migrations').glob('*.sql'))
    require([p.name for p in selected] == [p.name for p in canonical], 'Selected project must contain exactly the admitted canonical prefix')
    require(all(not p.is_symlink() and p.read_bytes() == q.read_bytes() for p, q in zip(selected, canonical)), 'Selected migration bytes differ')
    return {p.name: digest(p.read_bytes()) for p in selected}


# Dynamic SQL is essential: zero-project bootstrap need not have pg_cron/net.
ZERO_SQL = """do $owned$ declare n bigint;begin
 if to_regclass('supabase_migrations.schema_migrations') is not null then
  execute 'select count(*) from supabase_migrations.schema_migrations' into n;
  if n<>0 then raise exception 'Owned bootstrap requires zero project ledger';end if;
 end if;
 if to_regclass('auth.users') is null or to_regclass('storage.buckets') is null then
  raise exception 'Built-in Auth and Storage bootstrap required';end if;
end $owned$;"""
DRAIN_SQL = """create function pg_temp.owned_drained() returns boolean language plpgsql as $$
declare active boolean;begin
 if current_setting('cron.launch_active_jobs')<>'off' then return false;end if;
 if exists(select 1 from pg_stat_activity where application_name='pg_cron' or backend_type='pg_cron') then return false;end if;
 if to_regclass('cron.job_run_details') is not null then
  execute 'select exists(select 1 from cron.job_run_details where status in(''starting'',''connecting'',''sending'',''running''))' into active;
  if active then return false;end if;
 end if;
 return true;end$$;select pg_temp.owned_drained();"""
SAFE_SQL = """do $owned$ declare unsafe boolean;begin
 if to_regclass('vault.secrets') is not null then
  execute 'select exists(select 1 from vault.secrets where name in(''project_url'',''scheduler_worker_key''))' into unsafe;
  if unsafe then raise exception 'Configured local provider dispatch forbidden';end if;
 end if;
 if to_regclass('net.http_request_queue') is not null then
  execute 'select exists(select 1 from net.http_request_queue)' into unsafe;
  if unsafe then raise exception 'Queued local HTTP forbidden';end if;
 end if;
end $owned$;"""
LEDGER_SQL = """create function pg_temp.owned_ledger()returns jsonb language plpgsql as $$
declare result jsonb;begin
 if to_regclass('supabase_migrations.schema_migrations') is null then return '[]'::jsonb;end if;
 execute 'select coalesce(jsonb_agg(to_jsonb(m) order by version),''[]'') from supabase_migrations.schema_migrations m' into result;
 return result;end$$;select pg_temp.owned_ledger();"""


class Bootstrap:
    def __init__(self, root, project, count, exclude, ignore_health_check, evidence, runner, versions=None):
        self.root, self.project = Path(root).resolve(), Path(project).resolve()
        self.count, self.exclude, self.ignore_health_check = count, exclude, ignore_health_check
        self.versions = versions
        self.runner = runner
        self.evidence = Path(evidence) if evidence else Path(tempfile.mkdtemp(prefix='lrv-owned-bootstrap-evidence-'))
        self.evidence.mkdir(mode=0o700, parents=True, exist_ok=True)
        require(not self.evidence.is_symlink() and self.evidence.stat().st_mode & 0o077 == 0, 'Private evidence directory required')
        self.sequence = 0
        self.deadline = time.monotonic() + WORK_SECONDS
        self.started = False
        self.container_id = None
        self.image_id = None
        self.resources = None
        self.env = dict(os.environ)
        require(not (self.env.get('DOCKER_HOST') and self.env.get('DOCKER_CONTEXT')), 'Ambiguous Docker host/context overrides forbidden')
        require(self.env.get('SUPABASE_INTERNAL_IMAGE_REGISTRY', 'public.ecr.aws') in ('public.ecr.aws', 'ghcr.io'), 'Unreviewed Supabase image registry forbidden')
        # Do not allow inherited CLI DB/config overrides or remote PostgreSQL tools.
        allowed_supabase = {'SUPABASE_ACCESS_TOKEN', 'SUPABASE_INTERNAL_IMAGE_REGISTRY'}
        unsafe = [k for k in self.env if k.startswith('PG') or (k.startswith('SUPABASE_') and k not in allowed_supabase)]
        require(not unsafe, 'Inherited database overrides forbidden: ' + ', '.join(sorted(unsafe)))
        self.config = self.project / 'supabase/config.toml'
        require(not self.config.is_symlink(), 'Owned project config cannot be a symlink')
        self.config_bytes = self.config.read_bytes()
        self.dotenv_paths = [directory / name for directory in (self.project, self.project / 'supabase')
                             for name in ('.env.development.local', '.env.local', '.env.development', '.env')]
        self.config_unchanged()
        require(not re.search(r'env\s*\(', self.config_bytes.decode()), 'Environment-interpolated project config forbidden')
        settings = tomllib.loads(self.config_bytes.decode())
        self.identity = settings['project_id']
        require(not settings.get('db', {}).get('settings'), 'Unreviewed database startup settings forbidden')
        auth = settings.get('auth', {})
        require(not any(v.get('enabled', False) for v in auth.get('external', {}).values()), 'External auth providers forbidden in owned bootstrap')
        require(not any(v.get('enabled', False) for v in auth.get('hook', {}).values()), 'External auth hooks forbidden in owned bootstrap')
        require(not any(v.get('enabled', False) for v in auth.get('sms', {}).values() if isinstance(v, dict)), 'SMS delivery providers forbidden in owned bootstrap')
        require(not auth.get('sms', {}).get('enable_signup', False)
                and not auth.get('email', {}).get('smtp', {}).get('enabled', False), 'Provider delivery forbidden in owned bootstrap')
        require(not settings.get('db', {}).get('vault', {}), 'Configured bootstrap vault forbidden')
        require(isinstance(self.identity, str) and re.fullmatch(r'[A-Za-z0-9_-]+', self.identity), 'Invalid explicit project identity')
        self.container = 'supabase_db_' + self.identity
        self.record = {'kind': 'owned-canonical-bootstrap-v1', 'project': str(self.project),
                       'identity': self.identity, 'migration_count': count, 'passed': False,
                       'evidence': str(self.evidence.resolve()),
                       'dotenv_presence': {str(p.relative_to(self.project)): False for p in self.dotenv_paths},
                       'work_seconds': WORK_SECONDS, 'cleanup_seconds': CLEANUP_SECONDS}

    def config_unchanged(self):
        require(self.config.read_bytes() == self.config_bytes, 'Owned project config changed')
        require(not any(p.exists() or p.is_symlink() for p in self.dotenv_paths), 'Loaded project dotenv files forbidden for owned bootstrap')

    def write(self, name, raw):
        path = self.evidence / name
        with path.open('xb') as target:
            os.chmod(path, 0o600)
            target.write(raw)

    def command_status(self, stem, began, limit, outcome, exit_code=None, error_type=None):
        status = {'sequence': self.sequence, 'outcome': outcome, 'exit_code': exit_code,
                  'timeout_seconds': limit, 'elapsed_seconds': round(max(0, time.monotonic() - began), 6),
                  'command_file': stem + '-command.json', 'stdout_file': stem + '-stdout.log',
                  'stderr_file': stem + '-stderr.log'}
        if error_type is not None:
            status['error_type'] = error_type
        if outcome != 'success':
            self.record.setdefault('first_failed_command', status)
        self.write(stem + '-status.json', (json.dumps(status, sort_keys=True) + '\n').encode())

    def command(self, argv, text=None, env=None, timeout=60):
        remaining = self.deadline - time.monotonic()
        require(remaining > 0, 'Owned bootstrap deadline exhausted')
        self.sequence += 1
        stem = f'{self.sequence:04d}'
        self.write(stem + '-command.json', json.dumps(argv).encode())
        if text is not None:
            self.write(stem + '-stdin.sql', text.encode())
        limit = min(timeout, remaining)
        began = time.monotonic()
        try:
            result = self.runner(argv, input=text, env=env or self.env, capture_output=True,
                                 text=True, cwd=self.root, timeout=limit)
        except subprocess.TimeoutExpired as error:
            self.command_status(stem, began, limit, 'timeout', error_type=type(error).__name__)
            for label, value in (('stdout', error.stdout), ('stderr', error.stderr)):
                self.write(stem + '-' + label + '.log', value.encode() if isinstance(value, str) else value or b'')
            raise RuntimeError('Owned bootstrap command timed out; private evidence retained') from error
        except BaseException as error:
            self.command_status(stem, began, limit, 'os_error' if isinstance(error, OSError) else 'runner_error',
                                error_type=type(error).__name__)
            raise
        self.command_status(stem, began, limit, 'success' if result.returncode == 0 else 'nonzero', result.returncode)
        self.write(stem + '-stdout.log', result.stdout.encode())
        self.write(stem + '-stderr.log', result.stderr.encode())
        require(result.returncode == 0, 'Owned bootstrap command failed; private evidence retained')
        return result.stdout.strip()

    def docker(self, *args):
        return self.command(['docker', '--host', self.endpoint, *args])

    def source_unchanged(self):
        self.config_unchanged()
        require(bootstrap_inputs(self.root) == self.sources, 'Bootstrap source closure changed')
        require(selected_inputs(self.root, self.project, self.count, self.versions) == self.selected, 'Selected project source changed')

    def inventory(self):
        # Enumerate all names as well as labels: an unlabeled stale volume is unsafe.
        containers = self.docker('ps', '-a', '--format', '{{.Names}}').splitlines()
        volumes = self.docker('volume', 'ls', '--format', '{{.Name}}').splitlines()
        networks = self.docker('network', 'ls', '--format', '{{.Name}}').splitlines()
        labels = self.docker('ps', '-aq', '--filter', 'label=com.supabase.cli.project=' + self.identity)
        volume_labels = self.docker('volume', 'ls', '-q', '--filter', 'label=com.supabase.cli.project=' + self.identity)
        network_labels = self.docker('network', 'ls', '-q', '--filter', 'label=com.supabase.cli.project=' + self.identity)
        names = [n for n in containers + volumes + networks if n.startswith('supabase_') and n.endswith('_' + self.identity)]
        return names, labels, volume_labels, network_labels

    def verify(self):
        self.config_unchanged()
        entries = json.loads(self.docker('inspect', self.container))
        require(len(entries) == 1, 'Exactly one owned database required')
        entry = entries[0]
        labels = entry['Config']['Labels']
        require(labels.get('com.supabase.cli.project') == self.identity
                and labels.get('com.supabase.cli.workdir') == str(self.project)
                and entry['Name'] == '/' + self.container and entry['State']['Running'] is True,
                'Owned database identity or workdir differs')
        require(re.fullmatch('[0-9a-f]{64}', entry['Id']), 'Immutable owned container ID required')
        require(self.container_id is None or entry['Id'] == self.container_id, 'Owned container replaced')
        require(self.image_id is None or entry['Image'] == self.image_id, 'Owned image replaced')
        self.container_id, self.image_id = entry['Id'], entry['Image']
        return entry

    def sql(self, query, admin=False):
        self.verify()
        return self.command(['docker', '--host', self.endpoint, 'exec', '-i', self.container_id,
                             'psql', '-X', '-qAt', '-U', 'supabase_admin' if admin else 'postgres',
                             '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], text=query)

    def drain(self):
        end = min(self.deadline, time.monotonic() + 12)
        while time.monotonic() < end:
            if self.sql(DRAIN_SQL) == 't':
                return
            time.sleep(.05)
        raise RuntimeError('Owned scheduler pause/drain deadline exceeded')

    def owned_resources(self):
        self.config_unchanged()
        result = {'containers': {}, 'volumes': {}, 'networks': {}}
        names = self.docker('ps', '-a', '--filter', 'label=com.supabase.cli.project=' + self.identity, '--format', '{{.Names}}').splitlines()
        for name in names:
            entries = json.loads(self.docker('inspect', name))
            require(len(entries) == 1, 'One owned service container required')
            entry = entries[0]
            labels = entry['Config']['Labels']
            require(name.startswith('supabase_') and name.endswith('_' + self.identity)
                    and entry['Name'] == '/' + name
                    and labels.get('com.supabase.cli.project') == self.identity
                    and labels.get('com.supabase.cli.workdir') == str(self.project)
                    and re.fullmatch('[0-9a-f]{64}', entry['Id']), 'Service ownership mismatch')
            if name == self.container and self.container_id is not None:
                require(entry['Id'] == self.container_id, 'Cleanup container replaced')
            result['containers'][name] = {'id': entry['Id'], 'image': entry['Image'], 'labels': labels}
        volumes = self.docker('volume', 'ls', '-q', '--filter', 'label=com.supabase.cli.project=' + self.identity).splitlines()
        for name in volumes:
            entries = json.loads(self.docker('volume', 'inspect', name))
            require(len(entries) == 1, 'One owned service volume required')
            entry = entries[0]
            labels = entry.get('Labels') or {}
            require(name.startswith('supabase_') and name.endswith('_' + self.identity)
                    and entry['Name'] == name and labels.get('com.supabase.cli.project') == self.identity,
                    'Volume ownership mismatch')
            if 'com.supabase.cli.workdir' in labels:
                require(labels['com.supabase.cli.workdir'] == str(self.project), 'Volume workdir mismatch')
            # Volumes have no Docker immutable ID. Bind creation time, mountpoint,
            # driver and complete labels, and refuse any later replacement.
            result['volumes'][name] = {key: entry[key] for key in ('Name', 'CreatedAt', 'Mountpoint', 'Driver', 'Labels')}
        networks = self.docker('network', 'ls', '--format', '{{.Name}}', '--filter', 'label=com.supabase.cli.project=' + self.identity).splitlines()
        for name in networks:
            entries = json.loads(self.docker('network', 'inspect', name))
            require(len(entries) == 1, 'One owned service network required')
            entry = entries[0]
            labels = entry.get('Labels') or {}
            require(name == 'supabase_network_' + self.identity and entry['Name'] == name
                    and labels.get('com.supabase.cli.project') == self.identity
                    and re.fullmatch('[0-9a-f]{64}', entry['Id']), 'Network ownership mismatch')
            if 'com.supabase.cli.workdir' in labels:
                require(labels['com.supabase.cli.workdir'] == str(self.project), 'Network workdir mismatch')
            attached = sorted((entry.get('Containers') or {}).keys())
            require(set(attached) <= {v['id'] for v in result['containers'].values()}, 'Foreign network container refused')
            result['networks'][name] = {'id': entry['Id'], 'labels': labels, 'attached_container_ids': attached}
        all_names, _, _, _ = self.inventory()
        require(set(all_names) == set(result['containers']) | set(result['volumes']) | set(result['networks']), 'Unlabeled project resources refused')
        if self.resources is not None:
            require(result == self.resources, 'Owned service resource inventory changed')
        return result

    def cleanup(self):
        self.deadline = time.monotonic() + CLEANUP_SECONDS
        self.owned_resources()
        self.command(['supabase', 'stop', '--workdir', str(self.project), '--no-backup', '--experimental=false'], timeout=90)
        require(not any(self.inventory()), 'Owned resources remain after failure cleanup')
        self.record['failure_cleanup_complete'] = True

    def execute(self):
        try:
            self.sources = bootstrap_inputs(self.root)
            self.selected = selected_inputs(self.root, self.project, self.count, self.versions)
            self.write('sources.json', json.dumps(self.sources, sort_keys=True, indent=2).encode())
            self.write('config.toml', self.config_bytes)
            self.write('selected.json', json.dumps(self.selected, sort_keys=True).encode())
            require(self.command(['supabase', '--version']) == '2.118.0', 'Pinned Supabase CLI 2.118.0 required')
            self.endpoint = self.env.get('DOCKER_HOST')
            if self.endpoint is None:
                contexts = json.loads(self.command(['docker', 'context', 'inspect']))
                require(len(contexts) == 1, 'One explicit Docker context required')
                self.endpoint = contexts[0]['Endpoints']['docker']['Host']
            require(isinstance(self.endpoint, str) and self.endpoint.startswith('unix:///'), 'Only local Unix Docker endpoint permitted')
            self.env.pop('DOCKER_CONTEXT', None)
            self.env['DOCKER_HOST'] = self.endpoint
            require(not any(self.inventory()), 'Fresh project identity required; preexisting resources refused')
            self.source_unchanged()
            start_env = dict(self.env, SUPABASE_DB_MIGRATIONS_ENABLED='false', SUPABASE_DB_SEED_ENABLED='false')
            argv = ['supabase', 'start', '--workdir', str(self.project), '--experimental=false']
            if self.exclude:
                argv += ['--exclude', self.exclude]
            if self.ignore_health_check:
                argv += ['--ignore-health-check']
            self.started = True
            self.command(argv, env=start_env, timeout=300)
            entry = self.verify()
            self.resources = self.owned_resources()
            self.record['resources'] = self.resources
            from history_environment import assert_bootstrap_image
            image = json.loads(self.docker('image', 'inspect', self.image_id))
            require(len(image) == 1, 'One exact bootstrap image required')
            self.record['bootstrap_image'] = assert_bootstrap_image(entry['Config']['Image'], image[0])
            self.sql(ZERO_SQL)
            self.sql(SAFE_SQL)
            self.sql('alter system set cron.launch_active_jobs=off;select pg_reload_conf();', admin=True)
            self.drain()
            self.source_unchanged()
            if self.count:
                self.command(['supabase', 'migration', 'up', '--local', '--workdir', str(self.project), '--experimental=false'], timeout=150)
            self.drain()
            self.sql(SAFE_SQL)
            from secondary_review_ledger import load_frozen
            source = self.root / CANDIDATE
            admitted = admission(self.root)
            expected = load_frozen(source)['ledger']
            binding = admitted['binding206']
            expected = expected + [{k: binding[k if k != 'statements' else 'expected_statements'] for k in ('version', 'name', 'statements')}]
            actual = json.loads(self.sql(LEDGER_SQL))
            expected = expected[:self.count] if self.versions is None else [row for row in expected if row['version'] in self.versions]
            require(actual == expected, 'Actual project ledger differs from independently frozen canonical prefix')
            if '20261020151157_controlled_stock_private_engine.sql' in self.selected:
                from secondary_review_release import parent_checks_sql, installed_checks_sql
                self.sql(parent_checks_sql(json.loads((source / 'release-expected-204.json').read_text())))
                if '20261022010000_controlled_secondary_review_private.sql' in self.selected:
                    from secondary_review_cli_body import check_cli_body
                    self.sql(installed_checks_sql(check_cli_body(source)['expected']))
            self.source_unchanged()
            self.owned_resources()
            self.record.update(passed=True, scheduler_paused=True, container_id=self.container_id,
                               ledger_sha256=digest(json.dumps(actual, sort_keys=True, separators=(',', ':')).encode()),
                               source_sha256=self.sources)
            return self.record
        except BaseException as primary:
            self.record.setdefault('primary_failure', {'type': type(primary).__name__, 'message': str(primary),
                'command_sequence': self.record.get('first_failed_command', {}).get('sequence')})
            if self.started:
                try:
                    self.cleanup()
                except BaseException as cleanup_error:
                    self.record['cleanup_error'] = str(cleanup_error)
            raise
        finally:
            self.write('result.json', (json.dumps(self.record, sort_keys=True, indent=2) + '\n').encode())


def bootstrap(root, workdir, count=206, exclude='', ignore_health_check=False, evidence=None, runner=subprocess.run, versions=None):
    return Bootstrap(root, workdir, count, exclude, ignore_health_check, evidence, runner, versions).execute()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run-synthetic-local', action='store_true', required=True)
    parser.add_argument('--workdir', type=Path, default=ROOT)
    parser.add_argument('--migration-count', type=int, default=206)
    parser.add_argument('--exclude', default='')
    parser.add_argument('--migration-versions', help='Explicit ordered comma-separated canonical versions for retained historical subsets')
    parser.add_argument('--ignore-health-check', action='store_true')
    parser.add_argument('--evidence', type=Path)
    args = parser.parse_args()
    try:
        result = bootstrap(ROOT, args.workdir, args.migration_count, args.exclude, args.ignore_health_check, args.evidence, versions=args.migration_versions.split(',') if args.migration_versions else None)
    except Exception as error:
        print('Owned canonical bootstrap refused: ' + str(error), file=sys.stderr)
        raise SystemExit(1) from error
    print('Owned canonical bootstrap passed: ' + str(result['migration_count']) + ' migrations; scheduler paused. Private receipt: ' + result['evidence'] + '/result.json')


if __name__ == '__main__':
    main()
