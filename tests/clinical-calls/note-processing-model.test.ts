import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import {
  callNoteProcessingReadSchema,
  callNoteProviderContext,
  callNoteReserveSchema,
  callNoteReviewRequestSchema,
  callNoteWorkspaceSchema,
  validateCallNoteProcessingRead,
} from "../../supabase/functions/_shared/clinical-call-note-processing-model.ts";
import { callNoteProcessingFixture, saveSyntheticCallResult } from "./note-processing-fixture.ts";

test("private call processing binds source, patient, template and generation independently of legacy readers", async () => {
  const fixture = await callNoteProcessingFixture();
  assert.equal((await validateCallNoteProcessingRead(fixture.read)).job.id, fixture.intent.job_id);
  assert.equal(callNoteProviderContext(fixture.read).source.id, fixture.read.source.id);
  assert.notEqual(fixture.read.source.actor_id, fixture.actor, "historical capture creator is not current generation owner");
  await saveSyntheticCallResult(fixture.read, fixture.intent.attempt_id, await fixture.result());
  const value = await validateCallNoteProcessingRead(fixture.read);
  assert.equal(value.proposal?.sections.subjective.text, "History:\nOwner-reported concern; no medication administered.");
  assert.equal(value.generation?.manifest.source_manifest_sha256, fixture.read.source.sha256);
});

test("strict call reads reject foreign source, patient, template, private generation and extra secret columns", async () => {
  const fixture = await callNoteProcessingFixture();
  for (const change of [
    (value: typeof fixture.read) => { value.binding.job_id = randomUUID(); },
    (value: typeof fixture.read) => { value.binding.call_source_sha256 = "c".repeat(64); },
    (value: typeof fixture.read) => { value.source.pet_id = randomUUID(); },
    (value: typeof fixture.read) => { value.source.context.call_id = "700014"; },
    (value: typeof fixture.read) => { value.patient.id = randomUUID(); },
    (value: typeof fixture.read) => { value.template.version++; },
    (value: typeof fixture.read) => { value.job.proposal_id = randomUUID(); },
  ]) {
    const value = structuredClone(fixture.read); change(value);
    assert.equal(callNoteProcessingReadSchema.safeParse(value).success, false);
  }
  assert.equal(callNoteProcessingReadSchema.safeParse({ ...fixture.read, session_id: randomUUID() }).success, false);
  assert.equal(callNoteProcessingReadSchema.safeParse({ ...fixture.read, job: { ...fixture.read.job, session_id: randomUUID() } }).success, false);
});

test("historical private read survives changed approvals while generation eligibility fails closed", async () => {
  const fixture = await callNoteProcessingFixture();
  for (const policy of ["note_policy", "call_generation_policy", "capture_policy"] as const) {
    const value = structuredClone(fixture.read);
    value[policy].version++;
    await validateCallNoteProcessingRead(value);
    assert.throws(() => callNoteProviderContext(value));
    value[policy].status = "draft"; value[policy].reviewed_at = null; value[policy].reviewed_by = null;
    await validateCallNoteProcessingRead(value);
    assert.throws(() => callNoteProviderContext(value));
  }
  fixture.read.template.status = "retired";
  await validateCallNoteProcessingRead(fixture.read);
  assert.throws(() => callNoteProviderContext(fixture.read));
});

test("valid private payload cannot conceal altered proposal assembly, quote or manifest", async () => {
  const fixture = await callNoteProcessingFixture();
  await saveSyntheticCallResult(fixture.read, fixture.intent.attempt_id, await fixture.result());
  for (const change of [
    (value: typeof fixture.read) => { value.proposal!.sections.subjective.text += " Invented normal exam."; },
    (value: typeof fixture.read) => { value.proposal!.sections.subjective.quote = "Wrong excerpt"; },
    (value: typeof fixture.read) => { value.generation!.payload.fields[0].claims[0].supports[0].from++; },
    (value: typeof fixture.read) => { value.generation!.manifest.source_id = randomUUID(); },
    (value: typeof fixture.read) => { value.generation!.template_snapshot.definition = { ...value.generation!.template_snapshot.definition, name: "Altered snapshot" }; },
    (value: typeof fixture.read) => { value.job.source_sha256 = "d".repeat(64); },
  ]) {
    const value = structuredClone(fixture.read); change(value);
    await assert.rejects(validateCallNoteProcessingRead(value));
  }
});

test("reservation accepts only retained identity and review accepts selected wording or a reasoned rejection", async () => {
  const { read } = await callNoteProcessingFixture();
  const reserve = { source_id: read.source.id, expected_version: 1, template_id: read.template.id,
    template_version: 1, template_hash: read.template.sha256, note_policy_version: 2,
    call_generation_policy_version: 2, attest_authorized: true };
  assert.equal(callNoteReserveSchema.safeParse(reserve).success, true);
  for (const extra of [{ source_text: "replacement" }, { source_sha256: "a".repeat(64) }, { pet_id: randomUUID() }]) {
    assert.equal(callNoteReserveSchema.safeParse({ ...reserve, ...extra }).success, false);
  }
  const request = { proposal_id: randomUUID(), expected_version: 1, decision: "accepted", accepted_sections: { subjective: "Reviewed text" }, review_note: "", attest_reviewed: true };
  assert.equal(callNoteReviewRequestSchema.safeParse(request).success, true);
  assert.equal(callNoteReviewRequestSchema.safeParse({ ...request, accepted_sections: {} }).success, false);
  assert.equal(callNoteReviewRequestSchema.safeParse({ ...request, decision: "rejected", accepted_sections: {}, review_note: "Wrong patient attribution" }).success, true);
  assert.equal(callNoteReviewRequestSchema.safeParse({ ...request, decision: "rejected", accepted_sections: {}, review_note: "" }).success, false);
  assert.equal(callNoteReviewRequestSchema.safeParse({ ...request, source_id: read.source.id }).success, false);
});

test("bounded audit events explicitly disclose older history and template configuration remains readable beyond100 roots", async () => {
  const { read } = await callNoteProcessingFixture();
  const events = Array.from({ length: 100 }, () => ({
    id: randomUUID(), job_id: read.job.id, attempt_id: null, actor_id: read.job.actor_id,
    kind: "cancelled_before_dispatch", details: { attempt_id: randomUUID() }, created_at: read.job.created_at,
  }));
  const history = callNoteProcessingReadSchema.parse({ ...read, events, events_has_more: true });
  assert.equal(history.events.length, 100);
  assert.equal(history.events_has_more, true);
  assert.equal(callNoteProcessingReadSchema.safeParse({ ...read, events, events_has_more: "true" }).success, false);
  const { events_has_more: _flag, ...missingFlag } = read;
  assert.equal(callNoteProcessingReadSchema.safeParse(missingFlag).success, false);
  const { id: _id, status: _status, ...snapshot } = read.template;
  const templates = Array.from({ length: 101 }, () => ({
    id: randomUUID(), revision: 1, latest_version: snapshot.version, approved_version: snapshot.version,
    retired: false, latest: snapshot, approved: snapshot,
  }));
  const workspace = callNoteWorkspaceSchema.parse({
    jobs: [], has_more: false, templates, note_policy: read.note_policy,
    call_generation_policy: read.call_generation_policy, capture_policy: read.capture_policy,
  });
  assert.equal(workspace.templates.length, 101);
});
