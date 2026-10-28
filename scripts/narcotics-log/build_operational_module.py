"""Source-only operational-module assembly; reference DDL supplies expectations."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import sys

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE))
from sql_framing import split_reviewed_statements

REGISTER = 'narcotics_register_v1'
RECOVERY = 'narcotics_recovery_v1'
REFERENCE_REGISTER = 'narcotics_register_reference_v1'
REFERENCE_RECOVERY = 'narcotics_recovery_reference_v1'
MIGRATION = '20261028044922_narcotics_register_exports_and_recovery.sql'
SOURCE = HERE / 'operational-module'
REGISTER_APIS = {
    'create_narcotics_register_v1': "narcotics_register_v1.create_report(p_request)",
    'read_narcotics_register_v1': "narcotics_register_v1.read_operation(p_request,'report')",
    'close_narcotics_register_operation_v1': "narcotics_register_v1.close_operation(p_request)",
    'preserve_narcotics_form_v1': "narcotics_register_v1.preserve_form(p_request)",
    'read_narcotics_form_operation_v1': "narcotics_register_v1.read_operation(p_request,'form')",
    'download_narcotics_form_v1': "narcotics_register_v1.download_form(p_request)",
}
LEAVES = {
    'narcotics_register_v1.enter_register()': ('plpgsql', 'v', 'void'),
    'narcotics_register_v1.require_module()': ('plpgsql', 'v', 'void'),
    'narcotics_register_v1.module_properties(text,text,text,text)': ('plpgsql', 's', 'jsonb'),
    'narcotics_register_v1.hash(text,jsonb)': ('sql', 'i', 'text'),
}


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def literal(value):
    return "'" + value.replace("'", "''") + "'"


def functions(sql):
    result = {}
    for statement in split_reviewed_statements(sql):
        header = re.match(r'^CREATE(?: OR REPLACE)? FUNCTION ([a-z0-9_]+)\.([a-z0-9_]+)\(([^)]*)\)', statement, re.I)
        if not header:
            continue
        types = []
        for parameter in header[3].split(',') if header[3].strip() else []:
            parsed = re.fullmatch(r'\s*[a-z0-9_]+\s+([a-z0-9_.]+(?:\[\])?)\s*', parameter, re.I)
            if not parsed:
                raise ValueError('Closed source parameter grammar required')
            types.append(parsed[1])
        signature = header[1] + '.' + header[2] + '(' + ','.join(types) + ')'
        body = re.search(r'\bAS\s+(\$[a-zA-Z0-9_]*\$)(.*?)\1\s*;?$', statement, re.I | re.S)
        if not body or signature in result:
            raise ValueError('Exactly one bounded source body per signature required')
        result[signature] = {'statement': statement, 'body': body[2], 'schema': header[1], 'name': header[2]}
    return result


def terminal_count_copy():
    sql = (ROOT / 'supabase/migrations/20261027223544_narcotics_count_and_stock_workflows.sql').read_text()
    selected = [statement for statement in split_reviewed_statements(sql)
        if re.match(r'^CREATE(?: OR REPLACE)? FUNCTION public\.read_controlled_count_v1\(', statement, re.I)]
    if len(selected) != 1:
        raise ValueError('Exactly one original public count READ required')
    original = functions(selected[0] + ';')['public.read_controlled_count_v1(jsonb)']
    wanted = json.loads((HERE / 'module-expected.json').read_text())['properties']['functions']['public.read_controlled_count_v1(jsonb)']['body_sha256']
    if sha(original['body'].encode()) != wanted:
        raise ValueError('Independently source-bound count READ body required')
    check = ' perform controlled_count_entry_v1.require_bound_module();'
    if original['body'].count(check) != 1:
        raise ValueError('Exactly one redundant outer module check required')
    body = original['body'].replace(check, '', 1)
    # The exact original full metadata check lives in this facade's admission.
    position = original['body'].index(check)
    if body[:position] + check + body[position:] != original['body']:
        raise ValueError('Whole original count READ body inverse failed')
    program = '''CREATE FUNCTION narcotics_register_v1.read_terminal_count(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,public,controlled_count_v1,controlled_count_entry_v1,pg_temp
SET timezone='UTC' SET datestyle='ISO,YMD' SET intervalstyle='postgres' SET extra_float_digits=3 AS $$''' + body + '$$;\n'
    return program, {'original_body_sha256': wanted, 'copy_body_sha256': sha(body.encode()),
        'whole_body_inverse': True, 'only_removed_statement': check, 'current_authorization_and_projector_unchanged': True}


def cold_admission(all_functions):
    rows = []
    for signature, (language, volatility, result) in LEAVES.items():
        value = all_functions[signature]
        rows.append('(' + ','.join(map(literal, (signature, sha(value['body'].encode()), language, volatility, result))) + ')')
    return '''
 IF session_user<>'authenticator' OR current_user<>'postgres' OR pg_my_temp_schema()<>0
 OR current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF (SELECT count(*) FROM pg_namespace WHERE nspname IN ('narcotics_register_v1','narcotics_recovery_v1') AND nspowner='postgres'::regrole)<>2
 OR EXISTS(SELECT 1 FROM pg_namespace n CROSS JOIN(values('anon'),('authenticated'),('service_role'))r(role_name)
 WHERE n.nspname IN('narcotics_register_v1','narcotics_recovery_v1') AND(has_schema_privilege(r.role_name,n.oid,'USAGE') OR has_schema_privilege(r.role_name,n.oid,'CREATE'))) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF EXISTS(WITH expected(signature,body_hash,language,volatility,result_type) AS(values
''' + ',\n'.join(rows) + ''') SELECT 1 FROM expected e LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature)
 LEFT JOIN pg_language l ON l.oid=p.prolang WHERE p.oid IS NULL OR p.proowner<>'postgres'::regrole OR p.prosecdef OR p.prokind<>'f'
 OR p.proretset OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u' OR p.provariadic<>0 OR p.prosupport<>0
 OR p.pronargdefaults<>0 OR p.prosqlbody IS NOT NULL OR l.lanname<>e.language OR p.provolatile::text<>e.volatility
 OR format_type(p.prorettype,NULL)<>e.result_type OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
 OR encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')<>e.body_hash
 OR EXISTS(SELECT 1 FROM(values('anon'),('authenticated'),('service_role'))r(role_name) WHERE has_function_privilege(r.role_name,p.oid,'EXECUTE'))) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='narcotics_register_v1' AND c.relname='descriptor' AND c.relowner='postgres'::regrole AND c.relkind='r' AND c.relrowsecurity AND NOT c.relforcerowsecurity AND NOT c.relispartition) THEN
 RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='42501',DETAIL='',HINT='';END IF;
 PERFORM narcotics_register_v1.enter_register();
'''


def facade(name, call, admission, engineering=False):
    declaration = 'DECLARE diagnostic_context text;\n' if engineering else ''
    handler = """EXCEPTION WHEN SQLSTATE 'PT413' THEN RAISE EXCEPTION 'narcotics_capacity_exceeded' USING ERRCODE='PT413',DETAIL='',HINT='';
 WHEN SQLSTATE 'PT409' THEN RAISE EXCEPTION 'narcotics_request_closed_or_unavailable' USING ERRCODE='PT409',DETAIL='',HINT='';
 WHEN OTHERS OR query_canceled OR assert_failure THEN RAISE EXCEPTION 'narcotics_request_failed' USING ERRCODE='P0001',DETAIL='',HINT='';"""
    if engineering:
        handler = """EXCEPTION WHEN OTHERS OR query_canceled OR assert_failure THEN
 GET STACKED DIAGNOSTICS diagnostic_context=PG_EXCEPTION_CONTEXT;
 RAISE EXCEPTION USING ERRCODE=SQLSTATE,MESSAGE=SQLERRM,DETAIL=diagnostic_context,HINT='';"""
    return 'CREATE FUNCTION public.' + name + """(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog SET quote_all_identifiers=false
SET timezone='UTC' SET datestyle='ISO,YMD' SET intervalstyle='postgres' SET extra_float_digits=3
SET statement_timeout='8s' SET lock_timeout='5s' AS $$
""" + declaration + 'BEGIN\n' + admission + '\n RETURN ' + call + ';\n' + handler + '\nEND $$;\n'


def table_controls(program):
    result = []
    for statement in split_reviewed_statements(program):
        match = re.match(r'^CREATE TABLE (narcotics_(?:register|recovery)_v1)\.([a-z0-9_]+)\s*\(', statement, re.I)
        if not match:
            continue
        table = match[1] + '.' + match[2]
        result += ['ALTER TABLE ' + table + ' OWNER TO postgres;', 'ALTER TABLE ' + table + ' ENABLE ROW LEVEL SECURITY;',
            'REVOKE ALL ON TABLE ' + table + ' FROM PUBLIC,anon,authenticated,service_role;',
            'CREATE TRIGGER history_immutable BEFORE UPDATE OR DELETE ON ' + table + ' FOR EACH ROW EXECUTE FUNCTION narcotics_register_v1.reject_history_change();',
            'CREATE TRIGGER no_truncate BEFORE TRUNCATE ON ' + table + ' FOR EACH STATEMENT EXECUTE FUNCTION narcotics_register_v1.reject_history_change();']
    return '\n'.join(result) + '\n'


def build(register_only=False):
    if not register_only:
        raise ValueError('Recovery source and full release assembly are not complete')
    names = ('common.sql', 'register.sql', 'register-operations.sql', 'metadata.sql')
    sources = {name: (SOURCE / name).read_bytes() for name in names}
    public_names = 'ARRAY[' + ','.join(literal(name) for name in sorted(REGISTER_APIS)) + ']::text[]'
    private = '\n'.join(raw.decode().replace('__PUBLIC_FACADE_NAMES__', public_names) for raw in sources.values())
    copied, copy_proof = terminal_count_copy()
    private += '\n' + copied
    admission = cold_admission(functions(private))
    actual = private + '\n' + '\n'.join(facade(name, call, admission, engineering=register_only) for name, call in REGISTER_APIS.items())
    actual += table_controls(actual)
    definitions = functions(actual)
    for signature in definitions:
        actual += 'ALTER FUNCTION ' + signature + ' OWNER TO postgres;\nREVOKE ALL ON FUNCTION ' + signature + ' FROM PUBLIC,anon,authenticated,service_role;\n'
    for name in REGISTER_APIS:
        actual += 'GRANT EXECUTE ON FUNCTION public.' + name + '(jsonb) TO authenticated;\n'
    reference = actual.replace(REGISTER + '.', REFERENCE_REGISTER + '.').replace(RECOVERY + '.', REFERENCE_RECOVERY + '.')
    # Schema literals in reflective helper bodies are normalized by its explicit
    # canonical parameters. Source namespace identifiers are changed everywhere.
    reference = reference.replace("'" + REGISTER + "'", "'" + REFERENCE_REGISTER + "'").replace("'" + RECOVERY + "'", "'" + REFERENCE_RECOVERY + "'")
    reference = reference.replace('SCHEMA ' + REGISTER + ' ', 'SCHEMA ' + REFERENCE_REGISTER + ' ').replace('SCHEMA ' + RECOVERY + ' ', 'SCHEMA ' + REFERENCE_RECOVERY + ' ')
    reference = reference.replace('SCHEMA ' + REGISTER + ',' + RECOVERY, 'SCHEMA ' + REFERENCE_REGISTER + ',' + REFERENCE_RECOVERY)
    # Only statement headers and grants target the private copies of facades.
    # Literal public callback names inside function bodies remain unchanged.
    chunks = []
    for statement in split_reviewed_statements(reference):
        for name in REGISTER_APIS:
            statement = re.sub(r'^(CREATE FUNCTION|ALTER FUNCTION|REVOKE ALL ON FUNCTION|GRANT EXECUTE ON FUNCTION) public\.' + re.escape(name) + r'\(', r'\1 ' + REFERENCE_REGISTER + '.' + name + '(', statement)
        chunks.append(statement + ';')
    reference = '\n'.join(chunks) + '\n'
    tail = '''DO $operational_source$DECLARE expected jsonb;actual jsonb;differences jsonb;BEGIN
 expected:=narcotics_register_reference_v1.module_properties('narcotics_register_reference_v1','narcotics_recovery_reference_v1','narcotics_register_v1','narcotics_recovery_v1');
 actual:=narcotics_register_v1.module_properties('narcotics_register_v1','narcotics_recovery_v1','narcotics_register_v1','narcotics_recovery_v1');
 IF actual IS DISTINCT FROM expected THEN
  WITH RECURSIVE delta(path,before_value,after_value)AS(
   SELECT '$',expected,actual
   UNION ALL
   SELECT d.path||'.'||k.key,d.before_value->k.key,d.after_value->k.key
   FROM delta d CROSS JOIN LATERAL jsonb_object_keys(CASE WHEN jsonb_typeof(d.before_value)='object'AND jsonb_typeof(d.after_value)='object' THEN d.before_value||d.after_value ELSE '{}'::jsonb END)k(key)
   WHERE d.before_value IS DISTINCT FROM d.after_value)
  SELECT jsonb_agg(jsonb_build_object('path',path,'expected',left(before_value::text,256),'actual',left(after_value::text,256)))INTO differences
  FROM(SELECT *FROM delta WHERE before_value IS DISTINCT FROM after_value
   AND(jsonb_typeof(before_value)IS DISTINCT FROM'object'OR jsonb_typeof(after_value)IS DISTINCT FROM'object')ORDER BY path LIMIT 20)leaf;
  RAISE EXCEPTION 'narcotics_source_properties_differ' USING ERRCODE='23514',DETAIL=coalesce(differences::text,'bounded source property difference');
 END IF;
 INSERT INTO narcotics_register_v1.descriptor VALUES(1,expected,narcotics_register_v1.hash('narcotics-operational-module-v1',expected));
END $operational_source$;
DROP SCHEMA narcotics_register_reference_v1,narcotics_recovery_reference_v1 CASCADE;
DO $operational_installed$BEGIN
 PERFORM narcotics_register_v1.require_module();
 PERFORM controlled_count_entry_v1.require_bound_module();
END $operational_installed$;
'''
    prefix = "SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';SET LOCAL quote_all_identifiers=false;SET LOCAL TimeZone='UTC';SET LOCAL DateStyle='ISO,YMD';SET LOCAL IntervalStyle='postgres';SET LOCAL extra_float_digits=3;\nSELECT pg_advisory_xact_lock(90271040,0);\nDO $operational_parent$BEGIN PERFORM controlled_count_entry_v1.require_bound_module();END $operational_parent$;\n"
    sql = prefix + actual + reference + tail
    proof = {'kind': 'narcotics-operational-source-draft-v1', 'engineering_only': True, 'ready_for_deployment': False,
        'expected_metadata_origin': 'independent empty source reference DDL; no observed actual target expectations',
        'native_errors_engineering_only': register_only,
        'source_files': {name: {'bytes': len(raw), 'sha256': sha(raw)} for name, raw in sources.items()},
        'builder_sha256': sha(Path(__file__).read_bytes()), 'terminal_count_copy': copy_proof,
        'public_apis': sorted(REGISTER_APIS), 'function_signatures': sorted(definitions),
        'sql': {'bytes': len(sql.encode()), 'sha256': sha(sql.encode())}}
    return sql, proof


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--register-only-engineering', action='store_true')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if not args.register_only_engineering or not args.output.is_absolute() or args.output.exists():
        parser.error('Explicit engineering-only source output in a fresh absolute directory required')
    sql, proof = build(register_only=True)
    args.output.mkdir(mode=0o700)
    (args.output / 'install.sql').write_text(sql)
    (args.output / 'source-proof.json').write_text(json.dumps(proof, sort_keys=True, indent=2) + '\n')
    print(json.dumps({'engineering_only': True, 'database_operations': 0, 'sql': proof['sql'], 'public_apis': proof['public_apis']}))
