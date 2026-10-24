"""Pure paired evidence tests; no target imports, child processes or files."""
from copy import deepcopy
import hashlib
import importlib.util
import json
from pathlib import Path
import unittest

HERE=Path(__file__).resolve().parent

def load(name,filename):
 spec=importlib.util.spec_from_file_location(name,HERE/filename);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m

g=load('guard_report_under_test','guard_report.py');r=load('guard_report_original_results','results.py')
ID='test_fixed.py::Fixed.test_one'


def fixtures():
 context={'job_id':'job','job_sha256':'1'*64,'suite_id':'test_fixed.py','suite_tree_tag':'source',
  'expected_ids':[ID],'source_trees_sha256':'2'*64,'implementation_sha256':'3'*64,
  'policy_envelope_sha256':g.POLICY_SHA,'contract_sha256':g.CONTRACT_SHA,'allowed_routes':{ID:{'fixed-child':2}}}
 report={'kind':'finite-offline-worker-guard-report-v1','suite_id':context['suite_id'],'contract_sha256':g.CONTRACT_SHA,
  'installed':True,'test_ids':[ID],'active_test':None,'launches':[{'test_id':ID,'route':'fixed-child','ordinal':1}],
  'denial_count':0,'denials':[],'owned_directories':1,'pending_node_permit':False,'universal_descendant_containment':False}
 result={'kind':'portable-unittest-terminal-v1','passed':True,'ids':[ID],'expected_count':1,
  'expected_ids_sha256':hashlib.sha256(json.dumps([ID],ensure_ascii=False,separators=(',',':')).encode()).hexdigest(),
  'tests_run':1,'started':[0],'stopped':[0],'succeeded':[0],
  'problems':{name:[] for name in r.CATEGORIES},'guard_clean':True,'guard_errors':0,'protocol_errors':0}
 guard=g.envelope(context,report,status='complete')
 terminal={'kind':'portable-worker-terminal-v2','job_id':'job','job_sha256':'1'*64,'guard_report_sha256':'unused','guard_report_bytes':0,'result':result}
 return context,guard,terminal


def encode(guard,terminal):
 raw_guard=g.canonical(guard)+b'\n';terminal=deepcopy(terminal)
 terminal['guard_report_sha256']=g.digest(raw_guard);terminal['guard_report_bytes']=len(raw_guard)
 return g.canonical(terminal)+b'\n',raw_guard


class GuardReportTests(unittest.TestCase):
 def setUp(self):self.context,self.guard,self.terminal=fixtures()
 def validate(self,guard=None,terminal=None,**kw):
  terminal_raw,guard_raw=encode(self.guard if guard is None else guard,self.terminal if terminal is None else terminal)
  return g.validate_pair(terminal_raw,guard_raw,self.context,process_returncode=kw.pop('code',0),validate_terminal=r.validate_terminal,check=kw.pop('check',lambda:None),**kw)
 def test_exact_pair_returns_fixed_schema_original_result_and_guard(self):
  pair=self.validate();self.assertEqual(set(pair),g.PAIR_KEYS)
  self.assertEqual(pair['kind'],'portable-worker-validated-pair-v1')
  self.assertEqual(pair['result'],self.terminal['result']);self.assertEqual(pair['guard'],self.guard['report'])
 def test_raw_guard_bytes_including_whitespace_are_bound(self):
  terminal,guard=encode(self.guard,self.terminal)
  with self.assertRaises(ValueError):g.validate_pair(terminal,guard+b' ',self.context,process_returncode=0,validate_terminal=r.validate_terminal,check=lambda:None)
 def test_context_identity_mutations_are_refused(self):
  for name in ('job_id','job_sha256','suite_id','suite_tree_tag','source_trees_sha256','implementation_sha256','policy_envelope_sha256'):
   bad=deepcopy(self.guard);bad[name]='wrong'
   with self.subTest(name=name),self.assertRaises(ValueError):self.validate(guard=bad)
  for name in ('job_id','job_sha256'):
   bad=deepcopy(self.terminal);bad[name]='wrong'
   with self.assertRaises(ValueError):self.validate(terminal=bad)
 def test_success_requires_explicit_installed_idle_zero_denial(self):
  changes={'installed':[False,1,None],'active_test':[ID,False],'pending_node_permit':[True,0,None],
   'universal_descendant_containment':[True,0,None],'denial_count':[1,False,0.0],
   'denials':[[{'test_id':ID,'reason':'denied'}],None],'owned_directories':[True,-1,8193],
   'test_ids':[[],[ID,ID],['other::test']],'kind':['wrong'],'suite_id':['wrong'],'contract_sha256':['0'*64]}
  for key,values in changes.items():
   for value in values:
    bad=deepcopy(self.guard);bad['report'][key]=value
    with self.subTest(key=key,value=value),self.assertRaises(ValueError):self.validate(guard=bad)
 def test_diagnostic_report_never_passes(self):
  bad=deepcopy(self.guard);bad['status']='diagnostic'
  with self.assertRaises(ValueError):self.validate(guard=bad)
 def test_launch_permissions_and_contiguous_per_route_ordinals(self):
  for launches in ([{'test_id':ID,'route':'wrong','ordinal':1}],
    [{'test_id':'other','route':'fixed-child','ordinal':1}],
    [{'test_id':ID,'route':'fixed-child','ordinal':True}],
    [{'test_id':ID,'route':'fixed-child','ordinal':2}],
    [{'test_id':ID,'route':'fixed-child','ordinal':x} for x in (1,1)],
    [{'test_id':ID,'route':'fixed-child','ordinal':x} for x in (1,2,3)]):
   bad=deepcopy(self.guard);bad['report']['launches']=launches
   with self.subTest(launches=launches),self.assertRaises(ValueError):self.validate(guard=bad)
  self.guard['report']['launches']=[];self.validate()
  self.guard['report']['launches']=[{'test_id':ID,'route':'fixed-child','ordinal':n} for n in (1,2)];self.validate()
 def test_exact_keys_at_every_envelope_level(self):
  for location in ('outer','report','launch','terminal'):
   guard,terminal=deepcopy(self.guard),deepcopy(self.terminal)
   obj={'outer':guard,'report':guard['report'],'launch':guard['report']['launches'][0],'terminal':terminal}[location]
   obj['extra']=True
   with self.subTest(location=location),self.assertRaises(ValueError):self.validate(guard=guard,terminal=terminal)
 def test_strict_json_duplicate_nonfinite_trailing_and_caps(self):
  for raw in (b'{"x":1,"x":2}',b'{"x":{"y":1,"y":2}}',b'NaN',b'Infinity',b'1e999',b'{}{}',b'\xff',b'',b' '* (g.MAX_BYTES+1)):
   with self.subTest(raw=raw[:30]),self.assertRaises((ValueError,UnicodeError)):g.strict_json(raw,lambda:None)
 def test_actual_exit_formal_zero_required(self):
  for code in (1,-9,False,0.0,None):
   with self.subTest(code=code),self.assertRaises(ValueError):self.validate(code=code)
 def test_original_result_mutations_are_still_refused(self):
  changes={'passed':False,'ids':[],'expected_count':True,'expected_ids_sha256':'0'*64,'tests_run':0,
   'started':[],'stopped':[],'succeeded':[0,0],'guard_clean':False,'guard_errors':1,'protocol_errors':1}
  for key,value in changes.items():
   bad=deepcopy(self.terminal);bad['result'][key]=value
   with self.subTest(key=key),self.assertRaises(ValueError):self.validate(terminal=bad)
  for name in r.CATEGORIES:
   bad=deepcopy(self.terminal);bad['result']['problems'][name]=[0]
   with self.assertRaises(ValueError):self.validate(terminal=bad)
 def test_expected_route_derivation_is_from_admitted_policy_not_launches(self):
  job={'kind':'portable-worker-job-v2','partition':None,'job_id':'job','suite':{'relative':'test_fixed.py','tree_tag':'tree','kind':'original','expected_ids':[ID]},'guard':{'source_trees':[]},'implementation':{'files':{}}}
  routes=[{'id':'suite-route','source':'test_fixed.py','max_calls_per_test':2},
          {'id':'caller-route','source':'elsewhere.py','caller':ID,'max_calls_per_test':1},
          {'id':'wrong-caller','source':'test_fixed.py','caller':'other','max_calls_per_test':1},
          {'id':'wrong-source','source':'other.py','max_calls_per_test':1}]
  context=g.expected_context(job,'1'*64,routes,None,lambda:None)
  self.assertEqual(context['allowed_routes'],{ID:{'suite-route':2,'caller-route':1}})
  self.assertEqual(context['source_trees_sha256'],g.digest(b'[]'))
  with self.assertRaises(ValueError):g.expected_context(job,'1'*64,routes,{'declaration':{'id':'h','max_calls_per_test':1,'allowed_original_test_ids':[ID]}},lambda:None)
  job['suite']['kind']='stored_adapter'
  self.assertEqual(g.expected_context(job,'1'*64,[],{'declaration':{'id':'h','max_calls_per_test':1,'allowed_original_test_ids':[ID]}},lambda:None)['allowed_routes'],{ID:{'h':1}})
 def test_inherited_ids_are_kept_verbatim(self):
  ids=['test_fixed.py::PositiveSessionTests.test_x','test_fixed.py::SeedSessionTests.test_x']
  self.context['expected_ids']=ids;self.context['allowed_routes']={i:{} for i in ids}
  self.guard['report']['test_ids']=sorted(ids);self.guard['report']['launches']=[]
  self.assertEqual(g.validate_guard(self.guard,self.context,lambda:None)['test_ids'],ids)
 def test_final_validator_deadline_check_and_iteration_checks(self):
  calls=[0]
  def check():calls[0]+=1
  self.validate(check=check);self.assertGreater(calls[0],20)
  remaining=[False]
  def checked():
   if remaining[0]:raise TimeoutError('original cutoff')
  def slow(*a,**kw):value=r.validate_terminal(*a,**kw);remaining[0]=True;return value
  terminal,guard=encode(self.guard,self.terminal)
  with self.assertRaises(TimeoutError):g.validate_pair(terminal,guard,self.context,process_returncode=0,validate_terminal=slow,check=checked)


class HistoricalPairTests(unittest.TestCase):
 def setUp(self):
  self.fixture=load('historical_partition_fixture_for_pair','test_historical_partition.py')
  self.hp=self.fixture.hp;self.job=self.fixture.fixed_job(6)
 def context(self,job=None,**kwargs):
  return g.expected_context(self.job if job is None else job,'1'*64,kwargs.pop('routes',[]),None,lambda:None,partition_module=kwargs.pop('module',self.hp),**kwargs)
 def pair(self,context):
  _,old_guard,terminal=fixtures();ids=context['expected_ids'];snapshot=old_guard['report']
  snapshot.update(suite_id=self.hp.SUITE,test_ids=sorted(ids),launches=[])
  guard=g.envelope(context,snapshot,status='complete')
  result=terminal['result'];result.update(ids=list(ids),expected_count=len(ids),expected_ids_sha256=hashlib.sha256(json.dumps(sorted(ids),ensure_ascii=False,separators=(',',':')).encode()).hexdigest(),tests_run=len(ids),started=list(range(len(ids))),stopped=list(range(len(ids))),succeeded=list(range(len(ids))))
  terminal.update(job_id=context['job_id'],job_sha256=context['job_sha256'])
  return guard,terminal
 def validate(self,context,guard,terminal):
  raw,proof=encode(guard,terminal)
  return g.validate_pair(raw,proof,context,process_returncode=0,validate_terminal=r.validate_terminal,check=lambda:None)
 def test_guard_inventory_all8_but_evidence_exact_selected_one(self):
  context=self.context();self.assertEqual(len(self.job['guard']['extra_test_inventory']),8)
  self.assertEqual(context['expected_ids'],[self.hp.ALL_IDS[6]]);self.assertEqual(context['allowed_routes'],{self.hp.ALL_IDS[6]:{}})
  guard,terminal=self.pair(context);pair=self.validate(context,guard,terminal)
  self.assertEqual(pair['result']['tests_run'],1);self.assertEqual(pair['guard']['test_ids'],[self.hp.ALL_IDS[6]])
 def test_full8_or_wrong_selected_guard_and_result_cannot_satisfy_singleton(self):
  context=self.context()
  for mutate in ('guard_all','guard_other','result_all','result_other'):
   guard,terminal=self.pair(context)
   if mutate=='guard_all':guard['report']['test_ids']=sorted(self.hp.ALL_IDS)
   elif mutate=='guard_other':guard['report']['test_ids']=[self.hp.ALL_IDS[0]]
   else:
    ids=list(self.hp.ALL_IDS)if mutate=='result_all'else[self.hp.ALL_IDS[0]]
    terminal['result'].update(ids=sorted(ids),expected_count=len(ids),expected_ids_sha256=hashlib.sha256(json.dumps(sorted(ids),ensure_ascii=False,separators=(',',':')).encode()).hexdigest(),tests_run=len(ids),started=list(range(len(ids))),stopped=list(range(len(ids))),succeeded=list(range(len(ids))))
   with self.subTest(mutate=mutate),self.assertRaises(ValueError):self.validate(context,guard,terminal)
 def test_historical_requires_source_admitted_module_and_fixed_partition(self):
  with self.assertRaisesRegex(ValueError,'source-admitted'):self.context(module=None)
  bad=deepcopy(self.job);bad['partition']['inventory_sha256']='0'*64
  with self.assertRaises(ValueError):self.context(bad)
  bad=deepcopy(self.job);bad['suite']['expected_ids']=[self.hp.ALL_IDS[6]]
  with self.assertRaises(ValueError):self.context(bad)
  bad=deepcopy(self.job);del bad['guard']['source_trees'][0]['files'][self.hp.SUITE]
  with self.assertRaises(ValueError):self.context(bad)
 def test_no_child_permissions_for_historical_boundary(self):
  with self.assertRaisesRegex(ValueError,'no child permissions'):self.context(routes=[{'id':'wrong','source':self.hp.SUITE,'max_calls_per_test':1}])
 def test_ordinary_optional_module_requires_null_full_coverage(self):
  job=deepcopy(self.job);job['suite']['kind']='original'
  with self.assertRaises(ValueError):self.context(job)
  job['partition']=None;self.assertEqual(self.context(job)['expected_ids'],list(self.hp.ALL_IDS))
  with self.assertRaises(ValueError):self.context(self.job,module=None)


if __name__=='__main__':unittest.main(verbosity=2)
