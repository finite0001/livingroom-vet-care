"""Prospective literal profile preparation, not a runtime authority generator.

Run once after source changes settle, then independently review its complete
output before assembly/execution. Old maps are compared, never rewritten. New
source hashes identify review candidates; successful tests do not supply pins.
"""
import ast
import hashlib
import importlib.util
import json
from pathlib import Path
import sys

HERE=Path(__file__).resolve().parent
RUNNER=HERE.parent
ROOT=RUNNER.parents[2]
PREFIX='tests/controlled-drugs/portable-runner'
ADAPTER='tests/controlled-drugs/portable-stored-adapter'
OLD_ADAPTER=ROOT/'tmp/secondary-review-20261021/portable-stored-runtime-adapter-draft'


def digest(raw):return hashlib.sha256(raw).hexdigest()
def metadata(path):
    raw=path.read_bytes();return {'bytes':len(raw),'sha256':digest(raw)}


def main(output):
    base_raw=(RUNNER/'parent-design/base-public-slice.json').read_bytes()
    assert digest(base_raw)=='119fb7f9c0cfb6ee30153d6a16926dac04c48e86e9549e94fba333df97714e25'
    base=json.loads(base_raw)['files']
    files={name:{key:value[key]for key in ('bytes','sha256')}for name,value in base.items()}
    recipe={name:{'source':name,**meta}for name,meta in files.items()}
    for name,meta in files.items():assert metadata(ROOT/name)==meta,('old807 source drift',name)
    authority_raw=(RUNNER/'controller-design/authority-pins.json').read_bytes()
    assert digest(authority_raw)=='1c4259eec04b8a8c70e9316619fb725060060d635f0d2ca5ef11b227692fd9f2'
    for name,meta in json.loads(authority_raw)['files'].items():assert metadata(Path(name))==meta,('frozen component drift',name)
    inventory_raw=(RUNNER/'controller-design/regression-inventory/inventory.json').read_bytes()
    assert digest(inventory_raw)=='d99ff5e25b8c261411392594532a25e00484e2a6ea374851d6b6be72aea52bc6'
    inventory=json.loads(inventory_raw)

    def add(source,destination=None):
        source=Path(source)
        if not source.is_absolute():source=RUNNER/source
        destination=destination or PREFIX+'/'+str(source.relative_to(RUNNER))
        meta=metadata(source)
        assert destination not in files or files[destination]==meta,('source collision',destination)
        files[destination]=meta;recipe[destination]={'source':str(source.relative_to(ROOT)),**meta}
        return destination

    # Prospective read-only dependency extension. The original807/656 maps
    # remain unchanged; this fixed reviewed list is part of the new publication.
    dependencies=HERE/'publication-read-dependencies-v1.json'
    declaration=json.loads(dependencies.read_bytes())
    assert declaration['kind']=='portable-publication-read-dependencies-v1'
    for name,row in declaration['files'].items():
        assert metadata(ROOT/name)=={key:row[key]for key in ('bytes','sha256')}
        add(ROOT/name,name)
    add(dependencies)

    spec=importlib.util.spec_from_file_location('candidate_fixed_partition',RUNNER/'historical_partition.py')
    hp=importlib.util.module_from_spec(spec);spec.loader.exec_module(hp)
    for name,meta in hp.SOURCES.items():assert metadata(ROOT/name)==meta;add(ROOT/name,name)
    runner_members=[
        'results.py','worker.py','guard_report.py','pair_reader.py','transport.py','planner.py','source_copy.py',
        'run_accounting.py','output_observer.py','historical_partition.py','historical638_assertion.py',
        'historical638-route-v1.json','suite-plan.json','guard/launch_guard.py','guard/physical.py','guard/test_guard.py',
        'guard/policy/policy-envelope.json','guard/policy/child-routes.json','guard/policy/corrected-routing.json',
        'guard/policy/node-input-declaration.json','historical-boundary-draft/boundary_cases.py',
        'historical-boundary-draft/boundary-spec.json','historical-boundary-draft/mutation.py',
        'historical-boundary-draft/cases.json','historical-boundary-draft/test_boundary_cases.py','historical-boundary-draft/test_mutation.py',
        'parent-evidence-draft/parent_evidence.py','parent-evidence-draft/test_parent_evidence.py',
        'guarded-job-integration/guarded_job.py','guarded-job-integration/test_guarded_job.py',
        'regression-stage-integration/regression_core.py','regression-stage-integration/regression_parent.py',
        'regression-stage-integration/regression_worker.py','regression-stage-integration/finite_children.py',
        'regression-stage-integration/test_regression_core.py','regression-stage-integration/test_regression_parent.py',
        'tool-setup-integration/tool_admission.py','tool-setup-integration/tool_setup.py','tool-setup-integration/origin_probe.py',
        'tool-setup-integration/local-profile.json','tool-setup-integration/test_tool_setup.py',
        'controller-integration/controller.py','controller-integration/test_controller.py',
        'controller-integration/prospective-worker/worker.py','controller-integration/freeze_candidate.py',
        'controller-integration/entry-template.py',
        'controller-integration/regression-diagnostic-entry-template.py',
        'controller-integration/prospective-stored-adapter/portable_runtime_adapter_v2.py',
        'controller-integration/prospective-stored-adapter/source-pins-v2.json',
        'controller-integration/prospective-stored-adapter/worker.py',
        'controller-integration/prospective-stored-adapter/test_stored_adapter_v2.py',
        'controller-integration/prospective-stored-adapter/test_stored_adapter_v2_canonical.py',
        'controller-integration/prospective-stored-adapter/test_portable_runtime_adapter_v2_regression.py',
        'controller-integration/prospective-stored-adapter/lineage.json',
        'controller-integration/prospective-stored-adapter/source-ready-v2.json',
        'controller-integration/prospective-regression-stage/regression_worker.py',
        'controller-integration/prospective-regression-stage/source-ready-v2.json',
        'controller-integration/prospective-finite-children/finite_children_v2.py',
        'controller-integration/prospective-finite-children/source-ready-v2.json',
        'controller-integration/prospective-finite-children-v3/finite_children_v3.py',
        'controller-integration/prospective-finite-children-v3/source-ready-v3.json',
        'controller-integration/portable-regression-tests/test_guard.py',
        'controller-integration/portable-regression-tests/test_historical638_assertion.py',
        'controller-integration/portable-regression-tests/lineage.json',
    ]
    for name in runner_members:add(name)
    for item in inventory['suites']:
        source=ROOT/item['source'];assert metadata(source)['sha256']==item['sha256'],('old regression drift',source)
        add(source,ADAPTER+'/'+source.name if source.is_relative_to(OLD_ADAPTER)else None)
    for name in ('portable_runtime_adapter.py','source-pins.json','test_portable_runtime_adapter.py'):
        add(OLD_ADAPTER/name,ADAPTER+'/'+name)

    def destination(source):
        source=Path(source)
        return ADAPTER+'/'+source.name if source.is_relative_to(OLD_ADAPTER)else PREFIX+'/'+str(source.relative_to(RUNNER))
    regressions=[]
    profiles={'transport':'transport','historical-profile':'historical-profile'}
    for item in inventory['suites']:
        source=ROOT/item['source'];name=item['suite_id'];target=destination(source)
        if name=='guard':target=PREFIX+'/controller-integration/portable-regression-tests/test_guard.py'
        if name=='historical-profile':target=PREFIX+'/controller-integration/portable-regression-tests/test_historical638_assertion.py'
        if name=='stored-adapter':target=PREFIX+'/controller-integration/prospective-stored-adapter/test_portable_runtime_adapter_v2_regression.py'
        classes={row['name']:row['method_names']for row in item['classes']}
        ids=[identifier for row in item['classes']for identifier in row['stable_ids']]
        regressions.append({'job_id':'reg-'+name,'relative':target,'logical_id_path':item['logical_id_path'],
            'classes':classes,'expected_ids':ids,'classification':item['classification'],'child_profile':profiles.get(name),
            'import_roots':[PREFIX+'/guard']if name=='guard'else[]})
    additions=[
        ('parent-evidence','parent-evidence-draft/test_parent_evidence.py',None),
        ('guarded-job','guarded-job-integration/test_guarded_job.py','guarded-job'),
        ('regression-core','regression-stage-integration/test_regression_core.py',None),
        ('regression-parent','regression-stage-integration/test_regression_parent.py',None),
        ('tool-setup','tool-setup-integration/test_tool_setup.py','tool-setup'),
        ('controller','controller-integration/test_controller.py',None),
        ('stored-adapter-v2','controller-integration/prospective-stored-adapter/test_stored_adapter_v2_canonical.py',None),
    ]
    for name,source,child in additions:
        tree=ast.parse((RUNNER/source).read_bytes());classes={}
        for node in tree.body:
            if isinstance(node,ast.ClassDef) and any(isinstance(base,ast.Attribute)and isinstance(base.value,ast.Name)
                    and base.value.id=='unittest'and base.attr=='TestCase'for base in node.bases):
                methods=sorted(value.name for value in node.body if isinstance(value,ast.FunctionDef)and value.name.startswith('test_'))
                if methods:classes[node.name]=methods
        logical='implementation-regressions/'+source
        ids=[logical+'::'+cls+'.'+method for cls,methods in classes.items()for method in methods]
        assert ids
        regressions.append({'job_id':'reg-'+name,'relative':PREFIX+'/'+source,'logical_id_path':logical,
            'classes':classes,'expected_ids':ids,'classification':'finite_inert_child'if child else'process_free',
            'child_profile':child,'import_roots':[]})
    base_jobs=json.loads((RUNNER/'suite-plan.json').read_bytes())['jobs']
    guarded=[]
    for value in base_jobs:
        guarded.append({'job_id':value['job_id'],'profile':value['tree_profile'],
            'suite':{'kind':value['kind'],'tree_tag':'a2'if value['tree_profile']=='a2_669'else'current',
                **{key:value[key]for key in ('relative','classes','expected_ids','id_map')}},'partition':None})
    for ordinal in range(8):
        guarded.append({'job_id':'historical-'+str(ordinal),'profile':'stored638'if ordinal<5 else'a2_669',
            'suite':{'kind':'historical_boundary','tree_tag':'current','relative':hp.SUITE,'classes':[hp.CLASS],
                     'expected_ids':list(hp.ALL_IDS),'id_map':dict(zip(hp.SHORT_IDS,hp.ALL_IDS))},
            'partition':{'inventory_sha256':hp.INVENTORY_SHA,'all_ids':list(hp.ALL_IDS),
                         'selected_id':hp.ALL_IDS[ordinal],'ordinal':ordinal,'partitions':8}})
    subjects={'planner':'planner.py','partition':'historical_partition.py','source_copy':'source_copy.py','accounting':'run_accounting.py',
        'results':'results.py','output':'output_observer.py','pair_reader':'pair_reader.py','guard_report':'guard_report.py',
        'evidence':'parent-evidence-draft/parent_evidence.py','guarded_job':'guarded-job-integration/guarded_job.py',
        'guard':'guard/launch_guard.py','tool_admission':'tool-setup-integration/tool_admission.py',
        'regression_core':'regression-stage-integration/regression_core.py','regression_parent':'regression-stage-integration/regression_parent.py',
        'regression_policy':'controller-integration/prospective-finite-children-v3/finite_children_v3.py','regression_worker':'controller-integration/prospective-regression-stage/regression_worker.py',
        'transport':'transport.py','worker':'controller-integration/prospective-stored-adapter/worker.py','worker_contract':'controller-integration/prospective-stored-adapter/worker.py',
        'policy_routing':'guard/policy/corrected-routing.json','historical_route':'historical638-route-v1.json','historical_assertion':'historical638_assertion.py'}
    roles={key:PREFIX+'/'+value for key,value in subjects.items()}
    roles['historical_tree']='tests/controlled-drugs/harness/historical_tree.py'
    implementation_names=[roles[key]for key in ('worker','results','guard','guard_report','partition','tool_admission')]
    implementation_names.extend([PREFIX+'/guard/physical.py',
        PREFIX+'/controller-integration/prospective-stored-adapter/portable_runtime_adapter_v2.py',
        PREFIX+'/controller-integration/prospective-stored-adapter/source-pins-v2.json'])
    history=json.loads((ROOT/'tests/controlled-drugs/harness/historical-manifest.json').read_bytes())
    members={name:[history['files'][key]for key in value['paths']]for name,value in history['profiles'].items()}
    profile={'kind':'portable-controller-profile-v1','source_files':dict(sorted(files.items())),'roles':roles,
        'base_plan':PREFIX+'/suite-plan.json','guarded_jobs':guarded,'regression_jobs':regressions,'implementation_relative':PREFIX,
        'implementation_files':{name:files[name]for name in implementation_names},'historical_members':members,
        'resource':{'historical_peak_bytes':68563791,'scratch_bytes':1024**3,'auxiliary_files':
            ['copy.json','guarded-plan.json','guarded-index.json','guarded-summary.json','regression-index.json','regression-summary.json','result.json','failure.json'],
            'maximum_combined_ids':4096,'maximum_suites':96}}
    output=Path(output);output.mkdir(mode=0o700,exist_ok=False)
    for name,value in [('profile.json',profile),('assembly-recipe.json',dict(sorted(recipe.items())))]:
        with(output/name).open('x')as stream:stream.write(json.dumps(value,sort_keys=True,indent=2)+'\n')
        (output/name).chmod(0o600)
    print(json.dumps({'profile_sha256':digest((output/'profile.json').read_bytes()),'files':len(files),
        'source_bytes':sum(meta['bytes']for meta in files.values()),'guarded_jobs':len(guarded),'guarded_ids':927,
        'regression_jobs':len(regressions),'regression_ids':sum(len(row['expected_ids'])for row in regressions)}))


if __name__=='__main__':
    assert len(sys.argv)==2,'prospective output directory required (no runtime execution)'
    main(sys.argv[1])
