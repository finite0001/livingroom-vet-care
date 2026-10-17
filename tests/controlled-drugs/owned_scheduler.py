"""Quiesce pg_cron only in a verified, explicitly synthetic local runtime."""
from contextlib import contextmanager
import json
from pathlib import Path
import re
import subprocess
import time


@contextmanager
def paused_owned_scheduler(project, identity, *, run=subprocess.run,
                           clock=time.monotonic, sleep=time.sleep):
    project = Path(project).resolve()
    if not re.fullmatch(r'lrv-(?:prescription|controlled-engine)-[A-Za-z0-9-]+', identity):
        raise RuntimeError('Only an owned synthetic stock runtime may pause its scheduler')
    container = 'supabase_db_' + identity

    def verify():
        expected = 'project_id = "' + identity + '"'
        if project.joinpath('supabase/config.toml').read_text().splitlines()[0] != expected:
            raise RuntimeError('Owned scheduler project identity mismatch')
        inspected = run(['docker', 'inspect', container], capture_output=True,
                        text=True, timeout=30)
        if inspected.returncode:
            raise RuntimeError('Owned scheduler container unavailable')
        labels = json.loads(inspected.stdout)[0]['Config']['Labels']
        if labels.get('com.supabase.cli.project') != identity or Path(
            labels.get('com.supabase.cli.workdir', '')
        ).resolve() != project:
            raise RuntimeError('Owned scheduler container identity mismatch')

    def sql(query, admin=False):
        result = run(['docker', 'exec', '-i', container, 'psql', '-X', '-qAt',
                      '-U', 'supabase_admin' if admin else 'postgres', '-d', 'postgres',
                      '-v', 'ON_ERROR_STOP=1'], input=query, capture_output=True,
                     text=True, timeout=30)
        if result.returncode:
            raise RuntimeError('Owned scheduler state could not be verified')
        return result.stdout.strip()

    def observe(expected, drained=False):
        deadline = clock() + 12
        query = "select current_setting('cron.launch_active_jobs')='" + expected + "'"
        if drained:
            # pg_cron uses either libpq clients or background workers. The run
            # ledger also covers a task that is still connecting/starting.
            query += ("and not exists(select 1 from pg_stat_activity where "
                      "application_name='pg_cron' or backend_type='pg_cron')"
                      "and not exists(select 1 from cron.job_run_details where "
                      "status in('starting','connecting','sending','running'))")
        while clock() < deadline:
            if sql(query + ';') == 't':
                return
            sleep(.05)
        raise RuntimeError('Owned scheduler did not reach the required state')

    verify()
    original = sql("select current_setting('cron.launch_active_jobs');")
    if original not in ('on', 'off'):
        raise RuntimeError('Unexpected owned scheduler setting')
    state = {'initial': original, 'paused_and_drained': False, 'restored': False}
    try:
        if original == 'on':
            sql("alter system set cron.launch_active_jobs=off;select pg_reload_conf();", True)
        observe('off', drained=True)
        state['paused_and_drained'] = True
        yield state
    finally:
        if original == 'on':
            verify()
            sql("alter system set cron.launch_active_jobs=on;select pg_reload_conf();", True)
            observe('on')
        else:
            observe('off')
        state['restored'] = True
