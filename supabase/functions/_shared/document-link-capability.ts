import { sha256Hex } from "./release-email-payload.ts";
export interface DocumentLinkConfig {
  origin: string;
  activeKeyVersion: string;
  keys: Record<string, string>;
  publicEnabled: boolean;
}
export interface CapabilityGrant {
  id: string;
  origin: string;
  key_version: string;
  capability_context: string;
  message_template: string;
}
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function documentLinkConfig(values: {
  origin?: string;
  activeKeyVersion?: string;
  keys?: string;
  publicEnabled?: string;
}): DocumentLinkConfig {
  const origin = values.origin || "",
    activeKeyVersion = values.activeKeyVersion || "";
  const url = new URL(origin);
  if (
    url.origin !== origin ||
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(url.hostname)
      )) ||
    !/^[A-Za-z0-9_-]{1,40}$/.test(activeKeyVersion)
  )
    throw new Error("Document link configuration unavailable");
  const keys = JSON.parse(values.keys || "{}") as Record<string, string>;
  if (
    !keys ||
    typeof keys !== "object" ||
    Array.isArray(keys) ||
    !Object.hasOwn(keys, activeKeyVersion)
  )
    throw new Error("Document link configuration unavailable");
  for (const [version, value] of Object.entries(keys)) {
    if (
      !/^[A-Za-z0-9_-]{1,40}$/.test(version) ||
      typeof value !== "string" ||
      !keyBytes(value)
    )
      throw new Error("Document link configuration unavailable");
  }
  return {
    origin,
    activeKeyVersion,
    keys,
    publicEnabled: values.publicEnabled === "true",
  };
}
function keyBytes(value: string) {
  const raw = atob(value);
  if (raw.length < 32 || raw.length > 64)
    throw new Error("Document link key unavailable");
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
export async function materializeDocumentLink(
  grant: CapabilityGrant,
  config: DocumentLinkConfig,
) {
  if (
    grant.origin !== config.origin ||
    !uuid.test(grant.id) ||
    !Object.hasOwn(config.keys, grant.key_version)
  )
    throw new Error("Document link key or origin unavailable");
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes(config.keys[grant.key_version]),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(grant.capability_context),
    ),
  );
  const token =
    "v1." +
    btoa(String.fromCharCode(...signed))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replaceAll("=", "");
  const clientUrl = `${grant.origin}/shared/${grant.id}#${token}`;
  if (grant.message_template.split("{{document_link}}").length !== 2)
    throw new Error("Document link message invalid");
  const materializedMessage = grant.message_template.replace(
    "{{document_link}}",
    clientUrl,
  );
  return {
    token,
    client_url: clientUrl,
    materialized_message: materializedMessage,
    token_hash: await sha256Hex(new TextEncoder().encode(token)),
    message_hash: await sha256Hex(
      new TextEncoder().encode(materializedMessage),
    ),
  };
}
export function constantTimeText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++)
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}
export function validGrantId(value: unknown): value is string {
  return typeof value === "string" && uuid.test(value);
}
