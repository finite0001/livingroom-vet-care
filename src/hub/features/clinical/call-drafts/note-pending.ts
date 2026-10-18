import { z } from "zod";
import { callNoteIntentSchema, callNoteReserveSchema } from "../../../../../supabase/functions/_shared/clinical-call-note-processing-model.ts";
const uuid = z.string().uuid();
const scope = { actor: uuid, pet: uuid, encounter: uuid, source: uuid };
export const pendingCallNoteSchema = z.discriminatedUnion("kind", [
  z.object({ ...scope, kind: z.literal("reserve"), id: uuid, request: callNoteReserveSchema }).strict(),
  z.object({ ...scope, kind: z.literal("generate"), id: uuid, intent: callNoteIntentSchema.extend({ reason: z.enum(["", "previous_failure_reviewed", "uncertain_outcome_duplicate_charge_authorized", "expired_attempt_reviewed"]) }) }).strict(),
  z.object({ ...scope, kind: z.literal("review"), id: uuid, job: uuid }).strict(),
]);
export type PendingCallNote = z.infer<typeof pendingCallNoteSchema>;
export function verifyPendingCallNote(value: unknown, actor: string, pet: string, encounter: string, source: string) {
  const pending = pendingCallNoteSchema.parse(value);
  if (pending.actor !== actor || pending.pet !== pet || pending.encounter !== encounter || pending.source !== source || (pending.kind === "reserve" && pending.request.source_id !== source) || (pending.kind === "generate" && pending.id !== pending.intent.job_id)) throw Error("Call note recovery destination differs.");
  return pending;
}
export function callNoteStorageKey(actor: string, pet: string, encounter: string) {
  for (const value of [actor, pet, encounter]) uuid.parse(value);
  return `lrv:call-note:${actor}:${pet}:${encounter}`;
}
export function inspectCallNoteRecovery(storage: Pick<Storage, "getItem">, actor: string, pet: string, encounter: string) {
  try {
    const raw = storage.getItem(callNoteStorageKey(actor, pet, encounter));
    if (!raw) return { value: null, invalid: false };
    const value = pendingCallNoteSchema.parse(JSON.parse(raw));
    return { value: verifyPendingCallNote(value, actor, pet, encounter, value.source), invalid: false };
  } catch { return { value: null, invalid: true }; }
}
export function callNoteAttemptActive(attempt: { state?: string; lease_until?: string | null }) {
  if (!attempt.state) return true;
  if (!["claimed", "sending"].includes(attempt.state)) return false;
  return !attempt.lease_until || !Number.isFinite(Date.parse(attempt.lease_until)) || Date.parse(attempt.lease_until) > Date.now();
}
export const callNoteRetryReasons = {
  previous_failure_reviewed: "Previous processing failure reviewed",
  uncertain_outcome_duplicate_charge_authorized: "Prior outcome uncertain; possible duplicate charge authorized",
  expired_attempt_reviewed: "Expired processing attempt reviewed",
};
