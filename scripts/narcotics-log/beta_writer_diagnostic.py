"""Isolated current211 writer diagnosis; every execution refuses acceptance.

This diagnostic branch retains the exact paired candidate product migration
and template plus the original business protocol bytecode. Only the owned fixed wrapper error fence and its
source-derived private expectations are instrumented, as in recovery tracing.
Transaction-local function profiling adds per-call counter deltas; these are
engineering observations and never candidate or latency acceptance.
"""
import argparse
import os
from pathlib import Path
import sys
import time
from types import SimpleNamespace

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import beta_rehearsal as beta
import beta_recovery_diagnostic as diagnostic

PROFILES = ('clinical', 'native_return_v1')
WRITERS = frozenset(('record_patient_treatment', 'record_anesthesia_drug_administration',
                    'record_native_dispense', 'record_native_dispense_return'))


class WriterHttp(diagnostic.TimedHttp):
    def __init__(self, original, runtime):
        super().__init__(original, runtime)
        self.writer = None
        self.execute_index = 0

    def rpc(self, name, payload, user, expected=200):
        if name == 'probe_controlled_stock_intent_v1':
            candidate = payload.get('p_request', {}).get('writer')
            self.writer = candidate if candidate in WRITERS else None
        if name != diagnostic.API:
            return self.original.rpc(name, payload, user, expected)
        self.execute_index += 1
        before = function_costs(self.runtime, self.execute_index, "before")
        started = time.monotonic()
        passed = False
        try:
            result = super().rpc(name, payload, user, expected)
            passed = True
            return result
        finally:
            # Fixed source enums and ordinal only: no payload, identity, token,
            # clinical text or server response is copied into the timing list.
            observation = dict(engineering_only=True, normal_acceptance=False,
                writer=self.writer, execute_index=self.execute_index,
                elapsed_seconds=time.monotonic()-started, expected_status_received=passed)
            beta.business.save(self.runtime.folder, 'beta-writer-call-timing-'+str(self.execute_index).zfill(3), observation)
            path = self.runtime.folder / 'beta-recovery-native-trace.json'
            if not passed and path.is_file():
                receipt = beta.installation.decode(beta.installation.prefix.regular(path, 2097152))
                beta.business.save(self.runtime.folder, 'beta-writer-native-trace', {**receipt, **observation})
            try:
                after = function_costs(self.runtime, self.execute_index, "after")
                deltas = function_deltas(before, after)
                beta.business.save(self.runtime.folder, 'beta-writer-function-costs-'+str(self.execute_index).zfill(3),
                    dict(engineering_only=True,normal_acceptance=False,writer=self.writer,
                        execute_index=self.execute_index,expected_status_received=passed,
                        self_time_is_exclusive=True,total_time_is_inclusive_and_not_summed=True,
                        aborted_call_statistics_may_be_incomplete=not passed,
                        before=before,after=after,deltas=deltas))
            except Exception as error:
                beta.business.save(self.runtime.folder, 'beta-writer-function-costs-unavailable-'+str(self.execute_index).zfill(3),
                    dict(engineering_only=True,normal_acceptance=False,error_type=type(error).__name__))
                if passed:raise


def function_costs(runtime, ordinal, phase):
    # Each owner observation is a fresh bounded connection/transaction. The
    # flush request runs in the actual RPC backend, not this observer.
    return runtime.selected_query('engineering-function-costs-'+str(ordinal)+'-'+phase,"""
WITH cleared AS MATERIALIZED(SELECT pg_catalog.pg_stat_clear_snapshot())
SELECT coalesce(jsonb_object_agg(s.signature,jsonb_build_object(
 'calls',s.calls,'self_ms',s.self_time,'total_ms',s.total_time)),'{}'::jsonb)
FROM cleared CROSS JOIN LATERAL(
 SELECT funcid::regprocedure::text AS signature,calls,self_time,total_time
 FROM pg_catalog.pg_stat_user_functions
 WHERE schemaname IN('public','controlled_count_v1','controlled_count_entry_v1',
  'controlled_stock_workflow_v1','controlled_review','controlled_review_v3',
  'narcotics_register_v1','narcotics_recovery_v1')
) s;
""")


def function_deltas(before, after):
    if set(before)-set(after):
        raise ValueError('Function statistics reset during isolated observation')
    result=[]
    for signature, values in after.items():
        initial=before.get(signature,dict(calls=0,self_ms=0,total_ms=0))
        delta={key:values[key]-initial[key] for key in ('calls','self_ms','total_ms')}
        if any(value<0 for value in delta.values()):
            raise ValueError('Function statistics reset during isolated observation')
        if delta['calls'] or delta['self_ms'] or delta['total_ms']:
            result.append(dict(signature=signature,**delta))
    return sorted(result,key=lambda row:(-row['self_ms'],row['signature']))


def modules():
    selected = beta.current_modules()
    transport = selected.transport
    selected.transport = SimpleNamespace(**{**vars(transport),
        'Http': lambda runtime, *args: WriterHttp(transport.Http(runtime, *args), runtime)})
    return selected


class WriterDiagnosis(beta.BetaBusiness):
    protocol = beta.with_factories(beta.business.BusinessInstallation.execute,
        {'Runtime': beta.BetaRuntime, 'modules': modules})

    def after_installation(self, runtime):
        super().after_installation(runtime)
        diagnostic.bind(runtime, profile_functions=True)
        self.result.update(kind='engineering-current211-writer-diagnostic-v1',
            engineering_only=True, current211_normal_acceptance=False)

    def execute(self):
        try:
            self.protocol()
        finally:
            self.result.update(engineering_only=True, current211_normal_acceptance=False,
                application_Auth_verified=False, business_profile_verified=False,
                count_business_verified=False, authenticated_browser_verified=False,
                populated_receiver_verified=False)
        raise RuntimeError('Engineering writer tracing cannot grant normal current211 acceptance')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run-synthetic-local', action='store_true', required=True)
    parser.add_argument('--profile', choices=PROFILES, required=True)
    args = parser.parse_args()
    os.umask(0o077)
    started = time.monotonic()
    layout, pins = beta.admit_source()
    source_hash = pins[str(beta.MANIFEST.relative_to(beta.ROOT))]
    def factory(*arguments):
        target = WriterDiagnosis(*arguments, profile=args.profile)
        target.result.update(beta_candidate_source_sha256=source_hash,
            beta_candidate_profile='engineering-writer-'+args.profile,
            engineering_only=True, current211_normal_acceptance=False)
        return target
    beta.installation.execute_owned(layout, pins, started, factory)


if __name__ == '__main__':
    main()
