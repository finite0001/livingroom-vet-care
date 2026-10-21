"""Actual owned Gate A acceptance; only the caller owns processes and databases."""
import copy
import hashlib
import json
from pathlib import Path
import queue
import re
import subprocess
import threading
import time
import uuid

OP1 = 'a70a0000-0000-4000-8000-000000000001'
OP2 = 'a70a0000-0000-4000-8000-000000000002'
OP3 = 'a70a0000-0000-4000-8000-000000000003'
FROZEN_FILE_SHA256 = '2e252f21c73e204bbedd8d05003a423123403077c8e774757194f40b12c08f6c'


def quote(value):
    return "'" + str(value).replace("'", "''") + "'"


def one(output):
    lines = [json.loads(line) for line in output.splitlines() if line.startswith('{')]
    assert len(lines) == 1, 'Exactly one Gate A observation required'
    return lines[0]


def failed(result, state, message, armed=None):
    assert result.returncode != 0, 'Expected backend failure did not happen'
    assert re.search(r'(?:^|\n)ERROR:\s+' + re.escape(state + ': ' + message) + r'\s*(?:\n|$)', result.stderr), 'Exact primary failure required'
    if armed is not None:
        assert re.search(r'(?:^|\n)NOTICE:\s+00000: ' + re.escape(armed) + r'\s*(?:\n|$)', result.stderr), 'Exact armed notice required'


def frozen_package(source):
    from secondary_review_descriptor import build
    path = source / 'secondary_review_descriptor_gate_a_expected.json'
    raw = path.read_bytes()
    assert hashlib.sha256(raw).hexdigest() == FROZEN_FILE_SHA256, 'Independent Gate A expected bytes changed'
    frozen = json.loads(raw)
    assert set(frozen) == {'kind','definition','definition_sha256','derivation_input_sha256'}
    assert frozen['kind'] == 'controlled-review-gate-a-independent-expected-v1'
    package = build()
    assert frozen['definition'] == package['expected']
    assert frozen['definition_sha256'] == package['expected_sha256']
    assert frozen['derivation_input_sha256'] == package['source_hashes']
    return package


def original_rows_preflight(rows, rows_sql):
    assert rows_sql.count('select pg_temp.secondary_review_all_rows();') == 1
    return rows_sql.replace('select pg_temp.secondary_review_all_rows();', '') + "\ndo $rows$ begin if pg_temp.secondary_review_all_rows() is distinct from " + quote(json.dumps(rows, sort_keys=True)) + "::jsonb then raise exception 'Original source rows changed after secondary-review barrier' using errcode='23514';end if;end $rows$;\n"


def strict_parent_catalog(before, after, added_ri, facades):
    """Allow exactly new sealed facade functions and FK-generated parent RI triggers."""
    assert before['relations'] == after['relations']
    assert before['writers'] == after['writers']
    assert before['ledger'] == after['ledger']
    assert before['engine_catalog'] == after['engine_catalog']
    old, new = copy.deepcopy(before['catalog']), copy.deepcopy(after['catalog'])
    assert set(new['functions']) - set(old['functions']) == {'public.' + name + '(jsonb)' for name in facades}
    for name in list(new['functions']):
        if name not in old['functions']:
            del new['functions'][name]
    assert len(added_ri) == 2 and len(set(added_ri)) == 2
    found = []
    for name, relation in new['relations'].items():
        kept = []
        for trigger in relation['triggers']:
            attributes = trigger['attributes']
            if attributes['oid'] in added_ri:
                assert name == 'public.controlled_stock_events' and attributes['tgisinternal']
                found.append(attributes['oid'])
            else:
                kept.append(trigger)
        relation['triggers'] = kept
    assert sorted(found) == sorted(added_ri)
    assert old == new, 'Unexpected parent raw catalog changes outside exact sealed RI triggers/facades'


class HeldBackend:
    """Keep a real psql transaction open; observe its actual PID and backend start."""
    def __init__(self, runtime, script, label):
        runtime.verify()
        self.runtime = runtime
        self.label = label
        self.lines = queue.Queue()
        self.output = []
        self.error = []
        self.script = ''
        self.writers = []
        self.write_errors = []
        argv = ['docker', 'exec', '-i', runtime.container, 'psql', '-X', '-qAt', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose']
        self.process = subprocess.Popen(argv, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, cwd=runtime.project)
        def reader(pipe, target, queue_output=False):
            log_path=runtime.folder/(label+('-stdout.log'if queue_output else'-stderr.log'))
            with log_path.open('w')as log:
                for line in pipe:
                    target.append(line)
                    log.write(line)
                    log.flush()
                    if queue_output:
                        self.lines.put(line)
            if queue_output:
                self.lines.put(None)
        self.threads = [threading.Thread(target=reader, args=(self.process.stdout,self.output,True),daemon=True), threading.Thread(target=reader,args=(self.process.stderr,self.error),daemon=True)]
        for thread in self.threads:
            thread.start()
        self.send(script + "\nselect jsonb_build_object('held_backend',pg_backend_pid(),'backend_start',(select backend_start from pg_stat_activity where pid=pg_backend_pid()));\n")
        while True:
            line = self.lines.get(timeout=runtime.remaining(120))
            assert line is not None, 'Held backend exited before ready'
            if line.startswith('{'):
                value = json.loads(line)
                if 'held_backend' in value:
                    self.identity = value
                    break

    def send(self, script):
        self.script += script
        (self.runtime.folder/(self.label+'-executed.sql')).write_text(self.script)
        self.process.stdin.write(script)
        self.process.stdin.flush()

    def send_async(self, script):
        # psql executes each input line while consuming stdin. A large installer
        # must be fed concurrently while its first advisory lock is blocked.
        self.script += script
        (self.runtime.folder/(self.label+'-executed.sql')).write_text(self.script)
        def write():
            try:
                self.process.stdin.write(script)
                self.process.stdin.flush()
            except BaseException as error:
                self.write_errors.append(error)
        thread=threading.Thread(target=write,daemon=True)
        self.writers.append(thread)
        thread.start()

    def collect(self):
        try:
            for writer in self.writers:
                writer.join(timeout=self.runtime.remaining(60))
                assert not writer.is_alive(), 'Held backend input did not drain'
            assert all(isinstance(error,BrokenPipeError)for error in self.write_errors), 'Unexpected held backend input failure'
            self.process.wait(timeout=self.runtime.remaining(60))
            try:
                self.process.stdin.close()
            except BrokenPipeError as error:
                self.write_errors.append(error)
            for thread in self.threads:
                thread.join(timeout=2)
            assert not self.write_errors or self.process.returncode!=0, 'Input failure cannot produce success'
            return subprocess.CompletedProcess([],self.process.returncode,''.join(self.output),''.join(self.error))
        finally:
            (self.runtime.folder / (self.label + '-executed.sql')).write_text(self.script)
            (self.runtime.folder / (self.label + '-stdout.log')).write_text(''.join(self.output))
            (self.runtime.folder / (self.label + '-stderr.log')).write_text(''.join(self.error))
            (self.runtime.folder / (self.label + '-input-errors.json')).write_text(json.dumps([type(error).__name__ for error in self.write_errors]))

    def finish(self, command='commit;'):
        self.send(command + '\n\\q\n')
        assert self.collect().returncode == 0, 'Held backend failed'


def barrier_probe(runtime, body, rows, rows_sql):
    assert rows['public.native_return_policy_state'] == [{'id': True, 'version': 0, 'decision_id': None}]
    holder=HeldBackend(runtime,'begin;select pg_advisory_xact_lock(90271040,0);delete from public.native_return_policy_state;', 'admission-barrier-holder')
    worker=None
    observed=None
    try:
        worker=HeldBackend(runtime,"set application_name='secondary-review-admission-wait';",'admission-barrier-waiter')
        worker.send_async('begin;'+body+'commit;\n\\q\n')
        until=time.monotonic()+30
        while time.monotonic()<until:
            observation=runtime.json("select jsonb_build_object('pid',a.pid,'backend_start',a.backend_start,'blockers',to_jsonb(pg_blocking_pids(a.pid)),'advisory_wait',exists(select 1 from pg_locks l where l.pid=a.pid and l.locktype='advisory'and l.classid=90271040::oid and l.objid=0::oid and l.objsubid=2 and l.mode='ExclusiveLock'and not l.granted))from pg_stat_activity a where a.pid="+str(worker.identity['held_backend'])+';')
            if observation['backend_start']==worker.identity['backend_start'] and holder.identity['held_backend']in observation['blockers'] and observation['advisory_wait']is True:
                observed=observation
                break
            time.sleep(.02)
        assert observed is not None, 'Actual admission PID/backend-start/blocker wait not observed'
        (runtime.folder/'observed-admission-barrier.json').write_text(json.dumps(observed,indent=2))
        holder.finish()
        failed(worker.collect(),'23514','Original source rows changed after secondary-review barrier')
        runtime.query('insert into public.native_return_policy_state values(true,0,null);')
        assert runtime.json(rows_sql)==rows
        return {'matching_pid_backend_start_blocker_observed':True,'full_original_rows_rechecked_after_wait':True}
    finally:
        if holder.process.poll()is None:
            holder.finish('rollback;')
        if worker is not None and worker.process.poll()is None:
            worker.process.terminate()
            worker.collect()


def context_probe(runtime, source):
    smoke = (source / 'smoke.sql').read_text()
    assert smoke.endswith('rollback;\n')
    context = """
insert into controlled_review.preparations(operation_id,event_id,prepared_boot,prepared_xid)
 values('__ONE__',pg_temp.engine_id('receive'),'2000-01-01'::timestamptz,'1'::xid8);
do $context$ declare p controlled_review.preparations;begin
 select * into p from controlled_review.preparations where operation_id='__ONE__';
 if p.prepared_boot<>pg_postmaster_start_time() or p.prepared_xid<>pg_current_xact_id()then raise exception 'Caller context was not overwritten';end if;
 begin perform controlled_review.require_prior_commit('__ONE__');raise exception 'Same transaction accepted';
 exception when check_violation then if sqlerrm<>'Preparation must commit before a later signing transaction'then raise;end if;end;
end $context$;
savepoint nested_context;
insert into controlled_review.preparations(operation_id,event_id)values('__TWO__',pg_temp.engine_id('adjust'));
do $context$ begin
 if (select prepared_xid from controlled_review.preparations where operation_id='__TWO__')<>pg_current_xact_id() then raise exception 'Nested XID differs from top level';end if;
 begin perform controlled_review.require_prior_commit('__TWO__');raise exception 'Nested transaction accepted';
 exception when check_violation then if sqlerrm<>'Preparation must commit before a later signing transaction'then raise;end if;end;
end $context$;
release savepoint nested_context;
""".replace('__ONE__',OP1).replace('__TWO__',OP2)
    held = HeldBackend(runtime, smoke[:-len('rollback;\n')] + context, 'new-target-context')
    try:
        absent = runtime.json("select jsonb_build_object('events',(select count(*)from public.controlled_stock_events),'preparations',(select count(*)from controlled_review.preparations));")
        assert absent == {'events':0,'preparations':0}, 'Uncommitted new event or preparation visible in another session'
        held.finish()
    except BaseException:
        if held.process.poll() is None:
            held.finish('rollback;')
        raise
    runtime.query("select controlled_review.require_prior_commit('" + OP1 + "');select controlled_review.require_prior_commit('" + OP2 + "');")
    target = runtime.query("select event_id from controlled_review.preparations where operation_id='" + OP1 + "';").strip()
    held = HeldBackend(runtime, "begin;insert into controlled_review.preparations(operation_id,event_id)values('"+OP3+"','"+target+"');", 'committed-target-context')
    try:
        assert runtime.query("select count(*)from controlled_review.preparations where operation_id='"+OP3+"';").strip() == '0'
        held.finish()
    except BaseException:
        if held.process.poll() is None:
            held.finish('rollback;')
        raise
    runtime.query("select controlled_review.require_prior_commit('" + OP3 + "');")
    return {'server_context_overwrites_caller':True,'same_transaction_refused':True,
            'nested_top_transaction_refused':True,'uncommitted_new_target_and_preparation_invisible':True,
            'committed_later_transaction_succeeds':True,'other_session_visibility_proven':True}


def native_fixture(runtime, source):
    fixture = (source.parents[3] / 'supabase/tests/native_fulfillment.test.sql').read_text()
    marker = "insert into data select 'target',"
    assert fixture.count(marker)==1
    prefix = fixture.split(marker)[0]
    prefix = prefix.replace('begin;create extension if not exists pgtap with schema extensions;set local search_path=public,extensions;select no_plan();', 'begin;set local search_path=public,extensions;')
    assert 'pgtap' not in prefix and 'no_plan()' not in prefix
    operations = (source / 'native-operations.sql').read_text()
    # Existing fixture asserted global position totals in an empty clone. This
    # NEW adapter preserves those three expected totals for its explicit product
    # beside the already committed smoke product; parent source stays unchanged.
    for channel in ('available','prepared','return_held'):
        old = "where c.channel='"+channel+"')"
        assert operations.count(old)==1, 'Reviewed native aggregate adapter differs'
        operations=operations.replace(old,"where c.channel='"+channel+"'and c.container_id in(select id from public.controlled_stock_containers where product_id=pg_temp.eid('product')))")
    marker = "select jsonb_build_object('synthetic_only',true"
    assert operations.count(marker)==1
    query = prefix + '\ncommit;\n' + (source / 'native-config.sql').read_text() + operations.split(marker)[0] + '\ncommit;'
    runtime.query(query)


def site_probe(runtime, source, rows_sql):
    native_fixture(runtime,source)
    extractor = (source/'secondary-review-acceptance.sql').read_text()
    observed = runtime.json(extractor + """
select jsonb_object_agg(event_kind,jsonb_build_object('count',n,'site_matches',matches))from(
 select e.event_kind,count(*)n,bool_and(pg_temp.review_historical_site(e.id)=(select c.controlling_site_id from public.controlled_stock_container_transitions t join public.controlled_stock_containers c on c.id=t.container_id where t.event_id=e.id order by c.id limit 1))matches
 from public.controlled_stock_events e where event_kind in('receive_inventory','adjust_inventory','record_native_dispense_return_v2:retract_disposal')group by event_kind)x;
""")
    assert set(observed)=={'receive_inventory','adjust_inventory','record_native_dispense_return_v2:retract_disposal'}
    assert all(v['count']>0 and v['site_matches']is True for v in observed.values())
    zero = runtime.sql(extractor + "select pg_temp.review_historical_site(id)from public.controlled_stock_events where event_kind='append_native_dispense_correction:clinical_annotation';", fail=False)
    failed(zero,'23514','Unsupported secondary-review historical event kind')
    before_corruption=runtime.json(rows_sql)
    # Corruption probes are privileged rolled-back fixtures, never authority for
    # normal review. No parent reseal or current-location fallback is introduced.
    for label, mutation in [
        ('missing', "alter table public.controlled_stock_container_transitions disable trigger user;delete from public.controlled_stock_container_transitions where event_id=(select id from public.controlled_stock_events where event_kind='receive_inventory');"),
        ('multiple', "alter table public.controlled_stock_containers disable trigger user;update public.controlled_stock_containers set controlling_site_id=(select controlling_site_id from public.controlled_stock_containers where product_id<>(select product_id from public.controlled_stock_events where event_kind='receive_inventory')limit 1),initial_location_id=(select initial_location_id from public.controlled_stock_containers where product_id<>(select product_id from public.controlled_stock_events where event_kind='receive_inventory')limit 1)where id=(select c.id from public.controlled_stock_containers c join public.controlled_stock_container_transitions t on t.container_id=c.id join public.controlled_stock_events e on e.id=t.event_id where e.event_kind='receive_inventory'order by c.id limit 1);"),
    ]:
        result = runtime.sql('begin;'+extractor+mutation+"select pg_temp.review_historical_site(id)from public.controlled_stock_events where event_kind='receive_inventory';commit;",fail=False)
        failed(result,'23514','Exactly one retained controlling site is required')
        assert runtime.json(rows_sql)==before_corruption
    return {'supported_event_kinds':sorted(observed),'observed_saved_event_counts':{k:v['count']for k,v in observed.items()},
            'genuine_retract_disposal_site_proven':True,'zero_container_annotation_unsupported':True,
            'missing_and_ambiguous_historical_sites_refused':True,
            'extractor_sha256':hashlib.sha256(extractor.encode()).hexdigest()}


def restart_and_restore(runtime, source, rows_sql):
    old_boot=runtime.query('select pg_postmaster_start_time();').strip()
    before=runtime.json(rows_sql)
    preparations=runtime.json("select jsonb_object_agg(operation_id,to_jsonb(p))from controlled_review.preparations p;")
    runtime.verify()
    runtime.command(['docker','restart',runtime.container],timeout=60)
    ready=False
    for _ in range(60):
        result=runtime.sql('select pg_postmaster_start_time();',fail=False)
        if result.returncode==0:
            ready=True
            assert result.stdout.strip()!=old_boot
            break
        time.sleep(.25)
    assert ready, 'Owned PostgreSQL restart did not become ready'
    runtime.query("select controlled_review.require_prior_commit(operation_id)from controlled_review.preparations;")
    assert runtime.json(rows_sql)==before
    assert runtime.json("select jsonb_object_agg(operation_id,to_jsonb(p))from controlled_review.preparations p;")==preparations
    scopes=('public','auth','storage','extensions','supabase_migrations','controlled_review')
    runtime.verify()
    dump=runtime.command(['docker','exec',runtime.container,'pg_dump','-U','postgres','--no-owner',*[f'--schema={s}'for s in scopes],'postgres'],timeout=120).stdout
    (runtime.folder/'populated-selected-schema.sql').write_text(dump)
    rewritten='\n'.join(line for line in dump.splitlines()if not line.startswith('ALTER DEFAULT PRIVILEGES')).replace('CREATE SCHEMA extensions;','CREATE SCHEMA IF NOT EXISTS extensions;')
    database='owned_review_restore_'+uuid.uuid4().hex[:10]
    marker=str(uuid.uuid4())
    runtime.query('create database '+database+';')
    runtime.databases[database]=marker
    runtime.query('comment on database '+database+' is '+quote(marker)+';')
    assert runtime.query("select shobj_description(oid,'pg_database')from pg_database where datname="+quote(database)+';').strip()==marker
    runtime.query('drop schema public;create schema extensions;create extension pgcrypto with schema extensions;create extension "uuid-ossp"with schema extensions;',database)
    runtime.query(rewritten,database)
    assert runtime.json(rows_sql,database)==before
    assert runtime.json("select jsonb_object_agg(operation_id,to_jsonb(p))from controlled_review.preparations p;",database)==preparations
    runtime.query('select controlled_review.required();select controlled_review.require_prior_commit(operation_id)from controlled_review.preparations;select controlled_stock_validate_event(id)from controlled_stock_events;',database)
    assert runtime.json(rows_sql,database)==before
    assert runtime.json(rows_sql)==before
    runtime.query('drop database '+database+' with(force);')
    assert runtime.query('select count(*)from pg_database where datname='+quote(database)+';').strip()=='0'
    del runtime.databases[database]
    return {'actual_postgres_restart':True,'post_restart_context_succeeds_without_rewriting_evidence':True,
            'selected_schema_populated_restore_exact':True,'restored_prior_commit_context_succeeds':True,
            'original_runtime_rows_unchanged_by_restore':True,'marked_restore_database_removed':True,
            'selected_schemas':list(scopes),'whole_cluster_or_storage_bytes_proven':False,
            'owner_and_default_acl_bootstrap_limits':True}


def run(runtime,source,binding,baseline,expected,preflight,rows_sql):
    from cli_atomicity import _snapshot
    from secondary_review_descriptor import FACADES
    package=frozen_package(source)
    initial=_snapshot(runtime.query)
    rows=runtime.json(rows_sql)
    parent=runtime.json('select public.controlled_stock_manifest_snapshot();')
    runtime.folder.joinpath('gate-a-initial-full-catalog.json').write_text(json.dumps(initial,sort_keys=True))
    runtime.folder.joinpath('gate-a-initial-full-rows.json').write_text(json.dumps(rows,sort_keys=True))
    admission=preflight(binding,baseline,expected)+original_rows_preflight(rows,rows_sql)
    body=admission+package['ddl']+'\n'+package['descriptor_insert']+'\nselect controlled_review.required();'
    barrier=barrier_probe(runtime,body,rows,rows_sql)
    assert _snapshot(runtime.query)==initial
    stage_markers={
        'after_schema':'create schema controlled_review authorization postgres;',
        'after_table':next(line for line in package['ddl'].splitlines()if line.startswith('create table controlled_review.preparations(')),
        'after_function':'revoke all on function controlled_review.snapshot() from public,anon,authenticated,service_role;',
        'after_trigger':'CREATE TRIGGER server_context BEFORE INSERT ON controlled_review.preparations FOR EACH ROW EXECUTE FUNCTION controlled_review.preparation_context();',
    }
    stages=[]
    for label,marker in stage_markers.items():
        assert package['ddl'].count(marker)==1
        stages.append((label,admission+package['ddl'].split(marker)[0]+marker))
    stages += [('after_descriptor',admission+package['ddl']+'\n'+package['descriptor_insert']),('before_commit',body)]
    for label,prefix in stages:
        notice='Secondary-review Gate A armed '+label
        query='begin;'+prefix+"\ndo $fail$ begin raise notice '"+notice+"';raise exception 'Secondary-review Gate A injected late failure' using errcode='P0001';end $fail$;commit;"
        failed(runtime.sql(query,fail=False),'P0001','Secondary-review Gate A injected late failure',notice)
        assert _snapshot(runtime.query)==initial
        assert runtime.json(rows_sql)==rows
    drift="alter function public.stock_writer_current()set statement_timeout='200ms';"
    result=runtime.sql('begin;'+drift+body+'commit;',fail=False)
    failed(result,'23514','Controlled coverage, code or grants changed; reviewed engine manifest required')
    assert _snapshot(runtime.query)==initial
    # Exact partial object refusal; no repair/adoption paths.
    for partial in ('create schema controlled_review;', 'create table public.prepare_controlled_secondary_review(id integer);','create function public.prepare_controlled_secondary_review(text)returns text language sql as $$select $1$$;', 'create function public.prepare_controlled_secondary_review(jsonb)returns jsonb language sql as $$select $1$$;', 'create type public.prepare_controlled_secondary_review as enum(\'partial\');'):
        result=runtime.sql('begin;'+partial+body+'commit;',fail=False)
        failed(result,'23514','Original source rows changed after secondary-review barrier' if partial.startswith('create table ') else 'Secondary-review package must be wholly absent')
        assert _snapshot(runtime.query)==initial
    runtime.query('begin;'+body+'commit;')
    observed=runtime.json(package['snapshot_sql'])
    assert observed==package['expected']
    after=_snapshot(runtime.query)
    added_ri=runtime.json("select jsonb_build_object('ids',jsonb_agg(t.oid order by t.oid))from pg_trigger t join pg_constraint k on k.oid=t.tgconstraint where k.conrelid='controlled_review.preparations'::regclass and k.conname='preparations_target_fk'and t.tgrelid='public.controlled_stock_events'::regclass;")['ids']
    strict_parent_catalog(initial,after,added_ri,FACADES)
    assert runtime.json('select public.controlled_stock_manifest_snapshot();')==parent
    assert runtime.json(rows_sql)==rows
    runtime.folder.joinpath('gate-a-installed-full-catalog.json').write_text(json.dumps(after,sort_keys=True))
    negatives=[
        ('configuration',"alter function controlled_review.require_prior_commit(uuid)set statement_timeout='200ms';"),
        ('body','create or replace function controlled_review.immutable_guard()returns trigger language plpgsql as $$begin return new;end$$;'),
        ('schema_owner','alter schema controlled_review owner to anon;'),
        ('facade_overload','create function public.prepare_controlled_secondary_review(text)returns text language sql as $$select $1$$;'),
        ('extra_type',"create type controlled_review.extra_type as enum('unexpected');"),
        ('function_acl','grant execute on function controlled_review.require_prior_commit(uuid)to authenticated;'),
        ('column_acl','grant select(event_id)on controlled_review.preparations to authenticated;'),
        ('schema_acl','grant usage on schema controlled_review to authenticated;'),
        ('constraint','alter table controlled_review.preparations drop constraint preparations_target_fk;'),
        ('guard','alter table controlled_review.preparations disable trigger server_context;'),
        ('extra','create table controlled_review.extra(id integer);'),
        ('child_ri',"do $$declare n text;begin select tgname into n from pg_trigger where tgrelid='controlled_review.preparations'::regclass and tgisinternal limit 1;execute format('alter table controlled_review.preparations disable trigger %I',n);end$$;"),
        ('parent_ri',"do $$declare n text;begin select t.tgname into n from pg_trigger t join pg_constraint k on k.oid=t.tgconstraint where k.conrelid='controlled_review.preparations'::regclass and t.tgrelid='public.controlled_stock_events'::regclass limit 1;execute format('alter table public.controlled_stock_events disable trigger %I',n);end$$;"),
    ]
    for name,mutation in negatives:
        result=runtime.sql('begin;'+mutation+'select controlled_stock_manifest_required();select controlled_review.required();commit;',fail=False,user='supabase_admin'if name in('child_ri','parent_ri')else'postgres')
        failed(result,'23514','Secondary-review metadata differs from independent descriptor')
        assert runtime.json(package['snapshot_sql'])==package['expected']
        assert _snapshot(runtime.query)==after
        assert runtime.json(rows_sql)==rows
    orphan=runtime.sql("insert into controlled_review.preparations(operation_id,event_id)values(gen_random_uuid(),gen_random_uuid());",fail=False)
    failed(orphan,'23503','insert or update on table \"preparations\" violates foreign key constraint \"preparations_target_fk\"')
    assert runtime.json(rows_sql)==rows
    context=context_probe(runtime,source)
    sites=site_probe(runtime,source,rows_sql)
    restore=restart_and_restore(runtime,source,rows_sql)
    runtime.query('select controlled_review.required();')
    assert runtime.json('select public.controlled_stock_manifest_snapshot();')==parent
    return {'kind':'controlled-secondary-review-gate-a-v1','passed':True,'protocol_implemented':False,
            'independent_expected_definition_sha256':package['expected_sha256'],'parent_frozen_manifest_unchanged':True,
            'original_rows_writers_ledger_unchanged_by_extension':True,'only_exact_parent_internal_ri_added':True,
            'injected_install_failures_rollback_full_catalog_and_rows':True,'armed_failure_stages':[label for label,_ in stages],'partial_schema_facade_type_refused':True,
            'admission_wait':barrier,'extension_drift_cases':[name for name,_ in negatives],'prior_commit':context,'historical_site':sites,'restore':restore}
