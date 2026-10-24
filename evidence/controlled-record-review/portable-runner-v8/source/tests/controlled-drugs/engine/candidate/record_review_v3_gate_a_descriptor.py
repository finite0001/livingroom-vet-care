"""Finite independent metadata derivation for the private v3 STRUCTURAL shell.

No database connection, live capture, final protocol or acceptance artifact write.
The declarations below, not observed metadata, define the candidate expectation.
"""
import hashlib
import json
import re
from pathlib import Path

SOURCE = Path(__file__).resolve().parent
SCHEMA = 'controlled_review_v3'
KIND = 'controlled-review-v3-structural-gate-a-v1'
PARENT_FILE = 'release-expected-204.json'
PARENT_SHA = '4755a1f1c53008003a11e94ada3963ae416f6c81f163ec43ed2ffea21d6d2f78'
PRIVATE_FILE = 'secondary_review_protocol_private_expected_v2.json'
PRIVATE_SHA = 'adf45e10d25935486aadbc126c6b8282d38def119dc344bfe4935bb690d4b036'
FACADES = (
 'prepare_controlled_record_review_v3','read_controlled_record_review_v3',
 'execute_controlled_record_review_v3','cancel_controlled_record_review_v3',
 'get_controlled_record_review_event_v3','list_controlled_record_reviews_v3',
 'publish_controlled_review_configuration_v3','read_controlled_review_publication_v3',
 'get_controlled_review_configuration_v3','record_controlled_review_escalation_action_v3',
 'get_controlled_review_backlog_v3',
)
PRIVATE_STUBS = ('publish_administration','materialize_one','record_scan')
BODY_NAMES = {'immutable_guard','refuse_insert','terminal_check','required','snapshot'}
CONFIG = ['search_path=pg_catalog, public, pg_temp','TimeZone=UTC']
MARKERS = {key:'-- RECORD_REVIEW_V3_GATE_A_' + key.upper() + ' --' for key in
           ('admission','after_schema','after_tables','after_functions','after_triggers','after_descriptor','before_postcheck','before_commit')}
TS = 'timestamp with time zone'


def sha(value):
    return hashlib.sha256(value).hexdigest()


def canonical(value):
    return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False)


def unique(pairs):
    result = {}
    for key,value in pairs:
        assert key not in result, 'Duplicate JSON key'
        result[key] = value
    return result


def cols(*items):
    return [(n,t,not n.endswith('?')) for n,t in items]


def table(columns, primary, unique_keys=(), indexes=(), fks=(), checks=()):
    # A ? suffix is declaration syntax only; SQL names never contain it.
    return dict(columns=[(n.rstrip('?'),t,nn) for n,t,nn in columns],primary=primary,
                unique=list(unique_keys),indexes=list(indexes),fks=list(fks),checks=list(checks))


def fk(name,column,parent,remote='id',deferred=False):
    return (name,column,parent,remote,deferred)


TABLES = {
 'descriptor':table(cols(('id','boolean'),('definition','jsonb')),['id'],checks=[('singleton','id')]),
 'publications':table(cols(('operation_id','uuid'),('actor_id?','uuid'),('request','jsonb'),('request_hash','text'),('record_id','uuid'),('receipt','jsonb'),('recorded_at',TS),('mode','text')),['operation_id'],
   unique_keys=[('record_key',['record_id'])],fks=[fk('record_fk','record_id',SCHEMA+'.configuration',deferred=True)]),
 'configuration':table(cols(('id','uuid'),('kind','text'),('stream_key','jsonb'),('version','integer'),('predecessor_id?','uuid'),('predecessor_hash?','text'),('enabled','boolean'),('document','jsonb'),('record_hash','text'),('publication_operation_id','uuid'),('published_at',TS),('publisher_actor_id?','uuid'),('publisher_session_id?','uuid'),('publisher_name','text'),('authorization_id?','uuid'),('publication_mode','text'),('effective_from?',TS)),['id'],
   unique_keys=[('stream_version_key',['stream_key','version']),('publication_key',['publication_operation_id']),('predecessor_key',['predecessor_id'])],
   indexes=[('published_idx','stream_key, published_at DESC',None),('effective_idx','stream_key, effective_from DESC',None)],
   fks=[fk('predecessor_fk','predecessor_id',SCHEMA+'.configuration'),fk('publication_fk','publication_operation_id',SCHEMA+'.publications','operation_id',True)],checks=[('positive_version','version > 0')]),
 'families':table(cols(('dispense_id','uuid'),('target','jsonb'),('target_hash','text'),('product_id','uuid'),('site_id?','uuid'),('selection','jsonb'),('binding_hash','text'),('materialized_at',TS)),['dispense_id'],indexes=[('product_idx','product_id, dispense_id',None)]),
 'obligations':table(cols(('event_id','uuid'),('product_id','uuid'),('event_sequence','bigint'),('meaning','text'),('target','jsonb'),('target_hash','text'),('adapter','jsonb'),('historical','jsonb'),('binding_hash','text'),('site_id?','uuid'),('due_at?',TS),('family_dispense_id?','uuid'),('materialized_at',TS)),['event_id'],
   unique_keys=[('meaning_key',['event_id','meaning']),('sequence_key',['product_id','event_sequence'])],
   indexes=[('scope_idx','product_id, site_id, event_sequence',None),('due_idx','product_id, due_at, event_sequence','due_at IS NOT NULL')],
   fks=[fk('event_fk','event_id','public.controlled_stock_events'),fk('family_fk','family_dispense_id',SCHEMA+'.families','dispense_id')],
   checks=[('positive_sequence','event_sequence > 0'),('meaning',"meaning = 'independent_record_review_v1'::text")]),
 'operation_claims':table(cols(('operation_id','uuid'),('actor_id','uuid'),('claimed_at',TS)),['operation_id'],indexes=[('actor_idx','actor_id, claimed_at, operation_id',None)]),
 'preparations':table(cols(('operation_id','uuid'),('event_id','uuid'),('actor_id','uuid'),('session_id','uuid'),('request','jsonb'),('request_hash','text'),('transport_digest','text'),('target_hash','text'),('packet','jsonb'),('packet_hash','text'),('policy_id','uuid'),('read_eligibility_id','uuid'),('review_eligibility_id','uuid'),('decision','text'),('reason','text'),('prepared_boot',TS),('prepared_xid','xid8'),('created_at',TS),('expires_at',TS)),['operation_id'],
   indexes=[('actor_idx','actor_id, created_at, operation_id',None),('event_idx','event_id, operation_id',None)],
   fks=[fk('claim_fk','operation_id',SCHEMA+'.operation_claims','operation_id'),fk('event_fk','event_id',SCHEMA+'.obligations','event_id'),fk('policy_fk','policy_id',SCHEMA+'.configuration'),fk('read_eligibility_fk','read_eligibility_id',SCHEMA+'.configuration'),fk('review_eligibility_fk','review_eligibility_id',SCHEMA+'.configuration')]),
 'decisions':table(cols(('operation_id','uuid'),('event_id','uuid'),('actor_id','uuid'),('session_id','uuid'),('actor_name','text'),('decision','text'),('reason','text'),('request_hash','text'),('transport_digest','text'),('packet_hash','text'),('target_hash','text'),('recorded_at',TS),('receipt','jsonb')),['operation_id'],
   unique_keys=[('event_key',['event_id'])],indexes=[('actor_idx','actor_id, recorded_at, operation_id',None)],
   fks=[fk('preparation_fk','operation_id',SCHEMA+'.preparations','operation_id'),fk('event_fk','event_id',SCHEMA+'.obligations','event_id')]),
 'cancellations':table(cols(('operation_id','uuid'),('actor_id','uuid'),('session_id','uuid'),('kind','text'),('transport_digest?','text'),('recorded_at',TS)),['operation_id'],fks=[fk('claim_fk','operation_id',SCHEMA+'.operation_claims','operation_id')]),
 'escalations':table(cols(('id','uuid'),('event_id','uuid'),('reason','text'),('routing_snapshot','jsonb'),('first_detected_at',TS),('evidence','jsonb'),('record_hash','text')),['id'],
   unique_keys=[('event_reason_key',['event_id','reason'])],indexes=[('detected_idx','first_detected_at, id',None)],fks=[fk('event_fk','event_id',SCHEMA+'.obligations','event_id')]),
 'escalation_actions':table(cols(('operation_id','uuid'),('escalation_id','uuid'),('actor_id','uuid'),('session_id','uuid'),('kind','text'),('note','text'),('recorded_at',TS),('request_hash','text'),('receipt','jsonb')),['operation_id'],
   indexes=[('escalation_idx','escalation_id, recorded_at, operation_id',None)],fks=[fk('escalation_fk','escalation_id',SCHEMA+'.escalations')]),
 'materializations':table(cols(('operation_id','uuid'),('product_id','uuid'),('event_id','uuid'),('request_hash','text'),('result','jsonb'),('recorded_at',TS)),['operation_id'],indexes=[('event_idx','product_id, event_id, operation_id',None)]),
 'scan_receipts':table(cols(('operation_id','uuid'),('product_id','uuid'),('from_sequence','bigint'),('through_sequence','bigint'),('high_water','bigint'),('recorded_at',TS),('result','jsonb')),['operation_id'],
   unique_keys=[('range_key',['product_id','from_sequence','through_sequence'])],indexes=[('through_idx','product_id, through_sequence DESC',None)],
   checks=[('range','from_sequence >= 0 AND through_sequence >= from_sequence AND high_water >= through_sequence')]),
}
ENUMS = {
 ('configuration','kind'):('administration','policy','eligibility','calendar','routing'),
 ('configuration','publication_mode'):('staff','owner_bootstrap','owner_recovery'),
 ('publications','mode'):('staff','owner_bootstrap','owner_recovery'),
 ('preparations','decision'):('approve','reject'),('decisions','decision'):('approve','reject'),
 ('cancellations','kind'):('prepared','unprepared'),
 ('escalations','reason'):('rejected','overdue','discrepancy_report','no_eligible_reviewer','routing_unavailable','evidence_unavailable'),
 ('escalation_actions','kind'):('acknowledge','resolution_note'),
}


def acl(privileges):
    return [dict(grantee='postgres',grantor='postgres',privilege=p,grantable=False) for p in sorted(privileges)]


def checks(name,spec):
    answer = [('v3_'+key,expr) for key,expr in spec['checks']]
    for column,kind,_ in spec['columns']:
        if kind=='uuid':
            answer.append(('v3_nonzero_'+column,column+" <> '00000000-0000-0000-0000-000000000000'::uuid"))
        elif kind==TS:
            answer.append(('v3_finite_'+column,'isfinite('+column+')'))
        elif kind=='jsonb':
            expr="jsonb_typeof("+column+") = 'object'::text"
            if column!='definition':
                bound=131072 if column in ('document','request','receipt') else 4096 if column=='stream_key' else 1048576
                expr+=' AND octet_length('+column+'::text) <= '+str(bound)
            answer.append(('v3_json_'+column,expr))
        elif kind=='text':
            if column.endswith('_hash') or column=='transport_digest':
                answer.append(('v3_hash_'+column,column+" ~ '^[0-9a-f]{64}$'::text"))
            else:
                bound=4000 if column in ('reason','note') else 200
                answer.append(('v3_text_'+column,'char_length('+column+') >= 1 AND char_length('+column+') <= '+str(bound)))
        if (name,column) in ENUMS:
            values=', '.join("'"+v+"'::text" for v in ENUMS[name,column])
            answer.append(('v3_enum_'+column,column+' = ANY (ARRAY['+values+'])'))
    return [(key,'CHECK ('+expr+')') for key,expr in answer]


def function_metadata(body,result,language,argument,definer):
    return dict(source=body,owner='postgres',language=language,return_type=result,kind='f',security_definer=definer,
     strict=False,leakproof=False,volatility='v',parallel='u',returns_set=False,cost=100,rows=0,configuration=CONFIG,
     argument_names=[argument.split()[0]] if argument else None,all_argument_types=None,argument_modes=None,
     default_count=0,defaults=None,variadic='-',support='-',sql_body=None,acl=acl(['EXECUTE']))


def read_functions(path):
    text=path.read_text()
    pattern=r'^-- BEGIN FUNCTION ([a-z_][a-z0-9_]*)\|([a-z0-9]+)\|([a-z]+)\n(.*?)^-- END FUNCTION$'
    matches=list(re.finditer(pattern,text,re.M|re.S))
    assert len(matches)==len(BODY_NAMES) and {m[1] for m in matches}==BODY_NAMES, 'Exact Gate A function inventory required'
    residue=re.sub(pattern,'',text,flags=re.M|re.S)
    assert all(not line.strip() or line.startswith('--') for line in residue.splitlines()), 'Unexpected SQL outside reviewed bodies'
    return [(m[1],m[2],m[3],'','\n'+m[4]) for m in matches]


def fk_triggers(name,child,parent,deferred):
    result=[]
    for relation,other,function,bits,is_child in (
      (child,parent,'RI_FKey_check_ins',5,True),(child,parent,'RI_FKey_check_upd',17,True),
      (parent,child,'RI_FKey_restrict_upd',17,False),(parent,child,'RI_FKey_restrict_del',9,False)):
        result.append(dict(constraint=name,relation=relation,function='pg_catalog.'+function,constraint_relation=other,
          type=bits,enabled='O',internal=True,deferrable=deferred and is_child,initially_deferred=deferred and is_child,
          argument_count=0,arguments='',columns='',condition=None,old_table=None,new_table=None))
    return result


def build(source=SOURCE):
    source=Path(source).resolve()
    parent_raw=(source/PARENT_FILE).read_bytes(); private_raw=(source/PRIVATE_FILE).read_bytes()
    assert sha(parent_raw)==PARENT_SHA and sha(private_raw)==PRIVATE_SHA, 'Frozen205/private206 pins required'
    parent=json.loads(parent_raw,object_pairs_hook=unique)['expected_technical_manifest']
    private=json.loads(private_raw,object_pairs_hook=unique)['definition']
    assert private['parent']==dict(revision=1,manifest=parent)
    expected=dict(kind=KIND,parents=dict(parent205=dict(revision=1,manifest=parent),private206=private),
                  schema=dict(owner='postgres',acl=acl(['CREATE','USAGE'])),functions={},relations={},
                  relation_inventory=[],types=[],other_objects=[],facade_objects=[],foreign_key_triggers=[])
    names=','.join("'"+name+"'" for name in FACADES)
    absence=f"""do $v3_absent$ begin
 if exists(select 1 from pg_namespace where nspname='{SCHEMA}')
 or exists(select 1 from pg_proc where pronamespace='public'::regnamespace and proname in({names}))
 or exists(select 1 from pg_class where relnamespace='public'::regnamespace and relname in({names}))
 or exists(select 1 from pg_type where typnamespace='public'::regnamespace and typname in({names})) then
  raise exception 'Record-review v3 Gate A package must be wholly absent' using errcode='23514';end if;
end $v3_absent$;"""
    ddl=[absence,f'create schema {SCHEMA} authorization postgres;',MARKERS['after_schema'],
         f'revoke all on schema {SCHEMA} from public,anon,authenticated,service_role;']
    later_fks=[]
    for name,spec in TABLES.items():
        constraints=checks(name,spec)
        indexes=[]
        keys=[(name+'_pkey',spec['primary'],True)]+[(name+'_'+key,fields,False) for key,fields in spec['unique']]
        for key,fields,primary in keys:
            fields=', '.join(fields)
            constraints.append((key,('PRIMARY KEY' if primary else 'UNIQUE')+' ('+fields+')'))
            definition=f'CREATE UNIQUE INDEX {key} ON {SCHEMA}.{name} USING btree ({fields})'
            indexes.append(dict(definition=definition,valid=True,ready=True,live=True,primary=primary,unique=True,exclusion=False,immediate=True))
            expected['relation_inventory'].append(dict(name=key,kind='i'))
        declarations=[n+' '+t+(' not null' if nn else '') for n,t,nn in spec['columns']]
        declarations += ['constraint '+key+' '+definition for key,definition in constraints]
        ddl += [f'create table {SCHEMA}.{name}('+','.join(declarations)+');',
                f'alter table {SCHEMA}.{name} enable row level security;',
                f'revoke all on {SCHEMA}.{name} from public,anon,authenticated,service_role;']
        for key,fields,predicate in spec['indexes']:
            key=name+'_'+key
            definition=f'CREATE INDEX {key} ON {SCHEMA}.{name} USING btree ({fields})'
            if predicate: definition+=' WHERE ('+predicate+')'
            ddl.append(definition+';')
            indexes.append(dict(definition=definition,valid=True,ready=True,live=True,primary=False,unique=False,exclusion=False,immediate=True))
            expected['relation_inventory'].append(dict(name=key,kind='i'))
        for key,column,parent_relation,remote,deferred in spec['fks']:
            key=name+'_'+key
            tail=' ON UPDATE RESTRICT ON DELETE RESTRICT'+(' DEFERRABLE INITIALLY DEFERRED' if deferred else '')
            definition=f'FOREIGN KEY ({column}) REFERENCES {parent_relation.removeprefix("public.")}({remote})'+tail
            constraints.append((key,definition))
            later_fks.append(f'alter table {SCHEMA}.{name} add constraint {key} FOREIGN KEY ({column}) REFERENCES {parent_relation}({remote})'+tail+';')
            expected['foreign_key_triggers'] += fk_triggers(key,SCHEMA+'.'+name,parent_relation,deferred)
        expected['relations'][name]=dict(kind='r',owner='postgres',persistence='p',rls=True,force_rls=False,replica_identity='d',options=None,
          acl=acl(['DELETE','INSERT','MAINTAIN','REFERENCES','SELECT','TRIGGER','TRUNCATE','UPDATE']),
          columns=[dict(name=n,type=t,not_null=nn,identity='',generated='',default=None,collation='"default"' if t=='text' else '-',column_acl=[]) for n,t,nn in spec['columns']],
          constraints=[dict(name=n,definition=d,validated=True) for n,d in sorted(constraints)],
          indexes=sorted(indexes,key=lambda x:x['definition']),triggers=[],policies=[],rules=[])
        expected['relation_inventory'].append(dict(name=name,kind='r'))
        expected['types'] += [dict(name=name,kind='c',owner='postgres',relation=name,element=None,acl=None),
                              dict(name='_'+name,kind='b',owner='postgres',relation=None,element=name,acl=None)]
    ddl+=later_fks+[MARKERS['after_tables']]
    functions=read_functions(source/'record-review-v3-gate-a.sql')
    stub="\nbegin\n perform controlled_review_v3.required();\n raise exception 'Record-review v3 structural Gate A; protocol is not implemented' using errcode='0A000';\nend\n"
    functions += [(name,'jsonb','plpgsql','p_request jsonb',stub) for name in PRIVATE_STUBS]
    functions += [('public.'+name,'jsonb','plpgsql','p_request jsonb',stub) for name in FACADES]
    for name,result,language,argument,body in functions:
        qualified=name if name.startswith('public.') else SCHEMA+'.'+name
        signature=qualified+'('+argument+')'
        definer=name.startswith('public.') or name=='terminal_check'
        assert result in ('void','trigger','jsonb') and language in ('sql','plpgsql')
        ddl += [f'create function {signature} returns {result}\nlanguage {language} volatile '+('security definer ' if definer else '')+
                "set search_path=pg_catalog,public,pg_temp set timezone='UTC' as $body$"+body+'$body$;',
                f'revoke all on function {qualified}('+('jsonb' if argument else '')+') from public,anon,authenticated,service_role;']
        expected['functions'][signature]=function_metadata(body,result,language,argument,definer)
    ddl.append(MARKERS['after_functions'])
    for name in TABLES:
        triggers=[('immutable','BEFORE DELETE OR UPDATE','FOR EACH ROW','immutable_guard'),('no_truncate','BEFORE TRUNCATE','FOR EACH STATEMENT','immutable_guard')]
        if name!='descriptor':triggers.append(('review_v3_guard','BEFORE INSERT','FOR EACH ROW','refuse_insert'))
        for trigger,timing,each,function in triggers:
            statement=f'CREATE TRIGGER {trigger} {timing} ON {SCHEMA}.{name} {each} EXECUTE FUNCTION {SCHEMA}.{function}()'
            ddl.append(statement+';')
            expected['relations'][name]['triggers'].append(dict(name=trigger,enabled='O',definition=statement))
        if name!='descriptor':
            statement=f'CREATE CONSTRAINT TRIGGER structural_complete AFTER INSERT ON {SCHEMA}.{name} DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION {SCHEMA}.terminal_check()'
            ddl.append(statement+';')
            expected['relations'][name]['triggers'].append(dict(name='structural_complete',enabled='O',definition=statement))
            expected['relations'][name]['constraints'].append(dict(name='structural_complete',definition='TRIGGER DEFERRABLE INITIALLY DEFERRED',validated=True))
        expected['relations'][name]['constraints'].sort(key=lambda x:x['name'])
        expected['relations'][name]['triggers'].sort(key=lambda x:x['name'])
    ddl.append(MARKERS['after_triggers'])
    expected['relation_inventory'].sort(key=lambda x:x['name']); expected['types'].sort(key=lambda x:x['name'])
    expected['foreign_key_triggers'].sort(key=lambda x:(x['constraint'],x['relation'],x['function']))
    literal=canonical(expected)
    paths=[source/'record-review-v3-gate-a.sql',source/'record_review_v3_gate_a_descriptor.py',source/PARENT_FILE,source/PRIVATE_FILE]
    return dict(ddl='\n'.join(ddl),absence_sql=absence,expected=expected,expected_sha256=sha(literal.encode()),
      descriptor_insert=f'insert into {SCHEMA}.descriptor(id,definition) values(true,$v3_expected$'+literal+'$v3_expected$::jsonb);',
      snapshot_sql=f'select {SCHEMA}.snapshot();',source_hashes={p.name:sha(p.read_bytes()) for p in paths},
      reference_status='candidate_not_admitted',acceptance=False)


if __name__=='__main__':
    result=build()
    print(canonical(dict(kind=KIND,reference_status=result['reference_status'],acceptance=False,
      tables=len(TABLES),functions=len(result['expected']['functions']),foreign_key_triggers=len(result['expected']['foreign_key_triggers']),
      expected_sha256=result['expected_sha256'],database_operations=0)))
