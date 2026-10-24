"""Offline adversarial preservation checks; no database acceptance credit."""
import copy
import importlib
import json
import io
import tempfile
import time
from pathlib import Path
import sys
import unittest
from unittest.mock import patch, Mock

SOURCE = Path(__file__).resolve().parents[2]/'tests/controlled-drugs/engine/candidate'
sys.dont_write_bytecode = True
sys.path.insert(0, str(SOURCE))
capture = importlib.import_module('record_review_v3_gate_b_snapshot')
runtime = importlib.import_module('record_review_v3_gate_b_runtime')


class GateBPreservation(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.package = runtime.assembly.build()

    def setUp(self):
        expected = self.package['expected']
        self.before = {key: {} for key in capture.retained.KEYS}
        self.before.update(rows={'public.controlled_stock_events': [{'id': 'original'}]}, types={'public.original': {'oid': 1}},
            catalog={'schemas': {'public': {'acl': ['original']}}, 'functions': {'public.original()': {'oid': 7}},
                     'relations': {'public.controlled_stock_events': {'triggers': [{'attributes': {'oid': 8, 'tgenabled': 'O'}}]}}})
        self.after = copy.deepcopy(self.before)
        self.after['rows'].update({'controlled_review_v3.'+name: [] for name in capture.declaration.TABLES})
        self.after['catalog']['schemas']['controlled_review_v3'] = {'owner': 'postgres'}
        for signature in expected['functions']:
            qualified, arguments = signature[:-1].split('(', 1)
            types = ','.join(argument.strip().split(' ', 1)[1] for argument in arguments.split(',')) if arguments else ''
            self.after['catalog']['functions'][qualified+'('+types+')'] = {'attributes': {'proname': qualified.split('.')[1]}}
        for row in expected['relation_inventory']:
            self.after['catalog']['relations']['controlled_review_v3.'+row['name']] = {'triggers': []}
        for row in expected['types']:
            self.after['types']['controlled_review_v3.'+row['name']] = {'new': True}
        self.ri = [101, 102]
        self.after['catalog']['relations']['public.controlled_stock_events']['triggers'] += [
            {'attributes': {'oid': oid, 'tgisinternal': True, 'tgenabled': 'O'}} for oid in self.ri]

    def check(self):
        capture.preserved(self.before, self.after, self.ri, self.package['expected'])

    def test_exact_preservation_and_inputs_are_not_mutated(self):
        saved = copy.deepcopy((self.before, self.after))
        self.check()
        self.assertEqual(saved, (self.before, self.after))

    def test_package_derivation_must_match_complete_frozen_source_map(self):
        frozen = dict(self.package['input_source_hashes'])
        runtime.bind_package_inputs(self.package, frozen)
        name = next(iter(frozen))
        frozen[name] = '0'*64
        with self.assertRaisesRegex(AssertionError, 'changed before source freeze'):
            runtime.bind_package_inputs(self.package, frozen)
        del frozen[name]
        with self.assertRaisesRegex(AssertionError, 'missing from frozen'):
            runtime.bind_package_inputs(self.package, frozen)

    def test_descriptor_source_cannot_escape_package_closure(self):
        package = copy.deepcopy(self.package)
        package['source_hashes']['unbound.py'] = '0'*64
        with self.assertRaisesRegex(AssertionError, 'source missing or differs'):
            runtime.bind_package_inputs(package, self.package['input_source_hashes'])

    def test_original_row_and_all_metadata_families_refuse_drift(self):
        original = copy.deepcopy(self.after)
        for key in capture.retained.KEYS - {'catalog', 'rows', 'types'}:
            with self.subTest(key=key):
                self.after = copy.deepcopy(original)
                self.after[key] = {'unexpected': True}
                with self.assertRaises(AssertionError):
                    self.check()
        self.after = copy.deepcopy(original)
        self.after['rows']['public.controlled_stock_events'] = []
        with self.assertRaises(AssertionError):
            self.check()

    def test_original_catalog_acl_and_type_refuse_drift(self):
        original = copy.deepcopy(self.after)
        for family in ('schemas', 'functions', 'relations'):
            with self.subTest(family=family):
                self.after = copy.deepcopy(original)
                self.after['catalog'][family][next(iter(self.before['catalog'][family]))]['unexpected'] = True
                with self.assertRaises(AssertionError):
                    self.check()
        self.after = copy.deepcopy(original)
        self.after['types']['public.original']['oid'] = 9
        with self.assertRaises(AssertionError):
            self.check()

    def test_additional_function_relation_type_or_table_refused(self):
        original = copy.deepcopy(self.after)
        for family in ('functions', 'relations', 'types', 'rows'):
            self.after = copy.deepcopy(original)
            target = self.after['catalog'][family] if family in ('functions', 'relations') else self.after[family]
            target['controlled_review_v3.undeclared'] = {}
            with self.subTest(family=family), self.assertRaises(AssertionError):
                self.check()

    def test_wrong_private_name_same_count_refused(self):
        name = next(n for n in self.after['catalog']['functions'] if n.startswith('controlled_review_v3.'))
        self.after['catalog']['functions'][name]['attributes']['proname'] = 'undeclared'
        with self.assertRaises(AssertionError):
            self.check()

    def test_only_two_exact_enabled_internal_parent_triggers_can_be_excluded(self):
        original = copy.deepcopy(self.after)
        for mutation in ('disabled', 'external', 'wrong_parent', 'third'):
            self.after = copy.deepcopy(original)
            triggers = self.after['catalog']['relations']['public.controlled_stock_events']['triggers']
            if mutation == 'disabled':
                triggers[-1]['attributes']['tgenabled'] = 'D'
            elif mutation == 'external':
                triggers[-1]['attributes']['tgisinternal'] = False
            elif mutation == 'wrong_parent':
                self.after['catalog']['relations']['public.other'] = {'triggers': [triggers.pop()]}
            else:
                triggers.append({'attributes': {'oid': 103, 'tgisinternal': True, 'tgenabled': 'O'}})
            with self.subTest(mutation=mutation), self.assertRaises(AssertionError):
                self.check()


class CandidateSummaryAdmission(unittest.TestCase):
    def setUp(self):
        kinds = json.loads((SOURCE/'record-review-v3-adapters-selectors.json').read_text())['kinds']
        self.proof = dict(synthetic_only=True, genuine_cases=33, exact_kinds=sorted(x['event_kind'] for x in kinds),
            effects_cases=33, membership_cases=33, full_readonly_preservation=True,
            auth_acceptance=False, historical_A2=False, corruption_and_bounds=False)
        self.boundary = dict(synthetic_internal_inputs_only=True, production_fixture_boundary_claim=False,
            checks=sorted(['512_distinct_internal_rows_retained','duplicate_at_capacity_and_role_precedence',
            '513th_distinct_row_refused','same_key_different_full_row_refused','allocations_100_duplicate_101_refusal',
            'documents_100_duplicate_101_refusal','utf8_byte_overflow_refused']))

        self.provenance_values = [
            dict(managed_provenance_negative_cases=22, entrypoint_refusals=44,
                 all_mutations_rolled_back=True, historical_A2=False, full_corruption_matrix=False),
            dict(managed_provenance_refusal_receipts=[dict(label=label, entrypoint=entrypoint,
                 refusal_message='Synthetic declared target integrity refusal')
                 for label in (
                     'compensation_movement_absent', 'compensation_movement_partial',
                     'correction_actor', 'correction_missing', 'discrepancy_actor', 'discrepancy_missing',
                     'dispense_movement_absent', 'dispense_movement_partial', 'dispense_parent_links_absent',
                     'dispense_parent_links_partial', 'pickup_actor', 'pickup_missing', 'restock_movement_absent',
                     'restock_movement_actor', 'restock_movement_partial', 'restock_movement_root',
                     'restock_movement_writer', 'return_missing', 'return_v1_actor', 'return_v1_wrong_writer',
                     'return_v2_actor', 'return_v2_wrong_writer')
                 for entrypoint in ('classifier', 'collector')]),
            dict(managed_provenance_permanent_preservation=True, checks=44,
                 role_restored=True, trigger_mode_restored=True),
            dict(managed_provenance_privilege_scope='admin_integrity_only', session_user='supabase_admin',
                 current_user='supabase_admin', role_setting='none', postgres_invoker_equivalence=False, auth_acceptance=False),
            dict(managed_provenance_role_profile=dict(server_version='17.6', roles=[
                dict(name='postgres', superuser=False, can_login=True, can_set_replication_role=False),
                dict(name='supabase_admin', superuser=True, can_login=True, can_set_replication_role=True)]),
                observation_sha256='658f523d7a8f3693967b770ba8ce9f63a5cc675bd75dbd21b0c791588bf3fd83'),
        ]

    def invoke(self, duplicate=False):
        test = self
        class Fake:
            folder = Path('/unused/no-write')
        def execute(session, stages):
            test.assertIsInstance(session, Fake)
            test.assertEqual([name for name, _ in stages], ['native_setup', 'managed_fixture',
                'readonly_baseline', 'effects_oracle', 'membership_oracle', 'readonly_verification', 'provenance_negatives', 'internal_boundaries'])
            test.assertIn('A1 internal boundary checks changed permanent state', stages[-1][1])
            output = json.dumps(test.proof)+'\n'+json.dumps(test.boundary)+'\n'
            output += '\n'.join(json.dumps(v) for v in test.provenance_values)+'\n'
            return output+(json.dumps(test.proof)+'\n' if duplicate else '')
        with patch.object(runtime.owned, 'save'), patch.object(runtime.phased, 'run', side_effect=execute):
            return runtime.candidate_sanity(Fake())

    def test_valid_sanity_stays_unadmitted_and_not_acceptance(self):
        result = self.invoke()
        self.assertIs(result['admitted_artifact'], False)
        self.assertIs(result['acceptance'], False)

    def test_same_kind_set_in_database_locale_order_is_not_silently_normalized(self):
        self.proof['exact_kinds'] = list(reversed(self.proof['exact_kinds']))
        with self.assertRaises(AssertionError):
            self.invoke()

    def test_generated_summary_uses_matching_c_collation_for_distinct_and_order(self):
        try:
            from pglast import parse_sql
        except ImportError:
            self.skipTest('pglast unavailable; SQL collation AST check not run')
        def walk(value):
            if isinstance(value, dict):
                yield value
                for child in value.values():
                    yield from walk(child)
            elif isinstance(value, (list, tuple)):
                for child in value:
                    yield from walk(child)
        def check(sql):
            calls = [node for stmt in parse_sql(sql) for node in walk(stmt())
                     if node.get('@') == 'FuncCall' and node.get('agg_distinct')
                     and [v.get('sval') for v in node['funcname']] == ['jsonb_agg']]
            self.assertEqual(len(calls), 1)
            call = calls[0]
            self.assertEqual(len(call['args']), 1)
            self.assertEqual(len(call['agg_order']), 1)
            for expression in (call['args'][0], call['agg_order'][0]['node']):
                self.assertEqual(expression['@'], 'CollateClause')
                self.assertEqual([v['sval'] for v in expression['collname']], ['C'])
                self.assertEqual(expression['arg']['@'], 'ColumnRef')
                self.assertEqual([v['sval'] for v in expression['arg']['fields']], ['event_kind'])
        sql = dict(runtime.fixtures.build_stages())['readonly_verification']
        check(sql)
        # Reproduce the actual failed source, and independently break each side.
        for mutated in (sql.replace(' collate "C"', ''),
                        sql.replace('event_kind collate "C" order', 'event_kind order'),
                        sql.replace('order by event_kind collate "C"', 'order by event_kind')):
            with self.subTest(mutated=mutated), self.assertRaises(AssertionError):
                check(mutated)

    def test_same_count_wrong_kind_set_refused(self):
        self.proof['exact_kinds'][0] = 'unreviewed_kind'
        with self.assertRaises(AssertionError):
            self.invoke()

    def test_missing_proof_duplicate_summary_or_overclaimed_auth_refused(self):
        self.boundary['checks'].pop()
        with self.assertRaises(AssertionError):
            self.invoke()
        self.setUp()
        with self.assertRaises(AssertionError):
            self.invoke(duplicate=True)
        self.setUp()
        self.proof['auth_acceptance'] = True
        with self.assertRaises(AssertionError):
            self.invoke()


    def test_provenance_exact_44_pairs_required(self):
        for change in ('missing', 'extra', 'duplicate', 'wrong_pair', 'unsorted', 'empty_message',
                       'null_message', 'boolean_message', 'extra_field', 'missing_field'):
            self.setUp()
            rows = self.provenance_values[1]['managed_provenance_refusal_receipts']
            if change == 'missing': rows.pop()
            elif change == 'extra': rows.append(copy.deepcopy(rows[0]))
            elif change == 'duplicate': rows[-1] = copy.deepcopy(rows[0])
            elif change == 'wrong_pair': rows[0]['entrypoint'] = 'unreviewed'
            elif change == 'unsorted': rows[0], rows[1] = rows[1], rows[0]
            elif change == 'empty_message': rows[0]['refusal_message'] = ''
            elif change == 'null_message': rows[0]['refusal_message'] = None
            elif change == 'boolean_message': rows[0]['refusal_message'] = True
            elif change == 'extra_field': rows[0]['sqlstate'] = '23514'
            else: del rows[0]['refusal_message']
            with self.subTest(change=change), self.assertRaises(AssertionError): self.invoke()

    def test_provenance_summary_types_fields_presence_duplicates_and_claims(self):
        for index in range(5):
            self.setUp(); self.provenance_values.pop(index)
            with self.subTest(missing=index), self.assertRaises(AssertionError): self.invoke()
            self.setUp(); self.provenance_values.append(copy.deepcopy(self.provenance_values[index]))
            with self.subTest(duplicate=index), self.assertRaises(AssertionError): self.invoke()
        for index, key, value in ((0,'entrypoint_refusals',44.0),(0,'all_mutations_rolled_back',1),
                                 (0,'historical_A2',0),(0,'full_corruption_matrix',True),
                                 (2,'checks',44.0),(2,'role_restored',1),(2,'trigger_mode_restored',False),
                                 (1,'extra',False),(3,'postgres_invoker_equivalence',0),(3,'auth_acceptance',True),
                                 (3,'session_user','postgres'),(3,'role_setting','postgres'),(4,'observation_sha256','0'*64)):
            self.setUp(); self.provenance_values[index][key] = value
            with self.subTest(index=index,key=key), self.assertRaises(AssertionError): self.invoke()
        self.setUp(); self.proof['synthetic_only'] = 1
        with self.assertRaises(AssertionError): self.invoke()
        self.setUp(); self.boundary['production_fixture_boundary_claim'] = 0
        with self.assertRaises(AssertionError): self.invoke()

    def test_duplicate_json_keys_do_not_supply_receipt_authority(self):
        with self.assertRaises(Exception):
            json.loads('{"managed_provenance_negative_cases":22,"managed_provenance_negative_cases":22}',
                       object_pairs_hook=runtime.assembly.descriptor.unique)

    def test_provenance_role_sequence_and_full_snapshot_are_mandatory(self):
        sql = runtime.provenance_stage()
        raw = (runtime.SOURCE/'record-review-v3-adapter-provenance-negatives.sql').read_text()
        self.assertEqual(sql.count(raw), 1)
        prefix, suffix = sql.split(raw)
        self.assertEqual(prefix, runtime.session_transition('postgres', 'supabase_admin') + runtime.privilege_scope_sql())
        self.assertTrue(suffix.startswith(runtime.session_transition('supabase_admin', 'postgres')))
        self.assertIn(runtime.capture.retained.VALUE, suffix)
        self.assertIn('count(*)from review_v3_readonly_baseline', suffix)
        self.assertLess(suffix.index('controlled_review_v3.required()'), suffix.index('managed_provenance_permanent_preservation'))
        self.assertIn('is distinct from retained_claims', prefix)
        self.assertIn('auth.uid() is distinct from retained_uid', prefix)
        self.assertIn("execute 'RESET SESSION AUTHORIZATION'", prefix)
        self.assertIn("execute 'SET SESSION AUTHORIZATION postgres'", suffix)
        self.assertIn("current_setting('role') is distinct from 'none'", prefix)
        with self.assertRaises(AssertionError): runtime.session_transition('authenticated', 'supabase_admin')

    def test_each_old_stage_has_exact_postgres_identity_guards(self):
        guard = runtime.postgres_stage('EXACT_BODY')
        before, after = guard.split('EXACT_BODY')
        self.assertEqual(before, after)
        self.assertIn("session_user is distinct from 'postgres'", before)
        self.assertIn("current_user is distinct from 'postgres'", before)
        self.assertIn("current_setting('role') is distinct from 'none'", before)
        self.assertIn("current_setting('session_replication_role') is distinct from 'origin'", before)

    def test_fault_iteration_and_receipt_order_use_explicit_c_collation_ast(self):
        try:
            from pglast import parse_sql, parse_plpgsql
        except ImportError:
            self.skipTest('pglast unavailable; provenance collation AST check not run')
        def walk(value):
            if isinstance(value, dict):
                yield value
                for child in value.values(): yield from walk(child)
            elif isinstance(value, (list, tuple)):
                for child in value: yield from walk(child)
        def collation(expression, fields):
            self.assertEqual(expression['@'], 'CollateClause')
            self.assertEqual([v['sval'] for v in expression['collname']], ['C'])
            self.assertEqual(expression['arg']['@'], 'ColumnRef')
            self.assertEqual([v['sval'] for v in expression['arg']['fields']], fields)
        def check(sql):
            queries = [n['query'] for n in walk(parse_plpgsql(sql))
                       if isinstance(n.get('query'), str) and 'from review_v3_provenance_faults order by' in n['query']]
            self.assertEqual(len(queries), 1)
            select = parse_sql(queries[0])[0]()['stmt']
            self.assertEqual(len(select['sortClause']), 1)
            collation(select['sortClause'][0]['node'], ['label'])
            calls = [n for stmt in parse_sql(sql) for n in walk(stmt())
                     if n.get('@') == 'FuncCall' and [v.get('sval') for v in n['funcname']] == ['jsonb_agg']]
            self.assertEqual(len(calls), 1)
            self.assertEqual(len(calls[0]['agg_order']), 2)
            for sort, field in zip(calls[0]['agg_order'], ['label', 'entrypoint']):
                collation(sort['node'], ['r', field])
        raw = (runtime.SOURCE/'record-review-v3-adapter-provenance-negatives.sql').read_text()
        check(raw)
        mutants = [raw.replace(' collate "C"', ''),
                   raw.replace('label collate "C" loop', 'label loop'),
                   raw.replace('r.label collate "C",', 'r.label,'),
                   raw.replace('r.entrypoint collate "C"', 'r.entrypoint'),
                   raw.replace('collate "C"', 'collate "POSIX"')]
        for mutated in mutants:
            with self.subTest(mutated=mutated), self.assertRaises(AssertionError): check(mutated)

    def test_fixed_session_authorization_and_observed_profile_admission(self):
        first = runtime.session_transition('supabase_admin', 'postgres')
        second = runtime.session_transition('postgres', 'supabase_admin')
        for sql, before, after in ((first,'supabase_admin','postgres'), (second,'postgres','supabase_admin')):
            self.assertIn("session_user is distinct from '"+before+"'", sql)
            self.assertIn("current_user is distinct from '"+before+"'", sql)
            self.assertIn("session_user is distinct from '"+after+"'", sql)
            self.assertIn("current_user is distinct from '"+after+"'", sql)
            for setting in ('request.jwt.claims','request.jwt.claim.sub','request.jwt.claim.role','request.jwt.claim.session_id'):
                self.assertGreaterEqual(sql.count("current_setting('"+setting+"',true)"), 2)
            for function in ('auth.uid()', 'auth.role()', 'auth.jwt()'):
                self.assertGreaterEqual(sql.count(function), 2)
            self.assertNotIn("execute 'SET ROLE", sql)
            self.assertNotIn("execute 'RESET ROLE", sql)
        admission = runtime.profile_admission_sql()
        self.assertIn('has_parameter_privilege', admission)
        self.assertIn('is distinct from', admission)
        self.assertIn(runtime.ROLE_PROFILE_RECEIPT, admission)
        self.setUp(); self.provenance_values[4]['managed_provenance_role_profile']['roles'][0]['can_set_replication_role']=True
        with self.assertRaises(AssertionError): self.invoke()


class NetworkLifecycle(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.value = runtime.Runtime.__new__(runtime.Runtime)
        self.value.folder = Path(self.temp.name)
        self.value.project = self.value.folder/'project'
        self.value.network = Mock()
        self.value.network.prepare.return_value = '2'*64
        self.value.bootstrap = Mock()
        self.value.bootstrap_restore_failed = False
        self.value.network.removed = True
        self.value.record = {'removed': False}
        self.value.log = io.StringIO()
        self.value.cleanup_deadline = None
        self.value.deadline = time.monotonic()+600
        self.value.save = Mock()

    def test_only_exact_start_argv_delegates_to_paused_bootstrap_and_stop_is_unchanged(self):
        argv = ['supabase', 'start', '--workdir', str(self.value.project), '--exclude',
            'realtime,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor']
        with patch.object(runtime.owned.Runtime, 'command') as parent:
            self.value.command(argv, timeout=600)
            self.value.bootstrap.run.assert_called_once_with(argv,parent)
            parent.assert_not_called()
            stop = ['supabase','stop','--workdir',str(self.value.project),'--no-backup']
            self.value.command(stop, timeout=150)
            parent.assert_called_once_with(stop,text=None,timeout=150,fail=True)
        self.assertNotIn('--network-id',argv)
        with self.assertRaisesRegex(AssertionError,'Unexpected bootstrap argv'):
            self.value.command(argv+['--network-id','foreign'])

    def test_candidate_admission_cannot_borrow_a_later_bootstrap_or_outer_deadline(self):
        self.value.bootstrap_phase_deadline = time.monotonic()+30
        self.value.candidate_phase_deadline = time.monotonic()+2
        with patch.object(runtime.owned.Runtime, 'command') as parent:
            self.value.command(['docker', 'inspect', 'captured-id'], timeout=120)
            self.assertGreater(parent.call_args.kwargs['timeout'], 0)
            self.assertLessEqual(parent.call_args.kwargs['timeout'], 2)
        self.value.candidate_phase_deadline = time.monotonic()-1
        with patch.object(runtime.owned.Runtime, 'command') as parent, self.assertRaisesRegex(AssertionError, 'phase deadline'):
            self.value.command(['docker', 'inspect', 'captured-id'], timeout=120)
        parent.assert_not_called()

    def test_drain_phase_deadline_caps_verification_commands_and_refuses_expiry(self):
        self.value.bootstrap_phase_deadline=time.monotonic()+2
        with patch.object(runtime.owned.Runtime,'command') as parent:
            self.value.command(['docker','inspect','captured-id'],timeout=120)
            self.assertGreater(parent.call_args.kwargs['timeout'],0)
            self.assertLessEqual(parent.call_args.kwargs['timeout'],2)
        self.value.bootstrap_phase_deadline=time.monotonic()-1
        with patch.object(runtime.owned.Runtime,'command') as parent,self.assertRaisesRegex(AssertionError,'phase deadline'):
            self.value.command(['docker','inspect','captured-id'],timeout=120)
        parent.assert_not_called()

    def test_cleanup_validates_before_parent_and_removes_after_logger_closed(self):
        order=[]
        self.value.network.before_stop.side_effect=lambda:order.append('admit')
        def parent():
            order.append('parent');self.value.log.close();self.value.record['removed']=True
            self.value.deadline=time.monotonic()+999  # Old base cannot enlarge outer cleanup cap.
        def remove():
            self.assertTrue(self.value.log.closed)
            self.assertLessEqual(self.value.remaining(999),180)
            order.append('remove')
        self.value.network.remove.side_effect=remove
        with patch.object(runtime.owned.Runtime,'cleanup',side_effect=parent):self.value.cleanup()
        self.assertEqual(order,['admit','parent','remove'])
        self.assertIs(self.value.record['owned_network_removed'],True)

    def test_foreign_or_uncertain_network_prevents_parent_cleanup(self):
        self.value.network.before_stop.side_effect=AssertionError('foreign or uncertain')
        with patch.object(runtime.owned.Runtime,'cleanup') as parent,self.assertRaises(AssertionError):self.value.cleanup()
        parent.assert_not_called();self.value.network.remove.assert_not_called()
        self.assertFalse(self.value.record['removed']);self.assertTrue(self.value.log.closed)

    def test_network_failure_cannot_leave_false_success_after_parent_cleanup(self):
        def parent():self.value.record['removed']=True;self.value.log.close()
        self.value.network.remove.side_effect=AssertionError('network remains')
        deadline=time.monotonic()+11;self.value.cleanup_deadline=deadline
        with patch.object(runtime.owned.Runtime,'cleanup',side_effect=parent),self.assertRaises(AssertionError):self.value.cleanup()
        self.assertEqual(self.value.cleanup_deadline,deadline)
        self.assertFalse(self.value.record['removed']);self.assertFalse(self.value.record['owned_network_removed'])

    def test_parent_failure_keeps_network_evidence_and_cannot_claim_cleanup(self):
        with patch.object(runtime.owned.Runtime,'cleanup',side_effect=AssertionError('services remain')),self.assertRaises(AssertionError):self.value.cleanup()
        self.value.network.remove.assert_not_called();self.assertFalse(self.value.record['removed'])

    def test_prepare_failure_is_inside_original_main_finally_and_no_parent_start(self):
        argv=['supabase','start','--workdir',str(self.value.project),'--exclude',
            'realtime,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor']
        self.value.bootstrap.run.side_effect=AssertionError('collision')
        with patch.object(runtime.owned.Runtime,'command') as parent,self.assertRaises(AssertionError):self.value.command(argv)
        parent.assert_not_called()
        import inspect
        source=inspect.getsource(runtime.main)
        self.assertLess(source.index('try:'),source.index('runtime.start(files)'))
        self.assertIn('runtime.cleanup()',source[source.index('finally:'):])


class RetainedWorkCleanup(unittest.TestCase):
    # Separate setup makes the conflicted directories tangible and ensures no
    # inherited cleanup/rmtree is invoked on that path.
    def setUp(self):
        NetworkLifecycle.setUp(self)
        self.value.bootstrap_restore_failed=True
        self.value.work=self.value.folder/'work';self.value.work.mkdir()
        self.value.project=self.value.work/'project';self.value.project.mkdir()
        self.stage=self.value.work/'gate-b-deferred-migrations';self.stage.mkdir()
        (self.stage/'changed.sql').write_text('retained changed bytes')
        self.value.identity='owned-project';self.value.databases={};self.value.owned_services={}
        self.value.check_config=Mock()
        self.value.service_inventory=Mock(return_value={})

    # Do not inherit the ordinary-path test cases into this separate fixture.
    def test_retained_work_removes_owned_services_and_network_without_parent_rmtree(self):
        self.value.owned_services={'id':{'owned':True}}
        self.value.service_inventory.return_value=dict(self.value.owned_services)
        def command(argv,**kwargs):
            self.assertLessEqual(kwargs['timeout'],120)
            return type('Result',(),{'stdout':''})()
        with patch.object(runtime.owned.Runtime,'cleanup') as parent,patch.object(runtime.owned.Runtime,'command',side_effect=command) as commands:
            self.value.cleanup()
        parent.assert_not_called()
        self.assertEqual(commands.call_args_list[0].args[0],['supabase','stop','--workdir',str(self.value.project),'--no-backup','--experimental=false'])
        self.assertTrue(self.stage.exists());self.assertEqual((self.stage/'changed.sql').read_text(),'retained changed bytes')
        self.assertFalse(self.value.record['removed']);self.assertTrue(self.value.record['work_retained'])
        self.assertTrue(self.value.record['services_removed']);self.assertTrue(self.value.record['owned_network_removed'])

    def test_registered_clone_or_changed_service_inventory_blocks_retained_cleanup(self):
        for failure in ('clone','services','config','network'):
            self.setUp()
            if failure=='clone':self.value.databases={'clone':'marker'}
            if failure=='services':self.value.owned_services={'old':{}};self.value.service_inventory.return_value={'new':{}}
            if failure=='config':self.value.check_config.side_effect=AssertionError('changed')
            if failure=='network':self.value.network.before_stop.side_effect=AssertionError('foreign')
            with self.subTest(failure=failure),patch.object(runtime.owned.Runtime,'command') as commands,self.assertRaises(AssertionError):self.value.cleanup()
            commands.assert_not_called();self.value.network.remove.assert_not_called();self.assertTrue(self.stage.exists())



if __name__ == '__main__':
    unittest.main()
