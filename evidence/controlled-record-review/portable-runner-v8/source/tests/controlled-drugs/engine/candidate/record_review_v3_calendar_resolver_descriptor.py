"""Pure39-function calendar-resolver source renderer; no live expectations."""
from copy import deepcopy
from pathlib import Path
import json
import re
import sys

PROFILE=Path(__file__).resolve().parent
SOURCE=PROFILE if PROFILE.name=="candidate" else PROFILE.parents[2]/"tests/controlled-drugs/engine/candidate"
sys.path.insert(0,str(SOURCE))
import record_review_v3_configuration_record_descriptor as base

SCHEMA=base.SCHEMA
KIND='controlled-review-v3-private-calendar-resolver-v1'
STAGE='private_calendar_resolver_v1'
MANIFEST_SHA='b8094b6d72bad4b0fcc899817ef465467279d384cd0fd88b78fe4547771a2b4d'
TABLES=deepcopy(base.TABLES);ENUMS=deepcopy(base.ENUMS)
FACADES=tuple(base.FACADES);PRIVATE_STUBS=tuple(base.PRIVATE_STUBS)
CONFIG=deepcopy(base.CONFIG)
PARENT_FILE,PARENT_SHA=base.PARENT_FILE,base.PARENT_SHA
PRIVATE_FILE,PRIVATE_SHA=base.PRIVATE_FILE,base.PRIVATE_SHA
FROZEN_DECLARATION_FILE=base.FROZEN_DECLARATION_FILE
ADAPTER_MANIFEST=base.ADAPTER_MANIFEST;ADAPTER_FILES=base.ADAPTER_FILES
sha,canonical,unique,acl=base.sha,base.canonical,base.unique,base.acl
checks,fk_triggers=base.checks,base.fk_triggers
read_functions,read_adapters=base.read_functions,base.read_adapters
function_metadata=base.function_metadata
assert_frozen_shapes=base.assert_frozen_shapes
MARKERS={key:'-- RECORD_REVIEW_V3_CALENDAR_RESOLVER_'+key.upper()+' --'for key in base.MARKERS}


def admit_manifest(profile):
    raw=(profile/'record-review-v3-calendar-resolver-profile.json').read_bytes()
    assert sha(raw)==MANIFEST_SHA,'Exact prospective calendar-resolver manifest required'
    manifest=json.loads(raw,object_pairs_hook=unique)
    assert manifest['stage']==STAGE and manifest['descriptor_kind']==KIND
    assert sha((profile/'record-review-v3-calendar-resolver-metadata.json').read_bytes())==manifest['metadata_sha256']
    assert sha((profile/'record-review-v3-calendar-resolver-schema.sql').read_bytes())==manifest['schema_sha256']
    return manifest

NEW_DECLARATIONS=(('calendar_candidates','p_request'),('resolve_calendar','p_calendar'))

def read_new_functions(source,profile):
    manifest=admit_manifest(profile)
    metadata=json.loads((profile/'record-review-v3-calendar-resolver-metadata.json').read_text(),object_pairs_hook=unique)
    assert set(metadata)=={'kind','functions','source'} and metadata['kind']=='calendar-resolver-private-helper-metadata-v1'
    origin=metadata['source'];assert origin==dict(path='tests/controlled-drugs/engine/candidate/record-review-v3-calendar.sql',sha256=manifest['calendar_sha256'],body_change_permitted=False)
    raw=(source/'record-review-v3-calendar.sql').read_bytes();assert sha(raw)==manifest['calendar_sha256']
    declarations=metadata['functions'];assert len(declarations)==2
    result=[];residue=raw.decode()
    for (name,arg),entry in zip(NEW_DECLARATIONS,declarations):
        wanted=dict(name=name,namespace=SCHEMA,result='jsonb',language='plpgsql',owner='postgres',security_definer=False,strict=False,leakproof=False,volatility='volatile',parallel='unsafe',cost=100,rows=0,returns_set=False,support=None,configuration=CONFIG,execute_acl=acl(['EXECUTE']),explicit_revocations=['PUBLIC','anon','authenticated','service_role'],arguments=[dict(mode='in',name=arg,type='jsonb')],external_relation_reads=['pg_catalog.pg_timezone_names']if name=='calendar_candidates'else[],helper_edges=[]if name=='calendar_candidates'else['controlled_review_v3.calendar_candidates(jsonb)','public.controlled_stock_text(jsonb,integer,boolean)'])
        assert canonical(entry)==canonical(wanted),'Exact two-helper metadata required'
        pattern=r'^-- BEGIN FUNCTION '+name+r'\|jsonb\|plpgsql\n(.*?)^-- END FUNCTION$'
        matches=list(re.finditer(pattern,raw.decode(),re.M|re.S));assert len(matches)==1
        residue=re.sub(pattern,'',residue,flags=re.M|re.S)
        body='\n'+matches[0][1];assert '$body$'not in body
        result.append((name,'jsonb','plpgsql',arg+' jsonb',body))
    assert all(not line.strip()or line.startswith('--')for line in residue.splitlines())
    return result


def build(source=SOURCE, profile=PROFILE):
    source=Path(source).resolve()
    profile=Path(profile).resolve()
    admit_manifest(profile)
    assert_frozen_shapes(source)
    assert TABLES==base.TABLES and ENUMS==base.ENUMS and TABLES is not base.TABLES
    adapter_functions,adapter_evidence=read_adapters(source)
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
  raise exception 'Record-review v3 calendar-resolver package must be wholly absent' using errcode='23514';end if;
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
    functions=read_functions(profile/'record-review-v3-calendar-resolver-schema.sql')+adapter_functions+[base.base.read_input(source)]+base.read_new_functions(source,source)+read_new_functions(source,profile)
    stub="\nbegin\n perform controlled_review_v3.required();\n raise exception 'Record-review v3 Gate B private A1; protocol is not implemented' using errcode='0A000';\nend\n"
    functions += [(name,'jsonb','plpgsql','p_request jsonb',stub) for name in PRIVATE_STUBS]
    functions += [('public.'+name,'jsonb','plpgsql','p_request jsonb',stub) for name in FACADES]
    for name,result,language,argument,body in functions:
        qualified=name if name.startswith('public.') else SCHEMA+'.'+name
        signature=qualified+'('+argument+')'
        definer=name.startswith('public.') or name=='terminal_check'
        assert result in ('void','trigger','jsonb') and language in ('sql','plpgsql')
        ddl += [f'create function {signature} returns {result}\nlanguage {language} volatile '+('security definer ' if definer else '')+
                "set search_path=pg_catalog,public,pg_temp set timezone='UTC' as $body$"+body+'$body$;',
                f'revoke all on function {qualified}('+(', '.join(item.split()[1]for item in argument.split(', '))if argument else '')+') from public,anon,authenticated,service_role;']
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
    parent_direct=base.build(source,source)['source_hashes']
    paths=[source.parents[3]/name for name in parent_direct]
    paths += [profile/name for name in ('record-review-v3-calendar-resolver-profile.json','record-review-v3-calendar-resolver-schema.sql','record-review-v3-calendar-resolver-metadata.json','record_review_v3_calendar_resolver_descriptor.py')]
    paths += [source/'record-review-v3-calendar.sql']

    root=source.parents[3]

    return dict(ddl='\n'.join(ddl),absence_sql=absence,expected=expected,expected_sha256=sha(literal.encode()),
      descriptor_insert=f'insert into {SCHEMA}.descriptor(id,definition) values(true,$v3_expected$'+literal+'$v3_expected$::jsonb);',
      snapshot_sql=f'select {SCHEMA}.snapshot();',source_hashes={str(p.relative_to(root)):sha(p.read_bytes()) for p in paths},
      adapter_source_evidence_sha256=dict(adapter_evidence),adapter_functions=len(adapter_functions),
      reference_status='candidate_not_admitted',stage=STAGE,adapter_coverage=False,configuration_value_implemented=True,configuration_publication_implemented=False,acceptance=False)

