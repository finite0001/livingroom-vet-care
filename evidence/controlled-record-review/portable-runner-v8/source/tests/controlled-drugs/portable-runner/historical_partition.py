"""One fixed eight-case historical boundary partition; no filesystem/target imports.

Caller source-admits this module and the fixed boundary sources before use. This
is neither arbitrary unittest filtering nor authority to construct expectations.
"""
import hashlib
import json
import math
from pathlib import Path

SUITE = 'tests/controlled-drugs/harness/test_historical_boundary.py'
CLASS = 'HistoricalBoundaryTests'
INVENTORY_SHA = '9e2719f903144d1e7c694924690e992e4d9bbaea348a795355d6f0a9cbfe34ea'
SPEC_SHA = 'e189b9496420e71131197426916ebe6d948b5461828c39303c867bffcfebd730'
SHORT_IDS = (
 'HistoricalBoundaryTests.test_stored638_missing_source_refuses',
 'HistoricalBoundaryTests.test_stored638_changed_source_refuses',
 'HistoricalBoundaryTests.test_stored638_extra_source_refuses',
 'HistoricalBoundaryTests.test_stored638_symlink_source_refuses',
 'HistoricalBoundaryTests.test_stored_current_expansion_refuses',
 'HistoricalBoundaryTests.test_a2_dependency_drift_reaches_exact_identity_guard',
 'HistoricalBoundaryTests.test_a2_own_digest_guard_after_collector_snapshot',
 'HistoricalBoundaryTests.test_a2_current_expansion_refuses',
)
ALL_IDS = tuple(SUITE + '::' + name for name in SHORT_IDS)
PARTITION_KEYS = frozenset(('inventory_sha256','all_ids','selected_id','ordinal','partitions'))
SOURCES = {
 SUITE: {'bytes':18073,'sha256':'a6a326f15b518dcae06030370c33bc0a2db514fa00063c79030497249cc5ab00'},
 str(Path(SUITE).parent/'boundary-spec.json'): {'bytes':609117,'sha256':SPEC_SHA},
 str(Path(SUITE).parent/'mutation.py'): {'bytes':21652,'sha256':'7eb2a45a7975073621f4a148a70373b3ed67b3e7b387b4a620a5e3f554f564b4'},
 str(Path(SUITE).parent/'cases.json'): {'bytes':7047,'sha256':INVENTORY_SHA},
}


def require(value, message):
 if not value: raise ValueError(message)


def execution_ids(job, check):
 """Original routes keep all IDs; only the literal eight-case route selects one."""
 check();suite=job['suite'];partition=job['partition']
 require(job['kind']=='portable-worker-job-v2','fixed job-v2 required')
 if suite['kind']!='historical_boundary':
  require(partition is None,'ordinary suites cannot be partitioned')
  check();return list(suite['expected_ids'])
 require(type(partition)is dict and partition.keys()==PARTITION_KEYS,'exact fixed partition fields required')
 require(type(partition['inventory_sha256'])is str and partition['inventory_sha256']==INVENTORY_SHA,'fixed inventory authority differs')
 require(type(partition['partitions'])is int and partition['partitions']==8,'exact eight partitions required')
 require(type(partition['ordinal'])is int and 0<=partition['ordinal']<8,'formal fixed partition ordinal')
 require(type(partition['all_ids'])is list and partition['all_ids']==list(ALL_IDS),'complete ordered eight-case authority required')
 ordinal=partition['ordinal'];selected=partition['selected_id']
 require(type(selected)is str and selected==ALL_IDS[ordinal],'selected ID must match fixed ordinal')
 require(suite['relative']==SUITE and suite['classes']==[CLASS],'fixed historical class/source required')
 require(type(suite['expected_ids'])is list and suite['expected_ids']==list(ALL_IDS),'suite must retain all eight IDs')
 require(type(suite['id_map'])is dict and suite['id_map']==dict(zip(SHORT_IDS,ALL_IDS)),'exact full eight-case ID mapping required')
 require(job['historical638'] is None,'historical boundary has no child callback')
 check();return [selected]


def _source_trees(job, check):
 execution_ids(job,check);require(job['suite']['kind']=='historical_boundary','boundary context only')
 trees=job['guard']['source_trees'];require(type(trees)is list,'explicit source trees required')
 tags=[t['tag']for t in trees];require(len(set(tags))==len(tags),'unique source trees required')
 current=[t for t in trees if t['tag']==job['suite']['tree_tag']]
 require(len(current)==1,'one current suite tree required');current=current[0]
 historical=[t for t in trees if t['profile'] in ('stored638','a2_669')]
 require(len(historical)==1,'exactly one fixed historical tree required');historical=historical[0]
 profile='stored638'if job['partition']['ordinal']<5 else'a2_669'
 require(historical['profile']==profile and historical['tag']!=current['tag'],'case historical profile differs from current tree')
 require(current['root']!=historical['root'],'current and historical roots must differ')
 for name,meta in SOURCES.items():
  check();require(current['files'].get(name)==meta,'fixed boundary source binding differs: '+name)
 inventory=job['guard']['extra_test_inventory']
 require(type(inventory)is dict and set(inventory)==set(ALL_IDS),'guard must retain exact eight added IDs')
 for identifier in ALL_IDS:
  check();require(inventory[identifier]=={'source':SUITE,'sha256':SOURCES[SUITE]['sha256']},'fixed guard source inventory differs')
 require(job['guard']['suite_id']==SUITE and job['guard']['suite_tree_tag']==current['tag'],'guard suite/current binding differs')
 require(job['guard']['historical_route']is None,'historical boundary cannot receive child route')
 check();return current,historical


def source_bindings(job, check):
 """Finite source/context admission before importing the new boundary harness."""
 current,historical=_source_trees(job,check)
 return {'current_tag':current['tag'],'historical_tag':historical['tag'],
         'spec_relative':str(Path(SUITE).parent/'boundary-spec.json')}


def context_arguments(job, admitted_trees, spec_raw, check):
 """Derive frozen Context fields from already admitted guard tree identities."""
 current,historical=_source_trees(job,check)
 require(type(spec_raw)is bytes and len(spec_raw)==609117 and hashlib.sha256(spec_raw).hexdigest()==SPEC_SHA,'independent boundary spec bytes required')
 def unique(items):
  out={}
  for key,value in items:
   check();require(key not in out,'duplicate spec key');out[key]=value
  return out
 spec=json.loads(spec_raw.decode('utf-8','strict'),object_pairs_hook=unique);check()
 require([r['stable_id']for r in spec['cases']]==list(ALL_IDS),'fixed spec cases differ')
 profile=historical['profile'];members=spec['profiles'][profile]['members']
 expected={name:{'bytes':meta['bytes'],'sha256':meta['sha256']}for name,meta in members.items()}
 require(historical['files']==expected,'complete historical metadata differs')
 for name,meta in spec['current656'].items():
  check();require(current['files'].get(name)==meta,'current656 source metadata differs')
 require(len(spec['current656'])==656,'fixed current656 cardinality')
 require(set(admitted_trees)=={t['tag']for t in job['guard']['source_trees']},'admitted tree keyset differs')
 for declared in (current,historical):
  check();admitted=admitted_trees[declared['tag']]
  require(admitted.tag==declared['tag'] and admitted.profile==declared['profile'] and admitted.root.path==declared['root'],'admitted tree identity differs')
  require(set(admitted.files)==set(declared['files']),'admitted complete file keyset differs')
  for name,meta in declared['files'].items():
   check();pin=admitted.files[name]
   require(pin.sha256==meta['sha256'] and type(pin.size)is int and pin.size==meta['bytes'],'admitted source pin differs')
  require(type(admitted.root.dev)is int and type(admitted.root.ino)is int,'admitted physical root identity required')
 a=admitted_trees[current['tag']].root;b=admitted_trees[historical['tag']].root
 require((a.dev,a.ino)!=(b.dev,b.ino),'current/historical physical roots collide')
 deadline=job['deadline'];require(type(deadline)in(int,float)and math.isfinite(deadline),'original finite deadline required')
 output=Path(job['output']['directory']);tree=Path(b.path)
 require(output.is_absolute()and not output.is_relative_to(tree),'evidence must be outside historical tree')
 args={'repository_root':Path(a.path),'tree_root':tree,'evidence_parent':output,'root_identity':(b.dev,b.ino),
  'baseline_map':tuple(sorted((k,v['sha256'])for k,v in expected.items())),
  'current_map':tuple(sorted((k,v['sha256'])for k,v in spec['current656'].items())),
  'profile':profile,'selected_id':SHORT_IDS[job['partition']['ordinal']],'deadline':deadline}
 check();return args
