"""Owned populated backup/receiver rehearsal; no hosted or provider operations.

One original 600/540/55 budget covers BOTH clusters. The receiver starts from
zero migrations and receives the original archive, including real Auth rows.
This source does not activate the production builder or grant release approval.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import sys
import time

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import business_rehearsal as business
import build_operational_module as operational
import bounded_archive
import receiver_auth
import operational_release
from diagnose_register import wait_for_owned_rest

installation = business.installation
EXCLUDED = 'realtime,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def observe(runtime, label):
    sql = "BEGIN;SET LOCAL statement_timeout='30s';SET LOCAL lock_timeout='5s';\n" + (HERE / 'recovery-observation.sql').read_text() + "\nCOMMIT;BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;SET LOCAL statement_timeout='30s';SET LOCAL lock_timeout='5s';SET LOCAL search_path=pg_catalog;SET LOCAL quote_all_identifiers=false;SET LOCAL timezone='UTC';SET LOCAL datestyle='ISO,YMD';SET LOCAL intervalstyle='postgres';SET LOCAL extra_float_digits=3;SELECT pg_temp.recovery_observation();ROLLBACK;"
    return runtime.selected_query(label, sql)


def no_auth_change(before, after):
    # Real GoTrue login can alter only Auth relations and the refresh sequence.
    strip = lambda v: {kind: {k: x for k, x in v[kind].items() if not k.startswith('auth.')} for kind in ('relations', 'sequences')}
    if strip(before) != strip(after):
        raise ValueError('Password grant altered non-Auth retained rows or sequences')


def controls(http, user, action, head, data, operation_id=None):
    from uuid import uuid4
    request = dict(schema_version=1, actor_id=user['id'], operation_id=operation_id or str(uuid4()),
                   action=action, expected_head_id=head['head_id'], expected_head_hash=head['head_hash'], data=data)
    reply = http.rpc('narcotics_recovery_' + action + '_v1', {'p_request': request}, user)
    if reply['state'] != 'saved' or any(reply[k] != request[k] for k in ('operation_id', 'actor_id', 'action')):
        raise ValueError('Exact current recovery control receipt required')
    return reply


def paused_resources(runtime, selected, *, require_stopped=True):
    boot = runtime.install.boot
    original = boot.resources
    if original is None:
        raise ValueError('Original owned resource anchor required')
    # Observe with the unchanged full ownership validator, then compare against
    # the ORIGINAL anchor ourselves. Never adopt an observed replacement.
    boot.resources = None
    try:
        current = boot.owned_resources()
    finally:
        boot.resources = original
    if current['containers'] != original['containers'] or current['volumes'] != original['volumes'] or set(current['networks']) != set(original['networks']):
        raise ValueError('Paused owned immutable resources changed')
    for name, value in current['networks'].items():
        before = original['networks'][name]
        if {k: v for k, v in value.items() if k != 'attached_container_ids'} != {k: v for k, v in before.items() if k != 'attached_container_ids'}:
            raise ValueError('Paused owned network anchor changed')
        previous, actual = set(before['attached_container_ids']), set(value['attached_container_ids'])
        if actual - previous or previous - actual - set(selected):
            raise ValueError('Only explicitly paused service attachments may disappear')
    inspected = json.loads(boot.command(['docker', 'inspect', *selected], timeout=runtime.remaining(30)))
    if len(inspected) != 4 or {row['Id'] for row in inspected} != set(selected) or any(type(row['State']['Running']) is not bool for row in inspected) or require_stopped and any(row['State']['Running'] for row in inspected):
        raise ValueError('Every captured ingress service must actually be stopped')


def owned_ingress(runtime, action, *, cleanup=False):
    runtime.verify()
    expected = {'/supabase_' + name + '_' + runtime.identity for name in ('auth', 'rest', 'storage', 'kong')}
    selected = [key for key, value in runtime.owned_services.items() if value['name'] in expected]
    if len(selected) != 4:
        raise ValueError('Exactly four original owned ingress service IDs required')
    if action == 'start':
        if runtime.install.paused_ingress != selected:
            raise ValueError('Only the original explicitly paused ingress can reopen')
        paused_resources(runtime, selected, require_stopped=not cleanup)
    else:
        runtime.install.boot.owned_resources()
    if action == 'stop':
        runtime.install.paused_ingress = selected
    runtime.install.boot.command(['docker', action, *selected], timeout=runtime.remaining(30))
    if action == 'start':
        runtime.install.boot.owned_resources()
        runtime.install.paused_ingress = None
    if action == 'stop':
        runtime.install.paused_ingress = selected
        paused_resources(runtime, selected)
        if runtime.install.boot.sql(runtime.install.bootstrap_module.DRAIN_SQL) != 't':
            raise ValueError('Owned scheduler no longer drained')
        active = runtime.selected_query('closed-ingress-client-backends', "SELECT jsonb_build_object('other_clients',count(*))FROM pg_stat_activity WHERE datname=current_database()AND backend_type='client backend'AND pid<>pg_backend_pid();")
        if active != {'other_clients': 0}:
            raise ValueError('Owned source still has a client backend after ingress closed')
    return selected


def restart_owned_database(runtime):
    """Restart exactly the captured receiver ID; one original owner deadline."""
    runtime.verify()
    boot = runtime.install.boot
    boot.owned_resources()
    deadline = time.monotonic() + runtime.remaining(30)
    previous = runtime.install.owner_end
    runtime.install.owner_end = min(deadline, previous) if previous is not None else deadline
    try:
        boot.command(['docker', '--host', boot.endpoint, 'restart', boot.container_id], timeout=runtime.remaining(30))
        while True:
            left = min(deadline - time.monotonic(), runtime.remaining(30))
            if left <= 0:
                raise TimeoutError('Original owned database restart deadline exhausted')
            health = boot.command(['docker', '--host', boot.endpoint, 'inspect', '--format', '{{.State.Health.Status}}', boot.container_id], timeout=min(5, left)).strip()
            if health == 'healthy':
                break
            if health != 'starting':
                raise ValueError('Owned restarted database did not become healthy')
            time.sleep(min(0.1, max(0, deadline - time.monotonic())))
        boot.owned_resources()
        runtime.remaining(1)
    finally:
        runtime.install.owner_end = previous


class Receiver(installation.Installation):
    def __init__(self, source, evidence):
        super().__init__(source.view, evidence, source.layout, source.started)
        self.expected_module = source.expected_module
        self.bootstrap_module = source.bootstrap_module
        self.project_pins = {}

    def execute(self):
        migrations = self.project / 'supabase/migrations'
        migrations.mkdir(mode=0o700, parents=True)
        text = self.source_config.replace(self.source_identity, self.identity)
        (self.project / 'supabase/config.toml').write_text(text)
        self.boot = self.bootstrap_module.Bootstrap(self.view, self.project, 0, EXCLUDED, False, self.evidence / 'bootstrap', self.runner)
        self.boot.deadline = self.phase_end
        self.boot.execute()
        self.remaining()


class PopulatedRecovery(operational_release.SourceLedger,business.BusinessInstallation):
    def __init__(self, *args):
        super().__init__(*args, profile='count_agreement')
        self.receiver = None
        self.archive = None
        self.result.update(kind='narcotics-populated-receiver-rehearsal-v1', populated_receiver_verified=False)

    def after_installation(self, runtime):
        self.bootstrap_module = sys.modules[type(self.boot).__module__]

    def after_business(self, context, methods, runtime, proof):
        # Preserve context privately, but finish the unchanged business runner's
        # complete Auth, sequence, original-row and metadata checks FIRST.
        self.source_context, self.methods = context, methods
        self.source_runtime = runtime

    def execute(self):
        super().execute()
        source_runtime = self.source_runtime
        operational_release.install(source_runtime)
        ctx = self.source_context
        source_http = ctx['http']; a, b = ctx['users']
        current_b = ctx['current_actors'][b['id']]
        users = [a, current_b]
        identity = dict(schema_version=1, actor_id=a['id'])
        ready = source_http.rpc('narcotics_recovery_preflight_v1', {'p_request': identity}, a)
        armed = controls(source_http, a, 'arm', ready, dict(capture_hash=ready['capture_hash']))
        head = armed['data']
        backup = controls(source_http, a, 'backup_prepare', head, {})
        owned_ingress(source_runtime, 'stop')
        original = observe(source_runtime, 'backup-complete-original-data')
        original_auth = receiver_auth.capture(source_runtime, 'backup-complete-Auth')
        # Native pg_dump takes ONE internally consistent MVCC snapshot. No API
        # or scheduler writer remains; compare the entire original data again
        # after completion, rather than treating transport success as proof.
        self.archive = bounded_archive.capture(['docker', '--host', self.boot.endpoint, 'exec', self.boot.container_id,
            'pg_dump', '-U', 'supabase_admin', '-d', 'postgres', '--format=custom'], self.evidence / 'original-backup.dump', timeout=min(30, self.remaining()), env=self.boot.env, cwd=self.evidence)
        if observe(source_runtime, 'backup-data-after-dump') != original:
            raise ValueError('Closed original source changed during native backup')
        completed = source_runtime.selected_query('actual-backup-completion-clock', "SELECT jsonb_build_object('at',to_char(clock_timestamp()at time zone'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"'));")['at']
        capsule = dict(schema_version=1, archive=dict(bytes=self.archive.length, sha256=self.archive.sha256),
                       completed_at=completed, arm=armed, backup=backup, original=original, original_auth=original_auth)
        capsule_bytes = installation.canonical(capsule).encode()
        capsule_hash = digest(capsule_bytes)
        self.save('original-external-backup-capsule', capsule)
        owned_ingress(source_runtime, 'start')
        wait_for_owned_rest(source_runtime, ctx['public_anon_key'])
        controls(source_http, a, 'source_resume', head, {})
        # A real +1 source event occurs AFTER the saved archive. Keep its exact
        # original HTTP response bytes as external evidence of a missing event.
        import full121_gateway as gateway
        lost = gateway.run(ctx, self.methods, source_runtime, self.evidence, source_runtime.selected_query, business.save)
        call = next((index for index, record in enumerate(source_http.calls, 1) if record['path'] == '/rest/v1/rpc/execute_managed_stock_intent_v1' and record['status'] == 200), None)
        if call is None:
            raise ValueError('Actual post-backup source response absent')
        lost_bytes = (self.evidence / f'http-{call:03d}-response.json').read_bytes()
        if digest(lost_bytes) != source_http.calls[call - 1]['response_sha256']:
            raise ValueError('Original missing-event response hash changed')
        source_config = (self.project / 'supabase/config.toml').read_text()
        source_identity = self.identity
        # Retire ONLY the original owned project, freeing its fixed loopback
        # ports. This consumes the existing work budget; it is not final cleanup.
        self.boot.cleanup()
        self.remaining()
        receiver_folder = self.evidence / 'receiver'
        receiver_folder.mkdir(mode=0o700)
        self.receiver = Receiver(self, receiver_folder)
        self.receiver.source_config, self.receiver.source_identity = source_config, source_identity
        self.receiver.execute()
        rr = business.Runtime(self.receiver)
        self.receiver.runtime = rr
        owned_ingress(rr, 'stop')
        self.receiver.boot.sql('DROP SCHEMA IF EXISTS realtime CASCADE;', admin=True)
        self.receiver.boot.sql("BEGIN;SET LOCAL statement_timeout='8s';SET LOCAL lock_timeout='5s';\n" + (HERE / 'restore-defaults.sql').read_text() + '\nCOMMIT;', admin=True)
        self.archive.restore(['docker', '--host', self.receiver.boot.endpoint, 'exec', '-i', self.receiver.boot.container_id, 'pg_restore',
            '-U', 'supabase_admin', '-d', 'postgres', '--clean', '--if-exists', '--exit-on-error', '--single-transaction'], timeout=min(30, self.remaining()), env=self.receiver.boot.env, cwd=receiver_folder)
        rr.raw_query("restore-original-witness-check", "BEGIN;SET LOCAL statement_timeout='8s';SET LOCAL lock_timeout='5s';\n" + (HERE / "restore-witness-check.sql").read_text() + "\nCOMMIT;")
        operational_release.verify_ledger(rr,self.operational_ledger,'restored-complete209-source-ledger')
        try:
            rr.verify_module('restored-full-source-properties')
        except BaseException:
            # Diagnostic observation only: do not turn a failed source seal into
            # acceptance, or use observed target properties as expectations.
            program = (HERE / 'module-capture.sql').read_text()
            guard = 'DO $fixture_require_bound$ BEGIN PERFORM controlled_count_entry_v1.require_bound_module(); END $fixture_require_bound$;'
            if program.count(guard) != 1:
                raise ValueError('Exact diagnostic-only source observation cut required')
            captured = rr.selected_query('restored-diagnostic-source-observation', program.replace(guard, '', 1))
            differences = []
            def compare(before, after, path):
                if len(differences) >= 40 or type(before) is type(after) and before == after:
                    return
                if type(before) is dict and type(after) is dict:
                    for key in sorted(set(before) | set(after)):
                        compare(before.get(key), after.get(key), path + '.' + key)
                elif type(before) is list and type(after) is list and len(before) == len(after):
                    for index, (a, b) in enumerate(zip(before, after)):
                        compare(a, b, path + '[' + str(index) + ']')
                else:
                    differences.append(dict(path=path, source=json.dumps(before)[:256], restored=json.dumps(after)[:256]))
            compare(self.expected_module['properties'], captured['properties'], '$.properties')
            compare(self.expected_module, captured['descriptor']['definition'], '$.descriptor.definition')
            business.save(receiver_folder, 'restore-source-differences', dict(accepted=False, differences=differences))
            raise
        if observe(rr, 'receiver-original-complete-data') != original:
            raise ValueError('Populated receiver differs from complete original backup data')
        if receiver_auth.capture(rr, 'receiver-original-complete-Auth') != original_auth:
            raise ValueError('Populated receiver changed original Auth rows')
        if rr.selected_query('restored-recovery-source-properties', "SELECT jsonb_build_object('matches',narcotics_register_v1.module_properties('narcotics_register_v1','narcotics_recovery_v1','narcotics_register_v1','narcotics_recovery_v1')=(SELECT definition FROM narcotics_register_v1.descriptor WHERE revision=1));") != {'matches': True}:
            raise ValueError('Restored complete operational source metadata differs')
        native = rr.selected_query('actual-receiver-identity', 'SELECT narcotics_recovery_v1.server_identity();')
        if datetime.fromisoformat(native['boot'].replace('Z', '+00:00')) <= datetime.fromisoformat(completed.replace('Z', '+00:00')):
            raise ValueError('Receiver did not start strictly after actual archive completion')
        rr.raw_query('restore-owned-gateway', 'BEGIN;\n' + (operational.SOURCE / 'recovery-gateway.sql').read_text() + '\nCOMMIT;')
        owned_ingress(rr, 'start')
        wait_for_owned_rest(rr, ctx['public_anon_key'])
        status = installation.decode(rr.command(['supabase', 'status', '--workdir', str(self.receiver.project), '-o', 'json']).stdout)
        if status['API_URL'] != 'http://127.0.0.1:64661':
            raise ValueError('Exact owned receiver loopback required')
        m = business.modules()
        http = m.transport.Http(rr, receiver_folder, status['ANON_KEY'], status['SERVICE_ROLE_KEY'])
        receiver_auth.prerequisites(rr)
        m.rest.effective_defaults(rr, recovery=True)
        # Configuration is not execution proof. An unrelated read-only POST
        # must hit the restored global hook, while genuine GET/HEAD remain RO.
        code, error = http.post('/rest/v1/rpc/is_active_staff', {'_user_id': a['id']}, a['token'])
        if code != 403 or error.get('code') != '42501' or error.get('message') != 'narcotics_recovery_write_held':
            raise ValueError('Restored actual global hook did not refuse unrelated armed POST')
        from http.client import HTTPConnection
        readonly_results = []
        for method in ('GET', 'HEAD'):
            deadline = time.monotonic() + rr.remaining(15)
            def left():
                value = min(deadline - time.monotonic(), rr.remaining(15))
                if value <= 0:
                    raise TimeoutError('Original whole readonly HTTP deadline exhausted')
                return value
            connection = HTTPConnection('127.0.0.1', 64661, timeout=left())
            try:
                connection.request(method, '/rest/v1/rpc/is_active_staff?_user_id=' + a['id'],
                    headers={'apikey': status['ANON_KEY'], 'Authorization': 'Bearer ' + a['token']})
                connection.sock.settimeout(left())
                response = connection.getresponse()
                if response.fp is not None:
                    response.fp.raw._sock.settimeout(left())
                body = response.read(33)
                left()
                if response.status != 200 or body != (b'true' if method == 'GET' else b''):
                    raise ValueError('Actual restored read-only GET/HEAD compatibility differs')
                readonly_results.append(dict(method=method, status=response.status, bytes=len(body)))
            finally:
                connection.close()
        business.save(receiver_folder, 'actual-restored-hook-methods', dict(armed_unrelated_POST_refused=True, readonly_methods=readonly_results))
        grants = []
        def login(original_user, label):
            before = observe(rr, label + '-before-data')
            grant = receiver_auth.password_grant(http, original_user)
            no_auth_change(before, observe(rr, label + '-after-data'))
            grants.append(grant)
            return grant
        pre_epoch = login(a, 'first-receiver-grant')
        epoch = controls(http, pre_epoch, 'begin_epoch', head, dict(marker_id=backup['data']['marker']['marker_id'],
            marker_hash=backup['data']['marker_hash'], external_capsule_sha256=capsule_hash, external_archive_sha256=self.archive.sha256))
        fresh_a = login(a, 'fresh-A-grant'); fresh_b = login(b, 'fresh-B-grant')
        evidence = controls(http, fresh_a, 'preserve_evidence', epoch['data'], dict(product_id=ctx['ids']['product'],
            site_id=ctx['ids']['site'], reported_occurred_at=datetime.fromisoformat(lost['receipt']['event']['recorded_at'].replace('Z', '+00:00')).astimezone(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z'),
            claim='Synthetic test: actual source +1 event was saved after this backup. Original HTTP response attached; this is staff-reported recovery evidence.',
            filename='synthetic-original-post-backup-response.json', mime='application/json', base64=__import__('base64').b64encode(lost_bytes).decode()))
        acknowledged = controls(http, fresh_b, 'acknowledge_evidence', epoch['data'], dict(evidence_id=evidence['data']['evidence_id'],
            evidence_hash=evidence['data']['evidence_hash'], acknowledged=True, review_note='Synthetic independent review of the exact original response and reported missing event.'))
        first_epoch = epoch
        first_acknowledged = acknowledged
        old_count_request = dict(schema_version=1, actor_id=fresh_a['id'], count_id=ctx['count']['agreement']['count_id'])
        before_restart_read = http.rpc('read_controlled_count_v1', {'p_request': old_count_request}, fresh_a)
        if before_restart_read['state'] != 'available' or before_restart_read['data']['count_id'] != old_count_request['count_id']:
            raise ValueError('Exact old-session request must succeed before the actual restart')
        # Interrupt an ACTIVE recovery using the actual captured database ID.
        # Rows, sequences, source ACLs and retained original evidence must survive.
        before_restart = observe(rr, 'before-actual-receiver-restart')
        restart_owned_database(rr)
        if observe(rr, 'after-actual-receiver-restart') != before_restart:
            raise ValueError('Actual receiver restart changed retained data or sequences')
        rr.verify_module('restarted-full-source-properties')
        restarted_native = rr.selected_query('actual-restarted-receiver-identity', 'SELECT narcotics_recovery_v1.server_identity();')
        if {k: v for k, v in restarted_native.items() if k != 'boot'} != {k: v for k, v in native.items() if k != 'boot'} or restarted_native['boot'] <= native['boot']:
            raise ValueError('Actual restart did not preserve database identity with a new native boot')
        wait_for_owned_rest(rr, status['ANON_KEY'])
        stale_status = http.rpc('narcotics_recovery_status_v1', {'p_request': dict(schema_version=1, actor_id=fresh_a['id'])}, fresh_a)
        if stale_status['needs_new_epoch'] is not True or stale_status['fresh_session'] is not False or stale_status['epoch_id'] != first_epoch['data']['epoch_id']:
            raise ValueError('Active restart did not expose the required new recovery attempt')
        before_restart_refusals = observe(rr, 'before-restart-stale-requests')
        # A valid old count READ is refused by the restart/session fence before
        # its original business handler; it is not an invalid-payload negative.
        code, error = http.post('/rest/v1/rpc/read_controlled_count_v1', {'p_request': old_count_request}, fresh_a['token'])
        if code not in (400, 403, 409):
            raise ValueError('Earlier active-recovery session bypassed restart fence')
        business.save(receiver_folder, 'actual-restart-old-session-refusal', dict(status=code, error=error))
        if observe(rr, 'after-restart-stale-requests') != before_restart_refusals:
            raise ValueError('Refused stale request changed restored data')
        next_pre_epoch = login(a, 'restarted-receiver-grant')
        epoch = controls(http, next_pre_epoch, 'begin_epoch', first_epoch['data'], dict(marker_id=backup['data']['marker']['marker_id'],
            marker_hash=backup['data']['marker_hash'], external_capsule_sha256=capsule_hash, external_archive_sha256=self.archive.sha256))
        if epoch['data']['epoch_id'] == first_epoch['data']['epoch_id'] or epoch['data']['native_receiver'] != restarted_native:
            raise ValueError('Actual restart failed to establish a distinct bound epoch')
        fresh_a = login(a, 'restarted-fresh-A-grant'); fresh_b = login(b, 'restarted-fresh-B-grant')
        current_status = http.rpc('narcotics_recovery_status_v1', {'p_request': dict(schema_version=1, actor_id=fresh_b['id'])}, fresh_b)
        if current_status['epoch_id'] != epoch['data']['epoch_id'] or current_status['needs_new_epoch'] or len(current_status['evidence']) != 1 or current_status['evidence'][0]['acknowledgment'] is not None:
            raise ValueError('New epoch must retain original evidence and require a new independent acknowledgment')
        retained_evidence = current_status['evidence'][0]['evidence']
        if retained_evidence['evidence_id'] != evidence['data']['evidence_id'] or retained_evidence['record_hash'] != evidence['data']['evidence_hash']:
            raise ValueError('Restart changed the exact retained original evidence')
        acknowledged = controls(http, fresh_b, 'acknowledge_evidence', epoch['data'], dict(evidence_id=evidence['data']['evidence_id'],
            evidence_hash=evidence['data']['evidence_hash'], acknowledged=True, review_note='Synthetic replacement review after actual receiver restart; exact original file and staff account reviewed again.'))
        if acknowledged['data']['acknowledgment_id'] == first_acknowledged['data']['acknowledgment_id']:
            raise ValueError('Replacement acknowledgment must preserve the original and create a new record')
        class FreshCountTransport:
            def rpc(self, name, payload, user, expected=200):
                if name == 'start_controlled_count_v1':
                    request = payload['p_request']
                    saved = controls(http, user, 'start_count', epoch['data'], dict(request=request), request['operation_id'])
                    # Record the ACTUAL callback separately; original finite
                    # pair helpers validate the unchanged parent receipt only.
                    business.save(receiver_folder, 'actual-start-route-' + request['operation_id'], dict(actual_rpc='narcotics_recovery_start_count_v1', parent_receipt=saved['data']['count_receipt']))
                    return saved['data']['count_receipt']
                return http.rpc(name, payload, user, expected)
        receiver_context = {**ctx, 'users': [fresh_a, fresh_b], 'current_actors': {}, 'http': FreshCountTransport(), 'count': {}}
        import full121_management as management
        proof = management.run(receiver_context, self.methods, rr, receiver_folder, rr.selected_query, business.save)
        post = receiver_context['count']['post_reconciliation']
        old_ack_request = dict(schema_version=1, actor_id=fresh_a['id'], operation_id=__import__('uuid').uuid4().__str__(), action='release',
            expected_head_id=epoch['data']['head_id'], expected_head_hash=epoch['data']['head_hash'],
            data=dict(agreements=[dict(product_id=ctx['ids']['product'], site_id=ctx['ids']['site'], count_id=post['count_id'], outcome_id=post['finalize']['request']['outcome_id'])],
                acknowledgments=[dict(evidence_id=evidence['data']['evidence_id'], acknowledgment_id=first_acknowledged['data']['acknowledgment_id'])],
                history_review_note='Synthetic attempt with the original acknowledgment after actual restart.'))
        before_old_ack = observe(rr, 'before-original-acknowledgment-release')
        code, error = http.post('/rest/v1/rpc/narcotics_recovery_release_v1', {'p_request': old_ack_request}, fresh_a['token'])
        business.save(receiver_folder, 'actual-original-acknowledgment-refusal', dict(status=code, error=error))
        if code not in (400, 403, 409) or observe(rr, 'after-original-acknowledgment-release') != before_old_ack:
            raise ValueError('Original acknowledgment survived the new epoch or altered retained data')
        released = controls(http, fresh_a, 'release', epoch['data'], dict(agreements=[dict(product_id=ctx['ids']['product'], site_id=ctx['ids']['site'],
            count_id=post['count_id'], outcome_id=post['finalize']['request']['outcome_id'])], acknowledgments=[dict(evidence_id=evidence['data']['evidence_id'], acknowledgment_id=acknowledged['data']['acknowledgment_id'])], history_review_note='Synthetic full restored history and missing-event evidence reviewed; fresh independent agreement after physical reconciliation.'))
        if released['data']['mode'] != 'idle':
            raise ValueError('Verified recovery did not release global mode')
        old_status = http.rpc('narcotics_recovery_status_v1', {'p_request': dict(schema_version=1, actor_id=a['id'])}, a)
        if old_status['session_id'] != a['session_id'] or old_status['mode'] != 'idle' or old_status['fresh_session'] is not False:
            raise ValueError('Restored original JWT/session must remain genuine but stale after release')
        before_late = observe(rr, 'before-late-original-requests')
        for index, user in enumerate((a, fresh_a)):
            code, error = http.post('/rest/v1/rpc/prepare_managed_stock_intent_v1', {'p_request': lost['request']}, user['token'])
            business.save(receiver_folder, 'late-original-refusal-' + str(index), dict(status=code, error=error))
            if code not in (400, 403, 409):
                raise ValueError('Original post-backup request unexpectedly accepted after release')
        if observe(rr, 'after-late-original-requests') != before_late:
            raise ValueError('Refused delayed original request changed retained data')
        # Prove the lasting session fence independently of stale versions: the
        # SAME current, valid request is refused for restored A, then accepted
        # for freshly authenticated A. Abandon it without posting more stock.
        import full121_queries as queries
        import full121_values as values
        operation_id = values.uid()
        pointer = gateway.pointer(ctx, fresh_a, operation_id)
        probe_request = gateway.request(ctx, fresh_a, operation_id)
        probe = http.rpc('probe_controlled_stock_intent_v1', {'p_request': probe_request}, fresh_a)
        options = gateway.check_probe(probe_request, probe, ctx, 'none')
        current_request = {**pointer, 'legacy_arguments': probe_request['legacy_arguments'],
            'context': gateway.context(ctx, options, rr.selected_query('fresh-normal-observation-clock', queries.clock())['at'])}
        before_fence = observe(rr, 'before-permanent-session-fence')
        code, error = http.post('/rest/v1/rpc/prepare_managed_stock_intent_v1', {'p_request': current_request}, a['token'])
        business.save(receiver_folder, 'permanent-session-fence-refusal', dict(status=code, error=error))
        if code not in (400, 403, 409) or observe(rr, 'after-permanent-session-fence') != before_fence:
            raise ValueError('Restored old session bypassed permanent controlled-entry fence')
        gateway.reply(pointer, http.rpc('prepare_managed_stock_intent_v1', {'p_request': current_request}, fresh_a), 'prepared', probe_request['legacy_arguments'])
        gateway.reply(pointer, http.rpc('close_managed_stock_intent_v1', {'p_request': pointer}, fresh_a), 'abandoned', probe_request['legacy_arguments'])
        auth_proof = receiver_auth.validate(rr, original_auth, users, grants, original['sequences'],
            observe(rr, 'receiver-final-data')['sequences'], native['boot'], first_epoch['data']['started_at'],
            rollover=dict(native_boot=restarted_native['boot'], epoch_at=epoch['data']['started_at']))
        business.save(receiver_folder, 'receiver-actual-Auth-effects', auth_proof)
        rr.verify_module('receiver-final-full-source-properties')
        self.result.update(populated_receiver_verified=True, original_complete_rows_and_sequences_restored=True,
            original_Auth_principals_preserved=True, fresh_real_password_grants=6, actual_variance_reconciliation_and_release=True,
            actual_active_receiver_restart=True, new_epoch_and_replacement_independent_acknowledgment=True,
            late_original_requests_refused=True, archive_bytes=self.archive.length, archive_sha256=self.archive.sha256)
        business.save(receiver_folder, 'populated-recovery-result', self.result)

    def cleanup(self):
        # ONE shared cleanup endpoint, including both owned projects. Each
        # unchanged bootstrap may set its internal ceiling, but runner() always
        # enforces this original shorter absolute endpoint.
        self.owner_end = None
        self.phase_end = min(self.deadline, time.monotonic() + installation.CLEANUP_SECONDS)
        if self.receiver is not None:
            self.receiver.phase_end = self.phase_end
            if self.receiver.boot is not None:
                self.receiver.boot.deadline = self.phase_end
            if getattr(self.receiver, 'paused_ingress', None):
                owned_ingress(self.receiver.runtime, 'start', cleanup=True)
            if self.receiver.boot is not None and self.receiver.boot.started and not self.receiver.boot.record.get('failure_cleanup_complete'):
                self.receiver.boot.cleanup()
            if self.receiver.boot is not None and any(self.receiver.boot.inventory()):
                raise ValueError('Owned receiver resources remain')
            self.receiver.project_sources()
        if self.archive is not None:
            self.archive.close()
        if self.boot is not None and self.boot.started and not self.boot.record.get('failure_cleanup_complete'):
            self.boot.deadline = self.phase_end
            if getattr(self, 'paused_ingress', None):
                owned_ingress(self.source_runtime, 'start', cleanup=True)
            self.boot.cleanup()
        if self.boot is not None:
            self.boot.deadline = self.phase_end
        if self.boot is not None and any(self.boot.inventory()):
            raise ValueError('Owned source resources remain')
        self.remaining()
        self.project_sources()
        self.result.update(normal_owned_cleanup=True, copied_migrations_rechecked=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group(required=True)
    modes.add_argument('--run-synthetic-local', action='store_true')
    modes.add_argument('--check-source', action='store_true')
    args = parser.parse_args()
    os.umask(0o077)
    started = time.monotonic()
    layout, pins = business.source_admission()
    operational_release.pin_sources(pins)
    for path in [HERE / name for name in ('receiver_rehearsal.py', 'receiver_auth.py', 'bounded_archive.py', 'recovery-observation.sql', 'restore-defaults.sql', 'restore-witness-check.sql', 'build_operational_module.py', 'recovery_admission_source.py', 'diagnose_register.py')] + sorted(operational.SOURCE.glob('*.sql')):
        pins[str(path.relative_to(installation.ROOT))] = digest(installation.prefix.regular(path))
    if args.check_source:
        print(json.dumps(dict(source_files=len(pins), database_operations=0, ready_for_deployment=False)))
        return
    installation.execute_owned(layout, pins, started, PopulatedRecovery)


if __name__ == '__main__':
    main()
