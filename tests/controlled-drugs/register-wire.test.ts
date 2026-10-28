import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { readFileSync } from "node:fs";
import { ExactJsonNumber, type ExactJson } from "../../src/hub/features/controlled-drugs/record-review/exact-json.ts";
import { decodeRegisterJson } from "../../src/hub/features/controlled-drugs/register/exact-json.ts";
import { parseRegisterDataset, verifyRegisterDownload, verifyRegisterReply } from "../../src/hub/features/controlled-drugs/register/wire.ts";
import { parseRegisterPointer } from "../../src/hub/features/controlled-drugs/register/schema.ts";

const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const actor = "10000000-0000-4000-8000-000000000001", operation = "10000000-0000-4000-8000-000000000002", session = "10000000-0000-4000-8000-000000000003";
const request = { schema_version: 1, actor_id: actor, operation_id: operation, product_id: "10000000-0000-4000-8000-000000000004", site_id: "10000000-0000-4000-8000-000000000005",
  from_at: "2026-10-20T00:00:00.000Z", to_at: "2026-10-21T00:00:00.000Z" };
const recorded = "2026-10-21T01:00:00.123456Z";
function report() {
  const dataset = { schema_version: 1, report_id: operation, request, captured_at: recorded, time_basis: "Synthetic test fixture", schedule: "II", product_name: "Synthetic medication", stock_unit: "mL",
    site_label: "Synthetic site", registration_evidence_text: '{"exact": 9007199254740993.123}', opening_evidence_text: "{}", authorization_kinds: [], cells: [], events: [], counts: [], supporting_forms: [], evidence_gaps: [] };
  const text = JSON.stringify(dataset), csv = '"Synthetic header"\r\n"\'=synthetic text"\r\n';
  return { schema_version: 1, state: "saved", kind: "report", operation_id: operation, actor_id: actor, original_session_id: session, recorded_at: recorded,
    request_metadata: request, request_hash: "353fd2f9497c5afdbb17771d736bda31ae6cd24b88d8dd8fcca256b8f18384e9",
    data: { captured_at: recorded, dataset_text: text, dataset_hash: hash(text), dataset_utf8_bytes: Buffer.byteLength(text), csv_text: csv, csv_hash: hash(csv), csv_utf8_bytes: Buffer.byteLength(csv) } };
}
test("independently framed request digest and original text bytes are verified", async () => {
  const fixture = report(), pointer = parseRegisterPointer({ schema_version: 1, actor_id: actor, operation_id: operation, product_id: request.product_id, site_id: request.site_id, kind: "report" });
  const reply = await verifyRegisterReply(bytes(fixture), pointer, request);
  assert.equal(reply.state, "saved");
  assert.equal(parseRegisterDataset(fixture.data.dataset_text).registration_evidence_text, '{"exact": 9007199254740993.123}');
  await assert.rejects(verifyRegisterReply(bytes({ ...fixture, data: { ...fixture.data, csv_text: fixture.data.csv_text + "changed" } }), pointer));
  await assert.rejects(verifyRegisterReply(bytes(fixture), { ...pointer, site_id: session }));
});
test("duplicate JSON keys, fractional protocol numbers, and malformed Unicode refuse", () => {
  assert.throws(() => decodeRegisterJson(new TextEncoder().encode('{"state":"saved","state":"abandoned"}')));
  assert.throws(() => decodeRegisterJson(new TextEncoder().encode('"\\ud800"')));
  const fixture = report();
  assert.throws(() => parseRegisterDataset(fixture.data.dataset_text.replace('"schema_version":1', '"schema_version":1.0')));
});
function exactText(value: ExactJson): string {
  if (value instanceof ExactJsonNumber) return value.token;
  if (Array.isArray(value)) return `[${value.map(exactText).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).map(([key, item]) => `${JSON.stringify(key)}:${exactText(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
test("retained native annotation corpus preserves null observation and related historical lines", async () => {
  const corpus = decodeRegisterJson(readFileSync(new URL("./record-review-native-fixtures/native-detail-08.json", import.meta.url))) as { data: { packet: Record<string, ExactJson>; terminal_review: ExactJson; escalations: ExactJson } };
  const { current_authorization: omitted, ...packet } = corpus.data.packet; assert(omitted);
  const event = packet.event as Record<string, ExactJson>, adapter = packet.adapter as Record<string, ExactJson>;
  assert.equal(event.basis, "annotation"); assert.equal(event.observed_at, null);
  const q = { ...request, product_id: String(event.product_id), site_id: String(adapter.site_id), from_at: "2026-10-01T00:00:00.000Z", to_at: "2026-10-31T00:00:00.000Z" };
  const fixture = report(), dataset = JSON.parse(fixture.data.dataset_text), packetText = exactText(packet), historyText = exactText({ terminal_review: corpus.data.terminal_review, escalations: corpus.data.escalations });
  const captured = "2026-11-01T01:00:00.123456Z";
  dataset.request = q; dataset.captured_at = captured;
  dataset.events = [{ event_id: event.id, sequence: String(event.sequence), writer: event.writer, event_kind: event.event_kind, actor_id: event.actor_id, actor_name: event.actor_name,
    observed_at: null, recorded_at: String(event.recorded_at).replace("+00:00", "Z"), basis: event.basis, note: event.note, record_hash: event.record_hash, secondary_review_required: event.secondary_review_required, lines: [], custody_text: exactText((packet.transitions as Record<string, ExactJson>[]).filter(row => row.event_id === event.id)),
    source_packet_text: packetText, source_packet_hash: hash(packetText), review_history_text: historyText, review_history_hash: hash(historyText), saved_witnesses: [], current_display: null }];
  const text = JSON.stringify(dataset), reply = { ...fixture, request_metadata: q, request_hash: "507229e434143f6b9acb7cbbbef07a01632ba4efabd58fa5c0a40e099ac5bb4a", recorded_at: captured,
    data: { ...fixture.data, captured_at: captured, dataset_text: text, dataset_hash: hash(text), dataset_utf8_bytes: Buffer.byteLength(text) } };
  const pointer = parseRegisterPointer({ schema_version: 1, actor_id: actor, operation_id: operation, product_id: q.product_id, site_id: q.site_id, kind: "report" });
  assert.equal((await verifyRegisterReply(bytes(reply), pointer)).state, "saved");
  const verifyDataset = () => {
    const value = JSON.stringify(dataset);
    return verifyRegisterReply(bytes({ ...reply, data: { ...reply.data, dataset_text: value, dataset_hash: hash(value), dataset_utf8_bytes: Buffer.byteLength(value) } }), pointer);
  };
  const patient = (packet.source_rows as { relation: string; row: Record<string, ExactJson> }[]).find(row => row.relation === "public.native_dispenses")!.row.pet_id;
  dataset.events[0].current_display = { basis: "current_display_captured_at_export", patient_id: patient, patient_name: "Synthetic patient", client_id: session, client_name: "Synthetic client" };
  assert.equal((await verifyDataset()).state, "saved");
  dataset.events[0].current_display.patient_id = session;
  await assert.rejects(verifyDataset(), /could not be verified/);
  dataset.events[0].current_display = null;
  const requiredPacket = decodeRegisterJson(new TextEncoder().encode(packetText)) as Record<string, ExactJson>;
  const parent = requiredPacket.parent_preparation as Record<string, ExactJson>, frozen = parent.frozen as Record<string, ExactJson>;
  const withWitness = exactText({ ...requiredPacket, parent_preparation: { ...parent, frozen: { ...frozen, permission: { ...(frozen.permission as Record<string, ExactJson>), witness: "c2_required" } } } });
  dataset.events[0].source_packet_text = withWitness; dataset.events[0].source_packet_hash = hash(withWitness);
  await assert.rejects(verifyDataset(), /could not be verified/);
  dataset.events[0].source_packet_text = packetText; dataset.events[0].source_packet_hash = hash(packetText);
  dataset.events[0].custody_text = '[{"container_id":"10000000-0000-4000-8000-000000000001"}]';
  await assert.rejects(verifyDataset(), /could not be verified/);
  dataset.events[0].custody_text = "[]";
  const futureHistory = exactText({ terminal_review: null, escalations: [{ reason: "overdue", first_detected_at: "2026-11-02T00:00:00.000000Z", has_acknowledgment: false, has_resolution_note: false }] });
  dataset.events[0].review_history_text = futureHistory; dataset.events[0].review_history_hash = hash(futureHistory);
  await assert.rejects(verifyDataset(), /could not be verified/);
  dataset.events[0].review_history_text = historyText; dataset.events[0].review_history_hash = hash(historyText);
  dataset.events[0].observed_at = captured;
  const changed = JSON.stringify(dataset);
  await assert.rejects(verifyRegisterReply(bytes({ ...reply, data: { ...reply.data, dataset_text: changed, dataset_hash: hash(changed), dataset_utf8_bytes: Buffer.byteLength(changed) } }), pointer));
  dataset.events[0].observed_at = null; dataset.events[0].record_hash = "b".repeat(64);
  const wrongEvent = JSON.stringify(dataset);
  await assert.rejects(verifyRegisterReply(bytes({ ...reply, data: { ...reply.data, dataset_text: wrongEvent, dataset_hash: hash(wrongEvent), dataset_utf8_bytes: Buffer.byteLength(wrongEvent) } }), pointer));
});
test("a matching byte hash cannot associate an unrelated supporting document", async () => {
  const fixture = report(), dataset = JSON.parse(fixture.data.dataset_text);
  dataset.supporting_forms = [{ form_id: session, kind: "order_form", title: "Unrelated form", filename: "synthetic.pdf", mime: "application/pdf", byte_length: 40, sha256: "a".repeat(64),
    obtained_at: "2026-10-20T00:00:00.000000Z", recorded_at: recorded, event_id: null, event_hash: null, document_text: "{}", document_hash: hash("{}") }];
  const text = JSON.stringify(dataset), pointer = parseRegisterPointer({ schema_version: 1, actor_id: actor, operation_id: operation, product_id: request.product_id, site_id: request.site_id, kind: "report" });
  await assert.rejects(verifyRegisterReply(bytes({ ...fixture, data: { ...fixture.data, dataset_text: text, dataset_hash: hash(text), dataset_utf8_bytes: Buffer.byteLength(text) } }), pointer));
});
test("private attachment download verifies both original bytes and their document association", async () => {
  const raw = new TextEncoder().encode("%PDF-1.4\nSynthetic fixture\n%%EOF\n"), digest = hash(raw);
  const metadata = { schema_version: 1, actor_id: actor, operation_id: operation, product_id: request.product_id, site_id: request.site_id, event_id: null,
    kind: "order_form", title: "Synthetic form", filename: "synthetic.pdf", obtained_at: request.from_at, mime: "application/pdf" };
  const document = { schema_version: 1, form_id: operation, operation_id: operation, request_metadata: metadata, request_hash: "a".repeat(64), actor_id: actor,
    session_id: session, recorded_at: recorded, obtained_at_basis: "staff_reported", event_hash: null, sha256: digest, byte_length: raw.length, mime: "application/pdf" };
  const text = JSON.stringify(document), fixture = { schema_version: 1, form_id: operation, filename: "synthetic.pdf", mime: "application/pdf", byte_length: raw.length,
    sha256: digest, base64: Buffer.from(raw).toString("base64"), document_text: text, document_hash: hash(text) };
  assert.deepEqual((await verifyRegisterDownload(bytes(fixture), operation)).bytes, raw);
  await assert.rejects(verifyRegisterDownload(bytes({ ...fixture, base64: Buffer.from("changed").toString("base64") }), operation));
  const changedDocument = JSON.stringify({ ...document, sha256: "b".repeat(64) });
  await assert.rejects(verifyRegisterDownload(bytes({ ...fixture, document_text: changedDocument, document_hash: hash(changedDocument) }), operation));
});
