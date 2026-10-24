"""Offline admission of a separately frozen stored-configuration expectation.

Only the reviewed pure builder supplies expected metadata. The separate actual
reference is corroborating provenance and was unadmitted when executed. This
module grants no runtime, publication, Auth, protocol or clinical permission.
"""
import json
from pathlib import Path, PurePosixPath

import sys

MODULE_FILE = Path(__file__).absolute()
SOURCE = MODULE_FILE.parent
ROOT = SOURCE.parents[3] if SOURCE.name == 'candidate' else SOURCE.parents[2]
CANDIDATE = ROOT/'tests/controlled-drugs/engine/candidate'
_previous_path = list(sys.path)
try:
    sys.path.insert(0,str(CANDIDATE))
    import record_review_v3_configuration_record_profile as assembly
finally:
    sys.path[:] = _previous_path
WRAPPER_FILE = 'record_review_v3_configuration_record_expected.json'
WRAPPER_SHA256 = 'a04712e3c1819d1903c6e0a2e2ede1453b13a0456e9f7fccb43712381c12bea2'
DEFINITION_SHA256 = 'fec2ff871f064a124ae3a0fb5ba60e36b8b58dda1932393cd656c43cd68abd7d'
INSTALL_SHA256 = '22021a314fc196efa822a16ca30d25c7f9f6e70811703fe60eb747d92280d542'
DERIVATION_MAP_SHA256 = '7396e3bcd7acf5d167a954a615e5e95e76bfee68df3f1c69ce317618e5af8078'
KIND = 'record-review-v3-configuration-record-independent-expected-v1'
KEYS = {'kind','version','definition','definition_sha256','definition_source_sha256',
        'derivation_input_sha256','install_sha256','reference_provenance'}
PREFIX = 'tests/controlled-drugs/engine/candidate/'
DEFINITION_SOURCES = {
    'tests/controlled-drugs/engine/candidate/helpers.sql',
    'tests/controlled-drugs/engine/candidate/record-review-v3-adapters-clinical.sql',
    'tests/controlled-drugs/engine/candidate/record-review-v3-adapters-context.sql',
    'tests/controlled-drugs/engine/candidate/record-review-v3-adapters-native.sql',
    'tests/controlled-drugs/engine/candidate/record-review-v3-adapters-selectors.json',
    'tests/controlled-drugs/engine/candidate/record-review-v3-adapters.sql',
    'tests/controlled-drugs/engine/candidate/record-review-v3-calendar-observation.sql',
    'tests/controlled-drugs/engine/candidate/record-review-v3-configuration-input.sql',
    'tests/controlled-drugs/engine/candidate/record-review-v3-configuration-pair.sql',
    'tests/controlled-drugs/engine/candidate/record-review-v3-configuration-record-metadata.json',
    'tests/controlled-drugs/engine/candidate/record-review-v3-configuration-record-profile.json',
    'tests/controlled-drugs/engine/candidate/record-review-v3-configuration-record-projection.sql',
    'tests/controlled-drugs/engine/candidate/record-review-v3-configuration-record-schema.sql',
    'tests/controlled-drugs/engine/candidate/record-review-v3-configuration-record-value.sql',
    'tests/controlled-drugs/engine/candidate/record-review-v3-stored-configuration.sql',
    'tests/controlled-drugs/engine/candidate/record_review_v3_configuration_record_descriptor.py',
    'tests/controlled-drugs/engine/candidate/record_review_v3_gate_a_descriptor.py',
    'tests/controlled-drugs/engine/candidate/release-expected-204.json',
    'tests/controlled-drugs/engine/candidate/secondary_review_protocol_private_expected_v2.json',
}
REFERENCE = {'acceptance_at_execution': False,
 'admitted_artifact_at_execution': False,
 'finite_outcomes': 1727,
 'independent_review_sha256': '0cccc0d963f966e1135c18b798043869f3d46147ed431878f28013f3488cae58',
 'kind': 'private-stored-configuration-reference-v1',
 'result_sha256': 'c479e73fcc0186ba8e2ab2ab86f1e547ca56827bafd28f8b329d24c25c5313a6',
 'scope': 'Stored-configuration metadata reference and1727 finite diagnostic outcomes; no exhaustive '
          'coverage, isolated byte-guard proof, origin, publication, live-reference, Auth, HTTP, '
          'protocol or clinical acceptance',
 'source_input_count': 761,
 'source_map_sha256': '904f074ddb70726d47adb0f04f5e5c623632fe0ec79bd5dfddbb050af39115c0',
 'target_cases': 1594,
 'target_refusals': 1390,
 'target_successes': 204}


def validate_wrapper(value, package):
    """Strict semantic validation; callers use admit() for byte-pinned admission."""
    d=assembly.descriptor
    assert type(value) is dict and set(value)==KEYS,'Exact configuration wrapper keys required'
    assert value['kind']==KIND,'Exact configuration wrapper kind required'
    assert type(value['version']) is int and value['version']==1,'Exact configuration wrapper version required'
    assert value['definition_sha256']==DEFINITION_SHA256,'Fixed configuration definition pin required'
    assert d.sha(d.canonical(value['definition']).encode())==DEFINITION_SHA256,'Configuration definition bytes changed'
    assert d.canonical(value['definition'])==d.canonical(package['expected']) and package['expected_sha256']==DEFINITION_SHA256,'Pure configuration definition regeneration differs'
    assert value['install_sha256']==package['install_sha256']==INSTALL_SHA256,'Reviewed configuration install changed'
    assert type(package['install'])is str and d.sha(package['install'].encode())==INSTALL_SHA256,'Pure install bytes changed'
    direct=value['definition_source_sha256']
    assert type(direct) is dict and set(direct)==DEFINITION_SOURCES,'Exact direct definition source keyset required'
    assert direct==package['source_hashes'],'Direct definition source hashes changed'
    inputs=value['derivation_input_sha256']
    assert type(inputs) is dict and len(inputs)==267,'Exact full267 derivation inventory required'
    assert inputs==package['input_source_hashes'],'Full derivation source keyset or hashes changed'
    assert d.sha(d.canonical(inputs).encode())==DERIVATION_MAP_SHA256,'Fixed full derivation map pin required'
    assert all(inputs.get(name)==digest for name,digest in direct.items()),'Direct sources must be bound in full derivation'
    for name,digest in inputs.items():
        path=PurePosixPath(name)
        assert not path.is_absolute() and str(path)==name and '..' not in path.parts and name,'Canonical relative source path required'
        assert type(digest) is str and len(digest)==64 and all(c in '0123456789abcdef' for c in digest),'Source SHA256 required'
        assert path.name not in (WRAPPER_FILE,Path(__file__).name),'Frozen derivation must not hash itself or admission'
    # Canonical JSON equality distinguishes booleans, integers and float spellings.
    assert d.canonical(value['reference_provenance'])==d.canonical(REFERENCE),'Exact separate reference provenance required'
    return value


def decode_wrapper(raw):
    """Reject changed file bytes and duplicate keys before pure regeneration."""
    assert assembly.descriptor.sha(raw)==WRAPPER_SHA256,'Fixed configuration wrapper file pin required'
    return json.loads(raw,object_pairs_hook=assembly.descriptor.unique)


def validate_source_bytes(root, inputs):
    """Check every admitted source byte; isolated-copy tests use this same path."""
    root=Path(root)
    assert not root.is_symlink(),'Frozen source root symlinks refused'
    root=root.resolve()
    for relative,digest in inputs.items():
        path=PurePosixPath(relative)
        assert not path.is_absolute() and str(path)==relative and '..' not in path.parts and relative,'Canonical relative source path required'
        current=root
        for part in path.parts:
            current=current/part
            assert not current.is_symlink(),'Frozen source symlinks refused'
        assert current.is_file(),'Frozen source file required: '+relative
        assert assembly.descriptor.sha(current.read_bytes())==digest,'Frozen configuration derivation source bytes changed: '+relative


def admit():
    """Fixed candidate root, no arbitrary source/runtime argument or live access."""
    assert SOURCE==CANDIDATE and MODULE_FILE.name=='record_review_v3_configuration_record_admission.py','Private draft cannot admit; reviewed canonical relocation required'
    path=SOURCE/WRAPPER_FILE
    validate_source_bytes(ROOT,{str(path.relative_to(ROOT)):WRAPPER_SHA256})
    validate_source_bytes(ROOT,{str(MODULE_FILE.relative_to(ROOT)):assembly.descriptor.sha(MODULE_FILE.read_bytes())})
    value=decode_wrapper(path.read_bytes())
    package=assembly.build()
    validate_wrapper(value,package)
    validate_source_bytes(ROOT,value['derivation_input_sha256'])
    inputs=dict(value['derivation_input_sha256'])
    for path in (SOURCE/WRAPPER_FILE,Path(__file__)):
        assert not path.is_symlink() and path.is_file(),'Regular admission files required'
        name=str(path.relative_to(ROOT))
        assert name not in inputs,'Admission source collision'
        inputs[name]=assembly.descriptor.sha(path.read_bytes())
    assert len(inputs)==269,'Exact package plus admission inventory required'
    return dict(expected=value['definition'],wrapper_sha256=WRAPPER_SHA256,
        definition_sha256=DEFINITION_SHA256,definition_source_sha256=value['definition_source_sha256'],
        derivation_input_sha256=value['derivation_input_sha256'],input_source_hashes=inputs,
        reference_provenance=value['reference_provenance'],package=package,
        admitted_artifact=True,acceptance=False,adapter_acceptance=False,auth_acceptance=False,
        publication_acceptance=False,protocol_behavior_claim=False,clinical_acceptance=False,
        runtime_authorized=False,hosted_writes=0,database_operations=0)


if __name__=='__main__':
    import sys
    assert len(sys.argv)==1,'No runtime or arbitrary source options'
    result=admit()
    print(assembly.descriptor.canonical(dict(kind=KIND,wrapper_sha256=result['wrapper_sha256'],
        definition_sha256=result['definition_sha256'],derivation_inputs=267,admission_inputs=269,
        admitted_artifact=True,acceptance=False,adapter_acceptance=False,auth_acceptance=False,
        publication_acceptance=False,protocol_behavior_claim=False,clinical_acceptance=False,
        runtime_authorized=False,database_operations=0)))
