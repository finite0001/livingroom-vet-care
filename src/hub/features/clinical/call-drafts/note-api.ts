import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { currentEncounterSchema } from "../dictation/model";
import { callNoteGenerationPolicySchema, callNoteIntentSchema, callNoteProcessingReadSchema, callNoteReserveSchema, callNoteReviewSchema, callNoteReviewRequestSchema, callNoteWorkspaceSchema, validateCallNoteProcessingRead } from "../../../../../supabase/functions/_shared/clinical-call-note-processing-model.ts";
import { callPolicyRequestSchema, CallSourceError, verifyCallPolicy, type PendingCallPolicy, type CallPolicyRequest } from "./model";
const uuid = z.string().uuid();
interface PrivateRpc { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> }
async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await (supabase as unknown as PrivateRpc).rpc(name, args);
  if (error) throw error;
  return data;
}
export async function readCallNotes(actor: string, pet: string, encounter: string, source: string) {
  return callNoteWorkspaceSchema.parse(await rpc("read_clinical_call_note_workspace_v1", { p_actor_id: uuid.parse(actor), p_pet_id: uuid.parse(pet), p_encounter_id: uuid.parse(encounter), p_source_id: uuid.parse(source) }));
}
export async function readCallNote(actor: string, id: string, pet: string, encounter: string, source: string) {
  const value = await validateCallNoteProcessingRead(await rpc("read_clinical_call_note_processing_v1", { p_actor_id: uuid.parse(actor), p_id: uuid.parse(id) }));
  if (value.job.id !== id || value.job.pet_id !== pet || value.job.encounter_id !== encounter || value.source.id !== source) throw Error("Private call note destination differs.");
  return value;
}
export async function reserveCallNote(actor: string, id: string, request: unknown) {
  const input = callNoteReserveSchema.parse(request);
  // Recovery uses the explicit rich read; no private source is accepted from the browser.
  const value = await validateCallNoteProcessingRead(await rpc("reserve_clinical_call_note_v1", { p_actor_id: uuid.parse(actor), p_id: uuid.parse(id), p_request: input }));
  if (value.job.id !== id || value.job.actor_id !== actor || value.job.policy_version !== input.note_policy_version || value.binding.call_generation_policy_version !== input.call_generation_policy_version || value.source.id !== input.source_id || value.job.expected_version !== input.expected_version || value.job.template_id !== input.template_id || value.job.template_version !== input.template_version || value.job.template_hash !== input.template_hash) throw Error("Reserved private call note differs.");
  return value;
}
export async function processCallNote(input: unknown) {
  const intent = callNoteIntentSchema.parse(input);
  const { data, error } = await supabase.functions.invoke("clinical-call-note-process", { body: intent });
  if (error) {
    let code = "processing_unconfirmed";
    if (error.context instanceof Response) try { code = z.object({ code: z.string().max(100), error: z.string().max(500) }).strict().parse(await error.context.clone().json()).code; } catch { /* Do not expose private provider bodies. */ }
    throw new CallSourceError(code);
  }
  const value = await validateCallNoteProcessingRead(data);
  if (value.job.id !== intent.job_id) throw Error("Processed call note differs.");
  return value;
}
export async function cancelCallNote(actor: string, id: string) {
  const value = z.object({ cancelled: z.boolean(), job: callNoteProcessingReadSchema.nullable() }).strict().parse(await rpc("cancel_clinical_call_note_reservation_v1", { p_actor_id: uuid.parse(actor), p_id: uuid.parse(id) }));
  if (value.job) { if (value.job.job.id !== id) throw Error("Canceled call reservation differs."); await validateCallNoteProcessingRead(value.job); }
  return value;
}
export async function cancelCallNoteAttempt(actor: string, input: unknown) {
  const intent = callNoteIntentSchema.parse(input);
  const value = z.object({ cancelled: z.boolean(), job: callNoteProcessingReadSchema }).strict().parse(await rpc("cancel_clinical_call_note_attempt_v1", { p_actor_id: uuid.parse(actor), p_id: intent.attempt_id, p_job_id: intent.job_id, p_retry_of: intent.retry_of, p_reason: intent.reason, p_ack_cost: intent.ack_cost }));
  if (value.job.job.id !== intent.job_id) throw Error("Canceled call attempt differs.");
  await validateCallNoteProcessingRead(value.job); return value;
}
export const callNoteReviewReceiptSchema = z.object({ review: callNoteReviewSchema, encounter: currentEncounterSchema.nullable(), proposal_id: uuid, job_id: uuid }).strict();
export async function callNoteReviewAction(actor: string, id: string, job: string, mode: "save" | "recover" | "cancel", request?: unknown) {
  const args: Record<string, unknown> = { p_actor_id: uuid.parse(actor), p_id: uuid.parse(id), p_job_id: uuid.parse(job) };
  if (mode === "save") args.p_request = callNoteReviewRequestSchema.parse(request);
  const value = await rpc(`${mode}_clinical_call_note_review_v1`, args);
  if (mode === "cancel") {
    const result = z.object({ cancelled: z.boolean(), receipt: callNoteReviewReceiptSchema.nullable() }).strict().parse(value);
    if (result.receipt && (result.receipt.review.id !== id || result.receipt.job_id !== job || result.receipt.review.actor_id !== actor || result.receipt.review.proposal_id !== result.receipt.proposal_id)) throw Error("Canceled call review receipt differs.");
    return result;
  }
  if (value === null && mode === "recover") return null;
  const receipt = callNoteReviewReceiptSchema.parse(value);
  if (receipt.review.id !== id || receipt.job_id !== job || receipt.review.actor_id !== actor || receipt.review.proposal_id !== receipt.proposal_id) throw Error("Call review receipt differs.");
  if (request) {
    const input = callNoteReviewRequestSchema.parse(request);
    if (receipt.proposal_id !== input.proposal_id || receipt.review.decision !== input.decision || receipt.review.review_note !== input.review_note || (Object.keys(receipt.review.accepted_sections).length !== Object.keys(input.accepted_sections).length || Object.entries(input.accepted_sections).some(([field, text]) => receipt.review.accepted_sections[field as keyof typeof input.accepted_sections] !== text))) throw Error("Saved call review wording differs.");
    if (input.decision === "accepted") {
      if (!receipt.encounter || receipt.encounter.version !== input.expected_version + 1 || receipt.encounter.updated_by !== actor || receipt.encounter.status !== "draft") throw Error("Accepted call encounter version differs.");
      for (const [field, text] of Object.entries(input.accepted_sections)) if (receipt.encounter[field as keyof typeof receipt.encounter] !== text) throw Error("Accepted call wording differs.");
    } else if (receipt.encounter !== null) throw Error("Rejected call draft changed an encounter.");
  }
  return { cancelled: false, receipt };
}
export async function latestCallEncounter(pet: string, encounter: string) {
  const { data, error } = await supabase.from("clinical_encounters").select("*").eq("id", uuid.parse(encounter)).eq("pet_id", uuid.parse(pet)).single();
  if (error) throw error;
  const value = currentEncounterSchema.parse(data);
  if (value.id !== encounter || value.pet_id !== pet) throw Error("Current call destination differs.");
  return value;
}
export async function callNotePolicyAction(pending: PendingCallPolicy, mode: "save" | "recover" | "cancel", request?: CallPolicyRequest) {
  const args: Record<string, unknown> = { p_actor_id: uuid.parse(pending.actor_id), p_id: uuid.parse(pending.action_id) };
  if (mode === "save") args.p_request = callPolicyRequestSchema.parse(request);
  const value = await rpc(`${mode}_clinical_call_note_policy_v1`, args);
  if (mode === "cancel") return z.object({ cancelled: z.boolean(), policy: callNoteGenerationPolicySchema.nullable() }).strict().parse(value);
  if (value === null && mode === "recover") return null;
  const policy = verifyCallPolicy(callNoteGenerationPolicySchema.parse(value), pending, request);
  return { cancelled: false, policy };
}
export async function readCallNotePolicy(actor: string) {
  return callNoteGenerationPolicySchema.parse(await rpc("read_clinical_call_note_policy_v1", { p_actor_id: uuid.parse(actor) }));
}
