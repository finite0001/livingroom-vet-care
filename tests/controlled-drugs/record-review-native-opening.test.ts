import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { decodeExactJson, ExactJsonNumber, type ExactJson } from "../../src/hub/features/controlled-drugs/record-review/exact-json.ts";
import { verifyProspectiveComponentConsistency } from "../../src/hub/features/controlled-drugs/record-review/prospective-component-consistency.ts";
import { verifyProspectiveNativeMovement } from "../../src/hub/features/controlled-drugs/record-review/prospective-native-movement.ts";
import type { PreparedReviewPacket } from "../../src/hub/features/controlled-drugs/record-review/prepared-packet.ts";

interface FixturePin {
  file: string;
  bytes: number;
  sha256: string;
  response_sha256: string;
  event_kind: string;
  site_basis: string;
  source_ref_count: number;
}
interface Provenance {
  fixtures: FixturePin[];
  same_site_only: boolean;
  common269_acceptance: boolean;
  complete_frontend_evidence_admission: boolean;
  hash_frames_or_packet_fields_changed: boolean;
}
const directory = new URL("./record-review-native-fixtures/", import.meta.url);
const provenance = JSON.parse(readFileSync(new URL("opening-annotation-provenance.json", directory), "utf8")) as Provenance;
const sha = (raw: Uint8Array) => createHash("sha256").update(raw).digest("hex");
function object(value: ExactJson): Readonly<Record<string, ExactJson>> {
  if (value === null || typeof value !== "object" || Array.isArray(value) || value instanceof ExactJsonNumber) throw new Error("Exact JSON object required");
  return value;
}
function array(value: ExactJson): readonly ExactJson[] {
  if (!Array.isArray(value)) throw new Error("Exact JSON array required");
  return value;
}
function freeze(value: ExactJson): ExactJson {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

test("accepted synthetic opening-stock annotations pass unchanged local evidence checks", async t => {
  assert.equal(provenance.fixtures.length, 2);
  assert.equal(provenance.same_site_only, true);
  assert.equal(provenance.common269_acceptance, false);
  assert.equal(provenance.complete_frontend_evidence_admission, false);
  assert.equal(provenance.hash_frames_or_packet_fields_changed, false);
  for (const [index, pin] of provenance.fixtures.entries()) await t.test(index === 0 ? "clinical annotation" : "operational annotation", async () => {
    const url = new URL(pin.file, directory), raw = readFileSync(url);
    assert.equal(raw.length, pin.bytes);
    assert.equal(sha(raw), pin.sha256);
    assert.equal(pin.response_sha256, pin.sha256);
    const detail = object(decodeExactJson(raw)), data = object(detail.data), packet = object(data.packet);
    const event = object(packet.event), adapter = object(packet.adapter), summary = object(data.summary);
    assert.equal(detail.state, "detail");
    assert.equal(event.event_kind, `append_native_dispense_correction:${index === 0 ? "clinical_annotation" : "operational_annotation"}`);
    assert.equal(adapter.event_kind, pin.event_kind);
    assert.equal(adapter.site_basis, "opening_custody_site");
    assert.equal(summary.site_basis, adapter.site_basis);
    assert.equal(event.observed_at, null);
    assert.equal(adapter.native_family_dispense_id, null);
    assert.equal(array(adapter.source_refs).length, pin.source_ref_count);
    const sources = array(packet.source_rows).map(object);
    function row(relation: string, id: ExactJson): Readonly<Record<string, ExactJson>> {
      const found = sources.filter(s => s.relation === relation && object(s.row).id === id);
      assert.equal(found.length, 1);
      return object(found[0].row);
    }
    const correction = row("public.native_dispense_correction_events", event.id);
    row("public.native_dispenses", correction.dispense_id);
    assert.equal(sources.some(s => s.relation === "public.controlled_stock_events" && object(s.row).id === correction.dispense_id), false);
    assert.equal(sources.filter(s => s.relation === "public.controlled_stock_openings").length, 1);
    const target = Object.freeze({ event_id: String(event.id) });
    const frozen = freeze(packet) as unknown as PreparedReviewPacket;
    await verifyProspectiveComponentConsistency(frozen, target);
    await verifyProspectiveNativeMovement(frozen, target);
    // Keep raw JSON numeric lexemes, original documents and omitted history exact.
    assert.equal(sha(readFileSync(url)), pin.sha256);
  });
});
