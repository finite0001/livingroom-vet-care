"""Finite selected-object ownership/ACL preservation for an owned clone only.

The same cluster already supplies roles and memberships. This does not claim a
role/default-ACL backup or restore Storage bytes. No privilege repair is allowed.
"""

SCOPES=('public','auth','storage','extensions','supabase_migrations','controlled_review')
OWNERS={'postgres','supabase_admin','supabase_auth_admin','supabase_storage_admin','pg_database_owner'}

# Raw ACL text names roles (including grantors), so it is stable across databases.
# Preserve NULL separately from an explicit ACL; do not normalize away a mismatch.
MAP_SQL=r"""
with namespaces as(select * from pg_namespace where nspname in
 ('public','auth','storage','extensions','supabase_migrations','controlled_review')),
objects as(
 select 'schema' kind,n.nspname::text identity,pg_get_userbyid(n.nspowner) owner,
  n.nspacl acl,null::jsonb detail,'pg_namespace'::regclass classid,n.oid objid from namespaces n
 union all
 select 'relation:'||c.relkind::text,n.nspname||'.'||c.relname,pg_get_userbyid(c.relowner),c.relacl,
  jsonb_build_object('columns',(select coalesce(jsonb_object_agg(a.attname,
   case when a.attacl is null then null else (select jsonb_agg(x::text order by x::text)from unnest(a.attacl)x)end),'{}')
   from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped)),
  'pg_class'::regclass,c.oid from pg_class c join namespaces n on n.oid=c.relnamespace
 union all
 select 'function:'||p.prokind::text,format('%I.%I(%s)',n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)),
  pg_get_userbyid(p.proowner),p.proacl,null::jsonb,'pg_proc'::regclass,p.oid
  from pg_proc p join namespaces n on n.oid=p.pronamespace
 union all
 select 'type:'||t.typtype::text,n.nspname||'.'||t.typname,pg_get_userbyid(t.typowner),t.typacl,
  jsonb_build_object('generated',t.typrelid<>0 or t.typelem<>0),'pg_type'::regclass,t.oid
  from pg_type t join namespaces n on n.oid=t.typnamespace
), entries as(select kind,identity,owner,
 case when acl is null then null else (select jsonb_agg(x::text order by x::text)from unnest(acl)x)end acl,
 detail,(select e.extname from pg_depend d join pg_extension e on e.oid=d.refobjid
 where d.classid=objects.classid and d.objid=objects.objid and d.refclassid='pg_extension'::regclass and d.deptype='e') extension
 from objects)
select jsonb_build_object('entries',(select jsonb_agg(to_jsonb(x)order by kind,identity)from entries x),
 'extensions',(select jsonb_agg(jsonb_build_object('name',e.extname,'owner',pg_get_userbyid(e.extowner),
 'schema',n.nspname,'version',e.extversion)order by e.extname)from pg_extension e join namespaces n on n.oid=e.extnamespace));
"""

LONG_FUNCTIONS_SQL=r"""select jsonb_build_object('identities',jsonb_agg(identity order by identity))from
 (select format('%I.%I(%s)',n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)) identity
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in
 ('public','auth','storage','extensions','supabase_migrations','controlled_review'))x where length(identity)>63;"""


def verify_long_identities(value,expected):
    assert expected['identities'],'Pinned fixture must exercise identities longer than PostgreSQL name'
    actual=sorted(x['identity']for x in value['entries']if x['kind'].startswith('function:')and len(x['identity'])>63)
    assert actual==sorted(expected['identities']),'Catalog map lost full function signature identities'


def admitted(value):
    allowed={'schema',*[f'relation:{k}'for k in ('r','p','i','I','S','v','m','c')],
             'function:f',*[f'type:{k}'for k in ('b','c','d','e','p')]}
    assert set(value)=={'entries','extensions'}
    assert len({(x['kind'],x['identity'])for x in value['entries']})==len(value['entries'])
    for entry in value['entries']:
        assert entry['kind']in allowed and entry['owner']in OWNERS,entry
        assert entry['identity'].split('.')[0].strip('"')in SCOPES,entry
        if entry['identity'].startswith('auth.')or entry['identity']=='auth':
            assert entry['extension']is None,'Auth must not contain extension-owned objects'
    for extension in value['extensions']:
        assert extension['owner']in OWNERS and extension['schema']in SCOPES
    return value


def extension_bootstrap(source):
    extensions={x['name']:x for x in source['extensions']}
    schemas=[x for x in source['entries']if x['kind']=='schema'and x['identity']=='extensions']
    assert len(schemas)==1 and schemas[0]['owner']in OWNERS
    schema_owner='"'+schemas[0]['owner'].replace('"','""')+'"'
    statements=['drop schema public;create schema extensions authorization '+schema_owner+';']
    for name in ('pgcrypto','uuid-ossp'):
        extension=extensions[name]
        assert extension['schema']=='extensions'
        # Both identifiers come from the finite allowlist above, quoted nonetheless.
        owner='"'+extension['owner'].replace('"','""')+'"'
        quoted='"'+name.replace('"','""')+'"'
        statements+=['set local role '+owner+';create extension '+quoted+' with schema extensions;reset role;']
    return 'begin;'+''.join(statements)+'commit;'


def auth_entries(value):
    return [entry for entry in value['entries']
            if entry['identity']=='auth' or entry['identity'].startswith('auth.')]


def differences(source,restored):
    before={(x['kind'],x['identity']):x for x in source['entries']}
    after={(x['kind'],x['identity']):x for x in restored['entries']}
    return [{'kind':key[0],'identity':key[1],'source':before.get(key),'clone':after.get(key)}
            for key in sorted(before.keys()|after.keys()) if before.get(key)!=after.get(key)]
