"""Pure routing tests; real result validator, no target collection or launch."""
from copy import deepcopy
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import unittest

HERE = Path(__file__).resolve().parent
def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec); sys.modules[name] = module
    spec.loader.exec_module(module); return module
p = load('pure_suite_planner', HERE/'planner.py')
r = load('planner_real_results', HERE/'results.py')


class PlannerTests(unittest.TestCase):
    def setUp(self):
        self.raw = (HERE/'suite-plan.json').read_bytes()
        self.plan = p.admit_plan(self.raw)
        self.value = self.plan.value()

    def terminals(self):
        output = {}
        for job in self.value['jobs']:
            ids = job['expected_ids']; indices = list(range(len(ids)))
            value = dict(kind=r.KIND, passed=True, ids=ids, expected_count=len(ids),
                expected_ids_sha256=hashlib.sha256(json.dumps(sorted(ids),ensure_ascii=False,separators=(',', ':')).encode()).hexdigest(),
                tests_run=len(ids), started=indices, stopped=indices, succeeded=indices,
                problems={category: [] for category in r.CATEGORIES}, guard_clean=True,
                guard_errors=0, protocol_errors=0)
            output[job['job_id']] = (json.dumps(value).encode(), 0)
        return output

    def test_fixed_867_original_plus_52_and_all_inherited_classes(self):
        jobs = p.suite_jobs(self.plan, {'current':'repository', 'a2_669':'historical'})
        self.assertEqual(len(jobs),59)
        self.assertEqual(sum(len(j['suite']['expected_ids']) for j in jobs),919)
        runtime = next(j['suite'] for j in jobs if j['suite']['kind']=='a2_runtime')
        session = next(j['suite'] for j in jobs if j['suite']['kind']=='a2_session')
        self.assertEqual(set(runtime['classes']),{'RuntimeTests','TerminalPersistenceTests'})
        self.assertEqual(set(session['classes']),{'PositiveSessionTests','SeedSessionTests'})
        self.assertEqual(len(session['expected_ids']),48)
        self.assertEqual(sum(j['suite']['kind']=='stored_adapter' for j in jobs),1)

    def test_altered_authority_is_not_resealed(self):
        bad = self.raw.replace(b'867',b'843',1)
        for raw in (bad, self.raw+b' ', b'', self.raw.decode()):
            with self.assertRaises(ValueError): p.admit_plan(raw)
        with self.assertRaises(ValueError): p.Plan(bad).value()

    def test_returned_job_and_plan_values_are_detached(self):
        self.value['jobs'][0]['expected_ids'].clear()
        self.assertTrue(self.plan.value()['jobs'][0]['expected_ids'])
        jobs=p.suite_jobs(self.plan,{'current':'current','a2_669':'old'})
        jobs[0]['suite']['classes'].clear()
        self.assertTrue(p.suite_jobs(self.plan,{'current':'current','a2_669':'old'})[0]['suite']['classes'])

    def test_dropped_duplicate_extra_and_crossmapped_slots_refuse(self):
        for mutation in ('dropjob','duplicatejob','dropid','duplicateid','wrongmap','wrongprofile'):
            value=deepcopy(self.value); j=value['jobs'][0]
            if mutation=='dropjob': value['jobs'].pop()
            if mutation=='duplicatejob': value['jobs'][-1]=deepcopy(j)
            if mutation=='dropid': j['expected_ids'].pop()
            if mutation=='duplicateid': j['expected_ids'].append(j['expected_ids'][0])
            if mutation=='wrongmap': j['id_map'][next(iter(j['id_map']))]='foreign'
            if mutation=='wrongprofile': j['tree_profile']='a2_669'
            with self.subTest(mutation=mutation),self.assertRaises(ValueError):p.validate_structure(value)

    def test_claiming_unfinished_coverage_complete_refuses(self):
        for key,val in [('full_routing_acceptance',True),('implementation_regressions_included',True),('original_tests',843),('public_additive_tests',True),('pending_historical_boundary_ids',[])]:
            value=deepcopy(self.value);value[key]=val
            with self.subTest(key=key),self.assertRaises(ValueError):p.validate_structure(value)

    def test_source_placement_requires_exact_harness_hashes(self):
        maps={'current':{},'a2_669':{}}
        for j in self.value['jobs']: maps[j['tree_profile']][j['relative']]={'sha256':j['source_sha256']}
        self.assertTrue(p.check_suite_sources(self.plan,maps))
        source=next(iter(maps['a2_669']));maps['a2_669'][source]['sha256']='0'*64
        with self.assertRaises(ValueError):p.check_suite_sources(self.plan,maps)
        del maps['a2_669'][source]
        with self.assertRaises(ValueError):p.check_suite_sources(self.plan,maps)

    def test_tree_tags_cannot_alias_current_and_historical(self):
        for tags in ({'current':'same','a2_669':'same'}, {'current':'repo'}, {'current':'repo','a2_669':'../old'}):
            with self.assertRaises(ValueError):p.suite_jobs(self.plan,tags)

    def test_real_terminal_validation_preserves_incomplete_scope(self):
        receipt=p.summarize(self.plan,self.terminals(),r.validate_terminal)
        self.assertTrue(receipt['planned_scope_passed']);self.assertEqual(receipt['tests_completed'],919)
        self.assertFalse(receipt['full_routing_acceptance']);self.assertFalse(receipt['implementation_regressions_included'])
        self.assertEqual(len(receipt['pending_historical_boundary_ids']),8)
        self.assertFalse(receipt['database_acceptance']);self.assertFalse(receipt['clinical_activation'])

    def test_absent_extra_and_nonzero_worker_terminal_refuse(self):
        for mutation in ('absent','extra','nonzero','boolcode','malformed','wrongcoverage'):
            terminals=self.terminals();key=next(iter(terminals));raw,code=terminals[key]
            if mutation=='absent':del terminals[key]
            if mutation=='extra':terminals['foreign']=(raw,code)
            if mutation=='nonzero':terminals[key]=(raw,1)
            if mutation=='boolcode':terminals[key]=(raw,False)
            if mutation=='malformed':terminals[key]=(raw[:-1],0)
            if mutation=='wrongcoverage':
                v=json.loads(raw);v['succeeded'].pop();terminals[key]=(json.dumps(v).encode(),0)
            with self.subTest(mutation=mutation),self.assertRaises(ValueError):p.summarize(self.plan,terminals,r.validate_terminal)


if __name__=='__main__':unittest.main(verbosity=2)
