import { z } from "zod";
import {
  callCaptureIntentSchema,
  callCaptureReadSchema,
  callPolicySchema,
  callSourceSchema,
  callSourceSummarySchema,
} from "../../../../../supabase/functions/_shared/clinical-call-model.ts";
export * from "../../../../../supabase/functions/_shared/clinical-call-model.ts";
const uuid = z.string().uuid();
export const pendingCallSchema = z.object({
  actor_id: uuid,
  action_id: uuid,
  request: callCaptureIntentSchema,
}).strict();
export const pendingCallPolicySchema = z.object({
  actor_id: uuid,
  action_id: uuid,
  expected_version: z.number().int().positive(),
}).strict();
export const callPolicyRequestSchema = z.object({
  expected_version: z.number().int().positive(),
  status: z.enum(["draft", "approved"]),
  consent_text: z.string().trim().min(1).max(4000),
  retention_text: z.string().trim().min(1).max(2000),
  attest_reviewed: z.boolean(),
}).strict().refine((value) => value.status !== "approved" || value.attest_reviewed, "Approval requires an explicit review attestation.");
export type PendingCall = z.infer<typeof pendingCallSchema>;
export type PendingCallPolicy = z.infer<typeof pendingCallPolicySchema>;
export type CallCaptureRead = z.infer<typeof callCaptureReadSchema>;
export type CallSource = z.infer<typeof callSourceSchema>;
export type CallSourceSummary = z.infer<typeof callSourceSummarySchema>;
export function summarizeCallSource(source: CallSource): CallSourceSummary {
  const { document: _document, ...summary } = source;
  return callSourceSummarySchema.parse(summary);
}
export type CallPolicy = z.infer<typeof callPolicySchema>;
export type CallPolicyRequest = z.infer<typeof callPolicyRequestSchema>;
export function verifyPendingCall(value: unknown, actor: string, pet: string, encounter: string) {
  const parsed = pendingCallSchema.parse(value);
  if (parsed.actor_id !== actor || parsed.request.pet_id !== pet || parsed.request.encounter_id !== encounter) throw Error("Call capture recovery context differs.");
  return parsed;
}
export function verifyCallSource(value: unknown, pet: string, encounter?: string) {
  const parsed = callSourceSchema.parse(value);
  if (parsed.pet_id !== pet || (encounter && parsed.encounter_id !== encounter) || parsed.call_id !== parsed.document.call_id || parsed.context.call_id !== parsed.call_id || parsed.context.call_uuid !== parsed.call_uuid || parsed.context.client_id !== parsed.client_id || parsed.context.conversation_id !== parsed.conversation_id) throw Error("Call source patient, encounter or captured call context differs.");
  return parsed;
}
export function verifyCallCapture(value: unknown, pending: PendingCall) {
  const parsed = callCaptureReadSchema.parse(value);
  if (parsed.action.id !== pending.action_id || parsed.action.actor_id !== pending.actor_id || (parsed.action.request && JSON.stringify(parsed.action.request) !== JSON.stringify(pending.request))) throw Error("Call capture receipt differs from the original action.");
  if (parsed.action.state !== "cancelled" && !parsed.action.request) throw Error("Call capture intent is missing.");
  if (parsed.source) {
    const source = verifyCallSource(parsed.source, pending.request.pet_id, pending.request.encounter_id);
    if (source.capture_id !== pending.action_id || source.id !== parsed.action.source_id || source.actor_id !== pending.actor_id || source.policy_version !== pending.request.policy_version || parsed.action.state !== "completed") throw Error("Call source identity differs from its capture receipt.");
  } else if (parsed.action.state === "completed" || parsed.action.source_id !== null) throw Error("Completed call source is missing.");
  return parsed;
}
export function verifyCallPolicy(value: unknown, pending: PendingCallPolicy, request?: CallPolicyRequest | null) {
  const parsed = callPolicySchema.parse(value);
  if (parsed.version !== pending.expected_version + 1 || (parsed.status === "approved" && (parsed.reviewed_by !== pending.actor_id || !parsed.reviewed_at))) throw Error("Call policy receipt identity differs.");
  if (request && (parsed.status !== request.status || parsed.consent_text !== request.consent_text || parsed.retention_text !== request.retention_text)) throw Error("Call policy receipt wording differs.");
  return parsed;
}
export function callActionIsTerminal(state: CallCaptureRead["action"]["state"]) {
  return ["completed", "failed", "cancelled"].includes(state);
}
export function callFeedback(error: unknown) {
  const parsed = z.object({ code: z.string().max(100) }).passthrough().safeParse(error);
  const code = parsed.success ? parsed.data.code : error instanceof CallSourceError ? error.code : "unknown";
  const messages: Record<string, string> = {
    PT403: "Current administrator access and approved call-source permissions are required. Refresh your session before continuing.",
    PT404: "No committed capture was found. Recover or durably cancel the original action before selecting another call.",
    PT409: "The patient, unsigned encounter, household assignment or policy changed. Recover the original action before a fresh selection.",
    PT422: "Review the selected call and required authorization before continuing.",
    capture_disabled: "Call transcript capture is not activated on this backend. The reservation remains recoverable; no automatic retry will run.",
    provider_unconfigured: "The call-transcript provider is not configured on this backend. Recover or cancel the reservation before continuing.",
    authentication_required: "Sign in again before continuing with private call evidence.",
    forbidden: "Current administrator access is required for full call transcripts.",
  };
  return messages[code] ?? "The call-source action could not be confirmed. Recover its original state before retrying. No automatic provider retry will run.";
}
export class CallSourceError extends Error {
  readonly code: string;
  constructor(code: string) { super("Call source action unavailable."); this.code = code; }
}
