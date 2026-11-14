"""Apply exactly the five staff successors inside the existing owned 214 rehearsal.

No budgets, historical descriptors, expected original rows or safety guards are relaxed.
This extends source admission to a real 219 ledger and rechecks medication metadata.
"""
import json
import time

NEW_TABLES = {
    'workforce.' + name: (1 if name == 'settings' else 0)
    for name in ('mutation_receipts','access','settings','audit','leave_policies','leave_policy_history','leave_accounts',
                 'leave_requests','leave_ledger','shifts','holidays','periods','time_approvals',
                 'clock_flags','corrections','job_receipts','posts','post_ack','team_tasks','rotations',
                 'events','event_signups','milestones','milestone_dismissals','pay_rates','bonuses',
                 'payroll_snapshots','benefits','review_cycles','review_eligibility','review_responses','backup_runs')
}
NEW_TABLES.update({'clinical_tools.' + name: 0 for name in ('protocols','calculations','pill_references','helper_jobs')})


def install(runtime, installation, receiver, release):
    target = runtime.install
    if len(target.operational_ledger) != 214:
        raise ValueError('Complete independently verified 214 prefix required')
    root = installation.ROOT
    installation.process.run(['node', str(root / 'scripts/workforce/frame-migrations.mjs'), '--check'],
                             timeout=runtime.remaining(30), cwd=root, check=True)
    manifests = installation.prefix.staff_successors(root)
    before = receiver.observe(runtime, 'staff219-before-complete-data')
    expected = list(target.operational_ledger)
    for manifest in manifests:
        destination = target.project / 'supabase/migrations' / manifest['migration']
        with destination.open('xb') as stream:
            stream.write(installation.prefix.regular(root / 'supabase/migrations' / manifest['migration']))
        target.project_pins[manifest['migration']] = manifest['framing']['sha256']
        expected.append(dict(version=manifest['migration'][:14],name=manifest['migration'][15:-4],
                             **{key: manifest['framing'][key] for key in ('statement_count','postgres_array_sha256','postgres_array_bytes')}))
    target.project_sources()
    previous = target.owner_end
    target.owner_end = min(target.phase_end,time.monotonic()+installation.OWNER_SECONDS,
                           previous if previous is not None else target.phase_end)
    try:
        runtime.verify()
        target.boot.command(['supabase','migration','up','--local','--workdir',str(target.project),'--experimental=false'],
                            timeout=runtime.remaining(30))
    finally:
        target.owner_end = previous
    release.verify_ledger(runtime, expected, 'staff219-complete-source-ledger')
    runtime.verify_module('staff219-retained-controlled-properties')
    after = receiver.observe(runtime, 'staff219-after-complete-data')
    installation.preserve(before['relations'],after['relations'],
                          {'supabase_migrations.schema_migrations':5,'storage.buckets':1,'cron.job':1},NEW_TABLES)
    expected_sequences = dict(before['sequences'])
    sequence = expected_sequences['cron.jobid_seq']
    expected_sequences['cron.jobid_seq'] = dict(last_value=sequence['last_value']+(1 if sequence['is_called'] else 0),is_called=True)
    expected_sequences['workforce.audit_id_seq'] = dict(last_value=1,is_called=False)
    if after['sequences'] != expected_sequences:
        raise ValueError('Only the declared new workforce identity and cron allocation may change sequences')
    state = runtime.selected_query('staff219-paused-job',
        "select jsonb_build_object('active',active,'command',command)from cron.job where jobname='workforce-hourly';")
    if state != {'active':False,'command':'select workforce.run_jobs();'}:
        raise ValueError('New workforce automation must remain paused in the owned rehearsal')
    target.operational_ledger = expected
    target.result.update({f"complete_source_derived{count}_ledger":True for count in range(215,220)})
    target.result.update(complete_source_derived219_ledger=True,
                         staff219_controlled_properties_rows_and_sequences_preserved=True,
                         staff219_automatic_jobs_paused=True)
    target.project_sources()
