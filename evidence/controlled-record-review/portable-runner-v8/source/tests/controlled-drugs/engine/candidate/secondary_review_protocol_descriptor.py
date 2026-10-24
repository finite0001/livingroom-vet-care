"""Independent finite DDL/metadata assembler for the private review foundation.

No database access, catalog capture, live reseal or migration mutation. Expected
semantics originate in this allowlist and reviewed function bodies. Separate
reference realizations cross-check rendering before freezing either profile.
The Gate A prototype and its independent artifact remain untouched.
"""
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SITE_PROOF_SHA256 = 'd063084cef5810af2d431ea26ff14ff0daaac48dd1355849198db08b2e8311d4'
PARENT_SHA256 = '4755a1f1c53008003a11e94ada3963ae416f6c81f163ec43ed2ffea21d6d2f78'
FACADES = (
    'prepare_controlled_secondary_review', 'read_controlled_secondary_review',
    'execute_controlled_secondary_review', 'cancel_controlled_secondary_review',
    'read_controlled_secondary_review_event', 'list_controlled_secondary_reviews',
)
SCHEMA_FUNCTIONS = {'immutable_guard','target','site','packet','receipt','required','require_prior_commit',
                    'definition_guard','binding_guard','validate_operation','terminal_check','validate_history','snapshot'}
PROTOCOL_FUNCTIONS = {'request','entry','operation_gate','execution_definition','operation_state','event_summary','current_definition'} | {'public.' + n for n in FACADES}
CONFIG = ['search_path=pg_catalog, public, pg_temp', 'TimeZone=UTC']


def columns(spec):
    return [(name, kind, True) for name, kind in spec]


def fk(name, column, relation, remote='id'):
    return (name, column, relation, remote)


TABLES = {
    'descriptor': {'columns': columns([('id','boolean'),('definition','jsonb')]), 'keys': [('descriptor_pkey',['id'],True)], 'checks': [('descriptor_singleton','CHECK (id)')], 'fks': []},
    'definitions': {
        'columns': columns([('id','uuid'),('product_id','uuid'),('site_id','uuid'),('event_kind','text'),('capability','text'),('version','integer'),('enabled','boolean'),('roles','text[]')]),
        'keys': [('definitions_pkey',['id'],True),('definitions_stream_version_key',['product_id','site_id','event_kind','capability','version'],False)],
        'checks': [], 'fks': [fk('definitions_product_fk','product_id','public.catalog_products'),fk('definitions_site_fk','site_id','public.controlled_stock_sites')]},
    'preparations': {
        'columns': columns([('operation_id','uuid'),('event_id','uuid'),('actor_id','uuid'),('session_id','uuid'),('definition_id','uuid'),
                            ('target','jsonb'),('target_hash','text'),('canonical_request','jsonb'),('request_hash','text'),('packet','jsonb'),('packet_hash','text'),
                            ('decision','text'),('reason','text'),('meaning_text','text'),('meaning_version','integer'),
                            ('prepared_boot','timestamp with time zone'),('prepared_xid','xid8'),('created_at','timestamp with time zone'),('expires_at','timestamp with time zone')]),
        'keys': [('preparations_pkey',['operation_id'],True)], 'checks': [],
        'fks': [fk('preparations_event_fk','event_id','public.controlled_stock_events'),fk('preparations_actor_fk','actor_id','public.profiles'),fk('preparations_definition_fk','definition_id','controlled_review.definitions')]},
    'decisions': {
        'columns': columns([('operation_id','uuid'),('event_id','uuid'),('actor_id','uuid'),('session_id','uuid'),('actor_name','text'),('definition_id','uuid'),
                            ('target_hash','text'),('request_hash','text'),('packet_hash','text'),('decision','text'),('reason','text'),
                            ('meaning_text','text'),('meaning_version','integer'),('recorded_at','timestamp with time zone'),('receipt','jsonb')]),
        'keys': [('decisions_pkey',['operation_id'],True),('decisions_event_key',['event_id'],False)], 'checks': [],
        'fks': [fk('decisions_preparation_fk','operation_id','controlled_review.preparations','operation_id'),fk('decisions_event_fk','event_id','public.controlled_stock_events'),
                fk('decisions_actor_fk','actor_id','public.profiles'),fk('decisions_definition_fk','definition_id','controlled_review.definitions')]},
    'cancellations': {
        'columns': columns([('operation_id','uuid'),('actor_id','uuid'),('session_id','uuid'),('recorded_at','timestamp with time zone')]),
        'keys': [('cancellations_pkey',['operation_id'],True)], 'checks': [],
        'fks': [fk('cancellations_preparation_fk','operation_id','controlled_review.preparations','operation_id'),fk('cancellations_actor_fk','actor_id','public.profiles')]},
}


def _acl(privileges, role='postgres'):
    return [{'grantee':role,'grantor':'postgres','privilege':p,'grantable':False} for p in sorted(privileges)]


def _function_metadata(body, result, language, argument, definer, grant):
    acl = _acl(['EXECUTE'])
    if grant:
        acl = _acl(['EXECUTE'],'authenticated') + acl
    return dict(source=body,owner='postgres',language=language,return_type=result,
                kind='f',security_definer=definer,strict=False,leakproof=False,volatility='v',parallel='u',returns_set=False,cost=100,rows=0,
                configuration=CONFIG,argument_names=[argument.split()[0]] if argument else None,
                all_argument_types=None,argument_modes=None,default_count=0,defaults=None,variadic='-',support='-',sql_body=None,acl=acl)


def _read_functions(path, allowed):
    source = path.read_text()
    matches = list(re.finditer(r'^-- BEGIN FUNCTION ([a-z_.]+)\|([a-z0-9]+)\|([a-z]+)(?:\|([^\n]+))?\n(.*?)^-- END FUNCTION$',source,re.M|re.S))
    assert {m[1] for m in matches} == allowed and len(matches) == len(allowed), 'Exact reviewed function inventory required'
    residue = re.sub(r'^-- BEGIN FUNCTION .*?^-- END FUNCTION$','',source,flags=re.M|re.S)
    assert all(not line.strip() or line.startswith('--') for line in residue.splitlines()), 'Unexpected SQL outside finite function bodies'
    result = []
    for m in matches:
        argument = m[4] or ''
        assert not argument or re.fullmatch(r'p_[a-z_]+ (uuid|jsonb)',argument), 'Only exact reviewed single-argument signatures'
        assert m[2] in ('jsonb','uuid','void','trigger') and m[3] in ('sql','plpgsql')
        result.append((m[1],m[2],m[3],argument,'\n'+m[5]))
    return result


def _fk_metadata(name, child, parent):
    result = []
    for relation, other, function, bits in (
        (child,parent,'RI_FKey_check_ins',5),(child,parent,'RI_FKey_check_upd',17),
        (parent,child,'RI_FKey_noaction_upd',17),(parent,child,'RI_FKey_restrict_del',9)):
        result.append(dict(constraint=name,relation=relation,function='pg_catalog.'+function,constraint_relation=other,
                           type=bits,enabled='O',internal=True,deferrable=False,initially_deferred=False,
                           argument_count=0,arguments='',columns='',condition=None,old_table=None,new_table=None))
    return result


def build(profile='private'):
    assert profile in ('private','synthetic_auth'), 'Predetermined private or synthetic Auth fixture profile required'
    parent_bytes = (ROOT/'release-expected-204.json').read_bytes()
    assert hashlib.sha256(parent_bytes).hexdigest() == PARENT_SHA256, 'Unchanged independent frozen parent pin required'
    parent = json.loads(parent_bytes)['expected_technical_manifest']
    assert parent['version'] == 2 and len(parent['functions']) == 171 and len(parent['relations']) == 51
    expected = dict(kind='controlled-review-foundation-v1',parent=dict(revision=1,manifest=parent),
                    schema=dict(owner='postgres',acl=_acl(['CREATE','USAGE'])),functions={},relations={},relation_inventory=[],types=[],
                    other_objects=[],facade_objects=[],foreign_key_triggers=[])
    names = ','.join("'"+n+"'" for n in FACADES)
    ddl = [f"""do $admission$ begin
 if exists(select 1 from pg_namespace where nspname='controlled_review') or
    exists(select 1 from pg_proc where pronamespace='public'::regnamespace and proname in({names})) or
    exists(select 1 from pg_class where relnamespace='public'::regnamespace and relname in({names})) or
    exists(select 1 from pg_type where typnamespace='public'::regnamespace and typname in({names})) then
  raise exception 'Secondary-review package must be wholly absent' using errcode='23514';
 end if;
end $admission$;""",'create schema controlled_review authorization postgres;',
           'revoke all on schema controlled_review from public,anon,authenticated,service_role;']
    for name,spec in TABLES.items():
        declarations = [n+' '+t+(' not null' if nn else '') for n,t,nn in spec['columns']]
        constraints = list(spec['checks'])
        indexes = []
        for key,cols,primary in spec['keys']:
            field_list = ', '.join(cols)
            constraints.append((key,('PRIMARY KEY' if primary else 'UNIQUE')+' ('+field_list+')'))
            indexes.append(dict(definition=f'CREATE UNIQUE INDEX {key} ON controlled_review.{name} USING btree ({field_list})',
                                valid=True,ready=True,live=True,primary=primary,unique=True,exclusion=False,immediate=True))
            expected['relation_inventory'].append(dict(name=key,kind='i'))
        for constraint,column,parent_relation,remote in spec['fks']:
            rendered_parent = parent_relation.removeprefix('public.')
            constraints.append((constraint,f'FOREIGN KEY ({column}) REFERENCES {rendered_parent}({remote}) ON DELETE RESTRICT'))
            expected['foreign_key_triggers'] += _fk_metadata(constraint,'controlled_review.'+name,parent_relation)
        for constraint,definition in constraints:
            sql_definition = definition
            if definition.startswith('FOREIGN KEY'):
                for _,_,parent_relation,_ in spec['fks']:
                    if parent_relation.startswith('public.'):
                        sql_definition=sql_definition.replace('REFERENCES '+parent_relation.removeprefix('public.')+'(', 'REFERENCES '+parent_relation+'(')
            declarations.append('constraint '+constraint+' '+sql_definition)
        ddl += ['create table controlled_review.'+name+'('+','.join(declarations)+');',
                f'alter table controlled_review.{name} enable row level security;',
                f'revoke all on controlled_review.{name} from public,anon,authenticated,service_role;']
        expected['relations'][name]=dict(kind='r',owner='postgres',persistence='p',rls=True,force_rls=False,replica_identity='d',options=None,
             acl=_acl(['DELETE','INSERT','MAINTAIN','REFERENCES','SELECT','TRIGGER','TRUNCATE','UPDATE']),
             columns=[dict(name=n,type=t,not_null=nn,identity='',generated='',default=None,collation='"default"' if t in ('text','text[]') else '-',column_acl=[]) for n,t,nn in spec['columns']],
             constraints=[dict(name=c,definition=d,validated=True)for c,d in sorted(constraints)],indexes=sorted(indexes,key=lambda i:i['definition']),triggers=[],policies=[],rules=[])
        expected['relation_inventory'].append(dict(name=name,kind='r'))
        expected['types'] += [dict(name=name,kind='c',owner='postgres',relation=name,element=None,acl=None),dict(name='_'+name,kind='b',owner='postgres',relation=None,element=name,acl=None)]
    site_bytes=(ROOT/'secondary-review-acceptance.sql').read_bytes()
    assert hashlib.sha256(site_bytes).hexdigest()==SITE_PROOF_SHA256, 'Unchanged independently proven Gate A site extractor required'
    proven_site=site_bytes.decode().split('$site$',2)[1]
    sources = [(ROOT/'secondary-review-schema.sql',SCHEMA_FUNCTIONS),(ROOT/'secondary-review-protocol.sql',PROTOCOL_FUNCTIONS)]
    for path,allowed in sources:
        for name,result,language,argument,body in _read_functions(path,allowed):
            if name=='site':
                assert body==proven_site, 'Final site extractor must retain actual Gate A proven body'
            qualified = name if name.startswith('public.') else 'controlled_review.'+name
            signature=qualified+'('+argument+')'
            argtype=argument.split()[-1] if argument else ''
            facade=name.startswith('public.')
            # Deferred triggers execute after the facade's definer context ends.
            # Only this private constraint trigger needs its own owner context.
            definer=facade or name=='terminal_check'
            ddl += [f'create function {signature} returns {result}\nlanguage {language} volatile '+('security definer ' if definer else '')+"set search_path=pg_catalog,public,pg_temp set timezone='UTC' as $body$"+body+'$body$;',
                    f'revoke all on function {qualified}({argtype}) from public,anon,authenticated,service_role;']
            grant=facade and profile=='synthetic_auth'
            if grant:
                ddl.append(f'grant execute on function {qualified}({argtype}) to authenticated;')
            expected['functions'][signature]=_function_metadata(body,result,language,argument,definer,grant)
    for name in TABLES:
        triggers=[('immutable','BEFORE DELETE OR UPDATE','FOR EACH ROW','immutable_guard'),('no_truncate','BEFORE TRUNCATE','FOR EACH STATEMENT','immutable_guard')]
        if name=='definitions':triggers.append(('review_guard','BEFORE INSERT','FOR EACH ROW','definition_guard'))
        if name in ('preparations','decisions','cancellations'):triggers.append(('review_guard','BEFORE INSERT','FOR EACH ROW','binding_guard'))
        for trigger,timing,each,function in triggers:
            statement=f'CREATE TRIGGER {trigger} {timing} ON controlled_review.{name} {each} EXECUTE FUNCTION controlled_review.{function}()'
            ddl.append(statement+';')
            expected['relations'][name]['triggers'].append(dict(name=trigger,enabled='O',definition=statement))
        if name in ('preparations','decisions','cancellations'):
            statement=f'CREATE CONSTRAINT TRIGGER terminal_complete AFTER INSERT ON controlled_review.{name} DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION controlled_review.terminal_check()'
            ddl.append(statement+';')
            expected['relations'][name]['triggers'].append(dict(name='terminal_complete',enabled='O',definition=statement))
            expected['relations'][name]['constraints'].append(dict(name='terminal_complete',definition='TRIGGER DEFERRABLE INITIALLY DEFERRED',validated=True))
        expected['relations'][name]['triggers'].sort(key=lambda r:r['name'])
        expected['relations'][name]['constraints'].sort(key=lambda r:r['name'])
    expected['relation_inventory'].sort(key=lambda r:r['name'])
    expected['types'].sort(key=lambda r:r['name'])
    expected['foreign_key_triggers'].sort(key=lambda r:(r['constraint'],r['relation'],r['function']))
    literal=json.dumps(expected,ensure_ascii=False,sort_keys=True,separators=(',',':'))
    inputs=[p for p,_ in sources]+[Path(__file__),ROOT/'release-expected-204.json',ROOT/'secondary-review-acceptance.sql']
    return dict(ddl='\n'.join(ddl),expected=expected,
                descriptor_insert="insert into controlled_review.descriptor(id,definition) values(true,$expected$"+literal+"$expected$::jsonb);",
                snapshot_sql='select controlled_review.snapshot();',
                source_hashes={str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest()for p in inputs},
                expected_sha256=hashlib.sha256(literal.encode()).hexdigest(),profile=profile)


if __name__=='__main__':
    print(json.dumps(build(),sort_keys=True,indent=2))
