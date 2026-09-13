"""Guarded synthetic database + physical private-Storage restore. No existing project is reset."""
import argparse
import hashlib
import json
import os
import re
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import time
import uuid

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--run-synthetic-local-rehearsal', action='store_true')
parser.add_argument('--resume-backup', type=Path, help='Retry only a retained synthetic backup destination')
args = parser.parse_args()
if not args.run_synthetic_local_rehearsal:
    parser.error('Explicit --run-synthetic-local-rehearsal is required')
root = Path(__file__).resolve().parents[2]
os.umask(0o077)
run = args.resume_backup.resolve() if args.resume_backup else Path(tempfile.mkdtemp(prefix='lrv-restore-synthetic-'))
if args.resume_backup:
    assert run.name.startswith('lrv-restore-synthetic-') and run.parent.resolve()==Path(tempfile.gettempdir()).resolve()
    assert (run.stat().st_mode & 0o077)==0, 'Artifact directory must remain private'
    match=re.match(r'project_id = "lrv-restore-([a-f0-9]{10})-source"', (run/'source/supabase/config.toml').read_text())
    assert match, 'Only generated synthetic source projects can be retried'
    run_id=match[1]
else:
    run_id=uuid.uuid4().hex[:10]
started = time.monotonic()
projects = []
log = (run / 'commands.log').open('a')
# A resumed failure must not leave an earlier success receipt looking current.
(run/'result.json').unlink(missing_ok=True)

def command(argv, *, input=None, binary=False):
    # Never log command output to terminal; status JSON contains disposable credentials.
    result = subprocess.run(argv, input=input, capture_output=True, text=not binary, cwd=root)
    if not binary:
        log.write('COMMAND '+ ' '.join(map(str,argv)) +'\n'+result.stdout+result.stderr+'\n');log.flush()
    if result.returncode:
        if binary:
            log.write(result.stderr.decode('utf-8',errors='replace'));log.flush()
        raise RuntimeError('Local rehearsal command failed; inspect protected commands.log: '+str(argv[0]))
    return result.stdout

def docker_name(project, service='db'):
    assert project['id'].startswith('lrv-restore-'+run_id+'-')
    return 'supabase_'+service+'_'+project['id']

def verify_identity(project):
    assert project['path'].parent == run
    config=(project['path']/'supabase/config.toml').read_text()
    assert config.startswith('project_id = "'+project['id']+'"\n')
    probe=subprocess.run(['docker','inspect',docker_name(project)],capture_output=True,text=True)
    if probe.returncode:
        return  # A stopped/failed startup may already have removed its generated containers.
    labels=json.loads(probe.stdout)[0]['Config']['Labels']
    assert labels['com.supabase.cli.project']==project['id']
    assert Path(labels['com.supabase.cli.workdir']).resolve()==project['path'].resolve()

def sql(project, statement):
    return command(['docker','exec','-i',docker_name(project),'psql','-U','supabase_admin','-d','postgres','-v','ON_ERROR_STOP=1','-qAt'],input=statement)

def project(kind, port, migrations):
    path=run/kind
    (path/'supabase').mkdir(parents=True,exist_ok=bool(args.resume_backup))
    identity='lrv-restore-'+run_id+'-'+kind
    for target in ['supabase_db_'+identity,'supabase_storage_'+identity]:
        for resource in ['container','volume']:
            assert subprocess.run(['docker',resource,'inspect',target],capture_output=True).returncode != 0, 'Refusing to reuse existing generated destination/source resources'
    for number in [port-1,port,port+1,port+3]:
        with socket.socket() as sock:
            sock.bind(('127.0.0.1',number))
    config=f'''project_id = "{identity}"
[api]
port = {port}
[db]
port = {port+1}
shadow_port = {port-1}
major_version = 17
[studio]
enabled = false
[analytics]
enabled = false
[inbucket]
port = {port+3}
[auth]
site_url = "http://127.0.0.1:{port}"
enable_signup = false
[storage]
enabled = true
[edge_runtime]
enabled = false
'''
    (path/'supabase/config.toml').write_text(config)
    if migrations: shutil.copytree(root/'supabase/migrations',path/'supabase/migrations')
    result={'id':identity,'path':path,'port':port}
    projects.append(result)
    command(['supabase','start','--workdir',str(path),'--exclude','realtime,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'])
    status=json.loads(command(['supabase','status','--workdir',str(path),'--output','json']))
    assert status['API_URL']==f'http://127.0.0.1:{port}'
    (path/'status.json').write_text(json.dumps(status))
    return result

def services(project):
    return [docker_name(project,kind) for kind in ['kong','auth','rest','storage','inbucket']]

try:
    if not args.resume_backup:
        print('Starting isolated synthetic source; artifacts:',run,flush=True)
        source=project('source',58321,True)
        command(['node',str(root/'scripts/restore-rehearsal/fixture.mjs'),'create',str(source['path']/'status.json'),str(run)])
        # No worker runtime or provider secrets exist. Stop all source API writers before the backup pair.
        verify_identity(source)
        command(['docker','stop',*services(source)])
        backup_started=time.monotonic()
        dump=command(['docker','exec',docker_name(source),'pg_dump','-U','supabase_admin','--format=custom','postgres'],binary=True)
        (run/'database.dump').write_bytes(dump)
        command(['docker','cp',docker_name(source,'storage')+':/mnt/.',str(run/'storage')])
        manifest=[]
        for file in sorted((run/'storage').rglob('*')):
            if file.is_file(): manifest.append({'path':str(file.relative_to(run/'storage')),'bytes':file.stat().st_size,'sha256':hashlib.sha256(file.read_bytes()).hexdigest()})
        assert manifest, 'Actual private Storage backup must contain physical files'
        command(['supabase','stop','--workdir',str(source['path']),'--no-backup'])
        backup_seconds=time.monotonic()-backup_started
        (run/'backup-manifest.json').write_text(json.dumps({'run_id':run_id,'database_sha256':hashlib.sha256(dump).hexdigest(),'files':manifest,'backup_seconds':backup_seconds}))
    else:
        source={'id':'lrv-restore-'+run_id+'-source','path':run/'source','port':58321}
        saved=json.loads((run/'backup-manifest.json').read_text())
        assert saved['run_id']==run_id
        dump=(run/'database.dump').read_bytes()
        assert hashlib.sha256(dump).hexdigest()==saved['database_sha256']
        manifest=saved['files'];backup_seconds=saved['backup_seconds']
        for file in manifest:
            path=(run/'storage'/file['path']).resolve()
            assert path.is_relative_to((run/'storage').resolve())
            assert path.stat().st_size==file['bytes'] and hashlib.sha256(path.read_bytes()).hexdigest()==file['sha256']
    print('Source backup complete; starting separate restore destination',flush=True)
    destination=project('destination',59321,False)
    verify_identity(destination)
    command(['docker','stop',*services(destination)])
    restore_started=time.monotonic()
    # The platform baseline has partitioned realtime tables. pg_restore --clean cannot
    # drop their inherited constraints individually; remove only this destination
    # schema first, then restore its full archived definition/data without filtering.
    sql(destination, 'drop schema if exists realtime cascade;')
    command(['docker','exec','-i',docker_name(destination),'pg_restore','-U','supabase_admin','-d','postgres','--clean','--if-exists','--exit-on-error','--single-transaction'],input=dump,binary=True)
    command(['docker','cp',str(run/'storage')+'/.',docker_name(destination,'storage')+':/mnt'])
    command(['docker','start',*services(destination)])
    # All three APIs must be ready after restart; Auth alone can become healthy
    # while PostgREST is still loading restored schema metadata.
    status=json.loads((destination['path']/'status.json').read_text())
    for attempt in range(60):
        import urllib.request
        try:
            for endpoint in ['/auth/v1/health','/rest/v1/','/storage/v1/status']:
                probe=urllib.request.Request(f"http://127.0.0.1:{destination['port']}"+endpoint,headers={'apikey':status['SERVICE_ROLE_KEY'],'Authorization':'Bearer '+status['SERVICE_ROLE_KEY']})
                urllib.request.urlopen(probe,timeout=2).close()
            break
        except Exception:
            if attempt==59: raise RuntimeError('Restored Auth/PostgREST/Storage did not become healthy')
            time.sleep(1)
    command(['node',str(root/'scripts/restore-rehearsal/fixture.mjs'),'verify',str(destination['path']/'status.json'),str(run)])
    # Compare the restored physical files as well as authorized downloaded original bytes.
    command(['docker','cp',docker_name(destination,'storage')+':/mnt/.',str(run/'restored-storage')])
    restored=[]
    for file in sorted((run/'restored-storage').rglob('*')):
        if file.is_file(): restored.append({'path':str(file.relative_to(run/'restored-storage')),'bytes':file.stat().st_size,'sha256':hashlib.sha256(file.read_bytes()).hexdigest()})
    assert manifest==restored, 'Physical Storage inventory/hash mismatch'
    results={'synthetic_only':True,'source_project':source['id'],'destination_project':destination['id'],'git_commit':command(['git','rev-parse','HEAD']).strip(),'runner_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'fixture_sha256':hashlib.sha256((root/'scripts/restore-rehearsal/fixture.mjs').read_bytes()).hexdigest(),'database_sha256':hashlib.sha256(dump).hexdigest(),'storage_files':manifest,'backup_seconds':round(backup_seconds,2) if backup_seconds is not None else None,'restore_and_verify_seconds':round(time.monotonic()-restore_started,2),'total_seconds':round(time.monotonic()-started,2),'verification':json.loads((run/'verification.json').read_text()),'sending_disabled':'No Edge runtime, provider credentials, cron or SMTP delivery configured; local Auth uses mail catcher only.'}
finally:
    cleanup_errors=[]
    for item in projects:
        try:
            # Verify ownership before cleanup, and never accept failed stop commands.
            assert item['id'].startswith('lrv-restore-'+run_id+'-')
            verify_identity(item)
            command(['supabase','stop','--workdir',str(item['path']),'--no-backup'])
            containers=command(['docker','ps','-a','--filter','name='+item['id'],'--format','{{.Names}}']).splitlines()
            volumes=command(['docker','volume','ls','--format','{{.Name}}']).splitlines()
            assert not containers, 'Generated project containers remain after cleanup'
            assert not any(name.endswith('_'+item['id']) for name in volumes), 'Generated project volumes remain after cleanup'
        except Exception as error:
            cleanup_errors.append(str(error))
    log.close()
    if cleanup_errors:
        raise RuntimeError('Rehearsal cleanup failed; no success recorded: '+'; '.join(cleanup_errors))
# This is reached only if restore/verification and every checked cleanup succeeded.
results['cleanup_verified']=True
results['total_seconds']=round(time.monotonic()-started,2)
(run/'result.json').write_text(json.dumps(results,indent=2)+'\n')
print('PASS: actual isolated database and private Storage restored and cleaned; result:',run/'result.json',flush=True)
