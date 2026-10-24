"""Explicit repository-relative source imports; no expected values from observations."""
import importlib
import importlib.util
from pathlib import Path
import sys

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[4]
CANDIDATE=ROOT/'tests/controlled-drugs/engine/candidate'
FIXED=ROOT/'tmp/a2-opening-adapter-draft/bootstrap188'
FIXTURE=ROOT/'tmp/a2-opening-adapter-draft/genuine-a2-fixtures'

def load(name,path):
    if name in sys.modules:
        module=sys.modules[name]
        origin=getattr(module,'__file__',None)
        assert isinstance(origin,(str,Path)) and Path(origin).resolve()==path.resolve(),'Module path collision: '+name
        return module
    spec=importlib.util.spec_from_file_location(name,path)
    module=importlib.util.module_from_spec(spec)
    sys.modules[name]=module
    try:spec.loader.exec_module(module)
    except BaseException:
        del sys.modules[name]
        raise
    return module

# The retained modules use these absolute names. Admit them before importing
# driver, never substitute their globals, and reject a preexisting other module.
previous=list(sys.path)
try:
    sys.path[:0]=[str(FIXED),str(CANDIDATE)]
    history_environment=load('history_environment',CANDIDATE/'history_environment.py')
    fixed_admission=load('admission',FIXED/'admission.py')
    fixed_fixtures=load('fixtures',FIXED/'fixtures.py')
    fixed_lifecycle=load('lifecycle',FIXED/'lifecycle.py')
    fixed_driver=load('a2_retained_fixed188_driver',FIXED/'driver.py')
    fixture=load('a2_genuine_fixture_values',FIXTURE/'fixtures.py')
    assembly=importlib.import_module('record_review_v3_gate_b_a2')
    bridge=importlib.import_module('record_review_v3_gate_b_runtime')
    capture=importlib.import_module('record_review_v3_gate_b_snapshot')
    owned=importlib.import_module('record_review_v3_gate_a_runtime')
    paused=importlib.import_module('record_review_v3_paused_bootstrap')
    for name,module in tuple(sys.modules.items()):
        path=getattr(module,'__file__',None)
        if path and (CANDIDATE/(name+'.py')).is_file():
            assert Path(path).resolve()==CANDIDATE/(name+'.py'),'Candidate module path collision: '+name
finally:sys.path[:]=previous
