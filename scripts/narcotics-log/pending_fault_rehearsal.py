"""Source-derived genuine-Auth negative proof; never release acceptance."""
import argparse
from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import time

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import business_rehearsal as business
import receiver_auth
from receiver_rehearsal import observe

FAULT_CODE = 'PZ046'
FAULT_MESSAGE = 'pending_delete_full_validation_fault'
SIGNATURES = ('controlled_count_v1.pending_product_delete_guard()',
              'controlled_count_v1.dispatch_count_mutation(text,jsonb)',
              'public.start_controlled_count_v1(jsonb)')


class EngineeringProofComplete(Exception):
    """Intentional final failure so the shared runner cannot grant acceptance."""


def overlays(raw, expected):
    result = []; proofs = {}
    for signature in SIGNATURES:
        name = signature.split('(', 1)[0]
        matches = list(re.finditer(r'CREATE(?: OR REPLACE)? FUNCTION ' + re.escape(name) + r'\(', raw))
        if len(matches) != 1:
            raise ValueError('One exact negative-proof source function required')
        start = matches[0].start(); body_start = raw.index(' AS $$', start) + len(' AS $$')
        end = raw.index('$$;', body_start); before = raw[body_start:end]
        old_hash = hashlib.sha256(before.encode()).hexdigest()
        if old_hash != expected['properties']['functions'][signature]['body_sha256']:
            raise ValueError('Unmodified source body binding differs')
        if signature == SIGNATURES[0]:
            old = ' PERFORM controlled_count_v1.product_live_causes(OLD.product_id);'
            new = old + "\n RAISE EXCEPTION '" + FAULT_MESSAGE + "' USING ERRCODE='" + FAULT_CODE + "',DETAIL='',HINT='';"
        else:
            old = "raise exception 'count_request_failed'using errcode='P0001',detail='',hint='';"
            new = "IF SQLSTATE='" + FAULT_CODE + "'THEN RAISE;END IF;\n " + old
        if before.count(old) != 1 or new in before:
            raise ValueError('Exact unique negative-proof anchor required')
        after = before.replace(old, new, 1)
        if after.replace(new, old, 1) != before:
            raise ValueError('Whole negative-proof source inverse required')
        if signature == SIGNATURES[0] and not after.index(old) < after.index("RAISE EXCEPTION '" + FAULT_MESSAGE) < after.index('RETURN OLD;'):
            raise ValueError('Fault must follow the unchanged complete validator')
        header = raw[start:body_start].replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION', 1)
        result.append(header + after + '$$;')
        proofs[signature] = dict(original_body_sha256=old_hash,
            new_body_sha256=hashlib.sha256(after.encode()).hexdigest(), whole_body_inverse=True)
    return result, proofs


class FaultHttp:
    def __init__(self, original, runtime, folder):
        self.original = original; self.runtime = runtime; self.folder = folder

    def __getattr__(self, name):
        return getattr(self.original, name)

    def rpc(self, name, payload, user, expected=200):
        if name != 'start_controlled_count_v1':
            return self.original.rpc(name, payload, user, expected)
        if expected != 200 or set(payload) != {'p_request'}:
            raise ValueError('Exact unchanged positive-profile start request required')
        controls = self.runtime.selected_query('fault-policy-grammar-controls',
            business.installation.prefix.regular(business.HERE / 'policy-reuse-controls.sql').decode())
        if controls != dict(kind='historical-policy-grammar-controls-v1', cases=23,
                original_and_context_results_exact=True, captured_capability_decisions_recomputed=True,
                domain_writes=0, Auth_acceptance=False):
            raise ValueError('Complete admitted-policy grammar and invalid-UUID controls required')
        business.save(self.folder, 'pending-fault-policy-grammar-controls', controls)
        before = observe(self.runtime, 'fault-before-complete-data')
        auth_before = receiver_auth.capture(self.runtime, 'fault-before-complete-Auth')
        self.runtime.verify_pending_empty('fault-before-pending-empty')
        status, response = self.original.post('/rest/v1/rpc/' + name, payload, user['token'])
        if status != 400 or response != dict(code=FAULT_CODE, message=FAULT_MESSAGE, details='', hint=''):
            raise ValueError('The exact injected post-validation fault was not reached')
        call = self.original.calls[-1]; index = len(self.original.calls)
        raw = business.installation.prefix.regular(self.folder / f'http-{index:03d}-response.json', 2097152)
        if hashlib.sha256(raw).hexdigest() != call['response_sha256'] or call['path'] != '/rest/v1/rpc/' + name or call['admin_identity_creation']:
            raise ValueError('Original genuine negative response binding differs')
        if observe(self.runtime, 'fault-after-complete-data') != before:
            raise ValueError('Failed mandatory validation changed retained rows or sequences')
        if receiver_auth.capture(self.runtime, 'fault-after-complete-Auth') != auth_before:
            raise ValueError('Failed mandatory validation changed original Auth rows')
        self.runtime.verify_pending_empty('fault-after-pending-empty')
        if self.runtime.selected_query('fault-after-context-empty',
                "SELECT jsonb_build_object('contexts',(SELECT count(*)FROM public.controlled_stock_execution_contexts));") != {'contexts': 0}:
            raise ValueError('Failed mandatory validation retained a writing context')
        self.runtime.verify_module('fault-source-derived-module-properties')
        business.save(self.folder, 'pending-fault-rollback-proof', dict(
            kind='genuine-Auth-pending-fault-negative-proof-v1', engineering_only=True,
            normal_acceptance=False, application_Auth_acceptance=False,
            actual_API=name, status=status, error_code=FAULT_CODE,
            request_sha256=call['request_sha256'], response_sha256=call['response_sha256'],
            complete_validator_reached_before_injected_fault=True,
            all_original_relations_Auth_sequences_equal=True, contexts=0, pending_products=0))
        raise EngineeringProofComplete()


class PendingFault(business.BusinessInstallation):
    def __init__(self, *args):
        super().__init__(*args, profile='count_agreement')
        self.result.update(kind='narcotics-pending-validation-engineering-fault-v1', engineering_only=True)

    def bind_fault(self, runtime):
        raw = business.installation.prefix.regular(business.installation.ROOT / 'supabase/migrations' /
            business.installation.prefix.FORWARD[1]).decode()
        programs, proofs = overlays(raw, self.expected_module)
        changed = deepcopy(self.expected_module)
        for signature, proof in proofs.items():
            changed['properties']['functions'][signature]['body_sha256'] = proof['new_body_sha256']
        old_literal = business.installation.canonical(self.expected_module).replace("'", "''")
        new_literal = business.installation.canonical(changed).replace("'", "''")
        bind = """ALTER TABLE controlled_count_v1.descriptor DISABLE TRIGGER count_history_immutable;
DO $fault_source_binding$DECLARE changed integer;BEGIN
 UPDATE controlled_count_v1.descriptor SET definition='""" + new_literal + """'::jsonb,
 definition_hash=encode(sha256(convert_to(jsonb_build_object('domain','lrv.count.local_fixture.module.v1',
 'definition','""" + new_literal + """'::jsonb)::text,'UTF8')),'hex')
 WHERE revision=1 AND definition='""" + old_literal + """'::jsonb;
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed<>1 THEN RAISE EXCEPTION 'fault_source_binding_refused';END IF;
END $fault_source_binding$;
ALTER TABLE controlled_count_v1.descriptor ENABLE TRIGGER count_history_immutable;
"""
        # Only the NEW208 descriptor in this disposable engineering database is
        # rebound from exact source. The205/206/269 descriptors stay immutable.
        runtime.raw_query('engineering-only-pending-fault-source',
            "BEGIN;SET LOCAL statement_timeout='8s';SET LOCAL lock_timeout='5s';\n" + '\n'.join(programs) + bind + 'COMMIT;')
        self.expected_module = changed
        runtime.verify_module('engineering-pending-fault-exact-source')
        business.save(self.evidence, 'pending-fault-source-inverses', proofs)

    def execute(self):
        business.installation.Installation.execute(self)
        m = business.modules(); runtime = business.Runtime(self)
        self.bind_fault(runtime)
        business.save(self.evidence, 'genuine-REST-source-defaults', m.rest.effective_defaults(runtime))
        business.save(self.evidence, 'genuine-Auth-source-defaults', m.auth.effective_defaults(runtime))
        auth_before = m.auth.initial(runtime)
        sequence_before = runtime.selected_query('sequence-before', m.sequence.SQL)
        prerequisite = runtime.selected_query('sequence-prerequisite', m.sequence.prerequisite_sql())
        m.sequence.initial(sequence_before, auth_before, prerequisite)
        rows_before = self.rows('before-engineering-business-permanent-rows')
        status = business.installation.decode(runtime.command(['supabase', 'status', '--workdir', str(self.project), '-o', 'json']).stdout)
        if status['API_URL'] != 'http://127.0.0.1:64661':
            raise ValueError('Only the exact owned loopback API is admitted')
        http = m.transport.Http(runtime, self.evidence, status['ANON_KEY'], status['SERVICE_ROLE_KEY'])
        users = [m.transport.real_user(http, index) for index in (0, 1)]
        runtime.raw_query('fixed-initial-staff-bootstrap', m.identity.identity_fixture(users))
        context = dict(users=users, ids={}, http=FaultHttp(http, runtime, self.evidence),
            public_anon_key=status['ANON_KEY'], auth_before=auth_before)
        methods = dict(password_b=business.password_b, full_capture=m.capture, full_components=None, full_payload=None)
        try:
            m.profiles.count_agreement(context, methods, runtime, self.evidence, runtime.selected_query, business.save)
        except EngineeringProofComplete:
            business.save(self.evidence, 'engineering-genuine-Auth-effects', m.auth.validate(runtime, auth_before, users, []))
            after = runtime.selected_query('sequence-after', m.sequence.SQL)
            business.save(self.evidence, 'engineering-source-sequence-effects', m.sequence.final(sequence_before, after, 2))
            business.installation.preserve(rows_before, self.rows('after-engineering-business-permanent-rows'),
                m.parent_effects.expected('commission_all', 2))
            self.result.update(pending_fault_rollback_verified=True, original_parent_rows_verified=True,
                source_sequences_verified=True, application_Auth_verified=False, business_profile_verified=False,
                count_business_verified=False, authenticated_browser_verified=False)
            raise
        raise ValueError('The required first-count validation fault was never reached')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run-synthetic-local', action='store_true', required=True)
    parser.parse_args(); os.umask(0o077); started = time.monotonic()
    layout, pins = business.source_admission()
    for name in ('pending_fault_rehearsal.py', 'receiver_auth.py', 'receiver_rehearsal.py',
                 'receiver_reauthentication.py', 'bounded_archive.py', 'recovery-observation.sql',
                 'diagnose_register.py', 'build_operational_module.py', 'operational_release.py',
                 'policy-reuse-controls.sql'):
        path = business.HERE / name
        pins[str(path.relative_to(business.installation.ROOT))] = business.installation.sha(business.installation.prefix.regular(path))
    try:
        business.installation.execute_owned(layout, pins, started, PendingFault)
    except EngineeringProofComplete:
        # An ExceptionGroup or cleanup/source/deadline failure is deliberately
        # not caught. The persisted shared-runner result remains passed=false.
        print(json.dumps(dict(engineering_negative_proof_complete=True, normal_acceptance=False)))
        return
    raise RuntimeError('Engineering proof cannot grant normal acceptance')


if __name__ == '__main__':
    main()
