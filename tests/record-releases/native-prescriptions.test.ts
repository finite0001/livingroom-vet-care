import { upgradeReturnPrint } from "../prescriptions/reconciliation-fixture.ts";
import type { NativePrescriptionReleaseV13, NativeDispenseReleaseV13 } from "../../supabase/functions/_shared/record-release-native-prescriptions.ts";
import { returnFixture } from "../prescriptions/return-fixture.ts";
import type { NativePrescriptionReleaseV12, NativeDispenseReleaseV12 } from "../../supabase/functions/_shared/record-release-native-prescriptions.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { correctionFixture } from "../prescriptions/correction-fixture.ts";
import type { NativePrescriptionReleaseV11, NativeDispenseReleaseV11 } from "../../supabase/functions/_shared/record-release-native-prescriptions.ts";
import { nativeReleaseArtifact } from "./native-prescription-fixture.ts";
import { renderRecordRelease, type ReleaseBundle } from "../../supabase/functions/_shared/record-release-renderer.ts";
import { buildReleaseEmailPayload } from "../../supabase/functions/_shared/release-email-payload.ts";
import { buildDocumentLinkArtifacts } from "../../supabase/functions/_shared/document-link-artifacts.ts";
import { apiOriginalBytes } from "./api-attachment-fixture.ts";

test("native-only packages distinguish selected orders, actual partial dispensing and pickup", () => {
  const a = nativeReleaseArtifact(), before = structuredClone(a), html = renderRecordRelease(a);
  assert.equal(renderRecordRelease(structuredClone(a)), html); assert.deepEqual(a, before);
  for (const text of ["Selected signed prescription", "Selected recorded dispense", "10 test units", "partial fill", "No pickup recorded", "Outside pharmacy fulfillment is unknown", "Status when package reviewed", "Original full dispensing artifact fingerprint"]) assert.ok(html.includes(text), text);
  assert.ok(!html.includes("invoice_id"));
});
test("dispense-only selection includes signed context without selecting the order", () => {
  const a = nativeReleaseArtifact(); a.preview.snapshot.native_prescriptions = []; a.preview.snapshot.selection!.native_prescription_ids = [];
  const html = renderRecordRelease(a); assert.match(html, /Signed prescription context for this dispense/); assert.doesNotMatch(html, /Selected signed prescription/);
});
test("order-only release does not silently include fill detail", () => {
  const a = nativeReleaseArtifact(); a.preview.snapshot.native_dispenses = []; a.preview.snapshot.selection!.native_dispense_ids = [];
  const html = renderRecordRelease(a); assert.match(html, /Selected signed prescription/); assert.doesNotMatch(html, /Selected recorded dispense|TEST-LOT/);
});
test("frozen terminal status and pickup are historical and safely escaped", () => {
  const a = nativeReleaseArtifact(), s = a.preview.snapshot, p = s.native_prescriptions![0];
  p.status = { state: "replaced", head_id: "00000000-0000-4000-8000-000000000022", head_version: 1, event_at: "2026-09-16T11:00:00Z", reason: '<script>review</script>', replacement_id: "00000000-0000-4000-8000-000000000023" };
  s.native_dispenses![0].prescription = structuredClone(p);
  s.native_dispenses![0].pickup = { id: "00000000-0000-4000-8000-000000000024", picked_up_at: "2026-09-16T12:00:00Z", actor_id: p.artifact.prescriber.user_id, recipient_name: '<img src=x>' };
  const html = renderRecordRelease(a); assert.match(html, /replaced/); assert.match(html, /&lt;script&gt;/); assert.match(html, /&lt;img src=x&gt;/); assert.doesNotMatch(html, /<script|<img/);
});
test("external pharmacy history preserves unknown usage", () => {
  const a = nativeReleaseArtifact(), s = a.preview.snapshot, p = s.native_prescriptions![0];
  s.native_dispenses = []; s.selection!.native_dispense_ids = [];
  p.artifact.fulfillment_mode = "external_pharmacy";
  Object.assign(p.usage, { dispensed_quantity: "0.000", used_fill_slots: 0, remaining_quantity: null, forfeited_quantity: "0.000", unopened_fill_slots: null, allowance_basis: "external_unknown", open_slot: null, fulfillment_head: { event_id: null, version: 0 } });
  assert.match(renderRecordRelease(a), /Unknown — external pharmacy/);
});
const mutations: Record<string, (a: ReturnType<typeof nativeReleaseArtifact>) => void> = {
  "missing family": a => { delete a.preview.snapshot.native_dispenses; },
  "unselected order": a => { a.preview.snapshot.selection!.native_prescription_ids = []; },
  "unselected dispense": a => { a.preview.snapshot.selection!.native_dispense_ids = []; },
  "duplicate order": a => { a.preview.snapshot.native_prescriptions!.push(a.preview.snapshot.native_prescriptions![0]); a.preview.snapshot.selection!.native_prescription_ids!.push(a.preview.snapshot.native_prescriptions![0].id); },
  "wrong patient": a => { a.preview.snapshot.native_prescriptions![0].artifact.patient.id = "00000000-0000-4000-8000-000000000088"; },
  "wrong household": a => { a.preview.snapshot.native_dispenses![0].prescription.artifact.household.id = "00000000-0000-4000-8000-000000000088"; },
  "changed embedded order": a => { a.preview.snapshot.native_dispenses![0].prescription.artifact.medication.directions = "Changed"; },
  "internal invoice": a => { Object.assign(a.preview.snapshot.native_dispenses![0].artifact, { invoice_id: "private" }); },
  "raw operational context": a => { Object.assign(a.preview.snapshot.native_dispenses![0], { reviewed_context: {} }); },
  "missing saved fingerprint": a => { a.preview.snapshot.native_dispenses![0].artifact_hash = "bad"; },
  "invented terminal state": a => { a.preview.snapshot.native_prescriptions![0].status.state = "cancelled"; },
  "inconsistent remaining allowance": a => { a.preview.snapshot.native_prescriptions![0].usage.remaining_quantity = "81.000"; },
  "invalid usage decimal": a => { a.preview.snapshot.native_prescriptions![0].usage.dispensed_quantity = "1e1"; },
  "invented source event": a => { a.preview.snapshot.native_prescriptions![0].usage.fulfillment_head.event_id = null; },
  "pickup before dispense": a => { a.preview.snapshot.native_dispenses![0].pickup = { id: "00000000-0000-4000-8000-000000000024", picked_up_at: "2026-09-15T12:00:00Z", actor_id: a.preview.snapshot.native_prescriptions![0].artifact.prescriber.user_id, recipient_name: "Synthetic" }; },
  "lots exceed actual dispense": a => { a.preview.snapshot.native_dispenses![0].artifact.lots[0].quantity = "11"; },
  "schema downgrade": a => { a.preview.snapshot.schema_version = 9; },
};
for (const [name, mutate] of Object.entries(mutations)) test(`native release rejects ${name}`, () => { const a = nativeReleaseArtifact(); mutate(a); assert.throws(() => renderRecordRelease(a)); });
test("selected fills cannot overstate a single slot even when total native usage covers them", () => {
  const a = nativeReleaseArtifact(), s = a.preview.snapshot, p = s.native_prescriptions![0];
  Object.assign(p.usage, { dispensed_quantity: "60.000", used_fill_slots: 2, remaining_quantity: "30.000", unopened_fill_slots: 1, open_slot: null, fulfillment_head: { ...p.usage.fulfillment_head, version: 2 } });
  const first = s.native_dispenses![0]; first.prescription = structuredClone(p); first.artifact.quantity = "30"; first.artifact.lots[0].quantity = "30";
  const second = structuredClone(first); second.id = second.artifact.id = "00000000-0000-4000-8000-000000000025";
  s.native_dispenses!.push(second); s.selection!.native_dispense_ids!.push(second.id);
  assert.throws(() => renderRecordRelease(a), /native prescription release/);
  second.artifact.fill_index = 1;
  assert.doesNotThrow(() => renderRecordRelease(a));
});
for (const channel of ["EMAIL", "SMS"] as const) test(`mixed schema10 ${channel} retains original-byte binding`, async () => {
  const a = nativeReleaseArtifact(true), s = a.preview.snapshot;
  s.recipient.channel = channel; s.recipient.address = channel === "EMAIL" ? "owner@example.test" : "+13035550123";
  const b: ReleaseBundle = { release: { ...a.preview, id: "00000000-0000-4000-8000-000000000030", pet_id: s.patient.id, client_id: s.recipient.client_id, channel, recipient: s.recipient.address, selection: s.selection!, created_by: "00000000-0000-4000-8000-000000000031", created_at: "2026-09-16T12:00:00Z" }, events: [], eligible: true, ineligibility_reason: null };
  const run = (tamper: boolean) => {
    const download = async () => { const bytes = apiOriginalBytes.slice(); if (tamper) bytes[bytes.length - 1] ^= 1; return bytes; };
    return channel === "EMAIL" ? buildReleaseEmailPayload({ id: "request", release_id: b.release.id, actor_id: b.release.created_by, recipient: b.release.recipient, subject: "Records", body: "Reviewed records", release_hash: b.release.source_hash }, b, { from: "care@example.test", replyTo: "care@example.test" }, download) : buildDocumentLinkArtifacts({ id: "grant", family: "record_release", source_id: b.release.id, client_id: b.release.client_id, actor_id: b.release.created_by, recipient: b.release.recipient, source_hash: b.release.source_hash, source_bundle: b, created_at: b.release.created_at, expires_at: "2026-09-17T00:00:00Z", origin: "https://example.test", key_version: "test", capability_context: "synthetic", message_template: "Records", state: "preparing" }, { name: "Synthetic", address: "Synthetic", domain: null }, download);
  };
  await run(false); await assert.rejects(run(true), /bytes.*(capture|provenance)|original.*capture/i);
});

test("schema10 retains inherited history, vaccination and outside prescription validation", async () => {
  const { prescriptionArtifact } = await import("./prescription-fixture.ts");
  const a = prescriptionArtifact(), s = a.preview.snapshot;
  s.schema_version = 10; s.api_attachments = []; s.native_prescriptions = []; s.native_dispenses = [];
  s.selection = { ...s.selection, api_attachment_ids: [], native_prescription_ids: [], native_dispense_ids: [] };
  const html = renderRecordRelease(a);
  assert.match(html, /Clinician-reviewed outside prescription history/);
  const wrongHistory = structuredClone(a); wrongHistory.preview.snapshot.imported_histories![0].pet_id = "00000000-0000-4000-8000-000000000099";
  assert.throws(() => renderRecordRelease(wrongHistory), /history/i);
  for (const key of ["imported_vaccination_ids", "imported_prescription_ids"] as const) {
    const changed = structuredClone(a); changed.preview.snapshot.selection![key] = ["00000000-0000-4000-8000-000000000099"];
    assert.throws(() => renderRecordRelease(changed), key);
  }
});

test("selected open-slot fills cannot overstate the quantity actually consumed", () => {
  const a = nativeReleaseArtifact(), s = a.preview.snapshot, p = s.native_prescriptions![0];
  Object.assign(p.usage, { dispensed_quantity: "40.000", used_fill_slots: 2, remaining_quantity: "50.000", unopened_fill_slots: 1, open_slot: { ...p.usage.open_slot!, index: 1, remaining_quantity: "20.000" }, fulfillment_head: { ...p.usage.fulfillment_head, version: 2 } });
  const d = s.native_dispenses![0]; d.prescription = structuredClone(p); d.artifact.fill_index = 1;
  d.artifact.quantity = d.artifact.lots[0].quantity = "20";
  assert.throws(() => renderRecordRelease(a), /native prescription release/);
  d.artifact.quantity = d.artifact.lots[0].quantity = "10";
  assert.doesNotThrow(() => renderRecordRelease(a));
});
test("release chronology retains microseconds for terminal events and pickups", () => {
  const a = nativeReleaseArtifact(), s = a.preview.snapshot, p = s.native_prescriptions![0];
  p.artifact.signed_at = "2026-09-16T10:00:00.000002Z";
  p.status = { state: "cancelled", head_id: "00000000-0000-4000-8000-000000000050", head_version: 1, event_at: "2026-09-16T10:00:00.000001Z", reason: "Synthetic", replacement_id: null };
  s.native_dispenses![0].prescription = structuredClone(p);
  assert.throws(() => renderRecordRelease(a));
  p.status.event_at = "2026-09-16T10:00:00.000002Z"; s.native_dispenses![0].prescription = structuredClone(p);
  const d = s.native_dispenses![0]; d.artifact.dispensed_at = "2026-09-16T10:30:00.000002Z";
  d.pickup = { id: "00000000-0000-4000-8000-000000000051", picked_up_at: "2026-09-16T10:30:00.000001Z", actor_id: p.artifact.prescriber.user_id, recipient_name: "Synthetic" };
  assert.throws(() => renderRecordRelease(a));
  d.pickup.picked_up_at = "2026-09-16T04:30:00.000002-06:00";
  assert.doesNotThrow(() => renderRecordRelease(a));
});

function correctedRelease(mixed = false) {
  const a = nativeReleaseArtifact(mixed), s = a.preview.snapshot;
  const p = s.native_prescriptions![0] as NativePrescriptionReleaseV11;
  const d = s.native_dispenses![0] as NativeDispenseReleaseV11;
  const c = correctionFixture(p.artifact, { ...d.artifact, invoice_id: null });
  s.schema_version = 11;
  p.corrections = c.correction_summary;
  d.prescription = structuredClone(p);
  d.corrections = c.dispense_corrections!;
  const pickup = c.original_pickup!;
  d.pickup = { id: pickup.id, picked_up_at: pickup.picked_up_at, recipient_name: pickup.recipient_name, actor_id: pickup.actor_id };
  return a;
}
test("schema11 preserves original pickup and discloses the complete correction history", () => {
  const a = correctedRelease(), before = structuredClone(a), html = renderRecordRelease(a);
  assert.deepEqual(a, before);
  for (const text of ["Original recipient", "Corrected recipient", "Synthetic DVM", "Original packaging note", "Corrected handoff assertion"]) assert.ok(html.includes(text), text);
  const old = nativeReleaseArtifact();
  assert.doesNotMatch(renderRecordRelease(old), /Corrected handoff assertion/);
});
test("schema11 order-only selection discloses existence without disclosing unselected amendment text", () => {
  const a = correctedRelease(), s = a.preview.snapshot;
  s.native_dispenses = []; s.selection!.native_dispense_ids = [];
  const html = renderRecordRelease(a);
  assert.match(html, /correction/i); assert.doesNotMatch(html, /Original packaging note|Corrected recipient/);
});
for (const [name, mutate] of Object.entries({
  "omitted event": (a: ReturnType<typeof correctedRelease>) => { (a.preview.snapshot.native_dispenses![0] as NativeDispenseReleaseV11).corrections.events.splice(1,1); },
  "summary disagreement": (a: ReturnType<typeof correctedRelease>) => { (a.preview.snapshot.native_prescriptions![0] as NativePrescriptionReleaseV11).corrections.event_count++; },
  "wrong patient": (a: ReturnType<typeof correctedRelease>) => { (a.preview.snapshot.native_dispenses![0] as NativeDispenseReleaseV11).corrections.events[0].target.pet_id = "00000000-0000-4000-8000-000000000099"; },
  "version downgrade": (a: ReturnType<typeof correctedRelease>) => { a.preview.snapshot.schema_version = 10; },
  "missing correction summary": (a: ReturnType<typeof correctedRelease>) => { Reflect.deleteProperty(a.preview.snapshot.native_prescriptions![0], "corrections"); },
})) test(`schema11 rejects ${name}`, () => { const a = correctedRelease(); mutate(a); assert.throws(() => renderRecordRelease(a)); });

for (const channel of ["EMAIL", "SMS"] as const) test(`mixed schema11 ${channel} retains original-byte binding`, async () => {
  const a = correctedRelease(true), s = a.preview.snapshot;
  s.recipient.channel = channel; s.recipient.address = channel === "EMAIL" ? "owner@example.test" : "+13035550123";
  const b: ReleaseBundle = { release: { ...a.preview, id: "00000000-0000-4000-8000-000000000030", pet_id: s.patient.id, client_id: s.recipient.client_id, channel, recipient: s.recipient.address, selection: s.selection!, created_by: "00000000-0000-4000-8000-000000000031", created_at: "2026-09-16T12:00:00Z" }, events: [], eligible: true, ineligibility_reason: null };
  const run = (tamper: boolean) => {
    const download = async () => { const bytes = apiOriginalBytes.slice(); if (tamper) bytes[bytes.length - 1] ^= 1; return bytes; };
    return channel === "EMAIL" ? buildReleaseEmailPayload({ id: "request", release_id: b.release.id, actor_id: b.release.created_by, recipient: b.release.recipient, subject: "Records", body: "Reviewed records", release_hash: b.release.source_hash }, b, { from: "care@example.test", replyTo: "care@example.test" }, download) : buildDocumentLinkArtifacts({ id: "grant", family: "record_release", source_id: b.release.id, client_id: b.release.client_id, actor_id: b.release.created_by, recipient: b.release.recipient, source_hash: b.release.source_hash, source_bundle: b, created_at: b.release.created_at, expires_at: "2026-09-17T00:00:00Z", origin: "https://example.test", key_version: "test", capability_context: "synthetic", message_template: "Records", state: "preparing" }, { name: "Synthetic", address: "Synthetic", domain: null }, download);
  };
  await run(false); await assert.rejects(run(true), /bytes.*(capture|provenance)|original.*capture/i);
});

function returnedRelease(mixed = false) {
  const a = nativeReleaseArtifact(mixed), s = a.preview.snapshot;
  const p = s.native_prescriptions![0] as NativePrescriptionReleaseV12;
  const d = s.native_dispenses![0] as NativeDispenseReleaseV12;
  const r = returnFixture(p.artifact, { ...d.artifact, invoice_id: null });
  s.schema_version = 12;
  p.corrections = r.correction_summary; p.returns = r.return_summary;
  d.prescription = structuredClone(p); d.corrections = r.dispense_corrections!; d.returns = r.dispense_returns!;
  return a;
}
test("schema12 preserves clinical and correction history alongside physical custody accounting", () => {
  const a = returnedRelease(), original = structuredClone(a), html = renderRecordRelease(a);
  assert.deepEqual(a, original);
  for (const text of ["Physical return history", "Held medication is not available stock", "2.000 test units", "Return to available stock", "Original full dispensing artifact"]) assert.ok(html.includes(text), text);
});
test("schema12 order-only selection discloses return summary without selecting custody notes", () => {
  const a = returnedRelease(); a.preview.snapshot.native_dispenses = []; a.preview.snapshot.selection!.native_dispense_ids = [];
  const html = renderRecordRelease(a); assert.match(html, /4 return intake/); assert.doesNotMatch(html, /Synthetic client-shareable custody note|TEST-LOT/);
});
for (const [name, mutate] of Object.entries({
  "omitted return": (a: ReturnType<typeof returnedRelease>) => { (a.preview.snapshot.native_dispenses![0] as NativeDispenseReleaseV12).returns.events.splice(1,1); },
  "summary mismatch": (a: ReturnType<typeof returnedRelease>) => { (a.preview.snapshot.native_prescriptions![0] as NativePrescriptionReleaseV12).returns.event_count++; },
  "wrong patient": (a: ReturnType<typeof returnedRelease>) => { (a.preview.snapshot.native_dispenses![0] as NativeDispenseReleaseV12).returns.events[0].target.pet_id = "00000000-0000-4000-8000-000000000099"; },
  "invented held balance": (a: ReturnType<typeof returnedRelease>) => { (a.preview.snapshot.native_dispenses![0] as NativeDispenseReleaseV12).returns.allocations[0].held_quantity = "9.000"; },
  "version downgrade": (a: ReturnType<typeof returnedRelease>) => { a.preview.snapshot.schema_version = 11; },
  "missing return summary": (a: ReturnType<typeof returnedRelease>) => { Reflect.deleteProperty(a.preview.snapshot.native_prescriptions![0], "returns"); },
})) test(`schema12 rejects ${name}`, () => { const a = returnedRelease(); mutate(a); assert.throws(() => renderRecordRelease(a)); });

for (const channel of ["EMAIL", "SMS"] as const) test(`mixed schema12 ${channel} retains original-byte binding`, async () => {
  const a = returnedRelease(true), s = a.preview.snapshot;
  s.recipient.channel = channel; s.recipient.address = channel === "EMAIL" ? "owner@example.test" : "+13035550123";
  const b: ReleaseBundle = { release: { ...a.preview, id: "00000000-0000-4000-8000-000000000030", pet_id: s.patient.id, client_id: s.recipient.client_id, channel, recipient: s.recipient.address, selection: s.selection!, created_by: "00000000-0000-4000-8000-000000000031", created_at: "2026-09-16T12:00:00Z" }, events: [], eligible: true, ineligibility_reason: null };
  const run = (tamper: boolean) => {
    const download = async () => { const bytes = apiOriginalBytes.slice(); if (tamper) bytes[bytes.length - 1] ^= 1; return bytes; };
    return channel === "EMAIL" ? buildReleaseEmailPayload({ id: "request", release_id: b.release.id, actor_id: b.release.created_by, recipient: b.release.recipient, subject: "Records", body: "Reviewed records", release_hash: b.release.source_hash }, b, { from: "care@example.test", replyTo: "care@example.test" }, download) : buildDocumentLinkArtifacts({ id: "grant", family: "record_release", source_id: b.release.id, client_id: b.release.client_id, actor_id: b.release.created_by, recipient: b.release.recipient, source_hash: b.release.source_hash, source_bundle: b, created_at: b.release.created_at, expires_at: "2026-09-17T00:00:00Z", origin: "https://example.test", key_version: "test", capability_context: "synthetic", message_template: "Records", state: "preparing" }, { name: "Synthetic", address: "Synthetic", domain: null }, download);
  };
  await run(false); await assert.rejects(run(true), /bytes.*(capture|provenance)|original.*capture/i);
});

function reconciledRelease(mixed = false) {
  const a = nativeReleaseArtifact(mixed), s = a.preview.snapshot;
  const p = s.native_prescriptions![0] as NativePrescriptionReleaseV13;
  const d = s.native_dispenses![0] as NativeDispenseReleaseV13;
  const r = upgradeReturnPrint(returnFixture(p.artifact, { ...d.artifact, invoice_id: null }));
  s.schema_version = 13;
  p.corrections = r.correction_summary; p.returns = r.return_summary;
  d.prescription = structuredClone(p); d.corrections = r.dispense_corrections!; d.returns = r.dispense_returns!;
  return a;
}
test("schema13 preserves clinical sources and explicit quantity replay", () => {
  const a = reconciledRelease(), original = structuredClone(a), html = renderRecordRelease(a);
  assert.deepEqual(a, original); assert.match(html, /Physical returns and reconciliation/); assert.match(html, /Total recorded intake \/ retracted/);
});
test("schema13 rejects legacy disclosure and summary substitution", () => {
  const a = reconciledRelease(), old = returnedRelease();
  Object.assign(a.preview.snapshot.native_dispenses![0], { returns: (old.preview.snapshot.native_dispenses![0] as NativeDispenseReleaseV12).returns });
  assert.throws(() => renderRecordRelease(a));
  const b = reconciledRelease(); Object.assign(b.preview.snapshot.native_prescriptions![0], { returns: (old.preview.snapshot.native_prescriptions![0] as NativePrescriptionReleaseV12).returns });
  assert.throws(() => renderRecordRelease(b));
});
test("schema13 order-only package does not select hidden custody details", () => {
  const a = reconciledRelease(); a.preview.snapshot.native_dispenses = []; a.preview.snapshot.selection!.native_dispense_ids = [];
  const html = renderRecordRelease(a); assert.match(html, /4 quantity event/); assert.doesNotMatch(html, /Synthetic client-shareable custody note|TEST-LOT/);
});

for (const channel of ["EMAIL", "SMS"] as const) test(`mixed schema13 ${channel} retains original-byte binding`, async () => {
  const a = reconciledRelease(true), s = a.preview.snapshot;
  s.recipient.channel = channel; s.recipient.address = channel === "EMAIL" ? "owner@example.test" : "+13035550123";
  const b: ReleaseBundle = { release: { ...a.preview, id: "00000000-0000-4000-8000-000000000030", pet_id: s.patient.id, client_id: s.recipient.client_id, channel, recipient: s.recipient.address, selection: s.selection!, created_by: "00000000-0000-4000-8000-000000000031", created_at: "2026-09-16T12:00:00Z" }, events: [], eligible: true, ineligibility_reason: null };
  const run = (tamper: boolean) => {
    const download = async () => { const bytes = apiOriginalBytes.slice(); if (tamper) bytes[bytes.length - 1] ^= 1; return bytes; };
    return channel === "EMAIL" ? buildReleaseEmailPayload({ id: "request", release_id: b.release.id, actor_id: b.release.created_by, recipient: b.release.recipient, subject: "Records", body: "Reviewed records", release_hash: b.release.source_hash }, b, { from: "care@example.test", replyTo: "care@example.test" }, download) : buildDocumentLinkArtifacts({ id: "grant", family: "record_release", source_id: b.release.id, client_id: b.release.client_id, actor_id: b.release.created_by, recipient: b.release.recipient, source_hash: b.release.source_hash, source_bundle: b, created_at: b.release.created_at, expires_at: "2026-09-17T00:00:00Z", origin: "https://example.test", key_version: "test", capability_context: "synthetic", message_template: "Records", state: "preparing" }, { name: "Synthetic", address: "Synthetic", domain: null }, download);
  };
  await run(false); await assert.rejects(run(true), /bytes.*(capture|provenance)|original.*capture/i);
});
