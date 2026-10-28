"""Fixed restored-receiver API trace. This can never grant acceptance."""
import argparse
from copy import deepcopy
from functools import partial
import hashlib
import json
import os
from pathlib import Path
import sys
import time

sys.path.insert(0,str(Path(__file__).resolve().parent))
import business_rehearsal as business
import diagnose_commissioning as diagnosis
import operational_release
import receiver_rehearsal as recovery


class ReceiverDiagnosis(recovery.PopulatedRecovery):
    def __init__(self,*args,target):
        super().__init__(*args)
        self.target=target
        _,self.api,self.functions=diagnosis.TARGETS[target]
        self.result.update(kind='narcotics-restored-receiver-engineering-only-v1',engineering_only=True,diagnostic_target=target)

    def after_installation(self,runtime):
        super().after_installation(runtime)
        # Reuse the existing fixed two-body source transform; only this new208
        # disposable descriptor is rebound. Historical205/206/269 stay intact.
        diagnosis.Diagnosis.after_installation(self,runtime)
        raw=business.installation.prefix.regular(business.installation.ROOT/'supabase/migrations'/business.installation.prefix.FORWARD[1]).decode()
        static=json.loads((business.HERE/'module-expected.json').read_text())
        transformed=deepcopy(self.expected_module)
        action={'variance-execute':'reconciliation_execute','variance-resolve':'cause_resolve'}[self.target]
        for signature,failure,rethrow in self.functions:
            _,digest=diagnosis.instrument(raw,static,signature,failure,rethrow,tracked_action=action)
            transformed['properties']['functions'][signature]['body_sha256']=digest
        # This expectation comes only from that exact source transform, never
        # from observed database metadata. It is NOT the release expectation.
        self.expected_module=transformed

    def after_receiver_restore(self,runtime):
        self.receiver_diagnostic_runtime=runtime
        # Parameter ACLs are global and pg_dump does not transfer this grant.
        runtime.install.boot.sql('GRANT SET ON PARAMETER track_functions TO postgres;'
            'GRANT EXECUTE ON FUNCTION pg_catalog.pg_stat_force_next_flush() TO postgres;',admin=True)

    def execute(self):
        try:
            super().execute()
        finally:
            runtime=getattr(self,'receiver_diagnostic_runtime',None)
            if runtime is not None:
                transcript=runtime.folder/'http-transcript.json'
                if transcript.exists():
                    calls=json.loads(transcript.read_bytes())
                    if calls and calls[-1]['path']=='/rest/v1/rpc/'+self.api and 400<=calls[-1]['status']<=599:
                        raw=business.installation.prefix.regular(runtime.folder/f'http-{len(calls):03d}-response.json',2097152)
                        if hashlib.sha256(raw).hexdigest()!=calls[-1]['response_sha256']:
                            raise ValueError('Original restored diagnostic response changed')
                        value=business.installation.decode(raw)
                        if type(value)is not dict or set(value)!={'code','message','details','hint'}:
                            raise ValueError('Exact original native API error required')
                        runtime.write('diagnostic-native-failure-'+self.target+'.txt',raw)
                try:
                    costs=runtime.selected_query('receiver-engineering-function-costs',
                        "SELECT jsonb_build_object('engineering_only',true,'functions',(SELECT coalesce(jsonb_agg(to_jsonb(s)ORDER BY self_time DESC),'[]')"
                        "FROM(SELECT funcid::regprocedure::text signature,calls,total_time,self_time FROM pg_stat_user_functions "
                        "WHERE schemaname IN('public','controlled_count_v1','controlled_count_entry_v1','controlled_stock_workflow_v1',"
                        "'controlled_review','controlled_review_v3','narcotics_register_v1','narcotics_recovery_v1')ORDER BY self_time DESC,funcid LIMIT 100)s));")
                    business.save(runtime.folder,'diagnostic-function-costs',costs)
                except Exception as error:
                    business.save(runtime.folder,'diagnostic-function-costs',dict(engineering_only=True,available=False,error_type=type(error).__name__))
            self.result.update(application_Auth_verified=False,count_business_verified=False,
                business_profile_verified=False,authenticated_browser_verified=False,populated_receiver_verified=False)
        raise RuntimeError('Restored receiver instrumentation can never grant acceptance')


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run-synthetic-local',action='store_true',required=True)
    parser.add_argument('--target',choices=('variance-execute','variance-resolve'),required=True)
    args=parser.parse_args();os.umask(0o077);started=time.monotonic()
    layout,pins=business.source_admission();operational_release.pin_sources(pins)
    for path in [Path(__file__),business.HERE/'diagnose_commissioning.py',business.HERE/'receiver_rehearsal.py',
            business.HERE/'receiver_auth.py',business.HERE/'receiver_reauthentication.py',business.HERE/'bounded_archive.py',
            business.HERE/'recovery-observation.sql',business.HERE/'restore-defaults.sql',business.HERE/'restore-witness-check.sql',
            business.HERE/'diagnose_register.py',*recovery.operational.SOURCE.glob('*.sql')]:
        pins[str(path.relative_to(business.installation.ROOT))]=business.installation.sha(business.installation.prefix.regular(path))
    business.installation.execute_owned(layout,pins,started,partial(ReceiverDiagnosis,target=args.target))
