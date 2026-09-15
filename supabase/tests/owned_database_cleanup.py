"""Privileged cleanup limited to marked, disposable local concurrency databases."""
import json
import re
import subprocess
import sys

PREFIXES = {
    'lrv_vaccination_review_': 'owned-vaccination-review-',
    'lrv_vaccination_race_': 'owned-vaccination-race-',
    'lrv_rx_review_': 'owned-prescription-review-',
    'lrv_prescriptionitem_race_': 'owned-prescriptionitem-race-',
    'lrv_clinical_race_': 'owned-clinical-race-',
    'lrv_history_race_': 'owned-history-race-',
    'lrv_release_race_': 'owned-release-race-',
    'lrv_attachment_race_': 'owned-attachment-race-',
}


def cleanup_owned_database(command, database, marker, check=None):
    """Preserve a pending test exception if cleanup also fails; never hide either."""
    primary = sys.exc_info()[1]
    try:
        prefix = next((p for p in PREFIXES if re.fullmatch(re.escape(p) + '[a-f0-9]{32}', database)), None)
        if prefix is None or not re.fullmatch(re.escape(PREFIXES[prefix]) + '[a-f0-9]{32}', marker):
            raise AssertionError('Invalid disposable database name or ownership marker')
        if command[:3] != ['docker', 'exec', '-i'] or command[4] != 'psql':
            raise AssertionError('Expected local Docker PostgreSQL command')
        container = command[3]
        if not re.fullmatch(r'supabase_db_[A-Za-z0-9_.-]+', container):
            raise AssertionError('Unexpected local database container')
        inspection = subprocess.run(['docker', 'inspect', container], capture_output=True, text=True, check=True)
        containers = json.loads(inspection.stdout)
        if len(containers) != 1 or containers[0]['Name'].lstrip('/') != container or containers[0]['Config']['Labels'].get('com.supabase.cli.project') != container.removeprefix('supabase_db_'):
            raise AssertionError('Local Supabase container identity mismatch')
        # postgres is intentionally not a superuser in Supabase. Even autovacuum
        # can own a superuser backend; use the local platform role ONLY here.
        cleanup_command = command.copy()
        cleanup_command[cleanup_command.index('-U') + 1] = 'supabase_admin'
        cleanup_command[cleanup_command.index('-d') + 1] = 'postgres'
        if 'ON_ERROR_STOP=1' not in cleanup_command:
            raise AssertionError('Cleanup requires stop-on-error PostgreSQL execution')
        query = f"""
DO $$ BEGIN
 IF current_setting('is_superuser') <> 'on' OR NOT EXISTS (
  SELECT 1 FROM pg_database WHERE datname='{database}'
   AND pg_get_userbyid(datdba)='postgres'
   AND shobj_description(oid,'pg_database')='{marker}'
 ) THEN RAISE EXCEPTION 'Owned database identity mismatch'; END IF;
END $$;
SELECT 'owned_identity_verified';
ALTER DATABASE "{database}" ALLOW_CONNECTIONS false;
SELECT pg_terminate_backend(pid) FROM pg_stat_activity
 WHERE datname='{database}' AND pid<>pg_backend_pid();
DROP DATABASE "{database}";
SELECT count(*) FROM pg_database WHERE datname='{database}';
"""
        result = subprocess.run(cleanup_command, input=query, capture_output=True, text=True)
        lines = result.stdout.strip().splitlines()
        if result.returncode or not lines or lines[0] != 'owned_identity_verified' or lines[-1] != '0':
            raise AssertionError('Owned database cleanup failed: ' + result.stderr)
        if check is not None:
            check(True, 'Exact owned database and local container identities checked')
            check(True, 'Disposable database removed')
        return True
    except Exception as cleanup_error:
        if primary is None:
            raise
        message = 'Additional owned database cleanup failure: ' + str(cleanup_error)
        if hasattr(primary, 'add_note'):
            primary.add_note(message)
        print(message, file=sys.stderr)
        return False
