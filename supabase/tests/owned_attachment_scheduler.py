"""Pause automatic jobs only in the explicitly selected local attachment server.

This never resolves a hosted connection or uses project credentials. Every SQL
command goes through docker exec against the same verified immutable container ID.
The source rows, schedules and independent canonical expectations stay intact.
"""
from contextlib import contextmanager
import json
import os
from pathlib import Path
import re
import subprocess
import time
import tomllib


@contextmanager
def paused_attachment_scheduler(project_config, *, run=subprocess.run,
                                clock=time.monotonic, sleep=time.sleep):
    if project_config is None:
        raise RuntimeError('Explicit local --project-config required for attachment rehearsal')
    config = Path(project_config).resolve()
    if config.name != 'config.toml' or config.parent.name != 'supabase':
        raise RuntimeError('Local Supabase project configuration required')
    endpoint = os.environ.get('DOCKER_HOST')
    if endpoint is None:
        context = run(['docker', 'context', 'inspect'], capture_output=True, text=True, timeout=30)
        if context.returncode:
            raise RuntimeError('Local Docker context unavailable')
        values = json.loads(context.stdout)
        if len(values) != 1:
            raise RuntimeError('One local Docker context required')
        endpoint = values[0]['Endpoints']['docker']['Host']
    if not isinstance(endpoint, str) or not endpoint.startswith('unix:///'):
        raise RuntimeError('Only a local Unix Docker socket may pause the attachment scheduler')
    original_config = config.read_bytes()
    identity = tomllib.loads(original_config.decode())['project_id']
    if not isinstance(identity, str) or not re.fullmatch(r'[A-Za-z0-9_-]+', identity):
        raise RuntimeError('Invalid local project identity')
    project = config.parent.parent
    container_name = 'supabase_db_' + identity
    container_id = None
    docker = ['docker', '--host', endpoint]

    def verify():
        nonlocal container_id
        if config.read_bytes() != original_config:
            raise RuntimeError('Attachment local project configuration changed')
        response = run(docker + ['inspect', container_name], capture_output=True,
                       text=True, timeout=30)
        if response.returncode:
            raise RuntimeError('Attachment local container unavailable')
        observations = json.loads(response.stdout)
        if len(observations) != 1:
            raise RuntimeError('One exact local database container required')
        observed = observations[0]
        labels = observed['Config']['Labels']
        current = observed['Id']
        if (labels.get('com.supabase.cli.project') != identity
                or Path(labels.get('com.supabase.cli.workdir', '')).resolve() != project
                or observed['Name'] != '/' + container_name
                or observed['State']['Running'] is not True
                or not re.fullmatch(r'[a-f0-9]{64}', current)
                or (container_id is not None and current != container_id)):
            raise RuntimeError('Attachment local container ownership changed')
        container_id = current

    def sql(query, admin=False):
        verify()
        result = run(docker + ['exec', '-i', container_id, 'psql', '-X', '-qAt',
                      '-U', 'supabase_admin' if admin else 'postgres', '-d', 'postgres',
                      '-v', 'ON_ERROR_STOP=1'], input=query, capture_output=True,
                     text=True, timeout=30)
        if result.returncode:
            raise RuntimeError('Attachment local scheduler command failed')
        return result.stdout.strip()

    def observe(expected, drained=False):
        deadline = clock() + 12
        query = "select current_setting('cron.launch_active_jobs')='" + expected + "'"
        if drained:
            query += (" and not exists(select 1 from pg_stat_activity where "
                      "application_name='pg_cron' or backend_type='pg_cron')"
                      " and not exists(select 1 from cron.job_run_details where "
                      "status in('starting','connecting','sending','running'))")
        while clock() < deadline:
            if sql(query + ';') == 't':
                return
            sleep(.05)
        raise RuntimeError('Attachment scheduler pause/drain deadline exceeded')

    original = sql("select current_setting('cron.launch_active_jobs');")
    if original not in ('on', 'off'):
        raise RuntimeError('Unexpected local scheduler configuration')
    safe = sql("select not exists(select 1 from vault.secrets where name in('project_url','scheduler_worker_key')) and not exists(select 1 from net.http_request_queue);")
    if safe != 't':
        raise RuntimeError('Attachment scheduler requires unconfigured local dispatch and empty HTTP queue')
    override_sql = "select coalesce(jsonb_agg(setting),'[]') from pg_file_settings where name='cron.launch_active_jobs' and sourcefile like '%/postgresql.auto.conf';"
    overrides = json.loads(sql(override_sql, True))
    if len(overrides) > 1 or any(value not in ('on', 'off') for value in overrides):
        raise RuntimeError('Unsupported local scheduler override provenance')
    schedule_sql = "select coalesce(jsonb_agg(to_jsonb(j) order by jobid),'[]') from cron.job j;"
    schedule = json.loads(sql(schedule_sql))
    state = {'initial': original, 'paused_and_drained': False, 'restored': False,
             'schedules_unchanged': False, 'container_id': container_id, 'endpoint': endpoint,
             'override_provenance_restored': False}
    try:
        if original == 'on':
            sql('alter system set cron.launch_active_jobs=off;select pg_reload_conf();', True)
        observe('off', drained=True)
        state['paused_and_drained'] = True
        yield state
    finally:
        # Restore even when a source comparison or rehearsal assertion failed.
        try:
            if json.loads(sql(schedule_sql)) != schedule:
                raise RuntimeError('Attachment source schedules changed')
            state['schedules_unchanged'] = True
        finally:
            if original == 'on':
                restore = ('alter system set cron.launch_active_jobs=' + overrides[0] + ';'
                           if overrides else 'alter system reset cron.launch_active_jobs;')
                sql(restore + 'select pg_reload_conf();', True)
            observe(original)
            if json.loads(sql(override_sql, True)) != overrides:
                raise RuntimeError('Attachment scheduler override provenance changed')
            state['override_provenance_restored'] = True
            state['restored'] = True
