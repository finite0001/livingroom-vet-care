import { readAttachmentBytes } from "../ezyvet-import/attachment-bytes.ts";
export interface ReviewedContext {
  record_id: string;
  record_hash: string;
  pet_id: string;
  request_id: string;
  capture_hash: string;
  capture_owner: string;
  intent_id: string;
  storage_object_id: string;
  bucket_id: string;
  object_path: string;
  content_sha256: string;
  mime_type: string;
  file_size: number;
}
interface Dependencies {
  env(key: string): string | undefined;
  authenticate(token: string): Promise<string | null>;
  context(
    actor: string,
    record: string,
    pet: string,
    hash: string,
  ): Promise<ReviewedContext>;
  read(context: ReviewedContext): Promise<Response>;
}
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const hash = /^[a-f0-9]{64}$/;
function checked(
  c: ReviewedContext,
  record: string,
  pet: string,
  captureHash: string,
) {
  const segments = c?.object_path?.split("/") ?? [];
  if (
    !c ||
    c.record_id !== record ||
    c.pet_id !== pet ||
    c.capture_hash !== captureHash ||
    ![
      c.record_id,
      c.pet_id,
      c.request_id,
      c.capture_owner,
      c.intent_id,
      c.storage_object_id,
    ].every((v) => typeof v === "string" && uuid.test(v)) ||
    ![c.capture_hash, c.record_hash, c.content_sha256].every(
      (v) => typeof v === "string" && hash.test(v),
    ) ||
    c.bucket_id !== "ezyvet-attachment-originals" ||
    segments.length !== 5 ||
    segments[0] !== c.capture_owner ||
    segments[1] !== pet ||
    segments[2] !== c.request_id ||
    !uuid.test(segments[3]) ||
    segments[4] !== "original" ||
    !Number.isSafeInteger(c.file_size) ||
    c.file_size < 1 ||
    c.file_size > 20971520 ||
    !["application/pdf", "image/png", "image/jpeg"].includes(c.mime_type)
  )
    throw new Error("Context differs");
  return c;
}
export function createHandler(deps: Dependencies) {
  return async (request: Request): Promise<Response> => {
    let origin: string;
    try {
      origin = new URL(deps.env("APP_URL") || "").origin;
    } catch {
      return new Response(null, { status: 503 });
    }
    const headers = {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Headers":
        "authorization, apikey, content-type, x-client-info",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Expose-Headers":
        "X-Capture-Hash, X-Content-SHA256, Content-Length, Content-Type",
      "Cache-Control": "no-store",
      Vary: "Origin",
      "X-Content-Type-Options": "nosniff",
    };
    const fail = (status: number) =>
      new Response(JSON.stringify({ error: "REVIEWED_ORIGINAL_UNAVAILABLE" }), {
        status,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    if (
      request.headers.get("Origin") &&
      request.headers.get("Origin") !== origin
    )
      return fail(403);
    if (request.method === "OPTIONS") return new Response(null, { headers });
    if (request.method !== "POST") return fail(405);
    const token = request.headers
      .get("Authorization")
      ?.match(/^Bearer (.+)$/)?.[1];
    if (!token) return fail(401);
    try {
      const actor = await deps.authenticate(token);
      if (!actor) return fail(401);
      const reader = request.body?.getReader();
      if (!reader) return fail(400);
      const chunks: Uint8Array[] = [];
      let length = 0;
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          length += part.value.length;
          if (length > 2048) return fail(400);
          chunks.push(part.value);
        }
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      const raw = new Uint8Array(length);
      let at = 0;
      for (const part of chunks) {
        raw.set(part, at);
        at += part.length;
      }
      let body: Record<string, unknown>;
      try {
        body = JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(raw),
        );
      } catch {
        return fail(400);
      }
      if (
        !body ||
        Array.isArray(body) ||
        typeof body !== "object" ||
        Object.keys(body).length !== 3 ||
        typeof body.record_id !== "string" ||
        !uuid.test(body.record_id) ||
        typeof body.pet_id !== "string" ||
        !uuid.test(body.pet_id) ||
        typeof body.capture_hash !== "string" ||
        !hash.test(body.capture_hash)
      )
        return fail(400);
      const {
        record_id: record,
        pet_id: pet,
        capture_hash: captureHash,
      } = body;
      const c = checked(
        await deps.context(actor, record, pet, captureHash),
        record,
        pet,
        captureHash,
      );
      const file = await readAttachmentBytes(
        await deps.read(c),
        c.mime_type,
        AbortSignal.timeout(20000),
      );
      if (
        file.sha256 !== c.content_sha256 ||
        file.size !== c.file_size ||
        file.mimeType !== c.mime_type
      )
        return fail(409);
      if ((await deps.authenticate(token)) !== actor) return fail(401);
      const after = checked(
        await deps.context(actor, record, pet, captureHash),
        record,
        pet,
        captureHash,
      );
      if (
        Object.keys(c).some(
          (key) =>
            c[key as keyof ReviewedContext] !==
            after[key as keyof ReviewedContext],
        )
      )
        return fail(409);
      const extension =
        file.mimeType === "application/pdf"
          ? "pdf"
          : file.mimeType === "image/png"
            ? "png"
            : "jpg";
      return new Response(file.bytes, {
        headers: {
          ...headers,
          "Content-Type": file.mimeType,
          "Content-Length": String(file.size),
          "Content-Disposition": `attachment; filename="reviewed-original-${record}.${extension}"`,
          "X-Capture-Hash": captureHash,
          "X-Content-SHA256": file.sha256,
        },
      });
    } catch {
      return fail(403);
    }
  };
}
