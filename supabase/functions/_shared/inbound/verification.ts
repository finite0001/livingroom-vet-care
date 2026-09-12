export class WebhookError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
export async function boundedBody(
  req: Pick<Request, "body" | "headers">,
  limit = 65536,
): Promise<string> {
  if (!req.body) throw new WebhookError(400, "Missing payload");
  if (Number(req.headers.get("content-length")) > limit)
    throw new WebhookError(413, "Payload too large");
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    bytes += chunk.value.length;
    if (bytes > limit) {
      await reader.cancel();
      throw new WebhookError(413, "Payload too large");
    }
    chunks.push(chunk.value);
  }
  const buffer = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
}
export interface ResendVerifier {
  (payload: string, headers: Record<string, string>): unknown;
}
export function verifiedResend(
  raw: string,
  headers: Headers,
  verify: ResendVerifier,
) {
  const id = headers.get("svix-id");
  const timestamp = headers.get("svix-timestamp");
  const signature = headers.get("svix-signature");
  if (!id || !timestamp || !signature)
    throw new WebhookError(401, "Webhook proof required");
  try {
    return {
      id,
      event: verify(raw, {
        "svix-id": id,
        "svix-timestamp": timestamp,
        "svix-signature": signature,
      }) as Record<string, unknown>,
    };
  } catch {
    throw new WebhookError(401, "Invalid or expired webhook proof");
  }
}
export interface TwilioVerifier {
  (signature: string, url: string, params: Record<string, string>): boolean;
}
export function verifiedTwilio(
  req: Request,
  raw: string,
  canonicalUrl: string,
  verify: TwilioVerifier,
): Record<string, string> {
  let url: URL;
  try {
    url = new URL(canonicalUrl);
  } catch {
    throw new WebhookError(503, "Webhook URL is not configured");
  }
  const incoming = new URL(req.url);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    incoming.pathname !== url.pathname ||
    incoming.search !== url.search
  )
    throw new WebhookError(401, "Unexpected webhook URL");
  if (
    !req.headers
      .get("content-type")
      ?.startsWith("application/x-www-form-urlencoded")
  )
    throw new WebhookError(415, "Expected form payload");
  const signature = req.headers.get("x-twilio-signature");
  if (!signature) throw new WebhookError(401, "Webhook proof required");
  const params: Record<string, string> = Object.create(null);
  for (const [key, value] of new URLSearchParams(raw)) {
    if (Object.hasOwn(params, key))
      throw new WebhookError(400, "Duplicate form field");
    params[key] = value;
  }
  if (!verify(signature, canonicalUrl, params))
    throw new WebhookError(401, "Invalid webhook proof");
  return params;
}
export async function digestMetadata(value: unknown): Promise<string> {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
