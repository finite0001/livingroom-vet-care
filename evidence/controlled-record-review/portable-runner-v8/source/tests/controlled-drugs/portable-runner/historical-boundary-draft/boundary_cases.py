"""Exact eight historical gate negatives; execution needs a reviewed singleton job."""
import ast
from dataclasses import dataclass
import hashlib
import importlib
import importlib.util
import json
import math
import os
import stat
from pathlib import Path
import sys
import time
import types
import unittest

HERE=Path(__file__).resolve().parent
SPEC_SHA='e189b9496420e71131197426916ebe6d948b5461828c39303c867bffcfebd730'
MUTATION_SHA='7eb2a45a7975073621f4a148a70373b3ed67b3e7b387b4a620a5e3f554f564b4'
SMOKE='tests/controlled-drugs/engine/candidate/smoke.sql'
CANDIDATE='tests/controlled-drugs/engine/candidate'
MAPS='tests/controlled-drugs/fixtures/record-review-v3/history/maps/'
MATERIALIZER='tests/controlled-drugs/harness/historical_tree.py'
EXPECTED='fec2ff871f064a124ae3a0fb5ba60e36b8b58dda1932393cd656c43cd68abd7d'
INSTALL='22021a314fc196efa822a16ca30d25c7f9f6e70811703fe60eb747d92280d542'


def require(value,message):
    if not value:raise ValueError(message)


def unique(pairs):
    answer={}
    for key,value in pairs:
        require(key not in answer,'duplicate JSON key');answer[key]=value
    return answer


def digest(raw):return hashlib.sha256(raw).hexdigest()


def sibling(name, wanted, check):
    """Finite bootstrap read; parent still admits the entire implementation closure."""
    require(name in ('mutation.py','boundary-spec.json'),'fixed sibling input')
    check();fds=[];edges=[]
    try:
        fd=os.open('/',os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW);fds.append(fd)
        for part in HERE.parts[1:]:
            check();owner=fd;fd=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=owner);fds.append(fd)
            st=os.fstat(fd);edges.append((owner,part,fd,(st.st_dev,st.st_ino,st.st_mode)))
        leaf=os.open(name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=fd);fds.append(leaf)
        original=os.fstat(leaf)
        require(stat.S_ISREG(original.st_mode)and original.st_nlink==1 and original.st_size<=1024**2,'bounded regular sibling')
        chunks=[];count=0
        while True:
            check();raw=os.read(leaf,min(65536,original.st_size+1-count));check()
            if not raw:break
            count+=len(raw);require(count<=original.st_size,'sibling grew');chunks.append(raw)
        stamp=lambda v:(v.st_dev,v.st_ino,v.st_mode,v.st_nlink,v.st_size,v.st_mtime_ns,v.st_ctime_ns)
        require(stamp(original)==stamp(os.fstat(leaf))==stamp(os.stat(name,dir_fd=fd,follow_symlinks=False)),'sibling changed')
        for owner,part,child,ident in edges:
            check();st=os.stat(part,dir_fd=owner,follow_symlinks=False);live=os.fstat(child)
            require((st.st_dev,st.st_ino,st.st_mode)==ident==(live.st_dev,live.st_ino,live.st_mode),'sibling ancestor changed')
        raw=b''.join(chunks);require(count==original.st_size and digest(raw)==wanted,'sibling digest differs');check();return raw
    finally:
        for fd in reversed(fds):os.close(fd)


def load_mutation(check):
    raw=sibling('mutation.py',MUTATION_SHA,check)
    module=types.ModuleType('boundary_owned_mutation');module.__file__=str(HERE/'mutation.py')
    exec(compile(raw,module.__file__,'exec'),module.__dict__);return module


def declaration(check):
    raw=sibling('boundary-spec.json',SPEC_SHA,check)
    return json.loads(raw,object_pairs_hook=unique)


@dataclass(frozen=True)
class Context:
    repository_root: Path
    tree_root: Path
    evidence_parent: Path
    root_identity: tuple
    baseline_map: tuple
    current_map: tuple
    profile: str
    selected_id: str
    deadline: float

    def check(self):
        if time.monotonic()>=self.deadline:raise TimeoutError('historical boundary original worker deadline')


def admit_context(context,spec):
    require(type(context)is Context,'fixed immutable Context required')
    require(type(context.deadline)in(float,int)and math.isfinite(context.deadline),'finite absolute deadline')
    require(time.monotonic()<context.deadline<=time.monotonic()+600,'worker deadline at most600')
    for path in (context.repository_root,context.tree_root,context.evidence_parent):
        require(type(path)is type(Path())and path.is_absolute()and'..'not in path.parts and not str(path).startswith('//'),'physical absolute context path')
    require(type(context.root_identity)is tuple and len(context.root_identity)==2 and all(type(v)is int and v>=0 for v in context.root_identity),'physical root identity')
    matches=[row for row in spec['cases']if row['id']==context.selected_id]
    require(len(matches)==1 and matches[0]['profile']==context.profile,'selected fixed case/profile')
    for value in (context.baseline_map,context.current_map):
        require(type(value)is tuple and all(type(pair)is tuple and len(pair)==2 and all(type(v)is str for v in pair)for pair in value),'immutable complete maps')
        require(list(value)==sorted(set(value))and len(dict(value))==len(value),'unique sorted map')
    wanted={k:v['sha256']for k,v in spec['profiles'][context.profile]['members'].items()}
    require(dict(context.baseline_map)==wanted,'independent complete baseline map differs')
    require(dict(context.current_map)=={k:v['sha256']for k,v in spec['current656'].items()},'independent current656 map differs')
    context.check()


class ReadTrace:
    """Audit observation only; no replacement of target file or collector APIs."""
    def __init__(self,root,check):
        self.root=str(root)+'/';self.check=check;self.events=[];self.bytes=0;self.active=False;self.failed=False
    def hook(self,event,args):
        if not self.active or event!='open':return
        self.check()
        if not args or not isinstance(args[0],str)or not args[0].startswith(self.root):return
        flags=args[2]if len(args)>2 and type(args[2])is int else None
        if flags is not None and flags&os.O_ACCMODE==os.O_WRONLY:return
        name=args[0][len(self.root):];size=len(name.encode())
        if len(self.events)>=4096 or size>4096 or self.bytes+size>1024**2:
            self.failed=True;raise ValueError('bounded read trace exceeded')
        self.events.append(name);self.bytes+=size
    def reset(self):self.events=[];self.bytes=0
    def finish(self):self.active=False;require(not self.failed,'read observer failure');self.check();return tuple(self.events)


def expected_assertion(call,code,locus,message,check,locals_check=None):
    """Only the exact target assertion can discharge the negative."""
    check()
    try:call()
    except AssertionError as error:
        check();require(type(error)is AssertionError and str(error)==message,'wrong target assertion diagnostic')
        frame=error.__traceback__
        while frame.tb_next is not None:frame=frame.tb_next
        require(frame.tb_frame.f_code is code and frame.tb_lineno==locus['lineno'],'wrong target assertion locus')
        if locals_check is not None:require(locals_check(frame.tb_frame.f_locals),'wrong offending source member')
        check();return {'exception':'AssertionError','message':message,'function':locus['function'],'lineno':frame.tb_lineno}
    raise AssertionError('required exact historical refusal did not occur')


def _pinned_assertions(spec,tree,m,check):
    root=m.Root(tree,check)
    try:
        for declaration in spec['assertions'].values():
            path=declaration['path']
            # Expected metadata comes from one of the two original fixed maps.
            entry=next(p['members'][path]for p in spec['profiles'].values()if path in p['members'])
            raw,_=m.read(root,path,{'bytes':entry['bytes'],'sha256':declaration['source_sha256']},keep=True)
            parsed=ast.parse(raw);nodes=[n for n in ast.walk(parsed)if isinstance(n,ast.Assert)and n.lineno==declaration['lineno']]
            require(len(nodes)==1 and digest(ast.dump(nodes[0],include_attributes=False).encode())==declaration['assertion_AST_sha256'],'pinned assertion AST differs')
    finally:root.close()


def _execute(test,context,spec,state,ordinal):
    row=spec['cases'][ordinal];require(row['id']==context.selected_id,'worker must select exact singleton');require(not state['used'],'fresh worker per case required');state['used']=True
    context.check();m=load_mutation(context.check);repo=m.Root(context.repository_root,context.check);mutation=None;trace=None;old_path=list(sys.path)
    try:
        authority={}
        for path,meta in spec['authorities'].items():
            context.check();authority[path]=m.read(repo,path,meta,keep=True)[0]
        h=types.ModuleType('historical_boundary_materializer');h.__file__=str(context.repository_root/MATERIALIZER)
        exec(compile(authority[MATERIALIZER],h.__file__,'exec'),h.__dict__)
        published=h.load_manifest(context.deadline)
        entries=list(spec['profiles'][context.profile]['members'].values())
        require(entries==[published['files'][p]for p in published['profiles'][context.profile]['paths']],'fixed historical member declaration')
        h.verify_tree(context.tree_root,entries,context.deadline,identity=context.root_identity)
        # Stored tree does not contain A2's runtime. Admit only relevant loci here.
        relevant={**spec,'assertions':{k:v for k,v in spec['assertions'].items()if k.startswith('stored_')==(context.profile=='stored638')}}
        _pinned_assertions(relevant,context.tree_root,m,context.check)
        candidate=context.tree_root/CANDIDATE
        names={Path(k).stem for k,_ in context.baseline_map if str(Path(k).parent)==CANDIDATE and k.endswith('.py')}
        names|={'admission','fixtures','lifecycle','a2_retained_fixed188_driver','a2_genuine_fixture_values','a2_positive_dependencies','observations','session','historical_boundary_a2_target'}
        require(not names.intersection(sys.modules),'foreign project module already loaded')
        sys.path.insert(0,str(candidate))
        owned=importlib.import_module('record_review_v3_gate_a_runtime')
        if context.profile=='stored638':
            target=importlib.import_module('record_review_v3_configuration_record_runtime');profile=importlib.import_module('record_review_v3_configuration_record_profile')
            wanted=json.loads(authority[MAPS+'stored638.json'],object_pairs_hook=unique)
            def positive():
                context.check();target.canonical_location();package=profile.build();context.check();target.admit_package(package)
                require(package['expected_sha256']==EXPECTED and package['install_sha256']==INSTALL and len(package['input_source_hashes'])==267,'independent267 package pins')
                require(target.integration_gate(owned,context.deadline)==wanted,'good638 baseline gate differs')
                require(all(wanted.get(k)==v for k,v in package['input_source_hashes'].items()),'profile267 not in good638')
        else:
            path=candidate/'record_review_v3_a2_positive/runtime.py'
            descriptor=importlib.util.spec_from_file_location('historical_boundary_a2_target',path);target=importlib.util.module_from_spec(descriptor)
            sys.modules[descriptor.name]=target;descriptor.loader.exec_module(target)
            wanted=json.loads(authority[MAPS+'a2669.json'],object_pairs_hook=unique);collector=json.loads(authority[MAPS+'a2645.json'],object_pairs_hook=unique)
            def positive():
                context.check();require(owned.source_inputs()==collector,'good645 collector differs');require(target.input_map(context.check)==wanted,'good669 baseline gate differs')
        positive();context.check()
        origins={Path(k).stem:context.tree_root/k for k,_ in context.baseline_map if str(Path(k).parent)==CANDIDATE and k.endswith('.py')}
        if context.profile=='a2_669':
            fixed='tmp/a2-opening-adapter-draft/bootstrap188/'
            origins.update({name:context.tree_root/(fixed+name+'.py')for name in('admission','fixtures','lifecycle')})
            origins.update({'a2_retained_fixed188_driver':context.tree_root/(fixed+'driver.py'),
                'a2_genuine_fixture_values':context.tree_root/'tmp/a2-opening-adapter-draft/genuine-a2-fixtures/fixtures.py',
                'historical_boundary_a2_target':candidate/'record_review_v3_a2_positive/runtime.py'})
            origins.update({name:candidate/('record_review_v3_a2_positive/'+name+'.py')for name in('a2_positive_dependencies','observations','session')})
        for name in names:
            module=sys.modules.get(name)
            if module is not None:
                origin=getattr(module,'__file__',None)
                require(name in origins and origin is not None and Path(origin)==origins[name],'project import origin differs from fixed module path')
        baseline={k:{'bytes':v['bytes'],'sha256':v['sha256']}for k,v in spec['profiles'][context.profile]['members'].items()}
        additions={}
        if ordinal==2:additions={row['mutation_path']:{'bytes':len(b'-- historical boundary extra\n'),'sha256':digest(b'-- historical boundary extra\n')}}
        if ordinal in (4,7):additions={k:v for k,v in spec['current656'].items()if k not in baseline}
        mutation=m.Mutation(context.tree_root,context.evidence_parent,baseline,additions,context.root_identity,context.check)
        trace=ReadTrace(context.tree_root,context.check);sys.addaudithook(trace.hook)
        callback_count=0;injection_complete=False
        def check():
            nonlocal callback_count,injection_complete
            context.check();callback_count+=1
            if callback_count==2 and ordinal==6:
                path=row['mutation_path'];original,_=m.read(mutation.tree,path,baseline[path],keep=True)
                mutation.replace(path,original+b'\n');injection_complete=True;trace.reset()
            elif callback_count==2 and ordinal==7:trace.reset()
            context.check()
        if ordinal==0:mutation.remove(SMOKE)
        elif ordinal==1:
            original,_=m.read(mutation.tree,SMOKE,baseline[SMOKE],keep=True);mutation.replace(SMOKE,original+b'\n-- historical boundary changed\n')
        elif ordinal==2:mutation.add(row['mutation_path'],b'-- historical boundary extra\n')
        elif ordinal==3:mutation.symlink_same_bytes(SMOKE)
        elif ordinal in (4,7):
            for path,meta in sorted(additions.items()):mutation.add(path,m.read(repo,path,meta,keep=True)[0])
        elif ordinal==5:
            path=row['mutation_path'];original,_=m.read(mutation.tree,path,baseline[path],keep=True);mutation.replace(path,original+b'\n')
        if ordinal!=6:mutation.verify_mutated()
        if ordinal==3:require(owned.source_inputs()==wanted,'symlink must retain exact638 digest map')
        if ordinal==5:require(owned.source_inputs()==collector,'identity mutation must retain exact645 collector')
        if ordinal in (4,7):require(owned.source_inputs()==dict(context.current_map),'expanded actual collector differs from complete656')
        label={0:'stored_keyset',1:'stored_changed',2:'stored_keyset',3:'stored_symlink',4:'stored_keyset',5:'a2_dependency',6:'a2_own',7:'a2_transition'}[ordinal]
        locus=spec['assertions'][label];fn=getattr(target,locus['function']);trace.active=True
        predicate=(lambda values:values.get('name')==SMOKE and values.get('path')==context.tree_root/SMOKE and values['path'].is_symlink())if ordinal==3 else None
        if ordinal==5:predicate=lambda values:values.get('name')=='identity.sql' and values.get('path')==context.tree_root/row['mutation_path']
        refusal=expected_assertion((lambda:target.integration_gate(owned,context.deadline))if ordinal<5 else(lambda:target.input_map(check)),fn.__code__,locus,row['expected_message'],context.check,predicate)
        events=trace.finish()
        if ordinal==6:require(injection_complete and callback_count>=2,'own callback did not complete')
        if ordinal==5:require(row['mutation_path']in events,'actual identity dependency read missing')
        if ordinal in(6,7):require(not any(p.startswith(('tmp/a2-opening-adapter-draft/bootstrap188/','tmp/a2-opening-adapter-draft/genuine-a2-fixtures/'))for p in events),'unexpected dependency traversal before refusal')
        delta=mutation.verify_mutated()
        evidence={'id':row['id'],'baseline_passed':True,'refusal':refusal,'delta':delta,'callback_count':callback_count,'injection_complete':injection_complete,'read_events':events,'acceptance':False,'database_commands':0}
        raw=(json.dumps(evidence,sort_keys=True,indent=2)+'\n').encode();require(len(raw)<=1024**2,'bounded boundary evidence');m.new_file(mutation.evidence,'negative-evidence.json',raw,context.check)
        restoration=mutation.restore();positive();context.check();h.verify_tree(context.tree_root,entries,context.deadline,identity=context.root_identity)
        require(restoration['restored']is True,'restoration proof missing');context.check()
    finally:
        if trace is not None:trace.active=False
        sys.path[:]=old_path
        if mutation is not None:mutation.close()
        repo.close()


def build_case(context):
    require(type(context)is Context,'fixed immutable Context required')
    require(sys.flags.optimize==0,'historical assertions require unoptimized interpreter')
    spec=declaration(context.check);admit_context(context,spec);state={'used':False}
    class HistoricalBoundaryTests(unittest.TestCase):
        def test_stored638_missing_source_refuses(self):_execute(self,context,spec,state,0)
        def test_stored638_changed_source_refuses(self):_execute(self,context,spec,state,1)
        def test_stored638_extra_source_refuses(self):_execute(self,context,spec,state,2)
        def test_stored638_symlink_source_refuses(self):_execute(self,context,spec,state,3)
        def test_stored_current_expansion_refuses(self):_execute(self,context,spec,state,4)
        def test_a2_dependency_drift_reaches_exact_identity_guard(self):_execute(self,context,spec,state,5)
        def test_a2_own_digest_guard_after_collector_snapshot(self):_execute(self,context,spec,state,6)
        def test_a2_current_expansion_refuses(self):_execute(self,context,spec,state,7)
    return HistoricalBoundaryTests
