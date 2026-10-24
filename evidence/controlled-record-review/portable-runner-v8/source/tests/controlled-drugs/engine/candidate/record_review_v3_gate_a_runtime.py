"""Owned local v3 structural reference/measurement. Never protocol acceptance.

Successful normal cleanup is inside 600s reference / 1200s measurement budgets.
The independent 180s emergency cleanup reserve cannot turn a failed run into PASS.
"""
import argparse
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
import traceback
import uuid

import record_review_v3_gate_a as assembly
import record_review_v3_gate_a_descriptor as declaration
import record_review_v3_gate_a_snapshot as capture
import record_review_v3_evidence_io as evidence_io
from canonical_review_prefix import admit_canonical206

SOURCE = Path(__file__).resolve().parent
ROOT = SOURCE.parents[3]
REFERENCE_SECONDS = 600
CLEANUP_SECONDS = 180
SPEC = importlib.util.spec_from_file_location('v3_owned_base', SOURCE/'probe-secondary-review.py')
BASE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BASE)


def sha(data): return hashlib.sha256(data).hexdigest()
def q(value): return "'"+str(value).replace("'","''")+"'"


# Only newly created measurement folders opt in. Reference storage is unchanged.
COMPRESSED_MEASUREMENTS = {}
MAX_FULL_SNAPSHOTS = 224
MAX_RAW_SNAPSHOT_BYTES = 64*1024**2


def verify_compressed(folder):
    codec=COMPRESSED_MEASUREMENTS.get(str(folder))
    if codec is not None:codec.verify()


def save(folder, name, value):
    decoded=(json.dumps(value,sort_keys=True,indent=2)+'\n').encode()
    codec=COMPRESSED_MEASUREMENTS.get(str(folder))
    if codec is not None and isinstance(value,dict) and set(value)==capture.KEYS:
        codec.write(name+'.json',decoded)
    else:(folder/(name+'.json')).write_bytes(decoded)


def source_inputs():
    paths = set((ROOT/'supabase/migrations').glob('*.sql'))
    paths.update(path for path in SOURCE.rglob('*') if path.is_file() and '__pycache__' not in path.parts
                 and (path.suffix in ('.py','.sql','.json','.ts') or path.name=='LICENSE'))
    paths.update((SOURCE.parent/'release').glob('*.sql'))
    paths.update((ROOT/'supabase/tests').rglob('*.py'))
    paths.update((ROOT/'supabase/tests').rglob('*.sql'))
    paths.add(ROOT/'tests/controlled-drugs/owned_scheduler.py')
    paths.update([SOURCE.parent/'source-reader.sql',SOURCE.parent/'source-effects.sql',ROOT/'.github/workflows/ci.yml'])
    assert not any(SOURCE.rglob('__pycache__')), 'Preserve source caches outside source tree before execution'
    return {str(path.relative_to(ROOT)):sha(path.read_bytes()) for path in sorted(paths)}


def freeze(folder):
    values = source_inputs()
    for name,digest in values.items():
        path = folder/'executed-inputs'/name
        path.parent.mkdir(parents=True,exist_ok=True)
        shutil.copy2(ROOT/name,path)
        assert sha(path.read_bytes()) == digest
    save(folder,'source-hashes',values)
    return values


def verify_frozen(folder, values):
    assert source_inputs() == values, 'Complete source inventory changed'
    saved={str(path.relative_to(folder/'executed-inputs')):sha(path.read_bytes())
           for path in (folder/'executed-inputs').rglob('*') if path.is_file()}
    assert saved==values,'Complete saved source inventory or bytes changed'


def expected_config(identity):
    return f'''project_id = "{identity}"
[api]
port = 64661
[db]
port = 64662
shadow_port = 64660
major_version = 17
[studio]
enabled = false
[analytics]
enabled = false
[inbucket]
port = 64664
[auth]
site_url = "http://127.0.0.1:64661"
enable_signup = false
[storage]
enabled = true
[edge_runtime]
enabled = false
'''.encode()


def assert_config(expected, current, retained):
    assert current==retained==expected,'Generated/current config differs from independent prelaunch bytes'


def assert_owned_inventory(captured, observed):
    assert captured and set(captured)==set(observed),'Owned service immutable ID inventory changed'
    for identity in captured:
        assert captured[identity]==observed[identity],'Owned service identity/workdir changed'


def assert_removed_ids(captured, remaining):
    assert captured and not set(captured)&set(remaining),'Captured owned service still exists after cleanup'


class Runtime(BASE.OwnedRuntime):
    """Retained bootstrap with pinned local endpoint/IDs and file-backed I/O."""
    def __init__(self, folder, workload_seconds):
        context = os.environ.get('DOCKER_CONTEXT')
        if context:
            result=subprocess.run(['docker','context','inspect',context],capture_output=True,text=True,check=True,timeout=10)
            endpoint=json.loads(result.stdout)[0]['Endpoints']['docker']['Host']
        elif os.environ.get('DOCKER_HOST'): endpoint=os.environ['DOCKER_HOST']
        else:
            result=subprocess.run(['docker','context','inspect'],capture_output=True,text=True,check=True,timeout=10)
            endpoint=json.loads(result.stdout)[0]['Endpoints']['docker']['Host']
        assert endpoint.startswith('unix:///'), 'Only a local Unix Docker endpoint is admitted'
        self.full_snapshot_commands=0
        self.endpoint=endpoint;self.ids={};self.config=None;self.owned_services={};self.cleanup_deadline=None
        super().__init__(folder,workload_seconds)
        self.config=expected_config(self.identity)
        self.record['docker_endpoint']=endpoint;self.record['expected_config_sha256']=sha(self.config);self.save()

    def remaining(self, limit):
        deadline=min(self.deadline,self.cleanup_deadline) if self.cleanup_deadline is not None else self.deadline
        remaining=deadline-time.monotonic()
        assert remaining>0,'Owned workload or single cleanup deadline expired'
        return min(limit,remaining)

    def docker(self, argv):
        assert argv[0]=='docker'
        return ['docker','--host',self.endpoint]+argv[1:]

    def check_config(self):
        assert_config(self.config,(self.project/'supabase/config.toml').read_bytes(),
                      (self.folder/'generated-supabase-config.toml').read_bytes())

    def command(self, argv, text=None, timeout=120, fail=True):
        stopping=argv[:2]==['supabase','stop']
        if self.started:self.check_config()
        if argv[0]=='docker': argv=self.docker([self.ids.get(item,item) for item in argv])
        env=os.environ.copy();env.pop('DOCKER_CONTEXT',None);env['DOCKER_HOST']=self.endpoint
        if text==capture.SQL and str(self.folder) in COMPRESSED_MEASUREMENTS:
            self.full_snapshot_commands+=1
            assert self.full_snapshot_commands<=MAX_FULL_SNAPSHOTS,'Full snapshot count exceeds reviewed resource bound'
        self.command_number+=1;stem=f'{self.command_number:04d}'
        save(self.folder,stem+'-command',argv)
        codec=COMPRESSED_MEASUREMENTS.get(str(self.folder))
        if codec is not None:
            result=codec.command(argv,text,stem=stem,scratch=self.work,cwd=ROOT,env=env,timeout=self.remaining(timeout))
        else:
            input_path=self.folder/(stem+'-executed.sql')
            if text is not None: input_path.write_text(text)
            with (input_path.open() if text is not None else open(os.devnull)) as inp, (self.folder/(stem+'-stdout.log')).open('w+') as out, (self.folder/(stem+'-stderr.log')).open('w+') as err:
                process=subprocess.run(argv,stdin=inp,stdout=out,stderr=err,text=True,cwd=ROOT,env=env,timeout=self.remaining(timeout))
                out.seek(0);err.seek(0)
                result=subprocess.CompletedProcess(argv,process.returncode,out.read(),err.read())
        if text==capture.SQL and str(self.folder) in COMPRESSED_MEASUREMENTS:
            assert len(result.stdout.encode())<=MAX_RAW_SNAPSHOT_BYTES,'Raw full snapshot exceeds reviewed resource bound'
        self.log.write(stem+' '+json.dumps(argv[:3])+' exit='+str(result.returncode)+'\n');self.log.flush()
        if fail: assert result.returncode==0,'Owned command failed; retained '+stem+' logs'
        if stopping and result.returncode==0:
            remaining=self.command(['docker','ps','-aq','--no-trunc']).stdout.splitlines()
            assert_removed_ids(self.owned_services,remaining)
            save(self.folder,'captured-service-ids-removed',dict(captured=self.owned_services,all_absent=True))
        return result

    def verify(self, name=None):
        name=name or self.container
        value=super().verify(name)
        if name in self.ids: assert self.ids[name]==value['Id'],'Owned immutable container identity changed'
        self.ids[name]=value['Id'];self.ids[value['Id']]=value['Id']
        if self.started:self.check_config()
        return value

    def start(self, files):
        super().start(files)
        self.container=self.verify()['Id']
        self.check_config()
        self.owned_services=self.service_inventory()
        assert self.container in self.owned_services
        self.record['container_id']=self.container;self.record['owned_services']=self.owned_services;self.save()

    def service_inventory(self):
        identifiers=self.command(['docker','ps','-aq','--no-trunc','--filter','label=com.supabase.cli.project='+self.identity]).stdout.splitlines()
        result={}
        for identity in identifiers:
            inspected=self.verify(identity)
            assert inspected['Id']==identity
            result[identity]={'name':inspected['Name'],'project':inspected['Config']['Labels']['com.supabase.cli.project'],
                              'workdir':inspected['Config']['Labels']['com.supabase.cli.workdir']}
        return result

    def cleanup(self):
        codec=COMPRESSED_MEASUREMENTS.get(str(self.folder))
        if codec is not None:codec.begin_cleanup()
        # Begin the already-declared emergency reserve before cleanup admission.
        # Outer successful-run deadline still includes the whole normal cleanup.
        if self.cleanup_deadline is None:self.cleanup_deadline=time.monotonic()+CLEANUP_SECONDS
        self.deadline=self.cleanup_deadline
        if self.started:
            self.check_config()
            observed=self.service_inventory()
            if not self.owned_services:
                self.owned_services=observed # Failed bootstrap: admit only exact owned partial services.
                self.record['partial_bootstrap_services']=observed;self.save()
            if not self.owned_services:
                assert not observed
                assert not self.command(['docker','volume','ls','-q','--filter','label=com.supabase.cli.project='+self.identity]).stdout.strip(),'Partial bootstrap has owned volumes; cleanup not proven'
                shutil.rmtree(self.work);assert not self.work.exists()
                self.record['removed']=True;self.save()
                save(self.folder,'cleanup',dict(identity=self.identity,zero_service_bootstrap=True,containers_volumes_workdir_removed=True))
                self.log.close();return
            assert_owned_inventory(self.owned_services,observed)
        super().cleanup()


def installer(package,before):
    marker=package['markers']['admission']
    assert package['install'].count(marker)==1
    return package['install'].replace(marker,marker+'\n'+capture.under_barrier_check(before),1)


def install_proof(runtime,package,before,expected,execute=None):
    sql=installer(package,before)
    marker=package['markers']['before_postcheck']
    assert sql.count(marker)==1
    sql=sql.replace(marker,marker+'\n'+package['snapshot_sql'],1)
    result=execute(sql) if execute else runtime.sql(sql,fail=False)
    # Preserve the rendering even when the independent in-transaction assertion
    # rolls it back. It never becomes a replacement expected definition.
    observed=capture.parse(result.stdout)
    save(runtime.folder,'observed',observed)
    assert observed==expected,'Observed metadata differs from independent candidate; preserve failure and review source'
    assert result.returncode==0,'Reference transaction refused; inspect retained SQL/diagnostics'
    assert capture.parse(runtime.query(package['snapshot_sql']))==expected
    after=capture.snapshot(runtime.query);save(runtime.folder,'installed',after)
    ri=capture.parse(runtime.query(capture.PARENT_RI_SQL));save(runtime.folder,'parent-ri',ri)
    capture.preserved(before,after,ri)
    return after


MEASUREMENT_SECONDS = 1200


class Session:
    """File-backed owned psql, independently identified before waiting."""
    def __init__(self,runtime,label,script):
        self.runtime=runtime;self.label=label;runtime.verify()
        self.codec=COMPRESSED_MEASUREMENTS[str(runtime.folder)];self.retained=False
        self.codec.write(label+'-executed.sql',script.encode()) # Admit bytes before any raw scratch write.
        self.scratch=Path(tempfile.mkdtemp(prefix='pending-session-'+label+'-',dir=runtime.folder))
        self.output=self.scratch/(label+'-stdout.log')
        path=self.scratch/(label+'-executed.sql');path.write_bytes(script.encode())
        self.handles=[path.open(),self.output.open('w+'),(self.scratch/(label+'-stderr.log')).open('w+')]
        argv=runtime.docker(['docker','exec','-i',runtime.container,'psql','-X','-qAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'])
        save(runtime.folder,label+'-command',argv)
        self.process=subprocess.Popen(argv,stdin=self.handles[0],stdout=self.handles[1],stderr=self.handles[2],cwd=ROOT,text=True,preexec_fn=evidence_io.limit_output_files)

    def identity(self):
        until=time.monotonic()+self.runtime.remaining(10)
        while time.monotonic()<until:
            lines=[line for line in self.output.read_text().splitlines()if line.startswith('{')]
            if lines:
                value=capture.parse(lines[0]);assert set(value)=={'pid','backend_start'}
                assert value['pid'] and value['backend_start'];return value
            assert self.process.poll() is None,'Owned session exited before identity'
            time.sleep(.05)
        raise AssertionError('Owned backend identity deadline exceeded')

    def finish(self):
        try:
            self.process.wait(timeout=self.runtime.remaining(120))
            self.handles[1].seek(0);self.handles[2].seek(0)
            return subprocess.CompletedProcess([],self.process.returncode,self.handles[1].read(),self.handles[2].read())
        finally:self.close()

    def close(self):
        if self.process.poll() is None:
            self.process.terminate()
            try:self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:self.process.kill();self.process.wait(timeout=5)
        for handle in self.handles:
            if not handle.closed:handle.close()
        if not self.retained:
            for suffix in ('-stdout.log','-stderr.log'):
                self.codec.write(self.label+suffix,(self.scratch/(self.label+suffix)).read_bytes())
            stdout=(self.scratch/(self.label+'-stdout.log')).read_text()
            stderr=(self.scratch/(self.label+'-stderr.log')).read_text()
            self.retained=True
            shutil.rmtree(self.scratch) # Only after exact durable output roundtrips.
            evidence_io.assert_output_bound(subprocess.CompletedProcess([],self.process.returncode,stdout,stderr))



IDENTITY_SQL="select jsonb_build_object('pid',pg_backend_pid(),'backend_start',(select backend_start from pg_stat_activity where pid=pg_backend_pid()));\n"


def reference_handshake(reference,transition,current,admitted):
    provenance=admitted['reference_provenance']
    assert sha((reference/'result.json').read_bytes())==provenance['result_sha256']
    assert sha((reference/'source-hashes.json').read_bytes())==provenance['source_map_sha256']
    receipt=json.loads((reference/'result.json').read_text(),object_pairs_hook=declaration.unique)
    assert receipt['kind']=='record-review-v3-gate-a-reference-v1' and receipt['passed'] is True
    assert receipt['acceptance'] is False and receipt['all_owned_cleanup_verified'] is True
    old=json.loads((reference/'source-hashes.json').read_text(),object_pairs_hook=declaration.unique)
    assert len(old)==provenance['source_input_count']
    saved={str(p.relative_to(reference/'executed-inputs')):sha(p.read_bytes())for p in(reference/'executed-inputs').rglob('*')if p.is_file()}
    assert saved==old
    assert json.loads((reference/'independent-expected.json').read_text())==admitted['expected']
    assert json.loads((reference/'observed.json').read_text())==admitted['expected']
    reviewed=json.loads(transition.read_text(),object_pairs_hook=declaration.unique)
    assert set(reviewed)=={'kind','approved','reference_source_hashes','measurement_source_hashes','wrapper_sha256'}
    assert reviewed['kind']=='record-review-v3-gate-a-source-transition-review-v1' and reviewed['approved'] is True
    assert reviewed['reference_source_hashes']==old and reviewed['measurement_source_hashes']==current
    assert reviewed['wrapper_sha256']==admitted['wrapper_sha256']
    # Every original finite derivation/admission input remains exact, regardless
    # of explicitly reviewed new probe/helper files in the complete union delta.
    for name,digest in admitted['derivation_input_sha256'].items():assert old[name]==current[name]==digest
    return dict(reference_result_sha256=sha((reference/'result.json').read_bytes()),
                transition_review_sha256=sha(transition.read_bytes()),full_inventory_transition_verified=True)


def failure(runtime,label,script,message,code='23514',user='postgres'):
    before=capture.snapshot(runtime.query);save(runtime.folder,label+'-before',before)
    result=runtime.sql(script,fail=False,user=user)
    capture.primary_failure(result,code,message)
    after=capture.snapshot(runtime.query);save(runtime.folder,label+'-after',after)
    assert after==before,'Failed transaction changed full selected snapshot: '+label
    return dict(case=label,sqlstate=code,message=message,full_snapshot_rollback=True)


def admission_negatives(runtime,package,before):
    results=[]
    for name,marker in package['markers'].items():
        message='V3 armed installation failure '+name
        script=installer(package,before).replace(marker,marker+"\ndo $fault$begin raise exception '"+message+"' using errcode='P0001';end$fault$;",1)
        results.append(failure(runtime,'install-stage-'+name,script,message,'P0001'))
    facade=declaration.FACADES[0]
    partials={
        'schema':'create schema controlled_review_v3;',
        'facade':'create function public.'+facade+'(jsonb)returns jsonb language sql as $$select $1$$;',
        'overload':'create function public.'+facade+'(text)returns text language sql as $$select $1$$;',
        'table':'create table public.'+facade+'(id int);',
        'type':"create type public."+facade+" as enum('fixture');"}
    for name,ddl in partials.items():
        # Exercise the explicit independently assembled absence gate, not an
        # earlier unrelated full-row observation mismatch.
        results.append(failure(runtime,'partial-'+name,'begin;'+ddl+package['preflight_sql']+'commit;',
                               'Record-review v3 Gate A package must be wholly absent'))
    replica='set local session_replication_role=replica;'
    origin='set local session_replication_role=origin;'
    parents={
        'parent205_literal':(replica+"update public.controlled_stock_engine_manifests set definition='{}';"+origin,
                             'Controlled coverage, code or grants changed'),
        'parent205_code':('alter function public.controlled_stock_manifest_snapshot() cost 101;',
                          'Controlled coverage, code or grants changed'),
        'private206_literal':(replica+"update controlled_review.descriptor set definition='{}';"+origin,
                              'Unchanged frozen-205 parent revision and independent literal required'),
        'private206_code':('alter function controlled_review.snapshot() cost 101;',
                           'Secondary-review metadata differs from independent descriptor')}
    for row in package['expected_ledger206'][-2:]:
        parents['ledger'+row['version']]=("update supabase_migrations.schema_migrations set statements=array['synthetic drift']where version="+q(row['version'])+';',
                                         'Record-review v3 exact206 ledger row mismatch')
    for name,(sql,message)in parents.items():
        results.append(failure(runtime,name,'begin;'+sql+package['preflight_sql']+'commit;',message,user='supabase_admin'))
    for side in ('child','parent'):
        target='c.conrelid' if side=='child' else 'c.confrelid'
        sql="do $old_ri$declare r record;n int:=0;begin for r in select t.tgname,t.tgrelid::regclass relation from pg_trigger t join pg_constraint c on c.oid=t.tgconstraint where c.connamespace='controlled_review'::regnamespace and c.conname='preparations_event_fk'and t.tgisinternal and t.tgrelid="+target+" loop execute format('alter table %s disable trigger %I',r.relation,r.tgname);n:=n+1;end loop;if n<>2 then raise exception 'Exact two old RI triggers required'using errcode='P0003';end if;end$old_ri$;"
        results.append(failure(runtime,'private206_'+side+'_ri','begin;'+sql+
            'select public.controlled_stock_manifest_required();select controlled_review.required();commit;',
            'Secondary-review metadata differs from independent descriptor',user='supabase_admin'))
    save(runtime.folder,'admission-negatives',results)
    return results


def observed_wait_matches(identity,holder,observed):
    assert len(observed)==1
    value=observed[0]
    assert value['pid']==identity['pid'] and value['backend_start']==identity['backend_start']
    assert int(value['classid'])==90271040 and int(value['objid'])==0 and value['objsubid']==2
    assert value['waitstart'] and value['query_start'] and holder['pid'] in value['blockers']
    assert value['granted'] is False and value['mode']=='ExclusiveLock'
    return value


def blocked_install(runtime, before, script, *, drift, label):
    holder_token=label+'-holder-'+uuid.uuid4().hex;waiter_token=label+'-waiter-'+uuid.uuid4().hex
    mutation='delete from public.native_return_policy_state;' if drift else ''
    holder=Session(runtime,label+'-holder','begin;set application_name='+q(holder_token)+
        ';select pg_advisory_xact_lock_shared(90271040,0);'+mutation+IDENTITY_SQL+
        "do $sleep$begin perform pg_sleep(110);exception when query_canceled then null;end$sleep$;commit;")
    worker=None
    try:
        owner=holder.identity()
        worker=Session(runtime,label+'-waiter','set application_name='+q(waiter_token)+';'+IDENTITY_SQL+script)
        identity=worker.identity();until=time.monotonic()+runtime.remaining(10);observed=[]
        while time.monotonic()<until:
            observed=capture.parse(runtime.query("select coalesce(jsonb_agg(jsonb_build_object('pid',a.pid,'backend_start',a.backend_start,'query_start',a.query_start,'waitstart',l.waitstart,'classid',l.classid,'objid',l.objid,'objsubid',l.objsubid,'granted',l.granted,'mode',l.mode,'blockers',pg_blocking_pids(a.pid))),'[]')from pg_stat_activity a join pg_locks l on l.pid=a.pid where a.pid="+str(identity['pid'])+" and a.backend_start="+q(identity['backend_start'])+"::timestamptz and a.application_name="+q(waiter_token)+" and l.locktype='advisory'and not l.granted;"))
            if observed:break
            time.sleep(.05)
        waiter=observed_wait_matches(identity,owner,observed)
        held=capture.parse(runtime.query("select coalesce(jsonb_agg(jsonb_build_object('pid',a.pid,'backend_start',a.backend_start,'mode',l.mode,'granted',l.granted)),'[]')from pg_stat_activity a join pg_locks l on l.pid=a.pid where a.pid="+str(owner['pid'])+" and a.backend_start="+q(owner['backend_start'])+"::timestamptz and l.locktype='advisory'and l.classid=90271040 and l.objid=0 and l.objsubid=2;"))
        assert held==[dict(pid=owner['pid'],backend_start=owner['backend_start'],mode='ShareLock',granted=True)]
        invisible=capture.snapshot(runtime.query);save(runtime.folder,label+'-while-held',invisible)
        assert invisible==before
        save(runtime.folder,label+'-observer',dict(holder=owner,holder_lock=held,waiter=waiter,full_old_snapshot_visible=True))
        cancelled=runtime.query("select pg_cancel_backend(pid)from pg_stat_activity where pid="+str(owner['pid'])+" and backend_start="+q(owner['backend_start'])+"::timestamptz and application_name="+q(holder_token)+"and wait_event='PgSleep';").strip()
        assert cancelled=='t','Only exact owned holder sleep may be cancelled'
        assert holder.finish().returncode==0,'Caught sleep cancellation must commit the exact fixture transaction'
        result=worker.finish();worker=None
        lines=result.stdout.splitlines();assert capture.parse(lines[0])==identity
        result.stdout='\n'.join(lines[1:])+'\n' # Strip only the independently bound identity observation.
        return result
    finally:
        if worker:worker.close()
        holder.close()


def barrier_drift(runtime,package,before):
    assert before['rows']['public.native_return_policy_state']==[{'id':True,'version':0,'decision_id':None}]
    result=blocked_install(runtime,before,installer(package,before),drift=True,label='barrier-drift')
    capture.primary_failure(result,'23514','V3 original pre-lock snapshot changed')
    after=capture.snapshot(runtime.query);save(runtime.folder,'barrier-after-refusal',after)
    expected=copy.deepcopy(before);expected['rows']['public.native_return_policy_state']=[]
    assert after==expected,'Only independently expected committed singleton deletion is allowed'
    runtime.query('insert into public.native_return_policy_state(id,version,decision_id)values(true,0,null);')
    restored=capture.snapshot(runtime.query);save(runtime.folder,'barrier-fixture-restored',restored)
    assert restored==before
    return dict(actual_pid_start_query_start_key_blocker_bound=True,shared_holder=True,
                prelock_full_snapshot_recheck_refused=True,exact_committed_fixture_delta=True,
                full_original_restored=True,sqlstate='23514')


def old_population_negative(runtime,package):
    sql="""insert into controlled_review.definitions(id,product_id,site_id,event_kind,capability,version,enabled,roles)
 select gen_random_uuid(),e.product_id,c.controlling_site_id,'receive_inventory','review',1,true,array['DVM']
 from public.controlled_stock_events e join public.controlled_stock_container_transitions t on t.event_id=e.id
 join public.controlled_stock_containers c on c.id=t.container_id order by e.sequence limit 1;
 do $fixture$begin if(select count(*)from controlled_review.definitions)<>1 then raise exception 'Expected valid old definition fixture';end if;end$fixture$;
"""
    return failure(runtime,'old-private-population','begin;'+sql+package['preflight_sql']+'commit;',
                   'Secondary-review private release must not seed eligibility or evidence')


def metadata_negatives(runtime,package):
    facade=declaration.FACADES[0]
    mutations={
      'schema_acl':'grant usage on schema controlled_review_v3 to authenticated;',
      'schema_owner':'alter schema controlled_review_v3 owner to supabase_admin;',
      'table_acl':'grant select on controlled_review_v3.descriptor to authenticated;',
      'column_acl':'grant select(id)on controlled_review_v3.descriptor to authenticated;',
      'extra_table':'create table controlled_review_v3.extra(id int);',
      'extra_type':"create type controlled_review_v3.extra_type as enum('x');",
      'extra_index':'create index extra_idx on controlled_review_v3.obligations(product_id);',
      'removed_constraint':'alter table controlled_review_v3.obligations drop constraint obligations_event_fk;',
      'facade_overload':'create function public.'+facade+'(text)returns text language sql as $$select $1$$;',
      'facade_table':'create table public.'+facade+'(id int);',
      'facade_type':"create type public."+facade+" as enum('x');",
      'function_body':"create or replace function controlled_review_v3.immutable_guard()returns trigger language plpgsql set search_path=pg_catalog,public,pg_temp as $$begin return null;end$$;",
      'function_guc':"alter function controlled_review_v3.snapshot() set timezone='America/Denver';",
      'function_owner':'alter function controlled_review_v3.snapshot()owner to supabase_admin;',
      'function_definer':'alter function public.'+facade+'(jsonb)security invoker;',
      'facade_acl':'grant execute on function public.'+facade+'(jsonb)to authenticated;',
      'disabled_guard':'alter table controlled_review_v3.obligations disable trigger user;'}
    for side in ('child','parent'):
        target='c.conrelid'if side=='child'else'c.confrelid'
        mutations[side+'_ri']="do $ri$declare r record;begin for r in select t.tgname,t.tgrelid::regclass relation from pg_trigger t join pg_constraint c on c.oid=t.tgconstraint where c.connamespace='controlled_review_v3'::regnamespace and c.conname='obligations_event_fk'and t.tgrelid="+target+" loop execute format('alter table %s disable trigger %I',r.relation,r.tgname);end loop;end$ri$;"
    results=[]
    for name,sql in mutations.items():
        # Both unchanged old seals must STILL pass even for new parent RI drift.
        check='select public.controlled_stock_manifest_required();select controlled_review.required();select controlled_review_v3.required();'
        results.append(failure(runtime,'metadata-'+name,'begin;'+sql+check+'commit;',
            'Record-review v3 Gate A metadata differs from independent descriptor',user='supabase_admin'if name in ('schema_owner','function_owner','child_ri','parent_ri')else'postgres'))
    return results


def access_and_stubs(runtime):
    results=[]
    # PUBLIC is an ACL grantee, not a SET ROLE target. Actual three app roles
    # inherit PUBLIC privileges, and the independently sealed ACL excludes it.
    for role in ('anon','authenticated','service_role'):
        for name,statement in (('table','select * from controlled_review_v3.descriptor;'),
            ('column','select id from controlled_review_v3.descriptor;'),
            ('insert','insert into controlled_review_v3.operation_claims default values;'),
            ('helper','select controlled_review_v3.required();'),
            ('facade','select public.'+declaration.FACADES[0]+"('{}'::jsonb);")):
            results.append(failure(runtime,'access-'+role+'-'+name,'begin;set local role '+role+';'+statement+'commit;','permission denied','42501'))
    for name in declaration.FACADES:
        results.append(failure(runtime,'public-stub-'+name,'begin;select public.'+name+"('{}'::jsonb);commit;",'structural Gate A','0A000'))
    for name in declaration.PRIVATE_STUBS:
        results.append(failure(runtime,'private-stub-'+name,'begin;select controlled_review_v3.'+name+"('{}'::jsonb);commit;",'structural Gate A','0A000'))
    for name in declaration.TABLES:
        if name=='descriptor':continue
        results.append(failure(runtime,'insert-stub-'+name,'begin;insert into controlled_review_v3.'+name+' default values;commit;','operational writes are not implemented','0A000'))
    for operation in ('update controlled_review_v3.descriptor set id=id','delete from controlled_review_v3.descriptor','truncate controlled_review_v3.descriptor'):
        results.append(failure(runtime,'immutable-'+operation.split()[0],'begin;'+operation+';commit;','Gate A evidence is immutable'))
    # Deliberately bypass only USER guards inside the rollback transaction to
    # isolate the immediate cross-parent FK, not to claim protocol admission.
    orphan="""begin;alter table controlled_review_v3.obligations disable trigger user;
 insert into controlled_review_v3.obligations(event_id,product_id,event_sequence,meaning,target,target_hash,adapter,historical,binding_hash,materialized_at)
 values('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',1,'independent_record_review_v1','{}',repeat('a',64),'{}','{}',repeat('a',64),clock_timestamp());commit;"""
    results.append(failure(runtime,'orphan-cross-parent-fk',orphan,'obligations_event_fk','23503'))
    return results


def complete_measurement(proof,package):
    assert set(proof)=={'admission','barrier','clean_wait','seed','old_population','metadata','access','restore','final_seals','final_full_snapshot_unchanged'}
    admission=proof['admission'];assert len(admission)==21
    expected_admission={'install-stage-'+k for k in declaration.MARKERS}|{'partial-'+k for k in ('schema','facade','overload','table','type')}|{'parent205_literal','parent205_code','private206_literal','private206_code','private206_child_ri','private206_parent_ri'}|{'ledger'+r['version']for r in package['expected_ledger206'][-2:]}
    assert {r['case']for r in admission}==expected_admission
    assert {r['case']for r in admission if r['case'].startswith('install-stage-')}=={'install-stage-'+k for k in declaration.MARKERS}
    assert all(r['sqlstate']=='P0001'for r in admission if r['case'].startswith('install-stage-'))
    expected_metadata={'metadata-'+k for k in ('schema_acl','schema_owner','table_acl','column_acl','extra_table','extra_type','extra_index','removed_constraint','facade_overload','facade_table','facade_type','function_body','function_guc','function_owner','function_definer','facade_acl','disabled_guard','child_ri','parent_ri')}
    expected_access={'access-'+role+'-'+name for role in ('anon','authenticated','service_role') for name in ('table','column','insert','helper','facade')}|{'public-stub-'+n for n in declaration.FACADES}|{'private-stub-'+n for n in declaration.PRIVATE_STUBS}|{'insert-stub-'+n for n in declaration.TABLES if n!='descriptor'}|{'immutable-update','immutable-delete','immutable-truncate','orphan-cross-parent-fk'}
    assert len(proof['metadata'])==19 and {r['case']for r in proof['metadata']}==expected_metadata
    assert len(proof['access'])==45 and {r['case']for r in proof['access']}==expected_access
    assert proof['old_population']['case']=='old-private-population'
    for family in (admission,proof['metadata'],proof['access'],[proof['old_population']]):
        assert all(r['full_snapshot_rollback'] is True for r in family)
    assert all(proof['barrier'][key] is True for key in ('actual_pid_start_query_start_key_blocker_bound','shared_holder','prelock_full_snapshot_recheck_refused','exact_committed_fixture_delta','full_original_restored'))
    assert proof['barrier']['sqlstate']=='23514'
    assert all(proof['clean_wait'][k] is True for k in ('shared_holder','actual_pid_start_query_start_key_blocker_bound','full_old_snapshot_visible','installed_after_release'))
    assert proof['seed']['genuine_canonical_writer_history'] is True
    assert proof['restore']['passed'] is True and proof['restore']['source_full_snapshot_unchanged'] is True
    from record_review_v3_gate_a_restore import validate_refusal_matrix
    assert validate_refusal_matrix(proof['restore']['refusal_cases'])==proof['restore']['refusal_case_names']
    assert proof['final_seals'] is True and proof['final_full_snapshot_unchanged'] is True


def measurement(runtime,package,before):
    from record_review_v3_gate_a_restore import seed,restore
    saver=lambda name,value:save(runtime.folder,name,value)
    result={'admission':admission_negatives(runtime,package,before),'barrier':barrier_drift(runtime,package,before)}
    result['seed']=seed(runtime,SOURCE,saver)
    runtime.query(package['preflight_sql'])
    populated=capture.snapshot(runtime.query);capture.baseline(populated,package);save(runtime.folder,'populated206-before',populated)
    result['old_population']=old_population_negative(runtime,package)
    installed=install_proof(runtime,package,populated,package['expected'],
        execute=lambda script:blocked_install(runtime,populated,script,drift=False,label='barrier-clean'))
    result['clean_wait']={'shared_holder':True,'actual_pid_start_query_start_key_blocker_bound':True,'full_old_snapshot_visible':True,'installed_after_release':True}
    result['metadata']=metadata_negatives(runtime,package)
    result['access']=access_and_stubs(runtime)
    result['restore']=restore(runtime,package,saver)
    runtime.query(package['postcheck_sql']);result['final_seals']=True
    final=capture.snapshot(runtime.query);save(runtime.folder,'measurement-final-snapshot',final)
    assert final==installed
    result['final_full_snapshot_unchanged']=True
    complete_measurement(result,package)
    return result


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run-synthetic-local',action='store_true',required=True)
    modes=parser.add_mutually_exclusive_group(required=True)
    modes.add_argument('--reference',action='store_true');modes.add_argument('--measurement',action='store_true')
    parser.add_argument('--reference-evidence',type=Path);parser.add_argument('--reviewed-transition',type=Path)
    args=parser.parse_args()
    os.umask(0o077)
    if args.measurement:
        assert args.reference_evidence is not None and args.reviewed_transition is not None
        from record_review_v3_gate_a_admission import admit
        admitted_artifact=admit(SOURCE);package=admitted_artifact['package'];expected=admitted_artifact['expected']
    else:
        assert args.reference_evidence is None and args.reviewed_transition is None
        admitted_artifact=None;package=assembly.build();expected=package['expected']
    required=(16 if args.measurement else 3)*1024**3+2*sum((ROOT/name).stat().st_size for name in source_inputs())
    free=shutil.disk_usage(tempfile.gettempdir()).free
    assert free>=required,'Insufficient free space for retained reference inputs/raw snapshots; no deletion authorized'
    folder=Path(tempfile.mkdtemp(prefix='lrv-review-v3-gate-a-evidence-'))
    if args.measurement:
        COMPRESSED_MEASUREMENTS[str(folder)]=evidence_io.Evidence(folder)
    save(folder,'disk-admission',dict(free_bytes=free,required_bytes=required))
    frozen=freeze(folder);save(folder,'independent-expected',expected)
    save(folder,'derivation-source-hashes',package['source_hashes'])
    if args.measurement:save(folder,'reference-handshake',reference_handshake(args.reference_evidence,args.reviewed_transition,frozen,admitted_artifact))
    budget=MEASUREMENT_SECONDS if args.measurement else REFERENCE_SECONDS
    start=time.monotonic();deadline=start+budget;runtime=Runtime(folder,budget)
    runtime.deadline=deadline # Initial local-context inspection consumes this same workload budget.
    error=None;complete=False;outcomes={}
    print('Protected evidence: '+str(folder),flush=True)
    try:
        admitted=admit_canonical206(SOURCE,sorted((ROOT/'supabase/migrations').glob('*.sql')))
        files=admitted['prefix205']+[ROOT/'supabase/migrations'/admitted['binding206']['filename']]
        runtime.start(files)
        runtime.query(package['preflight_sql'])
        before=capture.snapshot(runtime.query);capture.baseline(before,package);save(folder,'canonical206-before',before)
        if args.measurement:outcomes=measurement(runtime,package,before)
        else:install_proof(runtime,package,before,expected)
        verify_frozen(folder,frozen);verify_compressed(folder);complete=True
    except BaseException as exc:
        error=type(exc).__name__+': '+str(exc);(folder/'failure.txt').write_text(traceback.format_exc())
        raise
    finally:
        try:
            runtime.cleanup()
            verify_frozen(folder,frozen);verify_compressed(folder)
        except BaseException as exc:
            error=(error or '')+' cleanup: '+str(exc);raise
        finally:
            passed=complete and error is None and runtime.record['removed'] is True and time.monotonic()<deadline
            save(folder,'result',dict(kind='record-review-v3-gate-a-'+('measurement'if args.measurement else'reference')+'-v1',
                passed=passed,acceptance=False,workload_seconds=budget,emergency_cleanup_seconds=CLEANUP_SECONDS,
                elapsed_seconds=round(time.monotonic()-start,3),all_owned_cleanup_verified=runtime.record['removed'],
                outcomes=outcomes,source_input_count=len(frozen),source_map_sha256=sha((folder/'source-hashes.json').read_bytes()),
                independent_expected_sha256=package['expected_sha256'],install_sha256=package['install_sha256'],
                admitted_artifact=bool(admitted_artifact),protocol_behavior_claim=False,clinical_activation=False,hosted_writes=0,error=error))
    assert passed,'Workload/cleanup/source proof incomplete; no PASS'
    print('PASS structural '+('measurement'if args.measurement else'reference')+' only: '+str(folder/'result.json'),flush=True)


if __name__=='__main__':main()
