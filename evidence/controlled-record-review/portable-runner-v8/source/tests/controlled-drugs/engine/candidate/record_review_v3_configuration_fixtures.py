"""Private fixed SQL test-stage generator; no connections, installs, or runtime.

All semantic expectations originate in the separately pinned literal corpus.
This generator does not execute/import the configuration validator.
"""
from pathlib import Path
import ast
import hashlib
import importlib
import json
import re
import sys

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
CANDIDATE = HERE
CORPUS = HERE / 'record-review-v3-configuration-vectors.json'
PINS = {
    CORPUS: '07834599621ce51d5b7e1ef1cc92282848fe4d477250671e1bbc250daa5eac05',
    HERE/'record-review-v3-configuration-input.sql': '1379cf1d81e90d6f4152e9339c3035945ed9856e24cfaecbcf23110f579d4ffa',
    HERE/'record-review-v3-configuration-metadata.json': '17b092581f89ae7d65c99aafbc3616e52f0f6796bc335de23018452c066a6da0',
}
PUBLIC = (
 'prepare_controlled_record_review_v3','read_controlled_record_review_v3',
 'execute_controlled_record_review_v3','cancel_controlled_record_review_v3',
 'get_controlled_record_review_event_v3','list_controlled_record_reviews_v3',
 'publish_controlled_review_configuration_v3','read_controlled_review_publication_v3',
 'get_controlled_review_configuration_v3','record_controlled_review_escalation_action_v3',
 'get_controlled_review_backlog_v3',
)
PRIVATE = ('publish_administration','materialize_one','record_scan')
STUBS = tuple('public.'+x for x in PUBLIC)+tuple('controlled_review_v3.'+x for x in PRIVATE)
STUB_MESSAGE = 'Record-review v3 Gate B private A1; protocol is not implemented'
GUARD_MESSAGE = 'Record-review v3 structural Gate B private A1; operational writes are not implemented'
ROLES = ('anon','authenticated','service_role')
GUC_KEYS = ('TimeZone','search_path','session_replication_role','transaction_isolation','role',
            'request.jwt.claims','request.jwt.claim.sub','request.jwt.claim.role')
PHASES = ('decode_cases','capture_baseline') + tuple('positive_%03d'%x for x in range(0,70,25)) + tuple('negative_%03d'%x for x in range(0,417,25)) + ('null_wire_session_controls','stubs_guard_acl','final_inventory')
WIRE_IDS = ('normalized_exponent_one','visible_fractional_scale','duplicate_key_loss','nul_escape','unpaired_surrogate','transport_whitespace_bytes')
CONTROL_IDS = ('sql_null_argument',)+WIRE_IDS+('alternate_session_restored',)
ACL_FUNCTIONS = ('controlled_review_v3.validate_configuration',)+STUBS
BOUNDARY_IDS = tuple('stub:'+f for f in STUBS)+('guard:operation_claims',)+tuple('acl:'+role+':'+f for role in ROLES for f in ACL_FUNCTIONS)+('catalog_acl',)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def quote(value):
    return "'"+value.replace("'","''")+"'"


def encoded(text):
    return "convert_from(decode("+quote(text.encode('utf-8').hex())+",'hex'),'UTF8')"


def lexical_nodes(text):
    """Exact source slices by JSON path; never roundtrip request numeric tokens."""
    decoder = json.JSONDecoder()
    nodes = {}
    def ws(i):
        while i < len(text) and text[i] in ' \r\n\t': i += 1
        return i
    def node(i,path):
        i=ws(i); start=i
        if text[i]=='{':
            i=ws(i+1); seen=set()
            if text[i]!='}':
                while True:
                    key,end=decoder.raw_decode(text,i)
                    assert isinstance(key,str) and key not in seen, 'duplicate/object key'
                    seen.add(key); i=ws(end); assert text[i]==':'
                    i=node(i+1,path+(key,)); i=ws(i)
                    if text[i]=='}': break
                    assert text[i]==','; i=ws(i+1)
            i+=1
        elif text[i]=='[':
            i=ws(i+1); index=0
            if text[i]!=']':
                while True:
                    i=node(i,path+(index,));index+=1;i=ws(i)
                    if text[i]==']':break
                    assert text[i]==',';i=ws(i+1)
            i+=1
        else:
            _,i=decoder.raw_decode(text,i)
        nodes[path]=text[start:i]
        return i
    end=node(0,());assert ws(end)==len(text)
    return nodes


def admitted_corpus(raw):
    assert sha(raw)==PINS[CORPUS], 'Corpus bytes changed'
    text=raw.decode('utf-8');nodes=lexical_nodes(text);doc=json.loads(text)
    assert doc['positive_count']==len(doc['positives'])==70
    assert doc['negative_count']==len(doc['negatives'])==417
    assert tuple(x['id'] for x in doc['wire_loss_vectors'])==WIRE_IDS
    cases=[];seen=set()
    for group,label in [('positives','positive'),('negatives','negative')]:
        for ordinal,case in enumerate(doc[group]):
            case_id=case['id'];assert re.fullmatch('[A-Za-z0-9_:]+',case_id) and case_id not in seen
            seen.add(case_id)
            expected=({'outcome':'return_unchanged','comparison':'jsonb_value_exact','publication_acceptance':False} if label=='positive' else {'outcome':'refuse','sqlstate':'23514','primary_message':'configuration_invalid'})
            assert case['expected']==expected, case_id
            lex=nodes[(group,ordinal,'input')]
            assert json.loads(lex)==case['input']
            cases.append(dict(id=case_id,group=label,ordinal=ordinal,lexical_input=lex,input_sha256=sha(lex.encode()),expected=expected))
    by_id={x['id']:x for x in cases}
    for case_id,key,token in [('schema_version_wrong_28','schema_version','1.0'),('version_wrong_35','version','1.0'),('version_wrong_36','version','1.5')]:
        assert lexical_nodes(by_id[case_id]['lexical_input'])[(key,)]==token
    assert by_id['root_type_18']['lexical_input']=='null'
    return cases,doc


def refusal(statement, code='23514', message='configuration_invalid', condition='check_violation'):
    # Only the subject statement is protected. Decoding/proof/observer calls are outside.
    return f"""refused := false;
 begin
  {statement}
 exception when {condition} then
  get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
  if actual_code <> {quote(code)} or actual_message <> {quote(message)} then
   raise exception 'configuration_test_wrong_refusal: % %', actual_code, actual_message;
  end if;
  refused := true;
 end;
 if not refused then raise exception 'configuration_test_expected_refusal'; end if;
"""


def block(body):
    return "do $configuration_test$\ndeclare refused boolean; actual_code text; actual_message text; returned jsonb; case_input jsonb; item record;\nbegin\n"+body+"\nend\n$configuration_test$;\n"


def proof(label,outcome,detail="'{}'::jsonb"):
    return 'insert into pg_temp.configuration_proof values ('+quote(label)+','+quote(outcome)+','+detail+');\n'


def conservation():
    return 'select pg_temp.configuration_conserved();\n'


def snapshot_source():
    sys.path.insert(0,str(CANDIDATE))
    capture=importlib.import_module('record_review_v3_gate_a_snapshot')
    declaration=importlib.import_module('record_review_v3_gate_b_descriptor')
    assert tuple(declaration.FACADES)==PUBLIC and tuple(declaration.PRIVATE_STUBS)==PRIVATE
    assert 'operational writes are not implemented' in (CANDIDATE/'record-review-v3-schema.sql').read_text()
    imports={}; pending=['record_review_v3_gate_a_snapshot','record_review_v3_gate_b_descriptor']
    while pending:
        module_name=pending.pop();p=CANDIDATE/(module_name+'.py')
        key=str(p.relative_to(REPO))
        if not p.is_file() or key in imports:continue
        imports[key]=sha(p.read_bytes())
        for node in ast.walk(ast.parse(p.read_text())):
            if isinstance(node,ast.Import):pending.extend(x.name.split('.')[0] for x in node.names)
            elif isinstance(node,ast.ImportFrom) and node.module:pending.append(node.module.split('.')[0])
    # No source reader/build is called; imported modules declare the observer SQL.
    return capture.SETUP,capture.VALUE,imports


def compile_stages():
    for p,pin in PINS.items(): assert sha(p.read_bytes())==pin, 'Reviewed input changed: '+p.name
    cases,doc=admitted_corpus(CORPUS.read_bytes()); setup,value,inputs=snapshot_source()
    stages={}
    load="""-- Run only with ON_ERROR_STOP, one reviewed owned backend and independent metadata admission.
create temp table configuration_cases(id text primary key, class text not null, ordinal integer not null, lexical_text text not null, input jsonb, unique(class,ordinal));
create temp table configuration_proof(id text primary key, outcome text not null, detail jsonb not null);
"""
    for x in cases:
        expr=encoded(x['lexical_input'])
        load+='insert into pg_temp.configuration_cases values ('+quote(x['id'])+','+quote(x['group'])+','+str(x['ordinal'])+','+expr+','+expr+'::jsonb);\n'
    load+=block("""if (select count(*) from pg_temp.configuration_cases)<>487 then raise exception 'configuration_case_admission';end if;
 if not exists(select 1 from pg_temp.configuration_cases where id='root_type_18' and input is not null and jsonb_typeof(input)='null') then raise exception 'configuration_json_null_lost';end if;
"""+''.join("if not exists(select 1 from pg_temp.configuration_cases where id="+quote(cid)+" and jsonb_typeof(input->"+quote(key)+")='number' and (input->"+quote(key)+")::text="+quote(token)+") then raise exception 'configuration_fractional_token_lost';end if;\n" for cid,key,token in [('schema_version_wrong_28','schema_version','1.0'),('version_wrong_35','version','1.0'),('version_wrong_36','version','1.5')]))
    stages['decode_cases']=load
    session="jsonb_build_object('settings',(select jsonb_object_agg(k,current_setting(k,true))from unnest(array["+','.join(map(quote,GUC_KEYS))+ "])as keys(k)),'current_user',current_user,'session_user',session_user,'advisory',(select coalesce(jsonb_agg(to_jsonb(l)-'pid' order by l.classid,l.objid,l.objsubid,l.mode),'[]')from pg_locks l where l.pid=pg_backend_pid() and l.locktype='advisory'))"
    stages['capture_baseline']=setup+f"""
select controlled_review_v3.required();
create function pg_temp.configuration_session() returns jsonb language sql as $session$ select {session} $session$;
create temp table configuration_baseline(value jsonb not null, session_value jsonb not null);
insert into pg_temp.configuration_baseline select {value},pg_temp.configuration_session();
create function pg_temp.configuration_conserved() returns void language plpgsql as $conserved$
begin
 perform controlled_review_v3.required();
 if (select count(*) from pg_temp.configuration_baseline)<>1 or not exists(select 1 from pg_temp.configuration_baseline b where b.value=({value}) and b.session_value=pg_temp.configuration_session()) then
 raise exception 'configuration_permanent_or_session_state_changed';end if;
end $conserved$;
"""
    for group,count in [('positive',70),('negative',417)]:
        for start in range(0,count,25):
            body=''
            for x in [x for x in cases if x['group']==group and start<=x['ordinal']<start+25]:
                body+='select input into strict case_input from pg_temp.configuration_cases where id='+quote(x['id'])+';\n'
                if group=='positive':
                    body+='returned := controlled_review_v3.validate_configuration(case_input);\nif case_input is null or returned is null or returned is distinct from case_input then raise exception \'configuration_positive_changed\';end if;\n'
                    outcome='unchanged'
                else:
                    body+=refusal('perform controlled_review_v3.validate_configuration(case_input);');outcome='23514_configuration_invalid'
                body+=proof(x['id'],outcome)
            stages[group+'_%03d'%start]=block(body)+conservation()
    base=next(x['lexical_input'] for x in cases if x['id']=='administration_enabled')
    base_nodes=lexical_nodes(base);assert base_nodes[('schema_version',)]=='1'
    # Exactly one field replacement on this pinned finite lexical document, not arbitrary rewriting.
    exponent,n=re.subn(r'("schema_version"\s*:\s*)1(?=\s*[,}])',r'\g<1>1e0',base);assert n==1
    body=refusal('perform controlled_review_v3.validate_configuration(NULL::jsonb);')+proof('sql_null_argument','23514_configuration_invalid')
    body+='case_input := '+encoded(exponent)+'::jsonb;\nif (case_input->\'schema_version\')::text<>\'1\' then raise exception \'configuration_exponent_observation\';end if;\nreturned := controlled_review_v3.validate_configuration(case_input);\nif returned is null or returned is distinct from case_input then raise exception \'configuration_wire_changed\';end if;\n'+proof('normalized_exponent_one','decoded_unchanged')
    body+="if not exists(select 1 from pg_temp.configuration_proof where id='schema_version_wrong_28' and outcome='23514_configuration_invalid') then raise exception 'configuration_scale_case_missing';end if;\n"+proof('visible_fractional_scale','corpus_case_reference')
    body+="if "+encoded('{"enabled":false,"enabled":true}')+"::jsonb is distinct from '{\"enabled\":true}'::jsonb then raise exception 'configuration_duplicate_observation';end if;\n"+proof('duplicate_key_loss','jsonb_loss_observed_upstream_not_tested')
    for label,lex in [('nul_escape','"\\u0000"'),('unpaired_surrogate','"\\ud800"')]:
        body+="actual_code := null; actual_message := null; returned := null;\nbegin\n returned := "+encoded(lex)+"::jsonb;\nexception when untranslatable_character or invalid_text_representation then\n get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;\nend;\n"+proof(label,'decoder_observation_only',"jsonb_build_object('sqlstate',actual_code,'message',actual_message,'decoded',returned,'target_called',false)")
    whitespace=' '*131073+base
    body+='case_input := '+encoded(whitespace)+'::jsonb;\nreturned := controlled_review_v3.validate_configuration(case_input);\nif returned is null or returned is distinct from case_input then raise exception \'configuration_whitespace_decoded_changed\';end if;\n'+proof('transport_whitespace_bytes','decoded_unchanged_http_not_tested')
    controls=block(body)+conservation()
    controls+="begin;\nset local timezone='Pacific/Honolulu';\nset local search_path=pg_catalog;\ncreate temp table configuration_alternate_session as select pg_temp.configuration_session() value;\n"
    controls+=block("select input into strict case_input from pg_temp.configuration_cases where id='administration_enabled';\nreturned := controlled_review_v3.validate_configuration(case_input);\nif returned is null or returned is distinct from case_input then raise exception 'configuration_alternate_positive';end if;\n"+refusal('perform controlled_review_v3.validate_configuration(NULL::jsonb);')+"if (select value from pg_temp.configuration_alternate_session) is distinct from pg_temp.configuration_session() then raise exception 'configuration_alternate_session_changed';end if;\n")
    controls+='rollback;\n'+proof('alternate_session_restored','rollback_context_restored')+conservation()
    stages['null_wire_session_controls']=controls
    boundary='select controlled_review_v3.required();\n'
    body=''
    for fn in STUBS:
        body+=refusal('perform '+fn+"('{}'::jsonb);",'0A000',STUB_MESSAGE,'feature_not_supported')+proof('stub:'+fn,'0A000_stub')
    guard="insert into controlled_review_v3.operation_claims(operation_id,actor_id,claimed_at)values('d4444444-4444-4444-8444-444444444444','c3333333-3333-4333-8333-333333333333','2026-01-01T00:00:00Z'::timestamptz);"
    body+=refusal(guard,'0A000',GUARD_MESSAGE,'feature_not_supported')+proof('guard:operation_claims','0A000_guard')
    boundary+=block(body)
    # Catalog assertions are independent of schema denial. All helper/facade ACLs have exactly postgres EXECUTE.
    signatures=','.join(quote(fn+'(jsonb)') for fn in ACL_FUNCTIONS)
    boundary+=block(f"""for item in select p.oid,p.proowner,p.proacl from pg_proc p where p.oid in(select s::regprocedure from unnest(array[{signatures}])x(s)) loop
 if item.proowner<>'postgres'::regrole or (select count(*)from aclexplode(coalesce(item.proacl,acldefault('f',item.proowner))))<>1 or not exists(select 1 from aclexplode(coalesce(item.proacl,acldefault('f',item.proowner)))a where a.grantee='postgres'::regrole and a.grantor='postgres'::regrole and a.privilege_type='EXECUTE' and not a.is_grantable) then raise exception 'configuration_function_acl';end if;
end loop;
if (select count(*)from pg_proc p where p.oid in(select s::regprocedure from unnest(array[{signatures}])x(s)))<>15 then raise exception 'configuration_function_inventory';end if;
if exists(select 1 from pg_namespace n cross join lateral aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner)))a where n.nspname='controlled_review_v3' and(a.grantee<>'postgres'::regrole or a.grantor<>'postgres'::regrole or a.is_grantable)) then raise exception 'configuration_schema_acl';end if;
"""+''.join("if has_schema_privilege("+quote(role)+",'controlled_review_v3','USAGE') or exists(select 1 from unnest(array["+signatures+"])x(s) where has_function_privilege("+quote(role)+",s,'EXECUTE')) then raise exception 'configuration_role_privilege';end if;\n" for role in ROLES)+proof('catalog_acl','private_owner_only'))
    for role in ROLES:
        boundary+='begin;\nset local role '+role+';\n'
        for fn in ACL_FUNCTIONS:
            message='permission denied for schema controlled_review_v3' if fn.startswith('controlled_review_v3.') else 'permission denied for function '+fn.split('.')[1]
            boundary+=block(refusal('perform '+fn+"('{}'::jsonb);",'42501',message,'insufficient_privilege'))
        boundary+='rollback;\n'
        for fn in ACL_FUNCTIONS:boundary+=proof('acl:'+role+':'+fn,'42501_privilege_boundary')
    stages['stubs_guard_acl']=boundary+conservation()
    all_expected=[(x['id'],'unchanged' if x['group']=='positive' else '23514_configuration_invalid') for x in cases]
    all_expected += [('sql_null_argument','23514_configuration_invalid'),('normalized_exponent_one','decoded_unchanged'),('visible_fractional_scale','corpus_case_reference'),('duplicate_key_loss','jsonb_loss_observed_upstream_not_tested'),('nul_escape','decoder_observation_only'),('unpaired_surrogate','decoder_observation_only'),('transport_whitespace_bytes','decoded_unchanged_http_not_tested'),('alternate_session_restored','rollback_context_restored')]
    all_expected += [('stub:'+f,'0A000_stub')for f in STUBS]+[('guard:operation_claims','0A000_guard')]+[('acl:'+r+':'+f,'42501_privilege_boundary')for r in ROLES for f in ACL_FUNCTIONS]+[('catalog_acl','private_owner_only')]
    expected_json=json.dumps(dict(all_expected),sort_keys=True,separators=(',',':'))
    stages['final_inventory']=conservation()+block("if (select jsonb_object_agg(id,outcome)from pg_temp.configuration_proof) is distinct from "+encoded(expected_json)+"::jsonb then raise exception 'configuration_complete_receipt_mismatch';end if;\n")+"select jsonb_build_object('kind','private-configuration-input-observations-v1','acceptance',false,'publication',false,'auth_acceptance',false,'clinical_activation',false,'proof',(select jsonb_object_agg(id,jsonb_build_object('outcome',outcome,'detail',detail))from pg_temp.configuration_proof));\n"
    assert tuple(stages)==PHASES and len(stages)==25
    inputs.update({str(p.relative_to(REPO)):sha(p.read_bytes()) for p in PINS})
    inputs[str((CANDIDATE/'record-review-v3-schema.sql').relative_to(REPO))]=sha((CANDIDATE/'record-review-v3-schema.sql').read_bytes())
    inputs[str(Path(__file__).relative_to(REPO))]=sha(Path(__file__).read_bytes())
    return stages,dict(kind='private-configuration-input-fixed-sql-draft-v1',runtime_executed=False,source_integration=True,metadata_stage_required='private_configuration_input_v1',independent_metadata_reference_pending=True,phase_names=list(PHASES),phase_seconds=120,whole_seconds=600,emergency_cleanup_seconds=180,case_inventory=[{k:v for k,v in x.items()if k!='lexical_input'} for x in cases],control_ids=list(CONTROL_IDS),boundary_ids=list(BOUNDARY_IDS),complete_expected_outcomes=dict(all_expected),wire_decoder_observations_not_acceptance=True,source_hashes=inputs,stages={n:sha(s.encode())for n,s in stages.items()})


def write(output):
    stages,inventory=compile_stages()
    output.mkdir(mode=0o700) # Fresh destination only; preserve previous receipts.
    for index,(name,sql)in enumerate(stages.items()):
        path=output/f'{index:02d}-{name}.sql';path.write_text(sql);path.chmod(0o600)
    path=output/'inventory.json';path.write_text(json.dumps(inventory,indent=2,sort_keys=True)+'\n');path.chmod(0o600)
    return inventory


if __name__=='__main__':
    assert len(sys.argv)==1,'No public arbitrary commands or output options'
    stages,inventory=compile_stages()
    print(json.dumps(dict(kind=inventory['kind'],source_integration=True,runtime_executed=False,
        phases=len(stages),expected_ids=len(inventory['complete_expected_outcomes']),
        source_inputs=len(inventory['source_hashes']),database_operations=0),sort_keys=True))
