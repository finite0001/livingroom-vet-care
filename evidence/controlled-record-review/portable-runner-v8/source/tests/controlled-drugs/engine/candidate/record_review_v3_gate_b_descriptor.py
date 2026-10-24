"""Independent private Gate B A1 adapter candidate; no runtime/configuration credit.

Only frozen declarative shapes and low-level metadata helpers are reused. This
module never calls Gate A build(), mutates its globals, connects to PostgreSQL,
or rewrites rendered Gate A DDL. A separate reference and new frozen wrapper
remain mandatory before any Gate B runtime acceptance.
"""
from copy import deepcopy
import json
import re
from pathlib import Path

import record_review_v3_gate_a_descriptor as frozen

SOURCE = Path(__file__).resolve().parent
SCHEMA = frozen.SCHEMA
KIND = 'controlled-review-v3-gate-b-private-adapters-a1-v1'
STAGE = 'private_adapters_a1'
FROZEN_DECLARATION_FILE = 'record_review_v3_gate_a_descriptor.py'
FROZEN_DECLARATION_SHA = 'a09d0edefe78ef7f5d6420a9128559ab217ed8dcbf5f3d8777132985d774d417'
SHAPE_SHA = '9bff0e2a28dd2438ef2056b27f0850656160c568a213189073f05d51e170ca2a'
PARENT_FILE, PARENT_SHA = frozen.PARENT_FILE, frozen.PARENT_SHA
PRIVATE_FILE, PRIVATE_SHA = frozen.PRIVATE_FILE, frozen.PRIVATE_SHA
FACADES = tuple(frozen.FACADES)
PRIVATE_STUBS = tuple(frozen.PRIVATE_STUBS)
BODY_NAMES = frozenset(('immutable_guard','refuse_insert','terminal_check','required','snapshot'))
CONFIG = deepcopy(frozen.CONFIG)
TABLES = deepcopy(frozen.TABLES)
ENUMS = deepcopy(frozen.ENUMS)
MARKERS = {key:'-- RECORD_REVIEW_V3_GATE_B_' + key.upper() + ' --' for key in
           ('admission','after_schema','after_tables','after_functions','after_triggers','after_descriptor','before_postcheck','before_commit')}
sha, canonical, unique, acl = frozen.sha, frozen.canonical, frozen.unique, frozen.acl
checks, fk_triggers = frozen.checks, frozen.fk_triggers

ADAPTER_MANIFEST = 'record-review-v3-adapters-selectors.json'
ADAPTER_DECLARATIONS = (('adapt_event', 'record-review-v3-adapters.sql', (('p_event_id', 'uuid'),)),
 ('collect_event_sources', 'record-review-v3-adapters.sql', (('p_event_id', 'uuid'),)),
 ('managed_source_event', 'record-review-v3-adapters.sql', (('p_request', 'jsonb'),)),
 ('adapter_add',
  'record-review-v3-adapters.sql',
  (('p_state', 'jsonb'),
   ('p_relation', 'text'),
   ('p_key', 'jsonb'),
   ('p_row', 'jsonb'),
   ('p_role', 'text'))),
 ('adapter_parent',
  'record-review-v3-adapters.sql',
  (('p_state', 'jsonb'), ('p_event_id', 'uuid'), ('p_role', 'text'))),
 ('adapter_event_site', 'record-review-v3-adapters.sql', (('p_event_id', 'uuid'),)),
 ('adapter_movement',
  'record-review-v3-adapters-clinical.sql',
  (('p_state', 'jsonb'),
   ('p_movement_id', 'uuid'),
   ('p_source_writer', 'text'),
   ('p_source_id', 'uuid'),
   ('p_actor_id', 'uuid'),
   ('p_role', 'text'),
   ('p_managed', 'boolean'))),
 ('adapter_clinical',
  'record-review-v3-adapters-clinical.sql',
  (('p_state', 'jsonb'), ('p_event_id', 'uuid'))),
 ('adapter_dispense',
  'record-review-v3-adapters-native.sql',
  (('p_state', 'jsonb'),
   ('p_dispense_id', 'uuid'),
   ('p_product_id', 'uuid'),
   ('p_role', 'text'),
   ('p_depth', 'integer'))),
 ('adapter_pickup',
  'record-review-v3-adapters-native.sql',
  (('p_state', 'jsonb'),
   ('p_pickup_id', 'uuid'),
   ('p_product_id', 'uuid'),
   ('p_role', 'text'),
   ('p_depth', 'integer'))),
 ('adapter_return',
  'record-review-v3-adapters-native.sql',
  (('p_state', 'jsonb'),
   ('p_return_id', 'uuid'),
   ('p_product_id', 'uuid'),
   ('p_role', 'text'),
   ('p_depth', 'integer'))),
 ('adapter_context',
  'record-review-v3-adapters-context.sql',
  (('p_state', 'jsonb'), ('p_event_id', 'uuid'))))
ADAPTER_FILES = tuple(dict.fromkeys(item[1]for item in ADAPTER_DECLARATIONS))
ADAPTER_KINDS = ('adjust_inventory',
 'append_native_dispense_correction:clinical_annotation',
 'append_native_dispense_correction:operational_annotation',
 'append_native_dispense_correction:pickup_amendment',
 'receive_inventory',
 'record_anesthesia_drug_administration',
 'record_native_dispense',
 'record_native_dispense_return:dispose',
 'record_native_dispense_return:intake',
 'record_native_dispense_return:restock',
 'record_native_dispense_return_v2:dispose',
 'record_native_dispense_return_v2:intake',
 'record_native_dispense_return_v2:restock',
 'record_native_dispense_return_v2:retract_disposal',
 'record_native_dispense_return_v2:retract_intake',
 'record_native_dispense_return_v2:retract_restock',
 'record_native_pickup',
 'record_native_return_discrepancy:note',
 'record_native_return_discrepancy:report',
 'record_native_return_discrepancy:resolve_confirmed_original',
 'record_native_return_discrepancy:resolve_corrected',
 'record_patient_treatment')
ADAPTER_EVIDENCE_FILES = ('supabase/migrations/20260913260000_treatment_alert_review.sql',
 'supabase/migrations/20260916072509_native_fulfillment.sql',
 'supabase/migrations/20260916083056_native_dispense_corrections.sql',
 'supabase/migrations/20260916090000_native_dispense_returns.sql',
 'supabase/migrations/20260916094500_native_return_reconciliation.sql',
 'supabase/migrations/20260928140000_anesthesia_drug_administrations.sql',
 'supabase/migrations/20261015020722_stock_writer_provenance.sql',
 'supabase/migrations/20261015055007_native_custody_provenance.sql',
 'tests/controlled-drugs/engine/candidate/constraints.sql',
 'tests/controlled-drugs/engine/candidate/opening.sql',
 'tests/controlled-drugs/engine/candidate/posting.sql',
 'tests/controlled-drugs/engine/candidate/review.sql',
 'tests/controlled-drugs/engine/candidate/schema.sql')


def assert_frozen_shapes(source):
    # Bind both bytes read from an alternate source closure and the Python module
    # actually executing these low-level helpers. A matching mutable global alone
    # cannot authorize a different shape.
    assert sha((source/FROZEN_DECLARATION_FILE).read_bytes()) == FROZEN_DECLARATION_SHA, 'Frozen Gate A declaration bytes changed'
    assert sha(Path(frozen.__file__).read_bytes()) == FROZEN_DECLARATION_SHA, 'Executed frozen declaration bytes changed'
    for tables,enums in ((TABLES,ENUMS),(frozen.TABLES,frozen.ENUMS)):
        value=dict(tables=tables,enums=[[list(key),list(value)]for key,value in sorted(enums.items())])
        assert sha(canonical(value).encode()) == SHAPE_SHA, 'Exact frozen13-table/15-FK shape required'
    assert TABLES == frozen.TABLES and ENUMS == frozen.ENUMS
    assert TABLES is not frozen.TABLES and ENUMS is not frozen.ENUMS
    assert len(TABLES)==13 and sum(len(value['fks'])for value in TABLES.values())==15
    assert FACADES==frozen.FACADES and PRIVATE_STUBS==frozen.PRIVATE_STUBS and CONFIG==frozen.CONFIG


def read_functions(path):
    text=path.read_text()
    pattern=r'^-- BEGIN FUNCTION ([a-z_][a-z0-9_]*)\|([a-z0-9]+)\|([a-z]+)\n(.*?)^-- END FUNCTION$'
    matches=list(re.finditer(pattern,text,re.M|re.S))
    assert len(matches)==len(BODY_NAMES) and {m[1] for m in matches}==BODY_NAMES, 'Exact Gate B private A1 function inventory required'
    residue=re.sub(pattern,'',text,flags=re.M|re.S)
    assert all(not line.strip() or line.startswith('--')for line in residue.splitlines()), 'Unexpected SQL outside reviewed bodies'
    return [(m[1],m[2],m[3],'','\n'+m[4])for m in matches]



def function_metadata(body,result,language,argument,definer):
    metadata=frozen.function_metadata(body,result,language,argument,definer)
    metadata['argument_names']=[item.split()[0]for item in argument.split(', ')]if argument else None
    return metadata


def read_adapters(source):
    root=source.parents[3]
    manifest=json.loads((source/ADAPTER_MANIFEST).read_text(),object_pairs_hook=unique)
    assert manifest['kind']=='record-review-v3-adapter-selector-proposal-v1'
    assert manifest['public_grants']==[] and manifest['fixed_meaning']=='independent_record_review_v1'
    wanted=[]
    for name,file,arguments in ADAPTER_DECLARATIONS:
        wanted.append(dict(name=name,schema=SCHEMA,file=file,arguments=[dict(name=n,type=t)for n,t in arguments],
            result='jsonb',language='plpgsql',security_definer=False,volatility='volatile',strict=False,
            parallel='unsafe',configuration=CONFIG,owner='postgres',application_execute=False))
    # Complete keysets, order, argument names/types and formal Boolean attributes.
    assert canonical(manifest['function_inventory'])==canonical(wanted), 'Exact private A1 function declarations required'
    assert canonical(manifest['function_attributes'])==canonical(dict(owner='postgres',security='invoker',language='plpgsql',
        volatility='volatile',strict=False,parallel='unsafe',search_path=['pg_catalog','public','pg_temp'],
        application_execute=False,write_statements=False,timezone='UTC')), 'Exact private A1 function attributes required'
    assert tuple(sorted(x['event_kind']for x in manifest['kinds']))==ADAPTER_KINDS, 'Exact22 declared source kinds required'
    evidence=manifest['source_evidence_sha256']
    assert tuple(sorted(evidence))==ADAPTER_EVIDENCE_FILES, 'Exact adapter evidence source keyset required'
    for path,digest in evidence.items():
        assert re.fullmatch('[0-9a-f]{64}',digest)and sha((root/path).read_bytes())==digest, 'Adapter evidence source drift'
    functions=[]
    pattern=r'^-- BEGIN FUNCTION ([a-z_][a-z0-9_]*)\|([a-z0-9]+)\|([a-z]+)\n(.*?)^-- END FUNCTION$'
    for file in ADAPTER_FILES:
        text=(source/file).read_text()
        matches=list(re.finditer(pattern,text,re.M|re.S))
        expected=[item for item in wanted if item['file']==file]
        assert len(matches)==len(expected)and{m[1]for m in matches}=={item['name']for item in expected}, 'Exact per-file A1 function inventory required'
        residue=re.sub(pattern,'',text,flags=re.M|re.S)
        assert all(not line.strip()or line.startswith('--')for line in residue.splitlines()), 'Unexpected SQL outside reviewed adapter bodies'
        for match in matches:
            declaration=next(item for item in expected if item['name']==match[1])
            assert match[2]=='jsonb'and match[3]=='plpgsql', 'Exact adapter result/language required'
            arguments=', '.join(a['name']+' '+a['type']for a in declaration['arguments'])
            body='\n'+match[4]
            assert '$body$'not in body, 'Adapter body delimiter collision'
            functions.append((match[1],'jsonb','plpgsql',arguments,body))
    return functions,evidence


def build(source=SOURCE):
    source=Path(source).resolve()
    assert_frozen_shapes(source)
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
  raise exception 'Record-review v3 Gate B private A1 package must be wholly absent' using errcode='23514';end if;
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
    functions=read_functions(source/'record-review-v3-schema.sql')+adapter_functions
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
    paths=[source/'record-review-v3-schema.sql',source/'record_review_v3_gate_b_descriptor.py',source/FROZEN_DECLARATION_FILE,source/PARENT_FILE,source/PRIVATE_FILE,source/ADAPTER_MANIFEST]+[source/file for file in ADAPTER_FILES]
    return dict(ddl='\n'.join(ddl),absence_sql=absence,expected=expected,expected_sha256=sha(literal.encode()),
      descriptor_insert=f'insert into {SCHEMA}.descriptor(id,definition) values(true,$v3_expected$'+literal+'$v3_expected$::jsonb);',
      snapshot_sql=f'select {SCHEMA}.snapshot();',source_hashes={p.name:sha(p.read_bytes()) for p in paths},
      adapter_source_evidence_sha256=dict(adapter_evidence),adapter_functions=len(adapter_functions),
      reference_status='candidate_not_admitted',stage=STAGE,adapter_coverage=False,configuration_implemented=False,acceptance=False)


if __name__=='__main__':
    result=build()
    print(canonical(dict(kind=KIND,reference_status=result['reference_status'],acceptance=False,
      tables=len(TABLES),functions=len(result['expected']['functions']),foreign_key_triggers=len(result['expected']['foreign_key_triggers']),
      expected_sha256=result['expected_sha256'],database_operations=0)))
