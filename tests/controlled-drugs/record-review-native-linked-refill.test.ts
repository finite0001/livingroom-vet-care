import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { decodeExactJson, ExactJsonNumber, type ExactJson } from "../../src/hub/features/controlled-drugs/record-review/exact-json.ts";
import { verifyProspectiveComponentConsistency } from "../../src/hub/features/controlled-drugs/record-review/prospective-component-consistency.ts";
import { verifyProspectiveNativeMovement } from "../../src/hub/features/controlled-drugs/record-review/prospective-native-movement.ts";
import type { PreparedReviewPacket } from "../../src/hub/features/controlled-drugs/record-review/prepared-packet.ts";
interface FixturePin { file: string; bytes: number; sha256: string; response_sha256: string; event_kind: string; source_ref_count: number }
const directory = new URL("./record-review-native-fixtures/", import.meta.url);
const provenance = JSON.parse(readFileSync(new URL("linked-refill-provenance.json", directory), "utf8")) as { fixtures: FixturePin[]; same_site_only: boolean; complete_frontend_evidence_admission: boolean };
const sha = (raw: Uint8Array) => createHash("sha256").update(raw).digest("hex");
function object(value: ExactJson): Readonly<Record<string, ExactJson>> {
  if (value === null || typeof value !== "object" || Array.isArray(value) || value instanceof ExactJsonNumber) throw new Error("Exact JSON object required");
  return value;
}
function array(value: ExactJson): readonly ExactJson[] {
  if (!Array.isArray(value)) throw new Error("Exact JSON array required"); return value;
}
function freeze(value: ExactJson): ExactJson {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } return value;
}
test("two independently accepted genuine synthetic linked-refill GETs pass unchanged K8 local semantics", async t => {
  assert.equal(provenance.fixtures.length, 2); assert.equal(provenance.same_site_only, true); assert.equal(provenance.complete_frontend_evidence_admission, false);
  for (const [index, pin] of provenance.fixtures.entries()) await t.test(index === 0 ? "linked native D" : "linked P refill close", async () => {
    const url = new URL(pin.file, directory), raw = readFileSync(url);
    assert.equal(raw.length, pin.bytes); assert.equal(sha(raw), pin.sha256); assert.equal(pin.response_sha256, pin.sha256);
    const detail = object(decodeExactJson(raw)), data = object(detail.data), packet = object(data.packet), event = object(packet.event), adapter = object(packet.adapter);
    assert.equal(detail.state, "detail"); assert.equal(adapter.event_kind, pin.event_kind); assert.equal(pin.event_kind, index === 0 ? "record_native_dispense" : "record_native_pickup");
    assert.equal(array(adapter.source_refs).length, pin.source_ref_count);
    const sources = array(packet.source_rows).map(object);
    function row(relation: string, id: ExactJson): Readonly<Record<string, ExactJson>> {
      const found = sources.filter(s => s.relation === relation && object(s.row).id === id); assert.equal(found.length, 1); return object(found[0].row);
    }
    const native = row(index === 0 ? "public.native_dispenses" : "public.native_pickups", event.id), document = object(native.document), preparation = row("public.controlled_stock_preparations", event.id);
    const request = object(object(preparation.canonical_arguments).request), ownRefill = object(request[index === 0 ? "refill" : "refill_close"]);
    assert.equal(document.refill_id, ownRefill.id); assert.equal(typeof document.refill_id, "string");
    assert.equal(document.refill_id, String(document.refill_id).toUpperCase());
    const suppliedRefill = object(object(object(document.reviewed_context).refill).refill);
    assert.equal(String(document.refill_id).toLowerCase(), suppliedRefill.id);
    // The whole refill PK row is an omitted backend preimage; do not invent it.
    const target = Object.freeze({ event_id: String(event.id) });
    const frozen = freeze(packet) as unknown as PreparedReviewPacket;
    await verifyProspectiveComponentConsistency(frozen, target); await verifyProspectiveNativeMovement(frozen, target);
    // No recommit, request/doc rewrite or invented omitted PK/after/history.
    assert.equal(sha(readFileSync(url)), pin.sha256);
  });
});
