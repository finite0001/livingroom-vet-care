"""Finite historical receipt encodings derived only from frozen source files.

The CLI records its parsed statement vector. The managed migration transport
can record the complete authored SQL as one statement. Both encodings preserve
the original SQL; neither permits rewriting a stored historical receipt.
"""
import hashlib
import json
from pathlib import Path
import re
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
import prefix_view as prefix

FROZEN_LEDGER_SHA = "73aa7156bebcf869a37a9f5047842c11a46079145d05674790f81d5d9da2f7f4"
PAYMENT_VERSION = "20260913900000"
FORWARD_NAME = "20261027223535_controlled_record_review_workflows.sql"
FORWARD_ORIGINAL_SHA = "0f1330e8b9bb77043e5ed878492b6d2dfa35e2ca5c288fb6ca92df72476b92af"
HOSTED_FRAMING_SHA = "65655b8d062f8c155e7e52e34b6bd9998d1ca96d45d992783470286bc4fc0638"
ROW = re.compile(
    r"^do \$review_ledger\$ begin if \(select to_jsonb\(m\)from supabase_migrations.schema_migrations m where version='([0-9]+)'\)"
    r"is distinct from '((?:''|[^'])*)'::jsonb then raise exception 'Secondary-review exact205 ledger row mismatch' using errcode='23514';end if;end \$review_ledger\$;$", re.M,
)
FORWARD_ROW = re.compile(
    r"^do \$record_review_v3_gate_b_ledger\$ begin if \(select to_jsonb\(m\)from supabase_migrations.schema_migrations m where version='([0-9]+)'\)"
    r"is distinct from '((?:''|[^'])*)'::jsonb then raise exception 'Record-review v3 exact206 ledger row mismatch' using errcode='23514';end if;end \$record_review_v3_gate_b_ledger\$;$", re.M,
)


def array_pin(statements):
    raw = json.dumps(statements, ensure_ascii=False, separators=(", ", ": "), allow_nan=False).encode()
    return {"statement_count": len(statements), "postgres_array_bytes": len(raw), "postgres_array_sha256": hashlib.sha256(raw).hexdigest()}


def sources(root=prefix.ROOT):
    root = Path(root)
    prefix.canonical206(root)
    raw = prefix.regular(root / prefix.CANDIDATE / "secondary_review_expected_205_ledger.json")
    if prefix.digest(raw) != FROZEN_LEDGER_SHA:
        raise ValueError("Independently frozen original205 ledger required")
    rows = json.loads(raw)["ledger"]
    if len(rows) != 205 or [row["version"] for row in rows] != sorted({row["version"] for row in rows}):
        raise ValueError("Complete ordered original205 source ledger required")
    variants = {}
    for row in rows:
        paths = list((root / "supabase/migrations").glob(row["version"] + "_*.sql"))
        if len(paths) != 1:
            raise ValueError("Exactly one independently pinned source file required")
        raw = prefix.regular(paths[0])
        text = raw.decode("utf-8", errors="strict")
        # The engine205 receipt must remain the exact official CLI vector.
        # Only original204 files have a reviewed managed whole-file transport.
        encodings = {} if row is rows[-1] else {"authored_complete": array_pin([text])}
        if row["version"] == PAYMENT_VERSION:
            # This exact source is one DDL statement after two documentation
            # comments. Its bare transport encoding retains its semicolon.
            match = re.fullmatch(r"(?:--[^\n]*\n)*(alter function public\.payment_immutable\(\) set search_path = pg_catalog;)\n", text)
            if match is None:
                raise ValueError("Exact original one-command payment environment fix required")
            encodings["authored_command"] = array_pin([match[1]])
        variants[row["version"]] = {"name": row["name"], "source_sha256": prefix.digest(raw),
                                    "canonical_cli": array_pin(row["statements"]), "encodings": encodings}
    return rows, variants


def predicate(version, spec):
    if not re.fullmatch(r"[0-9]{14}", version):
        raise ValueError("Fixed migration version required")
    name = spec["name"].replace("'", "''")
    hashes = sorted({pin["postgres_array_sha256"] for pin in spec["encodings"].values()})
    if any(pin["statement_count"] != 1 for pin in spec["encodings"].values()) or any(re.fullmatch(r"[0-9a-f]{64}", value) is None for value in hashes):
        raise ValueError("Only the finite source-authored single-statement encodings required")
    canonical = spec["canonical_cli"]
    if (set(canonical) != {"statement_count", "postgres_array_bytes", "postgres_array_sha256"}
            or type(canonical["statement_count"]) is not int or canonical["statement_count"] < 1
            or type(canonical["postgres_array_bytes"]) is not int or canonical["postgres_array_bytes"] < 2
            or re.fullmatch(r"[0-9a-f]{64}", canonical["postgres_array_sha256"]) is None):
        raise ValueError("Finite canonical source statement-vector receipt required")
    # Hosted CLI history also retains created_by/idempotency_key/rollback.
    # Those audit columns are not part of the immutable SQL receipt. Admit
    # only its already-frozen canonical vector or authored transport bytes.
    canonical_check = ("(cardinality(m.statements)=" + str(canonical["statement_count"])
                       + " and octet_length(to_jsonb(m.statements)::text)=" + str(canonical["postgres_array_bytes"])
                       + " and encode(sha256(convert_to(to_jsonb(m.statements)::text,'UTF8')),'hex')='"
                       + canonical["postgres_array_sha256"] + "')")
    authored_check = (("(cardinality(m.statements)=1 and encode(sha256(convert_to(to_jsonb(m.statements)::text,'UTF8')),'hex')=any(ARRAY["
                       + ",".join("'" + value + "'" for value in hashes) + "]::text[]))") if hashes else "false")
    return ("exists(select 1 from supabase_migrations.schema_migrations m where m.version='" + version + "'and m.name='" + name
            + "'and (" + canonical_check + " or " + authored_check + "))")


def secondary_variant(root=prefix.ROOT):
    rows, variants = sources(root)
    original = prefix.regular(Path(root) / "supabase/migrations/20261022010000_controlled_secondary_review_private.sql").decode("utf-8")
    matches = list(ROW.finditer(original))
    if len(matches) != 205 or [match[1] for match in matches] != [row["version"] for row in rows]:
        raise ValueError("Every original205 gate must remain present exactly once")
    replacements = {}
    for match, row in zip(matches, rows):
        if json.loads(match[2].replace("''", "'")) != row:
            raise ValueError("Original canonical source ledger literal changed")
        if row["version"] in variants:
            old = match[0]
            before, marker, after = old.rpartition(" then raise exception")
            if not marker or after != " 'Secondary-review exact205 ledger row mismatch' using errcode='23514';end if;end $review_ledger$;":
                raise ValueError("Exact outer historical gate ending required")
            new = before + " and not " + predicate(row["version"], variants[row["version"]]) + marker + after
            if old in replacements:
                raise ValueError("Unique original source gate required")
            replacements[old] = new
    current = ROW.sub(lambda match: replacements.get(match[0], match[0]), original)
    inverse_lines = {new: old for old, new in replacements.items()}
    inverse = "".join(inverse_lines.get(line.removesuffix("\n"), line.removesuffix("\n"))
                      + ("\n" if line.endswith("\n") else "") for line in current.splitlines(keepends=True))
    if inverse != original or prefix.digest(inverse.encode()) != prefix.TAIL["20261022010000_controlled_secondary_review_private.sql"]:
        raise ValueError("Transport alternative changed original SQL outside its historical receipt gates")
    return current.encode(), {"kind": "secondary-review-source-receipt-variant-v1", "changed_gate_count": len(replacements),
        "original_source_sha256": prefix.digest(original.encode()), "variant_source_sha256": prefix.digest(current.encode()), "variant_source_bytes": len(current.encode()),
        "original_non_gate_bytes_recovered_exactly": True, "historical_rows_rewritten": False,
        "observed_database_values_used_as_expected": False, "source_receipt_encodings": variants}


def forward_inputs(root=prefix.ROOT):
    """Only original authored204 receipts and the reviewed206 CLI variant."""
    root = Path(root)
    rows, variants = sources(root)
    variant, _ = secondary_variant(root)
    raw = prefix.regular(root / "scripts/narcotics-log/hosted-source/cli-framing.json")
    if prefix.digest(raw) != HOSTED_FRAMING_SHA:
        raise ValueError("Independently framed historical transport source required")
    framed = json.loads(raw)
    pin = framed["framing"]
    if (framed["kind"] != "narcotics-hosted206-official-framing-source-v1"
            or framed["cli_version"] != "2.118.0" or framed["database_operations"] != 0
            or pin["sha256"] != prefix.digest(variant) or pin["bytes"] != len(variant)):
        raise ValueError("Source receipt framing differs from the reviewed206 source")
    tail_raw = prefix.regular(root / prefix.CANDIDATE / "secondary_review_206_statements.json")
    if prefix.digest(tail_raw) != "43736e52a08780b95edb7ef5594e8b98a7080634ce56dbd9180d2fc46d22618e":
        raise ValueError("Frozen original206 canonical statements required")
    rows = [*rows, {"version": "20261022010000", "name": "controlled_secondary_review_private",
                    "statements": json.loads(tail_raw)["statements"]}]
    additions = {version: predicate(version, spec) for version, spec in variants.items()}
    additions["20261022010000"] = (
        "exists(select 1 from supabase_migrations.schema_migrations m where m.version='20261022010000'"
        "and m.name='controlled_secondary_review_private'and cardinality(m.statements)=" + str(pin["statement_count"])
        + " and octet_length(to_jsonb(m.statements)::text)=" + str(pin["postgres_array_bytes"])
        + " and encode(sha256(convert_to(to_jsonb(m.statements)::text,'UTF8')),'hex')='" + pin["postgres_array_sha256"] + "')")
    return rows, additions


def canonical_forward(raw, root=prefix.ROOT):
    """Invert only the complete, exact reviewed encoding predicates."""
    _, additions = forward_inputs(root)
    lines = raw.decode("utf-8", errors="strict").splitlines(keepends=True)
    counts = dict.fromkeys(additions, 0)
    header = "do $record_review_v3_gate_b_ledger$ begin if (select to_jsonb(m)from supabase_migrations.schema_migrations m where version='"
    ending = " then raise exception 'Record-review v3 exact206 ledger row mismatch' using errcode='23514';end if;end $record_review_v3_gate_b_ledger$;"
    for index, line in enumerate(lines):
        if not line.startswith(header):
            continue
        version = line[len(header):len(header) + 14]
        if version not in additions:
            continue
        suffix = " and not " + additions[version] + ending
        trailing = "\n" if line.endswith("\n") else ""
        if line.removesuffix(trailing).endswith(suffix):
            lines[index] = line[:-(len(suffix) + len(trailing))] + ending + trailing
            counts[version] += 1
    if set(counts.values()) not in ({0}, {2}):
        raise ValueError("Only all412 exact forward receipt alternatives are admitted")
    text = "".join(lines)
    if prefix.digest(text.encode()) != FORWARD_ORIGINAL_SHA:
        raise ValueError("Original forward SQL must be recovered byte for byte")
    return text.encode()


def forward_variant(raw, root=prefix.ROOT):
    original = canonical_forward(raw, root).decode()
    rows, additions = forward_inputs(root)
    expected = {row["version"]: row for row in rows}
    matches = list(FORWARD_ROW.finditer(original))
    if [match[1] for match in matches] != sorted(expected) * 2:
        raise ValueError("Every frozen206 preflight and postcheck gate required")
    def replace(match):
        version = match[1]
        if json.loads(match[2].replace("''", "'")) != expected[version]:
            raise ValueError("Canonical historical ledger literal changed")
        if version not in additions:
            return match[0]
        before, marker, after = match[0].rpartition(" then raise exception")
        if not marker or after != " 'Record-review v3 exact206 ledger row mismatch' using errcode='23514';end if;end $record_review_v3_gate_b_ledger$;":
            raise ValueError("Exact outer forward gate ending required")
        return before + " and not " + additions[version] + marker + after
    current = FORWARD_ROW.sub(replace, original).encode()
    if canonical_forward(current, root) != original.encode():
        raise ValueError("Forward historical receipt source inverse failed")
    return current, {"kind": "forward-source-receipt-variant-v1", "changed_gate_count": 412,
        "original_source_sha256": FORWARD_ORIGINAL_SHA, "variant_source_sha256": prefix.digest(current),
        "variant_source_bytes": len(current), "original_non_gate_bytes_recovered_exactly": True,
        "original_canonical_json_literals_preserved": True, "historical_rows_rewritten": False,
        "observed_database_values_used_as_expected": False}


def materialize(write=False):
    raw, proof = secondary_variant()
    base = prefix.ROOT / "scripts/narcotics-log/hosted-source"
    outputs = {"migrations/20261022010000_controlled_secondary_review_private.sql": raw,
               "source-proof.json": (json.dumps(proof, sort_keys=True, indent=2) + "\n").encode()}
    for name, value in outputs.items():
        target = base / name
        if target.exists() or target.is_symlink():
            if prefix.regular(target) != value:
                raise ValueError("Differing source receipt artifact already exists: " + name)
        elif write:
            target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            with target.open("xb") as stream:
                stream.write(value)
            target.chmod(0o600)
        else:
            raise ValueError("Required fixed source receipt artifact missing: " + name)
    return proof


if __name__ == "__main__":
    if sys.argv[1:] not in (["--write-source"], ["--check-source"]):
        raise ValueError("Choose --write-source or --check-source; this performs no database operations")
    proof = materialize(sys.argv[1:] == ["--write-source"])
    print(json.dumps({key: value for key, value in proof.items() if key != "source_receipt_encodings"}, sort_keys=True))
