"""Pure fixed partition/context tests. No old target imports or historical copies."""
from copy import deepcopy
import hashlib
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace
import time
import unittest

HERE=Path(__file__).resolve().parent
s=importlib.util.spec_from_file_location('historical_partition_under_test',HERE/'historical_partition.py')
hp=importlib.util.module_from_spec(s);s.loader.exec_module(hp)
SPEC_RAW=(HERE/'historical-boundary-draft/boundary-spec.json').read_bytes()
SPEC=json.loads(SPEC_RAW)


def fixed_job(ordinal=0):
 profile='stored638'if ordinal<5 else'a2_669'
 current=deepcopy(SPEC['current656']);current.update(deepcopy(hp.SOURCES))
 implementation={name:{'bytes':1,'sha256':'0'*64}for name in ('implementation/worker.py','implementation/results.py','implementation/guard/launch_guard.py','implementation/guard/physical.py','implementation/guard_report.py','implementation/historical_partition.py')}
 current.update(implementation)
 baseline={k:{'bytes':v['bytes'],'sha256':v['sha256']}for k,v in SPEC['profiles'][profile]['members'].items()}
 return {'kind':'portable-worker-job-v2','job_id':'partition_'+str(ordinal),'deadline':time.monotonic()+100,
 'suite':{'kind':'historical_boundary','tree_tag':'current','relative':hp.SUITE,'classes':[hp.CLASS],
          'expected_ids':list(hp.ALL_IDS),'id_map':dict(zip(hp.SHORT_IDS,hp.ALL_IDS))},
 'guard':{'contract_root':'/owned/policy','source_trees':[
    {'tag':'current','root':'/owned/repository','profile':'current','files':current},
    {'tag':'historical','root':'/owned/historical','profile':profile,'files':baseline}],
    'tools':{},'clean_env':{},'worker_cwd':'/owned/repository','suite_id':hp.SUITE,'suite_tree_tag':'current',
    'extra_test_inventory':{i:{'source':hp.SUITE,'sha256':hp.SOURCES[hp.SUITE]['sha256']}for i in hp.ALL_IDS},
    'historical_templates':None,'historical_route':None},
 'implementation':{'tree_tag':'current','files':implementation},
 'output':{'directory':'/owned/output','terminal_name':'terminal.json','guard_name':'guard.json'},
 'historical638':None,
 'partition':{'inventory_sha256':hp.INVENTORY_SHA,'all_ids':list(hp.ALL_IDS),'selected_id':hp.ALL_IDS[ordinal],'ordinal':ordinal,'partitions':8}}


def admitted(job):
 return {t['tag']:SimpleNamespace(tag=t['tag'],profile=t['profile'],root=SimpleNamespace(path=t['root'],dev=11,ino=index+21),
       files={name:SimpleNamespace(size=meta['bytes'],sha256=meta['sha256'])for name,meta in t['files'].items()})
       for index,t in enumerate(job['guard']['source_trees'])}


class HistoricalPartitionTests(unittest.TestCase):
 def test_independent_literals_match_reviewed_cases_and_spec_bytes(self):
  raw=(HERE/'historical-boundary-draft/cases.json').read_bytes();self.assertEqual(hashlib.sha256(raw).hexdigest(),hp.INVENTORY_SHA)
  cases=json.loads(raw)['tests'];self.assertEqual([r['stable_id']for r in cases],list(hp.ALL_IDS));self.assertEqual([r['id']for r in cases],list(hp.SHORT_IDS))
  self.assertEqual(hashlib.sha256(SPEC_RAW).hexdigest(),hp.SPEC_SHA)
  for relative,meta in hp.SOURCES.items():
   name='boundary_cases.py'if relative==hp.SUITE else Path(relative).name
   raw=(HERE/'historical-boundary-draft'/name).read_bytes();self.assertEqual({'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()},meta)
 def test_eight_exact_ordinals_return_singletons_and_complete_context(self):
  union=[]
  for index in range(8):
   job=fixed_job(index);ids=hp.execution_ids(job,lambda:None);union+=ids
   args=hp.context_arguments(job,admitted(job),SPEC_RAW,lambda:None)
   self.assertEqual(set(args),{'repository_root','tree_root','evidence_parent','root_identity','baseline_map','current_map','profile','selected_id','deadline'})
   self.assertEqual(args['selected_id'],hp.SHORT_IDS[index]);self.assertEqual(args['deadline'],job['deadline']);self.assertEqual(args['root_identity'],(11,22))
   self.assertEqual(len(args['baseline_map']),639 if index<5 else 669);self.assertEqual(len(args['current_map']),656)
   self.assertIsInstance(args['baseline_map'],tuple);self.assertIsInstance(args['baseline_map'][0],tuple)
  self.assertEqual(union,list(hp.ALL_IDS));self.assertEqual(len(set(union)),8)
 def test_partition_exact_fields_types_hash_order_duplicates_and_selection(self):
  changes={'inventory_sha256':['0'*64,None], 'all_ids':[list(reversed(hp.ALL_IDS)),list(hp.ALL_IDS[:-1]),list(hp.ALL_IDS)+[hp.ALL_IDS[0]]],
   'selected_id':[hp.ALL_IDS[1],'other',None], 'ordinal':[True,-1,8,0.0], 'partitions':[True,1,8.0]}
  for name,values in changes.items():
   for value in values:
    job=fixed_job();job['partition'][name]=value
    with self.subTest(name=name,value=value),self.assertRaises(ValueError):hp.execution_ids(job,lambda:None)
  for mutation in ('missing','extra','none'):
   job=fixed_job()
   if mutation=='missing':del job['partition']['partitions']
   elif mutation=='extra':job['partition']['extra']=False
   else:job['partition']=None
   with self.assertRaises(ValueError):hp.execution_ids(job,lambda:None)
 def test_full_suite_class_map_and_order_cannot_shrink_or_alias(self):
  for name,value in [('relative','else.py'),('classes',[hp.CLASS,'Other']),('expected_ids',[hp.ALL_IDS[0]]),('expected_ids',list(reversed(hp.ALL_IDS))),('id_map',{hp.SHORT_IDS[0]:hp.ALL_IDS[0]})]:
   job=fixed_job();job['suite'][name]=value
   with self.subTest(name=name),self.assertRaises(ValueError):hp.execution_ids(job,lambda:None)
  job=fixed_job();job['suite']['id_map'][hp.SHORT_IDS[0]]=hp.ALL_IDS[1]
  with self.assertRaises(ValueError):hp.execution_ids(job,lambda:None)
 def test_every_ordinary_kind_requires_null_and_keeps_full_ids(self):
  for kind in ('original','a2_runtime','a2_session','stored_adapter','portable_fixture','historical_materializer','declared_new'):
   job=fixed_job();job['suite']['kind']=kind
   with self.subTest(kind=kind),self.assertRaises(ValueError):hp.execution_ids(job,lambda:None)
   job['partition']=None;self.assertEqual(hp.execution_ids(job,lambda:None),list(hp.ALL_IDS))
 def test_fixed_profile_unique_tree_and_source_metadata_required(self):
  for mutation in ('wrong_profile','duplicate_tree','same_tag','same_root','missing_module','bad_module','missing_extra_id','bad_extra_source','child_route'):
   job=fixed_job();trees=job['guard']['source_trees']
   if mutation=='wrong_profile':trees[1]['profile']='a2_669'
   elif mutation=='duplicate_tree':other=deepcopy(trees[1]);other['tag']='duplicate';trees.append(other)
   elif mutation=='same_tag':trees[1]['tag']=trees[0]['tag']
   elif mutation=='same_root':trees[1]['root']=trees[0]['root']
   elif mutation=='missing_module':del trees[0]['files'][hp.SUITE]
   elif mutation=='bad_module':trees[0]['files'][hp.SUITE]['sha256']='0'*64
   elif mutation=='missing_extra_id':del job['guard']['extra_test_inventory'][hp.ALL_IDS[0]]
   elif mutation=='bad_extra_source':job['guard']['extra_test_inventory'][hp.ALL_IDS[0]]['source']='other.py'
   else:job['guard']['historical_route']={'declaration':{}}
   with self.subTest(mutation=mutation),self.assertRaises(ValueError):hp.source_bindings(job,lambda:None)
 def test_complete_baseline_refuses_missing_extra_hash_size(self):
  for mutation in ('missing','extra','hash','size'):
   job=fixed_job();files=job['guard']['source_trees'][1]['files'];name=next(iter(files))
   if mutation=='missing':del files[name]
   elif mutation=='extra':files['new.sql']={'bytes':1,'sha256':'0'*64}
   elif mutation=='hash':files[name]['sha256']='0'*64
   else:files[name]['bytes']+=1
   with self.subTest(mutation=mutation),self.assertRaisesRegex(ValueError,'historical metadata'):hp.context_arguments(job,admitted(job),SPEC_RAW,lambda:None)
 def test_current_metadata_checked_before_projecting_hashes(self):
  for mutation in ('missing','hash','size'):
   job=fixed_job();files=job['guard']['source_trees'][0]['files'];name=next(iter(SPEC['current656']))
   if mutation=='missing':del files[name]
   elif mutation=='hash':files[name]['sha256']='0'*64
   else:files[name]['bytes']+=1
   with self.subTest(mutation=mutation),self.assertRaisesRegex(ValueError,'current656'):hp.context_arguments(job,admitted(job),SPEC_RAW,lambda:None)
 def test_admitted_guard_root_file_keysets_and_pin_identity_are_required(self):
  for mutation in ('root','profile','keyset','hash','size','collision','trees'):
   job=fixed_job();trees=admitted(job);tree=trees['historical'];name=next(iter(tree.files))
   if mutation=='root':tree.root.path='/different'
   elif mutation=='profile':tree.profile='current'
   elif mutation=='keyset':del tree.files[name]
   elif mutation=='hash':tree.files[name].sha256='0'*64
   elif mutation=='size':tree.files[name].size+=1
   elif mutation=='collision':tree.root.ino=trees['current'].root.ino
   else:del trees['historical']
   with self.subTest(mutation=mutation),self.assertRaises(ValueError):hp.context_arguments(job,trees,SPEC_RAW,lambda:None)
 def test_pinned_spec_evidence_location_and_deadline(self):
  job=fixed_job()
  for raw in (SPEC_RAW+b' ',b'{}',SPEC_RAW.decode()):
   with self.assertRaises(ValueError):hp.context_arguments(job,admitted(job),raw,lambda:None)
  for path in ('/owned/historical','/owned/historical/sub','relative'):
   job=fixed_job();job['output']['directory']=path
   with self.assertRaises(ValueError):hp.context_arguments(job,admitted(job),SPEC_RAW,lambda:None)
  for end in (True,float('nan'),float('inf')):
   job=fixed_job();job['deadline']=end
   with self.assertRaises(ValueError):hp.context_arguments(job,admitted(job),SPEC_RAW,lambda:None)
 def test_checks_propagate_through_large_admitted_inventory(self):
  job=fixed_job();calls=[0]
  def check():
   calls[0]+=1
   if calls[0]==200:raise TimeoutError('original deadline')
  with self.assertRaises(TimeoutError):hp.context_arguments(job,admitted(job),SPEC_RAW,check)


if __name__=='__main__':unittest.main(verbosity=2)
