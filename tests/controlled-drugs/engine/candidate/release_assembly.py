"""Build/check an offline private C1b artifact against a separately reviewed pin.

No database, Docker, hosted installation, policy seed or commissioning operation
is performed by this module. The original development assembler remains intact.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re

from local_install import build_install, FINALIZE_SQL
from derive_column_acl_pin import PARENT_PIN_SHA256, validate_column_acl_manifest

PIN_NAME = 'release-expected-204.json'
# Set only after independent provenance review; never derive trust at runtime.
REVIEWED_PIN_SHA256 = '4755a1f1c53008003a11e94ada3963ae416f6c81f163ec43ed2ffea21d6d2f78'
PIN_KIND = 'controlled-stock-release-expected-204-v2'
PARENT_PIN_NAME = 'release-expected-204-v1.json'
ASSEMBLED_NAMES = ('schema', 'helpers', 'effects', 'review', 'posting', 'scalar-helpers',
                   'opening', 'constraints', 'entry', 'protocol', 'guards', 'seal')
ENTRY_NAMES = ('read_controlled_stock_action', 'prepare_controlled_stock_action',
               'execute_controlled_stock_action', 'cancel_controlled_stock_action')
MARKERS = {name: '-- CONTROLLED_RELEASE_' + name + ' --' for name in
           ('BEFORE_PREFLIGHT', 'AFTER_SCHEMA', 'AFTER_HOOKS', 'BEFORE_POSTCHECK', 'BEFORE_COMMIT')}
MESSAGES = {'ledger': 'Controlled release migration ledger mismatch',
            'partial': 'Controlled release partial engine exists',
            'prior': 'Controlled upgrade prior definitions or grants drifted; review required',
            'installed': 'Controlled release installed metadata differs from reviewed artifact',
            'writers': 'Controlled release canonical writer definitions changed',
            'empty': 'Controlled release must not seed policy opening or activation data',
            'private': 'Controlled release private access or RLS changed'}


# Effective application-role privileges include inherited grants and column ACLs.
# PUBLIC is the ACL pseudo-grantee zero, not a login role to impersonate.
# Fresh private columns have no reviewed grant to any non-owner role.
PRIVATE_ACCESS_PREDICATE_SQL = """not exists(
 select 1 from pg_proc p where p.pronamespace='public'::regnamespace
 and(left(p.proname,17)='controlled_stock_'or p.proname in('read_controlled_stock_action','prepare_controlled_stock_action','execute_controlled_stock_action','cancel_controlled_stock_action'))and(
 exists(select 1 from unnest(array['anon','authenticated','service_role'])role_name
  where has_function_privilege(role_name,p.oid,'EXECUTE'))
 or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))a where a.grantee=0)))
 and not exists(select 1 from pg_class c where c.relnamespace='public'::regnamespace
 and c.relkind in('r','p')and left(c.relname,17)='controlled_stock_'and(
 not c.relrowsecurity
 or exists(select 1 from unnest(array['anon','authenticated','service_role'])role_name
  where has_table_privilege(role_name,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
   or has_any_column_privilege(role_name,c.oid,'SELECT,INSERT,UPDATE,REFERENCES'))
 or exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner)))a where a.grantee=0)
 or exists(select 1 from pg_attribute col cross join lateral aclexplode(col.attacl)a
  where col.attrelid=c.oid and col.attnum>0 and not col.attisdropped and a.grantee<>c.relowner)))"""


def _sha(data):
    return hashlib.sha256(data).hexdigest()


def _literal(value):
    return "'" + value.replace("'", "''") + "'"


def _json(value):
    return _literal(json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False)) + '::jsonb'


def _unique(pairs):
    result = {}
    for key, value in pairs:
        assert key not in result, 'Duplicate reviewed release field'
        result[key] = value
    return result


def _hash_map(value, count):
    assert isinstance(value, dict) and len(value) == count
    assert all(isinstance(name, str) and isinstance(digest, str) and
               re.fullmatch(r'[0-9a-f]{64}', digest) for name, digest in value.items())


def assembled_sources(source):
    source = Path(source)
    return [source / (name + '.sql') for name in ASSEMBLED_NAMES] + [
        source.parent / 'source-reader.sql', source.parent / 'source-effects.sql']


def _read_pin(source, files):
    root = source.parents[3]
    assert _sha((source / PARENT_PIN_NAME).read_bytes()) == PARENT_PIN_SHA256, 'Released286 parent pin changed'
    raw = (source / PIN_NAME).read_bytes()
    assert _sha(raw) == REVIEWED_PIN_SHA256, 'Independently reviewed release pin changed'
    pin = json.loads(raw, object_pairs_hook=_unique)
    assert isinstance(pin, dict) and set(pin) == {
        'kind', 'baseline_migration_count', 'canonical_migration_hashes', 'assembled_sql_hashes',
        'prior_snapshot_sql_sha256', 'trusted_prior189_sha256',
        'expected_technical_manifest', 'canonical_writer_definition_hashes'}
    assert pin['kind'] == PIN_KIND and type(pin['baseline_migration_count']) is int and pin['baseline_migration_count'] == 204
    assert len(files) == 204 and len({path.name for path in files}) == 204
    assert [path.name for path in files] == sorted(path.name for path in files), 'Ordered exact migration prefix required'
    _hash_map(pin['canonical_migration_hashes'], 204)
    actual_migrations = {path.name: _sha(path.read_bytes()) for path in files}
    assert actual_migrations == pin['canonical_migration_hashes'], 'Reviewed release migration source prefix changed'
    paths = assembled_sources(source)
    _hash_map(pin['assembled_sql_hashes'], 14)
    actual_sources = {str(path.relative_to(root)): _sha(path.read_bytes()) for path in paths}
    assert actual_sources == pin['assembled_sql_hashes'], 'Reviewed release assembly source changed'
    assert _sha((source / 'prior-snapshot.sql').read_bytes()) == pin['prior_snapshot_sql_sha256']
    assert _sha((source / 'trusted-prior-189.json').read_bytes()) == pin['trusted_prior189_sha256']
    expected = pin['expected_technical_manifest']
    assert isinstance(expected, dict) and set(expected) == {'version', 'functions', 'relations'}
    assert type(expected['version']) is int and expected['version'] == 2
    validate_column_acl_manifest(expected)
    assert isinstance(expected['functions'], dict) and len(expected['functions']) == 171
    assert isinstance(expected['relations'], dict) and len(expected['relations']) == 51
    _hash_map(pin['canonical_writer_definition_hashes'], 10)
    hashes = {str(path.relative_to(root)): _sha(path.read_bytes()) for path in files + paths}
    for name in ('prior-snapshot.sql', 'trusted-prior-189.json'):
        hashes[str((source / name).relative_to(root))] = _sha((source / name).read_bytes())
    hashes[str((source / PIN_NAME).relative_to(root))] = _sha(raw)
    hashes[str((source / PARENT_PIN_NAME).relative_to(root))] = PARENT_PIN_SHA256
    return pin, hashes, _sha(raw)


def _runtime_preflight(versions):
    entries = ','.join(_literal(name) for name in ENTRY_NAMES)
    return MARKERS['BEFORE_PREFLIGHT'] + '\n' + """do $release_preflight$begin
 if (select coalesce(jsonb_agg(version order by version),'[]'::jsonb)from supabase_migrations.schema_migrations)
  is distinct from """ + _json(versions) + """ then
  raise exception '""" + MESSAGES['ledger'] + """' using errcode='23514';end if;
 if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public'and left(c.relname,17)='controlled_stock_')
 or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'and(left(p.proname,17)='controlled_stock_'or p.proname in(""" + entries + """)))
 or exists(select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public'and left(t.tgname,17)='controlled_stock_')then
  raise exception '""" + MESSAGES['partial'] + """' using errcode='23514';end if;
end $release_preflight$;
"""


def _finalize(pin):
    expected = _json(pin['expected_technical_manifest'])
    writers = _json(pin['canonical_writer_definition_hashes'])
    return """do $release_revoke$declare r record;begin
 for r in select p.oid::regprocedure signature from pg_proc p where p.pronamespace='public'::regnamespace
 and(left(p.proname,17)='controlled_stock_'or p.proname in('read_controlled_stock_action','prepare_controlled_stock_action','execute_controlled_stock_action','cancel_controlled_stock_action'))loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',r.signature);end loop;
end $release_revoke$;
""" + MARKERS['BEFORE_POSTCHECK'] + """
do $release_finalize$declare r record;n bigint;begin
 if controlled_stock_manifest_snapshot()is distinct from """ + expected + """ then
  raise exception '""" + MESSAGES['installed'] + """'using errcode='23514';end if;
 if (select jsonb_object_agg(signature,encode(sha256(convert_to(pg_get_functiondef(to_regprocedure(signature)),'UTF8')),'hex'))from stock_writer_manifests)
  is distinct from """ + writers + """ then
  raise exception '""" + MESSAGES['writers'] + """'using errcode='23514';end if;
 if not(""" + PRIVATE_ACCESS_PREDICATE_SQL + """)then
  raise exception '""" + MESSAGES['private'] + """'using errcode='23514';end if;
 for r in select c.oid::regclass relation from pg_class c where c.relnamespace='public'::regnamespace
 and c.relkind='r'and left(c.relname,17)='controlled_stock_'loop
 execute format('select count(*)from %s',r.relation)into n;
 if n<>0 then raise exception '""" + MESSAGES['empty'] + """'using errcode='23514';end if;end loop;
 insert into controlled_stock_engine_manifests(revision,definition,definition_hash)
 values(1,""" + expected + ",controlled_stock_hash(" + expected + """));
end $release_finalize$;
select controlled_stock_manifest_required();
""" + MARKERS['BEFORE_COMMIT'] + '\ncommit;\n'


def build_release(source, files):
    """Return deterministic offline SQL; reject every changed reviewed input."""
    source = Path(source).resolve()
    files = [Path(path).resolve() for path in files]
    pin, inputs, pin_sha = _read_pin(source, files)
    bundle = build_install(source, files)
    install = bundle['install']
    barrier = bundle['barrier']
    assert install.startswith(barrier) and install.count(FINALIZE_SQL) == 1
    # No comments or setup statements precede BEGIN and the exclusive barrier.
    install = barrier + _runtime_preflight([path.name.split('_', 1)[0] for path in files]) + install[len(barrier):]
    for name, marker in [('schema', 'AFTER_SCHEMA'), ('seal', 'AFTER_HOOKS')]:
        part = (source / (name + '.sql')).read_text().replace('set search_path=public,pg_temp as $$', "set search_path=public,pg_temp set timezone='UTC' as $$")
        assert install.count(part) == 1, 'Exact assembly phase required'
        install = install.replace(part, part + '\n' + MARKERS[marker] + '\n', 1)
    install = install.replace(FINALIZE_SQL, _finalize(pin), 1)
    assert all(install.count(marker) == 1 for marker in MARKERS.values())
    assert 'd:=controlled_stock_manifest_snapshot();' not in install, 'Runtime manifest adoption forbidden'
    return {'install': install, 'artifact_sha256': _sha(install.encode()), 'pin_sha256': pin_sha,
            'input_source_hashes': inputs, 'runtime_preflight_messages': dict(MESSAGES),
            'expected_manifest': pin['expected_technical_manifest'],
            'expected_writer_hooks': pin['canonical_writer_definition_hashes']}


def check_release_artifact(source, files, artifact):
    release = build_release(source, files)
    assert Path(artifact).read_bytes() == release['install'].encode(), 'Frozen controlled-stock artifact differs'
    return release


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--check', action='store_true')
    mode.add_argument('--write', action='store_true')
    args = parser.parse_args()
    source = Path(__file__).resolve().parent
    root = source.parents[3]
    release = build_release(source, sorted((root / 'supabase/migrations').glob('*.sql')))
    artifact = source.parent / 'release/controlled-stock-private.sql'
    if args.check:
        check_release_artifact(source, sorted((root / 'supabase/migrations').glob('*.sql')), artifact)
    else:
        artifact.parent.mkdir(parents=True, exist_ok=True)
        artifact.write_bytes(release['install'].encode())
    print(json.dumps({'kind': 'controlled-stock-release-artifact-v1', 'artifact_sha256': release['artifact_sha256'],
                      'pin_sha256': release['pin_sha256'], 'hosted_writes': 0, 'database_operations': 0}))


if __name__ == '__main__':
    main()
