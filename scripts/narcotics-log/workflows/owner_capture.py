"""Read the complete fixed PB50 as owner data, never as app authentication."""
import hashlib
import json
from pathlib import Path
from uuid import UUID

HERE = Path(__file__).resolve().parent
TEMPLATE_SHA = "b64e83e13c72deb39c7bbf23d48a1b39d050dacb700ec78fd462e1c9adf60bc0"
STAGES = frozenset((
    "gateway-posted-receipt", "witness-before-attestation", "witness-after-attestation",
    "witness-posted-receipt", "witness-after-execute", "management-before-prepare",
    "management-after-prepare", "management-after-approval", "management-after-execute",
    "management-after-confirmation", "management-after-resolution",
    "writer-receive-posted-receipt", "writer-adjust-posted-receipt",
    "writer-clinical-0-posted-receipt", "writer-clinical-1-posted-receipt",
    "writer-dispense-posted-receipt", "writer-pickup-posted-receipt",
    "writer-annotation-posted-receipt", "writer-intake-posted-receipt",
    "writer-discrepancy-posted-receipt",
))


def program(product_id, site_id):
    template = (HERE / "owner-pb50.sql").read_bytes()
    if hashlib.sha256(template).hexdigest() != TEMPLATE_SHA:
        raise ValueError("Fixed complete owner PB50 program changed")
    text = template.decode("utf-8", errors="strict")
    for marker, value in (("__OWNER_CAPTURE_PRODUCT_UUID__", product_id),
                          ("__OWNER_CAPTURE_SITE_UUID__", site_id)):
        if type(value) is not str or str(UUID(value)) != value or UUID(value).int == 0:
            raise ValueError("Canonical nonzero source scope required")
        if text.count(marker) != 1:
            raise ValueError("One exact typed scope marker required")
        text = text.replace(marker, value)
    return text


def capture(runtime, stage, source_data, payload_module, product_id, site_id):
    if stage not in STAGES or source_data is not None or payload_module is not None:
        raise ValueError("Fixed source capture stage and no external authority flags required")
    stdout = runtime.raw_query("pb50-" + stage, program(product_id, site_id), 16777217)
    raw = stdout.encode("utf-8", errors="strict")
    if not raw.endswith(b"\n") or b"\n" in raw[:-1] or not 2 <= len(raw) - 1 <= 16777216:
        raise ValueError("One complete original PB50 row within 16MiB required")
    raw = raw[:-1]
    runtime.write("pb50-" + stage + ".jsonb", raw)
    value = runtime.decode(raw)
    columns = json.loads((HERE / "owner-pb49-columns.json").read_bytes())
    if type(value) is not dict or set(value) != set(columns) | {"witness_operations"}:
        raise ValueError("Complete 50-class source boundary required")
    for name, keys in columns.items():
        if type(value[name]) is not list or any(type(row) is not dict or set(row) != set(keys) for row in value[name]):
            raise ValueError("Complete original source columns required: " + name)
    witnesses = value["witness_operations"]
    if type(witnesses) is not list or any(type(row) is not dict or row.get("stage") != "saved" for row in witnesses):
        raise ValueError("Only actual saved/posted source witness rows are physical")
    runtime.remaining(1)
    return {"raw": raw, "sha256": hashlib.sha256(raw).hexdigest(), "diagnostic": value}
