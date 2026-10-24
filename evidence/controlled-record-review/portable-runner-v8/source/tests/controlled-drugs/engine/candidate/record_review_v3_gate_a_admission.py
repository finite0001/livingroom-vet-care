"""Admit the independently frozen STRUCTURAL Gate-A expectation, offline only.

The original candidate builder remains byte-for-byte unchanged. This module
checks a fixed wrapper, its full source closure, and pure regeneration. Reference
hashes corroborate the independent derivation; no observed catalog is an input.
Admission here authorizes no runtime, app permission, signing or clinical use.
"""
import json
from pathlib import Path, PurePosixPath

import record_review_v3_gate_a as assembly

SOURCE = Path(__file__).resolve().parent
WRAPPER_FILE = 'record_review_v3_gate_a_expected.json'
WRAPPER_SHA256 = '078ea45623d162f1f4d6a3f0c983110e153127fffa77b560c2a52619ba064711'
DEFINITION_SHA256 = '9f2228423a6807352d25784f9ebd94d1920f310228d89618577c4b5d977dbc45'
INSTALL_SHA256 = '11418378a62fa1d5440e0b36b88659fbfb7792a5015de665d9bfdd7ac760d9b2'
DERIVATION_MAP_SHA256 = 'c76922cd990a7bc669aedb388f3465f8dabf7227b182b8cc1b5d4c3017141e46'
KIND = 'record-review-v3-gate-a-independent-expected-v1'
KEYS = {'kind','version','definition','definition_sha256','definition_source_sha256',
        'derivation_input_sha256','install_sha256','reference_provenance'}
DEFINITION_SOURCES = {'record-review-v3-gate-a.sql','record_review_v3_gate_a_descriptor.py',
                      'release-expected-204.json','secondary_review_protocol_private_expected_v2.json'}
REFERENCE = dict(kind='record-review-v3-gate-a-reference-v1',
    result_sha256='25d55adc5951d4aef8d4235032a8771aa884637a99a26b3531d2874069876a39',
    independent_review_sha256='84a674f47a0e8d252089c0fba2887b7feaf08444a24b73117c8ee49c7093e64c',
    source_map_sha256='90284cc9a2ef68c52ac2562616bd120526a44403c440d1071567b976686d8695',
    source_input_count=561,
    scope='empty-operational structural reference; no protocol behavior or acceptance claim')


def validate_wrapper(value, package):
    """Validate semantics independently of the outer file-byte pin.

    Public for focused negative tests. Runtime callers must use admit(), which
    checks the fixed file hash and reads/rebuilds all source inputs itself.
    """
    d = assembly.descriptor
    assert type(value) is dict and set(value)==KEYS, 'Exact Gate A wrapper keys required'
    assert value['kind']==KIND, 'Exact Gate A wrapper kind required'
    assert type(value['version']) is int and value['version']==1, 'Exact Gate A wrapper version required'
    assert value['definition_sha256']==DEFINITION_SHA256, 'Fixed Gate A definition pin required'
    assert d.sha(d.canonical(value['definition']).encode())==DEFINITION_SHA256, 'Gate A definition bytes changed'
    assert value['definition']==package['expected'] and package['expected_sha256']==DEFINITION_SHA256, 'Pure Gate A definition regeneration differs'
    assert value['install_sha256']==package['install_sha256']==INSTALL_SHA256, 'Reviewed Gate A install changed'
    direct=value['definition_source_sha256']
    assert type(direct) is dict and set(direct)==DEFINITION_SOURCES, 'Exact direct definition source keyset required'
    assert direct==package['source_hashes'], 'Direct definition source hashes changed'
    inputs=value['derivation_input_sha256']
    assert type(inputs) is dict and len(inputs)==235, 'Exact full235 derivation inventory required'
    assert inputs==package['input_source_hashes'], 'Full derivation source keyset or hashes changed'
    assert d.sha(d.canonical(inputs).encode())==DERIVATION_MAP_SHA256, 'Fixed full derivation map pin required'
    for name,digest in inputs.items():
        path=PurePosixPath(name)
        assert not path.is_absolute() and str(path)==name and '..' not in path.parts, 'Canonical relative source path required'
        assert type(digest) is str and len(digest)==64 and all(c in '0123456789abcdef' for c in digest), 'Source SHA256 required'
        assert path.name not in (WRAPPER_FILE,Path(__file__).name), 'Frozen derivation must not hash itself or admission'
    assert value['reference_provenance']==REFERENCE, 'Exact separate reference provenance required'
    assert type(value['reference_provenance']['source_input_count']) is int, 'Reference inventory count must be an integer'
    return value


def admit(source=SOURCE):
    """Return fixed expected metadata plus complete package/admission bindings."""
    source=Path(source).resolve()
    root=source.parents[3]
    d=assembly.descriptor
    raw=(source/WRAPPER_FILE).read_bytes()
    assert d.sha(raw)==WRAPPER_SHA256, 'Fixed Gate A wrapper file pin required'
    value=json.loads(raw,object_pairs_hook=d.unique)
    package=assembly.build(source)
    validate_wrapper(value,package)
    # Verify the ENTIRE keyset through equality above, then every exact byte.
    # These are frozen sources, not a current catalog captured as expectations.
    for relative,digest in value['derivation_input_sha256'].items():
        assert d.sha((root/relative).read_bytes())==digest, 'Frozen Gate A derivation source bytes changed: '+relative
    for name,digest in value['definition_source_sha256'].items():
        assert d.sha((source/name).read_bytes())==digest, 'Frozen direct definition bytes changed: '+name
    inputs=dict(value['derivation_input_sha256'])
    for path in (source/WRAPPER_FILE,source/Path(__file__).name):
        inputs[str(path.relative_to(root))]=d.sha(path.read_bytes())
    assert len(inputs)==237, 'Exact package plus admission inventory required'
    return dict(expected=value['definition'],wrapper_sha256=WRAPPER_SHA256,
        definition_sha256=DEFINITION_SHA256,definition_source_sha256=value['definition_source_sha256'],
        derivation_input_sha256=value['derivation_input_sha256'],input_source_hashes=inputs,
        reference_provenance=value['reference_provenance'],package=package,
        admitted_artifact=True,acceptance=False,protocol_behavior_claim=False)


if __name__=='__main__':
    result=admit()
    print(assembly.descriptor.canonical(dict(kind=KIND,wrapper_sha256=result['wrapper_sha256'],
        definition_sha256=result['definition_sha256'],derivation_inputs=len(result['derivation_input_sha256']),
        admission_inputs=len(result['input_source_hashes']),admitted_artifact=True,acceptance=False,
        protocol_behavior_claim=False,database_operations=0)))
