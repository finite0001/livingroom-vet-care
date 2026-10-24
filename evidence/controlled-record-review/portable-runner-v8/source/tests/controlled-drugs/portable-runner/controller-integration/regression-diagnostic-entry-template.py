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

PROFILE_SHA = '@PROFILE_SHA@'
CONTROLLER_SHA = '@CONTROLLER_SHA@'
TOOL_BINDING = json.loads('@TOOL_BINDING_JSON@')


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


def run_diagnostic(module, profile, source, implementation, tools, output, *, tool_binding, bootstrap_deadline):
    """ALL fixed regression jobs; never guarded/full-controller acceptance."""
    controller=module.Controller(profile,source,implementation,tools,output)
    controller.binding=dict(tool_binding)
    try:
        controller.bootstrap(bootstrap_deadline)
        definitions=controller.p['regression_jobs']
        jobs={row['job_id']:row['expected_ids']for row in definitions}
        module.require(len(definitions)==len(jobs)==22,'fixed complete22-job regression diagnostic required')
        module.require(len(controller.inventory)==67 and sum(map(len,controller.inventory.values()))==927,
                       'all guarded reservations must remain in shared pool')
        module.require(sum(map(len,jobs.values()))==467,'fixed complete467 regression IDs required')
        def available():
            info=os.statvfs(controller.output)
            return info.f_bavail*info.f_frsize
        accountant=controller.modules['regression_core'].RegressionAccounting(jobs,
            guarded_jobs=controller.inventory,source_copy_bytes=controller.copy_bytes,
            historical_peak_bytes=68563791,read_available=available)
        owner=controller.modules['regression_parent'].RegressionJobs(accountant,
            core_module=controller.modules['regression_core'],transport_module=controller.modules['transport'],
            results_module=controller.modules['results'])
        def prepare(definition,ticket,check):
            controller.active_deadline=controller.last_deadline=ticket.deadline
            if controller.clean is None:controller.initialize_copy(check,ticket.deadline)
            return controller.prepare_regression(definition,ticket,check)
        for definition in definitions:
            summary=owner.run(definition['job_id'],
                prepare=lambda ticket,check,d=definition:prepare(d,ticket,check),readmit=controller.readmit)
            controller.regressions.append(module.asdict(summary))
        def finalize():
            controller.recheck_all(controller.last_deadline)
            actual=[identifier for row in controller.regressions for identifier in row['expected_ids']]
            expected=[identifier for group in jobs.values()for identifier in group]
            module.require(actual==expected and len(actual)==len(set(actual))==467,
                           'exact whole regression diagnostic union required')
            module.require(not controller.guarded,'diagnostic must never credit guarded execution')
            controller.persist('regression-index.json',{'jobs':controller.regressions},controller.last_deadline)
            controller.persist('regression-summary.json',{
                'kind':'whole-regression-stage-diagnostic-v1','passed':True,
                'profile_sha256':module.sha(profile),'jobs':22,'ids':467,
                'guarded_targets_executed':0,'full_controller_acceptance':False,
                'database_acceptance':False,'auth_acceptance':False,'clinical_activation':False,
                'descendant_cleanup_verified':False},controller.last_deadline)
            controller.recheck_all(controller.last_deadline)
        accountant.finish(finalize=finalize)
        # The ticket is closed; retain its original cutoff, never checkpoint it.
        controller.check(controller.last_deadline)
        return {'output':str(controller.output),'diagnostic':dict(controller.aux['regression-summary.json']),
                'full_controller_acceptance':False,'controller_returncode_required':0}
    except BaseException as error:
        controller.failed=True
        if controller.output is not None and 'results'in controller.modules and controller.last_deadline is not None:
            def failed_check():
                module.require(time.monotonic()<controller.last_deadline,'original diagnostic failure cutoff exhausted')
            try:
                controller.modules['results'].write_terminal(controller.output/'failure.json',{
                    'kind':'whole-regression-diagnostic-failure-v1','passed':False,'error_type':type(error).__name__,
                    'regression_jobs':len(controller.regressions),'guarded_targets_executed':0,
                    'full_controller_acceptance':False},failed_check)
            except BaseException as diagnostic:error.add_note('failure evidence unavailable:'+type(diagnostic).__name__)
        raise


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
    result=run_diagnostic(module,profile,*sys.argv[1:],tool_binding=TOOL_BINDING,bootstrap_deadline=deadline)
    print(json.dumps(result,sort_keys=True))


if __name__=='__main__':main()
