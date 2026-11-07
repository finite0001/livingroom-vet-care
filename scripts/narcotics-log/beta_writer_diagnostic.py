"""Isolated current211 writer diagnosis; every execution refuses acceptance.

This diagnostic branch retains the exact fd5f6731 product SQL and original
business protocol bytecode. Only the owned fixed wrapper error fence and its
source-derived private expectations are instrumented, as in recovery tracing.
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
        diagnostic.bind(runtime)
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
