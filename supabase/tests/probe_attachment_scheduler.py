"""Owned synthetic timer/source-preservation proof for attachment clone rehearsals."""
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

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'tests/controlled-drugs/engine/candidate'
sys.path.insert(0, str(SOURCE))
spec = importlib.util.spec_from_file_location('attachment_owned_runtime', SOURCE / 'probe-secondary-review.py')
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
from owned_attachment_scheduler import paused_attachment_scheduler
from owned_attachment_clone import atomic, verify_source_unchanged


def inputs():
    files = {ROOT / name for name in base.source_inputs()}
    files.update((ROOT / 'supabase/tests').glob('*.py'))
    files.update((ROOT / 'supabase/tests').glob('*.test.sql'))
    return {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(files)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run-synthetic-local', action='store_true', required=True)
    parser.parse_args()
    os.umask(0o077)
    folder = Path(tempfile.mkdtemp(prefix='lrv-attachment-scheduler-evidence-'))
    hashes = inputs()
    for name, digest in hashes.items():
        target = folder / 'inputs' / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / name, target)
        assert hashlib.sha256(target.read_bytes()).hexdigest() == digest
    (folder / 'source-hashes.json').write_text(json.dumps(hashes, indent=2))
    print('Protected evidence: ' + str(folder), flush=True)
    runtime = base.OwnedRuntime(folder, workload_seconds=900)
    proof = {'kind': 'owned-attachment-scheduler-proof-v1', 'passed': False,
             'workload_budget_seconds': 900, 'cleanup_reserve_seconds': 180,
             'prior_ci_changed_component_proven': False, 'hosted_writes': 0, 'provider_requests': 0}
    started = time.monotonic()
    def save(name, value):
        (folder / (name + '.json')).write_text(json.dumps(value, indent=2))
    def wait_for(query, deadline=12):
        until = time.monotonic() + deadline
        while time.monotonic() < until:
            if runtime.query(query).strip() == 't':
                return
            time.sleep(.1)
        raise AssertionError('Owned timer observation deadline exceeded')
    def logged_run(argv, **kwargs):
        # All helper queries and ownership observations retained privately.
        return runtime.command(argv, kwargs.get('input'), timeout=kwargs.get('timeout', 30), fail=False)
    try:
        base.bootstrap(runtime)
        assert runtime.query("select not exists(select 1 from vault.secrets where name in('project_url','scheduler_worker_key')) and not exists(select 1 from net.http_request_queue);").strip() == 't'
        # Seed actual missing-configuration receipts before observation, so ordinary
        # cadence cannot add its first receipt during the independent timer proof.
        runtime.query("select public.scheduler_dispatch(job) from unnest(array['dispatch-outbox','process-inbound','process-stripe-events','queue-reminders','cleanup-abandoned-attachment']) job;")
        assert runtime.query("select to_regclass('public.attachment_scheduler_probe') is null and not exists(select 1 from cron.job where jobname='owned-attachment-timer-proof');").strip() == 't'
        runtime.query('create table public.attachment_scheduler_probe(id bigint generated always as identity primary key, stamp timestamptz not null default clock_timestamp());')
        job = int(runtime.query("select cron.schedule('owned-attachment-timer-proof','1 second',$$insert into public.attachment_scheduler_probe default values$$);").strip())
        before = atomic._snapshot(runtime.query)
        save('timer-before', before)
        runtime.sql('alter system reset cron.launch_active_jobs;select pg_reload_conf();', user='supabase_admin')
        wait_for("select current_setting('cron.launch_active_jobs')='on' and exists(select 1 from public.attachment_scheduler_probe);")
        save('timer-after-unpaused', atomic._snapshot(runtime.query))
        try:
            verify_source_unchanged(runtime.query, before)
        except AssertionError as error:
            assert 'public.attachment_scheduler_probe' in str(error)
            proof['unpaused_real_timer_source_change_refused'] = True
            proof['safe_mismatch_diagnostic'] = str(error)
        else:
            raise AssertionError('Actual timer mutation was silently accepted')
        with paused_attachment_scheduler(runtime.project / 'supabase/config.toml', run=logged_run) as state:
            paused = atomic._snapshot(runtime.query)
            save('paused-before', paused)
            time.sleep(2.2)
            assert verify_source_unchanged(runtime.query, paused)
            save('paused-after', atomic._snapshot(runtime.query))
            count = int(runtime.query('select count(*) from public.attachment_scheduler_probe;').strip())
        save('scheduler-restoration', state)
        assert state['restored'] and state['override_provenance_restored'] and state['schedules_unchanged']
        wait_for('select count(*)>' + str(count) + ' from public.attachment_scheduler_probe;')
        proof['paused_exact_source_preservation_and_resumed_timer'] = True
        # Remove only the independently named/identified proof fixture, under pause.
        assert runtime.query("select count(*)=1 from cron.job where jobid=" + str(job) + " and jobname='owned-attachment-timer-proof' and command='insert into public.attachment_scheduler_probe default values';").strip() == 't'
        runtime.query('select cron.unschedule(' + str(job) + ');')
        with paused_attachment_scheduler(runtime.project / 'supabase/config.toml', run=logged_run):
            runtime.query('drop table public.attachment_scheduler_probe;')
        for name in ('ezyvet_attachment_metadata_concurrency.py', 'ezyvet_attachment_originals_concurrency.py'):
            print('Running ' + name, flush=True)
            before_case = atomic._snapshot(runtime.query)
            save(name + '-source-before', before_case)
            result = runtime.command([sys.executable, '-B', str(ROOT / 'supabase/tests' / name), '--run-synthetic-local', '--project-config', str(runtime.project / 'supabase/config.toml')], timeout=450)
            assert 'checks passed' in result.stdout
            after_case = atomic._snapshot(runtime.query)
            save(name + '-source-after', after_case)
            assert after_case == before_case, 'Complete parent source snapshot changed across attachment proof'
            proof[name] = {'passed': True, 'output': result.stdout.strip()}
        assert inputs() == hashes, 'Source inputs changed during proof'
        proof['passed'] = True
        proof['workload_seconds'] = round(time.monotonic() - started, 3)
    finally:
        runtime.cleanup()
        proof['owned_cleanup_verified'] = runtime.record['removed']
        save('result', proof)
    print(json.dumps(proof), flush=True)


if __name__ == '__main__':
    main()
