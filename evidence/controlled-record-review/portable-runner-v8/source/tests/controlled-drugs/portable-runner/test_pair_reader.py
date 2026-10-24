"""Tiny physical paired-reader tests; no processes, target workers or network."""
from copy import deepcopy
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

HERE=Path(__file__).resolve().parent

def load(name,path):
 spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m

p=load('pair_reader_under_test',HERE/'pair_reader.py')
f=load('pair_reader_fixtures',HERE/'test_guard_report.py')
t=load('pair_reader_frozen_transport',HERE/'transport.py')
REAL_CLOCK=time.monotonic
RETAINED=[]


class PairReaderTests(unittest.TestCase):
 def setUp(self):
  self.root=Path(tempfile.mkdtemp(prefix='portable-pair-reader-')).resolve();self.root.chmod(0o700);RETAINED.append(str(self.root))
  self.context,self.guard,self.terminal=f.fixtures();self.terminal_raw,self.guard_raw=f.encode(self.guard,self.terminal)
  self.deadline=REAL_CLOCK()+30;self.readers=[]
 def tearDown(self):
  for reader in self.readers:
   if reader.fds:reader.close()
  # Retain all synthetic bytes, including negative evidence.
 def reader(self,**kwargs):
  reader=p.HeldPairReader(str(self.root),'guard.json',self.context,deadline=self.deadline,
                         validate_pair=kwargs.pop('validator',f.g.validate_pair),validate_terminal=f.r.validate_terminal,**kwargs)
  self.readers.append(reader);return reader
 def write(self,raw=None):
  path=self.root/'guard.json';path.write_bytes(self.guard_raw if raw is None else raw);path.chmod(0o600)
 def run_reader(self,reader,**kwargs):return reader(self.terminal_raw,self.context['expected_ids'],process_returncode=kwargs.pop('code',0),**kwargs)
 def test_exact_pair_closes_every_held_descriptor_before_success(self):
  reader=self.reader();fds=reader.fds[:];self.write();pair=self.run_reader(reader)
  self.assertEqual(pair['kind'],'portable-worker-validated-pair-v1');self.assertTrue(reader.closed);self.assertEqual(reader.fds,[])
  for fd in fds:
   with self.assertRaises(OSError):os.fstat(fd)
  reader.close()
  with self.assertRaises(ValueError):self.run_reader(reader)
 def test_context_is_copied_to_immutable_bytes_before_caller_mutation(self):
  reader=self.reader();self.context['job_id']='mutated';self.context['allowed_routes'][f.ID]={}
  self.write();pair=reader(self.terminal_raw,[f.ID],process_returncode=0);self.assertEqual(pair['result']['tests_run'],1)
 def test_existing_guard_and_symlink_ancestor_refuse_before_launch(self):
  self.write()
  with self.assertRaises(ValueError):self.reader()
  alias=self.root/'alias';alias.symlink_to(self.root,target_is_directory=True)
  with self.assertRaises(OSError):p.HeldPairReader(str(alias),'new.json',self.context,deadline=self.deadline,validate_pair=f.g.validate_pair,validate_terminal=f.r.validate_terminal)
 def test_missing_file_and_nonzero_exit_no_terminal_fallback(self):
  reader=self.reader()
  with self.assertRaises(FileNotFoundError):self.run_reader(reader)
  self.assertTrue(reader.closed)
  reader=self.reader()
  with self.assertRaises(ValueError):self.run_reader(reader,code=1)
  self.assertTrue(reader.closed)
 def test_expected_ids_mismatch_fails_and_closes(self):
  reader=self.reader();self.write()
  with self.assertRaises(ValueError):reader(self.terminal_raw,['wrong'],process_returncode=0)
  self.assertFalse(reader.fds)
 def test_fifo_symlink_hardlink_and_size_refuse(self):
  for kind in ('fifo','symlink','hardlink','oversize'):
   with self.subTest(kind=kind):
    sub=self.root/kind;sub.mkdir(mode=0o700);prior=self.root;self.root=sub
    reader=self.reader()
    if kind=='fifo':os.mkfifo(sub/'guard.json',0o600)
    elif kind=='symlink':(sub/'real').write_bytes(self.guard_raw);(sub/'guard.json').symlink_to(sub/'real')
    elif kind=='hardlink':self.write();os.link(sub/'guard.json',sub/'second')
    else:self.write()
    with patch.object(p,'MAX_BYTES',16) if kind=='oversize' else patch.object(p,'MAX_BYTES',4194304):
     with self.assertRaises((ValueError,OSError)):self.run_reader(reader)
    self.assertFalse(reader.fds);self.root=prior
 def test_root_replacement_refuses_held_old_tree(self):
  reader=self.reader();self.write();held=self.root.with_name(self.root.name+'-held');self.root.rename(held);self.root.mkdir(mode=0o700);RETAINED.append(str(held))
  self.write()
  with self.assertRaises(ValueError):self.run_reader(reader)
  self.assertFalse(reader.fds)
 def test_leaf_replacement_between_read_and_stat_refuses(self):
  reader=self.reader();self.write();original=os.read;changed=[False]
  def swap(fd,size):
   raw=original(fd,size)
   if not changed[0]:changed[0]=True;(self.root/'guard.json').rename(self.root/'retained.json');self.write()
   return raw
  with patch.object(os,'read',side_effect=swap),self.assertRaises(ValueError):self.run_reader(reader)
  self.assertFalse(reader.fds)
 def test_partial_read_refuses_without_zero_length_success(self):
  reader=self.reader();self.write()
  with patch.object(os,'read',return_value=b''),self.assertRaises(ValueError):self.run_reader(reader)
 def test_leaf_close_error_is_failure_and_all_ancestor_fds_close(self):
  reader=self.reader();self.write();fds=reader.fds[:];original=os.close;injected=[False]
  def close(fd):
   original(fd)
   if not injected[0]:injected[0]=True;raise OSError('close after actual leaf close')
  with patch.object(os,'close',side_effect=close),self.assertRaises(OSError):self.run_reader(reader)
  self.assertEqual(reader.fds,[])
  for fd in fds:
   with self.assertRaises(OSError):os.fstat(fd)
 def test_ancestor_close_error_after_valid_pair_revokes_success(self):
  reader=self.reader();self.write();fds=reader.fds[:];original=os.close;injected=[False]
  def close(fd):
   original(fd)
   if fd in fds and not injected[0]:injected[0]=True;raise OSError('ancestor close error')
  with patch.object(os,'close',side_effect=close),self.assertRaises(OSError):self.run_reader(reader)
  self.assertEqual(reader.fds,[])
  for fd in fds:
   with self.assertRaises(OSError):os.fstat(fd)
 def test_final_close_deadline_cannot_return_valid_pair(self):
  reader=self.reader();self.write();original=reader.close;offset=[0]
  def close():original();offset[0]=601
  with patch.object(reader,'close',side_effect=close),patch.object(time,'monotonic',side_effect=lambda:REAL_CLOCK()+offset[0]),self.assertRaises(TimeoutError):self.run_reader(reader)
  self.assertFalse(reader.fds)
 def test_deadline_during_bounded_read_and_chunks(self):
  reader=self.reader();self.write();original=os.read;sizes=[];offset=[0]
  def read(fd,size):sizes.append(size);value=original(fd,size);offset[0]=601;return value
  with patch.object(os,'read',side_effect=read),patch.object(time,'monotonic',side_effect=lambda:REAL_CLOCK()+offset[0]),self.assertRaises(TimeoutError):self.run_reader(reader)
  self.assertTrue(all(0<size<=65536 for size in sizes));self.assertFalse(reader.fds)
 def test_invalid_deadline_paths_names_refuse(self):
  for deadline in (True,float('nan'),float('inf'),REAL_CLOCK()-1,REAL_CLOCK()+601):
   with self.assertRaises(ValueError):p.HeldPairReader(str(self.root),'guard.json',self.context,deadline=deadline,validate_pair=f.g.validate_pair,validate_terminal=f.r.validate_terminal)
  for path in ('/'+str(self.root),str(self.root)+'/..','relative'):
   with self.assertRaises(ValueError):p.HeldPairReader(path,'guard.json',self.context,deadline=self.deadline,validate_pair=f.g.validate_pair,validate_terminal=f.r.validate_terminal)
  for name in ('../guard.json','guard','',None):
   with self.assertRaises(ValueError):p.HeldPairReader(str(self.root),name,self.context,deadline=self.deadline,validate_pair=f.g.validate_pair,validate_terminal=f.r.validate_terminal)
 def test_pair_failure_poison_via_actual_frozen_transport_no_child(self):
  reader=self.reader();owner=t.Transport(reader)
  prepared={'argv':[str(Path(sys.executable).resolve()),'-I','-B',str(self.root/'worker.py'),'--job',str(self.root/'job.json'),'--job-sha256','1'*64],
   'cwd':str(self.root),'env':{'PATH':'/usr/bin:/bin'},'evidence_directory':str(self.root),
   'stdout_name':'stdout.bin','stderr_name':'stderr.bin','terminal_name':'terminal.json','expected_ids':[f.ID],'deadline':self.deadline}
  class InertExited:
   pid=1;returncode=0
   def __init__(self):
    self.stdout,self.stderr=self.pipe(),self.pipe()
   @staticmethod
   def pipe():
    rd,wr=os.pipe();os.close(wr);return os.fdopen(rd,'rb',buffering=0)
   def poll(self):return 0
  def admitted_spawn(*args,**kwargs):
   # A mocked already-exited child; no real process operation occurs.
   self.write(b'{}');(self.root/'terminal.json').write_bytes(self.terminal_raw)
   return InertExited()
  with patch.object(subprocess,'Popen',side_effect=admitted_spawn),self.assertRaises(t.TransportFailure) as error:
   owner.run(prepared,admit=lambda _:None,check_storage=lambda:None)
  self.assertFalse(error.exception.receipt['passed']);self.assertTrue(owner.poisoned);self.assertFalse(reader.fds)
  with patch.object(subprocess,'Popen',side_effect=AssertionError('no next job')),self.assertRaises(t.TransportFailure):owner.run(prepared,admit=lambda _:None,check_storage=lambda:None)


if __name__=='__main__':
 try:unittest.main(verbosity=2)
 finally:print('Retained pair-reader fixtures:',json.dumps(RETAINED),flush=True)
