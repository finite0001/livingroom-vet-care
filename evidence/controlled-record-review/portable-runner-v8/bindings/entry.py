"""Source-bound entry template; bind literals once, review, then run four paths.

This template is not executable authority until its three literal bindings are
filled from separately admitted artifacts. No expected-hash/code/subset CLI flags.
"""
import hashlib
import json
import os
from pathlib import Path
import stat
import sys
import time
import types

PROFILE_SHA = 'bc7c134b9521697664bc5b18c7784b1d967d531289712672f3b2a1d49124ecb1'
CONTROLLER_SHA = 'a422c978e9aeeed5c490035f2158623c763cdad2a13b4069ee4aa875034d2278'
TOOL_BINDING = json.loads('{"profile_path":"/private/tmp/lrvt-fdjazqmt/local-portable-tools/profile.json","profile_sha256":"bd605f6cfbe584f39c24bb647af2fe827798ec0a3c14bc582fe0be955bc14ce3","receipt_path":"/private/tmp/lrvt-fdjazqmt/local-portable-tools/receipt.json","receipt_sha256":"2cab8240d69fed6b1f80bd2698a1111f99dec88f46ebaaced4cada1b5c288c09"}')


def read(path,expected,maximum,deadline):
    if not path.is_absolute()or'..'in path.parts or str(path).startswith('//'):
        raise ValueError('physical bound entry source path required')
    def check():
        if time.monotonic()>=deadline:raise TimeoutError('original entry/bootstrap cutoff exhausted')
    def stamp(info):
        return info.st_dev,info.st_ino,info.st_mode,info.st_uid,info.st_nlink,info.st_size,info.st_mtime_ns,info.st_ctime_ns
    descriptors=[];edges=[];primary=None
    try:
        check();descriptors.append(os.open('/',os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW))
        for name in path.parts[1:-1]:
            check();parent=descriptors[-1];fd=os.open(name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=parent)
            descriptors.append(fd);edges.append((parent,name,fd,stamp(os.fstat(fd))[:4]))
        fd=os.open(path.name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=descriptors[-1]);descriptors.append(fd)
        before=os.fstat(fd)
        if not stat.S_ISREG(before.st_mode)or before.st_uid!=os.getuid()or before.st_nlink!=1 or before.st_mode&0o022 or not 0<before.st_size<=maximum:
            raise ValueError('bounded owned entry dependency required')
        chunks=[];count=0
        while True:
            check();part=os.read(fd,min(65536,before.st_size+1-count));check()
            if not part:break
            chunks.append(part);count+=len(part)
            if count>before.st_size:raise ValueError('entry dependency grew')
        raw=b''.join(chunks)
        if count!=before.st_size or stamp(before)!=stamp(os.fstat(fd))or stamp(before)!=stamp(os.stat(path.name,dir_fd=descriptors[-2],follow_symlinks=False)):
            raise ValueError('entry dependency changed')
        for parent,name,child,identity in edges:
            check()
            if stamp(os.fstat(child))[:4]!=identity or stamp(os.stat(name,dir_fd=parent,follow_symlinks=False))[:4]!=identity:
                raise ValueError('entry dependency ancestor changed')
        if hashlib.sha256(raw).hexdigest()!=expected:raise ValueError('bound entry dependency hash differs')
    except BaseException as error:primary=error;raise
    finally:
        closing=None
        for fd in reversed(descriptors):
            try:os.close(fd)
            except BaseException as error:
                if primary is not None:primary.add_note('entry dependency close also failed: '+type(error).__name__)
                elif closing is None:closing=error
        if closing is not None:raise closing
    check();return raw


def main():
    deadline=time.monotonic()+120
    if len(sys.argv)!=5:raise ValueError('exact source/implementation/tools/output-parent paths required')
    if not(sys.flags.isolated==1 and sys.dont_write_bytecode and sys.flags.optimize==0 and __debug__):
        raise ValueError('source-bound entry requires isolated Python with assertions and no bytecode')
    here=Path(__file__).absolute().parent
    profile=read(here/'profile.json',PROFILE_SHA,4*1024**2,deadline)
    source=read(here/'controller.py',CONTROLLER_SHA,128*1024,deadline)
    module=types.ModuleType('bound_portable_controller');module.__file__=str(here/'controller.py')
    sys.modules[module.__name__]=module
    exec(compile(source,module.__file__,'exec',dont_inherit=True,optimize=0),module.__dict__)
    declaration=module.strict(profile)
    library=declaration['implementation_relative']+'/controller-integration/controller.py'
    if declaration['source_files'].get(library)!={'bytes':len(source),'sha256':CONTROLLER_SHA}:
        raise ValueError('executed controller differs from the source map tested by this profile')
    result=module.run(profile,*sys.argv[1:],tool_binding=TOOL_BINDING,bootstrap_deadline=deadline)
    print(json.dumps(result,sort_keys=True))


if __name__=='__main__':main()
