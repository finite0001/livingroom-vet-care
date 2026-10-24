"""Read-only assembly for the unpublished controlled-stock local candidate.

No Docker, database, account or policy operations occur here. The caller owns
runtime identity, empty/populated-source guards, drift rollback probes, evidence
writes and cleanup. This is not a hosted installer or commissioning API.
"""
import hashlib
import json
from pathlib import Path


# Local-only final revocation and technical baseline, retained byte-for-byte.
FINALIZE_SQL = """
do $$declare r record;d jsonb;begin
 for r in select p.oid::regprocedure signature from pg_proc p where p.pronamespace='public'::regnamespace
 and(left(p.proname,17)='controlled_stock_'or p.proname in('read_controlled_stock_action','prepare_controlled_stock_action','execute_controlled_stock_action','cancel_controlled_stock_action'))loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',r.signature);end loop;
 -- Local-only initial technical baseline; this is not a hosted drift acceptance mechanism.
 d:=controlled_stock_manifest_snapshot();
 insert into controlled_stock_engine_manifests(revision,definition,definition_hash)values(1,d,controlled_stock_hash(d));
end $$;
select controlled_stock_manifest_required();commit;
"""

class PriorMetadataDrift(AssertionError):
    """Only sanitized catalog metadata paths; never source rows or secrets."""

    def __init__(self, changed_metadata_paths):
        self.changed_metadata_paths = tuple(changed_metadata_paths)
        super().__init__(
            'Untouched replay differs from independently trusted prior metadata; '
            'review CLI/Postgres bootstrap environment: '
            + ', '.join(self.changed_metadata_paths)
        )


def build_install(source, files):
    """Read source inputs and return deterministic local-only SQL and prior pins.

    source is the candidate directory; files is the ordered canonical migration
    sequence. The caller retains the exact release-count/runtime guards. No
    expected prior is regenerated from the candidate or any database.
    """
    source = Path(source)
    files = list(files)
    parts=[(source/(name+'.sql')).read_text()for name in ['schema','helpers','effects','review']]
    for name in ['source-reader.sql','source-effects.sql']:
        parts.append((source.parent/name).read_text().replace('pg_temp.controlled_stock_','public.controlled_stock_'))
    parts.extend((source/(name+'.sql')).read_text()for name in ['posting','scalar-helpers','opening','constraints','entry','protocol','guards','seal'])
    # The expected catalog is independently retained from the original canonical
    # 189 replay, never rebuilt from this candidate or a deployed catalog. Newer
    # migrations may coexist only if the scoped metadata still equals that pin.
    reference=(source/'trusted-prior-189.json').read_bytes()
    assert hashlib.sha256(reference).hexdigest()=='7c39d7d55b7aed8f11159555bbcd880c5910b1fa2891e495c28d2a1b6dbc5ac1','Original trusted reference changed; review its independent provenance'
    trusted=json.loads(reference)
    migration_sources={p.name:hashlib.sha256(p.read_bytes()).hexdigest()for p in files}
    trusted_sources={p.name:migration_sources[p.name]for p in files[:189]}
    assert trusted['migration_count']==189 and trusted['migration_source_set_sha256']==hashlib.sha256(json.dumps(trusted_sources,sort_keys=True).encode()).hexdigest(),'Trusted prior migration prefix changed; review the upgrade baseline'
    prior_sql=(source/'prior-snapshot.sql').read_text()
    assert trusted['snapshot_sql_sha256']==hashlib.sha256(prior_sql.encode()).hexdigest(),'Prior snapshot coverage changed; review the baseline'
    expected="'"+json.dumps(trusted['definition']).replace("'","''")+"'::jsonb"
    barrier='begin;\nselect pg_advisory_xact_lock(90271040,0);\n'
    preflight=prior_sql+"\ndo $$begin if pg_temp.controlled_stock_prior_snapshot()is distinct from "+expected+" then raise exception 'Controlled upgrade prior definitions or grants drifted; review required'using errcode='23514';end if;end $$;\n"
    install=barrier+preflight+'\n'.join(parts)
    install=install.replace('set search_path=public,pg_temp as $$',"set search_path=public,pg_temp set timezone='UTC' as $$")
    install += FINALIZE_SQL
    return {
        'install': install,
        'prior_sql': prior_sql,
        'trusted': trusted,
        'barrier': barrier,
        'migration_sources': migration_sources,
        'reference_sha256': hashlib.sha256(reference).hexdigest(),
    }


def assert_prior(actual, trusted):
    """Reject any untouched prior drift; return no adopted or normalized state."""
    if actual == trusted['definition']:
        return
    changed = []
    for family in ['functions', 'relations']:
        expected_objects = trusted['definition'][family]
        actual_objects = actual[family]
        for name in sorted(expected_objects.keys() | actual_objects.keys()):
            if name not in expected_objects or name not in actual_objects:
                changed.append(family + '/' + name)
            else:
                expected_object = expected_objects[name]
                actual_object = actual_objects[name]
                changed.extend(
                    family + '/' + name + '/' + field
                    for field in sorted(expected_object.keys() | actual_object.keys())
                    if expected_object.get(field) != actual_object.get(field)
                )
    raise PriorMetadataDrift(changed)
