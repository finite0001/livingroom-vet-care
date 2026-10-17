import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import {
  callCandidatesSchema, callPolicySchema, callSourceSummarySchema, pendingCallSchema,
  callPolicyRequestSchema, verifyCallCapture, verifyCallSource, verifyCallPolicy,
  CallSourceError, type PendingCall, type PendingCallPolicy, type CallPolicyRequest,
} from "./model";
interface CallRpc {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}
const uuid = z.string().uuid();
async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await (supabase as unknown as CallRpc).rpc(name, args);
  if (error) throw error;
  return data;
}
export const callPatientSchema = z.object({
  id: uuid, client_id: uuid, name: z.string(), version: z.number().int().positive(),
  archived_at: z.string().nullable(), deceased_at: z.string().nullable(),
}).strict();
export async function readCallPatient(pet: string) {
  const { data, error } = await supabase.from("pets").select("id,client_id,name,version,archived_at,deceased_at").eq("id", uuid.parse(pet)).single();
  if (error) throw error;
  const patient = callPatientSchema.parse(data);
  if (patient.id !== pet) throw Error("Call patient differs.");
  const household = await supabase.from("clients").select("id,full_name").eq("id", patient.client_id).single();
  if (household.error) throw household.error;
  const client = z.object({ id: uuid, full_name: z.string() }).strict().parse(household.data);
  if (client.id !== patient.client_id) throw Error("Call household differs.");
  return { patient, client };
}
export async function listCallCandidates(actor: string, pet: string, encounter: string, version: number) {
  return callCandidatesSchema.parse(await rpc("list_clinical_call_candidates", { p_actor_id: uuid.parse(actor), p_pet_id: uuid.parse(pet), p_encounter_id: uuid.parse(encounter), p_expected_version: z.number().int().positive().parse(version) }));
}
export async function listCallSources(actor: string, pet: string) {
  const value = z.object({ sources: z.array(callSourceSummarySchema).max(100), has_more: z.boolean() }).strict().parse(await rpc("list_clinical_call_sources", { p_actor_id: uuid.parse(actor), p_pet_id: uuid.parse(pet) }));
  if (value.sources.some((source) => source.pet_id !== pet)) throw Error("Call source history patient differs.");
  return value;
}
export async function readCallSource(actor: string, pet: string, id: string) {
  const value = verifyCallSource(await rpc("read_clinical_call_source", { p_actor_id: uuid.parse(actor), p_id: uuid.parse(id) }), pet);
  if (value.id !== id) throw Error("Call source identifier differs.");
  return value;
}
function captureArgs(input: PendingCall) {
  const pending = pendingCallSchema.parse(input);
  return { p_actor_id: pending.actor_id, p_id: pending.action_id };
}
export async function reserveCall(pending: PendingCall) {
  return verifyCallCapture(await rpc("reserve_clinical_call_capture", { ...captureArgs(pending), p_request: pending.request }), pending);
}
export async function recoverCall(pending: PendingCall) {
  return verifyCallCapture(await rpc("read_clinical_call_capture", captureArgs(pending)), pending);
}
export async function cancelCall(pending: PendingCall) {
  return z.object({ cancelled: z.boolean() }).strict().parse(await rpc("cancel_clinical_call_capture", captureArgs(pending)));
}
export async function captureCall(pending: PendingCall) {
  const { data, error } = await supabase.functions.invoke("clinical-call-capture", { body: { capture_id: uuid.parse(pending.action_id) } });
  if (error) {
    let code = "capture_unavailable";
    if (error.context instanceof Response) {
      try { code = z.object({ error: z.object({ code: z.string().max(100) }) }).passthrough().parse(await error.context.clone().json()).error.code; }
      catch { /* Never display an arbitrary provider or database body. */ }
    }
    throw new CallSourceError(code);
  }
  return verifyCallCapture(data, pending);
}
export async function readCallPolicy(actor: string) {
  return callPolicySchema.parse(await rpc("read_clinical_call_policy", { p_actor_id: uuid.parse(actor) }));
}
function policyArgs(pending: PendingCallPolicy) { return { p_actor_id: uuid.parse(pending.actor_id), p_id: uuid.parse(pending.action_id) }; }
export async function saveCallPolicy(pending: PendingCallPolicy, request: CallPolicyRequest) {
  return verifyCallPolicy(await rpc("save_clinical_call_policy", { ...policyArgs(pending), p_request: callPolicyRequestSchema.parse(request) }), pending, request);
}
export async function recoverCallPolicy(pending: PendingCallPolicy, request?: CallPolicyRequest | null) {
  const value = await rpc("recover_clinical_call_policy", policyArgs(pending));
  return value === null ? null : verifyCallPolicy(value, pending, request);
}
export async function cancelCallPolicy(pending: PendingCallPolicy) {
  return z.object({ cancelled: z.boolean() }).strict().parse(await rpc("cancel_clinical_call_policy", policyArgs(pending)));
}
