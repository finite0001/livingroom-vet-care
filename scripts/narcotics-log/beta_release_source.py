"""Finite empty-count209 installer derived from the unchanged populated protocol."""
import argparse
import hashlib
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
ORIGINAL = HERE / 'operational_release.py'
CURRENT = HERE / 'beta_cold_release.py'
PROOF = HERE / 'beta-cold-release-source-proof.json'
OLD = """    controls=runtime.selected_query('historical-policy-grammar-controls',prefix.regular(HERE/'policy-reuse-controls.sql').decode())
    if controls!=dict(kind='historical-policy-grammar-controls-v1',cases=23,
            original_and_context_results_exact=True,captured_capability_decisions_recomputed=True,domain_writes=0,Auth_acceptance=False):
        raise ValueError('Exact original/context policy grammar controls required')
"""
NEW = """    cold=runtime.selected_query('cold209-empty-count-preflight',
        \"SELECT jsonb_build_object('policies',(SELECT count(*)FROM controlled_count_v1.policies),'snapshots',(SELECT count(*)FROM controlled_count_v1.snapshots));\")
    if cold!={'policies':0,'snapshots':0}:
        raise ValueError('Cold209 installation requires zero policies and snapshots; populated upgrades must use the original installer')
    business.save(target.evidence,'cold209-empty-count-preflight',cold)
    target.result['cold209_empty_count_preflight_verified']=True
"""
OLD_DOC = 'Upgrade only the captured owned populated project using the real CLI.'
NEW_DOC = 'Upgrade only a captured owned empty-count project using the real CLI.'


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def materialize(write=False):
    original = ORIGINAL.read_bytes()
    pinned = json.loads((HERE / 'operational-release.json').read_text())['source_files'][str(ORIGINAL.relative_to(ROOT))]
    if pinned != {'bytes': len(original), 'sha256': sha(original)}:
        raise ValueError('Exact original populated209 installer source required')
    text = original.decode()
    if text.count(OLD) != 1 or text.count(OLD_DOC) != 1:
        raise ValueError('One exact populated policy-control block required')
    current = text.replace(OLD, NEW, 1).replace(OLD_DOC, NEW_DOC, 1)
    if current.replace(NEW, OLD, 1).replace(NEW_DOC, OLD_DOC, 1) != text:
        raise ValueError('Whole original populated installer inverse required')
    proof = dict(kind='current-beta-empty-count209-source-v1', database_operations=0,
        original_sha256=sha(original), current_sha256=sha(current.encode()), whole_source_inverse=True,
        exact_empty_policy_and_snapshot_precondition=True, original_populated_installer_unchanged=True,
        original_CLI_ledger_metadata_rows_Auth_sequences_ingress_deadlines_cleanup_unchanged=True,
        genuine_policy_grammar_controls='Executed unchanged after genuine policy profiles; retained populated paths still run before upgrade')
    for path, raw in [(CURRENT,current.encode()),(PROOF,(json.dumps(proof,sort_keys=True,indent=2)+'\n').encode())]:
        if write: path.write_bytes(raw)
        elif not path.is_file() or path.read_bytes()!=raw:
            raise ValueError('Empty-count209 source differs: '+path.name)
    return proof


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    mode=parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--write-candidate',action='store_true')
    mode.add_argument('--check-source',action='store_true')
    args=parser.parse_args()
    print(json.dumps(materialize(args.write_candidate),sort_keys=True))
