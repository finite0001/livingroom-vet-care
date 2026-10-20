"""Callback-only ongoing column-ACL drift proof; no installer or resealing path.

The caller owns the local databases, fresh SQL backends and protected logs. This
module has no subprocess, network or CLI operations. All raw data/catalogs stay
private; returned evidence contains only fixed cases, flags, counts and hashes.
"""
import hashlib
import json
import re

SCHEMAS = ['public', 'auth', 'storage', 'extensions']
MESSAGE = 'Controlled coverage, code or grants changed; reviewed engine manifest required'
CASES = (
    ('authenticated_column', 'controlled_stock_events', 'id', 'authenticated', False),
    ('public_column', 'controlled_stock_events', 'id', 'PUBLIC', False),
    ('service_role_column', 'controlled_stock_events', 'id', 'service_role', False),
    ('source_column', 'stock_writer_admissions', 'source_id', 'authenticated', False),
    ('column_grant_option', 'controlled_stock_events', 'id', 'authenticated', True),
    ('explicit_owner_column', 'controlled_stock_events', 'id', 'owner', False),
)
HEX = re.compile(r'[0-9a-f]{64}')


def _unique(pairs):
    result = {}
    for key, value in pairs:
        assert key not in result, 'Duplicate column ACL observation field'
        result[key] = value
    return result


def _json(output):
    assert isinstance(output, str)
    lines = [line for line in output.splitlines() if line.strip()]
    assert len(lines) == 1, 'Exactly one private column ACL snapshot required'
    result = json.loads(lines[0], object_pairs_hook=_unique)
    assert isinstance(result, dict)
    return result


def _digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


SNAPSHOT_SQL = r"""
set timezone='UTC';
select controlled_stock_manifest_required();
create function pg_temp.column_acl_seal_rows()returns jsonb language plpgsql volatile as $$
declare r record;v jsonb;result jsonb:='{}';begin
 for r in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname in('public','auth','storage','extensions')and c.relkind in('r','p')order by n.nspname,c.relname loop
 execute format('select jsonb_build_object(''count'',count(*),''hash'',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,''|''order by to_jsonb(t)::text),''''),''UTF8'')),''hex''))from %I.%I t',r.nspname,r.relname)into v;
 result:=result||jsonb_build_object(r.nspname||'.'||r.relname,v);end loop;return result;end$$;
create function pg_temp.column_acl_seal_ledger()returns jsonb language plpgsql volatile as $$declare rows jsonb;begin
 if to_regclass('supabase_migrations.schema_migrations')is null then return jsonb_build_object('present',false,'rows',null);end if;
 execute 'select jsonb_agg(to_jsonb(m)order by version)from supabase_migrations.schema_migrations m'into rows;
 return jsonb_build_object('present',true,'rows',rows);end$$;
select jsonb_build_object(
 'rows',pg_temp.column_acl_seal_rows(),
 'ledger',pg_temp.column_acl_seal_ledger(),
 'writers',(select jsonb_object_agg(signature,encode(sha256(convert_to(pg_get_functiondef(to_regprocedure(signature)),'UTF8')),'hex'))from stock_writer_manifests),
 'stored_manifest',(select jsonb_agg(to_jsonb(m)order by revision)from controlled_stock_engine_manifests m),
 'live_manifest',controlled_stock_manifest_snapshot(),
 'implicit_owner_access',(select has_column_privilege(pg_get_userbyid(c.relowner),c.oid,'id','SELECT')from pg_class c where c.oid='public.controlled_stock_events'::regclass),
 'public_catalog',jsonb_build_object(
  'schema',(select jsonb_build_object('owner',n.nspowner,'acl',to_jsonb(n.nspacl))from pg_namespace n where n.nspname='public'),
  'functions',(select jsonb_object_agg(p.oid::regprocedure::text,jsonb_build_object('definition_sha256',encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex'),
   'owner',p.proowner,'acl',to_jsonb(p.proacl),'configuration',to_jsonb(p.proconfig),'language',p.prolang,'definer',p.prosecdef,'leakproof',p.proleakproof,'parallel',p.proparallel,'volatility',p.provolatile,'cost',p.procost,'rows',p.prorows))
   from pg_proc p where p.pronamespace='public'::regnamespace and p.prokind in('f','p','w')),
  'relations',(select jsonb_object_agg(c.relname,jsonb_build_object('kind',c.relkind,'owner',c.relowner,'acl',to_jsonb(c.relacl),'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,'options',to_jsonb(c.reloptions),'persistence',c.relpersistence,
   'view',case when c.relkind in('v','m')then pg_get_viewdef(c.oid,true)else null end,
   'partition',case when c.relkind='p'then pg_get_partkeydef(c.oid)else null end,
   'columns',(select jsonb_agg(jsonb_build_object('number',a.attnum,'name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'identity',a.attidentity,'generated',a.attgenerated,'acl',to_jsonb(a.attacl),'default',pg_get_expr(d.adbin,d.adrelid))order by a.attnum)
    from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
   'constraints',(select coalesce(jsonb_agg(jsonb_build_object('name',k.conname,'definition',pg_get_constraintdef(k.oid,true),'validated',k.convalidated)order by k.conname),'[]')from pg_constraint k where k.conrelid=c.oid),
   'triggers',(select coalesce(jsonb_agg(jsonb_build_object('name',t.tgname,'enabled',t.tgenabled,'definition',pg_get_triggerdef(t.oid,true))order by t.tgname),'[]')from pg_trigger t where t.tgrelid=c.oid),
   'policies',(select coalesce(jsonb_agg(to_jsonb(p)order by p.polname),'[]')from pg_policy p where p.polrelid=c.oid),
   'indexes',(select coalesce(jsonb_agg(jsonb_build_object('definition',pg_get_indexdef(i.indexrelid),'valid',i.indisvalid,'ready',i.indisready)order by i.indexrelid::regclass::text),'[]')from pg_index i where i.indrelid=c.oid)))
   from pg_class c where c.relnamespace='public'::regnamespace and c.relkind in('r','p','v','m','S'))));
"""


def _validate_snapshot(value, phase):
    assert isinstance(value, dict) and set(value) == {'rows', 'ledger', 'writers', 'stored_manifest', 'live_manifest', 'implicit_owner_access', 'public_catalog'}
    assert isinstance(value['rows'], dict) and value['rows']
    for name, item in value['rows'].items():
        assert isinstance(name, str) and name.split('.', 1)[0] in SCHEMAS
        assert isinstance(item, dict) and set(item) == {'count', 'hash'}
        assert type(item['count']) is int and item['count'] >= 0
        assert isinstance(item['hash'], str) and HEX.fullmatch(item['hash'])
    ledger = value['ledger']
    assert isinstance(ledger, dict) and set(ledger) == {'present', 'rows'} and type(ledger['present']) is bool
    if ledger['present']:
        assert isinstance(ledger['rows'], list) and len(ledger['rows']) == 204
    else:
        assert phase == 'populated_restore' and ledger['rows'] is None
    assert phase != 'installed' or ledger['present'] is True
    assert isinstance(value['writers'], dict) and len(value['writers']) == 10
    assert all(isinstance(v, str) and HEX.fullmatch(v) for v in value['writers'].values())
    assert isinstance(value['stored_manifest'], list) and len(value['stored_manifest']) == 1
    live = value['live_manifest']
    assert isinstance(live, dict) and set(live) == {'version', 'functions', 'relations'}
    assert type(live['version']) is int and live['version'] == 2
    assert isinstance(live['functions'], dict) and len(live['functions']) == 171
    assert isinstance(live['relations'], dict) and len(live['relations']) == 51
    assert isinstance(value['stored_manifest'][0], dict) and value['stored_manifest'][0].get('definition') == live
    for relation in live['relations'].values():
        assert isinstance(relation, dict) and isinstance(relation.get('columns'), list) and relation['columns']
        assert all(isinstance(column, dict) and isinstance(column.get('column_acl'), list) for column in relation['columns'])
    assert value['implicit_owner_access'] is True, 'Implicit owner column access must remain legitimate'
    assert isinstance(value['public_catalog'], dict) and set(value['public_catalog']) == {'schema', 'functions', 'relations'}
    assert all(isinstance(item, dict) and item for item in value['public_catalog'].values())
    return value


def _mutation(case):
    label, relation, column, grantee, grant_option = case
    assert case in CASES
    # Every identifier below is a fixed reviewed fixture name, never caller data.
    target = "pg_get_userbyid(owner_id)" if grantee == 'owner' else "'" + ('authenticated' if grantee == 'PUBLIC' else grantee) + "'"
    grantee_oid = 'owner_id' if grantee == 'owner' else ('0' if grantee == 'PUBLIC' else "'" + grantee + "'::regrole::oid")
    grant = "execute format('grant select(%I)on %s to %I" + (' with grant option' if grant_option else '') + "','" + column + "',rel::regclass,pg_get_userbyid(owner_id));" if grantee == 'owner' else 'grant select(' + column + ')on public.' + relation + ' to ' + grantee + (' with grant option' if grant_option else '') + ';'
    table_expected = 'true' if grantee == 'owner' else 'false'
    option_check = 'or not option_seen' if grant_option else ''
    option_prepare = ""
    option_observe = ""
    if grant_option:
        option_prepare = r"""grant select(id)on public.controlled_stock_events to authenticated;
 plain_live:=controlled_stock_manifest_snapshot();
 select (n-1)::text,col->'column_acl'into acl_index,plain_acl
 from jsonb_array_elements(plain_live#>'{relations,controlled_stock_events,columns}')with ordinality c(col,n)where col->>'name'='id';
 if jsonb_typeof(plain_acl)is distinct from 'array'
 or(select count(*)from jsonb_array_elements(plain_acl)a where a->>'grantee'='authenticated'and a->>'privilege'='SELECT'and a->'grantable'='false'::jsonb)<>1
 or exists(select 1 from jsonb_array_elements(plain_acl)a where a->>'grantee'='authenticated'and a->>'privilege'='SELECT'and a->'grantable'='true'::jsonb)then
  raise exception 'Plain column grant metadata was not observed'using errcode='P0003';end if;
 select jsonb_agg(case when a->>'grantee'='authenticated'and a->>'privilege'='SELECT'then jsonb_set(a,'{grantable}','true'::jsonb)else a end order by n)
 into expected_acl from jsonb_array_elements(plain_acl)with ordinality c(a,n);
 expected_live:=jsonb_set(plain_live,array['relations','controlled_stock_events','columns',acl_index,'column_acl'],expected_acl);
"""
        option_observe = r"""if expected_acl is not distinct from plain_acl or controlled_stock_manifest_snapshot()is distinct from expected_live then
  raise exception 'Only column grantability metadata must advance'using errcode='P0003';end if;
"""
    return "begin;set local timezone='UTC';\n" + r"""do $column_acl_mutation$
declare rel oid:='public.__RELATION__'::regclass;owner_id oid;prior_acl aclitem[];after_acl aclitem[];direct_seen boolean;option_seen boolean;
 live_before jsonb:=controlled_stock_manifest_snapshot();stored_before jsonb;plain_live jsonb;plain_acl jsonb;expected_live jsonb;expected_acl jsonb;acl_index text;begin
 select relowner into owner_id from pg_class where oid=rel;
 select attacl into prior_acl from pg_attribute where attrelid=rel and attname='__COLUMN__'and attnum>0 and not attisdropped;
 select jsonb_agg(to_jsonb(m)order by revision)into stored_before from controlled_stock_engine_manifests m;
 __OPTION_PREPARE__
 __GRANT__
 __OPTION_OBSERVE__
 select attacl into after_acl from pg_attribute where attrelid=rel and attname='__COLUMN__'and attnum>0 and not attisdropped;
 select coalesce(bool_or(a.privilege_type='SELECT'),false),coalesce(bool_or(a.privilege_type='SELECT'and a.is_grantable),false)into direct_seen,option_seen
 from aclexplode(after_acl)a where a.grantee=__GRANTEE_OID__;
 if after_acl is not distinct from prior_acl or direct_seen is distinct from true __OPTION_CHECK__
 or has_column_privilege(__EFFECTIVE_ROLE__,rel,'__COLUMN__','SELECT')is distinct from true
 or has_table_privilege(__EFFECTIVE_ROLE__,rel,'SELECT')is distinct from __TABLE_EXPECTED__
 or controlled_stock_manifest_snapshot()is not distinct from live_before
 or (select jsonb_agg(to_jsonb(m)order by revision)from controlled_stock_engine_manifests m)is distinct from stored_before then
  raise exception 'Column ACL mutation was not independently observed'using errcode='P0003';end if;
 raise notice 'Column ACL seal armed: __LABEL__';
 perform controlled_stock_manifest_required();
 raise exception 'Column ACL drift unexpectedly accepted'using errcode='P0002';
end $column_acl_mutation$;
rollback;
""".replace('__RELATION__', relation).replace('__COLUMN__', column).replace('__GRANT__', grant).replace('__OPTION_PREPARE__', option_prepare).replace('__OPTION_OBSERVE__', option_observe).replace('__GRANTEE_OID__', grantee_oid).replace('__OPTION_CHECK__', option_check).replace('__EFFECTIVE_ROLE__', target).replace('__TABLE_EXPECTED__', table_expected).replace('__LABEL__', label)


def _failure(result, label):
    assert type(result.returncode) is int and result.returncode != 0
    assert isinstance(result.stdout, str) and isinstance(result.stderr, str)
    assert re.search(r'(?:^|\n)NOTICE:\s+(?:00000: )?Column ACL seal armed: ' + re.escape(label) + r'\s*(?:\n|$)', result.stderr), 'Column ACL guard was not armed after observing the grant'
    assert re.search(r'(?:^|\n)ERROR:\s+23514: ' + re.escape(MESSAGE) + r'\s*(?:\n|$)', result.stderr), 'Exact ongoing manifest refusal required'


def probe_column_acl_seal(sql, raw_sql, prior_sql, *, phase='installed'):
    """Observe six real grants, require ongoing refusal and exact rollback.

    prior_sql is accepted for the runner callback interface but is never used to
    compare against trusted189: populated fixtures may have reviewed local grants.
    The full actual public catalog and explicit column ACLs are compared instead.
    """
    assert callable(sql) and callable(raw_sql) and isinstance(prior_sql, str)
    assert phase in ('installed', 'populated_restore')
    baseline = _validate_snapshot(_json(sql(SNAPSHOT_SQL)), phase)
    outcomes = []
    for case in CASES:
        label, relation, column, grantee, option = case
        _failure(raw_sql('\\set VERBOSITY verbose\n' + _mutation(case)), label)
        after = _validate_snapshot(_json(sql(SNAPSHOT_SQL)), phase)
        assert after == baseline, 'Column ACL refusal changed private data/catalog baseline: ' + label
        outcomes.append({'case': label, 'relation': relation, 'column': column, 'grantee': grantee,
                         'grant_option_checked': option, 'grant_option_only_metadata_flip_observed': option, 'expected_table_select': grantee == 'owner',
                         'actual_direct_acl_and_effective_column_select_observed': True,
                         'stored_manifest_unchanged_before_refusal': True, 'armed_before_refusal': True,
                         'sqlstate': '23514', 'error': MESSAGE, 'exact_full_rollback': True})
    return validate_proof({'kind': 'controlled-column-acl-seal-v1', 'phase': phase, 'passed': True,
        'manifest_version': 2, 'manifest_functions': 171, 'manifest_relations': 51,
        'selected_data_schemas': list(SCHEMAS), 'catalog_schema': 'public',
        'data_relation_count': len(baseline['rows']), 'private_baseline_sha256': _digest(baseline),
        'ledger_present': baseline['ledger']['present'], 'ledger_rows': 204 if baseline['ledger']['present'] else 0,
        'refusal_count': 6, 'outcomes': outcomes, 'implicit_owner_access_preserved': True,
        'manifest_never_resealed': True, 'grant_option_only_metadata_flip_verified': True, 'all_data_catalog_ledger_writers_and_manifest_rolled_back': True,
        'hosted_writes': 0, 'clinical_or_register_activation': False})


def validate_proof(proof):
    assert isinstance(proof, dict)
    flags = {'implicit_owner_access_preserved', 'manifest_never_resealed', 'grant_option_only_metadata_flip_verified', 'all_data_catalog_ledger_writers_and_manifest_rolled_back'}
    assert set(proof) == flags | {'kind', 'phase', 'passed', 'manifest_version', 'manifest_functions', 'manifest_relations',
        'selected_data_schemas', 'catalog_schema', 'data_relation_count', 'private_baseline_sha256', 'ledger_present', 'ledger_rows', 'refusal_count', 'outcomes', 'hosted_writes', 'clinical_or_register_activation'}
    assert proof['kind'] == 'controlled-column-acl-seal-v1' and proof['phase'] in ('installed', 'populated_restore') and proof['passed'] is True
    for key, expected in [('manifest_version', 2), ('manifest_functions', 171), ('manifest_relations', 51), ('refusal_count', 6), ('hosted_writes', 0)]:
        assert type(proof[key]) is int and proof[key] == expected
    assert type(proof['ledger_present']) is bool and type(proof['ledger_rows']) is int
    assert proof['ledger_rows'] == (204 if proof['ledger_present'] else 0)
    assert proof['phase'] != 'installed' or proof['ledger_present'] is True
    assert type(proof['data_relation_count']) is int and proof['data_relation_count'] > 0
    assert proof['selected_data_schemas'] == SCHEMAS and proof['catalog_schema'] == 'public'
    assert isinstance(proof['private_baseline_sha256'], str) and HEX.fullmatch(proof['private_baseline_sha256'])
    assert all(proof[key] is True for key in flags) and proof['clinical_or_register_activation'] is False
    assert isinstance(proof['outcomes'], list) and len(proof['outcomes']) == len(CASES)
    for outcome, (label, relation, column, grantee, option) in zip(proof['outcomes'], CASES):
        assert outcome == {'case': label, 'relation': relation, 'column': column, 'grantee': grantee,
            'grant_option_checked': option, 'grant_option_only_metadata_flip_observed': option, 'expected_table_select': grantee == 'owner',
            'actual_direct_acl_and_effective_column_select_observed': True, 'stored_manifest_unchanged_before_refusal': True,
            'armed_before_refusal': True, 'sqlstate': '23514', 'error': MESSAGE, 'exact_full_rollback': True}
        for key in ('grant_option_checked', 'grant_option_only_metadata_flip_observed', 'expected_table_select', 'actual_direct_acl_and_effective_column_select_observed', 'stored_manifest_unchanged_before_refusal', 'armed_before_refusal', 'exact_full_rollback'):
            assert type(outcome[key]) is bool
    return proof
