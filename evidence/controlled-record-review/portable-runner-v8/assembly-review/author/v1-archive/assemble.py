"""Prepare the exact frozen V8 publication; never execute its runner or targets.

Usage: python3 -I -B assemble.py /absolute/existing/private/output-parent
The single path is placement only. Source/profile/recipe authority is fixed below.
"""
import hashlib
import json
import os
from pathlib import Path
import stat
import sys
import time
import types
import uuid

PROFILE_SHA = 'bc7c134b9521697664bc5b18c7784b1d967d531289712672f3b2a1d49124ecb1'
CONTROLLER_SHA = 'a422c978e9aeeed5c490035f2158623c763cdad2a13b4069ee4aa875034d2278'
RECIPE_SHA = 'b778be5e1c2d0d596e36a421749d26916989d9e62d709b9e6b4d56526a41b289'
ENTRY_SHA = '3b887090f1fefa8b6904df4d3915438175897be86e035bd72a5a665cf3e5f283'
DIAGNOSTIC_SHA = '74c0894c181bee6e9182f7762f23e09244dbf48194c4421a62bc456703b79a89'
TOOL_ROOT = '/private/tmp/lrvt-fdjazqmt/local-portable-tools'
TOOL_PROFILE_SHA = 'bd605f6cfbe584f39c24bb647af2fe827798ec0a3c14bc582fe0be955bc14ce3'
TOOL_RECEIPT_SHA = '2cab8240d69fed6b1f80bd2698a1111f99dec88f46ebaaced4cada1b5c288c09'


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

def load_verified(name, path, raw):
    if name in sys.modules:
        raise ValueError('preparation module identity already exists')
    module = types.ModuleType(name); module.__file__ = str(path)
    sys.modules[name] = module
    exec(compile(raw, str(path), 'exec', dont_inherit=True, optimize=0), module.__dict__)
    return module


def write_receipt(root, raw, check, controller):
    """Exclusive private evidence outside publication, with physical readback."""
    name = 'preparation-receipt.json'
    fd = None; primary = None; identity = None
    try:
        check(); root.verify()
        fd = os.open(name, os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW, 0o600, dir_fd=root.fd)
        offset = 0
        while offset < len(raw):
            check(); count = os.write(fd, raw[offset:offset+65536])
            controller.require(type(count) is int and 0 < count <= min(65536,len(raw)-offset),
                               'preparation receipt write made invalid progress')
            offset += count
        os.fsync(fd); check(); info = os.fstat(fd)
        identity = (info.st_dev,info.st_ino,info.st_mode,info.st_uid,info.st_nlink,info.st_size,info.st_mtime_ns,info.st_ctime_ns)
        root.verify()
    except BaseException as error:
        primary = error; raise
    finally:
        if fd is not None:
            try: os.close(fd)
            except BaseException as error:
                if primary is not None: primary.add_note('preparation receipt close also failed: '+type(error).__name__)
                else: raise
    saved, observed = controller.physical(root.path/name,check=check,
        expected={'bytes':len(raw),'sha256':controller.sha(raw)},maximum=128*1024)
    controller.require(saved == raw and observed == identity, 'preparation receipt physical readback differs')
    root.verify(); check()
    return str(root.path/name)


def existing_tool_placements(copier, controller, deadline, check):
    """Placement availability only: runtime admission remains the entry's job."""
    path = Path(TOOL_ROOT)
    try:
        os.lstat(path)
    except FileNotFoundError:
        check(); return None
    root = None; primary = None
    try:
        root = copier.PhysicalRoot(str(path),check)
        info = os.fstat(root.fd)
        controller.require(info.st_uid == os.getuid() and stat.S_IMODE(info.st_mode) == 0o700,
                           'existing bound tool root must be owned and private')
        read(path/'profile.json',TOOL_PROFILE_SHA,4*1024**2,deadline)
        read(path/'receipt.json',TOOL_RECEIPT_SHA,4*1024**2,deadline)
        root.verify(); check()
        return str(path)
    except BaseException as error:
        primary = error; raise
    finally:
        if root is not None:
            try: root.close()
            except BaseException as error:
                if primary is not None: primary.add_note('bound tool placement close also failed: '+type(error).__name__)
                else: raise
        if primary is None: check()


def main():
    deadline = time.monotonic()+600
    def check():
        if time.monotonic() >= deadline:
            raise TimeoutError('original preparation cutoff exhausted')
    if len(sys.argv) != 2:
        raise ValueError('exactly one existing output-parent placement path required')
    if not(sys.flags.isolated == 1 and sys.dont_write_bytecode and sys.flags.optimize == 0 and __debug__):
        raise ValueError('preparation requires isolated Python with assertions and no bytecode')
    here = Path(__file__).absolute().parent
    bindings = here/'bindings'; tracked_source = here/'source'
    # Pin all three assembly authority inputs BEFORE any of them is executed.
    profile_raw = read(bindings/'profile.json',PROFILE_SHA,4*1024**2,deadline)
    controller_raw = read(bindings/'controller.py',CONTROLLER_SHA,128*1024,deadline)
    recipe_raw = read(bindings/'checkout-assembly-recipe.json',RECIPE_SHA,4*1024**2,deadline)
    entry_raw = read(bindings/'entry.py',ENTRY_SHA,128*1024,deadline)
    diagnostic_raw = read(bindings/'regression-diagnostic-entry.py',DIAGNOSTIC_SHA,128*1024,deadline)
    controller = load_verified('bound_v8_preparation_controller',bindings/'controller.py',controller_raw)
    profile = controller.strict(profile_raw); recipe = controller.strict(recipe_raw)
    controller.require(type(profile) is dict and set(profile) == controller.PROFILE_KEYS
        and profile['kind'] == 'portable-controller-profile-v1','fixed profile declaration required')
    expected = profile['source_files']
    controller.require(len(expected) == 908 and sum(row['bytes'] for row in expected.values()) == 163795442,
                       'fixed V8 complete publication size differs')
    library = profile['implementation_relative']+'/controller-integration/controller.py'
    controller.require(expected.get(library) == {'bytes':len(controller_raw),'sha256':CONTROLLER_SHA},
                       'bound controller differs from complete source authority')
    controller.require(type(recipe) is dict and set(recipe) == set(expected)
        and all(type(row) is dict and set(row) == {'source','bytes','sha256'} and row['source'] == name
            and {key:row[key] for key in ('bytes','sha256')} == expected[name] for name,row in recipe.items()),
        'exact source-identity checkout recipe required')
    copy_relative = controller.relative(profile['roles']['source_copy'])
    copy_raw, _ = controller.physical(tracked_source/copy_relative,check=check,expected=expected[copy_relative])
    copier = load_verified('bound_v8_preparation_source_copy',tracked_source/copy_relative,copy_raw)
    # The original reviewed copier admits complete expected members/caps.
    manifest = copier.admit_manifest(expected,check)
    parent_path = controller.absolute(sys.argv[1])
    roots = []; primary = None; outer_path = None; result = None
    try:
        roots.append(copier.PhysicalRoot(str(tracked_source),check))
        roots.append(copier.PhysicalRoot(str(parent_path),check))
        copier._assert_outside_source(roots[0],roots[1])
        parent_info = os.fstat(roots[1].fd)
        controller.require(parent_info.st_uid == os.getuid() and stat.S_IMODE(parent_info.st_mode) == 0o700,
                           'output parent must be physically owned and private')
        # No creation occurs before complete placement admission above.
        check(); roots[0].verify(); roots[1].verify()
        name = 'prepared-v8-'+uuid.uuid4().hex
        os.mkdir(name,0o700,dir_fd=roots[1].fd)
        outer_path = parent_path/name
        roots.append(copier.PhysicalRoot(str(outer_path),check))
        assembled = controller.assemble_publication(recipe,manifest,tracked_source,outer_path,
            deadline=deadline,source_copy_module=copier)
        publication = controller.absolute(assembled['root'])
        controller.require(publication.parent == outer_path and assembled['files'] == 908
            and assembled['bytes'] == 163795442 and assembled['controller_execution'] is False,
            'exact preparation result differs')
        # Bindings remain outside the908-member runtime publication; entry keeps
        # using its literal profile/controller/tool hashes, never observed reseals.
        tools = existing_tool_placements(copier,controller,deadline,check)
        placements = None
        if tools is not None:
            placements = [str(publication),str(publication/profile['implementation_relative']),tools,str(outer_path)]
        result = {'kind':'tracked-v8-publication-prepared-v1','preparation_only':True,
            'actual_rerun_pending':True,'full_controller_acceptance':False,'diagnostic_acceptance':False,
            'tool_setup_executed':False,'tools_runtime_admission_pending':True,
            'database_acceptance':False,'auth_acceptance':False,'clinical_activation':False,
            'profile_sha256':PROFILE_SHA,'controller_sha256':CONTROLLER_SHA,'checkout_recipe_sha256':RECIPE_SHA,
            'source':str(tracked_source),'assembly':assembled,'output_parent':str(outer_path),
            'local_tool_binding':{'root':TOOL_ROOT,'profile_sha256':TOOL_PROFILE_SHA,'receipt_sha256':TOOL_RECEIPT_SHA,
                'portable_distribution_or_ci_acceptance':False},
            'runtime_placements':placements,
            'full_argv':None if placements is None else [tools+'/environment/bin/python3','-I','-B',str(bindings/'entry.py'),*placements],
            'diagnostic_argv':None if placements is None else [tools+'/environment/bin/python3','-I','-B',str(bindings/'regression-diagnostic-entry.py'),*placements]}
        # Re-admit immutable binding bytes before recording preparation success.
        read(bindings/'profile.json',PROFILE_SHA,4*1024**2,deadline)
        read(bindings/'controller.py',CONTROLLER_SHA,128*1024,deadline)
        read(bindings/'checkout-assembly-recipe.json',RECIPE_SHA,4*1024**2,deadline)
        controller.require(read(bindings/'entry.py',ENTRY_SHA,128*1024,deadline) == entry_raw
            and read(bindings/'regression-diagnostic-entry.py',DIAGNOSTIC_SHA,128*1024,deadline) == diagnostic_raw,
            'bound runner entries changed during preparation')
        for root in roots: root.verify()
        receipt_raw = controller.canonical(result)+b'\n'
        receipt = write_receipt(roots[2],receipt_raw,check,controller)
        result = {'receipt':receipt,'preparation':result}
    except BaseException as error:
        primary = error
        if outer_path is not None: error.add_note('retained failed preparation: '+str(outer_path))
        raise
    finally:
        closing = None
        for root in reversed(roots):
            try: root.close()
            except BaseException as error:
                if primary is not None: primary.add_note('preparation root close also failed: '+type(error).__name__)
                elif closing is None: closing = error
        if closing is not None: raise closing
        if primary is None: check()
    check(); print(json.dumps(result,sort_keys=True))


if __name__ == '__main__':
    main()
