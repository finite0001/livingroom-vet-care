"""Repository-only source admission for a NEW portable synthetic fixture envelope.

No database/runtime/legacy gate imports and no private-source fallback.
"""
from pathlib import Path
import copy
import hashlib
import json
import math
import os
import re
import stat
import time

HERE=Path(__file__).resolve().parent
STORED='tests/controlled-drugs/fixtures/record-review-v3/stored'
SOURCE=STORED+'/source'
ENVELOPE_SHA='039912f46ad95d41be6c65ff8b8d2a77666e57f8e7410597e509e4ab4df08fc6'
MAX_ENVELOPE=131072
MAX_FILE=37748736
MAX_SOURCES=134217728
OUTPUT_LIMIT=75497472
OUTPUT_FILES=94
OWN_FILES=('portable-envelope.json','portable_loader.py','portable_generator.py','test_portable_fixture.py')
TARGETS={'validate_stored_configuration':'stored_configuration_invalid','validate_configuration_record':'configuration_record_invalid','configuration_record':'configuration_record_invalid','validate_configuration_pair':'configuration_pair_invalid'}
sha=lambda b:hashlib.sha256(b).hexdigest()


def unique(pairs):
    value={}
    for key,item in pairs:
        if key in value:raise ValueError('duplicate JSON key')
        value[key]=item
    return value


def exact(actual,expected):
    if type(actual)is not type(expected):raise ValueError('exact JSON type')
    if isinstance(expected,dict):
        if actual.keys()!=expected.keys():raise ValueError('exact JSON keyset')
        for key in expected:exact(actual[key],expected[key])
    elif isinstance(expected,list):
        if len(actual)!=len(expected):raise ValueError('exact JSON length')
        for left,right in zip(actual,expected):exact(left,right)
    elif actual!=expected:raise ValueError('exact JSON value')


def deadline_check(deadline):
    if deadline is None:return
    if type(deadline)not in(int,float):raise ValueError('finite positive absolute deadline required')
    try:finite=math.isfinite(deadline)
    except OverflowError:finite=False
    if not finite or deadline<=0:raise ValueError('finite positive absolute deadline required')
    if time.monotonic()>=deadline:raise TimeoutError('portable source deadline exceeded')


def relative_name(value):
    if type(value)is not str or not value or '\\'in value:raise ValueError('relative source path')
    path=Path(value)
    if path.is_absolute()or any(x in ('','.','..')for x in value.split('/')):raise ValueError('relative source path')
    return path


def _identity(observation):
    return observation.st_dev,observation.st_ino,stat.S_IFMT(observation.st_mode)


def _physical_read(root,name,limit,deadline=None,expected_size=None,expected_sha=None):
    """Hold every physical ancestor and leaf; no path-following open/stat gap."""
    deadline_check(deadline);root=Path(root).absolute();relative=relative_name(name)
    if '..'in root.parts or type(limit)is not int or not 0<limit<=MAX_FILE:raise ValueError('bounded physical source path required')
    descriptors=[];edges=[];leaf=None
    directory_flags=os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_NONBLOCK
    try:
        parent=os.open('/',directory_flags);descriptors.append(parent)
        for component in (*root.parts[1:],*relative.parts[:-1]):
            deadline_check(deadline)
            child=os.open(component,directory_flags,dir_fd=parent)
            descriptors.append(child);observed=os.fstat(child)
            if not stat.S_ISDIR(observed.st_mode):raise ValueError('physical source ancestor required')
            edges.append((parent,component,child,_identity(observed)));parent=child
        deadline_check(deadline)
        leaf=os.open(relative.name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=parent)
        before=os.fstat(leaf)
        if not stat.S_ISREG(before.st_mode)or not 0<before.st_size<=limit:raise ValueError('bounded regular source file required')
        if expected_size is not None and before.st_size!=expected_size:raise ValueError('source file size/type')
        chunks=[];total=0;digest=hashlib.sha256()
        while True:
            deadline_check(deadline)
            chunk=os.read(leaf,min(1048576,before.st_size+1-total))
            deadline_check(deadline)
            if not chunk:break
            chunks.append(chunk);total+=len(chunk);digest.update(chunk)
            if total>before.st_size:raise ValueError('source grew during bounded read')
        after=os.fstat(leaf)
        if (_identity(before),before.st_size,before.st_mtime_ns,before.st_ctime_ns)!=(_identity(after),after.st_size,after.st_mtime_ns,after.st_ctime_ns):raise ValueError('opened source changed during read')
        if total!=before.st_size or(expected_sha is not None and digest.hexdigest()!=expected_sha):raise ValueError('pinned source digest')
        current=os.stat(relative.name,dir_fd=parent,follow_symlinks=False)
        if _identity(current)!=_identity(before):raise ValueError('source leaf identity changed')
        for owner,component,child,identity in edges:
            deadline_check(deadline)
            if _identity(os.fstat(child))!=identity or _identity(os.stat(component,dir_fd=owner,follow_symlinks=False))!=identity:raise ValueError('source ancestor identity changed')
        deadline_check(deadline);return b''.join(chunks)
    except FileNotFoundError:
        raise
    except OSError as exc:
        raise ValueError('physical source open/read refused')from exc
    finally:
        if leaf is not None:os.close(leaf)
        for descriptor in reversed(descriptors):os.close(descriptor)


def read_regular(root,name,metadata,deadline=None):
    deadline_check(deadline)
    if type(metadata)is not dict or type(metadata.get('bytes'))is not int or not 0<metadata['bytes']<=MAX_FILE or type(metadata.get('sha256'))is not str or not re.fullmatch('[0-9a-f]{64}',metadata.get('sha256','')):raise ValueError('source size/hash metadata')
    return _physical_read(root,name,MAX_FILE,deadline,metadata['bytes'],metadata['sha256'])


def validate_envelope_shape(value):
    required={'kind','version','source_only','runtime_executed','legacy_full761_admission','fixed_source_files','source_file_count','aggregate_source_bytes','legacy_inventory_path','phase_names','phases','target_case_count','expected_outcome_count','render_entry_count','legacy_provenance','excluded_legacy_authorities','corpus_files','limits','portable_inventory_changed_fields'}
    if type(value)is not dict or set(value)!=required:raise ValueError('portable envelope keyset')
    exact(value['kind'],'portable-stored-record-fixture-envelope-v1');exact(value['version'],1)
    for name,wanted in [('source_only',True),('runtime_executed',False),('legacy_full761_admission',False)]:exact(value[name],wanted)
    for name,wanted in [('source_file_count',130),('target_case_count',1594),('expected_outcome_count',1727),('render_entry_count',1788)]:exact(value[name],wanted)
    files=value['fixed_source_files']
    if type(files)is not dict or len(files)!=130:raise ValueError('finite130 source keyset')
    total=0
    for name,item in files.items():
        relative_name(name)
        if not name.startswith('tests/')or '/tmp/'in name or name.endswith('.log'):raise ValueError('non-repository/private authority forbidden')
        if type(item)is not dict or set(item)!={'bytes','sha256','role'}or type(item['bytes'])is not int or not 0<item['bytes']<=MAX_FILE or type(item['role'])is not str or type(item['sha256'])is not str or not re.fullmatch('[0-9a-f]{64}',item['sha256']):raise ValueError('source declaration type/size/hash')
        total+=item['bytes']
    exact(value['aggregate_source_bytes'],total)
    if total>MAX_SOURCES:raise ValueError('source aggregate cap')
    phases=value['phase_names']
    if type(phases)is not list or len(phases)!=93 or any(type(n)is not str or not re.fullmatch('[a-z0-9_]+',n)for n in phases)or len(set(phases))!=93:raise ValueError('fixed93 phase inventory')
    if type(value['phases'])is not dict or set(value['phases'])!=set(phases):raise ValueError('phase metadata inventory')
    for index,name in enumerate(phases):
        item=value['phases'][name]
        if type(item)is not dict or set(item)!={'path','sha256','bytes'}:raise ValueError('phase metadata keys')
        exact(item['path'],STORED+'/sql-v1/%03d-%s.sql'%(index,name))
        meta=files.get(item['path']);
        if meta is None:raise ValueError('phase missing from source closure')
        exact(item['sha256'],meta['sha256']);exact(item['bytes'],meta['bytes'])
    exact(value['legacy_inventory_path'],STORED+'/legacy-inventory.json')
    exact(value['portable_inventory_changed_fields'],['kind','source_hashes','portable_provenance'])
    exact(value['limits'],dict(max_file_bytes=MAX_FILE,max_source_bytes=MAX_SOURCES,max_envelope_bytes=MAX_ENVELOPE,max_generated_output_bytes=OUTPUT_LIMIT,max_generated_files=OUTPUT_FILES))
    excluded=value['excluded_legacy_authorities']
    if type(excluded)is not list or len(excluded)!=7 or sum(type(x)is dict and str(x.get('source_path','')).endswith('.log')for x in excluded)!=5:raise ValueError('explicit seven excluded legacy authorities')
    return value


def envelope(deadline=None):
    raw=_physical_read(HERE,'portable-envelope.json',MAX_ENVELOPE,deadline,expected_sha=ENVELOPE_SHA)
    value=json.loads(raw,object_pairs_hook=unique)
    validate_envelope_shape(value);deadline_check(deadline)
    return value


def source_hashes(root,deadline=None):
    value=envelope(deadline);result={}
    for name,item in value['fixed_source_files'].items():
        read_regular(root,name,item,deadline);result[name]=item['sha256']
    return result


def own_inputs(root,deadline=None):
    """New bounded code provenance; private prototype is not canonical admission."""
    root=Path(root).absolute();result={}
    for name in OWN_FILES:
        deadline_check(deadline);path=HERE/name
        try:rel=str(path.relative_to(root))
        except ValueError as exc:raise ValueError('portable code must be inside explicit repository root')from exc
        result[rel]=sha(_physical_read(root,rel,MAX_ENVELOPE,deadline))
    deadline_check(deadline);return result


def validate_cases(cases):
    if type(cases)is not list or len(cases)!=1594:raise ValueError('exact1594 literal cases')
    ids=set();successes=nulls=0
    for case in cases:
        if type(case)is not dict:raise ValueError('case object')
        identifier=case.get('id');fn=case.get('function');tag=case.get('argument_kind')
        if type(identifier)is not str or not re.fullmatch(r'[A-Za-z0-9_/:.\-]+',identifier)or identifier in ids:raise ValueError('case ID')
        ids.add(identifier)
        if type(fn)is not str or fn not in TARGETS:raise ValueError('fixed function dispatch')
        if tag=='sql_null':
            if 'argument_jsonb_text'in case or'argument_utf8_bytes'in case:raise ValueError('SQLNULL lexical fields')
            nulls+=1
        elif tag=='jsonb':
            raw=case.get('argument_jsonb_text');size=case.get('argument_utf8_bytes')
            if type(raw)is not str or type(size)is not int or not 0<size<=1048576 or len(raw.encode())!=size:raise ValueError('literal argument bytes/type')
        else:raise ValueError('argument tag')
        expected=case.get('expected')
        if type(expected)is not dict:raise ValueError('expected object')
        if expected.get('outcome')=='error':exact(expected,dict(outcome='error',sqlstate='23514',message=TARGETS[fn]))
        elif expected.get('outcome')=='success':
            if set(expected)!={'outcome','return_jsonb_text'}or type(expected['return_jsonb_text'])is not str or tag!='jsonb':raise ValueError('literal success shape')
            successes+=1
        else:raise ValueError('expected outcome')
    if successes!=204 or nulls!=4:raise ValueError('success/NULL inventory')
    return cases


def legacy_inventory(root,deadline=None):
    e=envelope(deadline);name=e['legacy_inventory_path'];raw=read_regular(root,name,e['fixed_source_files'][name],deadline)
    inventory=json.loads(raw,object_pairs_hook=unique)
    for key,wanted in [('kind','private-record-fixture-source-draft-v1'),('source_only',True),('runtime_executed',False),('target_cases',1594),('successes',204),('refusals',1390),('total_sql_bytes',33427253),('phase_seconds',120),('whole_seconds',600),('absolute_cutoff_seconds_before_outer_deadline',60),('single_emergency_cleanup_seconds',180),('stream_limit_bytes',134217728),('reader_limit_bytes',134217728),('metadata_oracle_imported_from_target',False),('byte_guard_branch_proof',False),('exhaustive_section8_acceptance',False)]:exact(inventory[key],wanted)
    exact(inventory['phase_names'],e['phase_names'])
    for name,item in inventory['phases'].items():exact(item,{k:e['phases'][name][k]for k in('bytes','sha256')})
    if len(inventory['case_inventory'])!=1594 or len(inventory['render_inventory'])!=1788 or len(inventory['complete_expected_outcomes'])!=1727:raise ValueError('legacy literal parity cardinality')
    # source_hashes are retained metadata ONLY. Never traverse legacy private paths.
    return inventory


def portable_inventory(original,inputs):
    inventory=dict(original)
    inventory['kind']='portable-stored-record-fixture-source-v1'
    inventory['source_hashes']=dict(inputs)
    inventory['portable_provenance']={'envelope_sha256':ENVELOPE_SHA,'legacy_inventory_sha256':envelope()['legacy_provenance']['inventory_sha256'],'legacy_full761_admission':False,'removed_private_authorities':7,'removed_private_logs':5,'payload_SQL_byte_identical':True,'historical_runtime_acceptance_inherited':False}
    return inventory


def verify_parity(root,stages,inventory,deadline=None):
    expected=legacy_inventory(root,deadline);e=envelope(deadline)
    exact(list(stages),expected['phase_names'])
    for name,sql in stages.items():
        if type(sql)is not str:raise ValueError('SQL string required')
        item=e['phases'][name];raw=read_regular(root,item['path'],e['fixed_source_files'][item['path']],deadline)
        if sql.encode()!=raw:raise ValueError('SQL byte parity: '+name)
    normalized=dict(inventory)
    if normalized.pop('kind',None)!='portable-stored-record-fixture-source-v1':raise ValueError('new inventory kind required')
    inputs=normalized.pop('source_hashes',None);provenance=normalized.pop('portable_provenance',None)
    if type(inputs)is not dict:raise ValueError('new source map required')
    expected_inputs={name:item['sha256']for name,item in e['fixed_source_files'].items()}
    expected_inputs.update(own_inputs(root,deadline))
    exact(inputs,expected_inputs)
    exact(provenance,portable_inventory(expected,inputs)['portable_provenance'])
    original=dict(expected);original.pop('kind');original.pop('source_hashes')
    exact(normalized,original)
    exact(source_hashes(root,deadline),{name:item['sha256']for name,item in e['fixed_source_files'].items()})
    deadline_check(deadline)
    return True


def load_fixture(root,deadline=None):
    root=Path(root).absolute();inputs=source_hashes(root,deadline);inputs.update(own_inputs(root,deadline))
    original=legacy_inventory(root,deadline);e=envelope(deadline);stages={}
    for name in e['phase_names']:
        item=e['phases'][name];raw=read_regular(root,item['path'],e['fixed_source_files'][item['path']],deadline)
        sql=raw.decode('utf8')
        if '\x00'in sql:raise ValueError('NUL in SQL')
        stages[name]=sql
    inventory=portable_inventory(original,inputs)
    verify_parity(root,stages,inventory,deadline)
    deadline_check(deadline)
    return stages,inventory,dict(original['complete_expected_outcomes']),inputs
