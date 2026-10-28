"""Exact209 source admission; installation is separate and explicitly owned."""
import hashlib
import json
from pathlib import Path
import copy
import sys
import time

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
sys.path.insert(0,str(HERE))
import build_operational_module as builder
import prefix_view as prefix
import bounded_process

BANNER=b'-- Reviewed operational source candidate; runtime acceptance and release approval are required.\n'
MIGRATION='20261028170038_narcotics_register_exports_and_recovery.sql'
PARSER_SHA='28bcd6a27b93fb7a31c3e20519b5ebb6540737b26e2f333e3f44cb3340327884'
TYPESCRIPT_SHA='dd17428736a07e1db1a138d8a14295ddb2699ba780ee15038acdd2c6da5373a0'
SOURCE_NAMES=(
    'build_operational_module.py','recovery_admission_source.py','sql_framing.py',
    'policy-reuse-controls.sql','boundary-reuse-controls.sql',
    'operational-cli-origin.json','operational-source-proof.json',
    'operational_release.py','frame-operational.mjs','frame-cli.mjs',
    'operational-module/common.sql','operational-module/register.sql',
    'operational-module/register-operations.sql','operational-module/recovery-state.sql',
    'operational-module/recovery-operations.sql','operational-module/recovery-inventory.sql',
    'operational-module/recovery-coordinator.sql','operational-module/recovery-evidence.sql',
    'operational-module/recovery-release.sql','operational-module/recovery-status.sql',
    'operational-module/metadata.sql','operational-module/recovery-gateway.sql',
)


def sha(raw):return hashlib.sha256(raw).hexdigest()


def program():
    sql,proof=builder.build(register_only=False)
    gateway=prefix.regular(builder.SOURCE/'recovery-gateway.sql')
    raw=BANNER+sql.encode()+b'\n'+gateway
    return raw,dict(module=proof,gateway=dict(bytes=len(gateway),sha256=sha(gateway)),migration=builder.MIGRATION,
                    compound_sql=dict(bytes=len(raw),sha256=sha(raw)),database_operations=0)


def admit(*,timeout=30):
    deadline=time.monotonic()+timeout
    manifest=json.loads(prefix.regular(HERE/'operational-release.json'))
    if set(manifest)!={'kind','cli_version','prefix_migration_count','migration_count','migration',
            'framing','source_files','parser_provenance_sha256','typescript_sha256','database_operations'}:
        raise ValueError('Closed operational209 source manifest required')
    if manifest.get('kind')!='narcotics-operational-cli209-source-v1'or manifest.get('cli_version')!='2.118.0'or manifest.get('prefix_migration_count')!=208 or manifest.get('migration_count')!=209 or manifest.get('database_operations')!=0:
        raise ValueError('Exact operational209 source manifest required')
    name=manifest.get('migration')
    if name!=MIGRATION or name!=builder.MIGRATION:
        raise ValueError('Exact official CLI-created209 name required')
    origin=json.loads(prefix.regular(HERE/'operational-cli-origin.json'))
    if origin!=dict(kind='official-cli-created-operational-migration-v1',cli_version='2.118.0',
            creation_command=['supabase','migration','new','narcotics_register_exports_and_recovery'],
            migration=MIGRATION,original_created_file_bytes=0):
        raise ValueError('Exact original CLI creation receipt required')
    if manifest['parser_provenance_sha256']!=PARSER_SHA or manifest['typescript_sha256']!=TYPESCRIPT_SHA:
        raise ValueError('Pinned official CLI parser and TypeScript provenance required')
    if set(manifest['source_files'])!={'scripts/narcotics-log/'+name for name in SOURCE_NAMES}:
        raise ValueError('Exact transitive operational source inventory required')
    expected,proof=program()
    if prefix.regular(ROOT/'supabase/migrations'/name)!=expected or json.loads(prefix.regular(HERE/'operational-source-proof.json'))!=proof:
        raise ValueError('Operational migration differs from independently assembled release source')
    if proof['module']['engineering_only']or proof['module']['native_errors_engineering_only']:
        raise ValueError('Production source cannot include engineering error handlers')
    if set(proof['module']['public_apis'])!=set(builder.REGISTER_APIS)|set(builder.RECOVERY_APIS):
        raise ValueError('Exact production API inventory required')
    if any(signature.split('(')[0]in builder.ENGINEERING_PRIVATE for signature in proof['module']['function_signatures']):
        raise ValueError('Production source cannot include engineering probes')
    for name,pin in manifest['source_files'].items():
        raw=prefix.regular(ROOT/name)
        if pin!={'bytes':len(raw),'sha256':sha(raw)}:raise ValueError('Operational source file changed: '+name)
    if manifest['framing']['bytes']!=len(expected)or manifest['framing']['sha256']!=sha(expected):
        raise ValueError('Operational source framing byte binding differs')
    # The unchanged official parser validates its own finite vendored sources
    # and TypeScript bytes before deriving the complete statement vector.
    left=deadline-time.monotonic()
    if left<=0:raise TimeoutError('Operational source admission deadline exhausted')
    result=bounded_process.run(['node',str(HERE/'frame-operational.mjs'),'--check'],
        timeout=left,cwd=ROOT,stdout_cap=1048576,stderr_cap=1048576)
    if result.returncode!=0:raise ValueError('Official operational209 source framing failed')
    if time.monotonic()>=deadline:raise TimeoutError('Operational source admission completed late')
    return manifest


def pin_sources(pins):
    manifest=admit()
    names=[*manifest['source_files'],'scripts/narcotics-log/operational-release.json',
           'supabase/migrations/'+MIGRATION]
    vendor=ROOT/'tests/controlled-drugs/engine/candidate/vendor/supabase-cli-2.118.0'
    provenance=json.loads(prefix.regular(vendor/'provenance.json'))
    names += [str((vendor/name).relative_to(ROOT))for name in ('provenance.json',*provenance['files'])]
    names += ['node_modules/typescript/lib/typescript.js']
    for name in names:pins[name]=sha(prefix.regular(ROOT/name))
    return manifest


class SourceLedger:
    """Retain only the source-derived expectation supplied by the208 installer."""
    def ledger(self,expected):
        super().ledger(expected)
        if len(expected)!=208:raise ValueError('Complete source-derived208 prefix required')
        self.operational_prefix_ledger=copy.deepcopy(expected)


def expected_ledger(prefix_rows,manifest):
    if len(prefix_rows)!=208 or len({row['version']for row in prefix_rows})!=208:
        raise ValueError('Exact source-derived208 prefix required')
    version,title=MIGRATION[:-4].split('_',1)
    if any(row['version']>=version for row in prefix_rows):
        raise ValueError('Operational209 must follow the complete existing prefix')
    framed=manifest['framing']
    return [*copy.deepcopy(prefix_rows),dict(version=version,name=title,
        **{key:framed[key]for key in ('statement_count','postgres_array_sha256','postgres_array_bytes')})]


def verify_ledger(runtime,expected,label):
    actual=runtime.selected_query(label,"SELECT coalesce(jsonb_agg(jsonb_build_object('version',version,'name',name,"
        "'statement_count',cardinality(statements),'postgres_array_sha256',encode(sha256(convert_to(to_jsonb(statements)::text,'UTF8')),'hex'),"
        "'postgres_array_bytes',octet_length(to_jsonb(statements)::text))ORDER BY version),'[]'::jsonb)FROM supabase_migrations.schema_migrations;")
    if actual!=expected:raise ValueError('Complete209 ledger differs from original source-derived framing')


def install(runtime):
    """Upgrade only the captured owned populated project using the real CLI."""
    import business_rehearsal as business
    from receiver_rehearsal import observe,owned_ingress
    from diagnose_register import wait_for_owned_rest
    target=runtime.install
    manifest=admit(timeout=runtime.remaining(30))
    runtime.remaining(1)
    expected=expected_ledger(target.operational_prefix_ledger,manifest)
    controls=runtime.selected_query('historical-policy-grammar-controls',prefix.regular(HERE/'policy-reuse-controls.sql').decode())
    if controls!=dict(kind='historical-policy-grammar-controls-v1',cases=23,
            original_and_context_results_exact=True,captured_capability_decisions_recomputed=True,domain_writes=0,Auth_acceptance=False):
        raise ValueError('Exact original/context policy grammar controls required')
    target.source_runtime=runtime
    owned_ingress(runtime,'stop',phase='upgrade')
    before=observe(runtime,'before-operational209-complete-data')
    raw=prefix.regular(ROOT/'supabase/migrations'/MIGRATION)
    destination=target.project/'supabase/migrations'/MIGRATION
    with destination.open('xb')as stream:stream.write(raw)
    target.project_pins[MIGRATION]=manifest['framing']['sha256']
    target.project_sources()
    previous=target.owner_end
    target.owner_end=min(target.phase_end,time.monotonic()+business.installation.OWNER_SECONDS,
                         previous if previous is not None else target.phase_end)
    try:
        runtime.verify()
        target.boot.command(['supabase','migration','up','--local','--workdir',str(target.project),'--experimental=false'],
                            timeout=runtime.remaining(30))
        runtime.remaining(1)
    finally:target.owner_end=previous
    target.project_sources()
    verify_ledger(runtime,expected,'operational209-complete-source-ledger')
    runtime.verify_module('operational209-preserved208-properties')
    properties=runtime.selected_query('operational209-complete-source-properties',
        "SELECT jsonb_build_object('matches',narcotics_register_v1.module_properties('narcotics_register_v1','narcotics_recovery_v1',"
        "'narcotics_register_v1','narcotics_recovery_v1')=(SELECT definition FROM narcotics_register_v1.descriptor WHERE revision=1));")
    if properties!={'matches':True}:raise ValueError('Complete operational209 source properties differ')
    after=observe(runtime,'after-operational209-complete-data')
    # Only these source-declared private tables are introduced. The descriptor
    # and immutable installation head are the only initial rows.
    tables={'narcotics_register_v1.'+name:int(name=='descriptor')for name in
            ('descriptor','operations','reports','form_contents','form_records')}
    tables.update({'narcotics_recovery_v1.'+name:int(name=='heads')for name in
            ('heads','operations','arms','backup_markers','count_markers','evidence','acknowledgments')})
    business.installation.preserve(before['relations'],after['relations'],
                                  {'supabase_migrations.schema_migrations':1},tables)
    if before['sequences']!=after['sequences']:raise ValueError('Operational209 changed an existing sequence')
    business.save(target.evidence,'operational209-installation-proof',dict(migration=MIGRATION,
        cli_version='2.118.0',complete_source_derived209_ledger=True,original_populated_rows_preserved=True,
        original_Auth_preserved=True,original_sequences_preserved=True,production_source=True,
        engineering_probes=False,hosted_writes=0))
    target.operational_ledger=expected
    target.result['complete_source_derived209_ledger']=True
    owned_ingress(runtime,'start')
    wait_for_owned_rest(runtime,target.source_context['public_anon_key'])
    business.modules().rest.effective_defaults(runtime,recovery=True)
    return expected
