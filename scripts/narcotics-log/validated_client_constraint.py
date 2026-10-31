"""Admit the exact original client CHECK before or after owner validation.

Only its catalog rendering is canonicalized. No constraint is altered, and no
observed database value supplies an expected definition or function fingerprint.
The whole source inverse recovers the reviewed PR315 migration byte for byte.
"""
import argparse
import hashlib
import json
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE))
import prefix_view as prefix
import compact_source_guard as compact
import compact_descriptor as descriptor
import receipt_owner_budget as receipt
MIGRATION = "20261027223544_narcotics_count_and_stock_workflows.sql"
ORIGINAL_SQL_SHA = "779e805a63a256623d4b325f8a91924cbb8dcf69e6d8b6c59613c20f96b37dbb"
ORIGINAL_BODY_SHA = "a6c53c7bfac89889056f30d45273bdbf545493bfab1c1019d49daea1465580f8"
STATIC = {
    "module-expected.json": "8e7da988a6dc73bec764e8e7f5c9d333aeeb497647772e6ec67133987f94fe06",
    "module-source-expected.sql": "b517ab6917a799934ca64d077b556b18775a87eae69d39a7e391739c9230607f",
}
HEADER = "CREATE FUNCTION controlled_count_entry_v1.module_ordinary_relations()"
OLD = "pg_get_constraintdef(k.oid, TRUE)"
DEFINITION = "CHECK (client_contacts_complete(primary_phone, primary_email))"
NEW = ("CASE WHEN c.relname = 'clients' AND k.conname = 'clients_required_contacts_check' "
       "AND k.contype = 'c' AND k.convalidated AND " + OLD + " = '" + DEFINITION + "' "
       "THEN '" + DEFINITION + " NOT VALID' ELSE " + OLD + " END")
OLD_DIAGNOSTIC = "WHERE jsonb_typeof(fixture_diffs.actual_value)='object' AND jsonb_typeof(fixture_diffs.expected_value)='object'"
NEW_DIAGNOSTIC = OLD_DIAGNOSTIC + " AND fixture_diffs.actual_value::text IS DISTINCT FROM fixture_diffs.expected_value::text"


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def replace_once(text, before, after):
    if text.count(before) != 1:
        raise ValueError("One exact source anchor required")
    return text.replace(before, after, 1)


def body(text):
    if text.count(HEADER) != 1:
        raise ValueError("Exactly one original metadata getter required")
    start = text.index(" AS $$", text.index(HEADER)) + len(" AS $$")
    end = text.index("$$;", start)
    return text[start:end]


def canonical(raw):
    raw = receipt.canonical(raw)
    raw = descriptor.canonical(raw)
    raw = compact.canonical(raw)
    if sha(raw) == ORIGINAL_SQL_SHA:
        return raw
    text = raw.decode("utf-8", errors="strict")
    current = body(text)
    original = replace_once(current, NEW, OLD)
    if sha(original.encode()) != ORIGINAL_BODY_SHA:
        raise ValueError("Whole original getter body inverse required")
    current_hash = sha(current.encode())
    if text.count(current_hash) != 3:
        raise ValueError("All three source-literal getter fingerprints required")
    restored = replace_once(text, current, original).replace(current_hash, ORIGINAL_BODY_SHA)
    restored = replace_once(restored, NEW_DIAGNOSTIC, OLD_DIAGNOSTIC).encode()
    if sha(restored) != ORIGINAL_SQL_SHA:
        raise ValueError("Complete original migration inverse required")
    return restored


def derive(raw):
    original = canonical(raw).decode()
    before = body(original)
    if sha(before.encode()) != ORIGINAL_BODY_SHA:
        raise ValueError("Original metadata getter fingerprint required")
    after = replace_once(before, OLD, NEW)
    after_hash = sha(after.encode())
    result = replace_once(original, before, after)
    if result.count(ORIGINAL_BODY_SHA) != 3:
        raise ValueError("Exact original source fingerprint inventory required")
    result = result.replace(ORIGINAL_BODY_SHA, after_hash)
    result = replace_once(result, OLD_DIAGNOSTIC, NEW_DIAGNOSTIC).encode()
    if canonical(result) != original.encode():
        raise ValueError("Whole source inverse failed")
    return receipt.derive(descriptor.derive(compact.derive(result))), after_hash


def materialize(write=False):
    path = ROOT / "supabase/migrations" / MIGRATION
    result, fingerprint = derive(prefix.regular(path))
    outputs = {path: result}
    for name, expected in STATIC.items():
        data = prefix.regular(HERE / name)
        if data.count(fingerprint.encode()) == 1:
            data = data.replace(fingerprint.encode(), ORIGINAL_BODY_SHA.encode(), 1)
        if sha(data) != expected or data.count(ORIGINAL_BODY_SHA.encode()) != 1:
            raise ValueError("Unrelated source metadata cannot change")
        outputs[HERE / name] = data.replace(ORIGINAL_BODY_SHA.encode(), fingerprint.encode(), 1)
    proof = dict(kind="validated-client-constraint-source-variant-v1", original_source_sha256=ORIGINAL_SQL_SHA,
                 variant_source_sha256=sha(result), original_body_sha256=ORIGINAL_BODY_SHA,
                 variant_body_sha256=fingerprint, whole_source_inverse=True,
                 scope="public.clients.clients_required_contacts_check", expression=DEFINITION,
                 admitted_validation_states=[False, True], constraint_DDL_changes=0,
                 history_rewrites=0, permission_changes=0, limits_changed=True,
                 installed_values_used_as_expectations=False, equal_diagnostic_subtrees_pruned=True)
    proof['source_guard_literals_compacted'] = True
    proof['descriptor_literals_compacted'] = True
    proof['application_limits_changed'] = False
    proof['migration_receipt_limit_seconds'] = receipt.SECONDS
    outputs[HERE / "validated-client-constraint-proof.json"] = (json.dumps(proof, sort_keys=True, indent=2) + "\n").encode()
    for target, value in outputs.items():
        existing = prefix.regular(target) if target.exists() or target.is_symlink() else None
        if write:
            target.write_bytes(value)
        elif existing != value:
            raise ValueError("Validated-client source artifact differs: " + target.name)
    if write:
        candidate = json.loads(prefix.regular(HERE / "release-candidate.json"))
        candidate["migrations"][MIGRATION] = {"bytes": len(result), "sha256": sha(result)}
        (HERE / "release-candidate.json").write_text(json.dumps(candidate, sort_keys=True, indent=2) + "\n")
        data = json.loads(prefix.regular(HERE / "proof-data-pins.json"))
        for name in STATIC:
            value = outputs[HERE / name]
            data["files"][name] = {"bytes": len(value), "sha256": sha(value)}
        (HERE / "proof-data-pins.json").write_text(json.dumps(data, sort_keys=True, indent=2) + "\n")
    return proof


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--write-candidate", action="store_true")
    mode.add_argument("--check-source", action="store_true")
    args = parser.parse_args()
    print(json.dumps(materialize(write=args.write_candidate), sort_keys=True))
