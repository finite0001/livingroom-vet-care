"""Gate B-only scheduler-first bootstrap of exact owned canonical206 copies.

The four SQL observations are copied byte-exact from the independently reviewed
owned bootstrap, commit19a532484ebce7064abe110aea002c518350e67a. No donor module is
imported at runtime. No independent metadata expectation is changed or captured.
"""
import hashlib
import json
import os
from pathlib import Path
import stat
import time

DONOR_COMMIT = '19a532484ebce7064abe110aea002c518350e67a'
DONOR_PATH = 'scripts/owned_canonical_bootstrap.py'
DONOR_SHA256 = '80a241e3a7022e8e2a3f0f440b80178b91a49696781329c518943b00be269bd5'
DONOR_LITERAL_SHA256 = {'ZERO_SQL': 'c1b0352e8d91d17a92604c6cf223d5fb9d08e83238c237b4cd33f56951548b0c', 'DRAIN_SQL': 'fc3c0521f632eb96986ee7b5bbc82f5535b3b7e9b8586ddd76afcd05f23dc963', 'SAFE_SQL': '7b1913d62cfd891f486b088ef10c4bb6090935cb855a2282091fad0542245476', 'LEDGER_SQL': 'a4e981c2fa6020b2884baa85486204c71aee5dd26911e55498eaf3e978b82c20'}

ZERO_SQL = "do $owned$ declare n bigint;begin\n if to_regclass('supabase_migrations.schema_migrations') is not null then\n  execute 'select count(*) from supabase_migrations.schema_migrations' into n;\n  if n<>0 then raise exception 'Owned bootstrap requires zero project ledger';end if;\n end if;\n if to_regclass('auth.users') is null or to_regclass('storage.buckets') is null then\n  raise exception 'Built-in Auth and Storage bootstrap required';end if;\nend $owned$;"

DRAIN_SQL = "create function pg_temp.owned_drained() returns boolean language plpgsql as $$\ndeclare active boolean;begin\n if current_setting('cron.launch_active_jobs')<>'off' then return false;end if;\n if exists(select 1 from pg_stat_activity where application_name='pg_cron' or backend_type='pg_cron') then return false;end if;\n if to_regclass('cron.job_run_details') is not null then\n  execute 'select exists(select 1 from cron.job_run_details where status in(''starting'',''connecting'',''sending'',''running''))' into active;\n  if active then return false;end if;\n end if;\n return true;end$$;select pg_temp.owned_drained();"

SAFE_SQL = "do $owned$ declare unsafe boolean;begin\n if to_regclass('vault.secrets') is not null then\n  execute 'select exists(select 1 from vault.secrets where name in(''project_url'',''scheduler_worker_key''))' into unsafe;\n  if unsafe then raise exception 'Configured local provider dispatch forbidden';end if;\n end if;\n if to_regclass('net.http_request_queue') is not null then\n  execute 'select exists(select 1 from net.http_request_queue)' into unsafe;\n  if unsafe then raise exception 'Queued local HTTP forbidden';end if;\n end if;\nend $owned$;"

LEDGER_SQL = "create function pg_temp.owned_ledger()returns jsonb language plpgsql as $$\ndeclare result jsonb;begin\n if to_regclass('supabase_migrations.schema_migrations') is null then return '[]'::jsonb;end if;\n execute 'select coalesce(jsonb_agg(to_jsonb(m) order by version),''[]'') from supabase_migrations.schema_migrations m' into result;\n return result;end$$;select pg_temp.owned_ledger();"


DOTENV_NAMES = ('.env.development.local', '.env.local', '.env.development', '.env')


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


class PausedBootstrap:
    def __init__(self, runtime, package, files):
        self.runtime, self.package = runtime, package
        self.root = Path(__file__).resolve().parents[4]
        self.migrations = runtime.project/'supabase/migrations'
        self.staged = runtime.work/'gate-b-deferred-migrations'
        self.expected = {Path(name).name: digest for name, digest in package['input_source_hashes'].items()
                         if name.startswith('supabase/migrations/') and name.endswith('.sql')}
        expected_paths = sorted(self.root/'supabase/migrations'/name for name in self.expected)
        assert len(self.expected) == 206 and list(files) == expected_paths, 'Exact admitted canonical206 files required'
        assert len(package['expected_ledger206']) == 206, 'Exact independent canonical206 ledger required'
        self.files = expected_paths
        self.deferred = False
        self.used = False
        self.record = dict(kind='gate-b-paused-bootstrap-v1', passed=False, donor_commit=DONOR_COMMIT,
                           donor_source_sha256=DONOR_SHA256, donor_literal_sha256=DONOR_LITERAL_SHA256,
                           selected=dict(self.expected), deferred=False, restored=False,
                           work_retained_required=False, phase_command_cap_seconds=120)
        self.save()

    def save(self):
        path = self.runtime.folder/'paused-bootstrap.json'
        path.write_text(json.dumps(self.record, indent=2, sort_keys=True)+'\n')
        path.chmod(0o600)

    def tree(self, directory):
        assert directory.is_dir() and not directory.is_symlink(), 'Owned migration directory missing or symlink'
        entries = list(directory.iterdir())
        assert {p.name for p in entries} == set(self.expected), 'Owned migration copy keyset differs'
        assert all(stat.S_ISREG(p.lstat().st_mode) and not p.is_symlink() for p in entries), 'Owned migration copy must contain only regular files'
        assert {p.name:sha(p) for p in entries} == self.expected, 'Owned migration copy bytes differ'

    def sources(self):
        self.runtime.check_config()
        assert all(not p.is_symlink() and stat.S_ISREG(p.lstat().st_mode) and sha(p) == self.expected[p.name]
                   for p in self.files), 'Canonical source bytes changed'
        for directory in (self.runtime.project, self.runtime.project/'supabase'):
            assert all(not (directory/name).exists() and not (directory/name).is_symlink() for name in DOTENV_NAMES), 'Owned bootstrap dotenv forbidden'
        seed = self.runtime.project/'supabase/seed.sql'
        assert not seed.exists() and not seed.is_symlink(), 'Unexpected owned seed input'

    def environment(self):
        allowed = {'SUPABASE_ACCESS_TOKEN', 'SUPABASE_INTERNAL_IMAGE_REGISTRY'}
        assert not any(k.startswith('PG') or (k.startswith('SUPABASE_') and k not in allowed) for k in os.environ), 'Inherited database override forbidden'
        assert os.environ.get('SUPABASE_INTERNAL_IMAGE_REGISTRY', 'public.ecr.aws') in ('public.ecr.aws','ghcr.io'), 'Unreviewed image registry forbidden'

    def restore(self):
        if not self.deferred: return
        try:
            self.sources()
            self.tree(self.staged)
            if self.migrations.exists() or self.migrations.is_symlink():
                assert self.migrations.is_dir() and not self.migrations.is_symlink() and not any(self.migrations.iterdir()), 'Owned replacement migration directory is not empty'
                self.migrations.rmdir()
            self.staged.rename(self.migrations)
            self.tree(self.migrations)
            self.deferred = False
            self.record.update(deferred=False, restored=True)
            self.save()
        except BaseException:
            self.runtime.bootstrap_restore_failed = True
            self.record['work_retained_required'] = True
            self.save()
            raise

    def command(self, argv, text=None, timeout=120):
        return self.parent_command(argv, text=text, timeout=min(timeout,120), fail=True)

    def sql(self, query, admin=False, until=None):
        self.runtime.verify()
        limit = 120 if until is None else min(120, until-time.monotonic())
        assert limit > 0, 'Owned scheduler drain deadline exhausted'
        result = self.command(['docker','exec','-i',self.runtime.container,'psql','-X','-qAt','-U',
            'supabase_admin' if admin else 'postgres','-d','postgres','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'], query, timeout=limit)
        return result.stdout.strip()

    def drain(self):
        until = min(self.runtime.deadline, time.monotonic()+12)
        previous = getattr(self.runtime, 'bootstrap_phase_deadline', None)
        assert previous is None, 'Nested bootstrap phase deadline refused'
        self.runtime.bootstrap_phase_deadline = until
        try:
            while time.monotonic() < until:
                value = self.sql(DRAIN_SQL, until=until)
                if value == 't' and time.monotonic() < until:return
                time.sleep(min(.05,max(0,until-time.monotonic())))
            raise AssertionError('Owned scheduler pause/drain deadline exceeded')
        finally:
            self.runtime.bootstrap_phase_deadline = previous

    def image(self):
        from history_environment import assert_bootstrap_image
        entry = self.runtime.verify()
        assert entry['State']['Running'] is True, 'Owned zero-project database not running'
        values = json.loads(self.command(['docker','image','inspect',entry['Image']]).stdout)
        assert len(values) == 1, 'One exact bootstrap image required'
        self.record['bootstrap_image'] = assert_bootstrap_image(entry['Config']['Image'],values[0])
        self.runtime.owned_services = self.runtime.service_inventory()
        assert entry['Id'] in self.runtime.owned_services, 'Owned database missing from immutable service inventory'
        self.runtime.record['owned_services'] = self.runtime.owned_services
        self.runtime.save()
        self.save()

    def run(self, argv, parent_command):
        assert not self.used, 'Paused bootstrap cannot be retried'
        self.used = True
        self.parent_command = parent_command
        self.environment()
        self.sources()
        self.tree(self.migrations)
        assert self.staged.parent == self.runtime.work and not self.staged.exists() and not self.staged.is_symlink(), 'Deferred migration destination already exists'
        # The repository is never renamed: only the verified copy below owned work.
        try:
            self.migrations.rename(self.staged)
            self.deferred = True
            self.record['deferred'] = True
            self.save()
            self.migrations.mkdir(mode=0o700)
            network_id = self.runtime.network.prepare()
            result = self.command(list(argv)+['--network-id',network_id,'--experimental=false'])
            self.image()
            self.sql(ZERO_SQL)
            self.sql(SAFE_SQL)
            self.record['zero_project_admitted'] = True
            self.sql('alter system set cron.launch_active_jobs=off;select pg_reload_conf();',admin=True)
            self.drain()
            self.record['paused_before_project_migrations'] = True
            self.save()
        except BaseException as primary:
            self.record.setdefault('primary_failure', {'type':type(primary).__name__, 'message':str(primary)})
            try:
                self.save()
            except OSError:
                # Preserve the original traceback if evidence storage itself fails.
                primary.add_note('Private bootstrap receipt could not be written')
            raise
        finally:
            try:
                self.restore()
            except BaseException as restoration:
                self.record.setdefault('restoration_failure', {'type':type(restoration).__name__, 'message':str(restoration)})
                try:
                    self.save()
                except OSError:
                    restoration.add_note('Private restoration receipt could not be written')
                raise
        self.sources()
        self.tree(self.migrations)
        self.command(['supabase','migration','up','--local','--workdir',str(self.runtime.project),'--experimental=false'])
        self.drain()
        self.sql(SAFE_SQL)
        actual = json.loads(self.sql(LEDGER_SQL))
        assert actual == self.package['expected_ledger206'], 'Actual ledger differs from independent canonical206 expectation'
        self.sql(self.package['preflight_sql'])
        self.sources()
        self.tree(self.migrations)
        self.record.update(passed=True, exact206_ledger=True, parent_private206_seals=True, safe_queue=True,
                           ledger_sha256=hashlib.sha256(json.dumps(actual,sort_keys=True,separators=(',',':')).encode()).hexdigest())
        self.save()
        return result
