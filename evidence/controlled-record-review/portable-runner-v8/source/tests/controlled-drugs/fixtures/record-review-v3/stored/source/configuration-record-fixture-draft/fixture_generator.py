"""Fixed source-only SQL diagnostic generator. No subprocess/socket/DB launch API.

Expectations are frozen corpus strings, never imports from tested implementations.
The retained observer is used only to form conservation SQL, not semantic oracles.
"""
from pathlib import Path
from decimal import Decimal
import ast
import hashlib
import importlib
import json
import re
import sys

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
CANDIDATE = REPO / 'tests/controlled-drugs/engine/candidate'
ROOT = HERE.parent
CORPORA = (('configuration-record-vectors', '124145aed3ca5b82f35526b4486ba5d54b117e014879da897cc1d93b545fd7e1'),
           ('configuration-record-boundary-vectors', '2efb0b0362e03d8f46dc80f248d96bccd4de3578b28032b98879c9f2e85cabe8'))
PLAN = ROOT / 'configuration-record-runtime-plan.md'
PLAN_SHA = 'ce219e439addb0fea380eba4426cffeaa64f76bfa56f2fc9bc043560653feca1'
OBSERVER_MAP_SHA = '4103953a6307e6b33ca1431a03339f299ad269c24cf0e59482f5a2af11159ec4'
GUARD_MAP_SHA = '72f1eb188ba60096b04136a307c00553d6379bad72841f011563b1844c4e9218'
TARGETS = {'validate_stored_configuration': 'stored_configuration_invalid',
           'validate_configuration_record': 'configuration_record_invalid',
           'configuration_record': 'configuration_record_invalid',
           'validate_configuration_pair': 'configuration_pair_invalid'}
PUBLIC = ('prepare_controlled_record_review_v3', 'read_controlled_record_review_v3',
          'execute_controlled_record_review_v3', 'cancel_controlled_record_review_v3',
          'get_controlled_record_review_event_v3', 'list_controlled_record_reviews_v3',
          'publish_controlled_review_configuration_v3', 'read_controlled_review_publication_v3',
          'get_controlled_review_configuration_v3', 'record_controlled_review_escalation_action_v3',
          'get_controlled_review_backlog_v3')
PRIVATE = ('publish_administration', 'materialize_one', 'record_scan')
STUBS = tuple('public.' + name for name in PUBLIC) + tuple('controlled_review_v3.' + name for name in PRIVATE)
PURE = tuple('controlled_review_v3.' + name for name in TARGETS) + ('controlled_review_v3.validate_calendar_observation', 'controlled_review_v3.validate_configuration')
ACL_FUNCTIONS = PURE + STUBS
TABLES = ('descriptor', 'publications', 'configuration', 'families', 'obligations', 'operation_claims',
          'preparations', 'decisions', 'cancellations', 'escalations', 'escalation_actions', 'materializations', 'scan_receipts')
GUARDS = {'immutable_guard': ('23514', 'Record-review v3 Gate B private A1 evidence is immutable', 'check_violation'),
          'refuse_insert': ('0A000', 'Record-review v3 structural Gate B private A1; operational writes are not implemented', 'feature_not_supported'),
          'terminal_check': ('0A000', 'Record-review v3 structural Gate B private A1; terminal semantics are not implemented', 'feature_not_supported')}
STUB_MESSAGE = 'Record-review v3 Gate B private A1; protocol is not implemented'
ROLES = ('anon', 'authenticated', 'service_role')
ZONES = ('UTC', 'America/Denver', 'Asia/Kathmandu')
GUC_KEYS = ('TimeZone', 'search_path', 'session_replication_role', 'transaction_isolation', 'role',
            'request.jwt.claims', 'request.jwt.claim.sub', 'request.jwt.claim.role', 'request.jwt.claim.email')
ZONE_CASES = tuple('positive/' + base + '/' + shape for base in ('policy-enabled-first', 'policy-at', 'calendar-fold1') for shape in ('D', 'R', 'Q', 'pair')) + (
    'primitive/D/version/fractional', 'primitive/R/version/fractional', 'primitive/Q/version-visible-fraction',
    'primitive/pair/receipt-version-visible-fraction', 'timestamp/stored-policy/extra-fraction', 'timestamp/published/offset')
RENDER_BATCH = 64
DECODE_BATCH = 100
SUCCESS_BATCH = 25
REFUSAL_BATCH = 50
STREAM_LIMIT = 134217728
CASE_IDS_SHA = '102f12fe91b2bd9253f4a77fff19885479b1a4e595ccbe7f6fd7258178081ceb'
TEMP_TABLES = ('cr_render', 'cr_render_proof', 'cr_cases', 'cr_proof', 'cr_baseline', 'cr_context',
               'cr_guard_immutable_guard', 'cr_guard_refuse_insert', 'cr_guard_terminal_check')
TEMP_FUNCTIONS = ('v3_gate_catalog()', 'v3_gate_rows()', 'cr_identity()', 'cr_session()', 'cr_conserved()', 'cr_temp_structure()')
TEMP_TRIGGERS = ('cr_guard_immutable_guard:cr_internal_guard', 'cr_guard_refuse_insert:cr_internal_guard', 'cr_guard_terminal_check:cr_internal_guard')


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def unique(pairs):
    answer = {}
    for key, value in pairs:
        if key in answer:
            raise ValueError('duplicate JSON key')
        answer[key] = value
    return answer


def decode(text):
    return json.loads(text, parse_float=Decimal, object_pairs_hook=unique)


def quote(text):
    return "'" + text.replace("'", "''") + "'"


def encoded(text):
    return "convert_from(decode('" + text.encode('utf-8').hex() + "','hex'),'UTF8')"


def pin(path, expected):
    raw = path.read_bytes()
    if sha(raw) != expected:
        raise ValueError('changed pinned input: ' + str(path))
    return raw


def admit_cases(cases):
    """Validation-only: never normalize JSON tokens or derive returned values."""
    seen = set()
    for case in cases:
        cid = case['id']
        if not isinstance(cid, str) or not re.fullmatch(r'[A-Za-z0-9_/:.\-]+', cid) or cid in seen:
            raise ValueError('case ID inventory')
        seen.add(cid)
        function = case['function']
        if function not in TARGETS:
            raise ValueError('unapproved target dispatch')
        if case['argument_kind'] == 'sql_null':
            if 'argument_jsonb_text' in case:
                raise ValueError('SQL NULL must not have lexical JSON')
        elif case['argument_kind'] == 'jsonb':
            text = case['argument_jsonb_text']
            decode(text)
            if len(text.encode()) != case['argument_utf8_bytes']:
                raise ValueError('case lexical bytes')
        else:
            raise ValueError('argument tag')
        expected = case['expected']
        if expected['outcome'] == 'error':
            if expected != {'outcome': 'error', 'sqlstate': '23514', 'message': TARGETS[function]}:
                raise ValueError('exact target primary error')
        elif expected['outcome'] == 'success':
            if set(expected) != {'outcome', 'return_jsonb_text'} or case['argument_kind'] != 'jsonb':
                raise ValueError('success convention')
            decode(expected['return_jsonb_text'])
            if function != 'configuration_record' and expected['return_jsonb_text'] != case['argument_jsonb_text']:
                raise ValueError('unchanged-input success expected')
        else:
            raise ValueError('unknown outcome')
    return cases


def load_inputs():
    inputs = {str(PLAN.relative_to(REPO)): sha(pin(PLAN, PLAN_SHA))}
    cases = []
    render = {}

    def add_text(raw, rendered=None, preimage_digest=None, origin=None):
        rendered = raw if rendered is None else rendered
        decode(raw); decode(rendered)
        if preimage_digest is not None and sha(raw.encode()) != preimage_digest:
            raise ValueError('frozen preimage digest mismatch')
        key = (raw, rendered, preimage_digest)
        if key not in render:
            identifier = sha((raw + '\x00' + rendered + '\x00' + (preimage_digest or '')).encode())
            render[key] = {'id': identifier, 'raw': raw, 'rendered': rendered, 'preimage_digest': preimage_digest, 'origins': []}
        render[key]['origins'].append(origin)

    for dirname, manifest_sha in CORPORA:
        directory = ROOT / dirname
        manifest_path = directory / 'freeze-manifest.json'
        manifest = json.loads(pin(manifest_path, manifest_sha), object_pairs_hook=unique)
        inputs[str(manifest_path.relative_to(REPO))] = manifest_sha
        for filename, item in manifest['files'].items():
            path = directory / filename
            raw = pin(path, item['sha256'])
            if len(raw) != item['bytes']:
                raise ValueError('pinned file byte count')
            inputs[str(path.relative_to(REPO))] = item['sha256']
        for filename in ('cases.json', 'supplement-cases.json'):
            if filename in manifest['files']:
                cases.extend(json.loads((directory / filename).read_text(), object_pairs_hook=unique))
        if 'anchors.json' in manifest['files']:
            for anchor in json.loads((directory / 'anchors.json').read_text()):
                raw = bytes.fromhex(anchor['expected_utf8_hex'])
                if raw.decode() != anchor['expected_jsonb_text'] or sha(raw) != anchor['expected_sha256']:
                    raise ValueError('anchor bytes')
                add_text(anchor['input_wire_json'], anchor['expected_jsonb_text'], origin='anchor:' + anchor['id'])
                add_text(anchor['expected_jsonb_text'], preimage_digest=anchor['expected_sha256'], origin='anchor-hash:' + anchor['id'])
        for family in json.loads((directory / 'families.json').read_text()):
            for label, item in family['values'].items():
                text = item['jsonb_text']
                if len(text.encode()) != item['utf8_bytes'] or sha(text.encode()) != item['sha256']:
                    raise ValueError('family text bytes')
                add_text(text, origin='family:' + family['id'] + ':' + label)
            for label, target, key in [('record_hash_preimage', 'R', 'record_hash'), ('request_hash_preimage', 'P', 'request_hash')]:
                expected = decode(family['values'][target]['jsonb_text'])[key]
                preimage = family[label]
                if isinstance(preimage, dict):
                    if preimage['sha256'] != expected or bytes.fromhex(preimage['utf8_hex']).decode() != preimage['jsonb_text']:
                        raise ValueError('preimage literal bytes')
                    preimage = preimage['jsonb_text']
                add_text(preimage, preimage_digest=expected, origin='preimage:' + family['id'] + ':' + label)
    admit_cases(cases)
    if len(cases) != 1594 or sum(c['expected']['outcome'] == 'success' for c in cases) != 204:
        raise ValueError('fixed corpus cardinality')
    if sha(('\n'.join(sorted(case['id'] for case in cases)) + '\n').encode()) != CASE_IDS_SHA:
        raise ValueError('fixed complete case ID inventory')
    for case in cases:
        if case['argument_kind'] == 'jsonb':
            add_text(case['argument_jsonb_text'], origin='case:' + case['id'])
        if case['expected']['outcome'] == 'success':
            add_text(case['expected']['return_jsonb_text'], origin='expected-return:' + case['id'])
    by_id = {case['id']: case for case in cases}
    for cid, path, spelling in [('primitive/Q/version-visible-fraction', ('version',), '1.0'),
                               ('primitive/pair/receipt-version-visible-fraction', ('publication','receipt','version'), '3.0')]:
        val = decode(by_id[cid]['argument_jsonb_text'])
        for part in path:
            val = val[part]
        if not isinstance(val, Decimal) or str(val) != spelling:
            raise ValueError('visible numeric scale erased')
    if sum(c['argument_kind'] == 'sql_null' for c in cases) != 4:
        raise ValueError('SQL NULL inventory')
    return cases, sorted(render.values(), key=lambda row: row['id']), inputs


def observer_source():
    map_path = HERE / 'observer-inputs.json'
    declarations = json.loads(pin(map_path, OBSERVER_MAP_SHA), object_pairs_hook=unique)
    inputs = {str(map_path.relative_to(REPO)): OBSERVER_MAP_SHA}
    observed_closure = set()
    pending = ['record_review_v3_gate_a_snapshot']
    while pending:
        name = pending.pop()
        path = CANDIDATE / (name + '.py')
        if not path.is_file() or name in observed_closure:
            continue
        if name not in declarations:
            raise ValueError('unbound local observer import: ' + name)
        item = declarations[name]
        if path != REPO / item['path']:
            raise ValueError('observer path binding')
        raw = pin(path, item['sha256']); inputs[item['path']] = item['sha256']
        observed_closure.add(name)
        for node in ast.walk(ast.parse(raw)):
            if isinstance(node, ast.Import):
                pending.extend(alias.name.split('.')[0] for alias in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module:
                pending.append(node.module.split('.')[0])
    if observed_closure != set(declarations):
        raise ValueError('observer transitive closure changed')
    old_path = list(sys.path)
    try:
        sys.path.insert(0, str(CANDIDATE))
        observer = importlib.import_module('record_review_v3_gate_a_snapshot')
        for name in declarations:
            if name in sys.modules and Path(sys.modules[name].__file__).resolve() != CANDIDATE / (name + '.py'):
                raise ValueError('observer import shadowing')
    finally:
        sys.path[:] = old_path
    setup = observer.SETUP
    # The retained observer's SET UTC is setup behavior, not a semantic oracle.
    # Keep the original caller context: only remove this exact, known leading SET.
    if not setup.startswith("set timezone='UTC';\n"):
        raise ValueError('retained observer setup changed')
    setup = setup.removeprefix("set timezone='UTC';\n")
    guard_path = CANDIDATE / 'record-review-v3-schema.sql'
    guard_raw = guard_path.read_bytes()
    # Pin the source independently in observer-guards.json, not by live acceptance.
    guard_pin = json.loads(pin(HERE / 'guard-input.json', GUARD_MAP_SHA))
    pin(guard_path, guard_pin['sha256'])
    inputs[str(guard_path.relative_to(REPO))] = guard_pin['sha256']
    inputs[str((HERE / 'guard-input.json').relative_to(REPO))] = sha((HERE / 'guard-input.json').read_bytes())
    for _, message, _ in GUARDS.values():
        if message not in guard_raw.decode():
            raise ValueError('guard source diagnostic')
    return setup, observer.VALUE, inputs


def block(body):
    return "do $cr_fixture$\ndeclare refused boolean; actual_code text; actual_message text; returned jsonb; case_input jsonb; expected_value jsonb; expected_text text; item record;\nbegin\n" + body + "\nend\n$cr_fixture$;\n"


def refusal(statement, code, message, condition):
    # Exactly ONE target statement is protected. Decode/expected loading is outside.
    return "refused := false;\nbegin\n " + statement + "\nexception when " + condition + " then\n get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;\n if actual_code <> " + quote(code) + " or actual_message <> " + quote(message) + " then\n  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;\n end if;\n refused := true;\nend;\nif not refused then raise exception 'record_fixture_expected_refusal';end if;\n"


def proof(cid, outcome):
    return 'insert into pg_temp.cr_proof(id,outcome)values(' + quote(cid) + ',' + quote(outcome) + ');\n'


def outcome(case):
    return 'literal_success' if case['expected']['outcome'] == 'success' else '23514_' + case['expected']['message']


def target_case(case, proof_id=None):
    function = case['function']
    if function not in TARGETS:
        raise ValueError('fixed dispatch only')
    body = "select argument_value,expected_value,expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases where id=" + quote(case['id']) + ';\n'
    # Qualify all row columns to avoid PL/pgSQL variable-column ambiguity.
    body = body.replace('select argument_value,expected_value,expected_text', 'select c.argument_value,c.expected_value,c.expected_text').replace('from pg_temp.cr_cases where', 'from pg_temp.cr_cases c where c.')
    call = 'controlled_review_v3.' + function + '(case_input)'
    if case['expected']['outcome'] == 'success':
        body += 'returned := ' + call + ";\nif returned is null or returned is distinct from expected_value or convert_to(returned::text,'UTF8') is distinct from convert_to(expected_text,'UTF8') then raise exception 'record_fixture_literal_output_mismatch';end if;\n"
        if function != 'configuration_record':
            body += "if returned is distinct from case_input then raise exception 'record_fixture_input_changed';end if;\n"
    else:
        body += refusal('perform ' + call + ';', '23514', TARGETS[function], 'check_violation')
    if proof_id is not None:
        body += proof(proof_id, outcome(case))
    return body


def conservation():
    return 'select pg_temp.cr_conserved();\n'


def compile_stages():
    cases, renders, inputs = load_inputs()
    observer_setup, value, observer_inputs = observer_source(); inputs.update(observer_inputs)
    by_id = {case['id']: case for case in cases}
    # All case/expected strings already have canonical raw=rendered entries.
    # Decode by their pinned render IDs instead of retransmitting large JSON text.
    render_by_text = {row['raw']: row['id'] for row in renders if row['raw'] == row['rendered'] and row['preimage_digest'] is None}
    if not set(ZONE_CASES) <= set(by_id):
        raise ValueError('zone representative inventory')
    stages = {}
    session = "jsonb_build_object('settings',(select jsonb_object_agg(k,current_setting(k,true))from unnest(array[" + ','.join(map(quote, GUC_KEYS)) + "])as keys(k)),'current_user',current_user,'session_user',session_user,'auth_uid',auth.uid(),'auth_role',auth.role(),'auth_email',auth.email(),'advisory',(select coalesce(jsonb_agg(to_jsonb(l)-'pid' order by l.classid,l.objid,l.objsubid,l.mode),'[]')from pg_locks l where l.pid=pg_backend_pid()and l.locktype='advisory'))"
    setup = """-- Fixed diagnostic SQL only. Requires ON_ERROR_STOP and separately admitted source metadata.
create temp table cr_render(id text primary key,raw_text text not null,expected_text text not null,preimage_hash text check(preimage_hash ~ '^[0-9a-f]{64}$'));
create temp table cr_render_proof(id text primary key);
create temp table cr_cases(id text primary key,ordinal integer not null unique check(ordinal between 0 and 1593),function_name text not null check(function_name in('validate_stored_configuration','validate_configuration_record','configuration_record','validate_configuration_pair')),argument_kind text not null check(argument_kind in('sql_null','jsonb')),argument_text text,argument_value jsonb,expected_text text,expected_value jsonb,outcome text not null,
 check((argument_kind='sql_null'and argument_text is null and argument_value is null)or(argument_kind='jsonb'and argument_text is not null and argument_value is not null)),
 check((outcome='literal_success'and expected_text is not null and expected_value is not null)or(outcome<>'literal_success'and expected_text is null and expected_value is null)));
create temp table cr_proof(id text primary key,outcome text not null);
create temp table cr_baseline(permanent_value jsonb not null,session_value jsonb not null,metadata_value jsonb not null,temp_value jsonb not null);
create temp table cr_context(value jsonb not null);
"""
    for name in GUARDS:
        setup += 'create temp table cr_guard_' + name + '(id integer not null);\n'
        if name == 'terminal_check':
            setup += 'create constraint trigger cr_internal_guard after insert on pg_temp.cr_guard_' + name + ' deferrable initially immediate for each row execute function controlled_review_v3.' + name + '();\n'
        else:
            setup += 'create trigger cr_internal_guard before insert on pg_temp.cr_guard_' + name + ' for each row execute function controlled_review_v3.' + name + '();\n'
    setup += observer_setup
    identity_body = """
 if current_user<>'postgres' or session_user<>'postgres' or current_setting('role')<>'none'
 or current_setting('session_replication_role')<>'origin' or current_setting('transaction_isolation')<>'read committed'
 or auth.uid() is not null or auth.role() is not null or auth.email() is not null
 or exists(select 1 from unnest(array['request.jwt.claims','request.jwt.claim.sub','request.jwt.claim.role','request.jwt.claim.email'])g(k)where coalesce(current_setting(k,true),'')<>'') then
 raise exception 'record_fixture_direct_postgres_origin_required';end if;
"""
    setup = block(identity_body) + setup
    setup += 'create function pg_temp.cr_identity()returns void language plpgsql as $identity$ begin\n' + identity_body + 'end $identity$;\n'
    setup += 'create function pg_temp.cr_session()returns jsonb language sql as $session$ select ' + session + ' $session$;\n'
    setup += """create function pg_temp.cr_temp_structure()returns jsonb language sql as $temp_structure$
select jsonb_build_object(
 'relations',(select coalesce(jsonb_agg(jsonb_build_object('name',c.relname,'kind',c.relkind,'owner',c.relowner,'acl',c.relacl,
  'columns',(select jsonb_agg(to_jsonb(a)order by a.attnum)from pg_attribute a where a.attrelid=c.oid and a.attnum>0),
  'constraints',(select coalesce(jsonb_agg(to_jsonb(k)order by k.conname),'[]')from pg_constraint k where k.conrelid=c.oid),
  'triggers',(select coalesce(jsonb_agg(to_jsonb(t)order by t.tgname),'[]')from pg_trigger t where t.tgrelid=c.oid),
  'index',case when c.relkind='i'then pg_get_indexdef(c.oid)else null end)order by c.relname),'[]')from pg_class c where c.relnamespace=pg_my_temp_schema()),
 'functions',(select coalesce(jsonb_agg(to_jsonb(p)order by p.proname,p.oid),'[]')from pg_proc p where p.pronamespace=pg_my_temp_schema()),
 'types',(select coalesce(jsonb_agg(to_jsonb(t)order by t.typname),'[]')from pg_type t where t.typnamespace=pg_my_temp_schema()));
$temp_structure$;
"""
    setup += 'create function pg_temp.cr_conserved()returns void language plpgsql as $conserved$\nbegin\n perform pg_temp.cr_identity();\n perform controlled_review_v3.required();\n'
    setup += " if (select count(*)from pg_temp.cr_baseline)<>1 or not exists(select 1 from pg_temp.cr_baseline b where b.permanent_value=(" + value + ")and b.session_value=pg_temp.cr_session()and b.metadata_value=controlled_review_v3.snapshot()and b.temp_value=pg_temp.cr_temp_structure())then raise exception 'record_fixture_permanent_session_or_metadata_changed';end if;\n"
    setup += " if exists(select 1 from pg_temp.cr_context) or " + ' or '.join('exists(select 1 from pg_temp.cr_guard_' + name + ')' for name in GUARDS) + " then raise exception 'record_fixture_temp_control_rows_remain';end if;\nend $conserved$;\nselect pg_temp.cr_identity();\n"
    stages['setup'] = setup

    for start in range(0, len(renders), RENDER_BATCH):
        sql = 'select pg_temp.cr_identity();\n'
        for row in renders[start:start+RENDER_BATCH]:
            expected_expr = 'v.t' if row['raw'] == row['rendered'] else encoded(row['rendered'])
            sql += 'insert into pg_temp.cr_render select ' + quote(row['id']) + ',v.t,' + expected_expr + ',' + ('null' if row['preimage_digest'] is None else quote(row['preimage_digest'])) + ' from(select ' + encoded(row['raw']) + ' as t)v;\n'
        # All decoding and hashing deliberately outside a target error handler.
        sql += block("for item in select r.* from pg_temp.cr_render r where not exists(select 1 from pg_temp.cr_render_proof p where p.id=r.id)order by r.id loop\n case_input := item.raw_text::jsonb;\n if convert_to(case_input::text,'UTF8') is distinct from convert_to(item.expected_text,'UTF8') then raise exception 'record_fixture_renderer_mismatch: %',item.id;end if;\n if item.preimage_hash is not null and encode(sha256(convert_to(item.raw_text,'UTF8')),'hex')<>item.preimage_hash then raise exception 'record_fixture_preimage_hash_mismatch: %',item.id;end if;\n insert into pg_temp.cr_render_proof values(item.id);\nend loop;\n")
        stages['render_%04d' % start] = sql
    for start in range(0, len(cases), DECODE_BATCH):
        sql = ''
        for ordinal in range(start, min(start+DECODE_BATCH, len(cases))):
            case = cases[ordinal]
            arg = 'null::text' if case['argument_kind'] == 'sql_null' else '(select raw_text from pg_temp.cr_render where id=' + quote(render_by_text[case['argument_jsonb_text']]) + ')'
            expected = '(select raw_text from pg_temp.cr_render where id=' + quote(render_by_text[case['expected']['return_jsonb_text']]) + ')' if case['expected']['outcome'] == 'success' else 'null::text'
            sql += 'insert into pg_temp.cr_cases select ' + ','.join([quote(case['id']), str(ordinal), quote(case['function']), quote(case['argument_kind']), 'v.a', 'v.a::jsonb', 'v.e', 'v.e::jsonb', quote(outcome(case))]) + ' from(select ' + arg + ' as a,' + expected + ' as e)v;\n'
        stages['decode_%04d' % start] = sql
    render_ids = json.dumps([row['id'] for row in renders], separators=(',', ':'))
    case_ids = json.dumps(sorted(by_id), separators=(',', ':'))
    stages['renderer_and_case_gate'] = block("if (select jsonb_agg(id order by id collate \"C\")from pg_temp.cr_render_proof)is distinct from " + encoded(render_ids) + "::jsonb or(select jsonb_agg(id order by id collate \"C\")from pg_temp.cr_render)is distinct from " + encoded(render_ids) + "::jsonb then raise exception 'record_fixture_renderer_inventory';end if;\nif (select jsonb_agg(id order by id collate \"C\")from pg_temp.cr_cases)is distinct from " + encoded(case_ids) + "::jsonb then raise exception 'record_fixture_case_inventory';end if;\nif (select count(*)from pg_temp.cr_cases where argument_kind='sql_null'and argument_value is null and argument_text is null)<>4 then raise exception 'record_fixture_sql_null_tag';end if;\nif (select argument_value->'version'from pg_temp.cr_cases where id='primitive/Q/version-visible-fraction')::text<>'1.0' or(select argument_value#>'{publication,receipt,version}'from pg_temp.cr_cases where id='primitive/pair/receipt-version-visible-fraction')::text<>'3.0' then raise exception 'record_fixture_scale_erased';end if;\n")
    temp_names = ','.join(map(quote, sorted(TEMP_TABLES)))
    temp_functions = ','.join(map(quote, sorted(name.removesuffix('()') for name in TEMP_FUNCTIONS)))
    stages['capture_baseline'] = "select pg_temp.cr_identity();\nselect controlled_review_v3.required();\n" + block("if exists(select 1 from pg_locks where pid=pg_backend_pid()and locktype='advisory')then raise exception 'record_fixture_baseline_advisory_locks';end if;\nif(select array_agg(relname::text order by relname::text collate \"C\")from pg_class where relnamespace=pg_my_temp_schema()and relkind='r')is distinct from array[" + temp_names + "]::text[] or(select array_agg(proname::text order by proname::text collate \"C\")from pg_proc where pronamespace=pg_my_temp_schema())is distinct from array[" + temp_functions + "]::text[] then raise exception 'record_fixture_temp_scaffolding_inventory';end if;\n") + 'insert into pg_temp.cr_baseline select ' + value + ',pg_temp.cr_session(),controlled_review_v3.snapshot(),pg_temp.cr_temp_structure();\n' + conservation()
    all_expected = {case['id']: outcome(case) for case in cases}
    for label, kind, batch in [('success', 'success', SUCCESS_BATCH), ('refusal', 'error', REFUSAL_BATCH)]:
        group = [case for case in cases if case['expected']['outcome'] == kind]
        for start in range(0, len(group), batch):
            stages[label + '_%04d' % start] = block(''.join(target_case(case, case['id']) for case in group[start:start+batch])) + conservation()
    for zone_index, zone in enumerate(ZONES):
        sql = 'begin;\nset local timezone=' + quote(zone) + ';\ninsert into pg_temp.cr_context select pg_temp.cr_session();\n'
        sql += block(''.join(target_case(by_id[cid]) for cid in ZONE_CASES) + "if(select count(*)from pg_temp.cr_context)<>1 or(select value from pg_temp.cr_context)is distinct from pg_temp.cr_session()then raise exception 'record_fixture_zone_context_leaked';end if;\n")
        sql += 'rollback;\n'
        for cid in ZONE_CASES:
            identifier = 'zone:' + zone + ':' + cid
            sql += proof(identifier, outcome(by_id[cid])); all_expected[identifier] = outcome(by_id[cid])
        stages['zone_%02d' % zone_index] = sql + conservation()
    body = "case_input := '{}'::jsonb;\n"
    for function in STUBS:
        identifier = 'stub:' + function
        body += refusal('perform ' + function + '(case_input);', '0A000', STUB_MESSAGE, 'feature_not_supported') + proof(identifier, '0A000_stub')
        all_expected[identifier] = '0A000_stub'
    for function, (code, message, condition) in GUARDS.items():
        identifier = 'internal-guard:' + function
        body += refusal('insert into pg_temp.cr_guard_' + function + '(id)values(1);', code, message, condition) + proof(identifier, code + '_internal_guard')
        all_expected[identifier] = code + '_internal_guard'
    body += refusal("insert into controlled_review_v3.operation_claims(operation_id,actor_id,claimed_at)values('d4444444-4444-4444-8444-444444444444','c3333333-3333-4333-8333-333333333333','2026-01-01T00:00:00.000000Z'::timestamptz);", *GUARDS['refuse_insert'])
    body += proof('permanent-guard:operation_claims', '0A000_refuse_insert'); all_expected['permanent-guard:operation_claims'] = '0A000_refuse_insert'
    stages['stubs_and_guards'] = block(body) + conservation()
    public_names = ','.join(map(quote, PUBLIC))
    scope = "(n.nspname='controlled_review_v3'or(n.nspname='public'and p.proname=any(array[" + public_names + '])))'
    acl = "select controlled_review_v3.required();\n" + block("for item in select p.oid,p.proowner,p.proacl from pg_proc p join pg_namespace n on n.oid=p.pronamespace where " + scope + " loop\n if item.proowner<>'postgres'::regrole or(select count(*)from aclexplode(coalesce(item.proacl,acldefault('f',item.proowner))))<>1 or not exists(select 1 from aclexplode(coalesce(item.proacl,acldefault('f',item.proowner)))a where a.grantee='postgres'::regrole and a.grantor='postgres'::regrole and a.privilege_type='EXECUTE'and not a.is_grantable)then raise exception 'record_fixture_function_acl';end if;\nend loop;\nif(select count(*)from pg_proc p join pg_namespace n on n.oid=p.pronamespace where " + scope + ")<>37 then raise exception 'record_fixture_all_function_inventory';end if;\nif(select count(*)from pg_class where relnamespace='controlled_review_v3'::regnamespace and relkind='r')<>13 then raise exception 'record_fixture_table_inventory';end if;\nif exists(select 1 from pg_namespace n cross join lateral aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner)))a where n.nspname='controlled_review_v3'and(n.nspowner<>'postgres'::regrole or a.grantee<>'postgres'::regrole or a.grantor<>'postgres'::regrole or a.is_grantable))then raise exception 'record_fixture_schema_acl';end if;\nif exists(select 1 from pg_class c cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner)))a where c.relnamespace='controlled_review_v3'::regnamespace and c.relkind='r'and(c.relowner<>'postgres'::regrole or a.grantee<>'postgres'::regrole or a.grantor<>'postgres'::regrole or a.is_grantable))then raise exception 'record_fixture_table_acl';end if;\n" + ''.join("if has_schema_privilege(" + quote(role) + ",'controlled_review_v3','USAGE,CREATE')or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where " + scope + ' and has_function_privilege(' + quote(role) + ",p.oid,'EXECUTE'))or exists(select 1 from pg_class c where c.relnamespace='controlled_review_v3'::regnamespace and c.relkind='r'and(has_table_privilege(" + quote(role) + ",c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')or has_any_column_privilege(" + quote(role) + ",c.oid,'SELECT,INSERT,UPDATE,REFERENCES')))then raise exception 'record_fixture_effective_role_acl';end if;\n" for role in ROLES) + proof('catalog:all-private-metadata-acl', 'private_owner_only'))
    all_expected['catalog:all-private-metadata-acl'] = 'private_owner_only'
    stages['all_metadata_acl'] = acl + conservation()
    for role in ROLES:
        body = "case_input := '{}'::jsonb;\n"
        for function in ACL_FUNCTIONS:
            message = 'permission denied for schema controlled_review_v3' if function.startswith('controlled_review_v3.') else 'permission denied for function ' + function.split('.')[1]
            body += refusal('perform ' + function + '(case_input);', '42501', message, 'insufficient_privilege')
        sql = 'begin;\nset local role ' + role + ';\n' + block(body) + 'rollback;\n'
        for function in ACL_FUNCTIONS:
            identifier = 'acl:' + role + ':' + function
            sql += proof(identifier, '42501_privilege_boundary'); all_expected[identifier] = '42501_privilege_boundary'
        stages['role_' + role] = sql + conservation()
    final = json.dumps(all_expected, sort_keys=True, separators=(',', ':'))
    stages['final_inventory'] = conservation() + block("if(select jsonb_object_agg(id,outcome)from pg_temp.cr_proof)is distinct from " + encoded(final) + "::jsonb then raise exception 'record_fixture_complete_outcome_inventory';end if;\n") + "select jsonb_build_object('kind','private-stored-configuration-value-observations-v1','acceptance',false,'publication',false,'auth_acceptance',false,'clinical_activation',false,'proof',(select jsonb_object_agg(id,outcome)from pg_temp.cr_proof));\n"
    for path in sorted(HERE.glob('*.py')):
        inputs[str(path.relative_to(REPO))] = sha(path.read_bytes())
    phase_info = {name: {'sha256': sha(sql.encode()), 'bytes': len(sql.encode())} for name, sql in stages.items()}
    total = sum(item['bytes'] for item in phase_info.values())
    if max(item['bytes'] for item in phase_info.values()) >= STREAM_LIMIT or total >= STREAM_LIMIT:
        raise ValueError('fixed SQL input stream bound')
    inventory = {'kind': 'private-record-fixture-source-draft-v1', 'source_only': True, 'runtime_executed': False,
                 'metadata_precondition': 'separately_source_derived_37_function_13_table_profile_installed_and_independently_verified_before_this_harness',
                 'metadata_oracle_imported_from_target': False, 'phase_names': list(stages), 'phases': phase_info,
                 'total_sql_bytes': total, 'phase_seconds': 120, 'whole_seconds': 600, 'absolute_cutoff_seconds_before_outer_deadline': 60,
                 'single_emergency_cleanup_seconds': 180, 'stream_limit_bytes': STREAM_LIMIT, 'reader_limit_bytes': STREAM_LIMIT,
                 'case_inventory': [{'id': c['id'], 'function': c['function'], 'argument_kind': c['argument_kind'], 'argument_sha256': None if c['argument_kind']=='sql_null' else sha(c['argument_jsonb_text'].encode()), 'expected': c['expected']} for c in cases],
                 'target_cases': 1594, 'successes': 204, 'refusals': 1390, 'render_inventory': renders,
                 'complete_expected_outcomes': all_expected, 'zone_cases': list(ZONE_CASES), 'zones': list(ZONES),
                 'temp_scaffolding': {'tables': list(TEMP_TABLES), 'functions': list(TEMP_FUNCTIONS), 'triggers': list(TEMP_TRIGGERS), 'implicit_objects': 'TEMP table row/array types, primary/unique indexes and TOAST relations generated solely by these declarations'},
                 'observer_setup_delta': 'remove exact leading SET TimeZone UTC only; preserve caller context',
                 'source_hashes': inputs, 'byte_guard_branch_proof': False, 'exhaustive_section8_acceptance': False}
    return stages, inventory


def write_new(output):
    if output.parent != HERE:
        raise ValueError('private fixed-directory output only')
    stages, inventory = compile_stages()
    output.mkdir(mode=0o700)
    for index, (name, sql) in enumerate(stages.items()):
        with (output / ('%03d-' % index + name + '.sql')).open('x') as handle:
            handle.write(sql)
    with (output / 'inventory.json').open('x') as handle:
        handle.write(json.dumps(inventory, ensure_ascii=False, indent=2) + '\n')
    return inventory


def main():
    if sys.argv[1:] == ['--write-new']:
        inventory = write_new(HERE / 'sql-v1')
    elif not sys.argv[1:]:
        _, inventory = compile_stages()
    else:
        raise SystemExit('No runtime options. Omit arguments for source report; --write-new creates fixed sql-v1 only.')
    print(json.dumps({'source_only': True, 'phases': len(inventory['phases']), 'target_cases': 1594, 'render_entries': len(inventory['render_inventory']), 'total_sql_bytes': inventory['total_sql_bytes'], 'runtime_executed': False}, sort_keys=True))


if __name__ == '__main__':
    main()
