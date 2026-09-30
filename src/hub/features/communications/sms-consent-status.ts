import { practice } from "../../../config/practice.ts";

// Explains current_sms_consent's effective decision. The server decides; this only words it.
export type SmsBlockReason =
  | "no_phone"
  | "sms_stop"
  | "staff_opt_out"
  | "undeliverable"
  | "complaint"
  | "suppressed"
  | "shared_phone"
  | "consent_withdrawn"
  | "consent_missing";

export interface SmsResumption {
  source: "sms_keyword" | "staff_consent";
  keyword: string | null;
  at: string;
  by: string | null;
  after_reason: string | null;
  after_since: string | null;
}

export interface SmsConsentStatus {
  can_message: boolean;
  phone_number: string | null;
  block_reason?: SmsBlockReason | null;
  blocked_since?: string | null;
  last_resumed?: SmsResumption | null;
}

export const SMS_BLOCKED_FALLBACK = "SMS is blocked. Consent may be missing, withdrawn, shared or suppressed.";

export function formatConsentDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: practice.timezone });
}

const on = (iso: string | null | undefined) => {
  const date = formatConsentDate(iso);
  return date ? ` on ${date}` : "";
};

// Short reason, e.g. for a status chip: "client replied STOP on Sep 30, 2026".
export function smsBlockedReason(status: SmsConsentStatus): string | null {
  if (status.can_message) return null;
  switch (status.block_reason) {
    case "no_phone": return "no valid primary phone number";
    case "sms_stop": return `client replied STOP${on(status.blocked_since)}`;
    case "staff_opt_out": return `consent withdrawn by staff${on(status.blocked_since)}`;
    case "undeliverable": return `carrier reported the number undeliverable${on(status.blocked_since)}`;
    case "complaint": return `carrier reported a complaint${on(status.blocked_since)}`;
    case "suppressed": return `number is on the do-not-text list${on(status.blocked_since)}`;
    case "shared_phone": return "number is shared by more than one household";
    case "consent_withdrawn": return `consent withdrawn${on(status.blocked_since)}`;
    case "consent_missing": return "no SMS consent on record for this number";
    default: return null;
  }
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

// Full sentence for the consent panel and a disabled Text action.
export function smsBlockedText(status: SmsConsentStatus): string | null {
  if (status.can_message) return null;
  const reason = smsBlockedReason(status);
  if (!reason) return SMS_BLOCKED_FALLBACK;
  switch (status.block_reason) {
    case "sms_stop":
      return `${capitalize(reason)}. Texts resume if they reply START, or when staff record new explicit consent.`;
    case "staff_opt_out":
      return `SMS ${reason}. Record new explicit consent to resume texts.`;
    case "undeliverable":
    case "complaint":
    case "suppressed":
      return `SMS is blocked: ${reason}. Recording consent does not lift this.`;
    case "shared_phone":
      return "SMS is blocked: this number is shared by more than one household and needs separate consent review.";
    case "consent_withdrawn":
      return `SMS ${reason}.`;
    default:
      return `${capitalize(reason)}.`;
  }
}

// "Texts resumed: client replied START on Sep 30, 2026" / "re-consented by <staff> on <date>".
export function smsResumedText(status: SmsConsentStatus): string | null {
  const resumed = status.last_resumed;
  if (!status.can_message || !resumed) return null;
  const how = resumed.source === "sms_keyword"
    ? `client replied ${resumed.keyword ?? "START"}${on(resumed.at)}`
    : `re-consented by ${resumed.by ?? "staff"}${on(resumed.at)}`;
  const after = resumed.after_reason === "cloudtalk_sms_stop" || resumed.after_reason === "provider_sms_stop"
    ? ` (after STOP${on(resumed.after_since)})`
    : "";
  return `Texts resumed: ${how}${after}`;
}

export function smsChipText(status: SmsConsentStatus): string {
  if (status.can_message) return status.last_resumed ? "Texts resumed" : "SMS consent on file";
  const reason = smsBlockedReason(status);
  return reason ? `SMS blocked: ${reason}` : "SMS blocked";
}
