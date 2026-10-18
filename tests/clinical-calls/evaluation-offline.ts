import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { captureClinicalCallTranscript } from "../../supabase/functions/_shared/clinical-call-handler.ts";
import { callSha256 } from "../../supabase/functions/_shared/clinical-call-model.ts";
import { assembleCallNoteSections } from "../../supabase/functions/_shared/clinical-call-note-model.ts";
import { CALL_NOTE_PROVIDER_PAYLOAD_CONTRACT, CALL_NOTE_PROVIDER_LIMITS, callNoteProviderContextSchema, clinicalCallNoteRequest, parseClinicalCallNoteResponse } from "../../supabase/functions/_shared/clinical-call-note-provider.ts";
import { veterinaryContextReceipt } from "../../supabase/functions/_shared/clinical-veterinary-context.ts";
import { CALL_EVALUATION_CASES, CALL_EVALUATION_REVISION } from "./evaluation-corpus.ts";

export const EVALUATION_MODEL = "gpt-6-luna";
const revision = "lrv-call-fidelity-offline-v2";
const now = "2026-12-01T12:00:00.000Z";
export const EVALUATION_SOURCE_FILES = [
  "tests/clinical-calls/evaluation-corpus.ts", "tests/clinical-calls/evaluation-offline.ts",
  "tests/clinical-calls/evaluation-cli.ts", "tests/clinical-calls/evaluation-offline.test.ts", "package-lock.json",
  "supabase/functions/_shared/clinical-audio-model.ts",
  "supabase/functions/_shared/clinical-call-handler.ts", "supabase/functions/_shared/clinical-call-model.ts",
  "supabase/functions/_shared/clinical-call-note-model.ts", "supabase/functions/_shared/clinical-call-note-provider.ts",
  "supabase/functions/_shared/clinical-call-note-handler.ts", "supabase/functions/_shared/clinical-call-note-processing-model.ts",
  "supabase/functions/_shared/clinical-note-model.ts", "supabase/functions/_shared/clinical-veterinary-context.ts",
];
export const exactSha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const hashJson = (value: unknown) => exactSha256(JSON.stringify(value));
const fixtureId = (index: number, family: number) => `109a2600-0000-4000-8000-${String(family * 100 + index).padStart(12, "0")}`;
export async function buildFrozenCallBundle() {
  const cases = [];
  for (const [index, fixture] of CALL_EVALUATION_CASES.entries()) {
    const callId = String(710000 + index), pet = fixtureId(index, 1), client = fixtureId(index, 2), conversation = fixtureId(index, 3);
    let adapterCalls = 0;
    const document = await captureClinicalCallTranscript(callId, "fictional-local-stub-only", async () => {
      adapterCalls++;
      return new Response(JSON.stringify({ data: { callId: Number(callId), language: "en", callers: [
        { type: "contact", id: null, localIdentifier: "household-contact" },
        { type: "agent", id: 81, localIdentifier: "practice-agent" },
      ], segments: fixture.segments.map((segment, n) => ({ start: n * 20, end: n * 20 + 19, ...segment })) },
      pagination: { total: fixture.segments.length, offset: 0, limit: 100 } }), { headers: { "content-type": "application/json" } });
    }, () => Date.parse(now));
    assert.equal(adapterCalls, 2);
    const sourceContext = { client_id: client, conversation_id: conversation, message_id: fixtureId(index, 4),
      call_uuid: "fictional-fidelity-" + fixture.id, call_id: callId, call_started_at: fixture.started_at,
      call_ended_at: fixture.ended_at, call_last_event_at: fixture.ended_at, inbound_version: 1 };
    const definition = { name: "Fictional call fidelity SOAP", detail: "standard", fields: [
      { id: "history", label: "History", destination: "subjective", instructions: "Retain speaker, pet, temporal and correction context.", required: true },
      { id: "findings", label: "Findings", destination: "objective", instructions: "Do not fabricate examination or measurements.", required: true },
      { id: "assessment", label: "Assessment", destination: "assessment", instructions: "Only explicitly supported assessment; preserve uncertainty.", required: true },
      { id: "plan", label: "Plan", destination: "plan", instructions: "Preserve planned, declined, discussed and not-given status.", required: true },
    ] };
    const context = callNoteProviderContextSchema.parse({ job_id: fixtureId(index, 5), source: {
      id: fixtureId(index, 6), capture_id: fixtureId(index, 7), actor_id: fixtureId(index, 8), pet_id: pet,
      encounter_id: fixtureId(index, 9), client_id: client, conversation_id: conversation,
      call_uuid: sourceContext.call_uuid, call_id: callId, policy_version: 2, context: sourceContext, document,
      sha256: hashJson({ context: sourceContext, document }), created_at: now,
    }, projection_sha256: await callSha256(document.projection), patient: { id: pet, name: "Luna", species: "canine" },
    template: { id: fixtureId(0, 10), version: 1, sha256: hashJson(definition), status: "approved", definition },
    model: EVALUATION_MODEL, note_policy_version: 2, call_generation_policy_version: 2 });
    const request = await clinicalCallNoteRequest(context), requestJson = JSON.stringify(request);
    for (const fact of [...fixture.required, ...fixture.forbidden]) {
      assert.ok(fact.segments.length && new Set(fact.segments).size === fact.segments.length);
      assert.ok(fact.segments.every((ordinal) => !!document.segments[ordinal - 1]));
    }
    const negativePayload = { contract_version: CALL_NOTE_PROVIDER_PAYLOAD_CONTRACT, fields: definition.fields.map((field, n) => ({
      field_id: field.id, status: n === 0 ? "supported" : "missing", uncertainty: "", claims: n === 0 ? [{
        text: fixture.negative_control.text, patient_scope: "selected_patient",
        supports: fixture.negative_control.segments.map((ordinal) => {
          const segment = document.segments[ordinal - 1];
          return { segment_ordinal: ordinal, quote: segment.text };
        }),
      }] : [],
    })), review_flags: [] };
    const negativeEnvelope = syntheticEnvelope(negativePayload);
    await parseClinicalCallNoteResponse(negativeEnvelope, context, { response_sha256: exactSha256(JSON.stringify(negativeEnvelope)) });
    cases.push({ id: fixture.id, title: fixture.title, context, request_json: requestJson,
      request_sha256: exactSha256(requestJson), inventory: { required: fixture.required, forbidden: fixture.forbidden },
      veterinary_context: await veterinaryContextReceipt(request), semantic_negative_control: {
        payload: negativePayload, structural_result: "pass", semantic_expected: "fail", reason: fixture.negative_control.reason,
      } });
  }
  const body = { contract: revision, corpus_revision: CALL_EVALUATION_REVISION, synthetic_only: true, provider_requests: 0,
    requested_model: EVALUATION_MODEL, model_snapshot_claim: false,
    provenance: "Offline fictional context built through injected production capture adapter. SHA256 values bind fixture bytes only; no SQL authority, hosted capture, clinical approval or provider result is asserted.",
    source_sha256: Object.fromEntries(EVALUATION_SOURCE_FILES.map((file) => [file, exactSha256(readFileSync(new URL("../../" + file, import.meta.url), "utf8"))])), cases };
  return { ...body, bundle_sha256: hashJson(body) };
}
export type FrozenCallBundle = Awaited<ReturnType<typeof buildFrozenCallBundle>>;
export function syntheticEnvelope(payload: unknown) {
  return { id: "resp_fictional_negative_control", model: "fictional-returned-alias", status: "completed", error: null, incomplete_details: null,
    output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify(payload) }] }] };
}
/** Byte-exact request and corpus agreement with current checked-in inputs is required. */
export async function verifyFrozenCallBundle(input: unknown): Promise<FrozenCallBundle> {
  const shape = z.object({ bundle_sha256: z.string().regex(/^[a-f0-9]{64}$/) }).passthrough().parse(input);
  const { bundle_sha256, ...body } = shape;
  assert.equal(hashJson(body), bundle_sha256, "Frozen bundle content digest differs.");
  const expected = await buildFrozenCallBundle();
  assert.ok(isDeepStrictEqual(input, expected), "Frozen corpus, context, code or request differs from this revision.");
  return expected;
}
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const nonblank = z.string().min(1).max(4000).refine((s) => !!s.trim());
const rawBase64 = z.string().max(2666668).refine((value) => Buffer.from(value, "base64").toString("base64") === value && Buffer.from(value, "base64").byteLength <= 2000000, "Canonical exact-body base64 is required.");
const responseOutcome = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("http"), status: z.number().int().min(100).max(599), request_id: z.string().max(300), raw_body_base64: rawBase64 }).strict(),
  z.object({ kind: z.literal("transport_error"), error: nonblank }).strict(),
]);
export const callEvaluationRawImportSchema = z.object({ contract: z.literal("lrv-call-fidelity-raw-v1"), bundle_sha256: digest,
  cases: z.array(z.object({ case_id: z.string().regex(/^[A-J]$/), request_sha256: digest, outcome: responseOutcome }).strict()).length(10),
}).strict();
export interface ReviewQuestion { id: string; kind: string; instruction: string; evidence_refs: string[] }
export async function createCallReviewPacket(bundleInput: unknown, rawInput: unknown) {
  const bundle = await verifyFrozenCallBundle(bundleInput), raw = callEvaluationRawImportSchema.parse(rawInput);
  assert.equal(raw.bundle_sha256, bundle.bundle_sha256, "Raw import belongs to another bundle.");
  assert.equal(new Set(raw.cases.map((item) => item.case_id)).size, bundle.cases.length, "Exactly one result per frozen case is required; no retries or duplicates.");
  const cases = [], questions: ReviewQuestion[] = [];
  for (const item of bundle.cases) {
    const imported = raw.cases.find((value) => value.case_id === item.id);
    assert.ok(imported, "Missing frozen case.");
    assert.equal(imported.request_sha256, item.request_sha256, "Raw result request differs.");
    let result: Awaited<ReturnType<typeof parseClinicalCallNoteResponse>> | null = null;
    let structuralFailure: string | null = null;
    let rawBodyUtf8: string | null = null;
    const rawBody = imported.outcome.kind === "http" ? Buffer.from(imported.outcome.raw_body_base64, "base64") : null;
    try { if (rawBody) rawBodyUtf8 = new TextDecoder("utf-8", { fatal: true }).decode(rawBody); } catch { /* Exact bytes remain preserved even when UTF8 decoding fails. */ }
    try {
      assert.equal(imported.outcome.kind, "http", "Transport failed.");
      if (imported.outcome.kind !== "http") throw Error("Transport failed.");
      assert.ok(imported.outcome.status >= 200 && imported.outcome.status < 300, "Non-success HTTP status.");
      assert.ok(rawBody && rawBody.byteLength <= CALL_NOTE_PROVIDER_LIMITS.response_bytes, "Original response bytes exceed the production HTTP limit.");
      result = await parseClinicalCallNoteResponse(JSON.parse(z.string().parse(rawBodyUtf8)), item.context,
        { response_sha256: createHash("sha256").update(rawBody!).digest("hex") });
    } catch { structuralFailure = "Transport, HTTP, JSON or production response contract failed; raw outcome retained below. This case cannot pass."; }
    const claims: { id: string; field_id: string; claim: unknown; supports: { id: string; evidence: unknown }[] }[] = [];
    if (result) {
      for (const field of result.payload.fields) for (const [index, claim] of field.claims.entries()) {
        const id = `${item.id}/claim/${field.field_id}/${index + 1}`;
        const supports = claim.supports.map((support, n) => ({ id: `${id}/support/${n + 1}`, evidence: support }));
        claims.push({ id, field_id: field.field_id, claim, supports });
        for (const dimension of ["meaning_and_complete_support", "patient_scope", "speaker_and_observation", "time_and_corrections", "negation_and_treatment_status", "doses_units_and_uncertainty"]) {
          questions.push({ id: `${id}/${dimension}`, kind: "claim", evidence_refs: [id], instruction: `Judge ${dimension} for this whole claim, using only its OWN supports; fail any invented, inverted or unresolved meaning. Equivalent faithful phrasing is allowed.` });
        }
        for (const support of supports) questions.push({ id: support.id, kind: "support", evidence_refs: [support.id], instruction: "Independently explain this exact support's contribution to this claim; literal quotation membership alone is not clinical entailment. Fail misleading or irrelevant support." });
      }
    }
    const evidence = [...claims.map((c) => c.id), ...(result?.payload.review_flags.map((_, n) => `${item.id}/flag/${n + 1}`) ?? [])];
    for (const kind of ["required", "forbidden"] as const) for (const fact of item.inventory[kind]) questions.push({
      id: `${item.id}/${kind}/${fact.id}`, kind, evidence_refs: evidence,
      instruction: kind === "required" ? `Pass only if this meaning is faithfully retained, with attribution and uncertainty: ${fact.meaning}` : `Pass only if this prohibited inference is absent: ${fact.meaning}`,
    });
    cases.push({ case_id: item.id, title: item.title, original_context: item.context,
      exact_request_json: item.request_json, request_sha256: item.request_sha256, inventory: item.inventory,
      raw_outcome: imported.outcome, raw_outcome_sha256: hashJson(imported.outcome),
      raw_body_sha256: rawBody ? createHash("sha256").update(rawBody).digest("hex") : null, raw_body_utf8: rawBodyUtf8,
      structural_status: result ? "pass" : "fail", structural_failure: structuralFailure,
      parsed_result: result, claims,
      selected_patient_soap: result ? await assembleCallNoteSections(result.payload, item.context.source.document, item.context.template.definition) : null,
      review_flags: result?.payload.review_flags.map((text, n) => ({ id: `${item.id}/flag/${n + 1}`, text })) ?? [],
    });
  }
  const body = { contract: "lrv-call-fidelity-review-v1", bundle_sha256: bundle.bundle_sha256,
    raw_import_sha256: hashJson(raw), automatic_semantic_pass: false, clinical_adjudication_complete: false,
    instructions: "Review every case, whole claim, its own supports, mandatory meaning and forbidden inference. Structural pass is not semantic pass. Supplied raw import hashes bind bytes, not provider authorship. Returned model aliases are reported, not immutable snapshot IDs. No clinical chart write or policy approval follows from this report.", cases, questions };
  const packet = { ...body, packet_sha256: hashJson(body) };
  const form = { contract: "lrv-call-fidelity-adjudication-v1", packet_sha256: packet.packet_sha256,
    reviewer: "", reviewed_at: "", decisions: questions.map((q) => ({ question_id: q.id, verdict: "pending", rationale: "", evidence_refs: [] as string[] })) };
  return { packet, form };
}
const adjudicationSchema = z.object({ contract: z.literal("lrv-call-fidelity-adjudication-v1"), packet_sha256: digest,
  reviewer: nonblank, reviewed_at: z.string().datetime({ offset: true }), decisions: z.array(z.object({
    question_id: nonblank, verdict: z.enum(["pass", "fail"]), rationale: nonblank, evidence_refs: z.array(nonblank).max(200),
  }).strict()).max(10000),
}).strict();
export async function adjudicateCallReview(bundle: unknown, raw: unknown, input: unknown) {
  const { packet } = await createCallReviewPacket(bundle, raw), form = adjudicationSchema.parse(input);
  assert.equal(form.packet_sha256, packet.packet_sha256, "Adjudication packet differs.");
  assert.equal(form.decisions.length, packet.questions.length, "Every adjudication question is required.");
  assert.equal(new Set(form.decisions.map((d) => d.question_id)).size, packet.questions.length, "Duplicate adjudication question.");
  for (const question of packet.questions) {
    const decision = form.decisions.find((d) => d.question_id === question.id);
    assert.ok(decision, "Missing adjudication question.");
    assert.equal(new Set(decision.evidence_refs).size, decision.evidence_refs.length, "Duplicate evidence reference.");
    assert.ok(decision.evidence_refs.every((ref) => question.evidence_refs.includes(ref)), "Unrelated or invented adjudication evidence.");
    if (decision.verdict === "pass" && question.kind !== "forbidden") assert.ok(decision.evidence_refs.length > 0, "Passing claim/support/mandatory meaning requires explicit evidence references.");
  }
  return { contract: "lrv-call-fidelity-adjudicated-v1", packet_sha256: packet.packet_sha256,
    reviewer: form.reviewer, reviewed_at: form.reviewed_at, adjudication_sha256: hashJson(form),
    structural_failures: packet.cases.filter((c) => c.structural_status === "fail").map((c) => c.case_id),
    failed_questions: form.decisions.filter((d) => d.verdict === "fail").map((d) => d.question_id),
    fidelity_pass: packet.cases.every((c) => c.structural_status === "pass") && form.decisions.every((d) => d.verdict === "pass"),
    scope: "Named review of this frozen fictional corpus only. Not clinical activation, external benchmark, model training or approval of real patient output.",
  };
}

/** All untrusted clinical/model text is contained in a fence longer than its longest backtick run. */
export function callEvaluationFence(value: unknown) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  let longest = 0;
  for (const run of text.matchAll(/`+/g)) longest = Math.max(longest, run[0].length);
  const fence = "`".repeat(Math.max(3, longest + 1));
  return fence + "\n" + text + "\n" + fence;
}
export function renderCallReviewMarkdown(packet: Awaited<ReturnType<typeof createCallReviewPacket>>["packet"]) {
  const lines = ["# Fictional call-note fidelity review", "", "No clinical approval or activation is implied. All decisions start pending.", "",
    "Review the original transcript against each whole claim and its own supporting quotes. Check patient, speaker, timing, correction, negation, treatment status, exact units and uncertainty. A matching quote is not proof of a true claim. Fill every question in adjudication-pending.json with pass/fail, a specific rationale and allowed evidence references. Never edit packet.json. A failed transport or contract cannot pass.", "",
    "Supplied output hashes bind retained bytes, not provider authorship. Requested and returned model aliases do not establish an immutable model snapshot.", "",
    "Bundle SHA256: " + packet.bundle_sha256, "Packet SHA256: " + packet.packet_sha256, ""];
  for (const item of packet.cases) {
    lines.push("## Case " + item.case_id, "", callEvaluationFence(item.title), "", "### Original call and selected patient", "",
      callEvaluationFence({ patient: item.original_context.patient, original_call: item.original_context.source.context }), "",
      "### Complete retained transcript segments", "", callEvaluationFence(item.original_context.source.document.segments), "",
      "### Mandatory and forbidden meaning inventory", "", callEvaluationFence(item.inventory), "",
      "### Raw outcome (exact bytes retained as base64 in packet.json)", "", callEvaluationFence({ status: item.structural_status,
        failure: item.structural_failure, raw_body_sha256: item.raw_body_sha256, raw_outcome_sha256: item.raw_outcome_sha256,
        transport: item.raw_outcome.kind, body_utf8: item.raw_body_utf8,
        outcome: item.raw_outcome.kind === "transport_error" ? item.raw_outcome : { status: item.raw_outcome.status, request_id: item.raw_outcome.request_id } }), "",
      "### Claims and each claim's own exact supports", "", callEvaluationFence(item.claims), "",
      "### Selected-patient SOAP proposal and private review flags", "", callEvaluationFence({ soap: item.selected_patient_soap, flags: item.review_flags,
        requested_model: item.parsed_result?.requested_model ?? null, provider_model: item.parsed_result?.provider_model ?? null }), "",
      "### Pending decisions with stable IDs and allowed evidence references", "", callEvaluationFence(packet.questions.filter((q) => q.id.startsWith(item.case_id + "/"))), "");
  }
  return lines.join("\n");
}
