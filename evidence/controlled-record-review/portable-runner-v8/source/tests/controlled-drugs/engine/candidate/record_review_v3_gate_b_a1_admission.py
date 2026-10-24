"""Admit the independently frozen A1 Gate-B expectation, offline only.

The original candidate builder remains byte-for-byte unchanged. This module
checks a fixed wrapper, its full source closure, and pure regeneration. Reference
hashes corroborate the independent derivation; no observed catalog is an input.
Admission here authorizes no runtime, app permission, signing or clinical use.
"""
import json
from pathlib import Path, PurePosixPath

import record_review_v3_gate_b as assembly

SOURCE = Path(__file__).resolve().parent
WRAPPER_FILE = 'record_review_v3_gate_b_a1_expected.json'
WRAPPER_SHA256 = '35ebe7d2cbb374fdeb73c34106bdb11af3f22ee058e64013d47e67db81defa93'
DEFINITION_SHA256 = '17df4505f964f02314eb5524c896041076d8f30f1f5b437d95bb14af23459447'
INSTALL_SHA256 = 'eb591816d79cf06a980648dccecb7f556866bfc5e0490a95ba34cb461ed8214f'
DERIVATION_MAP_SHA256 = '2380f99699bbe3b3c3a97714ca01dc4f0eea0a233e87056f43ef962b763ac43d'
KIND = 'record-review-v3-gate-b-a1-independent-expected-v1'
KEYS = {'kind','version','definition','definition_sha256','definition_source_sha256',
        'derivation_input_sha256','install_sha256','reference_provenance'}
DEFINITION_SOURCES = {'record-review-v3-adapters-clinical.sql',
                      'record-review-v3-adapters-context.sql',
                      'record-review-v3-adapters-native.sql',
                      'record-review-v3-adapters-selectors.json',
                      'record-review-v3-adapters.sql',
                      'record-review-v3-schema.sql',
                      'record_review_v3_gate_a_descriptor.py',
                      'record_review_v3_gate_b_descriptor.py',
                      'release-expected-204.json',
                      'secondary_review_protocol_private_expected_v2.json'}
REFERENCE = {'kind': 'record-review-v3-gate-b-reference-v1', 'result_sha256': 'bf9900356a520b117c92d83d8bc4fb9af6e7bc6291cc83920884ce12c2876e8d', 'independent_review_sha256': 'c4c22addd24fe571f48c999b9d16b1f71caa95078c34a22e40f387d14c249d83', 'source_map_sha256': 'c9424e79f615a226df80c0facf185b28da1218628a80924efe9936c7b5074c0f', 'source_input_count': 597, 'scope': 'A1 metadata reference,33 genuine cases and22 faults/44 privileged integrity refusals; no full adapter, Auth or protocol acceptance'}


def validate_wrapper(value, package):
    """Validate semantics independently of the outer file-byte pin.

    Public for focused negative tests. Runtime callers must use admit(), which
    checks the fixed file hash and reads/rebuilds all source inputs itself.
    """
    d = assembly.descriptor
    assert type(value) is dict and set(value)==KEYS, 'Exact Gate B A1 wrapper keys required'
    assert value['kind']==KIND, 'Exact Gate B A1 wrapper kind required'
    assert type(value['version']) is int and value['version']==1, 'Exact Gate B A1 wrapper version required'
    assert value['definition_sha256']==DEFINITION_SHA256, 'Fixed Gate B A1 definition pin required'
    assert d.sha(d.canonical(value['definition']).encode())==DEFINITION_SHA256, 'Gate B A1 definition bytes changed'
    assert value['definition']==package['expected'] and package['expected_sha256']==DEFINITION_SHA256, 'Pure Gate B A1 definition regeneration differs'
    assert value['install_sha256']==package['install_sha256']==INSTALL_SHA256, 'Reviewed Gate B A1 install changed'
    direct=value['definition_source_sha256']
    assert type(direct) is dict and set(direct)==DEFINITION_SOURCES, 'Exact direct definition source keyset required'
    assert direct==package['source_hashes'], 'Direct definition source hashes changed'
    inputs=value['derivation_input_sha256']
    assert type(inputs) is dict and len(inputs)==246, 'Exact full246 derivation inventory required'
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
    assert d.sha(raw)==WRAPPER_SHA256, 'Fixed Gate B A1 wrapper file pin required'
    value=json.loads(raw,object_pairs_hook=d.unique)
    package=assembly.build(source)
    validate_wrapper(value,package)
    # Verify the ENTIRE keyset through equality above, then every exact byte.
    # These are frozen sources, not a current catalog captured as expectations.
    for relative,digest in value['derivation_input_sha256'].items():
        assert d.sha((root/relative).read_bytes())==digest, 'Frozen Gate B A1 derivation source bytes changed: '+relative
    for name,digest in value['definition_source_sha256'].items():
        assert d.sha((source/name).read_bytes())==digest, 'Frozen direct definition bytes changed: '+name
    inputs=dict(value['derivation_input_sha256'])
    for path in (source/WRAPPER_FILE,source/Path(__file__).name):
        inputs[str(path.relative_to(root))]=d.sha(path.read_bytes())
    assert len(inputs)==248, 'Exact package plus admission inventory required'
    return dict(expected=value['definition'],wrapper_sha256=WRAPPER_SHA256,
        definition_sha256=DEFINITION_SHA256,definition_source_sha256=value['definition_source_sha256'],
        derivation_input_sha256=value['derivation_input_sha256'],input_source_hashes=inputs,
        reference_provenance=value['reference_provenance'],package=package,
        admitted_artifact=True,acceptance=False,adapter_acceptance=False,auth_acceptance=False,protocol_behavior_claim=False)


if __name__=='__main__':
    result=admit()
    print(assembly.descriptor.canonical(dict(kind=KIND,wrapper_sha256=result['wrapper_sha256'],
        definition_sha256=result['definition_sha256'],derivation_inputs=len(result['derivation_input_sha256']),
        admission_inputs=len(result['input_source_hashes']),admitted_artifact=True,acceptance=False,
        adapter_acceptance=False,auth_acceptance=False,
        protocol_behavior_claim=False,database_operations=0)))
