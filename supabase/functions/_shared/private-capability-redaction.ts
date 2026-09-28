// Private capability redaction for provider evidence.
//
// Recognition mirrors reject_persisted_document_capability, (v1|p1|s1)\.[A-Za-z0-9_-]{43}
// (document-link-capability.ts, payment-access-capability.ts), plus the e1
// estimate-decision shape (estimate-decision-capability.ts). When the token is a
// URL fragment (/shared/:grantId#v1..., /pay/:grantId#p1..., /payment/return|cancel/
// :grantId#s1..., /estimate/:grantId#e1...) the whole URL is replaced. SQL applies
// the same rule in public.redact_private_capabilities
// (20260928160000_cloudtalk_capability_redaction.sql); keep the two in step.

const urlPrefix = String.raw`(?:https?:\/\/[^\s#]*#)?`;
const token = String.raw`\.[A-Za-z0-9_-]{43}`;
const rules: ReadonlyArray<readonly [RegExp, string]> = [
  [new RegExp(`${urlPrefix}v1${token}`, "g"), "[secure document link]"],
  [new RegExp(`${urlPrefix}[ps]1${token}`, "g"), "[secure payment link]"],
  [new RegExp(`${urlPrefix}e1${token}`, "g"), "[secure estimate link]"],
];
const maxDepth = 32;

export function redactPrivateCapabilities(text: string): string {
  return rules.reduce((value, [pattern, placeholder]) => value.replace(pattern, placeholder), text);
}

/** Returns a copy with every string value redacted. Keys are left as sent. */
export function redactPrivateCapabilitiesDeep(value: unknown, depth = 0): unknown {
  if (depth > maxDepth) throw new Error("Invalid CloudTalk webhook event");
  if (typeof value === "string") return redactPrivateCapabilities(value);
  if (Array.isArray(value)) return value.map((entry) => redactPrivateCapabilitiesDeep(entry, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, redactPrivateCapabilitiesDeep(entry, depth + 1)]),
    );
  }
  return value;
}
