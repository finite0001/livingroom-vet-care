"""Pure source/SQL/receipt/deadline tests, with mandatory parser; no database."""
from copy import deepcopy
import io,json,socket,subprocess,tempfile,time,unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from pglast import parse_sql,parse_plpgsql
import importlib.util,sys
from types import ModuleType

def load_exact_file(name,path):
    path=Path(path)
    assert path.is_file() and not path.is_symlink(),'Exact module file required'
    if name in sys.modules:
        module=sys.modules[name];origin=getattr(module,'__file__',None)
        assert isinstance(origin,(str,Path)) and Path(origin).resolve()==path.resolve(),'Module path collision: '+name
        return module
    spec=importlib.util.spec_from_file_location(name,path)
    assert spec is not None and spec.loader is not None
    module=importlib.util.module_from_spec(spec);sys.modules[name]=module
    try:spec.loader.exec_module(module)
    except BaseException:
        del sys.modules[name]
        raise
    return module

with patch.object(subprocess,'Popen',side_effect=AssertionError('No process during import')),patch.object(socket,'socket',side_effect=AssertionError('No socket during import')):
 r=load_exact_file('a2_positive_runtime_under_test',Path(__file__).with_name('runtime.py'))

def ids():
 import uuid
 return {**r.dep.fixture.FIXED,**{k:str(uuid.uuid5(r.dep.fixture.NS,'dynamic:'+k))for k in r.dep.fixture.DYNAMIC}}
def context():
 return {'settings':{k:(None if k in r.observations.JWT else {'role':'none','session_replication_role':'origin','transaction_isolation':'read committed','TimeZone':'UTC','search_path':'"$user", public'}[k])for k in r.observations.GUC},'session_user':'postgres','current_user':'postgres','auth_uid':None,'auth_role':None,'auth_email':None,'auth_jwt':None,'advisory':[]}
def contexts(first,stable,names):return '\n'.join(json.dumps(v)for v in [{'a2_session_initial':first}]+[{'a2_session_phase':n,'value':stable}for n in names])
def seed():return dict(kind='a2-five-product188-seed-v1',ids=ids(),backend_pid=999,backend_start='2026-10-22T00:00:00.000001+00:00',business_calls=17,supporting_calls=23,source_rows_fabricated=False,provenance_backfilled=False)

class RuntimeTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.p=patch.object(subprocess,'Popen',side_effect=AssertionError('No process in pure tests'));cls.s=patch.object(socket,'socket',side_effect=AssertionError('No socket in pure tests'));cls.p.start();cls.s.start()
 @classmethod
 def tearDownClass(cls):cls.s.stop();cls.p.stop()
 def test_fixed_package_new_bundle_and_exact_ledger(self):
  old=r.dep.fixed_admission.build();before=deepcopy(old)
  with patch.object(r.dep.fixed_admission,'build',return_value=old):bundle=r.package_bundle(lambda:None)
  self.assertEqual(old,before);self.assertIsNot(bundle,old);self.assertEqual(bundle['package']['expected_sha256'],r.EXPECTED);self.assertEqual(bundle['package']['install_sha256'],r.INSTALL)
  bad=deepcopy(bundle['package']);bad['expected_ledger206'][0]['name']='wrong'
  with patch.object(r.dep.assembly,'build',return_value=bad),self.assertRaises(AssertionError):r.package_bundle(lambda:None)
 def test_mandatory_all_sql_plpgsql(self):
  a=r.build_seed();b=r.build_positive(ids());self.assertEqual(tuple(n for n,_ in a),r.session.SEED_NAMES);self.assertEqual(tuple(n for n,_ in b),r.session.POSITIVE_NAMES)
  counts=[0,0]
  for name,sql in a+b+(('history',r.dep.fixture.history_sql(seed())),):
   counts[0]+=len(parse_sql(sql));counts[1]+=len(parse_plpgsql(sql))
  print('MANDATORY_PARSE',counts,flush=True);self.assertGreater(counts[0],500);self.assertGreater(counts[1],20)
 def test_unique_module_origins(self):
  self.assertEqual(Path(r.dep.fixed_driver.fixtures.__file__),r.dep.FIXED/'fixtures.py');self.assertEqual(Path(r.dep.fixture.__file__),r.dep.FIXTURE/'fixtures.py');self.assertIsNot(r.dep.fixture,r.dep.fixed_driver.fixtures)
  with self.assertRaises(AssertionError):r.dep.load('fixtures',r.dep.FIXTURE/'fixtures.py')
 def test_complete_source_saved_keyset_and_tamper(self):
  values=r.input_map(lambda:None);self.assertEqual(len(values),669)
  with tempfile.TemporaryDirectory()as tmp:
   folder=Path(tmp);r.freeze(folder,values,lambda:None);r.check_frozen(folder,values,lambda:None)
   extra=folder/'executed-inputs/extra.py';extra.write_text('not executed')
   with self.assertRaises(AssertionError):r.check_frozen(folder,values,lambda:None)
   extra.unlink();p=folder/'executed-inputs'/next(iter(values));p.write_bytes(p.read_bytes()+b' ')
   with self.assertRaises(AssertionError):r.check_frozen(folder,values,lambda:None)
 def test_explicit_reviewed638_baseline_and_four_file_transition(self):
  declaration=json.loads((r.HERE/'source-declaration.json').read_text());baseline=declaration['canonical_baseline'];provenance=declaration['canonical_baseline_provenance']
  self.assertEqual(len(baseline),638)
  self.assertEqual(r.sha((json.dumps(baseline,indent=2,sort_keys=True)+'\n').encode()),'68987ef56aff1da537c8a3d7ff16eead831e602909d67502998951396d6b30dc')
  added=provenance['added_files'];self.assertEqual(len(added),4);self.assertEqual({k:baseline[k]for k in added},added)
  prior={k:v for k,v in baseline.items()if k not in added};self.assertEqual(len(prior),634)
  self.assertEqual(r.sha((json.dumps(prior,indent=2,sort_keys=True)+'\n').encode()),'9138f6415099ebab1081ebfe8f169b0f13aca8d06cb4c375cf1fffa737044b54')
  self.assertEqual(provenance['source_map_sha256'],'68987ef56aff1da537c8a3d7ff16eead831e602909d67502998951396d6b30dc')
 def test_unreviewed_baseline_changes_refuse_before_dependencies(self):
  declaration=json.loads((r.HERE/'source-declaration.json').read_text());baseline=declaration['canonical_baseline'];added=declaration['canonical_baseline_provenance']['added_files']
  missing=dict(baseline);missing.pop(next(iter(added)))
  prior={k:v for k,v in baseline.items()if k not in added}
  extra={**r.dep.owned.source_inputs(),'supabase/tests/unreviewed.py':'0'*64}
  changed=dict(r.dep.owned.source_inputs());changed[next(iter(added))]='0'*64
  for values in (missing,prior,extra,changed):
   with self.subTest(keys=len(values)),patch.object(r.dep.owned,'source_inputs',return_value=values),patch.object(r.dep.fixture,'source_inputs',side_effect=AssertionError('Dependencies must not execute')),self.assertRaisesRegex(AssertionError,'Canonical source transition'):
    r.input_map(lambda:None)
 def test_callback_cutoff_and_dependency_drift(self):
  def expired():raise RuntimeError('cutoff')
  with self.assertRaisesRegex(RuntimeError,'cutoff'):r.input_map(expired)
  original=Path.read_bytes
  def changed(p):return original(p)+b' 'if p==r.dep.FIXTURE/'identity.sql'else original(p)
  with patch.object(Path,'read_bytes',changed),self.assertRaises(AssertionError):r.input_map(lambda:None)
  with tempfile.TemporaryDirectory()as tmp,self.assertRaisesRegex(RuntimeError,'cutoff'):r.freeze(Path(tmp),{'missing':'x'},expired)
 def test_canonical645_full669_exact_integration(self):
  current=r.dep.owned.source_inputs();full=r.input_map(lambda:None)
  baseline=json.loads((r.HERE/'source-declaration.json').read_text())['canonical_baseline']
  own={str((r.HERE/name).relative_to(r.ROOT))for name in r.OWN_FILES}
  self.assertEqual(len(current),645);self.assertEqual(len(own),7);self.assertEqual(set(current),set(baseline)|own)
  self.assertEqual({k:current[k]for k in baseline},baseline)
  self.assertEqual(len(full),669);self.assertTrue(all(full[k]==v for k,v in current.items()))
  self.assertFalse(any(k.startswith('tmp/a2-opening-adapter-draft/positive-runtime-draft/')for k in full))
  self.assertEqual(r.dep.ROOT,r.HERE.parents[4]);self.assertEqual(r.session.ROOT,r.dep.ROOT)
 def test_own_collector_digest_cannot_be_silently_replaced(self):
  current=r.dep.owned.source_inputs();key=str((r.HERE/'session.py').relative_to(r.ROOT));current[key]='0'*64
  with patch.object(r.dep.owned,'source_inputs',return_value=current),patch.object(r.dep.fixture,'source_inputs',side_effect=AssertionError('Dependency execution forbidden')),self.assertRaisesRegex(AssertionError,'Own source collector digest'):
   r.input_map(lambda:None)
 def test_actual_runtime_import_refuses_wrong_sibling_aliases(self):
  for key in ('a2_positive_dependencies','observations','session'):
   foreign=ModuleType(key);foreign.__file__='/not-the-reviewed-module/'+key+'.py'
   alias='a2_wrong_origin_import_regression'
   with self.subTest(key=key),patch.dict(sys.modules,{key:foreign}):
    self.assertNotIn(alias,sys.modules)
    with self.assertRaisesRegex(AssertionError,'Module path collision'):
     load_exact_file(alias,r.HERE/'runtime.py')
    self.assertNotIn(alias,sys.modules);self.assertIs(sys.modules[key],foreign)
 def test_exact_loader_reuse_missing_origin_and_harness_alias_collision(self):
  self.assertIs(r.load_exact_file('a2_positive_dependencies',r.HERE/'a2_positive_dependencies.py'),r.dep)
  self.assertIs(load_exact_file('a2_positive_runtime_under_test',r.HERE/'runtime.py'),r)
  foreign=ModuleType('originless')
  for loader in (r.load_exact_file,r.dep.load,load_exact_file):
   with patch.dict(sys.modules,{'a2_originless':foreign}),self.assertRaisesRegex(AssertionError,'Module path collision'):
    loader('a2_originless',r.HERE/'session.py')
  with patch.dict(sys.modules,{'a2_positive_runtime_under_test':foreign}):
   with self.assertRaisesRegex(AssertionError,'Module path collision'):
    load_exact_file('a2_positive_runtime_under_test',r.HERE/'runtime.py')
   self.assertIs(sys.modules['a2_positive_runtime_under_test'],foreign)
 def test_exact_loader_ignores_foreign_search_path_and_cleans_failure(self):
  with tempfile.TemporaryDirectory()as tmp:
   home=Path(tmp);good=home/'good';bad=home/'bad';good.mkdir();bad.mkdir()
   (good/'a2_loader_regression.py').write_text('VALUE=7\n')
   (bad/'a2_loader_regression.py').write_text("raise AssertionError('Foreign search path executed')\n")
   with patch.object(sys,'path',[str(bad)]+sys.path):
    try:
     loaded=r.load_exact_file('a2_loader_regression',good/'a2_loader_regression.py');self.assertEqual(loaded.VALUE,7)
    finally:sys.modules.pop('a2_loader_regression',None)
   broken=home/'broken.py';broken.write_text("raise RuntimeError('Inert exact load failure')\n")
   for loader in (r.load_exact_file,r.dep.load,load_exact_file):
    with self.assertRaisesRegex(RuntimeError,'Inert exact load failure'):loader('a2_failed_loader_regression',broken)
    self.assertNotIn('a2_failed_loader_regression',sys.modules)
 def test_actual_lazy_bootstrap_image_without_candidate_search_path(self):
  entry={'Id':'a'*64,'State':{'Running':True},'Image':'sha256:'+'b'*64,'Config':{'Image':'public.ecr.aws/supabase/postgres:17.6.1.171'}}
  image={'Os':'linux','Architecture':'arm64','RepoDigests':['public.ecr.aws/supabase/postgres@sha256:658d1c9b09ae4f61b8e95087b6859181b4b7d6940d769cf7b605609c8aad43e9']}
  services={entry['Id']:{'name':'inert-owned-db'}};commands=[]
  helper=object.__new__(r.dep.paused.PausedBootstrap)
  helper.runtime=SimpleNamespace(verify=lambda:entry,service_inventory=lambda:services,record={},save=lambda:None)
  helper.record={};helper.save=lambda:None
  def command(argv):
   self.assertEqual(argv,['docker','image','inspect',entry['Image']]);commands.append(argv)
   return SimpleNamespace(stdout=json.dumps([image]))
  helper.command=command
  without_candidate=[p for p in sys.path if Path(p or '.').resolve()!=r.dep.CANDIDATE]
  with patch.object(sys,'path',without_candidate):
   self.assertEqual(Path(sys.modules['history_environment'].__file__).resolve(),r.dep.CANDIDATE/'history_environment.py')
   helper.image()
   self.assertEqual(helper.runtime.record['owned_services'],services)
   self.assertEqual(helper.record['bootstrap_image']['reviewed_index_digest'],'sha256:658d1c9b09ae4f61b8e95087b6859181b4b7d6940d769cf7b605609c8aad43e9')
   image['RepoDigests']=['public.ecr.aws/supabase/postgres@sha256:'+'0'*64]
   with self.assertRaisesRegex(AssertionError,'content differs'):helper.image()
  self.assertEqual(len(commands),2)
 def test_bootstrap_dependency_preload_refuses_foreign_origin(self):
  foreign=ModuleType('history_environment');foreign.__file__='/foreign/history_environment.py'
  alias='a2_dependency_import_probe'
  with patch.dict(sys.modules,{'history_environment':foreign}):
   with self.assertRaisesRegex(AssertionError,'Module path collision'):
    r.load_exact_file(alias,r.HERE/'a2_positive_dependencies.py')
   self.assertNotIn(alias,sys.modules);self.assertIs(sys.modules['history_environment'],foreign)
 def test_initial_context_exception_and_later_exactness(self):
  first=context();stable=deepcopy(first)
  for k in r.observations.JWT:stable['settings'][k]=''
  r.admit_contexts(contexts(first,stable,r.session.SEED_NAMES),r.session.SEED_NAMES)
  mutations=[lambda v:v['settings'].update({'request.jwt.claims':'nonempty'}),lambda v:v['settings'].pop('request.jwt.claim.email'),lambda v:v.update(session_user='supabase_admin'),lambda v:v['settings'].update(TimeZone='America/Denver'),lambda v:v.update(advisory=[{'lock':'unexpected'}]),lambda v:v.update(auth_jwt={})]
  for mutation in mutations:
   v=deepcopy(stable);mutation(v)
   with self.assertRaises((AssertionError,KeyError)):r.admit_contexts(contexts(first,v,r.session.SEED_NAMES),r.session.SEED_NAMES)
  rows=[json.loads(x)for x in contexts(first,stable,r.session.SEED_NAMES).splitlines()];rows[-1]['value']['settings']['request.jwt.claims']=None
  with self.assertRaises(AssertionError):r.admit_contexts('\n'.join(map(json.dumps,rows)),r.session.SEED_NAMES)
 def test_seed_backend_identity(self):
  output=contexts(context(),context(),r.session.SEED_NAMES)+'\n'+json.dumps(seed());receipt={'passed':True,'client_returncode':0,'backend':{'pid':999,'backend_start':'2026-10-22T00:00:00.000001Z'}}
  r.admit_seed(output,receipt)
  for key,val in [('pid',1000),('backend_start','2026-10-22T00:00:00.000002Z')]:
   wrong=deepcopy(receipt);wrong['backend'][key]=val
   with self.assertRaises(AssertionError):r.admit_seed(output,wrong)
  self.assertEqual(r.closed_seed_sql(seed()),'select not exists(select 1 from pg_stat_activity where pid=999);')
 def test_positive_exact_outcomes_and_stability(self):
  cases=[]
  for label,*_ in r.dep.fixture.TARGETS:
   packet={'adapter':{'fixed':label},'source_rows':[]};cases.append(dict(label=label,collected=packet,adapted=packet['adapter'],independent_expected=packet,managed={},available='0.000',prepared='-2.000'if label=='K_managed_pickup_of_188_package'else '0.000',return_held='0.000',new_movements=0,new_charges=0))
  proofs=[dict(kind='a2-positive-core-values-v1',after_append=a,target_cases=8 if a else 7,cases=deepcopy(cases[:8 if a else 7]),original_seven_stable=a,synthetic_only=True,remaining_negative_limit_restore_proven=False,clinical_activation=False)for a in(False,True)]
  preserved=[dict(a2_measurement_preserved=True,after_append=a)for a in(False,True)]
  def output(p,m=preserved):return '\n'.join(map(json.dumps,p+m))+'\n'+contexts(context(),context(),r.session.POSITIVE_NAMES)
  r.admit_positive(output(proofs))
  for mutation in (lambda p:p[0].update(target_cases=True),lambda p:p[1]['cases'].reverse(),lambda p:p[0]['cases'][0].update(new_movements=False),lambda p:p[1]['cases'][0].update(managed={'changed':True})):
   wrong=deepcopy(proofs);mutation(wrong)
   with self.assertRaises(AssertionError):r.admit_positive(output(wrong))
  with self.assertRaises(AssertionError):r.admit_positive(output(proofs,[]))
 def test_measurement_complete_state_and_exclusions(self):
  setup=r.observations.measurement_setup()
  for key in ('catalog','rows','types','ledger','parent','writers','private206','metadata','session','temp_catalog','temp_rows','saved_outputs'):self.assertIn("'"+key+"'",setup)
  self.assertIn("not in('a2_before_append','a2_measure_baseline')",setup)
  a=r.observations.measured('select 123;',False);b=r.observations.measured('select 123;',True)
  self.assertIn("-'saved_outputs'",a);self.assertNotIn("-'saved_outputs'",b);self.assertLess(a.index('insert into pg_temp.a2_measure_baseline'),a.index('select 123;'));self.assertLess(a.index('select 123;'),a.index('A2 measurement state changed'));self.assertNotIn("set timezone='UTC';",setup)
 def test_deadlines_and_single_cleanup(self):
  rt=object.__new__(r.Runtime);now=time.monotonic();rt.outer_deadline=now+100;rt.setup_deadline=now+40;rt.fixed_phase_deadline=now+3;rt.final_mode=False;rt.in_cleanup=False;rt.cleanup_deadline=None;rt.bootstrap_phase_deadline=now+2;rt.candidate_phase_deadline=now+1
  self.assertLessEqual(rt.remaining(120),1);rt.begin_failure_cleanup();deadline=rt.cleanup_deadline;rt.begin_failure_cleanup();self.assertEqual(rt.cleanup_deadline,deadline)
  with self.assertRaises(AssertionError):rt.setup_remaining()
  rt.in_cleanup=False;rt.cleanup_deadline=now+10;rt.begin_failure_cleanup();self.assertEqual(rt.cleanup_deadline,now+10)
 def test_own_phases_not_aggregate_sessions(self):
  rt=object.__new__(r.Runtime);now=time.monotonic();rt.outer_deadline=now+600;rt.setup_deadline=now+540;rt.fixed_phase_deadline=None;rt.in_cleanup=False;rt.save_private=lambda n,v:None
  with rt.phase('reference_a2'):self.assertLessEqual(rt.fixed_phase_deadline,now+121)
  self.assertIsNone(rt.fixed_phase_deadline);self.assertEqual(rt.outer_deadline,now+600)
  with self.assertRaises(AssertionError):
   with rt.phase('persistent_positive206'):pass
 def test_actual_admission_counter_folder_binding(self):
  with tempfile.TemporaryDirectory()as tmp:
   rt=SimpleNamespace(folder=Path(tmp),command_number=10,deadline=time.monotonic()+600,setup_deadline=time.monotonic()+540,cleanup_deadline=None,in_cleanup=False,fixed_phase_deadline=None,candidate_phase_deadline=None,container='a'*64,endpoint='unix:///owned.sock',log=io.StringIO(),setup_remaining=lambda:None,check_config=lambda:None)
   def verify():rt.command_number+=1;return {'Id':rt.container}
   rt.verify=verify;rt.docker=lambda v:['docker','--host',rt.endpoint]+v[1:]
   def execute(s):s.admit();s.receipt.update(passed=True,client_returncode=0);return 'retained'
   with patch.object(r.session._Session,'execute',execute):out,folder,receipt=r.session.run(rt,[(n,'select 1;')for n in r.session.SEED_NAMES],'seed188')
   self.assertEqual(folder.name,'0011-phased-session');self.assertEqual(rt.command_number,12);self.assertEqual(out,'retained')
 def test_private_execution_refuses_before_any_resource(self):
  with patch.object(r,'HERE',r.ROOT/'tmp/noncanonical-a2-runtime-refusal'),patch.object(r.tempfile,'mkdtemp',side_effect=AssertionError('resource created')),self.assertRaisesRegex(AssertionError,'Private draft cannot launch'):r.execute_reviewed()
 def test_private_cli(self):
  import sys
  with patch.object(sys,'argv',['runtime.py','--run-synthetic-local']),self.assertRaises(AssertionError):r.main()
  with patch.object(sys,'argv',['runtime.py']),patch.object(r,'package_bundle',return_value={'package':{'expected_sha256':r.EXPECTED}}):r.main()


class TerminalPersistenceTests(unittest.TestCase):
 def driver_terminal(self,io_failure=False):
  from contextlib import ExitStack,contextmanager
  clock=[100.0]
  @contextmanager
  def phase(*args,**kwargs):yield
  with tempfile.TemporaryDirectory()as tmp:
   folder=Path(tmp);state={k:0 for k in ('ledger','parent','parent_literal','parent_literal_hash_valid','writers','private206','private206_literal','catalog','types')}
   helper=SimpleNamespace(transition=lambda s:None,upgrade=lambda:None,sources=lambda:None,copies=SimpleNamespace(active=folder,deferred=False,full=lambda p:None,observe=lambda:None))
   fake=SimpleNamespace(folder=folder,setup_deadline=640,outer_deadline=700,deadline=700,cleanup_deadline=None,in_cleanup=False,cleanup_started=False,fixed_helper=helper,record={'removed':False},phase=phase,start=lambda f:None,setup_remaining=lambda:120,save_private=lambda *a:None,remaining=lambda x:x,query=lambda q:'t')
   def cleanup(failed=False):fake.cleanup_started=True;fake.in_cleanup=True;fake.cleanup_deadline=700;fake.record['removed']=True;clock[0]=699.0
   fake.cleanup=cleanup
   original=Path.write_text
   def write(path,text,*a,**kw):
    value=original(path,text,*a,**kw)
    if path==folder/'result-attempted.json' and json.loads(text)['passed']:
     if io_failure:raise OSError('complete attempted write then error')
     clock[0]=701.0
    return value
   bundle={'files':[],'package':{'snapshot_sql':'snapshot','expected':{}}}
   responses=[('seed',folder/'seed',{'backend':{'pid':1}}),('positive',folder/'positive',{'backend':{'pid':2}})]
   with ExitStack()as stack:
    for obj,key,value in [(r,'HERE',r.dep.CANDIDATE/'record_review_v3_a2_positive'),(r.time,'monotonic',lambda:clock[0]),(r.tempfile,'mkdtemp',lambda **kw:str(folder)),(r.shutil,'disk_usage',lambda p:SimpleNamespace(free=4*1024**3)),(r,'package_bundle',lambda c:bundle),(r,'input_map',lambda c:{}),(r,'freeze',lambda *a:None),(r,'check_frozen',lambda *a:None),(r,'Runtime',lambda *a:fake),(r,'build_seed',lambda:()),(r,'build_positive',lambda ids:()),(r,'admit_seed',lambda *a:{'ids':{},'backend_pid':1}),(r,'admit_positive',lambda out:{}),(r,'single',lambda *a:{}),(r.dep.fixture,'history_sql',lambda v:'history'),(r.dep.fixture,'preserved',lambda *a:{}),(r.dep.bridge,'bind_package_inputs',lambda *a:None),(r.dep.bridge,'install_proof',lambda *a:state),(r.dep.capture,'snapshot',lambda fn:state),(r.dep.capture,'baseline',lambda *a:None),(r.dep.capture,'parse',lambda v:{}),(Path,'write_text',write)]:stack.enter_context(patch.object(obj,key,value))
    stack.enter_context(patch.object(r.session,'run',side_effect=responses))
    if io_failure:
     with self.assertRaisesRegex(OSError,'complete attempted write'):r.execute_reviewed()
     result=json.loads((folder/'result.json').read_text())
    else:result,_=r.execute_reviewed()
   self.assertFalse(result['passed'])
   if io_failure:self.assertEqual(result['terminal_persistence_failure']['type'],'OSError')
   else:self.assertTrue(result['terminal_deadline_failure'])
   self.assertFalse(json.loads((folder/'result.json').read_text())['passed'])
   self.assertTrue(json.loads((folder/'result-attempted.json').read_text())['passed'])
   self.assertTrue(fake.record['removed']);self.assertEqual(fake.cleanup_deadline,700)
 def test_actual_driver_late_write_fails(self):self.driver_terminal()
 def test_actual_driver_complete_write_then_error_revokes_pass(self):self.driver_terminal(True)
 def test_unreviewed_extra_canonical_source_refuses(self):
  current=r.dep.owned.source_inputs();current['unreviewed-extra.py']='f'*64
  with patch.object(r.dep.owned,'source_inputs',return_value=current),self.assertRaisesRegex(AssertionError,'transition'):r.input_map(lambda:None)

if __name__=='__main__':unittest.main(verbosity=2)
