"""Small pure state-machine tests. No process, network or filesystem fixtures."""
import importlib.util
from pathlib import Path
import sys
import unittest

SPEC = importlib.util.spec_from_file_location('portable_accounting_test_subject',
                                            Path(__file__).with_name('run_accounting.py'))
M = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = M
SPEC.loader.exec_module(M)


class RunAccountingTests(unittest.TestCase):
    def setUp(self):
        self.now = 100.0
        self.free = 10 * M.GIB

    def make(self, jobs=None, **kw):
        return M.RunAccounting(jobs or {'one': ['module.py::Case.test_one']},
                               source_copy_bytes=kw.get('copy', 159_601_715),
                               historical_peak_bytes=kw.get('historical', 68_563_791),
                               read_available=lambda: self.free, clock=lambda: self.now)

    def sizes(self):
        return dict(job=100, stdout=0, stderr=0, terminal=200, guard=300)

    def commit(self, owner, ticket, callback=lambda: None):
        owner.commit(ticket, self.sizes(), finalize=callback)

    def assert_stopped(self, owner):
        original = owner.failure
        self.assertIsNotNone(original)
        with self.assertRaises(ValueError): owner.begin('one')
        self.assertEqual(owner.failure, original)

    def test_exact_serial_inventory_and_accounting_only(self):
        owner = self.make({'one': ['a::C.test_a'], 'two': ['b::C.test_b']})
        for name in ('one', 'two'):
            ticket = owner.begin(name)
            self.assertEqual(ticket.deadline, self.now + 600)
            self.now += 1
            self.commit(owner, ticket)
        receipt = owner.finish(finalize=lambda: None)
        self.assertEqual(receipt['jobs_completed'], ['one', 'two'])
        self.assertEqual(receipt['test_ids_counted'], 2)
        self.assertEqual(receipt['evidence_bytes_observed'], 1200)
        self.assertEqual(receipt['evidence_bytes_reserved'], 40 * M.MIB)
        self.assertFalse(receipt['full_routing_acceptance'])
        self.assertFalse(receipt['database_acceptance'])
        self.assertFalse(receipt['descendant_cleanup_verified'])

    def test_inventory_is_detached_from_caller(self):
        jobs = {'one': ['a::C.test_a']}
        owner = self.make(jobs)
        jobs['one'].append('extra'); jobs['two'] = ['extra']
        ticket = owner.begin('one')
        self.assertEqual(ticket.expected_ids, ('a::C.test_a',))
        self.commit(owner, ticket)
        self.assertEqual(owner.finish(finalize=lambda: None)['test_ids_counted'], 1)

    def test_duplicate_intersecting_oversized_inventory_refused(self):
        for jobs in ({'one': ['a', 'a']}, {'one': ['a'], 'two': ['a']},
                     {'one': ['x' * 513]}, {'one': [True]}, {'one': ['a\n']},
                     {f'job{i}': [f'id{i}'] for i in range(97)},
                     {'one': [str(i) for i in range(4097)]}):
            with self.subTest(jobs_count=len(jobs)):
                with self.assertRaises(ValueError): self.make(jobs)

    def test_96_jobs_leave_128_mib_headroom(self):
        owner = self.make({f'job{i}': [f'id{i}'] for i in range(96)})
        self.assertEqual(owner._reserved, M.POOL_BYTES - 128 * M.MIB)

    def test_expanded_historical_tree_exceeds_64_mib_but_is_admitted(self):
        owner = self.make()
        self.free = 4 * M.GIB + 159_601_715 + 68_563_791
        self.assertGreater(68_563_791, 64 * M.MIB)
        owner.begin('one')

    def test_one_byte_below_capacity_stops_before_job(self):
        owner = self.make()
        self.free = 4 * M.GIB + 159_601_715 + 68_563_791 - 1
        with self.assertRaises(ValueError): owner.begin('one')
        self.assert_stopped(owner)

    def test_capacity_formal_types_and_declared_bounds(self):
        for kw in ({'copy': True}, {'copy': M.MAX_COPY_BYTES + 1},
                   {'historical': -1}, {'historical': M.MAX_HISTORICAL_BYTES + 1}):
            with self.assertRaises(ValueError): self.make(**kw)
        for free in (True, float(10 * M.GIB), -1):
            owner = self.make(); self.free = free
            with self.assertRaises(ValueError): owner.begin('one')
            self.assert_stopped(owner)

    def test_fixed_order_and_serial_active_job(self):
        owner = self.make({'one': ['a'], 'two': ['b']})
        with self.assertRaises(ValueError): owner.begin('two')
        self.assert_stopped(owner)
        owner = self.make(); owner.begin('one')
        with self.assertRaises(ValueError): owner.begin('one')
        self.assert_stopped(owner)

    def test_foreign_and_forged_ticket_cannot_receive_credit(self):
        first, second = self.make(), self.make()
        real = first.begin('one'); foreign = second.begin('one')
        with self.assertRaises(ValueError): self.commit(first, foreign)
        self.assert_stopped(first)
        self.assertIsNone(second.failure)
        owner = self.make(); ticket = owner.begin('one')
        forged = M.Ticket(ticket.job_id, ticket.deadline, ticket.expected_ids, ticket.owner)
        with self.assertRaises(ValueError): self.commit(owner, forged)
        self.assert_stopped(owner)

    def test_deadline_not_reset_at_capacity_or_commit(self):
        owner = self.make(); ticket = owner.begin('one')
        self.now = ticket.deadline
        with self.assertRaises(ValueError): owner.checkpoint(ticket)
        self.assert_stopped(owner)

    def test_capacity_callback_time_is_in_original_deadline(self):
        owner = self.make()
        def slow_capacity():
            self.now += 600
            return self.free
        owner._read_available = slow_capacity
        with self.assertRaises(ValueError): owner.begin('one')
        self.assert_stopped(owner)

    def test_finalize_close_error_is_sticky_and_gets_no_credit(self):
        owner = self.make(); ticket = owner.begin('one')
        def fail_close(): raise OSError('simulated close failure')
        with self.assertRaises(OSError): self.commit(owner, ticket, fail_close)
        self.assertEqual(owner._completed, [])
        self.assert_stopped(owner)

    def test_late_finalize_cannot_credit_passing_transport(self):
        owner = self.make(); ticket = owner.begin('one')
        def late(): self.now = ticket.deadline
        with self.assertRaises(ValueError): self.commit(owner, ticket, late)
        self.assertEqual(owner._completed, [])
        self.assert_stopped(owner)

    def test_storage_drop_during_finalize_stops(self):
        owner = self.make(); ticket = owner.begin('one')
        def drop(): self.free = 0
        with self.assertRaises(ValueError): self.commit(owner, ticket, drop)
        self.assert_stopped(owner)

    def test_all_five_slots_have_formal_caps_and_nonempty_pairs(self):
        variants = [dict(self.sizes(), extra=1), dict(self.sizes(), stdout=True),
                    dict(self.sizes(), guard=0), dict(self.sizes(), job=0),
                    dict(self.sizes(), terminal=M.SLOT_BYTES + 1)]
        for sizes in variants:
            owner = self.make(); ticket = owner.begin('one')
            with self.assertRaises(ValueError): owner.commit(ticket, sizes, finalize=lambda: None)
            self.assert_stopped(owner)

    def test_caller_length_mutation_cannot_change_counted_bytes(self):
        owner = self.make(); ticket = owner.begin('one'); sizes = self.sizes()
        owner.commit(ticket, sizes, finalize=lambda: sizes.update(guard=0))
        self.assertEqual(owner.finish(finalize=lambda: None)['evidence_bytes_observed'], 600)

    def test_missing_job_and_repeated_finish_refuse(self):
        owner = self.make()
        with self.assertRaises(ValueError): owner.finish(finalize=lambda: None)
        self.assert_stopped(owner)
        owner = self.make(); ticket = owner.begin('one'); self.commit(owner, ticket)
        owner.finish(finalize=lambda: None)
        with self.assertRaises(ValueError): owner.finish(finalize=lambda: None)

    def test_final_persistence_crossing_last_deadline_refuses(self):
        owner = self.make(); ticket = owner.begin('one'); self.commit(owner, ticket)
        def late(): self.now = ticket.deadline
        with self.assertRaises(ValueError): owner.finish(finalize=late)
        self.assert_stopped(owner)

    def test_outer_failure_retains_first_reason_and_detaches_receipt(self):
        owner = self.make(); owner.begin('one')
        observed = owner.fail('source_changed'); observed['code'] = 'overwritten'
        owner.fail('close_failed')
        self.assertEqual(owner.failure['code'], 'source_changed')
        self.assert_stopped(owner)

    def test_clock_backwards_nonfinite_and_bool_refuse(self):
        for invalid in (99, float('nan'), float('inf'), True):
            owner = self.make(); ticket = owner.begin('one'); self.now = invalid
            with self.assertRaises(ValueError): owner.checkpoint(ticket)
            self.assert_stopped(owner)
            self.now = 100.0

    def test_final_capacity_latched_failure_cannot_report_complete(self):
        owner = self.make(); ticket = owner.begin('one'); self.commit(owner, ticket)
        def poison_capacity():
            owner.fail('source_changed')
            return self.free
        owner._read_available = poison_capacity
        with self.assertRaises(ValueError): owner.finish(finalize=lambda: None)
        self.assertFalse(owner._finished)
        self.assertEqual(owner.failure['code'], 'source_changed')
        self.assert_stopped(owner)

    def test_final_clock_latched_failure_cannot_report_complete(self):
        owner = self.make(); ticket = owner.begin('one'); self.commit(owner, ticket)
        calls = 0
        def poison_final_clock():
            nonlocal calls
            calls += 1
            if calls == 2: owner.fail('clock_observer_failed')
            return self.now
        owner._clock = poison_final_clock
        with self.assertRaises(ValueError): owner.finish(finalize=lambda: None)
        self.assertFalse(owner._finished)
        self.assertEqual(owner.failure['code'], 'clock_observer_failed')
        self.assert_stopped(owner)

    def test_last_commit_clock_latched_failure_gets_no_credit(self):
        owner = self.make(); ticket = owner.begin('one')
        calls = 0
        def poison_last_clock():
            nonlocal calls
            calls += 1
            if calls == 3: owner.fail('source_changed')
            return self.now
        def finalization(): owner._clock = poison_last_clock
        with self.assertRaises(ValueError): self.commit(owner, ticket, finalization)
        self.assertEqual(owner._completed, [])
        self.assertEqual(owner.failure['code'], 'source_changed')
        self.assert_stopped(owner)


if __name__ == '__main__':
    unittest.main(verbosity=2)
