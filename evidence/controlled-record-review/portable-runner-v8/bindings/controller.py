"""Fixed two-stage local controller library; invoked by the source-pinned entry.

The entry admits this library and one immutable prospective profile before calling
run. Placement paths convey no source/test/tool authority. No subset/discovery CLI.
"""
from dataclasses import asdict, dataclass
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import stat
import sys
import time
import uuid

MIB = 1024**2
GIB = 1024**3
NAMES = {slot: slot + ('.log' if slot in ('stdout', 'stderr') else '.json')
         for slot in ('job', 'stdout', 'stderr', 'terminal', 'guard')}
AUXILIARY = ('copy.json', 'guarded-plan.json', 'guarded-index.json', 'guarded-summary.json',
             'regression-index.json', 'regression-summary.json', 'result.json', 'failure.json')
PROFILE_KEYS = {'kind', 'source_files', 'roles', 'base_plan', 'guarded_jobs', 'regression_jobs',
                'implementation_relative', 'implementation_files', 'historical_members', 'resource'}


def require(value, message):
    if not value:
        raise ValueError(message)


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False, allow_nan=False).encode('utf-8')


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def absolute(value):
    require(type(value) is str and value.startswith('/') and not value.startswith('//')
            and '\x00' not in value and value == str(Path(value)) and '..' not in Path(value).parts,
            'normalized physical absolute path required')
    return Path(value)


def relative(value):
    require(type(value) is str and value and '\\' not in value and '\x00' not in value
            and all(part not in ('', '.', '..') for part in value.split('/')), 'exact relative member required')
    return value


def physical(path, *, check, expected=None, maximum=128*MIB, empty=False, retain=True):
    """Held nofollow ancestry, bounded raw bytes, owned single-link regular leaf."""
    path = absolute(str(path)); fds = []; edges = []; primary = None
    def identity(st):
        return st.st_dev, st.st_ino, st.st_mode, st.st_uid, st.st_nlink, st.st_size, st.st_mtime_ns, st.st_ctime_ns
    try:
        check(); fds.append(os.open('/', os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW))
        for part in path.parts[1:-1]:
            check(); parent = fds[-1]
            fd = os.open(part, os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW, dir_fd=parent)
            fds.append(fd); edges.append((parent, part, fd, identity(os.fstat(fd))[:4]))
        fd = os.open(path.name, os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK, dir_fd=fds[-1]); fds.append(fd)
        before = os.fstat(fd)
        require(stat.S_ISREG(before.st_mode) and before.st_uid == os.getuid() and before.st_nlink == 1
                and not before.st_mode & 0o022 and (0 if empty else 1) <= before.st_size <= maximum,
                'bounded owned physical source/evidence required')
        if expected is not None:
            require(type(expected) is dict and set(expected) == {'bytes', 'sha256'}
                    and type(expected['bytes']) is int and before.st_size == expected['bytes'], 'source byte bound differs')
        chunks = []; count = 0; digest = hashlib.sha256()
        while True:
            check(); block = os.read(fd, min(65536, before.st_size + 1 - count)); check()
            if not block: break
            count += len(block); require(count <= before.st_size, 'physical member grew')
            digest.update(block)
            if retain: chunks.append(block)
        require(count == before.st_size and identity(before) == identity(os.fstat(fd))
                == identity(os.stat(path.name, dir_fd=fds[-2], follow_symlinks=False)), 'physical member changed')
        if expected is not None: require(digest.hexdigest() == expected['sha256'], 'source hash differs')
        for parent, name, child, original in edges:
            check(); require(identity(os.fstat(child))[:4] == original
                == identity(os.stat(name, dir_fd=parent, follow_symlinks=False))[:4], 'physical ancestor changed')
        check(); return b''.join(chunks), identity(before)
    except BaseException as error:
        primary = error; raise
    finally:
        closing = None
        for fd in reversed(fds):
            try: os.close(fd)
            except BaseException as error:
                if primary is not None: primary.add_note('controller physical close also failed: '+type(error).__name__)
                elif closing is None: closing = error
        if closing is not None: raise closing


def strict(raw):
    def pairs(items):
        result = {}
        for name, value in items:
            require(name not in result, 'duplicate profile key'); result[name] = value
        return result
    def invalid(_): raise ValueError('nonfinite profile value')
    def number(value):
        result=float(value);require(math.isfinite(result),'nonfinite profile number');return result
    return json.loads(raw.decode('utf-8', 'strict'), object_pairs_hook=pairs, parse_constant=invalid,parse_float=number)


@dataclass(frozen=True)
class TreeSnapshot:
    root: tuple
    files: tuple
    directories: tuple


def admit_tree(root, expected, check, baseline=None):
    """Exact complete publication/copy keyset, never a private overlay."""
    root = absolute(str(root)); seen = set(); identities = {}; directories = {}
    root_st = os.stat(root, follow_symlinks=False)
    require(stat.S_ISDIR(root_st.st_mode) and root_st.st_uid == os.getuid() and stat.S_IMODE(root_st.st_mode) == 0o700,
            'owned private publication root required')
    root_identity = root_st.st_dev,root_st.st_ino,root_st.st_mode,root_st.st_uid
    expected_directories={str(parent)for name in expected for parent in Path(relative(name)).parents if str(parent)!='.'}
    baseline_files = dict(baseline.files) if baseline is not None else None
    if baseline is not None:require(root_identity==baseline.root,'admitted publication root changed')
    # Each member read independently rechecks the complete physical ancestry.
    for folder, dirs, files in os.walk(root, followlinks=False):
        check()
        for name in dirs:
            path=Path(folder,name);key=str(path.relative_to(root));st=os.stat(path,follow_symlinks=False)
            require(key in expected_directories and stat.S_ISDIR(st.st_mode) and st.st_uid==os.getuid()
                    and stat.S_IMODE(st.st_mode)==0o700,'unexpected or unsafe publication directory')
            directories[key]=(st.st_dev,st.st_ino,st.st_mode,st.st_uid)
        for name in files:
            key = str(Path(folder, name).relative_to(root)); require(key in expected, 'unexpected publication member')
            _, stamp = physical(Path(folder, name), check=check, expected=expected[key])
            if baseline_files is not None: require(stamp == baseline_files[key], 'admitted source identity changed')
            seen.add(key); identities[key] = stamp
    require(seen == set(expected) and set(directories)==expected_directories, 'publication member missing')
    if baseline is not None:require(tuple(sorted(directories.items()))==baseline.directories,'admitted source directory changed')
    after = os.stat(root, follow_symlinks=False)
    require((root_st.st_dev, root_st.st_ino, root_st.st_mode, root_st.st_uid)
            == (after.st_dev, after.st_ino, after.st_mode, after.st_uid), 'publication root replaced')
    check(); return TreeSnapshot(root_identity,tuple(sorted(identities.items())),tuple(sorted(directories.items())))


def assemble_publication(recipe,expected,source_parent,output_parent,*,deadline,source_copy_module):
    """Prepare ONE canonical root from a complete independently reviewed recipe.

    This precedes controller execution. It does not overlay a public subset or
    derive/reseal expected hashes from copied files. Source paths may use the old
    private prototype location; destination paths retain the original copier's
    exact private/cache/config prohibitions and byte/member caps.
    """
    now=time.monotonic()
    require(type(deadline)in(int,float)and math.isfinite(deadline)and now<deadline<=now+600,'original finite assembly deadline required')
    def check():require(time.monotonic()<deadline,'original publication assembly cutoff exhausted')
    check();manifest=source_copy_module.admit_manifest(expected,check)
    require(type(recipe)is dict and set(recipe)==set(manifest),'complete prospective recipe required')
    source_parent=absolute(str(source_parent));output_parent=absolute(str(output_parent))
    for destination,row in recipe.items():
        require(type(row)is dict and set(row)=={'source','bytes','sha256'}and
                {key:row[key]for key in ('bytes','sha256')}==manifest[destination],'recipe authority differs from source map')
        relative(row['source'])
    roots=[];primary=None;retained=None
    try:
        roots.append(source_copy_module.PhysicalRoot(source_parent,check))
        roots.append(source_copy_module.PhysicalRoot(output_parent,check))
        source_copy_module._assert_outside_source(roots[0],roots[1])
        info=os.fstat(roots[1].fd)
        require(info.st_uid==os.getuid()and stat.S_IMODE(info.st_mode)==0o700,'private assembly parent required')
        capacity=os.statvfs(output_parent)
        require(capacity.f_bavail*capacity.f_frsize>=4*GIB+sum(row['bytes']for row in manifest.values())+68563791,
                'assembly physical free-space floor');check()
        baseline={}
        for destination,row in recipe.items():
            _,baseline[destination]=physical(source_parent/row['source'],check=check,expected=manifest[destination],empty=True,retain=False)
        name='publication-'+uuid.uuid4().hex;os.mkdir(name,0o700,dir_fd=roots[1].fd)
        retained=output_parent/name;roots.append(source_copy_module.PhysicalRoot(retained,check))
        for destination,row in recipe.items():
            raw,identity=physical(source_parent/row['source'],check=check,expected=manifest[destination],empty=True)
            require(identity==baseline[destination],'source changed before publication write')
            handles=[];writing=None
            try:
                handles.append(os.dup(roots[2].fd));parts=Path(destination).parts
                for part in parts[:-1]:
                    check()
                    try:os.mkdir(part,0o700,dir_fd=handles[-1])
                    except FileExistsError:pass
                    handles.append(os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=handles[-1]))
                fd=os.open(parts[-1],os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=handles[-1]);handles.append(fd)
                offset=0
                while offset<len(raw):
                    check();count=os.write(fd,raw[offset:offset+65536])
                    require(type(count)is int and 0<count<=min(65536,len(raw)-offset),'invalid publication write progress');offset+=count
                os.fsync(fd);check();roots[2].verify()
            except BaseException as error:writing=error;raise
            finally:
                closing=None
                for fd in reversed(handles):
                    try:os.close(fd)
                    except BaseException as error:
                        if writing is not None:writing.add_note('publication write close also failed: '+type(error).__name__)
                        elif closing is None:closing=error
                if closing is not None:raise closing
        admit_tree(retained,manifest,check)
        for destination,row in recipe.items():
            _,identity=physical(source_parent/row['source'],check=check,expected=manifest[destination],empty=True,retain=False)
            require(identity==baseline[destination],'original source changed during publication assembly')
        for root in roots:root.verify()
        check()
        return {'kind':'prospective-canonical-publication-v1','root':str(retained),'files':len(manifest),
                'bytes':sum(row['bytes']for row in manifest.values()),'expected_manifest_sha256':sha(canonical(manifest)),
                'authority':'independently_reviewed_recipe_not_observed_reseal','controller_execution':False}
    except BaseException as error:
        primary=error
        if retained is not None:error.add_note('retained failed publication: '+str(retained))
        raise
    finally:
        closing=None
        for root in reversed(roots):
            try:root.close()
            except BaseException as error:
                if primary is not None:primary.add_note('publication root close also failed: '+type(error).__name__)
                elif closing is None:closing=error
        if closing is not None:raise closing
        if primary is None:check()


class Controller:
    def __init__(self, profile_raw, source_root, implementation_root, tools_root, output_parent):
        self.profile_raw = profile_raw
        require(type(profile_raw) is bytes and 0 < len(profile_raw) <= 4*MIB, 'bounded admitted profile required')
        self.p = strict(profile_raw)
        require(type(self.p) is dict and set(self.p) == PROFILE_KEYS and self.p['kind'] == 'portable-controller-profile-v1', 'exact controller profile required')
        self.source, self.implementation = absolute(source_root), absolute(implementation_root)
        self.tools, self.parent = absolute(tools_root), absolute(output_parent)
        self.modules = {}; self.failed = False; self.output = None; self.clean = None
        self.source_baseline = self.clean_baseline = None
        self.guarded = []; self.regressions = []; self.last_deadline = None; self.aux = {}
        self.scratch = []; self.binding = None
        self.job_directories = {}
        self.output_scratch = {}
        self.tool_identity = None
        require(type(self.p['source_files'])is dict and 0<len(self.p['source_files'])<=4096,'finite complete source map required')
        for name,meta in self.p['source_files'].items():
            relative(name)
            require(type(meta)is dict and set(meta)=={'bytes','sha256'} and type(meta['bytes'])is int
                    and 0<=meta['bytes']<=128*MIB and type(meta['sha256'])is str and len(meta['sha256'])==64
                    and all(ch in '0123456789abcdef'for ch in meta['sha256']),'exact source metadata required')
        self.copy_bytes = sum(meta['bytes'] for meta in self.p['source_files'].values())
        require(self.copy_bytes <= 256*MIB, 'source copy cap exceeded')
        require(self.p['resource'] == {'historical_peak_bytes': 68563791, 'scratch_bytes': GIB,
                'auxiliary_files': list(AUXILIARY), 'maximum_combined_ids': 4096, 'maximum_suites': 96}, 'fixed resources differ')

    def check(self, deadline):
        require(not self.failed, 'controller previously failed')
        require(time.monotonic() < deadline, 'original controller/stage deadline exhausted')
        if self.output is not None:
            if hasattr(self,'output_identity'):
                st=os.stat(self.output,follow_symlinks=False)
                require((st.st_dev,st.st_ino)==self.output_identity and stat.S_ISDIR(st.st_mode)
                        and st.st_uid==os.getuid() and stat.S_IMODE(st.st_mode)==0o700,'owned run root changed')
            capacity=os.statvfs(self.output)
            available = capacity.f_bavail * capacity.f_frsize
            require(available >= 4*GIB + self.copy_bytes + 68563791, 'physical free space below unchanged floor')
        require(not self.failed,'controller failed during filesystem/capacity check')
        require(time.monotonic()<deadline,'original controller/stage deadline exhausted during check')

    def load(self, role, check, *, clean=False):
        relative_name = self.p['roles'][role]; relative(relative_name)
        root = self.clean if clean else self.source
        raw, _ = physical(root/relative_name, check=check, expected=self.p['source_files'][relative_name])
        name = 'lrv_controller_'+role
        require(name not in sys.modules, 'parent implementation module collision')
        spec = importlib.util.spec_from_file_location(name, root/relative_name)
        module = importlib.util.module_from_spec(spec); sys.modules[name] = module
        exec(compile(raw, str(root/relative_name), 'exec'), module.__dict__)
        check(); self.modules[role] = module; return module

    def bootstrap(self,deadline):
        now=time.monotonic()
        require(type(deadline)in(int,float)and math.isfinite(deadline)and now<deadline<=now+120,'original finite bootstrap deadline required')
        check = lambda: self.check(deadline)
        require(not self.parent.is_relative_to(self.source) and not self.parent.is_relative_to(self.tools), 'evidence parent is inside inputs')
        require(self.implementation==self.source/self.p['implementation_relative'],'fixed implementation placement differs')
        for role in ('planner','partition','source_copy','accounting','results','output','pair_reader','guard_report',
                     'evidence','guarded_job','guard','historical_tree','tool_admission','regression_core',
                     'regression_parent','regression_policy','transport','worker_contract'):
            self.load(role, check)
        handles=[];primary=None
        try:
            for path in (self.source,self.tools,self.parent):handles.append(self.modules['source_copy'].PhysicalRoot(path,check))
            self.modules['source_copy']._assert_outside_source(handles[0],handles[2])
            self.modules['source_copy']._assert_outside_source(handles[1],handles[2])
            name='portable-run-'+uuid.uuid4().hex
            os.mkdir(name,0o700,dir_fd=handles[2].fd)
            self.output=self.parent/name
            st=os.stat(name,dir_fd=handles[2].fd,follow_symlinks=False);self.output_identity=st.st_dev,st.st_ino
            for handle in handles:handle.verify()
        except BaseException as error:primary=error;raise
        finally:
            closing=None
            for handle in reversed(handles):
                try:handle.close()
                except BaseException as error:
                    if primary is not None:primary.add_note('bootstrap root close also failed: '+type(error).__name__)
                    elif closing is None:closing=error
            if closing is not None:raise closing
        raw,_=physical(self.source/self.p['roles']['policy_routing'],check=check,
                       expected=self.p['source_files'][self.p['roles']['policy_routing']])
        self.original_ids={value['original_id']for value in strict(raw)['tests']}
        require(len(self.original_ids)==867,'literal original routing scope differs')
        plan_raw, _ = physical(self.source/self.p['base_plan'], check=check, expected=self.p['source_files'][self.p['base_plan']])
        plan = self.modules['planner'].admit_plan(plan_raw)
        historical=self.modules['historical_tree'].load_manifest(deadline)
        historical_members={name:[historical['files'][key]for key in value['paths']]
                            for name,value in historical['profiles'].items()}
        require(self.p['historical_members']==historical_members,'literal historical profiles differ from fixed manifest')
        a2_files={row['path']:{'bytes':row['bytes'],'sha256':row['sha256']}for row in historical_members['a2_669']}
        self.modules['planner'].check_suite_sources(plan,{'current':self.p['source_files'],'a2_669':a2_files})
        base = self.modules['planner'].suite_jobs(plan, {'current':'current', 'a2_669':'a2'})
        expected = []
        for value in base:
            expected.append({'job_id': value['job_id'], 'profile': value['tree_profile'], 'suite': value['suite'], 'partition': None})
        hp = self.modules['partition']
        for ordinal in range(8):
            expected.append({'job_id':'historical-'+str(ordinal), 'profile':'stored638' if ordinal<5 else 'a2_669',
                'suite':{'kind':'historical_boundary','tree_tag':'current','relative':hp.SUITE,'classes':[hp.CLASS],
                         'expected_ids':list(hp.ALL_IDS),'id_map':dict(zip(hp.SHORT_IDS,hp.ALL_IDS))},
                'partition':{'inventory_sha256':hp.INVENTORY_SHA,'all_ids':list(hp.ALL_IDS),
                             'selected_id':hp.ALL_IDS[ordinal],'ordinal':ordinal,'partitions':8}})
        require(self.p['guarded_jobs'] == expected, 'final guarded plan differs from pinned59+8')
        self.inventory = {}
        for value in expected:
            job = {'kind':'portable-worker-job-v2','suite':value['suite'],'partition':value['partition'],'historical638':None}
            self.inventory[value['job_id']] = hp.execution_ids(job, check)
        require(len(self.inventory)==67 and sum(map(len,self.inventory.values()))==927, 'fixed guarded union differs')
        regression_ids = [i for job in self.p['regression_jobs'] for i in job['expected_ids']]
        ids = [i for group in self.inventory.values() for i in group]
        require(0<len(self.p['regression_jobs'])<=29 and len(ids)+len(regression_ids)<=4096
                and len(set(ids+regression_ids))==len(ids)+len(regression_ids), 'combined disjoint scope differs')
        check()

    def initialize_copy(self, check, deadline):
        self.source_baseline = admit_tree(self.source, self.p['source_files'], check)
        copy = self.modules['source_copy'].copy_sources(str(self.source), str(self.output), self.p['source_files'], check, basename='clean-source')
        self.clean = Path(copy['root'])
        self.clean_baseline = admit_tree(self.clean, self.p['source_files'], check)
        # Tool receipt does not supply new expected payload hashes: its admitted
        # checker rederives them from reviewed profile/archive transformations.
        profile_path, receipt_path = self.tools/'profile.json', self.tools/'receipt.json'
        require(self.binding is not None, 'entry must admit exact tool profile/receipt binding')
        require(self.binding['profile_path']==str(profile_path) and self.binding['receipt_path']==str(receipt_path), 'tool placement differs')
        self.admit_tools(deadline,check)
        self.persist('copy.json', copy, deadline)
        self.persist('guarded-plan.json', {'profile_sha256':sha(self.profile_raw),'jobs':self.p['guarded_jobs']}, deadline)

    def persist(self, name, value, deadline):
        require(name in AUXILIARY and name not in self.aux, 'fixed new auxiliary slot required')
        check = lambda:self.check(deadline); check()
        require((os.stat(self.output).st_dev,os.stat(self.output).st_ino)==self.output_identity, 'run output root changed')
        receipt = self.modules['results'].write_terminal(self.output/name, value, check)
        raw, stamp = physical(self.output/name, check=check, expected=receipt, maximum=4*MIB)
        require(raw==canonical(value)+b'\n' and stat.S_IMODE(stamp[2])==0o600, 'auxiliary persistence differs')
        self.aux[name] = {'bytes':len(raw),'sha256':sha(raw)}; check()

    def readmit(self, value, check):
        admit_tree(self.source, self.p['source_files'], check, self.source_baseline)
        admit_tree(self.clean, self.p['source_files'], check, self.clean_baseline)
        self.admit_tools(self.active_deadline,check)
        for path, profile, identity in self.historical:
            members = self.p['historical_members'][profile]
            self.modules['historical_tree'].verify_tree(path, members, self.active_deadline, identity=identity)
        self.scratch_check(check)

    def scratch_check(self, check):
        total = entries = 0
        for root in self.scratch:
            for folder, dirs, files in os.walk(root, followlinks=False):
                check(); entries += len(dirs)+len(files); require(entries<=100000, 'finite retained scratch entry cap')
                for name in files:
                    path=Path(folder,name)
                    # Only the declared root-level evidence slots belong to the
                    # separate shared pool. Boundary mutation evidence and all
                    # nested files count against retained scratch.
                    if path.parent==root and name in self.output_scratch.get(str(root),()):continue
                    st=os.stat(path,follow_symlinks=False)
                    if stat.S_ISREG(st.st_mode): total+=st.st_size
                    require(total<=GIB, 'cumulative retained scratch exceeds reviewed1GiB')

    def admit_tools(self,deadline,check):
        paths=self.modules['tool_admission'].admit_tools(self.binding,deadline=deadline,check=check)
        root=os.stat(self.tools,follow_symlinks=False)
        identity={'root':(root.st_dev,root.st_ino,root.st_mode,root.st_uid)}
        require(stat.S_ISDIR(root.st_mode)and root.st_uid==os.getuid()and stat.S_IMODE(root.st_mode)==0o700,'owned tool root required')
        for name,path in [('profile',self.binding['profile_path']),('receipt',self.binding['receipt_path'])]+[(name,paths[name])for name in ('python','node','typescript')]:
            _,stamp=physical(path,check=check,maximum=256*MIB,retain=False)
            identity[name]=stamp
        require(self.tool_identity is None or identity==self.tool_identity,'previously admitted tool/root identity changed')
        self.tool_identity=identity
        check();return paths

    def prepare_guarded(self, definition, ticket, check):
        self.active_deadline=ticket.deadline; self.last_deadline=ticket.deadline
        if self.clean is None:self.initialize_copy(check,ticket.deadline)
        root=self.output/ticket.job_id;root.mkdir(mode=0o700)
        self.job_directories[ticket.job_id]=str(root/'output')
        for name in ('output','home','tmp','history'):(root/name).mkdir(mode=0o700)
        self.scratch.extend(root/name for name in ('home','tmp','history'))
        self.scratch.append(root/'output');self.output_scratch[str(root/'output')]=tuple(NAMES.values())
        self.historical=[]
        need = definition['profile'] if definition['profile']!='current' else ('stored638' if definition['suite']['kind']=='stored_adapter' else None)
        trees=[{'tag':'current','root':str(self.clean),'files':self.p['source_files'],'profile':'current'}]
        if need:
            historical_path,receipt=self.modules['historical_tree'].materialize(self.clean,root/'history',need,deadline=ticket.deadline)
            self.historical.append((historical_path,need,tuple(receipt['root_identity'])))
            members=self.p['historical_members'][need]
            trees.append({'tag':'a2' if need=='a2_669' else 'stored','root':str(historical_path),
                          'files':{r['path']:{'bytes':r['bytes'],'sha256':r['sha256']}for r in members},'profile':need})
        admitted=self.admit_tools(ticket.deadline,check)
        tool_pins={}
        for name,version in (('python','3.14.7'),('node','v22.23.3'),('typescript','5.8.3')):
            path=admitted[name];raw,stamp=physical(path,check=check,maximum=256*MIB)
            tool_pins[name]={'path':path,'sha256':sha(raw),'bytes':len(raw),'dev':stamp[0],'ino':stamp[1],'version':version}
            if name=='typescript':tool_pins[name]['package_version']=version
        env={'HOME':str(root/'home'),'TMPDIR':str(root/'tmp'),'PATH':str(Path(admitted['node']).parent)+':/usr/bin:/bin','LC_ALL':'C','LANG':'C',
             'PYTHONDONTWRITEBYTECODE':'1','PYTHONNOUSERSITE':'1','PYTHONUTF8':'1','PYTHONOPTIMIZE':'0',
             'CONTROLLED_REVIEW_TYPESCRIPT':admitted['typescript'],**self.modules['guard'].platform_environment()}
        suite=definition['suite']; extra=None
        if not set(suite['expected_ids'])<=self.original_ids:
            extra={i:{'source':suite['relative'],'sha256':self.p['source_files'][suite['relative']]['sha256']}for i in suite['expected_ids']}
        route=None;history=None
        if suite['kind']=='stored_adapter':
            route={'declaration_path':str(self.clean/self.p['roles']['historical_route']),
                   'declaration_sha256':'cd50e932c3435c4ef48e8b7b4ed23fdd68fda3ddfbb08763ab74313825de33d5',
                   'worker_tree_tag':'current','worker_relative':self.p['roles']['historical_assertion'],'repository_tree_tag':'current'}
            history={'tree_root':str(historical_path),'repository_root':str(self.clean),'expected_receipt':self.modules['worker_contract'].HISTORY}
        guard={'contract_root':str((self.clean/self.p['roles']['policy_routing']).parent),'source_trees':trees,
               'tools':tool_pins,'clean_env':env,'worker_cwd':str(root/'tmp'),'suite_id':suite['relative'],
               'suite_tree_tag':suite['tree_tag'],'extra_test_inventory':extra,
               'historical_templates':{name:{r['path']:{'bytes':r['bytes'],'sha256':r['sha256']}for r in members}
                                       for name,members in self.p['historical_members'].items()},'historical_route':route}
        job={'kind':'portable-worker-job-v2','job_id':ticket.job_id,'deadline':ticket.deadline,'suite':suite,'guard':guard,
             'implementation':{'tree_tag':'current','files':self.p['implementation_files'],'tool_profile':dict(self.binding)},
             'output':{'directory':str(root/'output'),'terminal_name':'terminal.json','guard_name':'guard.json'},
             'historical638':history,'partition':definition['partition']}
        self.modules['worker_contract'].admit_job(job,time.monotonic());check()
        config=self.modules['guard'].admit_config(**guard);check()
        raw=canonical(job)+b'\n'
        context=self.modules['guard_report'].expected_context(job,sha(raw),config.routes,config.historical_route,check,partition_module=self.modules['partition'])
        return self.modules['guarded_job'].JobInput(raw,context,admitted['python'],str(self.clean/self.p['roles']['worker']),str(root/'tmp'),env,str(root/'output'))

    def run_guarded(self):
        a=self.modules['accounting'].RunAccounting(self.inventory,source_copy_bytes=self.copy_bytes,historical_peak_bytes=68563791,
            read_available=lambda:os.statvfs(self.output).f_bavail*os.statvfs(self.output).f_frsize)
        owner=self.modules['guarded_job'].GuardedJobs(a,output_module=self.modules['output'],pair_module=self.modules['pair_reader'],
            transport_module=self.modules['transport'],evidence_module=self.modules['evidence'],validate_pair=self.modules['guard_report'].validate_pair,
            validate_terminal=self.modules['results'].validate_terminal)
        for definition in self.p['guarded_jobs']:
            prepare=lambda ticket,check,d=definition:self.prepare_guarded(d,ticket,check)
            summary=owner.run(definition['job_id'],prepare=prepare,readmit=self.readmit)
            self.guarded.append(asdict(summary))
        self.historical=[]
        def finalize():
            self.check(self.last_deadline);self.recheck_all(self.last_deadline)
            require([row['job_id']for row in self.guarded]==list(self.inventory),'exact guarded execution union differs')
            self.persist('guarded-index.json',{'jobs':self.guarded},self.last_deadline)
            self.persist('guarded-summary.json',{'kind':'guarded-stage-result-v1','tests':927,'jobs':67,'passed':True},self.last_deadline)
        return a.finish(finalize=finalize)

    def source_record(self, role):
        name=self.p['roles'][role]
        return {'path':str(self.clean/name),**self.p['source_files'][name]}

    def prepare_regression(self, definition, ticket, check):
        self.active_deadline=self.last_deadline=ticket.deadline;self.historical=[]
        root=self.output/ticket.job_id;root.mkdir(mode=0o700)
        for name in ('output','home','tmp'):(root/name).mkdir(mode=0o700)
        self.job_directories[ticket.job_id]=str(root/'output')
        self.scratch.extend(root/name for name in ('home','tmp'))
        self.scratch.append(root/'output');self.output_scratch[str(root/'output')]=('job.json','stdout.log','stderr.log','result.json')
        admitted=self.admit_tools(ticket.deadline,check)
        env={'HOME':str(root/'home'),'TMPDIR':str(root/'tmp'),'PATH':str(Path(admitted['node']).parent)+':/usr/bin:/bin','LC_ALL':'C','LANG':'C',
             'PYTHONDONTWRITEBYTECODE':'1','PYTHONNOUSERSITE':'1','PYTHONUTF8':'1','PYTHONOPTIMIZE':'0',
             'CONTROLLED_REVIEW_TYPESCRIPT':admitted['typescript'],**self.modules['guard'].platform_environment()}
        env['CONTROLLED_REGRESSION_EVIDENCE']=str(root/'tmp')
        source={'path':str(self.clean/definition['relative']),**self.p['source_files'][definition['relative']]}
        policy=None
        if definition['child_profile'] is not None:
            routes=self.modules['regression_policy'].declaration(definition['child_profile'],definition['logical_id_path'],source)
            policy={'source':self.source_record('regression_policy'),'profile':definition['child_profile'],
                    'scratch_root':str(root/'tmp'),'repository_root':str(self.clean),'routes':routes}
        job={'kind':'portable-regression-job-v1','job_id':ticket.job_id,'deadline':ticket.deadline,
             'suite':{'source':source,'logical_id_path':definition['logical_id_path'],'classes':definition['classes'],
                      'expected_ids':definition['expected_ids'],'classification':definition['classification'],'child_policy':policy},
             'implementation':{name:self.source_record(role)for name,role in
                               (('core','regression_core'),('results','results'),('worker','regression_worker'))},
             'output':{'directory':str(root/'output'),'terminal_name':'result.json'},
             'import_roots':[str(self.clean/name)for name in definition['import_roots']]}
        return self.modules['regression_parent'].JobInput(canonical(job)+b'\n',admitted['python'],
            str(self.clean/self.p['roles']['regression_worker']),str(root/'tmp'),env,str(root/'output'))

    def recheck_all(self, deadline):
        check=lambda:self.check(deadline)
        self.active_deadline=deadline;self.historical=[]
        self.readmit(None,check)
        for guarded,rows,names in ((True,self.guarded,NAMES),(False,self.regressions,
                {'job':'job.json','stdout':'stdout.log','stderr':'stderr.log','terminal':'result.json'})):
            for summary in rows:
                directory=Path(self.job_directories[summary['job_id']]);raws={}
                for index,(slot,name)in enumerate(names.items()):
                    raw,identity=physical(directory/name,check=check,maximum=4*MIB,empty=slot in ('stdout','stderr'),
                        retain=slot not in ('stdout','stderr'),expected={'bytes':summary['slot_bytes'][index],
                        'sha256':summary['slot_sha256'][index]})
                    require(identity==summary['identities'][index],'previous credited output identity changed')
                    if slot not in ('stdout','stderr'):raws[slot]=raw
                job=strict(raws['job'])
                if guarded:
                    config=self.modules['guard'].admit_config(**job['guard']);check()
                    context=self.modules['guard_report'].expected_context(job,sha(raws['job']),config.routes,config.historical_route,
                        check,partition_module=self.modules['partition'])
                    validated=self.modules['guard_report'].validate_pair(raws['terminal'],raws['guard'],context,
                        process_returncode=0,validate_terminal=self.modules['results'].validate_terminal,check=check)
                    require(sha(canonical(validated))==summary['pair_sha256'],'previous guarded pair changed')
                else:
                    routes=job['suite']['child_policy']['routes']if job['suite']['child_policy']is not None else{}
                    validated=self.modules['regression_core'].validate_terminal(raws['terminal'],summary['expected_ids'],
                        process_returncode=0,job_id=summary['job_id'],job_sha256=sha(raws['job']),
                        suite_sha256=job['suite']['source']['sha256'],permitted_routes=routes,
                        validate_result=self.modules['results'].validate_terminal)
                    require(sha(canonical(validated))==summary['terminal_sha256'],'previous regression terminal changed')
                # Re-observe saved identity/hash after pure pair/result validation.
                for index,(slot,name)in enumerate(names.items()):
                    _,identity=physical(directory/name,check=check,maximum=4*MIB,empty=slot in ('stdout','stderr'),retain=False,
                        expected={'bytes':summary['slot_bytes'][index],'sha256':summary['slot_sha256'][index]})
                    require(identity==summary['identities'][index],'credited output changed during final validation')
        for name,expected in self.aux.items():physical(self.output/name,check=check,expected=expected,maximum=4*MIB,retain=False)
        check()

    def run_regressions(self, guarded_receipt):
        jobs={job['job_id']:job['expected_ids']for job in self.p['regression_jobs']}
        require(len(jobs)==len(self.p['regression_jobs'])and not set(jobs).intersection(self.inventory),'distinct exact stage job IDs required')
        a=self.modules['regression_core'].RegressionAccounting(jobs,guarded_jobs=self.inventory,source_copy_bytes=self.copy_bytes,
            historical_peak_bytes=68563791,read_available=lambda:os.statvfs(self.output).f_bavail*os.statvfs(self.output).f_frsize)
        owner=self.modules['regression_parent'].RegressionJobs(a,core_module=self.modules['regression_core'],
            transport_module=self.modules['transport'],results_module=self.modules['results'])
        for definition in self.p['regression_jobs']:
            summary=owner.run(definition['job_id'],prepare=lambda ticket,check,d=definition:self.prepare_regression(d,ticket,check),readmit=self.readmit)
            self.regressions.append(asdict(summary))
        def finalize():
            self.recheck_all(self.last_deadline)
            actual=[i for row in self.guarded+self.regressions for i in row['expected_ids']]
            expected=[i for group in self.inventory.values()for i in group]+[i for group in jobs.values()for i in group]
            require(actual==expected and len(actual)==len(set(actual))<=4096,'exact combined execution union differs')
            self.persist('regression-index.json',{'jobs':self.regressions},self.last_deadline)
            self.persist('regression-summary.json',{'kind':'regression-stage-result-v1','tests':len(expected)-927,'jobs':len(jobs),
                'passed':True,'production_guard_installed':False},self.last_deadline)
            self.persist('result.json',{'kind':'portable-controller-result-v1','local_scope_passed':True,
                'profile_sha256':sha(self.profile_raw),'guarded_targets':{'jobs':67,'ids':927},
                'implementation_regressions':{'jobs':len(jobs),'ids':len(expected)-927},'combined_ids':len(expected),
                'evidence':dict(self.aux),'guarded_accounting':guarded_receipt,
                'ci_acceptance':False,'database_acceptance':False,'auth_acceptance':False,'clinical_activation':False,
                'descendant_cleanup_verified':False},self.last_deadline)
            self.recheck_all(self.last_deadline)
        a.finish(finalize=finalize)
        self.check(self.last_deadline)
        return {'output':str(self.output),'result':dict(self.aux['result.json']),'controller_returncode_required':0}


def run(profile_raw, source_root, implementation_root, tools_root, output_parent, *, tool_binding, bootstrap_deadline):
    """Internal entry API; profile/tool binding are fixed by the reviewed entry."""
    controller=Controller(profile_raw,source_root,implementation_root,tools_root,output_parent)
    controller.binding=dict(tool_binding)
    try:
        controller.bootstrap(bootstrap_deadline);guarded=controller.run_guarded()
        return controller.run_regressions(guarded)
    except BaseException as error:
        controller.failed=True
        # Failure is latched even if a previous stage/result file says success.
        # Do not renew an exhausted deadline to produce diagnostics.
        if controller.output is not None and 'results'in controller.modules and controller.last_deadline is not None:
            def failed_check():
                require(time.monotonic()<controller.last_deadline,'original failure cutoff exhausted')
            try:
                controller.modules['results'].write_terminal(controller.output/'failure.json',
                    {'kind':'portable-controller-failure-v1','passed':False,'error_type':type(error).__name__,
                     'guarded_jobs':len(controller.guarded),'regression_jobs':len(controller.regressions)},failed_check)
            except BaseException as diagnostic:error.add_note('failure evidence unavailable: '+type(diagnostic).__name__)
        raise
