export interface IntakeConfig {
  secret: string;
  emailHashSecret: string;
  allowedOrigins: string[];
  allowedHostnames: string[];
}
export interface IntakeBackend {
  consumeBudget(): Promise<boolean>;
  receipt(id: string, capabilityHash: string): Promise<{ received: boolean }>;
  accept(
    id: string,
    capabilityHash: string,
    emailHash: string,
    payload: ContactPayload,
  ): Promise<{ received: boolean; limited?: boolean }>;
}
export interface ContactPayload {
  name: string;
  email: string;
  phone: string | null;
  subject: string;
  message: string;
}
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const encoder = new TextEncoder();
export async function sha256(value: string) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", encoder.encode(value)),
    ),
  ]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
export async function verificationKey(token: string) {
  const h = await sha256(token);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
export async function emailBucket(value: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return [
    ...new Uint8Array(
      await crypto.subtle.sign(
        "HMAC",
        key,
        encoder.encode(value.trim().toLowerCase()),
      ),
    ),
  ]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
export async function boundedText(
  request: Pick<Request, "headers" | "body">,
  max = 16384,
) {
  if (Number(request.headers.get("content-length") ?? 0) > max)
    throw new Error("Body too large");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Body required");
  const deadline = Date.now() + 5000;
  let total = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      let result: ReadableStreamReadResult<Uint8Array>;
      try {
        result = await Promise.race([
          reader.read(),
          new Promise<never>((_resolve, reject) => {
            timeout = setTimeout(
              () => reject(new Error("Body read timeout")),
              Math.max(1, deadline - Date.now()),
            );
          }),
        ]);
      } finally {
        clearTimeout(timeout);
      }
      const { done, value } = result;
      if (done) break;
      total += value.length;
      if (total > max) throw new Error("Body too large");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
function payload(value: unknown): ContactPayload {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid fields");
  const p = value as Record<string, unknown>;
  if (Object.keys(p).sort().join(",") !== "email,message,name,phone,subject")
    throw new Error("Invalid fields");
  for (const [key, max] of [
    ["name", 100],
    ["email", 255],
    ["subject", 200],
    ["message", 2000],
  ] as const) {
    if (
      typeof p[key] !== "string" ||
      !(p[key] as string).trim() ||
      (p[key] as string).length > max
    )
      throw new Error("Invalid fields");
  }
  if (
    typeof p.email !== "string" ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email) ||
    !(p.phone === null || (typeof p.phone === "string" && p.phone.length <= 20))
  )
    throw new Error("Invalid fields");
  return {
    name: p.name as string,
    email: p.email,
    phone: p.phone as string | null,
    subject: p.subject as string,
    message: p.message as string,
  };
}
export function createContactHandler(
  config: IntakeConfig,
  backend: IntakeBackend,
  fetcher: typeof fetch = fetch,
) {
  return async (request: Request) => {
    const origin = request.headers.get("origin") ?? "";
    const headers = {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      Vary: "Origin",
      ...(config.allowedOrigins.includes(origin)
        ? { "Access-Control-Allow-Origin": origin }
        : {}),
    };
    const respond = (status: number, value: unknown) =>
      new Response(JSON.stringify(value), { status, headers });
    if (
      !config.secret ||
      config.emailHashSecret.length < 32 ||
      !config.allowedOrigins.length ||
      !config.allowedHostnames.length
    )
      return respond(503, { error: "Intake is not configured" });
    if (!config.allowedOrigins.includes(origin))
      return respond(403, { error: "Origin not allowed" });
    if (request.method === "OPTIONS")
      return new Response(null, {
        status: 204,
        headers: {
          ...headers,
          "Access-Control-Allow-Methods": "POST",
          "Access-Control-Allow-Headers": "content-type",
          "Access-Control-Max-Age": "600",
        },
      });
    if (request.method !== "POST")
      return respond(405, { error: "POST required" });
    if (
      request.headers.get("content-type")?.split(";")[0].trim() !==
      "application/json"
    )
      return respond(415, { error: "JSON required" });
    try {
      if (!(await backend.consumeBudget()))
        return respond(429, {
          error: "Intake is temporarily busy. Retry later.",
        });
    } catch {
      return respond(503, { error: "Intake is temporarily unavailable" });
    }
    let input: Record<string, unknown>;
    let fields: ContactPayload | undefined;
    try {
      input = JSON.parse(await boundedText(request));
      if (
        !input ||
        typeof input !== "object" ||
        Array.isArray(input) ||
        !uuid.test(String(input.request_id)) ||
        typeof input.capability !== "string" ||
        !/^[a-f0-9]{64}$/.test(input.capability) ||
        !["submit", "receipt"].includes(String(input.action))
      )
        throw new Error();
      if (input.action === "submit") {
        fields = payload(input.payload);
        if (
          typeof input.token !== "string" ||
          input.token.length < 1 ||
          input.token.length > 2048
        )
          throw new Error();
      }
    } catch {
      return respond(400, { error: "Invalid request fields or challenge" });
    }
    const id = input.request_id as string,
      capabilityHash = await sha256(input.capability as string);
    try {
      if (input.action === "receipt")
        return respond(200, await backend.receipt(id, capabilityHash));
      // Do not turn a prior receipt into success for changed content. accept() compares exact payload.
      const proofResponse = await fetcher(
        "https://challenges.cloudflare.com/turnstile/v0/siteverify",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            secret: config.secret,
            response: input.token,
            idempotency_key: await verificationKey(input.token as string),
          }),
          redirect: "error",
          signal: AbortSignal.timeout(10000),
        },
      );
      if (!proofResponse.ok)
        return respond(503, {
          error: "Verification unavailable; retry this request",
        });
      const proof = JSON.parse(
        await boundedText(proofResponse, 8192),
      ) as Record<string, unknown>;
      const challengeAt =
        typeof proof.challenge_ts === "string"
          ? Date.parse(proof.challenge_ts)
          : NaN;
      if (
        proof.success !== true ||
        typeof proof.hostname !== "string" ||
        !config.allowedHostnames.includes(proof.hostname) ||
        proof.action !== "contact_intake" ||
        proof.cdata !== id ||
        !Number.isFinite(challengeAt) ||
        Date.now() - challengeAt > 300000 ||
        challengeAt - Date.now() > 30000
      )
        return respond(403, { error: "Complete a new verification challenge" });
      const result = await backend.accept(
        id,
        capabilityHash,
        await emailBucket(fields!.email, config.emailHashSecret),
        fields!,
      );
      return result.limited
        ? respond(429, { error: "Request limit reached. Please retry later." })
        : respond(200, result);
    } catch {
      return respond(503, {
        error: "Receipt is not confirmed. Check this request before retrying.",
      });
    }
  };
}
