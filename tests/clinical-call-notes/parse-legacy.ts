/** Parse real local RPC snapshots through the unchanged frontend contracts. */
import { readFileSync } from "node:fs";
import { deepStrictEqual, strictEqual, ok } from "node:assert";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  assembleNoteSections,
  notesReadSchema,
  noteJobReadSchema,
  noteProvenanceSchema,
  validateNotePayload,
} from "../../src/hub/features/clinical/templates/model.ts";
import {
  readSchema,
  reviewSchema,
  soapFields,
  verifyReceipt,
} from "../../src/hub/features/clinical/dictation/model.ts";
import {
  audioProvenanceSchema,
  validateAudioSoap,
} from "../../supabase/functions/_shared/clinical-audio-model.ts";

const fixtureNoteSchema = z.object({
  job: z.string().uuid(),
  proposal: z.string().uuid(),
  attempt: z.string().uuid(),
  action: z.string().uuid(),
  intent: z.unknown(),
  result: z.unknown(),
  review_request: reviewSchema,
}).strict();
const snapshotSchema = z.object({
  notes: z.unknown(),
  typed: z.unknown(),
  audio_note: z.unknown(),
  dictation: z.unknown(),
  typed_provenance: z.unknown(),
  audio_provenance: z.unknown(),
  typed_receipt: z.unknown(),
  audio_receipt: z.unknown(),
  direct_audio_provenance: z.unknown(),
  fixture: z.object({
    actor: z.string().uuid(),
    typed: fixtureNoteSchema,
    audio_note: fixtureNoteSchema,
    direct_audio: z.object({
      job: z.string().uuid(),
      proposal: z.string().uuid(),
      attempt: z.string().uuid(),
      transcription_attempt: z.string().uuid(),
      transcript_sha256: z.string().regex(/^[a-f0-9]{64}$/),
      audio_sha256: z.string().regex(/^[a-f0-9]{64}$/),
    }).strict(),
  }).strict(),
}).strict();
const input = z.array(snapshotSchema).min(2).max(3).parse(
  JSON.parse(readFileSync(process.argv[2], "utf8")),
);
let parsed = 0;
let reviewed = 0;
for (const snapshot of input) {
  const notes = notesReadSchema.parse(snapshot.notes); parsed++;
  const dictation = readSchema.parse(snapshot.dictation); parsed++;
  strictEqual(notes.actor_id, snapshot.fixture.actor);
  strictEqual(dictation.actor_id, snapshot.fixture.actor);
  strictEqual(notes.pet_id, dictation.pet_id);
  strictEqual(notes.encounter_id, dictation.encounter_id);
  // Positive legacy rows must remain visible despite newer private rows.
  deepStrictEqual(notes.jobs.map((job) => job.id).sort(),
    [snapshot.fixture.typed.job, snapshot.fixture.audio_note.job].sort());
  deepStrictEqual(dictation.items.map((proposal) => proposal.id).sort(),
    [snapshot.fixture.typed.proposal, snapshot.fixture.audio_note.proposal,
      snapshot.fixture.direct_audio.proposal].sort());
  // Direct audio-generated SOAP has a different provenance contract from an
  // audio-backed template note; exercise the replaced RPC's positive path too.
  const direct = audioProvenanceSchema.parse(snapshot.direct_audio_provenance); parsed++;
  const directFixture = snapshot.fixture.direct_audio;
  const directProposal = dictation.items.find((item) => item.id === directFixture.proposal);
  ok(directProposal, "The original direct audio SOAP proposal must remain visible.");
  strictEqual(direct.proposal_id, directFixture.proposal);
  strictEqual(direct.job_id, directFixture.job);
  strictEqual(direct.attempt_id, directFixture.attempt);
  strictEqual(direct.audio_sha256, directFixture.audio_sha256);
  strictEqual(direct.transcript_hash, directFixture.transcript_sha256);
  strictEqual(direct.transcript_hash, directProposal.source_hash);
  strictEqual(createHash("sha256").update(directProposal.transcript, "utf8").digest("hex"), direct.transcript_hash);
  strictEqual(directProposal.actor_id, snapshot.fixture.actor);
  strictEqual(directProposal.pet_id, dictation.pet_id);
  strictEqual(directProposal.encounter_id, dictation.encounter_id);
  validateAudioSoap(direct.payload, directProposal.transcript);
  for (const field of soapFields) deepStrictEqual(directProposal.sections[field], {
    text: direct.payload[field].map((claim) => claim.text).join("\n"),
    quote: direct.payload[field][0]?.quote ?? "",
  });
  ok(direct.transcription_context && direct.generation_context,
    "The fictional post-vocabulary source retains both actual context shapes.");
  strictEqual(direct.transcription_context.bundle_sha256, direct.generation_context.bundle_sha256);
  ok(direct.transcription_context.request_sha256 !== direct.generation_context.request_sha256);
  reviewed++;
  for (const [key, prefix, sourceKind] of [
    ["typed", "typed", "typed"],
    ["audio_note", "audio", "audio_transcript"],
  ] as const) {
    const fixture = snapshot.fixture[key];
    const { job, template } = noteJobReadSchema.parse(snapshot[key]); parsed++;
    const provenance = noteProvenanceSchema.parse(snapshot[`${prefix}_provenance`]); parsed++;
    const proposal = dictation.items.find((item) => item.id === fixture.proposal);
    ok(proposal, "The original legacy proposal must remain in its real list response.");
    deepStrictEqual(notes.jobs.find((item) => item.id === fixture.job), job);
    strictEqual(job.id, fixture.job);
    strictEqual(job.proposal_id, fixture.proposal);
    strictEqual(job.source_kind, sourceKind);
    strictEqual(job.actor_id, snapshot.fixture.actor);
    strictEqual(job.pet_id, dictation.pet_id);
    strictEqual(job.encounter_id, dictation.encounter_id);
    strictEqual(proposal.actor_id, job.actor_id);
    strictEqual(proposal.pet_id, job.pet_id);
    strictEqual(proposal.encounter_id, job.encounter_id);
    strictEqual(proposal.expected_version, job.expected_version);
    strictEqual(proposal.transcript, job.source_text);
    strictEqual(proposal.source_hash, job.source_sha256);
    strictEqual(createHash("sha256").update(proposal.transcript, "utf8").digest("hex"), job.source_sha256);
    strictEqual(provenance.proposal_id, proposal.id);
    strictEqual(provenance.job_id, job.id);
    strictEqual(provenance.attempt_id, fixture.attempt);
    ok(job.attempts.some((attempt) => attempt.id === fixture.attempt));
    strictEqual(provenance.source_kind, sourceKind);
    strictEqual(provenance.source_sha256, proposal.source_hash);
    strictEqual(provenance.audio_job_id, job.audio_job_id);
    strictEqual(provenance.source_audio_policy_version, job.source_audio_policy_version);
    strictEqual(provenance.policy_version, job.policy_version);
    deepStrictEqual(provenance.template_snapshot, {
      id: template.id, version: template.version,
      definition: template.definition, sha256: template.sha256,
    });
    // Match ClinicalDictationReview's real payload/section verification, rather
    // than accepting a well-shaped payload whose proposal cannot be opened.
    validateNotePayload(provenance.payload, proposal.transcript, provenance.template_snapshot.definition);
    const assembled = assembleNoteSections(provenance.payload, proposal.transcript, provenance.template_snapshot.definition);
    for (const field of soapFields) deepStrictEqual(assembled[field], proposal.sections[field]);
    const request = fixture.review_request;
    strictEqual(request.pet_id, proposal.pet_id);
    strictEqual(request.encounter_id, proposal.encounter_id);
    strictEqual(request.expected_version, proposal.expected_version);
    strictEqual(request.proposal_id, proposal.id);
    const receipt = verifyReceipt(snapshot[`${prefix}_receipt`], {
      id: fixture.action, actor: snapshot.fixture.actor,
      kind: "review", request,
    }); parsed++;
    ok(proposal.review, "A recovered review receipt must have its retained review row.");
    strictEqual(proposal.review.id, receipt.id);
    strictEqual(proposal.review.proposal_id, proposal.id);
    strictEqual(proposal.review.actor_id, receipt.actor_id);
    strictEqual(proposal.review.decision, request.decision);
    deepStrictEqual(proposal.review.accepted_sections, request.accepted_sections);
    strictEqual(proposal.review.review_note, request.review_note);
    strictEqual(proposal.review.attest_reviewed, request.attest_reviewed);
    strictEqual(proposal.review.encounter_version, receipt.encounter?.version ?? null);
    reviewed++;
  }
}
console.log(JSON.stringify({ actualFrontendParses: parsed, actualFrontendReviewChecks: reviewed }));
