// Pure mapping between CloudTalk originals and conversation thread entries.
// The database projects CloudTalk texts and calls into `messages` with
// provider = "cloudtalk" and provider_message_id = "message:<id>" | "call:<uuid>".

export interface CloudTalkRef {
  kind: "message" | "call";
  id: string;
}

export interface ThreadCallDetails {
  call_uuid: string;
  direction: string | null;
  duration_seconds: number | null;
  talking_seconds: number | null;
  is_voicemail: boolean;
  recording_ready: boolean;
  transcript_ready: boolean;
  ai_summary: string | null;
}

export type CallOutcome = "voicemail" | "missed" | "not_answered" | "answered" | "unknown";

export interface CallSummary {
  direction: "inbound" | "outbound" | null;
  outcome: CallOutcome;
  title: string;
  durationText: string | null;
}

const refPattern = /^(message|call):(.{1,200})$/s;

export function cloudtalkRef(provider: string | null | undefined, providerMessageId: string | null | undefined): CloudTalkRef | null {
  if (provider !== "cloudtalk" || typeof providerMessageId !== "string") return null;
  const match = refPattern.exec(providerMessageId);
  return match ? { kind: match[1] as CloudTalkRef["kind"], id: match[2] } : null;
}

export function cloudtalkCallIds(messages: ReadonlyArray<{ provider?: string | null; provider_message_id?: string | null }>): string[] {
  const ids = new Set<string>();
  for (const message of messages) {
    const ref = cloudtalkRef(message.provider, message.provider_message_id);
    if (ref?.kind === "call") ids.add(ref.id);
  }
  return [...ids].sort();
}

export function formatCallDuration(seconds: number | null | undefined): string | null {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) return null;
  const whole = Math.floor(seconds);
  if (whole < 60) return `${whole}s`;
  return `${Math.floor(whole / 60)}m ${String(whole % 60).padStart(2, "0")}s`;
}

export function callDirection(value: string | null | undefined): "inbound" | "outbound" | null {
  switch ((value ?? "").toLowerCase()) {
    case "incoming":
    case "inbound":
      return "inbound";
    case "outgoing":
    case "outbound":
      return "outbound";
    default:
      return null;
  }
}

/** Mirrors the wording written by project_cloudtalk_source so live details agree with the stored entry. */
export function summarizeCall(call: ThreadCallDetails): CallSummary {
  const direction = callDirection(call.direction);
  let outcome: CallOutcome;
  if (call.is_voicemail) outcome = "voicemail";
  else if (call.talking_seconds === 0) outcome = direction === "outbound" ? "not_answered" : "missed";
  else if (call.talking_seconds === null) outcome = "unknown";
  else outcome = "answered";
  const title = outcome === "voicemail" ? "Voicemail"
    : outcome === "missed" ? "Missed incoming call"
    : outcome === "not_answered" ? "Outgoing call, not answered"
    : direction === "outbound" ? "Outgoing call"
    : direction === "inbound" ? "Incoming call"
    : "Call";
  const seconds = outcome === "voicemail" ? call.duration_seconds
    : outcome === "missed" || outcome === "not_answered" ? null
    : call.talking_seconds ?? call.duration_seconds;
  return { direction, outcome, title, durationText: formatCallDuration(seconds) };
}

/** Header label for a thread entry; null for non-CloudTalk entries. */
export function cloudtalkEntryLabel(ref: CloudTalkRef | null, senderType: string): string | null {
  if (!ref) return null;
  if (ref.kind === "message") return senderType === "CLIENT" ? "Text via CloudTalk" : "Sent from CloudTalk Phone";
  return "CloudTalk call";
}

/** Parses the admin retry result; anything unexpected is reported as unknown rather than trusted. */
export function retryResult(data: unknown): { projected: number; still_failing: number } | null {
  const row = Array.isArray(data) ? data[0] : null;
  if (!row || typeof row !== "object") return null;
  const { projected, still_failing } = row as Record<string, unknown>;
  return Number.isInteger(projected) && Number.isInteger(still_failing) ? { projected: projected as number, still_failing: still_failing as number } : null;
}
