"""Offline admission of a separately frozen configuration-input expectation.

Only the reviewed pure builder supplies expected metadata. The separate actual
reference is corroborating provenance and was unadmitted when executed. This
module grants no runtime, publication, Auth, protocol or clinical permission.
"""
import json
from pathlib import Path, PurePosixPath

import record_review_v3_configuration_profile as assembly

SOURCE = Path(__file__).resolve().parent
ROOT = SOURCE.parents[3]
WRAPPER_FILE = 'record_review_v3_configuration_expected.json'
WRAPPER_SHA256 = '10eba1a8691c9da14e6fe3f358a6f846c01e03c919741c7aaae6ad8ab9501116'
DEFINITION_SHA256 = '2b16f6a9a85e3d23733fc0e455356e6a6c78a288b19bade8807e045e2aba0525'
INSTALL_SHA256 = '617382409f4662586f06a788c9090bfa5a0191b7e7e64e221553adb406395316'
DERIVATION_MAP_SHA256 = 'dab2cf5f3e4e67891d979655990202482f024ae70285afe3f860f678c7ddfd0a'
KIND = 'record-review-v3-configuration-input-independent-expected-v1'
KEYS = {'kind','version','definition','definition_sha256','definition_source_sha256',
        'derivation_input_sha256','install_sha256','reference_provenance'}
PREFIX = 'tests/controlled-drugs/engine/candidate/'
DEFINITION_SOURCES = {PREFIX+name for name in (
    'record_review_v3_gate_a_descriptor.py','release-expected-204.json',
    'secondary_review_protocol_private_expected_v2.json',
    'record-review-v3-adapters-selectors.json','record-review-v3-adapters.sql',
    'record-review-v3-adapters-clinical.sql','record-review-v3-adapters-native.sql',
    'record-review-v3-adapters-context.sql','record-review-v3-configuration-profile.json',
    'record-review-v3-configuration-schema.sql','record-review-v3-configuration-input.sql',
    'record_review_v3_configuration_descriptor.py','record-review-v3-configuration-metadata.json')}
REFERENCE = {
    'kind':'private-configuration-input-reference-v1',
    'result_sha256':'5a898b29b6f8ce73eed94379384e22013d75427ba111b9392710e88dcfef7531',
    'independent_review_sha256':'302b8fa26648c522fe2b7e6474724067c1836c852fc595711b526d626a175757',
    'source_map_sha256':'b8599cfa5e2e68880cb88760c341c88b23f88a8cd8be4d82a3cbce653cc5bdb5',
    'source_input_count':614,'admitted_artifact_at_execution':False,
    'acceptance_at_execution':False,
    'scope':'Configuration-input metadata reference and556 finite diagnostic outcomes; no publication, Auth, protocol, calendar or clinical acceptance',
}


def validate_wrapper(value, package):
    """Strict semantic validation; callers use admit() for byte-pinned admission."""
    d=assembly.descriptor
    assert type(value) is dict and set(value)==KEYS,'Exact configuration wrapper keys required'
    assert value['kind']==KIND,'Exact configuration wrapper kind required'
    assert type(value['version']) is int and value['version']==1,'Exact configuration wrapper version required'
    assert value['definition_sha256']==DEFINITION_SHA256,'Fixed configuration definition pin required'
    assert d.sha(d.canonical(value['definition']).encode())==DEFINITION_SHA256,'Configuration definition bytes changed'
    assert value['definition']==package['expected'] and package['expected_sha256']==DEFINITION_SHA256,'Pure configuration definition regeneration differs'
    assert value['install_sha256']==package['install_sha256']==INSTALL_SHA256,'Reviewed configuration install changed'
    direct=value['definition_source_sha256']
    assert type(direct) is dict and set(direct)==DEFINITION_SOURCES,'Exact direct definition source keyset required'
    assert direct==package['source_hashes'],'Direct definition source hashes changed'
    inputs=value['derivation_input_sha256']
    assert type(inputs) is dict and len(inputs)==254,'Exact full254 derivation inventory required'
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
    root=Path(root).resolve()
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
    path=SOURCE/WRAPPER_FILE
    assert not path.is_symlink(),'Frozen wrapper symlinks refused'
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
    assert len(inputs)==256,'Exact package plus admission inventory required'
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
        definition_sha256=result['definition_sha256'],derivation_inputs=254,admission_inputs=256,
        admitted_artifact=True,acceptance=False,adapter_acceptance=False,auth_acceptance=False,
        publication_acceptance=False,protocol_behavior_claim=False,clinical_acceptance=False,
        runtime_authorized=False,database_operations=0)))
