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
parser.add_argument('--rehearse-observed-hosted-gaps', action='store_true')
parser.add_argument('--rehearse-staging-baseline', action='store_true')
args = parser.parse_args()
upgrade_mode = args.rehearse_observed_hosted_gaps or args.rehearse_staging_baseline
if args.rehearse_observed_hosted_gaps and args.rehearse_staging_baseline:
    parser.error('Choose one baseline')
if upgrade_mode and args.resume_backup:
    parser.error('Gap rehearsal requires a fresh run; resume cannot prove the upgrade')
if not args.run_synthetic_local_rehearsal:
    parser.error('Explicit --run-synthetic-local-rehearsal is required')
root = Path(__file__).resolve().parents[2]
migration_files = sorted((root/'supabase/migrations').glob('*.sql'))
initial_files = [p for p in migration_files if p.name.split('_')[0] <= '20260913270000' or p.name.split('_')[0] in {'20260913300000','20260913310000','20260913330000','20260913340000'}]
baseline_path = Path(__file__).with_name('staging-baseline-20260914.json')
if args.rehearse_staging_baseline:
    baseline = json.loads(baseline_path.read_text())
    versions = [m['version'] for m in baseline['migrations']]
    assert len(versions) == len(set(versions)) == 84
    assert versions == sorted(versions)
    initial_files = [p for p in migration_files if p.name.split('_')[0] in versions]
    assert [p.name.split('_')[0] for p in initial_files] == versions, 'Baseline migrations missing locally'
    assert all(p.stem.split('_',1)[1] == m['name'] for p,m in zip(initial_files,baseline['migrations'])), 'Baseline migration names differ'
missing_files = [p for p in migration_files if p not in initial_files]
new_versions = [f'20260914{v:02d}0000' for v in range(1,19)]
if args.rehearse_staging_baseline:
    assert len(migration_files) == 105
    assert [p.name.split('_')[0] for p in missing_files] == ['20260913650000','20260913690000','20260913700000'] + new_versions, 'Review changed staging upgrade inventory'
if args.rehearse_observed_hosted_gaps:
    expected_missing = ['20260913280000','20260913290000','20260913320000'] + [f'20260913{v}0000' for v in range(35,64)] + ['20260913650000','20260913690000','20260913700000','20260913900000'] + new_versions
    assert len(migration_files)==105 and len(initial_files)==51
    assert [p.name.split('_')[0] for p in missing_files]==expected_missing, 'Migration inventory changed; review the frozen rehearsal'
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
    if migrations:
        (path/'supabase/migrations').mkdir(exist_ok=bool(args.resume_backup))
        selected = initial_files if kind=='source' and upgrade_mode else migration_files
        for migration in selected: shutil.copy2(migration,path/'supabase/migrations'/migration.name)
    result={'id':identity,'path':path,'port':port}
    projects.append(result)
    command(['supabase','start','--ignore-health-check','--workdir',str(path),'--exclude','realtime,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'])
    status=json.loads(command(['supabase','status','--workdir',str(path),'--output','json']))
    assert status['API_URL']==f'http://127.0.0.1:{port}'
    (path/'status.json').write_text(json.dumps(status))
    # CLI's fixed container grace can expire under load. Never treat its ignored
    # status as acceptance: actual required APIs must all respond successfully.
    import urllib.request
    deadline=time.monotonic()+120
    while True:
        try:
            for endpoint in ['/auth/v1/health','/rest/v1/','/storage/v1/status']:
                probe=urllib.request.Request(status['API_URL']+endpoint,headers={'apikey':status['SERVICE_ROLE_KEY'],'Authorization':'Bearer '+status['SERVICE_ROLE_KEY']})
                urllib.request.urlopen(probe,timeout=3).close()
            break
        except Exception:
            if time.monotonic()>=deadline: raise RuntimeError('Owned local Auth/PostgREST/Storage readiness deadline exceeded')
            time.sleep(1)
    return result

def ledger(project):
    return json.loads(sql(project, 'select json_agg(version order by version) from supabase_migrations.schema_migrations;'))

def functions_snapshot(project):
    # Compare all application routines, including effective role grants and trigger bindings.
    return json.loads(sql(project, """select jsonb_build_object(
      'functions',(select jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,
        'definition',pg_get_functiondef(p.oid),'owner',pg_get_userbyid(p.proowner),'security_definer',p.prosecdef,'config',p.proconfig,
        'grants',(select jsonb_object_agg(r,has_function_privilege(r,p.oid,'EXECUTE')) from unnest(array['anon','authenticated','service_role']) r)) order by p.oid::regprocedure::text)
        from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f'),
      'triggers',(select jsonb_agg(jsonb_build_object('definition',pg_get_triggerdef(t.oid),'enabled_mode',t.tgenabled) order by pg_get_triggerdef(t.oid) collate "C") from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal),
      'relations',(select jsonb_agg(jsonb_build_object('name',c.relname,'kind',c.relkind,'owner',pg_get_userbyid(c.relowner),
        'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,'grants',
        (select jsonb_object_agg(r,case when c.relkind='S' then
          (select jsonb_object_agg(priv,has_sequence_privilege(r,c.oid,priv)) from unnest(array['USAGE','SELECT','UPDATE']) priv)
         else (select jsonb_object_agg(priv,has_table_privilege(r,c.oid,priv)) from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) priv) end)
         from unnest(array['anon','authenticated','service_role']) r)) order by c.relname)
        from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in('r','p','v','m','S')),
      'policies',(select jsonb_agg(to_jsonb(p) order by tablename,policyname) from pg_policies p where schemaname='public'),
      'default_privileges',(select jsonb_agg(jsonb_build_object('owner',pg_get_userbyid(d.defaclrole),'kind',d.defaclobjtype,
        'acl',(select jsonb_agg(jsonb_build_object('grantee',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,
          'grantor',pg_get_userbyid(a.grantor),'privilege',a.privilege_type,'grantable',a.is_grantable) order by a.grantee,a.grantor,a.privilege_type) from aclexplode(d.defaclacl) a)) order by pg_get_userbyid(d.defaclrole),d.defaclobjtype)
        from pg_default_acl d where d.defaclnamespace='public'::regnamespace));"""))

def vaccination_snapshot(project):
    tables = ['ezyvet_migration_runs', 'ezyvet_migration_scopes', 'ezyvet_migration_bindings', 'ezyvet_migration_attempt_events',
              'ezyvet_import_runs', 'ezyvet_import_snapshots', 'ezyvet_import_pages',
              'ezyvet_import_page_items', 'ezyvet_identity_heads', 'ezyvet_record_links',
              'ezyvet_clinical_runs', 'ezyvet_clinical_pages', 'ezyvet_clinical_page_observations',
              'ezyvet_vaccination_runs', 'ezyvet_vaccination_pages', 'ezyvet_vaccination_page_observations',
              'ezyvet_vaccination_review_requests', 'ezyvet_imported_vaccinations',
              'ezyvet_prescription_runs', 'ezyvet_prescription_pages', 'ezyvet_prescription_page_observations',
              'ezyvet_prescriptionitem_runs', 'ezyvet_prescriptionitem_pages', 'ezyvet_prescriptionitem_page_observations',
              'ezyvet_prescription_review_requests', 'ezyvet_imported_prescriptions', 'ezyvet_imported_prescription_items',
              'ezyvet_attachment_runs', 'ezyvet_attachment_pages', 'ezyvet_attachment_page_observations',
              'ezyvet_attachment_capture_requests','ezyvet_attachment_capture_attempts','ezyvet_attachment_capture_failures',
              'ezyvet_attachment_original_intents','ezyvet_attachment_original_captures',
              'ezyvet_attachment_record_versions','ezyvet_attachment_approval_cancellations',
              'record_releases', 'record_release_sources', 'record_release_events', 'record_release_policy',
              'release_email_requests','release_email_payloads','document_link_grants','document_link_payloads','document_link_events','document_link_access_budget','sms_consent','conversations']
    parts = [f"select '{table}' name,coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) rows from public.{table} t" for table in tables]
    return json.loads(sql(project, 'select jsonb_object_agg(name,rows) from (' + ' union all '.join(parts) + ') records;'))

def migration_recovery_snapshot(project):
    actor=str(uuid.UUID(json.loads((run/'synthetic-fixture.json').read_text())['user']))
    # Temporary fixture role is rolled back with the reads; no restored audit rows change.
    return json.loads(sql(project,f"""begin;
      insert into public.user_roles(user_id,role) values('{actor}','ADMIN') on conflict do nothing;
      do $$begin perform set_config('request.jwt.claim.sub','{actor}',true);end $$;
      select jsonb_build_object(
        'manifests',(select jsonb_agg(public.read_ezyvet_migration_run(id) order by id) from public.ezyvet_migration_runs),
        'bindings',(select jsonb_agg(public.read_ezyvet_migration_binding(id) order by id) from public.ezyvet_migration_bindings));
      rollback;"""))

def seed_vaccination_receipt(project):
    # This explicitly owned local fixture uses the same scoped RPCs as runtime acceptance.
    # A temporary ADMIN role is removed in the same transaction; prior fixture roles remain exact.
    state = json.loads((run/'synthetic-fixture.json').read_text())
    actor, pet, client = [str(uuid.UUID(state[key])) for key in ['user', 'pet', 'client']]
    site = 'Synthetic-Restore-' + run_id
    sql(project, f"""do $fixture$
    declare a uuid := '{actor}'; p uuid := '{pet}'; client uuid := '{client}';
      animal uuid := gen_random_uuid(); mapping uuid := gen_random_uuid();
      consult_run uuid := gen_random_uuid(); vaccination_run uuid := gen_random_uuid();
      claimed jsonb; consult public.ezyvet_import_snapshots; vaccination public.ezyvet_import_snapshots; head integer; already_admin boolean; already_dvm boolean; review_id uuid:=gen_random_uuid(); prepared jsonb;
      rx_run uuid:=gen_random_uuid(); item_run uuid:=gen_random_uuid(); pending_run uuid:=gen_random_uuid();
      rx_review uuid:=gen_random_uuid(); correction uuid:=gen_random_uuid(); rx_pending uuid:=gen_random_uuid();
      rx public.ezyvet_import_snapshots; rx_item public.ezyvet_import_snapshots;
      rx_payload jsonb; rx_approved jsonb; release_preview jsonb; release_selection jsonb;
      attachment_run uuid:=gen_random_uuid(); attachment_pending uuid:=gen_random_uuid(); attachment_page jsonb; attachment_observation jsonb;
    begin
      select exists(select 1 from public.user_roles where user_id=a and role='ADMIN') into already_admin;
      if not already_admin then insert into public.user_roles(user_id,role) values(a,'ADMIN'); end if;
      insert into public.ezyvet_import_snapshots(id,source_origin,source_site_uid,resource,external_id,payload,payload_hash,first_seen_by)
        values(animal,'https://api.trial.ezyvet.com','{site}','animal','77','{{"id":77,"contact_id":8}}',encode(sha256(convert_to('{{"id":77,"contact_id":8}}'::jsonb::text,'UTF8')),'hex'),a);
      insert into public.ezyvet_record_links(id,request_id,request_hash,source_origin,source_site_uid,resource,external_id,snapshot_id,head_version,client_id,pet_id,local_version,action,reason,approved_by)
        values(mapping,mapping,'synthetic-restore-link','https://api.trial.ezyvet.com','{site}','animal','77',animal,1,client,p,1,'link','SYNTHETIC RESTORE ONLY',a);
      claimed := public.claim_ezyvet_clinical_import(consult_run,a,'{site}','consult','https://api.trial.ezyvet.com',mapping);
      perform public.stage_ezyvet_import_page(consult_run,a,(claimed->>'lease_id')::uuid,1,true,
        '[{{"external_id":"1","payload":{{"id":1,"animal_id":77,"description":"Synthetic restore consult"}}}}]'::jsonb);
      select * into strict consult from public.ezyvet_import_snapshots where source_site_uid='{site}' and resource='consult';
      select version into strict head from public.ezyvet_identity_heads where snapshot_id=consult.id;
      claimed := public.claim_ezyvet_vaccination_import(vaccination_run,a,'{site}','vaccination','https://api.trial.ezyvet.com',mapping,consult.id,consult.payload_hash,head);
      perform public.stage_ezyvet_import_page(vaccination_run,a,(claimed->>'lease_id')::uuid,1,true,
        '[{{"external_id":"2","payload":{{"id":"2","consult_id":"1","product_id":"42","date_of_administration":"1700000000","date_of_next_administration":null,"qty":null}}}}]'::jsonb);
      select exists(select 1 from public.user_roles where user_id=a and role='DVM') into already_dvm;
      if not already_dvm then insert into public.user_roles(user_id,role) values(a,'DVM'); end if;
      perform set_config('request.jwt.claim.sub',a::text,true);
      select * into strict vaccination from public.ezyvet_import_snapshots where source_site_uid='{site}' and resource='vaccination';
      prepared:=public.prepare_ezyvet_vaccination_review(review_id,p,jsonb_build_object(
        'animal_link_id',mapping,'patient_version',(select version from public.pets where id=p),
        'snapshot_id',vaccination.id,'payload_hash',vaccination.payload_hash,'observed_head_version',(select version from public.ezyvet_identity_heads where snapshot_id=vaccination.id),
        'consult_snapshot_id',consult.id,'consult_payload_hash',consult.payload_hash,'consult_observed_head_version',head,
        'product_id',null,'product_version',null,'administered_on',null,'administration_date_status','uninterpreted',
        'source_next_due_on',null,'next_date_status','unknown','status','unknown','outside_author',null,
        'reason','Synthetic restoration of reviewed outside vaccination evidence','replaces_id',null,'expected_predecessor_hash',null));
      perform public.approve_ezyvet_vaccination_review(review_id,p,prepared#>>'{{request,request_hash}}',true);
      claimed:=public.claim_ezyvet_prescription_import(rx_run,a,'{site}','prescription','https://api.trial.ezyvet.com',mapping);
      perform public.stage_ezyvet_import_page(rx_run,a,(claimed->>'lease_id')::uuid,1,true,
        '[{{"external_id":"3","payload":{{"id":"3","animal_id":"77","consult_id":"1","prescription_item_list":[4,5]}}}}]'::jsonb);
      select * into strict rx from public.ezyvet_import_snapshots where source_site_uid='{site}' and resource='prescription';
      claimed:=public.claim_ezyvet_prescriptionitem_import(item_run,a,'{site}','prescriptionitem','https://api.trial.ezyvet.com',mapping,rx.id,rx.payload_hash,1);
      perform public.stage_ezyvet_import_page(item_run,a,(claimed->>'lease_id')::uuid,1,true,
        '[{{"external_id":"4","payload":{{"id":"4","prescription_id":"3","qty":"outside units","remaining":"unknown","instructions":"Synthetic outside instructions"}}}}]'::jsonb);
      select * into strict rx_item from public.ezyvet_import_snapshots where source_site_uid='{site}' and resource='prescriptionitem';
      rx_payload:=jsonb_build_object('item_run_id',item_run,'patient_version',(select version from public.pets where id=p),
        'interpretation',jsonb_build_object('prescribed_on',null,'prescription_date_status','uninterpreted','status','unknown',
          'outside_author',null,'reason','Synthetic restoration of outside prescription history','completeness','partial',
          'partial_reason','Source item 5 was not observed','replaces_id',null,'expected_predecessor_hash',null,
          'items',jsonb_build_array(jsonb_build_object('snapshot_id',rx_item.id,'start_on',null,'start_date_status','unknown',
            'product_id',null,'product_version',null,'note',null))));
      prepared:=public.prepare_ezyvet_prescription_review(rx_review,p,rx_payload);
      rx_approved:=public.approve_ezyvet_prescription_review(rx_review,p,prepared#>>'{{request,request_hash}}',true);
      insert into public.record_release_policy(id,enabled,accepted_by,accepted_at,acceptance_reference,accepted_schema_version)
        values(true,true,a,now(),'Synthetic isolated restore only',8);
      release_selection:=jsonb_build_object('imported_prescription_ids',jsonb_build_array(rx_review));
      release_preview:=public.preview_record_release_v8(p,client,'EMAIL','restore@example.test',release_selection);
      perform public.confirm_record_release(gen_random_uuid(),p,client,'EMAIL','restore@example.test',release_selection,
        release_preview->'snapshot',release_preview->>'source_hash',true);
      rx_payload:=jsonb_set(rx_payload,'{{interpretation}}',(rx_payload->'interpretation')||jsonb_build_object(
        'reason','Synthetic corrected historical interpretation','replaces_id',rx_review,'expected_predecessor_hash',rx_approved#>>'{{receipt,version_hash}}'));
      prepared:=public.prepare_ezyvet_prescription_review(correction,p,rx_payload);
      rx_approved:=public.approve_ezyvet_prescription_review(correction,p,prepared#>>'{{request,request_hash}}',true);
      rx_payload:=jsonb_set(rx_payload,'{{interpretation}}',(rx_payload->'interpretation')||jsonb_build_object(
        'reason','Synthetic unfinished review preserved across restore','replaces_id',correction,'expected_predecessor_hash',rx_approved#>>'{{receipt,version_hash}}'));
      perform public.prepare_ezyvet_prescription_review(rx_pending,p,rx_payload);
      update public.ezyvet_import_runs set retry_after=now()-interval '1 second' where id=item_run;
      perform public.claim_ezyvet_prescriptionitem_import(pending_run,a,'{site}','prescriptionitem','https://api.trial.ezyvet.com',mapping,rx.id,rx.payload_hash,1);
      insert into public.ezyvet_identity_heads(source_origin,source_site_uid,resource,external_id,snapshot_id,version)
        values('https://api.trial.ezyvet.com','{site}','animal','77',animal,1);
      attachment_observation:=jsonb_build_object('external_id','701','file_id','42','metadata',
        jsonb_build_object('id','701','file_id','42','record_type','Animal','record_id','77','name','Synthetic attachment metadata'),
        'raw_record_sha256',repeat('a',64),'stable_metadata_sha256',repeat('b',64),'file_sha256',null);
      attachment_page:=jsonb_build_object('contract_version','ezyvet_animal_attachment_metadata_v1','parent',jsonb_build_object('record_type','Animal','record_id','77'),
        'page',1,'complete',true,'pagination',jsonb_build_object('items_page',1,'items_page_total',1,'items_page_size',10,'items_total',2),
        'observations',jsonb_build_array(attachment_observation,jsonb_set(attachment_observation,'{{raw_record_sha256}}',to_jsonb(repeat('c',64)))),'page_sha256',repeat('d',64));
      claimed:=public.claim_ezyvet_attachment_import(attachment_run,a,'{site}','https://api.trial.ezyvet.com',mapping);
      perform public.stage_ezyvet_attachment_page(attachment_run,a,(claimed->>'lease_id')::uuid,attachment_page);
      update public.ezyvet_import_runs set retry_after=now()-interval '1 second' where id=attachment_run;
      perform public.claim_ezyvet_attachment_import(attachment_pending,a,'{site}','https://api.trial.ezyvet.com',mapping);
      prepared:=public.prepare_ezyvet_migration_run(gen_random_uuid(),'https://api.trial.ezyvet.com','{site}',jsonb_build_array(
        jsonb_build_object('id',gen_random_uuid(),'mapping_id',mapping,'resource','attachment','parent_type','animal',
          'parent_snapshot_id',animal,'parent_head_version',1,'disposition','required','reason','Synthetic original coverage'),
        jsonb_build_object('id',gen_random_uuid(),'mapping_id',mapping,'resource','vaccination','parent_type','consult',
          'parent_snapshot_id',consult.id,'parent_head_version',head,'disposition','required','reason','Synthetic vaccination coverage'),
        jsonb_build_object('id',gen_random_uuid(),'mapping_id',mapping,'resource','prescriptionitem','parent_type','prescription',
          'parent_snapshot_id',rx.id,'parent_head_version',1,'disposition','excluded','reason','Synthetic explicit scope exclusion')));
      perform public.bind_ezyvet_migration_child(gen_random_uuid(),
        (select id from public.ezyvet_migration_scopes where migration_run_id=(prepared#>>'{{run,id}}')::uuid and resource='attachment'),
        attachment_run,'Synthetic attachment recovery binding');
      perform public.bind_ezyvet_migration_child(gen_random_uuid(),
        (select id from public.ezyvet_migration_scopes where migration_run_id=(prepared#>>'{{run,id}}')::uuid and resource='vaccination'),
        vaccination_run,'Synthetic vaccination recovery binding');
      if not already_dvm then delete from public.user_roles where user_id=a and role='DVM'; end if;
      if not already_admin then delete from public.user_roles where user_id=a and role='ADMIN'; end if;
    end $fixture$;""")
    captured = vaccination_snapshot(project)
    assert len(captured['ezyvet_migration_runs']) == 1 and len(captured['ezyvet_migration_scopes']) == 3
    assert len(captured['ezyvet_migration_bindings']) == 2
    assert {row['parent_type'] for row in captured['ezyvet_migration_scopes']} == {'animal','consult','prescription'}
    assert len(captured['ezyvet_vaccination_runs']) == 1 and len(captured['ezyvet_vaccination_pages']) == 1 and len(captured['ezyvet_vaccination_page_observations']) == 1
    assert len(captured['ezyvet_clinical_page_observations']) == 1
    assert len(captured['ezyvet_vaccination_review_requests']) == 1 and len(captured['ezyvet_imported_vaccinations']) == 1
    assert len(captured['ezyvet_prescription_runs']) == 1 and len(captured['ezyvet_prescriptionitem_runs']) == 2
    assert len(captured['ezyvet_imported_prescriptions']) == 2 and len(captured['ezyvet_imported_prescription_items']) == 2
    assert len(captured['ezyvet_prescription_review_requests']) == 3
    assert len(captured['record_releases']) == 1 and any(row['source_kind']=='imported_prescription' for row in captured['record_release_sources'])
    assert len(captured['ezyvet_attachment_runs']) == 2 and len(captured['ezyvet_attachment_pages']) == 1
    assert len(captured['ezyvet_attachment_page_observations']) == 2
    assert len({row['snapshot_id'] for row in captured['ezyvet_attachment_page_observations']}) == 1
    (run/'vaccination-receipt-fixture.json').write_text(json.dumps(captured, sort_keys=True))


def services(project):
    return [docker_name(project,kind) for kind in ['kong','auth','rest','storage','inbucket']]

try:
    if not args.resume_backup:
        print('Starting isolated synthetic source; artifacts:',run,flush=True)
        source=project('source',58321,True)
        command(['node',str(root/'scripts/restore-rehearsal/fixture.mjs'),'create',str(source['path']/'status.json'),str(run)])
        if upgrade_mode:
            assert ledger(source)==[p.name.split('_')[0] for p in initial_files]
            # Reproduce the six direct ACL differences observed by read-only hosted
            # comparison. Only this generated local source is altered; 4600 must
            # normalize it to the canonical destination's explicit permissions.
            if args.rehearse_observed_hosted_gaps:
                sql(source, '''grant execute on function public.admin_set_staff_active(uuid,boolean),public.admin_update_staff_role(uuid,public.user_role) to anon,service_role;
                grant execute on function public.clock_in(),public.clock_out(),public.get_consent_submission(text),public.review_ezyvet_snapshot(uuid,text,uuid,uuid,text) to service_role;''')
            inventory_sql=(root/'scripts/restore-rehearsal/routine-inventory.sql').read_text()
            (run/'initial-routine-inventory.json').write_text(sql(source,inventory_sql))
            access_sql=(root/'scripts/restore-rehearsal/access-inventory.sql').read_text()
            (run/'initial-access-inventory.json').write_text(sql(source,access_sql))
            # An existing leased run proves the new ledger starts with an honest
            # migration baseline and does not alter the old cursor/lease/error.
            pretracking_actor=str(uuid.UUID(json.loads((run/'synthetic-fixture.json').read_text())['user']))
            pretracking_id=str(uuid.uuid4())
            sql(source,f"""insert into public.ezyvet_import_runs(id,source_origin,source_site_uid,resource,requested_by,lease_id,lease_until,last_error_code)
              values('{pretracking_id}','https://api.trial.ezyvet.com','Synthetic-Pretracking-{run_id}','animal','{pretracking_actor}',gen_random_uuid(),now()+interval '1 minute','UPSTREAM_TIMEOUT');""")
            pretracking_before=json.loads(sql(source,f"select to_jsonb(r) from public.ezyvet_import_runs r where id='{pretracking_id}';"))
            for migration in missing_files: shutil.copy2(migration,source['path']/'supabase/migrations'/migration.name)
            verify_identity(source)
            push=['supabase','db','push','--local','--skip-vault','--workdir',str(source['path'])]
            probe=subprocess.run(push+['--dry-run'],capture_output=True,text=True,cwd=root)
            output=probe.stdout+probe.stderr
            log.write(output);log.flush()
            historical_gaps = [p.name.split('_')[0] for p in missing_files if p.name.split('_')[0] < initial_files[-1].name.split('_')[0]]
            assert probe.returncode != 0 and historical_gaps and all(v in output for v in historical_gaps) and '--include-all' in output, 'Expected old-gap refusal was not observed'
            command(push+['--include-all','--dry-run'])
            verify_identity(source)
            command(push+['--include-all','--yes'])
            assert ledger(source)==[p.name.split('_')[0] for p in migration_files]
            assert json.loads(sql(source,f"select to_jsonb(r) from public.ezyvet_import_runs r where id='{pretracking_id}';"))==pretracking_before
            pretracking_events=json.loads(sql(source,f"select jsonb_agg(to_jsonb(e) order by sequence) from public.ezyvet_migration_attempt_events e where child_run_id='{pretracking_id}';"))
            assert len(pretracking_events)==1 and pretracking_events[0]['kind']=='baseline' and pretracking_events[0]['history_origin']=='migration_baseline'
            assert pretracking_events[0]['error_code']=='UPSTREAM_TIMEOUT' and pretracking_events[0]['attempt_hash']==hashlib.sha256(pretracking_before['lease_id'].encode()).hexdigest()
            assert pretracking_before['lease_id'] not in json.dumps(pretracking_events)
            (run/'migration-attempt-baseline-evidence.json').write_text(json.dumps({'existing_run_unchanged':True,'baseline_rows':1,'origin':'migration_baseline','raw_lease_stored_in_events':False}))
            command(['node',str(root/'scripts/restore-rehearsal/fixture.mjs'),'verify-upgrade',str(source['path']/'status.json'),str(run)])
            upgraded_functions=functions_snapshot(source)
            (run/'backfill-evidence.json').write_text(json.dumps({'initial_versions':[p.name.split('_')[0] for p in initial_files],'applied_versions':[p.name.split('_')[0] for p in missing_files],'final_versions':ledger(source),'migration_sha256':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in migration_files},'fixture_preserved':True,'ordinary_push_refused':True,'observed_direct_grants_reproduced':args.rehearse_observed_hosted_gaps,'baseline_kind':'staging_20260914' if args.rehearse_staging_baseline else 'legacy_51','baseline_ledger_sha256':hashlib.sha256(baseline_path.read_bytes()).hexdigest() if args.rehearse_staging_baseline else None,'hosted_body_parity_verified':False,'initial_access_inventory_sha256':hashlib.sha256((run/'initial-access-inventory.json').read_bytes()).hexdigest(),'access_inventory_sql_sha256':hashlib.sha256(access_sql.encode()).hexdigest(),'initial_routine_inventory_sha256':hashlib.sha256((run/'initial-routine-inventory.json').read_bytes()).hexdigest(),'routine_inventory_sql_sha256':hashlib.sha256(inventory_sql.encode()).hexdigest()},indent=2))
        if any(p.name.startswith('20260913520000_') for p in migration_files):
            seed_vaccination_receipt(source)
            # Preserve all prior rows and explicitly capture the four new release audit entries.
            command(['node',str(root/'scripts/restore-rehearsal/fixture.mjs'),'capture-review-audit',str(source['path']/'status.json'),str(run)])
            command(['node',str(root/'scripts/restore-rehearsal/fixture.mjs'),'capture-api-originals',str(source['path']/'status.json'),str(run)])
            command(['node',str(root/'scripts/restore-rehearsal/fixture.mjs'),'capture-release-packages',str(source['path']/'status.json'),str(run)])
            (run/'vaccination-receipt-fixture.json').write_text(json.dumps(vaccination_snapshot(source),sort_keys=True))
            (run/'migration-recovery-fixture.json').write_text(json.dumps(migration_recovery_snapshot(source),sort_keys=True))
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
    resume_backfill=bool(args.resume_backup and (run/'backfill-evidence.json').exists())
    if resume_backfill:
        evidence=json.loads((run/'backfill-evidence.json').read_text())
        assert evidence['migration_sha256']=={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in migration_files}, 'Resume canonical migration sources changed'
    verify_canonical=upgrade_mode or resume_backfill
    destination=project('destination',59321,verify_canonical)
    canonical_inventory=functions_snapshot(destination) if verify_canonical else None
    if upgrade_mode:
        assert canonical_inventory==upgraded_functions, 'Backfilled routines/grants/triggers differ from canonical migration order'
        evidence=json.loads((run/'backfill-evidence.json').read_text())
        evidence['canonical_functions_grants_triggers_match']=True
        evidence['post_restore_canonical_match']=False
        (run/'backfill-evidence.json').write_text(json.dumps(evidence,indent=2))
    verify_identity(destination)
    command(['docker','stop',*services(destination)])
    restore_started=time.monotonic()
    # The platform baseline has partitioned realtime tables. pg_restore --clean cannot
    # drop their inherited constraints individually; remove only this destination
    # schema first, then restore its full archived definition/data without filtering.
    sql(destination, 'drop schema if exists realtime cascade;')
    # Neutralize only this destination restore-account's creation defaults.
    # Archive ACL/default-ACL records restore the source policy; no post-restore
    # object grant rewriting is permitted. Exact canonical comparison follows.
    sql(destination, '''alter default privileges for role supabase_admin in schema public revoke all on functions from anon,authenticated,service_role;
      alter default privileges for role supabase_admin in schema public revoke all on tables from anon,authenticated,service_role;
      alter default privileges for role supabase_admin in schema public revoke all on sequences from anon,authenticated,service_role;''')
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
    if (run/'vaccination-receipt-fixture.json').exists():
        assert vaccination_snapshot(destination)==json.loads((run/'vaccination-receipt-fixture.json').read_text()), 'Restored source, decision and delivery rows must match before verification reads'
        assert migration_recovery_snapshot(destination)==json.loads((run/'migration-recovery-fixture.json').read_text()), 'Restored manifest digest and owned binding recovery differ'
    command(['node',str(root/'scripts/restore-rehearsal/fixture.mjs'),'verify',str(destination['path']/'status.json'),str(run)])
    if verify_canonical:
        assert functions_snapshot(destination)==canonical_inventory, 'Restored backfilled routines/grants/triggers differ from canonical order'
        evidence['canonical_functions_grants_triggers_match']=True
        evidence['post_restore_canonical_match']=True
        evidence['canonical_inventory_counts']={key:len(rows or []) for key,rows in canonical_inventory.items()}
        (run/'backfill-evidence.json').write_text(json.dumps(evidence,indent=2))
    vaccination_evidence = None
    if (run/'vaccination-receipt-fixture.json').exists():
        expected_vaccinations = json.loads((run/'vaccination-receipt-fixture.json').read_text())
        expected_after_reads=json.loads(json.dumps(expected_vaccinations))
        fixture_state=json.loads((run/'synthetic-fixture.json').read_text())
        verified_link_reads=0
        for key in ['releasePackages','mixedReleasePackages']:
            if fixture_state.get(key):
                grant_id=fixture_state[key]['SMS']['prepare']['p_request_id']
                budgets=[row for row in expected_after_reads['document_link_access_budget'] if row['grant_id']==grant_id]
                assert len(budgets)==1
                verified_link_reads+=2
                budgets[0]['used']+=2
        assert vaccination_snapshot(destination) == expected_after_reads, 'Restored rows differ beyond exactly verified link access accounting'
        vaccination_evidence = {'receipt_rows': len(expected_vaccinations['ezyvet_vaccination_pages']),
                               'scoped_context_rows': len(expected_vaccinations['ezyvet_vaccination_runs']),
                               'observation_rows': len(expected_vaccinations['ezyvet_vaccination_page_observations']),
                               'approved_vaccination_rows': len(expected_vaccinations['ezyvet_imported_vaccinations']),
                               'review_request_rows': len(expected_vaccinations['ezyvet_vaccination_review_requests']),
                               'approved_prescription_rows': len(expected_vaccinations['ezyvet_imported_prescriptions']),
                               'prescription_review_requests': len(expected_vaccinations['ezyvet_prescription_review_requests']),
                               'prescription_item_runs': len(expected_vaccinations['ezyvet_prescriptionitem_runs']),
                               'attachment_metadata_runs': len(expected_vaccinations['ezyvet_attachment_runs']),
                               'attachment_metadata_pages': len(expected_vaccinations['ezyvet_attachment_pages']),
                               'attachment_metadata_observations': len(expected_vaccinations['ezyvet_attachment_page_observations']),
                               'api_original_requests':len(expected_vaccinations['ezyvet_attachment_capture_requests']),
                               'api_original_intents':len(expected_vaccinations['ezyvet_attachment_original_intents']),
                               'api_original_captures':len(expected_vaccinations['ezyvet_attachment_original_captures']),
                               'api_original_approval_versions':len(expected_vaccinations['ezyvet_attachment_record_versions']),
                               'api_original_cancellations':len(expected_vaccinations['ezyvet_attachment_approval_cancellations']),
                               'frozen_release_rows': len(expected_vaccinations['record_releases']),
                               'saved_release_email_payloads':len(expected_vaccinations['release_email_payloads']),
                               'saved_document_link_payloads':len(expected_vaccinations['document_link_payloads']),
                               'source_and_receipt_rows_match': True,
                               'exact_before_verification_match':True,
                               'verified_link_read_counter_increment':verified_link_reads,
                               'after_verification_only_expected_counter_change':True,
                               'fixture_sha256': hashlib.sha256((run/'vaccination-receipt-fixture.json').read_bytes()).hexdigest()}
    # Compare the restored physical files as well as authorized downloaded original bytes.
    command(['docker','cp',docker_name(destination,'storage')+':/mnt/.',str(run/'restored-storage')])
    restored=[]
    for file in sorted((run/'restored-storage').rglob('*')):
        if file.is_file(): restored.append({'path':str(file.relative_to(run/'restored-storage')),'bytes':file.stat().st_size,'sha256':hashlib.sha256(file.read_bytes()).hexdigest()})
    assert manifest==restored, 'Physical Storage inventory/hash mismatch'
    results={'synthetic_only':True,'vaccination_receipt_restore':vaccination_evidence,'source_project':source['id'],'destination_project':destination['id'],'git_commit':command(['git','rev-parse','HEAD']).strip(),'runner_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'fixture_sha256':hashlib.sha256((root/'scripts/restore-rehearsal/fixture.mjs').read_bytes()).hexdigest(),'database_sha256':hashlib.sha256(dump).hexdigest(),'storage_files':manifest,'backup_seconds':round(backup_seconds,2) if backup_seconds is not None else None,'restore_and_verify_seconds':round(time.monotonic()-restore_started,2),'total_seconds':round(time.monotonic()-started,2),'verification':json.loads((run/'verification.json').read_text()),'sending_disabled':'No Edge runtime, provider credentials, cron or SMTP delivery configured; local Auth uses mail catcher only.'}
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
results['release_package_sources_sha256']={str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in [root/'scripts/restore-rehearsal/release-packages.mjs',*sorted((root/'supabase/functions/_shared').glob('*.ts'))]}
if verify_canonical: results['backfill']=json.loads((run/'backfill-evidence.json').read_text())
results['total_seconds']=round(time.monotonic()-started,2)
(run/'result.json').write_text(json.dumps(results,indent=2)+'\n')
print('PASS: actual isolated database and private Storage restored and cleaned; result:',run/'result.json',flush=True)
