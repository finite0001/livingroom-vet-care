import { z } from "zod";
const id = z.string().uuid(),
  version = z.number().int().positive(),
  date = z.string().datetime({ offset: true });
export const inboundSchema = z.object({
  id,
  channel: z.enum(["EMAIL", "SMS", "CALL_INBOUND", "CALL_OUTBOUND", "VOICEMAIL"]),
  // CloudTalk Phone activity can be staff-started; older rows omit the column.
  direction: z.enum(["inbound", "outbound"]).default("inbound"),
  sender: z.string(),
  recipient: z.string(),
  subject: z.string(),
  body: z.string(),
  occurred_at: date,
  received_at: date,
  client_id: id.nullable(),
  conversation_id: id.nullable(),
  message_id: id.nullable(),
  review_reason: z.string().nullable(),
  version,
});
export const assignmentSchema = z.object({
  id,
  inbound_id: id,
  client_id: id,
  conversation_id: id,
  assigned_by: id,
  reason: z.string(),
  created_at: date,
});
export const intentSchema = z
  .object({
    p_actor_id: id,
    p_id: id,
    p_expected_version: version,
    p_client_id: id,
    p_conversation_id: id,
    p_reason: z.string().min(5).max(1000),
  })
  .strict();
export interface Inbound extends Required<z.infer<typeof inboundSchema>> {}
export interface Assignment
  extends Required<z.infer<typeof assignmentSchema>> {}
export interface AssignmentIntent
  extends Required<z.infer<typeof intentSchema>> {}
export interface Recovery {
  inbound: Inbound | null;
  assignments: Assignment[];
}
export function assignmentIntent(
  value: unknown,
  actor: string,
): AssignmentIntent {
  const p = intentSchema.parse(value) as AssignmentIntent;
  if (p.p_actor_id !== actor) throw new Error("Original actor required");
  return p;
}
export function recovery(value: unknown, idValue: string): Recovery {
  const r = z
    .object({
      inbound: inboundSchema.nullable(),
      assignments: z.array(assignmentSchema),
    })
    .parse(value) as Recovery;
  if (
    (r.inbound && r.inbound.id !== idValue) ||
    r.assignments.some((a) => a.inbound_id !== idValue)
  )
    throw new Error("Original inbound identity differs");
  return r;
}
export function assignmentOutcome(
  value: Recovery,
  intent: AssignmentIntent,
): "assigned" | "unassigned" | "conflict" | "unavailable" {
  const r = value.inbound;
  if (!r) return "unavailable";
  if (r.id !== intent.p_id)
    throw new Error("Original inbound identity differs");
  if (!r.message_id) {
    return r.version === intent.p_expected_version &&
      value.assignments.length === 0
      ? "unassigned"
      : "conflict";
  }
  const a = value.assignments.find(
    (a) =>
      a.inbound_id === r.id &&
      a.assigned_by === intent.p_actor_id &&
      a.client_id === intent.p_client_id &&
      a.conversation_id === intent.p_conversation_id &&
      a.reason === intent.p_reason,
  );
  return a &&
    r.version === intent.p_expected_version + 1 &&
    r.client_id === intent.p_client_id &&
    r.conversation_id === intent.p_conversation_id
    ? "assigned"
    : "conflict";
}
const channelLabels: Record<Inbound["channel"], string> = {
  EMAIL: "Email",
  SMS: "Text",
  CALL_INBOUND: "Incoming call",
  CALL_OUTBOUND: "Outgoing call",
  VOICEMAIL: "Voicemail",
};
/** Queue label; CloudTalk Phone activity started by staff is named as such. */
export function inboundLabel(r: Pick<Inbound, "channel" | "direction">): string {
  const label = channelLabels[r.channel];
  return r.direction === "outbound" && r.channel === "SMS" ? `${label} sent from CloudTalk Phone` : label;
}
/** The outside party: staff-started CloudTalk activity is recorded from the practice number, so show who it went to. */
export function inboundCounterpart(r: Pick<Inbound, "direction" | "sender" | "recipient">): string {
  return r.direction === "outbound" ? `to ${r.recipient}` : r.sender;
}
/** One-line preview: email subject, otherwise the plain text recorded for the entry. */
export function inboundPreview(r: Pick<Inbound, "channel" | "subject" | "body">): string {
  if (r.channel === "EMAIL") return r.subject || "No subject";
  const text = r.body.replace(/\s+/g, " ").trim();
  return text.length > 160 ? `${text.slice(0, 159)}…` : text || "No text";
}
