"""Owned Gate B reference with optional unadmitted managed candidate sanity.

The existing reviewed owned runtime is reused without changing its sources or
globals. Expected metadata comes solely from the independent source builder.
"""
import argparse
import json
import os
from pathlib import Path
import shutil
import tempfile
import time
import traceback

import record_review_v3_gate_a_runtime as owned
import record_review_v3_gate_b as assembly
import record_review_v3_gate_b_fixtures as fixtures
import record_review_v3_gate_b_snapshot as capture
import record_review_v3_owned_network as network
import record_review_v3_paused_bootstrap as paused
import record_review_v3_phased_session as phased
from canonical_review_prefix import admit_canonical206

SOURCE = Path(__file__).resolve().parent
ROOT = SOURCE.parents[3]
REFERENCE_SECONDS = 600


class Runtime(owned.Runtime):
    """Gate B-only paused bootstrap and explicit bridge; frozen base unchanged."""
    def __init__(self, folder, workload_seconds, package):
        super().__init__(folder, workload_seconds)
        self.package = package  # Already independently built and source-freeze bound.
        self.bootstrap = None
        self.bootstrap_restore_failed = False
        self.bootstrap_phase_deadline = None
        self.candidate_phase_deadline = None
        self.network = network.OwnedNetwork(self)

    def command(self, argv, text=None, timeout=120, fail=True):
        for phase_deadline in (getattr(self, 'bootstrap_phase_deadline', None),
                               getattr(self, 'candidate_phase_deadline', None)):
            if phase_deadline is not None:
                timeout = min(timeout, 120, phase_deadline-time.monotonic())
                assert timeout > 0, 'Owned bootstrap/candidate phase deadline exhausted'
        if argv[:2] == ['supabase', 'start']:
            assert text is None and fail is True, 'Unexpected bootstrap command contract'
            expected = ['supabase', 'start', '--workdir', str(self.project), '--exclude',
                'realtime,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor']
            assert argv == expected, 'Unexpected bootstrap argv; no network substitution'
            assert self.bootstrap is not None, 'Paused bootstrap must be explicitly admitted by start'
            return self.bootstrap.run(argv, super().command)
        return super().command(argv, text=text, timeout=timeout, fail=fail)

    def start(self, files):
        self.bootstrap = paused.PausedBootstrap(self, self.package, files)
        super().start(files)
        self.network.before_stop()  # Exact attached project/workdir/immutable IDs.

    def cleanup(self):
        if self.cleanup_deadline is None:
            self.cleanup_deadline = time.monotonic()+owned.CLEANUP_SECONDS
        self.deadline = self.cleanup_deadline
        try:
            if self.bootstrap_restore_failed:
                self.cleanup_retaining_work()
                return
            self.network.before_stop()  # Refuse foreign attachment before parent stop.
            super().cleanup()
            self.network.remove()  # Independent logs survive the parent's log close.
            assert self.network.removed and self.record['removed'] is True
            self.record['owned_network_removed'] = True
            self.save()
        except BaseException:
            self.record['removed'] = False
            self.record['owned_network_removed'] = False
            self.save()
            raise
        finally:
            if not self.log.closed: self.log.close()


    def cleanup_retaining_work(self):
        """Restoration conflict: keep work/config, clean only proved owned services."""
        assert not self.databases, 'Reference bootstrap must not own clone databases'
        self.record.update(removed=False, work_retained=True, services_removed=False, owned_network_removed=False)
        self.save()
        self.check_config()
        self.network.before_stop()
        observed = self.service_inventory()
        if self.owned_services:
            owned.assert_owned_inventory(self.owned_services, observed)
        else:
            self.owned_services = observed
            self.record['partial_bootstrap_services'] = observed
            self.save()
        if observed:
            super().command(['supabase','stop','--workdir',str(self.project),'--no-backup','--experimental=false'], timeout=120)
        for argv in (['docker','ps','-aq'],['docker','volume','ls','-q']):
            assert not super().command(argv+['--filter','label=com.supabase.cli.project='+self.identity], timeout=120).stdout.strip(), 'Owned services or volumes remain'
        self.record['services_removed'] = True
        self.save()
        self.network.remove()
        self.record['owned_network_removed'] = self.network.removed
        assert self.network.removed and self.work.exists(), 'Network removal or retained work not proved'
        self.save()
        owned.save(self.folder, 'cleanup-retained-work', dict(services_removed=True, network_removed=True,
                   work_retained=True, work=str(self.work), removed=False))


def bind_package_inputs(package, frozen):
    inputs = package['input_source_hashes']
    assert inputs and set(inputs) <= set(frozen), 'Package derivation input missing from frozen source map'
    assert {name: frozen[name] for name in inputs} == inputs, 'Package derivation changed before source freeze'
    for name, digest in package['source_hashes'].items():
        relative = str((SOURCE/name).relative_to(ROOT))
        assert relative in inputs and inputs[relative] == digest, 'Independent descriptor source missing or differs'


def install_proof(runtime, package, before):
    expected = package['expected']
    marker = package['markers']['admission']
    assert package['install'].count(marker) == 1
    sql = package['install'].replace(marker, marker+'\n'+capture.under_barrier_check(before), 1)
    marker = package['markers']['before_postcheck']
    assert sql.count(marker) == 1
    sql = sql.replace(marker, marker+'\n'+package['snapshot_sql'], 1)
    result = runtime.sql(sql, fail=False)
    observed = capture.parse(result.stdout)
    owned.save(runtime.folder, 'observed', observed)
    assert observed == expected, 'Observed metadata differs; retain failure, never reseal'
    assert result.returncode == 0, 'Reference transaction refused; inspect retained primary logs'
    assert capture.parse(runtime.query(package['snapshot_sql'])) == expected
    after = capture.snapshot(runtime.query)
    owned.save(runtime.folder, 'installed', after)
    ri = capture.parse(runtime.query(capture.PARENT_RI_SQL))
    owned.save(runtime.folder, 'parent-ri', ri)
    capture.preserved(before, after, ri, expected)
    return after


PROVENANCE_LABELS = (
    'compensation_movement_absent', 'compensation_movement_partial',
    'correction_actor', 'correction_missing', 'discrepancy_actor',
    'discrepancy_missing', 'dispense_movement_absent', 'dispense_movement_partial',
    'dispense_parent_links_absent', 'dispense_parent_links_partial',
    'pickup_actor', 'pickup_missing', 'restock_movement_absent',
    'restock_movement_actor', 'restock_movement_partial', 'restock_movement_root',
    'restock_movement_writer', 'return_missing', 'return_v1_actor',
    'return_v1_wrong_writer', 'return_v2_actor', 'return_v2_wrong_writer',
)


ROLE_PROFILE = dict(server_version='17.6', roles=[
    dict(name='postgres', superuser=False, can_login=True, can_set_replication_role=False),
    dict(name='supabase_admin', superuser=True, can_login=True, can_set_replication_role=True),
])
ROLE_PROFILE_RECEIPT = '658f523d7a8f3693967b770ba8ce9f63a5cc675bd75dbd21b0c791588bf3fd83'


def profile_admission_sql():
    query = """select jsonb_build_object('server_version',current_setting('server_version'),
 'roles',(select jsonb_agg(jsonb_build_object('name',r.rolname,'superuser',r.rolsuper,
 'can_login',r.rolcanlogin,'can_set_replication_role',pg_catalog.has_parameter_privilege(r.rolname,'session_replication_role','SET'))
 order by r.rolname collate "C")from pg_catalog.pg_roles r where r.rolname in('postgres','supabase_admin')))"""
    expected = json.dumps(ROLE_PROFILE, separators=(',', ':'))
    return ("do $profile$ declare observed jsonb;begin if session_user is distinct from 'supabase_admin' or current_user is distinct from 'supabase_admin' or current_setting('role') is distinct from 'none' or current_setting('session_replication_role') is distinct from 'origin' then raise exception 'Initial owned session profile differs' using errcode='23514';end if;select ("+query+") into observed;if observed is distinct from '"+expected+"'::jsonb then raise exception 'Pinned owned role profile differs' using errcode='23514';end if;end $profile$;\n"
            +"select jsonb_build_object('managed_provenance_role_profile',("+query+"),'observation_sha256','"+ROLE_PROFILE_RECEIPT+"');\n")


def exact_json(value, expected):
    """JSON structure/value equality including boolean/integer distinction."""
    if type(value) is not type(expected):
        return False
    if isinstance(expected, dict):
        return value.keys() == expected.keys() and all(exact_json(value[k], v) for k, v in expected.items())
    if isinstance(expected, list):
        return len(value) == len(expected) and all(exact_json(a, b) for a, b in zip(value, expected))
    return value == expected


def session_transition(before, after):
    """Only fixed synthetic owner/postgres transitions; no supplied SQL role."""
    assert (before, after) in {('supabase_admin', 'postgres'), ('postgres', 'supabase_admin')}
    command = 'SET SESSION AUTHORIZATION postgres' if after == 'postgres' else 'RESET SESSION AUTHORIZATION'
    return """do $role_identity$
declare retained_claims text:=current_setting('request.jwt.claims',true);
 retained_sub text:=current_setting('request.jwt.claim.sub',true);
 retained_role text:=current_setting('request.jwt.claim.role',true);
 retained_session text:=current_setting('request.jwt.claim.session_id',true);
 retained_uid uuid:=auth.uid(); retained_auth_role text:=auth.role(); retained_jwt jsonb:=auth.jwt();
begin
 if session_user is distinct from '__BEFORE__' or current_user is distinct from '__BEFORE__'
 or current_setting('role') is distinct from 'none'
 or current_setting('session_replication_role') is distinct from 'origin' then
  raise exception 'Unexpected synthetic role transition origin' using errcode='23514';end if;
 execute '__COMMAND__';
 if session_user is distinct from '__AFTER__' or current_user is distinct from '__AFTER__'
 or current_setting('role') is distinct from 'none'
 or current_setting('session_replication_role') is distinct from 'origin'
 or current_setting('request.jwt.claims',true) is distinct from retained_claims
 or current_setting('request.jwt.claim.sub',true) is distinct from retained_sub
 or current_setting('request.jwt.claim.role',true) is distinct from retained_role
 or current_setting('request.jwt.claim.session_id',true) is distinct from retained_session
 or auth.uid() is distinct from retained_uid or auth.role() is distinct from retained_auth_role
 or auth.jwt() is distinct from retained_jwt then
  raise exception 'Synthetic role transition changed identity or trigger mode' using errcode='23514';end if;
end $role_identity$;
""".replace('__BEFORE__', before).replace('__AFTER__', after).replace('__COMMAND__', command)


def postgres_stage(sql):
    guard = """do $stage_identity$ begin
 if session_user is distinct from 'postgres' or current_user is distinct from 'postgres'
 or current_setting('role') is distinct from 'none'
 or current_setting('session_replication_role') is distinct from 'origin' then
  raise exception 'Ordinary candidate stage identity differs' using errcode='23514';end if;
end $stage_identity$;
"""
    return guard + sql + guard


def privilege_scope_sql():
    return "select jsonb_build_object('managed_provenance_privilege_scope','admin_integrity_only','session_user',session_user,'current_user',current_user,'role_setting',current_setting('role'),'postgres_invoker_equivalence',false,'auth_acceptance',false);\n"


def provenance_stage():
    sql = session_transition('postgres', 'supabase_admin') + privilege_scope_sql()
    sql += (SOURCE/'record-review-v3-adapter-provenance-negatives.sql').read_text()
    sql += session_transition('supabase_admin', 'postgres')
    sql += "select controlled_review_v3.required();\ndo $preservation$ begin if(select count(*)from review_v3_readonly_baseline)<>1 or(select value from review_v3_readonly_baseline)is distinct from ("+capture.retained.VALUE+")then raise exception 'A1 provenance batch changed complete permanent state' using errcode='23514';end if;end $preservation$;\n"
    sql += "select jsonb_build_object('managed_provenance_permanent_preservation',true,'checks',44,'role_restored',true,'trigger_mode_restored',true);\n"
    return sql


def admit_provenance(values):
    """Finite independent pair inventory, strict summaries, retained diagnostics."""
    def single(key):
        found = [v for v in values if isinstance(v, dict) and key in v]
        assert len(found) == 1, 'Exactly one provenance summary/receipt required'
        return found[0]
    profile = single('managed_provenance_role_profile')
    assert exact_json(profile, dict(managed_provenance_role_profile=ROLE_PROFILE,
        observation_sha256=ROLE_PROFILE_RECEIPT)), 'Pinned role profile receipt differs'
    privilege = single('managed_provenance_privilege_scope')
    assert exact_json(privilege, dict(managed_provenance_privilege_scope='admin_integrity_only',
        session_user='supabase_admin', current_user='supabase_admin', role_setting='none',
        postgres_invoker_equivalence=False, auth_acceptance=False)), 'Fault privilege scope differs'
    summary = single('managed_provenance_negative_cases')
    assert exact_json(summary, dict(managed_provenance_negative_cases=22, entrypoint_refusals=44,
        all_mutations_rolled_back=True, historical_A2=False, full_corruption_matrix=False)), 'Provenance summary differs'
    preservation = single('managed_provenance_permanent_preservation')
    assert exact_json(preservation, dict(managed_provenance_permanent_preservation=True,
        checks=44, role_restored=True, trigger_mode_restored=True)), 'Provenance preservation missing or differs'
    wrapper = single('managed_provenance_refusal_receipts')
    assert set(wrapper) == {'managed_provenance_refusal_receipts'}, 'Unknown provenance receipt field'
    rows = wrapper['managed_provenance_refusal_receipts']
    assert type(rows) is list and len(rows) == 44, 'Exact 44 provenance refusals required'
    expected = [(label, entrypoint) for label in PROVENANCE_LABELS for entrypoint in ('classifier', 'collector')]
    assert len(PROVENANCE_LABELS) == len(set(PROVENANCE_LABELS)) == 22 and tuple(sorted(PROVENANCE_LABELS)) == PROVENANCE_LABELS
    pairs = []
    for row in rows:
        assert type(row) is dict and set(row) == {'label', 'entrypoint', 'refusal_message'}, 'Provenance row keys differ'
        assert all(type(row[key]) is str for key in row) and row['refusal_message'], 'Nonempty provenance diagnostic required'
        pairs.append((row['label'], row['entrypoint']))
    assert pairs == expected, 'Exact ordered provenance pair inventory required'
    return dict(summary=summary, receipts=rows, preservation=preservation, privilege_scope=privilege, role_profile=profile,
                historical_A2=False, full_corruption_matrix=False)


def candidate_sanity(runtime):
    # Attempt5 failed the former single120s candidate command. The reviewed
    # replacement has eight120s phases in one backend under the same600s whole
    # reference deadline; it does not claim the old candidate budget passed.
    stages = [(name, postgres_stage(sql)) for name, sql in fixtures.build_stages()]
    stages[0] = (stages[0][0], profile_admission_sql() + session_transition('supabase_admin', 'postgres') + stages[0][1])
    stages.append(('provenance_negatives', provenance_stage()))
    internal = (SOURCE/'record-review-v3-adapter-accumulator-boundaries.sql').read_text()
    internal += "select controlled_review_v3.required();\ndo $guard$ begin if(select value from review_v3_readonly_baseline)is distinct from ("+capture.retained.VALUE+")then raise exception 'A1 internal boundary checks changed permanent state' using errcode='23514';end if;end $guard$;\n"
    stages.append(('internal_boundaries', postgres_stage(internal)))
    output = phased.run(runtime, stages)
    values = [json.loads(line, object_pairs_hook=assembly.descriptor.unique)
              for line in output.splitlines() if line.startswith('{')]
    proofs = [value for value in values if 'genuine_cases' in value]
    internal = [value for value in values if 'synthetic_internal_inputs_only' in value]
    assert len(proofs) == len(internal) == 1, 'Exactly one positive and internal-boundary summary required'
    proof, boundary = proofs[0], internal[0]
    kinds = json.loads((SOURCE/'record-review-v3-adapters-selectors.json').read_text(),
                      object_pairs_hook=assembly.descriptor.unique)['kinds']
    expected_kinds = sorted(row['event_kind'] for row in kinds)
    assert len(expected_kinds) == len(set(expected_kinds)) == 22
    assert exact_json(proof, dict(synthetic_only=True, genuine_cases=33, exact_kinds=expected_kinds,
                         effects_cases=33, membership_cases=33, full_readonly_preservation=True,
                         auth_acceptance=False, historical_A2=False, corruption_and_bounds=False))
    assert exact_json(boundary, dict(synthetic_internal_inputs_only=True, production_fixture_boundary_claim=False,
        checks=sorted(['512_distinct_internal_rows_retained','duplicate_at_capacity_and_role_precedence',
                       '513th_distinct_row_refused','same_key_different_full_row_refused',
                       'allocations_100_duplicate_101_refusal','documents_100_duplicate_101_refusal',
                       'utf8_byte_overflow_refused'])))
    provenance = admit_provenance(values)
    owned.save(runtime.folder, 'candidate-managed-sanity', proof)
    owned.save(runtime.folder, 'candidate-internal-boundaries', boundary)
    owned.save(runtime.folder, 'candidate-managed-provenance-negatives', provenance)
    return dict(managed_sanity=proof, internal_boundaries=boundary, managed_provenance_negatives=provenance,
                admitted_artifact=False, acceptance=False, adapter_acceptance=False, protocol_behavior_claim=False)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run-synthetic-local', action='store_true', required=True)
    parser.add_argument('--reference', action='store_true', required=True)
    parser.add_argument('--candidate-sanity', action='store_true')
    args = parser.parse_args()
    os.umask(0o077)
    package = assembly.build()
    inputs = owned.source_inputs()
    required = 3*1024**3 + 2*sum((ROOT/name).stat().st_size for name in inputs)
    free = shutil.disk_usage(tempfile.gettempdir()).free
    assert free >= required, 'Insufficient retained-evidence space; no deletion authorized'
    folder = Path(tempfile.mkdtemp(prefix='lrv-review-v3-gate-b-reference-'))
    owned.save(folder, 'disk-admission', dict(free_bytes=free, required_bytes=required))
    frozen = owned.freeze(folder)
    assert frozen == inputs, 'Source changed during admission'
    bind_package_inputs(package, frozen)
    owned.save(folder, 'independent-expected', package['expected'])
    owned.save(folder, 'derivation-source-hashes', package['source_hashes'])
    start = time.monotonic()
    deadline = start + REFERENCE_SECONDS
    runtime = Runtime(folder, REFERENCE_SECONDS, package)
    runtime.deadline = deadline
    error = None
    complete = False
    outcomes = dict(metadata_reference=False, candidate_sanity=None)
    print('Protected evidence: '+str(folder), flush=True)
    try:
        admitted = admit_canonical206(SOURCE, sorted((ROOT/'supabase/migrations').glob('*.sql')))
        files = admitted['prefix205']+[ROOT/'supabase/migrations'/admitted['binding206']['filename']]
        runtime.start(files)
        runtime.query(package['preflight_sql'])
        before = capture.snapshot(runtime.query)
        capture.baseline(before, package)
        owned.save(folder, 'canonical206-before', before)
        install_proof(runtime, package, before)
        outcomes['metadata_reference'] = True
        owned.save(folder, 'reference-phases', outcomes)
        if args.candidate_sanity:
            outcomes['candidate_sanity'] = candidate_sanity(runtime)
            owned.save(folder, 'reference-phases', outcomes)
        owned.verify_frozen(folder, frozen)
        complete = True
    except BaseException as exc:
        error = type(exc).__name__+': '+str(exc)
        (folder/'failure.txt').write_text(traceback.format_exc())
        raise
    finally:
        try:
            runtime.cleanup()
            owned.verify_frozen(folder, frozen)
        except BaseException as exc:
            error = (error or '')+' cleanup: '+str(exc)
            raise
        finally:
            passed = complete and error is None and runtime.record['removed'] is True and time.monotonic() < deadline
            owned.save(folder, 'result', dict(kind='record-review-v3-gate-b-reference-v1',
                passed=passed, acceptance=False, workload_seconds=REFERENCE_SECONDS,
                emergency_cleanup_seconds=owned.CLEANUP_SECONDS, elapsed_seconds=round(time.monotonic()-start, 3),
                all_owned_cleanup_verified=runtime.record['removed'], source_input_count=len(frozen),
                source_map_sha256=owned.sha((folder/'source-hashes.json').read_bytes()),
                independent_expected_sha256=package['expected_sha256'], install_sha256=package['install_sha256'],
                admitted_artifact=False, protocol_behavior_claim=False, adapter_acceptance=False, outcomes=outcomes,
                candidate_execution_contract=(dict(kind='eight-phase-owned-session-v2',
                    phase_names=list(phased.PHASE_NAMES), phase_seconds=phased.PHASE_SECONDS,
                    whole_reference_seconds=REFERENCE_SECONDS, former_single_command_120s_passed=False)
                    if args.candidate_sanity else None),
                clinical_activation=False, hosted_writes=0, error=error))
    assert passed, 'Workload/cleanup/source proof incomplete; no PASS'
    print('PASS reference only: '+str(folder/'result.json'), flush=True)


if __name__ == '__main__':
    main()
