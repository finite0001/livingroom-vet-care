"""Small pure unittest boundary tests: no child, network, database or tree copy."""
from copy import deepcopy
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('private_portable_results', HERE/'results.py')
r = importlib.util.module_from_spec(spec); spec.loader.exec_module(r)


class Guard:
    def __init__(self):
        self.active = None; self.denied = False; self.events = []
    def begin_test(self, name):
        if self.active is not None: raise RuntimeError('already active')
        self.active = name; self.events.append(('begin', name))
    def end_test(self):
        if self.active is None: raise RuntimeError('not active')
        self.events.append(('end', self.active)); self.active = None
    def assert_clean(self):
        if self.active is not None or self.denied: raise RuntimeError('sticky guard denial or active test')
    def deny(self):
        self.denied = True; raise PermissionError('synthetic denied operation')


def encoded(value):
    return (json.dumps(value, separators=(',', ':'), ensure_ascii=False)+'\n').encode()


def suite_case(fn, name='test_ok'):
    return type('SyntheticCase', (unittest.TestCase,), {name: fn})


class ResultsTests(unittest.TestCase):
    def run_cases(self, case, *, expected=None, suite=None, guard=None):
        tests = unittest.defaultTestLoader.loadTestsFromTestCase(case)
        ids = [test.id() for test in tests] if expected is None else expected
        g = guard or Guard(); result_type = r.make_result_class(ids, lambda test: test.id(), g)
        output = io.StringIO()
        result = unittest.TextTestRunner(stream=output, resultclass=result_type).run(tests if suite is None else suite)
        return result, ids, g, output.getvalue()

    def good(self):
        case = suite_case(lambda self: None)
        result, ids, guard, output = self.run_cases(case)
        self.assertTrue(result.wasSuccessful()); return result.receipt(), ids

    def reject(self, value, ids, code=0):
        with self.assertRaises((ValueError, TypeError, UnicodeError, RecursionError)):
            r.validate_terminal(encoded(value), ids, process_returncode=code)

    def test_collection_exact_set_preserves_observed_order(self):
        self.assertEqual(r.validate_collection(['b', 'a'], ['a', 'b']), ('b', 'a'))
        for actual in ([], ['a'], ['a','a'], ['a','b','c'], ['b','c'], 'ab', {'a','b'}):
            with self.subTest(actual=actual), self.assertRaises(ValueError): r.validate_collection(actual,['a','b'])
        for expected in ([], ['a','a']):
            with self.assertRaises(ValueError): r.validate_collection(['a'],expected)

    def test_id_bounds_utf8_types_and_controls(self):
        r.validate_collection(['a'*512],['a'*512])
        r.validate_collection(['a'+str(i) for i in range(4096)], ['a'+str(i) for i in range(4096)])
        for value in ('', 'a'*513, 'é'*257, 'test\nwrong', 'test\x7f', True, 2, None):
            with self.subTest(value=str(value)[:30]), self.assertRaises((ValueError,UnicodeError)):
                r.validate_collection([value],[value])
        with self.assertRaises(ValueError): r.validate_collection(['a'+str(i)for i in range(4097)],['x'])

    def test_actual_unittest_success_and_ordered_index_events(self):
        class Tests(unittest.TestCase):
            def test_a(self): pass
            def test_b(self): pass
        result, ids, g, _ = self.run_cases(Tests)
        value = result.receipt()
        self.assertTrue(result.wasSuccessful());self.assertTrue(value['passed'])
        self.assertEqual(value['started'],[0,1]);self.assertEqual(value['stopped'],[0,1]);self.assertEqual(value['succeeded'],[0,1])
        self.assertEqual(g.events,[('begin',ids[0]),('end',ids[0]),('begin',ids[1]),('end',ids[1])])
        self.assertEqual(r.validate_terminal(encoded(value), list(reversed(ids)), process_returncode=0),value)
        value['ids'][0]='changed'
        self.assertEqual(result.receipt()['ids'],ids)

    def test_native_was_successful_skip_and_expected_failure_never_accept(self):
        for fn, category in ((unittest.skip('not a pass')(lambda self:None),'skips'),
                (unittest.expectedFailure(lambda self:self.fail('expected')),'expected_failures')):
            result,ids,_,_=self.run_cases(suite_case(fn))
            self.assertTrue(unittest.TestResult.wasSuccessful(result))
            self.assertFalse(result.wasSuccessful());self.assertEqual(len(result.receipt()['problems'][category]),1)
            self.reject(result.receipt(),ids)

    def test_failure_error_unexpected_success_and_subtest_categories(self):
        def error(self): raise RuntimeError('not a pass')
        def subfail(self):
            with self.subTest(part=1): self.fail('subtest')
        def suberror(self):
            with self.subTest(part=1): raise RuntimeError('subtest')
        for fn,category in ((lambda self:self.fail('fail'),'failures'),(error,'errors'),
                (unittest.expectedFailure(lambda self:None),'unexpected_successes'),(subfail,'subtest_failures'),(suberror,'subtest_errors')):
            result,ids,_,_=self.run_cases(suite_case(fn))
            self.assertFalse(result.wasSuccessful());self.assertTrue(result.receipt()['problems'][category]);self.reject(result.receipt(),ids)

    def test_setupclass_error_cannot_hide_behind_zero_started(self):
        class Tests(unittest.TestCase):
            @classmethod
            def setUpClass(cls): raise RuntimeError('setup class failure')
            def test_a(self): pass
        result,ids,_,_=self.run_cases(Tests)
        value=result.receipt();self.assertEqual(value['tests_run'],0)
        self.assertEqual(value['started'],[]);self.assertEqual(len(value['problems']['errors']),1)
        self.assertGreater(len(value['ids']),len(ids));self.reject(value,ids)

    def test_dropped_duplicate_and_wrong_runtime_ids_reject(self):
        case=suite_case(lambda self:None);name=case('test_ok').id()
        for suite,expected in ((unittest.TestSuite(),[name]),
              (unittest.TestSuite([case('test_ok'),case('test_ok')]),[name]),
              (unittest.TestSuite([case('test_ok')]),['different'])):
            result,ids,_,_=self.run_cases(case,expected=expected,suite=suite)
            self.assertFalse(result.wasSuccessful());self.reject(result.receipt(),ids)

    def test_swallowed_guard_denial_stays_failed(self):
        guard=Guard()
        def swallowed(self):
            try: guard.deny()
            except PermissionError: pass
        case=suite_case(swallowed);ids=[case('test_ok').id()]
        result=r.make_result_class(ids,lambda t:t.id(),guard)(io.StringIO(),True,0)
        with self.assertRaisesRegex(RuntimeError,'sticky'):case('test_ok').run(result)
        self.assertIsNone(guard.active);value=result.receipt()
        self.assertTrue(value['succeeded']);self.assertGreater(value['guard_errors'],0)
        self.assertFalse(value['passed']);self.reject(value,ids)
        guard.denied=False
        self.assertFalse(result.receipt()['passed'])

    def test_begin_and_end_hook_errors_preserve_primary_and_block_pass(self):
        for hook in ('begin_test','end_test'):
            guard=Guard();case=suite_case(lambda self:None);ids=[case('test_ok').id()]
            result=r.make_result_class(ids,lambda t:t.id(),guard)(io.StringIO(),True,0)
            with patch.object(guard,hook,side_effect=OSError('hook-primary')):
                with self.assertRaisesRegex(OSError,'hook-primary'):case('test_ok').run(result)
            self.assertFalse(result.receipt()['passed']);self.reject(result.receipt(),ids)

    def test_bad_lifecycle_success_without_start_and_overlap(self):
        case=suite_case(lambda self:None);test=case('test_ok');ids=[test.id()]
        result=r.make_result_class(ids,lambda t:t.id(),Guard())(io.StringIO(),True,0)
        result.addSuccess(test);self.assertFalse(result.receipt()['passed'])
        result.startTest(test)
        with self.assertRaisesRegex(ValueError,'overlapping'):result.startTest(test)
        result.stopTest(test);self.reject(result.receipt(),ids)

    def test_parent_formal_types_keys_counts_sets_and_flags(self):
        good,ids=self.good()
        for key,value in (('passed',1),('guard_clean',1),('tests_run',True),('expected_count',1.0),
                ('guard_errors',False),('protocol_errors',False),('tests_run',0),('expected_count',2),
                ('expected_ids_sha256','0'*64),('passed',False),('guard_clean',False),('guard_errors',1),('protocol_errors',1),
                ('started',[]),('stopped',[0,0]),('succeeded',[True]),('succeeded',[1]),('ids',['foreign'])):
            item=deepcopy(good);item[key]=value;self.reject(item,ids)
        for key in good:
            item=deepcopy(good);del item[key];self.reject(item,ids)
        item=dict(good,extra=True);self.reject(item,ids)
        for name in r.CATEGORIES:
            item=deepcopy(good);item['problems'][name]=[0];self.reject(item,ids)
        item=deepcopy(good);del item['problems']['errors'];self.reject(item,ids)

    def test_parent_requires_actual_returncode_and_bounded_single_strict_json(self):
        value,ids=self.good();raw=encoded(value)
        for code in (1,-9,True,False,None,0.0):
            with self.subTest(code=code),self.assertRaises(ValueError):r.validate_terminal(raw,ids,process_returncode=code)
        with self.assertRaises(TypeError):r.validate_terminal(raw,ids)
        for bad in (b'',raw[:-2],raw+raw,b'\xff',raw.replace(b'"passed":true',b'"passed":true,"passed":true'),raw.replace(b'"tests_run":1',b'"tests_run":NaN'),b' '* (r.MAX_RESULT+1)):
            with self.subTest(length=len(bad)),self.assertRaises((ValueError,UnicodeError)):
                r.validate_terminal(bad,ids,process_returncode=0)
        with self.assertRaises(ValueError):r.validate_terminal(raw.decode(),ids,process_returncode=0)

    def test_small_terminal_exclusive_write_and_readback(self):
        value,ids=self.good();checks=[]
        with tempfile.TemporaryDirectory()as tmp:
            path=Path(tmp).resolve()/'terminal.json'
            receipt=r.write_terminal(path,value,lambda:checks.append(True))
            self.assertGreater(len(checks),5);self.assertEqual(path.stat().st_mode&0o777,0o600)
            self.assertEqual(receipt['bytes'],len(path.read_bytes()))
            self.assertEqual(r.validate_terminal(path.read_bytes(),ids,process_returncode=0),value)
            with self.assertRaises(FileExistsError):r.write_terminal(path,value,lambda:None)
            self.assertEqual(r.validate_terminal(path.read_bytes(),ids,process_returncode=0),value)

    def test_terminal_no_follow_ancestor_leaf_or_fifo(self):
        value,_=self.good()
        with tempfile.TemporaryDirectory()as tmp:
            root=Path(tmp).resolve();real=root/'real';real.mkdir();alias=root/'alias';alias.symlink_to(real,target_is_directory=True)
            with self.assertRaises(OSError):r.write_terminal(alias/'result',value,lambda:None)
            self.assertFalse((real/'result').exists())
            leaf=root/'leaf';leaf.symlink_to(root/'untouched')
            with self.assertRaises(FileExistsError):r.write_terminal(leaf,value,lambda:None)
            self.assertFalse((root/'untouched').exists())
            fifo=root/'fifo';os.mkfifo(fifo)
            with self.assertRaises(FileExistsError):r.write_terminal(fifo,value,lambda:None)

    def test_terminal_size_admission_and_expired_prewrite_no_file(self):
        with tempfile.TemporaryDirectory()as tmp:
            path=Path(tmp).resolve()/'result'
            with self.assertRaises(ValueError):r.write_terminal(path,{'oversize':'a'*r.MAX_RESULT},lambda:None)
            self.assertFalse(path.exists())
            with self.assertRaisesRegex(TimeoutError,'expired'):r.write_terminal(path,{},lambda:(_ for _ in ()).throw(TimeoutError('expired')))
            self.assertFalse(path.exists())

    def test_terminal_partial_then_io_error_preserves_bytes_and_raises(self):
        value,_=self.good();original=os.write;calls=[]
        def writing(fd,data):
            calls.append(True)
            if len(calls)==1:return original(fd,data[:7])
            raise OSError('partial-write-primary')
        with tempfile.TemporaryDirectory()as tmp:
            path=Path(tmp).resolve()/'result'
            with patch.object(r.os,'write',side_effect=writing),self.assertRaisesRegex(OSError,'partial-write-primary'):
                r.write_terminal(path,value,lambda:None)
            self.assertEqual(len(path.read_bytes()),7)

    def test_full_written_then_late_failure_requires_nonzero_process(self):
        value,ids=self.good();original=os.write;late=[False]
        def writing(fd,data):
            count=original(fd,data);late[0]=True;return count
        def check():
            if late[0]:raise TimeoutError('late terminal write')
        with tempfile.TemporaryDirectory()as tmp:
            path=Path(tmp).resolve()/'result'
            with patch.object(r.os,'write',side_effect=writing),self.assertRaisesRegex(TimeoutError,'late terminal'):
                r.write_terminal(path,value,check)
            self.assertTrue(json.loads(path.read_bytes())['passed'])
            with self.assertRaises(ValueError):r.validate_terminal(path.read_bytes(),ids,process_returncode=1)

    def test_terminal_full_write_then_ioerror_never_returns(self):
        value,ids=self.good();original=os.write
        def writing(fd,data):
            original(fd,data);raise OSError('full-write-then-error')
        with tempfile.TemporaryDirectory()as tmp:
            path=Path(tmp).resolve()/'result'
            with patch.object(r.os,'write',side_effect=writing),self.assertRaisesRegex(OSError,'full-write-then-error'):
                r.write_terminal(path,value,lambda:None)
            self.assertTrue(json.loads(path.read_bytes())['passed'])
            with self.assertRaises(ValueError):r.validate_terminal(path.read_bytes(),ids,process_returncode=1)

    def test_terminal_close_error_preserves_primary_and_refuses_success(self):
        value,_=self.good();real_close=os.close
        def closing(fd):
            real_close(fd);raise OSError('close-secondary')
        with tempfile.TemporaryDirectory()as tmp:
            path=Path(tmp).resolve()/'result'
            with patch.object(r.os,'close',side_effect=closing),self.assertRaisesRegex(OSError,'close-secondary'):
                r.write_terminal(path,value,lambda:None)
            self.assertTrue(path.is_file())
            path2=Path(tmp).resolve()/'partial'
            with patch.object(r.os,'close',side_effect=closing),patch.object(r.os,'write',side_effect=OSError('write-primary')),self.assertRaisesRegex(OSError,'write-primary')as caught:
                r.write_terminal(path2,value,lambda:None)
            self.assertTrue(caught.exception.__notes__)
            self.assertTrue(path2.is_file())

    def test_parent_rename_symlink_swap_never_writes_outside_and_refuses(self):
        value,_=self.good();original=os.write;changed=[False]
        with tempfile.TemporaryDirectory()as tmp:
            root=Path(tmp).resolve();parent=root/'parent';parent.mkdir();outside=root/'outside';outside.mkdir();held=root/'held'
            def writing(fd,data):
                if not changed[0]:parent.rename(held);parent.symlink_to(outside,target_is_directory=True);changed[0]=True
                return original(fd,data)
            with patch.object(r.os,'write',side_effect=writing),self.assertRaisesRegex(ValueError,'parent identity'):
                r.write_terminal(parent/'result',value,lambda:None)
            self.assertEqual(list(outside.iterdir()),[]);self.assertTrue((held/'result').is_file())


if __name__=='__main__':unittest.main(verbosity=2)
