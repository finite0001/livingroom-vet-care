import assert from "node:assert/strict";
import test from "node:test";
import { captureClinicalCallTranscript } from "../../supabase/functions/_shared/clinical-call-handler.ts";
import {
  CALL_NOTE_PAYLOAD_CONTRACT, assembleCallNoteSections, callNotePayloadSchema,
  validateCallNotePayload,
} from "../../supabase/functions/_shared/clinical-call-note-model.ts";

const template = {
  name: "Synthetic call", detail: "concise",
  fields: [
    { id: "history", label: "History", destination: "subjective", instructions: "", required: true },
    { id: "plan", label: "Plan", destination: "plan", instructions: "", required: true },
  ],
};
async function fixture(texts = [
  "Owner reports Luna 🐕 vomited twice. Yesterday she skipped breakfast. No medication was given.",
  "Correction: Luna vomited once, not twice; Milo coughed.",
  "We discussed a recheck; it was not scheduled. Same words. Same words.",
]) {
  const source = await captureClinicalCallTranscript("700013", "synthetic-only", async () => new Response(JSON.stringify({
    data: { callId: 700013, language: "en", callers: [
      { type: "contact", id: null, localIdentifier: "original-owner" },
      { type: "agent", id: 12, localIdentifier: "original-receiver" },
    ], segments: texts.map((text, index) => ({ text, caller: index === 2 ? "original-receiver" : "original-owner",
      start: index === 1 ? 1 : index + 1, end: index + 3 })) },
    pagination: { total: texts.length, offset: 0, limit: 100 },
  }), { headers: { "content-type": "application/json" } }), () => 1000000);
  const cite = (ordinal: number, quote: string, from?: number) => {
    const segment = source.segments[ordinal - 1];
    const start = from ?? segment.text.indexOf(quote);
    assert.ok(start >= 0);
    return { segment_ordinal: ordinal, segment_sha256: segment.text_sha256,
      from: start, to: start + quote.length, quote };
  };
  const payload = callNotePayloadSchema.parse({ contract_version: CALL_NOTE_PAYLOAD_CONTRACT, fields: [
    { field_id: "history", status: "supported", uncertainty: "", claims: [
      { text: "Owner corrected the report to one vomiting episode.", patient_scope: "selected_patient",
        supports: [cite(2, texts[1].includes("Luna vomited") ? "Luna vomited once, not twice" : texts[1])] },
    ] },
    { field_id: "plan", status: "supported", uncertainty: "", claims: [
      { text: "A recheck was discussed and was not scheduled.", patient_scope: "selected_patient",
        supports: [cite(3, texts[2])] },
    ] },
  ], review_flags: ["Synthetic source; clinician must review patient and speaker attribution."] });
  return { source, payload, cite };
}

test("call claims retain exact original segments and overlapping speaker times", async () => {
  const { source, payload, cite } = await fixture();
  payload.fields[0].claims[0].supports.push(cite(1, "vomited twice"));
  const before = structuredClone(source);
  assert.deepEqual(await validateCallNotePayload(payload, source, template), payload);
  assert.deepEqual(source, before);
  assert.equal(source.segments[0].start, source.segments[1].start);
  assert.equal(source.segments[2].caller, "original-receiver");
  assert.deepEqual(await assembleCallNoteSections(payload, source, template), {
    subjective: "History:\nOwner corrected the report to one vomiting episode.", objective: "", assessment: "",
    plan: "Plan:\nA recheck was discussed and was not scheduled.",
  });
});
test("repeated excerpts require explicit retained ranges; Unicode uses UTF16 offsets", async () => {
  const { source, payload, cite } = await fixture();
  const repeated = source.segments[2].text.lastIndexOf("Same words.");
  payload.fields[1].claims[0].supports = [cite(3, "Same words.", repeated)];
  payload.fields[0].claims[0].supports = [cite(1, "🐕")];
  assert.equal(payload.fields[0].claims[0].supports[0].to - payload.fields[0].claims[0].supports[0].from, 2);
  await validateCallNotePayload(payload, source, template);
  const bad = structuredClone(payload);
  bad.fields[0].claims[0].supports[0].from++;
  bad.fields[0].claims[0].supports[0].quote = "\udc15";
  await assert.rejects(validateCallNotePayload(bad, source, template));
});
test("each claim must have its own matching support; another claim cannot supply it", async () => {
  const { source, payload } = await fixture();
  payload.fields[0].claims.push({ ...structuredClone(payload.fields[0].claims[0]), supports: [] });
  await assert.rejects(validateCallNotePayload(payload, source, template));
});
test("wrong segment, hash, quote, offset, repeated support and zero-width ranges are refused", async () => {
  const { source, payload } = await fixture();
  for (const change of [
    { segment_ordinal: 3 }, { segment_ordinal: 1000 }, { segment_sha256: "b".repeat(64) },
    { from: 0 }, { from: -1 }, { from: 1.5 }, { to: 60001 }, { to: 1 }, { quote: "not in this call" },
  ]) {
    const bad = structuredClone(payload);
    Object.assign(bad.fields[0].claims[0].supports[0], change);
    await assert.rejects(validateCallNotePayload(bad, source, template));
  }
  payload.fields[0].claims[0].supports.push(structuredClone(payload.fields[0].claims[0].supports[0]));
  await assert.rejects(validateCallNotePayload(payload, source, template));
});
test("projection headers and invented speaker/time metadata are not citation evidence", async () => {
  const { source, payload } = await fixture();
  const claim = payload.fields[0].claims[0];
  for (const extra of [{ caller: "Dr Susan" }, { start: 42 }, { event_date: "2026-10-17" }, { url: "https://example.invalid" }]) {
    const bad = structuredClone(payload);
    Object.assign(bad.fields[0].claims[0].supports[0], extra);
    await assert.rejects(validateCallNotePayload(bad, source, template));
  }
  claim.supports[0] = { ...claim.supports[0], from: 0, to: 6, quote: "[#0001" };
  await assert.rejects(validateCallNotePayload(payload, source, template));
});
test("retained segment hashes, ordering, speakers, projection offsets and projection are checked", async () => {
  const { source, payload } = await fixture();
  for (const mutate of [
    (s: typeof source) => { s.segments[0].text += "changed"; },
    (s: typeof source) => { s.segments[0].text_sha256 = "b".repeat(64); },
    (s: typeof source) => { s.segments[1].ordinal = 1; },
    (s: typeof source) => { s.segments[0].caller = "invented-doctor"; },
    (s: typeof source) => { s.segments[1].start = 0; },
    (s: typeof source) => { s.segments[0].end = 0; },
    (s: typeof source) => { s.segments[0].projection_from++; },
    (s: typeof source) => { s.segments[0].projection_to--; },
    (s: typeof source) => { s.projection += "changed"; },
    (s: typeof source) => { s.callers.push(s.callers[0]); },
  ]) {
    const bad = structuredClone(source); mutate(bad);
    await assert.rejects(validateCallNotePayload(payload, bad, template));
  }
});
test("other-patient and unassigned claims remain private and never enter proposed chart sections", async () => {
  const { source, payload, cite } = await fixture();
  payload.fields[0].claims.push({ text: "Milo coughed.", patient_scope: "other_patient", supports: [cite(2, "Milo coughed")] });
  payload.fields[0].claims.push({ text: "Patient attribution unresolved.", patient_scope: "unassigned", supports: [cite(1, "Yesterday she skipped breakfast.")] });
  const checked = await validateCallNotePayload(payload, source, template);
  assert.equal(checked.fields[0].claims.length, 3);
  const sections = await assembleCallNoteSections(payload, source, template);
  assert.equal(sections.subjective, "History:\nOwner corrected the report to one vomiting episode.");
  assert.equal(JSON.stringify(sections).includes("segment_sha256"), false);
  assert.equal(JSON.stringify(sections).includes("original-owner"), false);
});
test("field order, missing fields, status consistency and empty eligible output fail closed", async () => {
  const { source, payload } = await fixture();
  const reversed = structuredClone(payload); reversed.fields.reverse();
  await assert.rejects(validateCallNotePayload(reversed, source, template));
  await assert.rejects(validateCallNotePayload({ ...payload, fields: payload.fields.slice(0, 1) }, source, template));
  for (const change of [
    { status: "missing" }, { status: "uncertain", uncertainty: "" },
    { status: "supported", uncertainty: "ambiguous" },
  ]) {
    const bad = structuredClone(payload); Object.assign(bad.fields[0], change);
    await assert.rejects(validateCallNotePayload(bad, source, template));
  }
  for (const field of payload.fields) for (const claim of field.claims) claim.patient_scope = "unassigned";
  await assert.rejects(validateCallNotePayload(payload, source, template));
});
test("missing required data remains missing and uncertainty is retained without invented findings", async () => {
  const { source, payload } = await fixture();
  payload.fields[0] = { field_id: "history", status: "missing", uncertainty: "", claims: [] };
  payload.fields[1].status = "uncertain"; payload.fields[1].uncertainty = "Original speaker role is unknown.";
  const checked = await validateCallNotePayload(payload, source, template);
  assert.equal(checked.fields[1].uncertainty, "Original speaker role is unknown.");
  assert.equal((await assembleCallNoteSections(payload, source, template)).subjective, "");
});
test("claim and citation budgets include private nonselected claims and enforce UTF8 bytes", async () => {
  const { source, payload, cite } = await fixture();
  const definition = { ...template, fields: ["subjective", "objective", "assessment", "plan"].map((destination, i) => ({
    id: `field_${i}`, label: `Field ${i}`, destination, instructions: "", required: false,
  })) };
  const many = callNotePayloadSchema.parse({ ...payload, fields: definition.fields.map((f) => ({
    field_id: f.id, status: "supported", uncertainty: "", claims: Array.from({ length: 24 }, () => ({
      text: "Synthetic patient report.", patient_scope: "selected_patient",
      supports: [cite(1, "vomited twice"), cite(2, "Luna vomited once, not twice")],
    })),
  })) });
  await validateCallNotePayload(many, source, definition); // 96 claims / 192 supports.
  const tooMany = structuredClone(many); tooMany.fields[0].claims[0].supports.push(cite(3, "Same words."));
  await assert.rejects(validateCallNotePayload(tooMany, source, definition));
  const sectionOverflow = structuredClone(definition); sectionOverflow.fields[1].destination = "subjective";
  await assert.rejects(validateCallNotePayload(many, source, sectionOverflow));
  const privateOverflow = structuredClone(many);
  for (const claim of privateOverflow.fields[1].claims) claim.patient_scope = "other_patient";
  await assert.rejects(validateCallNotePayload(privateOverflow, source, sectionOverflow));
  const big = await fixture(["猫".repeat(1000), "犬".repeat(1000), "Synthetic discussion."]);
  for (const field of many.fields) for (const claim of field.claims) claim.supports = [big.cite(1, big.source.segments[0].text), big.cite(2, big.source.segments[1].text)];
  await assert.rejects(validateCallNotePayload(many, big.source, definition), /byte budget/);
});
test("unknown payload fields, legacy payloads and invalid UTF16 strings are rejected", async () => {
  const { source, payload } = await fixture();
  await assert.rejects(validateCallNotePayload({ fields: payload.fields, review_flags: [] }, source, template));
  await assert.rejects(validateCallNotePayload({ ...payload, source_id: crypto.randomUUID() }, source, template));
  for (const value of ["\ud800", "\udc00", "\0", " ", "x".repeat(501)]) {
    const bad = structuredClone(payload); bad.fields[0].claims[0].text = value;
    await assert.rejects(validateCallNotePayload(bad, source, template));
  }
});
