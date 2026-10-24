"""Strict paired worker evidence. Source/job/policy authority belongs to caller."""
import hashlib
import json
import math
import re

MAX_BYTES = 4 * 1024 * 1024
MAX_IDS = 4096
CONTRACT_SHA = '27ffe06d39e6c70051ad62fa33855d2220af94a83f26032b2d5d08fd8c65c847'
POLICY_SHA = 'd7c626ca52673bafa204ffb57ca97b1cb618b08edb8659868fb9e4b0b1b27b46'
CONTEXT_KEYS = frozenset(('job_id','job_sha256','suite_id','suite_tree_tag','expected_ids',
    'source_trees_sha256','implementation_sha256','policy_envelope_sha256','contract_sha256','allowed_routes'))
ENVELOPE_KEYS = frozenset(('kind','status','job_id','job_sha256','suite_id','suite_tree_tag',
    'source_trees_sha256','implementation_sha256','policy_envelope_sha256','report'))
REPORT_KEYS = frozenset(('kind','suite_id','contract_sha256','installed','test_ids','active_test',
    'launches','denial_count','denials','owned_directories','pending_node_permit','universal_descendant_containment'))
PAIR_KEYS = frozenset(('kind','result','guard','terminal_sha256','terminal_bytes','guard_sha256','guard_bytes'))
TERMINAL_KEYS = frozenset(('kind','job_id','job_sha256','guard_report_sha256','guard_report_bytes','result'))


def require(value, message):
    if not value: raise ValueError(message)


def keys(value, wanted):
    require(type(value) is dict and value.keys() == wanted, 'exact evidence keys required')


def canonical(value):
    return json.dumps(value,sort_keys=True,ensure_ascii=False,allow_nan=False,separators=(',',':')).encode('utf-8','strict')


def digest(raw): return hashlib.sha256(raw).hexdigest()


def _sha(value):
    require(type(value) is str and re.fullmatch('[0-9a-f]{64}',value), 'formal SHA256 required')


def _text(value, limit=512):
    require(type(value) is str and 0<len(value.encode('utf-8','strict'))<=limit
        and not any(ord(c)<32 or ord(c)==127 for c in value), 'bounded control-free text required')


def _ids(values, check):
    require(type(values) in (list,tuple) and 0<len(values)<=MAX_IDS,'finite IDs required')
    for value in values: check();_text(value)
    require(len(set(values))==len(values),'duplicate IDs')


def strict_json(raw, check):
    check(); require(type(raw) is bytes and 0<len(raw)<=MAX_BYTES,'bounded evidence bytes required')
    def pairs(items):
        result={}
        for key,value in items:
            check();require(key not in result,'duplicate JSON key');result[key]=value
        return result
    def constant(_): raise ValueError('nonfinite JSON constant')
    def number(value):
        parsed=float(value);require(math.isfinite(parsed),'nonfinite JSON number');return parsed
    value=json.loads(raw.decode('utf-8','strict'),object_pairs_hook=pairs,parse_constant=constant,parse_float=number)
    check();return value


def admit_context(context, check):
    check();keys(context,CONTEXT_KEYS)
    for name in ('job_id','suite_id','suite_tree_tag'): _text(context[name])
    require(re.fullmatch('[A-Za-z0-9_-]{1,100}',context['job_id']),'job ID differs')
    for name in ('job_sha256','source_trees_sha256','implementation_sha256','policy_envelope_sha256','contract_sha256'): _sha(context[name])
    require(context['policy_envelope_sha256']==POLICY_SHA and context['contract_sha256']==CONTRACT_SHA,'independent policy lineage differs')
    ids=context['expected_ids'];_ids(ids,check)
    require(all(i.startswith(context['suite_id']+'::') for i in ids),'cross-suite IDs')
    routes=context['allowed_routes'];require(type(routes) is dict and set(routes)==set(ids),'exact per-test route inventory required')
    for identifier,allowed in routes.items():
        check();require(type(allowed) is dict and len(allowed)<=128,'finite route inventory')
        for route,cap in allowed.items():
            check();_text(route,256);require(type(cap) is int and 1<=cap<=4096,'formal finite route cap')
    check();return context


def expected_context(job, job_sha256, admitted_routes, admitted_historical_route, check, *, partition_module=None):
    """Derive permissions ONLY from caller's already admitted policy declarations."""
    check();_sha(job_sha256)
    require(job['kind']=='portable-worker-job-v2','fixed job-v2 required')
    if job['suite']['kind']=='historical_boundary':
        require(partition_module is not None,'source-admitted fixed partition module required')
        partition_module.source_bindings(job,check)
        ids=partition_module.execution_ids(job,check)
    elif partition_module is not None:
        ids=partition_module.execution_ids(job,check)
        require(ids==job['suite']['expected_ids'],'ordinary coverage cannot shrink')
    else:
        require(job['partition'] is None,'ordinary suites cannot be partitioned')
        ids=job['suite']['expected_ids']
    _ids(ids,check);suite=job['suite']['relative']
    routes=list(admitted_routes)
    require(len(routes)<=128,'finite admitted policy routes')
    if admitted_historical_route is not None:
        require(job['suite']['kind']=='stored_adapter','historical permission only for stored suite')
        routes.append(admitted_historical_route['declaration'])
    seen=set();allowed={i:{} for i in ids}
    for route in routes:
        check();rid=route['id'];_text(rid,256)
        require(rid not in seen,'duplicate admitted route ID');seen.add(rid)
        cap=route['max_calls_per_test'];require(type(cap) is int and 1<=cap<=4096,'formal finite route cap')
        for identifier in ids:
            check()
            if 'allowed_original_test_ids' in route:
                applies=identifier in route['allowed_original_test_ids']
            elif 'caller' in route:
                applies=route['caller']==identifier
            else:
                applies=route['source']==suite
            if applies:allowed[identifier][rid]=cap
    if job['suite']['kind']=='historical_boundary':
        require(all(not allowed[identifier] for identifier in ids),'historical boundary has no child permissions')
    check();source_digest=digest(canonical(job['guard']['source_trees']));check()
    implementation_digest=digest(canonical(job['implementation']));check()
    context={'job_id':job['job_id'],'job_sha256':job_sha256,'suite_id':suite,
      'suite_tree_tag':job['suite']['tree_tag'],'expected_ids':list(ids),
      'source_trees_sha256':source_digest,'implementation_sha256':implementation_digest,
      'policy_envelope_sha256':POLICY_SHA,'contract_sha256':CONTRACT_SHA,'allowed_routes':allowed}
    return admit_context(context,check)


def envelope(context, snapshot, *, status):
    require(status in ('complete','diagnostic'),'known guard evidence status')
    value={name:context[name] for name in ENVELOPE_KEYS-{'kind','status','report'}}
    value.update(kind='portable-worker-guard-evidence-v1',status=status,report=snapshot)
    return value


def validate_guard(value, context, check):
    admit_context(context,check);keys(value,ENVELOPE_KEYS)
    require(value['kind']=='portable-worker-guard-evidence-v1' and value['status']=='complete','complete guard envelope required')
    for name in ENVELOPE_KEYS-{'kind','status','report'}:
        check();require(type(value[name]) is str and value[name]==context[name],'guard context binding differs')
    report=value['report'];keys(report,REPORT_KEYS)
    require(report['kind']=='finite-offline-worker-guard-report-v1' and report['suite_id']==context['suite_id']
        and report['contract_sha256']==context['contract_sha256'],'guard report lineage/suite differs')
    require(report['installed'] is True and report['active_test'] is None and report['pending_node_permit'] is False
        and report['universal_descendant_containment'] is False,'installed idle finite guard required')
    require(type(report['denial_count']) is int and report['denial_count']==0 and type(report['denials']) is list
        and not report['denials'],'guard denials retained')
    require(type(report['owned_directories']) is int and 0<=report['owned_directories']<=8192,'owned directory bound')
    require(type(report['test_ids']) is list and report['test_ids']==sorted(context['expected_ids']),'exact sorted original guard IDs required')
    launches=report['launches'];require(type(launches) is list,'launch array required')
    cap=0
    for routes in context['allowed_routes'].values():
        check();cap+=sum(routes.values())
    require(len(launches)<=cap,'launch total exceeds independently admitted caps')
    counts={}
    for launch in launches:
        check();keys(launch,{'test_id','route','ordinal'})
        identifier,route,ordinal=launch['test_id'],launch['route'],launch['ordinal']
        _text(identifier);_text(route,256)
        require(identifier in context['allowed_routes'] and route in context['allowed_routes'][identifier],'unadmitted test/route launch')
        key=(identifier,route);wanted=counts.get(key,0)+1
        require(type(ordinal) is int and ordinal==wanted and ordinal<=context['allowed_routes'][identifier][route],'route ordinal/cap differs')
        counts[key]=ordinal
    check();return report


def validate_pair(terminal_raw, guard_raw, context, *, process_returncode, validate_terminal, check):
    require(callable(check) and callable(validate_terminal),'admitted validator and original deadline required')
    check();require(type(process_returncode) is int and process_returncode==0,'actual formal exit zero required')
    admit_context(context,check)
    terminal=strict_json(terminal_raw,check);guard=strict_json(guard_raw,check)
    keys(terminal,TERMINAL_KEYS)
    require(terminal['kind']=='portable-worker-terminal-v2','strict paired terminal kind')
    for name in ('job_id','job_sha256'):
        require(type(terminal[name]) is str and terminal[name]==context[name],'terminal job binding differs')
    require(type(terminal['guard_report_bytes']) is int and terminal['guard_report_bytes']==len(guard_raw),'exact raw guard byte count')
    _sha(terminal['guard_report_sha256']);require(terminal['guard_report_sha256']==digest(guard_raw),'exact raw guard hash')
    report=validate_guard(guard,context,check)
    check();raw_result=canonical(terminal['result']);check()
    result=validate_terminal(raw_result,context['expected_ids'],process_returncode=process_returncode)
    check()
    pair={'kind':'portable-worker-validated-pair-v1','result':result,'guard':report,
          'terminal_sha256':digest(terminal_raw),'terminal_bytes':len(terminal_raw),
          'guard_sha256':digest(guard_raw),'guard_bytes':len(guard_raw)}
    keys(pair,PAIR_KEYS);check();return pair
