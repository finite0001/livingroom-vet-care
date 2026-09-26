interface CloudTalkEnvelope {
  event_id: string;
  type: string;
  version: string;
  occurred_at: string;
  company_id: string;
  data: Record<string, unknown>;
}

const supportedEvents = new Set(["call.ended", "call.recording_ready", "transcript.ready", "cidata.ready", "message.sent", "message.received"]);
const maxBodyBytes = 262144;

function decodeBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index++) difference |= a[index] ^ b[index];
  return difference === 0;
}

export async function verifyCloudTalkWebhook(
  raw: string,
  headers: Headers,
  secret: string,
  companyId: string,
  allowedNumbers: string[],
): Promise<CloudTalkEnvelope | null> {
  if (!secret.startsWith("whsec_") || !allowedNumbers.length ||
      new TextEncoder().encode(raw).length > maxBodyBytes) throw new Error("CloudTalk webhook configuration unavailable");
  const id = headers.get("svix-id") ?? "";
  const timestamp = headers.get("svix-timestamp") ?? "";
  const signatures = headers.get("svix-signature") ?? "";
  const seconds = Number(timestamp);
  if (!id || !Number.isSafeInteger(seconds) || Math.abs(Date.now() / 1000 - seconds) > 300) {
    throw new Error("Invalid CloudTalk webhook timestamp");
  }
  const decodedKey = decodeBase64(secret.slice(6));
  const secretKey = new Uint8Array(new ArrayBuffer(decodedKey.length));
  secretKey.set(decodedKey);
  const key = await crypto.subtle.importKey("raw", secretKey, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${timestamp}.${raw}`)));
  const valid = signatures.split(" ").some((entry) => {
    if (!entry.startsWith("v1,")) return false;
    try { return equalBytes(decodeBase64(entry.slice(3)), expected); } catch { return false; }
  });
  if (!valid) throw new Error("Invalid CloudTalk webhook signature");

  const event = JSON.parse(raw) as CloudTalkEnvelope;
  if (!event || event.version !== "v1" || typeof event.event_id !== "string" || !event.event_id ||
      typeof event.company_id !== "string" || !event.company_id || (companyId && event.company_id !== companyId) ||
      !event.data || typeof event.data !== "object" || Array.isArray(event.data) ||
      !Number.isFinite(Date.parse(event.occurred_at))) throw new Error("Invalid CloudTalk webhook event");
  if (!supportedEvents.has(event.type)) return null;
  const internal = event.data.internal_number;
  const number = internal && typeof internal === "object" && !Array.isArray(internal)
    ? (internal as Record<string, unknown>).number_e164 : null;
  // Recording and AI events have no number. Their matching call.ended event is
  // checked when it arrives; these partial records are not displayed alone.
  if (!["call.recording_ready", "transcript.ready", "cidata.ready"].includes(event.type) &&
      (typeof number !== "string" || !allowedNumbers.includes(number))) {
    return null;
  }
  return event;
}
