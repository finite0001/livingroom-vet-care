"""Real-Auth report/form engineering rehearsal; never a release acceptance result."""
import base64
import csv
from datetime import datetime, timedelta, timezone
from functools import partial
import hashlib
import io
import json
import os
from pathlib import Path
import sys
import time
import uuid

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import business_rehearsal as business
import build_operational_module as source


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def new_id():
    return str(uuid.uuid4())


def pdf_fixture():
    stream = b'BT /F1 10 Tf 10 40 Td (Synthetic narcotics supporting form) Tj ET'
    objects = [b'<< /Type /Catalog /Pages 2 0 R >>', b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 240 80] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
        b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
        b'<< /Length ' + str(len(stream)).encode() + b' >>\nstream\n' + stream + b'\nendstream']
    raw = b'%PDF-1.4\n'; offsets = [0]
    for number, value in enumerate(objects, 1):
        offsets.append(len(raw)); raw += str(number).encode() + b' 0 obj\n' + value + b'\nendobj\n'
    xref = len(raw)
    raw += b'xref\n0 6\n0000000000 65535 f \n' + b''.join(f'{offset:010d} 00000 n \n'.encode() for offset in offsets[1:])
    return raw + b'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + str(xref).encode() + b'\n%%EOF\n'


class RegisterDiagnosis(business.BusinessInstallation):
    def __init__(self, *args):
        super().__init__(*args, profile='ordinary_none')
        self.result.update(kind='narcotics-register-engineering-only-v1', engineering_only=True)

    def after_installation(self, runtime):
        program, proof = source.build(register_only=True)
        business.save(self.evidence, 'register-source-proof', proof)
        runtime.raw_query('register-engineering-install', 'BEGIN;\n' + program + '\nCOMMIT;')

    def after_business(self, context, methods, runtime, proof):
        http = context['http']; actor, other = context['users']; ids = context['ids']
        wire_entries = []
        def rpc(label, name, request):
            result = http.rpc(name, {'p_request': request}, actor)
            business.save(self.evidence, 'register-' + label, result)
            selected = {'preserve-form': 'form', 'download-form': 'download', 'create-report': 'report',
                        'create-later-report': 'later_report', 'report-first-page': 'first_page', 'report-second-page': 'second_page'}
            if label in selected:
                call = http.calls[-1]
                if call['path'] != '/rest/v1/rpc/' + name or call['status'] != 200 or call['admin_identity_creation'] is not False:
                    raise ValueError('Original authenticated operational response required')
                item = dict(kind=selected[label], request=request,
                            response=dict(file=f'http-{len(http.calls):03d}-response.json', bytes=call['bytes'], sha256=call['response_sha256']))
                if label == 'download-form':
                    item['document_hash'] = saved_form['data']['document_hash']
                wire_entries.append(item)
            return result
        def refuse(label, name, request, user=actor):
            status, result = http.post('/rest/v1/rpc/' + name, {'p_request': request}, user['token'])
            business.save(self.evidence, 'register-' + label, {'status': status, 'error': result})
            if status not in (400, 403, 409):
                raise ValueError('Expected exact unsuccessful report/form request')
        current = runtime.selected_query('register-engineering-clock', "select jsonb_build_object('at',to_char(clock_timestamp()at time zone'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"'));")['at']
        instant = datetime.fromisoformat(current.replace('Z', '+00:00')).astimezone(timezone.utc)
        utc = lambda value: value.isoformat(timespec='milliseconds').replace('+00:00', 'Z')
        scope = dict(schema_version=1, actor_id=actor['id'], product_id=ids['product'], site_id=ids['site'])
        permissions = rpc('owned-schema-permission', 'narcotics_recovery_probe_permissions_v1', dict(schema_version=1, actor_id=actor['id']))
        if permissions['engineering_only'] is not True or permissions['actual_authenticated_owned_schema_comment'] is not True or permissions['catalog_unchanged_after_rollback'] is not True:
            raise ValueError('Actual authenticated owned-schema permission probe failed')
        business.save(self.evidence, 'recovery-permission-engineering-proof', permissions)
        raw = pdf_fixture(); form_id = new_id()
        form = {**scope, 'operation_id': form_id, 'event_id': context['gateway']['pointer']['operation_id'],
            'kind': 'order_form', 'title': '=Synthetic order form', 'filename': 'synthetic-order-form.pdf',
            'obtained_at': utc(instant), 'mime': 'application/pdf', 'base64': base64.b64encode(raw).decode()}
        saved_form = rpc('preserve-form', 'preserve_narcotics_form_v1', form)
        if saved_form['state'] != 'saved' or saved_form['data']['sha256'] != digest(raw) or saved_form['data']['byte_length'] != len(raw) or saved_form['request_metadata'] != {key: value for key, value in form.items() if key != 'base64'}:
            raise ValueError('Original binary form or metadata differs')
        pointer = dict(schema_version=1, actor_id=actor['id'], operation_id=form_id)
        if rpc('recover-form', 'read_narcotics_form_operation_v1', pointer) != saved_form:
            raise ValueError('Exact original form recovery differs')
        downloaded = rpc('download-form', 'download_narcotics_form_v1', dict(schema_version=1, actor_id=actor['id'], form_id=form_id))
        if base64.b64decode(downloaded['base64'], validate=True) != raw or downloaded['sha256'] != digest(raw):
            raise ValueError('Private download changed original bytes')
        report = {**scope, 'operation_id': new_id(), 'from_at': utc(instant - timedelta(days=1)), 'to_at': utc(instant)}
        saved_report = rpc('create-report', 'create_narcotics_register_v1', report)
        data = saved_report['data']; dataset = json.loads(data['dataset_text'])
        if saved_report['state'] != 'saved' or saved_report['request_metadata'] != report or digest(data['dataset_text'].encode()) != data['dataset_hash'] or digest(data['csv_text'].encode()) != data['csv_hash']:
            raise ValueError('Exact immutable report text/hash differs')
        if dataset['report_id'] != report['operation_id'] or len(dataset['events']) != 1 or dataset['events'][0]['event_id'] != context['gateway']['pointer']['operation_id'] or dataset['events'][0]['record_hash'] != context['gateway']['receipt']['event']['record_hash']:
            raise ValueError('Complete source event membership differs')
        if len(dataset['cells']) != 1 or dataset['cells'][0]['opening_quantity'] != '0.000' or dataset['cells'][0]['closing_quantity'] != '21.000' or dataset['cells'][0]['period_opening_entry']['quantity'] != '20.000':
            raise ValueError('Exact opening-entry/closing quantities differ')
        rows = list(csv.reader(io.StringIO(data['csv_text'], newline='')))
        if any(len(row) != 21 for row in rows) or any(not value.startswith("'") for row in rows[1:] for value in row) or not any(value.startswith("'=Synthetic order form") for row in rows[1:] for value in row):
            raise ValueError('CSV exact columns/formula-safe text differ')
        for event in dataset['events']:
            if digest(event['source_packet_text'].encode()) != event['source_packet_hash']:
                raise ValueError('Original source packet bytes changed')
        if [value['form_id'] for value in dataset['supporting_forms']] != [form_id]:
            raise ValueError('As-of-capture supporting evidence differs')
        refuse('other-actor', 'read_narcotics_register_v1', dict(schema_version=1, actor_id=other['id'], operation_id=report['operation_id']), other)
        refuse('changed-report-retry', 'create_narcotics_register_v1', {**report, 'from_at': utc(instant - timedelta(hours=12))})
        refuse('changed-form-retry', 'preserve_narcotics_form_v1', {**form, 'title': 'Changed original form title'})
        second = {**form, 'operation_id': new_id(), 'event_id': None, 'kind': 'registration', 'title': '@Synthetic registration copy'}
        rpc('later-form', 'preserve_narcotics_form_v1', second)
        recovered = rpc('recover-original-report', 'read_narcotics_register_v1', dict(schema_version=1, actor_id=actor['id'], operation_id=report['operation_id']))
        if recovered != saved_report:
            raise ValueError('Later supporting evidence rewrote old report')
        later = rpc('create-later-report', 'create_narcotics_register_v1', {**report, 'operation_id': new_id()})
        if {item['form_id'] for item in json.loads(later['data']['dataset_text'])['supporting_forms']} != {form_id, second['operation_id']}:
            raise ValueError('New report omitted later preserved evidence')
        listing = {key: value for key, value in scope.items() if key != 'operation_id'}
        listing.update(after_operation_id=None, page_size=1)
        first_page = rpc('report-first-page', 'list_narcotics_registers_v1', listing)
        if first_page['actor_id'] != actor['id'] or first_page['product_id'] != ids['product'] or first_page['site_id'] != ids['site'] or first_page['has_more'] is not True or len(first_page['items']) != 1 or first_page['next_operation_id'] != first_page['items'][0]['operation_id']:
            raise ValueError('Exact bounded saved report page differs')
        second_page = rpc('report-second-page', 'list_narcotics_registers_v1', {**listing, 'after_operation_id': first_page['next_operation_id']})
        if second_page['has_more'] is not False or second_page['next_operation_id'] is not None or len(second_page['items']) != 1 or {item['operation_id'] for item in first_page['items'] + second_page['items']} != {report['operation_id'], later['operation_id']}:
            raise ValueError('Saved report pagination omitted or duplicated an original')
        refuse('other-actor-report-list', 'list_narcotics_registers_v1', {**listing, 'actor_id': other['id']}, other)
        for kind in ('report', 'form'):
            operation = new_id(); pointer = dict(schema_version=1, actor_id=actor['id'], operation_id=operation)
            api = 'read_narcotics_register_v1' if kind == 'report' else 'read_narcotics_form_operation_v1'
            if rpc(kind + '-not-found', api, pointer)['state'] != 'not_found':
                raise ValueError('Unsent original operation unexpectedly saved')
            closed = rpc(kind + '-close', 'close_narcotics_register_operation_v1', {**scope, 'kind': kind, 'operation_id': operation})
            if closed['state'] != 'abandoned':
                raise ValueError('Unsent close did not create terminal abandonment')
            refuse(kind + '-late', 'create_narcotics_register_v1' if kind == 'report' else 'preserve_narcotics_form_v1',
                {**(report if kind == 'report' else form), 'operation_id': operation})
            if rpc(kind + '-closed-read', api, pointer) != closed:
                raise ValueError('Delayed original changed its terminal closure')
        counts = runtime.selected_query('register-engineering-exact-counts', "select jsonb_build_object('descriptor',(select count(*)from narcotics_register_v1.descriptor),'operations',(select count(*)from narcotics_register_v1.operations),'reports',(select count(*)from narcotics_register_v1.reports),'contents',(select count(*)from narcotics_register_v1.form_contents),'forms',(select count(*)from narcotics_register_v1.form_records));")
        if counts != dict(descriptor=1, operations=6, reports=2, contents=2, forms=2):
            raise ValueError('Exact source-declared new report/form row counts differ')
        business.save(self.evidence, 'register-wire-original-inputs', dict(engineering_only=True, entries=wire_entries))
        checked = business.installation.process.run(['node', '--experimental-strip-types', str(HERE / 'verify-register-native-wire.mjs'), str(self.evidence)],
            cwd=business.installation.ROOT, timeout=runtime.remaining(10), stdout_cap=4096, stderr_cap=65536, check=True)
        wire_proof = business.installation.decode(checked.stdout)
        business.save(self.evidence, 'register-native-wire-proof', wire_proof)
        business.save(self.evidence, 'register-engineering-proof', {'engineering_only': True, 'original_file_sha256': digest(raw),
            'actual_binary_recovery': True, 'immutable_report_recovery': True, 'later_evidence_does_not_rewrite_snapshot': True,
            'formula_safe_csv': True, 'late_mutations_permanently_refused': True, 'new_row_counts': counts,
            'actual_staff_wire_verifier': wire_proof})

    def execute(self):
        try:
            super().execute()
        finally:
            self.result.update(application_Auth_verified=False, business_profile_verified=False,
                count_business_verified=False, authenticated_browser_verified=False, engineering_only=True)
        raise RuntimeError('Register-only engineering rehearsal cannot grant release acceptance')


if __name__ == '__main__':
    if sys.argv[1:] != ['--run-synthetic-local']:
        raise ValueError('Explicit owned synthetic engineering run required')
    os.umask(0o077); started = time.monotonic()
    layout, pins = business.source_admission()
    paths = [Path(__file__).resolve(), HERE / 'build_operational_module.py', HERE / 'verify-register-native-wire.mjs',
             *sorted(source.SOURCE.glob('*.sql')), *sorted((business.installation.ROOT / 'src/hub/features/controlled-drugs/register').glob('*.ts'))]
    for path in paths:
        pins[str(path.relative_to(business.installation.ROOT))] = digest(business.installation.prefix.regular(path))
    business.installation.execute_owned(layout, pins, started, RegisterDiagnosis)
