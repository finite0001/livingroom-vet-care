import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  estimatePublicationSnapshotSchema, renderEstimatePublication, estimatePublicationArtifact,
  type EstimatePublicationSnapshot,
} from "../../supabase/functions/_shared/estimate-publication-document.ts";
import { estimateLineCents } from "../../src/hub/features/estimates/estimate-api.ts";

const id = (value: number) => `fa520000-0000-4000-8000-${String(value).padStart(12, "0")}`;
function snapshot(): EstimatePublicationSnapshot {
  return {
    schema_version: 1, preparation_id: id(1), prepared_at: "2026-09-16T12:00:00.000001Z",
    target: { estimate_id: id(2), client_id: id(3), pet_id: id(4) }, draft_version: 2, draft_record_hash: "a".repeat(64),
    practice: { version: 1, name: "The Living Room Veterinary Care", address: "2619 Spruce Street, Boulder, CO", domain: "thelivingroom.vet" },
    client: { id: id(3), version: 2, name: "Synthetic client", mailing_address: null },
    patient: { id: id(4), version: 3, name: "Synthetic patient", species: "Dog", breed: null },
    title: "Proposed care", notes: "", terms: "Synthetic terms", currency: "usd", total_cents: "188",
    lines: [{ line: { id: id(5), product_id: id(6), product_version: 1, description: "Service", kind: "service", unit: "visit",
      quantity: "1.5", pricing: { kind: "unit", unit_price_cents: "125" }, pricing_reason: null }, amount_cents: "188" }],
    acceptance: { accept_by: "2026-10-31", timezone: "America/Denver", expires_at: "2026-11-01T06:00:00Z",
      acknowledgment_version: 1, scope: "entire_exact_revision", price_validity: "accepted_quantities", not_clinical_consent: true, not_payment: true },
  };
}

test("retained artifact is deterministic UTF-8 with exact digest and canonical identity", async () => {
  const input = snapshot(); input.client.name = "Synthetic Zoë 🐾";
  const first = await estimatePublicationArtifact(input);
  assert.deepEqual(await estimatePublicationArtifact(structuredClone(input)), first);
  assert.equal(first.artifact.byte_length, Buffer.byteLength(first.html));
  assert.equal(first.artifact.sha256, createHash("sha256").update(first.html, "utf8").digest("hex"));
  assert.equal(first.artifact.filename, `estimate-${id(2)}-draft-2-publication-${id(1)}.html`);
  assert.match(first.html, /not clinical consent/);
  assert.match(first.html, /not performance of previously accepted quantities/);
  assert.doesNotMatch(first.html, /Published at|<button|<form|<script|<iframe|<a\s|<img/);
});

test("untrusted display and pricing text remain escaped under restrictive CSP", () => {
  const input = snapshot();
  input.title = '<script>alert("x")</script>';
  input.client.name = '<img src=x onerror="alert(1)">';
  input.patient.name = "A & B's pet";
  input.terms = '</p><iframe src="https://example.invalid"></iframe>';
  input.lines[0].line.pricing_reason = '<a href="javascript:alert(1)">special</a>';
  const html = renderEstimatePublication(input);
  assert.match(html, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/);
  assert.match(html, /A &amp; B&#39;s pet/);
  assert.match(html, /default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'/);
  assert.doesNotMatch(html, /<script|<img|<iframe|<a\s/);
});

test("renderer agrees with draft exact arithmetic including allocations and large cents", () => {
  for (const [quantity, price] of [["0.5", "1"], ["1.5", "125"], ["1", "9007199254740993"], ["0.001", "1"]]) {
    const input = snapshot(), line = input.lines[0].line;
    line.quantity = quantity; line.pricing = { kind: "unit", unit_price_cents: price }; line.pricing_reason = "Reviewed amount";
    input.lines[0].amount_cents = input.total_cents = estimateLineCents(line);
    assert.equal(estimatePublicationSnapshotSchema.safeParse(input).success, true);
    assert.ok(renderEstimatePublication(input).includes("Estimate total"));
  }
  const allocated = snapshot();
  allocated.lines[0].line.pricing = { kind: "allocated", amount_cents: "99" };
  allocated.lines[0].line.pricing_reason = "Package allocation";
  allocated.lines[0].amount_cents = allocated.total_cents = "99";
  assert.match(renderEstimatePublication(allocated), /Allocated line total/);
  assert.match(renderEstimatePublication(allocated), /Package allocation/);
  allocated.lines[0].line.pricing_reason = null;
  assert.equal(estimatePublicationSnapshotSchema.safeParse(allocated).success, false);
});

test("Denver deadline validation follows both daylight-saving transitions", () => {
  for (const [acceptBy, expiresAt] of [
    ["2026-03-07", "2026-03-08T07:00:00Z"], ["2026-03-08", "2026-03-09T06:00:00Z"],
    ["2026-10-31", "2026-11-01T06:00:00Z"], ["2026-11-01", "2026-11-02T07:00:00Z"],
  ]) {
    const input = snapshot(); input.prepared_at = "2026-01-01T00:00:00Z";
    input.acceptance.accept_by = acceptBy; input.acceptance.expires_at = expiresAt;
    assert.equal(estimatePublicationSnapshotSchema.safeParse(input).success, true, expiresAt);
    input.acceptance.expires_at = new Date(Date.parse(expiresAt) + 3600000).toISOString();
    assert.equal(estimatePublicationSnapshotSchema.safeParse(input).success, false);
  }
  const input = snapshot(); input.acceptance.expires_at = "2026-11-01T00:00:00-06:00";
  assert.equal(estimatePublicationSnapshotSchema.safeParse(input).success, true);
  input.acceptance.expires_at = "2026-11-01T06:00:00.000001Z";
  assert.equal(estimatePublicationSnapshotSchema.safeParse(input).success, false);
});

test("invalid, expanded and inconsistent snapshots fail closed without parser crashes", () => {
  const mutations: Array<(value: EstimatePublicationSnapshot) => void> = [
    value => { value.client.id = id(99); }, value => { value.patient.id = id(99); },
    value => { value.total_cents = "187"; }, value => { value.lines[0].amount_cents = "187"; },
    value => { value.lines.push(structuredClone(value.lines[0])); value.total_cents = "376"; },
    value => { value.lines[0].line.quantity = "1e2"; }, value => { value.total_cents = "NaN"; },
    value => { value.lines[0].line.pricing = { kind: "unit", unit_price_cents: "NaN" }; },
    value => { value.acceptance.accept_by = "2026-02-30"; }, value => { value.acceptance.expires_at = "not-a-date"; },
    value => { value.prepared_at = value.acceptance.expires_at; }, value => { value.title = "Bad\u0001title"; },
    value => { value.title = "Broken \ud800"; }, value => { value.title = "Broken \udfff"; },
    value => { Object.assign(value.practice, { phone: "invented" }); }, value => { Object.assign(value, { accepted: true }); },
  ];
  for (const mutate of mutations) {
    const input = snapshot(); mutate(input);
    assert.equal(estimatePublicationSnapshotSchema.safeParse(input).success, false);
    assert.throws(() => renderEstimatePublication(input));
  }
});

test("source display widths and exact int64 bounds match retained database evidence", () => {
  const input = snapshot(); input.patient.breed = "b".repeat(150); input.client.mailing_address = "a".repeat(1000);
  assert.equal(estimatePublicationSnapshotSchema.safeParse(input).success, true);
  input.patient.breed += "b";
  assert.equal(estimatePublicationSnapshotSchema.safeParse(input).success, false);
  input.patient.breed = null; input.client.mailing_address += "a";
  assert.equal(estimatePublicationSnapshotSchema.safeParse(input).success, false);
  const maximum = snapshot(); maximum.lines[0].line.quantity = "1";
  maximum.lines[0].line.pricing = { kind: "unit", unit_price_cents: "9223372036854775807" };
  maximum.lines[0].amount_cents = maximum.total_cents = "9223372036854775807";
  assert.match(renderEstimatePublication(maximum), /\$92,233,720,368,547,758\.07/);
  maximum.lines.push({ ...structuredClone(snapshot().lines[0]), line: { ...snapshot().lines[0].line, id: id(99) } });
  assert.equal(estimatePublicationSnapshotSchema.safeParse(maximum).success, false);
  const zero = snapshot(); zero.lines[0].line.quantity = "0.001";
  zero.lines[0].line.pricing = { kind: "unit", unit_price_cents: "1" };
  zero.lines[0].amount_cents = zero.total_cents = "0";
  assert.equal(estimatePublicationSnapshotSchema.safeParse(zero).success, false);
  zero.lines[0].line.pricing_reason = "Reviewed zero charge";
  assert.equal(estimatePublicationSnapshotSchema.safeParse(zero).success, true);
});

test("maximum supported text renders within the artifact budget after HTML escaping", async () => {
  const input = snapshot();
  input.title = '"'.repeat(200); input.notes = '"'.repeat(4000); input.terms = '"'.repeat(8000);
  input.lines = Array.from({ length: 100 }, (_, index) => ({
    line: { ...snapshot().lines[0].line, id: id(index + 100), description: '"'.repeat(300), unit: '"'.repeat(50), pricing_reason: '"'.repeat(2000) },
    amount_cents: "188",
  }));
  input.total_cents = "18800";
  const { artifact, html } = await estimatePublicationArtifact(input);
  assert.ok(artifact.byte_length > 1000000);
  assert.ok(artifact.byte_length <= 2097152);
  assert.equal(Buffer.from(html).toString("utf8"), html);
});
