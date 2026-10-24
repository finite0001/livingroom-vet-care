"""Pure fixed188 derivation; no observed catalog, prefix option or network."""
import hashlib
import json
from pathlib import Path
import sys

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[2]
SOURCE=ROOT/'tests/controlled-drugs/engine/candidate'
sys.path.insert(0,str(SOURCE))
import canonical_review_prefix as canonical206
import secondary_review_ledger as frozen205
import record_review_v3_gate_b as package206
import record_review_v3_gate_b_a1_admission as frozen_a1
import record_review_v3_gate_a_runtime as retained

EXPECTED_SHA='bb8ae5a11d9caa5610e349c8a0b06310fa5e4e26ac743d896befc55bcfa86f73'
LEDGER_SHA='42f3609d0b2efe00b70f01427ea0a1b7dd414148b5e0e9427509d4782946bc8d'
OWN_FILES=('admission.py','lifecycle.py','driver.py','fixtures.py','fixture.sql','oracle.sql',
           'test_bootstrap188.py','expected-188-ledger.json','declaration.json')
END188='20261015020722_stock_writer_provenance.sql'
FIRST189='20261015055007_native_custody_provenance.sql'
END206='20261022010000_controlled_secondary_review_private.sql'

def sha(raw):return hashlib.sha256(raw).hexdigest()
def canonical(value):return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=True)
def unique(pairs):
    result={}
    for key,value in pairs:
        assert key not in result,'Duplicate declaration field'
        result[key]=value
    return result

def build():
    files=sorted((ROOT/'supabase/migrations').glob('*.sql'))
    admitted=canonical206.admit_canonical206(SOURCE,files)
    frozen_a1.admit(SOURCE)
    old=frozen205.load_frozen(SOURCE)
    raw=(HERE/'expected-188-ledger.json').read_bytes()
    assert sha(raw)==EXPECTED_SHA,'Independent fixed188 artifact changed'
    expected=json.loads(raw,object_pairs_hook=unique)
    assert set(expected)=={'kind','parent_frozen205_file_sha256','prefix_files','expected_ledger188'}
    assert expected['kind']=='private-fixed188-independent-ledger-v1'
    assert expected['parent_frozen205_file_sha256']==frozen205.LEDGER_SHA256
    rows=expected['expected_ledger188']
    assert len(rows)==188 and rows==old['ledger'][:188] and sha(canonical(rows).encode())==LEDGER_SHA
    assert len(files)==206 and files[187].name==END188 and files[188].name==FIRST189 and files[-1].name==END206
    prefix={p.name:sha(p.read_bytes()) for p in files[:188]}
    assert prefix==expected['prefix_files']
    package=package206.build(SOURCE)
    assert package['canonical206_binding']==admitted['binding206']
    assert package['expected_ledger206'][:188]==rows
    return dict(package=package,files=files,expected188=rows,prefix=prefix,
                suffix={p.name:sha(p.read_bytes()) for p in files[188:]},artifact_sha256=EXPECTED_SHA)

def inputs():
    values=retained.source_inputs()
    actual={p.name for p in HERE.iterdir() if p.is_file() and p.suffix in ('.py','.sql','.json')}
    assert actual==set(OWN_FILES),'Private executed source inventory differs'
    for name in OWN_FILES:
        path=HERE/name
        assert not path.is_symlink() and path.is_file()
        key=str(path.relative_to(ROOT));assert key not in values
        values[key]=sha(path.read_bytes())
    return values

def check_inputs(values):
    assert inputs()==values,'Complete executed input keyset or bytes changed'
