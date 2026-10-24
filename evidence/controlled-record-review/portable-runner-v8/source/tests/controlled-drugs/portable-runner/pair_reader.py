"""Single-job held physical guard reader for the frozen Transport validator API."""
import json
import math
import os
from pathlib import Path
import re
import stat
import time

MAX_BYTES=4*1024*1024
CHUNK=65536


def _path(value):
    if (type(value) is not str or not value.startswith('/') or value.startswith('//')
            or '\x00' in value or value!=str(Path(value)) or '..' in Path(value).parts):
        raise ValueError('normalized absolute physical output directory required')
    return Path(value)


def _identity(st): return (st.st_dev,st.st_ino,st.st_mode,st.st_uid)
def _stamp(st): return (*_identity(st),st.st_nlink,st.st_size,st.st_mtime_ns,st.st_ctime_ns)


class HeldPairReader:
    """Caller must close on ANY transport path, including before callback use.

    Successful __call__ already closes every owned descriptor before its final
    deadline check. Explicit parent close remains idempotent and deadline-aware.
    Caller supplies independently admitted expected context and validator code.
    """
    def __init__(self, output_directory, guard_name, context, *, deadline, validate_pair, validate_terminal):
        self.fds=[];self.edges=[];self.closed=False;self.used=False
        self.deadline=deadline
        now=time.monotonic()
        if type(deadline) not in (int,float) or not math.isfinite(deadline) or not now<deadline<=now+600:
            raise ValueError('original finite worker deadline required')
        if not callable(validate_pair) or not callable(validate_terminal):raise ValueError('admitted validators required')
        if type(guard_name) is not str or not re.fullmatch(r'[A-Za-z0-9_-]{1,100}\.json',guard_name):raise ValueError('fixed guard JSON basename required')
        self.validate_pair=validate_pair;self.validate_terminal=validate_terminal
        self.path=_path(output_directory);self.name=guard_name
        try:
            self.check()
            raw=json.dumps(context,sort_keys=True,ensure_ascii=False,allow_nan=False,separators=(',',':')).encode('utf-8','strict')
            self.check()
            if len(raw)>MAX_BYTES:raise ValueError('bounded expected context required')
            self._context_bytes=raw;self.expected_ids=tuple(json.loads(raw)['expected_ids'])
            self.fds.append(os.open('/',os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW))
            for part in self.path.parts[1:]:
                self.check();parent=self.fds[-1]
                fd=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=parent)
                self.fds.append(fd);self.edges.append((parent,part,fd,_identity(os.fstat(fd))))
            self.fd=self.fds[-1];self.root_identity=_identity(os.fstat(self.fd))
            st=os.fstat(self.fd)
            if stat.S_IMODE(st.st_mode)!=0o700 or st.st_uid!=os.getuid():raise ValueError('owned private0700 output root required')
            self.verify()
            try:os.stat(self.name,dir_fd=self.fd,follow_symlinks=False)
            except FileNotFoundError:pass
            else:raise ValueError('guard report must be new before launch')
            self.check()
        except BaseException as error:
            try:self.close()
            except BaseException as closing:error.add_note('Pair reader cleanup also failed: '+type(closing).__name__)
            raise

    def check(self):
        remaining=self.deadline-time.monotonic()
        if remaining<=0:raise TimeoutError('original worker deadline exhausted')
        return remaining

    def verify(self):
        self.check()
        if self.closed:raise ValueError('pair reader is closed')
        if _identity(os.fstat(self.fd))!=self.root_identity:raise ValueError('owned output root identity changed')
        for parent,name,fd,identity in self.edges:
            self.check();named=os.stat(name,dir_fd=parent,follow_symlinks=False)
            if not stat.S_ISDIR(named.st_mode) or _identity(named)!=identity or _identity(os.fstat(fd))!=identity:
                raise ValueError('held output ancestor identity changed')
        self.check()

    def read_guard(self):
        self.verify();fd=None;primary=None
        try:
            fd=os.open(self.name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=self.fd)
            st=os.fstat(fd)
            if not stat.S_ISREG(st.st_mode) or st.st_nlink!=1 or st.st_uid!=os.getuid() or not 0<st.st_size<=MAX_BYTES:
                raise ValueError('bounded owned single-link regular guard file required')
            chunks=[];count=0
            while True:
                self.check();chunk=os.read(fd,min(CHUNK,st.st_size+1-count));self.check()
                if not chunk:break
                count+=len(chunk)
                if count>st.st_size:raise ValueError('guard file grew during read')
                chunks.append(chunk)
            named=os.stat(self.name,dir_fd=self.fd,follow_symlinks=False);after=os.fstat(fd)
            if count!=st.st_size or _stamp(st)!=_stamp(after) or _stamp(after)!=_stamp(named):raise ValueError('guard file changed during read')
            self.verify();raw=b''.join(chunks);self.check()
        except BaseException as error:
            primary=error;raise
        finally:
            if fd is not None:
                try:os.close(fd)
                except BaseException as closing:
                    if primary is not None:primary.add_note('Guard leaf close also failed: '+type(closing).__name__)
                    else:raise
        self.check();return raw

    def __call__(self, terminal_raw, expected_ids, *, process_returncode):
        try:
            self.check()
            if self.used or self.closed:raise ValueError('one-use paired validator required')
            self.used=True
            if type(expected_ids) not in (list,tuple) or tuple(expected_ids)!=self.expected_ids:raise ValueError('transport expected IDs differ from parent context')
            if type(process_returncode) is not int or process_returncode!=0:raise ValueError('actual formal worker exit zero required')
            raw=self.read_guard()
            result=self.validate_pair(terminal_raw,raw,json.loads(self._context_bytes),process_returncode=process_returncode,
                                     validate_terminal=self.validate_terminal,check=self.check)
            self.verify();self.check();self.close();self.check()
            return result
        except BaseException as error:
            try:self.close()
            except BaseException as closing:error.add_note('Pair reader cleanup also failed: '+type(closing).__name__)
            raise

    def close(self):
        # Clear ownership before attempting all closes; never retry a possibly
        # closed numeric descriptor or skip remaining handles on a close error.
        handles,self.fds=self.fds,[];self.closed=True;first=None
        for fd in reversed(handles):
            try:os.close(fd)
            except BaseException as error:
                if first is None:first=error
        if first is not None:raise first
        self.check()
