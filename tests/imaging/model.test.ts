import { test } from "node:test";
import assert from "node:assert/strict";
import { actionSchema, cancellationSchema, detailSchema, emptyValues, historySchema, parsePending, pendingSchema, revisionSchema, validateSources, valuesSchema, verifyDetail, verifyReceipt, viewerUrlSchema, type ImagingAction, type ImagingDetail, type ImagingValues } from "../../src/hub/features/imaging/model.ts";

const id = (value: number) => `c8100000-0000-4000-8000-${String(value).padStart(12, "0")}`;
function values(): ImagingValues {
  return { ...emptyValues(), account_label: "Synthetic clinic", vendor_patient_id: "PATIENT-123", external_study_id: "STUDY-123", study_date: "2026-10-16", description: "Thorax", viewer_url: "https://synthetic.vetrocket.net/view.html?link=synthetic_123", identity_verified: true, review_note: "Matched vendor patient and study IDs" };
}
function action(): ImagingAction { return { actor_id: id(1), action_id: id(2), id: id(3), pet_id: id(4), expected_version: null, kind: "record", values: values(), reason: "" }; }
function detail(): ImagingDetail {
  return { study: { id: id(3), pet_id: id(4), version: 1, values: values(), status: "recorded", created_by: id(1), updated_by: id(1), created_at: "2026-10-16T10:00:00+00:00", updated_at: "2026-10-16T10:00:00+00:00" }, report_available: null };
}
test("VetRocket link family accepts exact clinic share links and full supported token capacity", () => {
  for (const host of ["a", "clinic-123", "a".repeat(63)]) {
    const link = `https://${host}.vetrocket.net/view.html?link=${"a".repeat(1800)}`;
    assert.equal(viewerUrlSchema.parse(link), link);
  }
});
test("viewer validation rejects credentials, extra parameters, tracking, redirects and alternate protocols/hosts", () => {
  for (const url of [
    "http://clinic.vetrocket.net/view.html?link=synthetic123", "javascript:alert(1)", "https://vetrocket.net/view.html?link=synthetic123",
    "https://clinic.vetrocket.net.evil.test/view.html?link=synthetic123", "https://clinic.evil.test/view.html?link=synthetic123",
    "https://user:secret@clinic.vetrocket.net/view.html?link=synthetic123", "https://clinic.vetrocket.net:443/view.html?link=synthetic123",
    "https://clinic.vetrocket.net/view.html?link=synthetic123&other=1", "https://clinic.vetrocket.net/view.html?link=synthetic123#fragment",
    "https://clinic.vetrocket.net/view.html?link=short", "https://CLINIC.vetrocket.net/view.html?link=synthetic123",
    "https://-clinic.vetrocket.net/view.html?link=synthetic123", "https://clinic-.vetrocket.net/view.html?link=synthetic123",
    "https://clinic.other.vetrocket.net/view.html?link=synthetic123", "https://clinic.vetrocket.net/view.html?link=synthetic%2F123",
    `https://${"a".repeat(64)}.vetrocket.net/view.html?link=synthetic123`, `https://clinic.vetrocket.net/view.html?link=${"a".repeat(1801)}`,
    " https://clinic.vetrocket.net/view.html?link=synthetic123", "https://clinic.vetrocket.net/view.html?link=synthetic123\n",
  ]) assert.equal(viewerUrlSchema.safeParse(url).success, false, "Unsupported viewer link must be rejected");
});
test("study date requires a real complete calendar date without timezone conversion", () => {
  for (const date of ["2024-02-29", "0001-01-01", "9999-12-31"]) assert.equal(valuesSchema.parse({ ...values(), study_date: date }).study_date, date);
  for (const date of ["2026-02-29", "2026-02-30", "0000-01-01", "2026-1-1", "2026-13-01", "2026-10-16T00:00:00Z", ""]) assert.equal(valuesSchema.safeParse({ ...values(), study_date: date }).success, false);
});
test("identity attestation, exact labels and documentary bounds cannot be bypassed", () => {
  assert.equal(valuesSchema.safeParse({ ...values(), identity_verified: false }).success, false);
  for (const field of ["account_label", "vendor_patient_id", "external_study_id", "description", "review_note"] as const) {
    for (const value of ["", " ", " trailing ", "two\nlines", "bad\u0000value"]) assert.equal(valuesSchema.safeParse({ ...values(), [field]: value }).success, false);
  }
  assert.equal(valuesSchema.safeParse({ ...values(), accession: "bad\taccession" }).success, false);
  assert.equal(valuesSchema.safeParse({ ...values(), body_region: "bad\u007fregion" }).success, false);
  assert.equal(valuesSchema.safeParse({ ...values(), account_label: "a".repeat(161) }).success, false);
  assert.equal(valuesSchema.safeParse({ ...values(), review_note: "a".repeat(2001) }).success, false);
  assert.equal(valuesSchema.safeParse({ ...values(), arbitrary_identity: id(99) }).success, false);
});
test("source IDs require their exact versions together", () => {
  for (const source of ["encounter", "document"] as const) {
    assert.equal(valuesSchema.safeParse({ ...values(), [`${source}_id`]: id(10) }).success, false);
    assert.equal(valuesSchema.safeParse({ ...values(), [`${source}_version`]: 1 }).success, false);
    assert.equal(valuesSchema.safeParse({ ...values(), [`${source}_id`]: id(10), [`${source}_version`]: 0 }).success, false);
    assert.equal(valuesSchema.safeParse({ ...values(), [`${source}_id`]: id(10), [`${source}_version`]: 1 }).success, true);
  }
});
test("create, correct and void have distinct strict state transitions", () => {
  assert.equal(actionSchema.safeParse(action()).success, true);
  for (const change of [{ expected_version: 1 }, { values: null }, { reason: "Unrequested reason" }, { actor: id(1) }]) assert.equal(actionSchema.safeParse({ ...action(), ...change }).success, false);
  const correction = { ...action(), kind: "correct", expected_version: 1, reason: "Updated report" };
  assert.equal(actionSchema.safeParse(correction).success, true);
  for (const change of [{ expected_version: null }, { reason: "" }, { reason: " trailing " }, { values: null }]) assert.equal(actionSchema.safeParse({ ...correction, ...change }).success, false);
  const voiding = { ...correction, kind: "void", values: null };
  assert.equal(actionSchema.safeParse(voiding).success, true);
  assert.equal(actionSchema.safeParse({ ...voiding, values: values() }).success, false);
});
test("parsed saved intent retains UUID and exact payload but must be recovered again after refresh", () => {
  const pending = pendingSchema.parse({ action: action(), state: "not_saved" });
  const restored = parsePending(JSON.stringify(pending), id(1), id(4));
  assert.equal(restored.state, "uncertain");
  assert.deepEqual(restored.action, action());
  assert.throws(() => parsePending(JSON.stringify(pending), id(99), id(4)));
  assert.throws(() => parsePending(JSON.stringify(pending), id(1), id(99)));
  assert.throws(() => parsePending("not JSON", id(1), id(4)));
  assert.throws(() => parsePending(JSON.stringify({ ...pending, action: { ...action(), values: { ...values(), identity_verified: false } } }), id(1), id(4)));
});
test("cancellation acknowledges a durable cancellation or the existing committed receipt, never neither or both", () => {
  assert.equal(cancellationSchema.safeParse({ cancelled: true, receipt: null }).success, true);
  assert.equal(cancellationSchema.safeParse({ cancelled: false, receipt: detail() }).success, true);
  assert.equal(cancellationSchema.safeParse({ cancelled: false, receipt: null }).success, false);
  assert.equal(cancellationSchema.safeParse({ cancelled: true, receipt: detail() }).success, false);
  assert.equal(cancellationSchema.safeParse({ cancelled: true, receipt: null, original_request_pending: true }).success, false);
});
test("response identity validation rejects a sibling or another study", () => {
  assert.deepEqual(verifyDetail(detail(), id(4), id(3)), detail());
  assert.throws(() => verifyDetail(detail(), id(5), id(3)));
  assert.throws(() => verifyDetail(detail(), id(4), id(5)));
  assert.throws(() => verifyDetail({ ...detail(), secret: "extra field" }, id(4), id(3)));
});
test("save receipts must match actor, operation, version and the complete reviewed intent", () => {
  assert.deepEqual(verifyReceipt(detail(), action()), detail());
  for (const change of [{ updated_by: id(99) }, { created_by: id(99) }, { version: 2 }, { status: "void" }, { values: { ...values(), accession: "Changed" } }]) assert.throws(() => verifyReceipt({ ...detail(), study: { ...detail().study, ...change } }, action()));
  const correction = { ...action(), kind: "correct" as const, expected_version: 1, reason: "Corrected report" };
  assert.equal(verifyReceipt({ ...detail(), study: { ...detail().study, version: 2 } }, correction).study.version, 2);
  const voiding = { ...correction, kind: "void" as const, values: null };
  assert.equal(verifyReceipt({ ...detail(), study: { ...detail().study, version: 2, status: "void" } }, voiding).study.status, "void");
});
test("report availability is explicit and cannot claim a report without a source", () => {
  assert.equal(detailSchema.safeParse({ ...detail(), report_available: true }).success, false);
  const attached = { ...detail(), study: { ...detail().study, values: { ...values(), document_id: id(20), document_version: 1 } } };
  assert.equal(detailSchema.safeParse(attached).success, false);
  assert.equal(detailSchema.safeParse({ ...attached, report_available: true }).success, true);
  assert.equal(detailSchema.safeParse({ ...attached, report_available: false }).success, true);
});
test("history snapshot identity, patient, version and actor must agree", () => {
  const revision = { study_id: id(3), pet_id: id(4), version: 1, snapshot: detail().study, reason: "", actor_id: id(1), session_id: id(7), created_at: "2026-10-16T10:00:00Z" };
  assert.equal(revisionSchema.safeParse(revision).success, true);
  for (const change of [{ study_id: id(9) }, { pet_id: id(9) }, { version: 2 }, { actor_id: id(9) }]) assert.equal(revisionSchema.safeParse({ ...revision, ...change }).success, false);
  assert.equal(historySchema.safeParse({ items: Array(21).fill(revision), next: null }).success, false);
});
test("selected PDF must be current and belong to the selected patient and encounter", () => {
  const linked = { ...values(), encounter_id: id(10), encounter_version: 3, document_id: id(20), document_version: 2 };
  const sources = { encounters: [{ id: id(10), pet_id: id(4), version: 3 }], documents: [{ id: id(20), pet_id: id(4), version: 2, encounter_id: id(10) }] };
  assert.doesNotThrow(() => validateSources(linked, id(4), sources));
  assert.throws(() => validateSources({ ...linked, encounter_version: 2 }, id(4), sources));
  assert.throws(() => validateSources({ ...linked, document_version: 1 }, id(4), sources));
  assert.throws(() => validateSources(linked, id(99), sources));
  assert.throws(() => validateSources({ ...linked, encounter_id: null, encounter_version: null }, id(4), sources));
  assert.doesNotThrow(() => validateSources({ ...linked, encounter_id: null, encounter_version: null }, id(4), { ...sources, documents: [{ ...sources.documents[0], encounter_id: null }] }));
});
