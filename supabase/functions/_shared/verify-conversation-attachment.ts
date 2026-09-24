import { boundedBody, WebhookError } from "./inbound/verification.ts";
export interface ConversationUpload {
  id: string;
  actor_id: string;
  storage_path: string;
  mime_type: string;
  byte_length: number;
  status: "uploading" | "ready" | "abandoned";
}
export interface AttachmentVerifierDependencies {
  authenticate(token: string): Promise<
    {
      actorId: string;
      readUpload(id: string): Promise<ConversationUpload | null>;
      download(path: string): Promise<Blob>;
    } | null
  >;
  verify(
    args: {
      p_id: string;
      p_actor_id: string;
      p_byte_length: number;
      p_mime_type: string;
      p_sha256: string;
    },
  ): Promise<unknown>;
}
const maximumBytes = 10 * 1024 * 1024;
export async function verifyConversationAttachmentBytes(
  blob: Blob,
  expected: { mime_type: string; byte_length: number },
): Promise<string> {
  if (
    !Number.isSafeInteger(expected.byte_length) || expected.byte_length < 1 ||
    expected.byte_length > maximumBytes || blob.size !== expected.byte_length ||
    blob.type !== expected.mime_type
  ) throw new Error("Attachment bytes do not match reservation");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const starts = (signature: number[]) =>
    signature.every((value, index) => bytes[index] === value);
  const signatureMatches = expected.mime_type === "application/pdf"
    ? starts([37, 80, 68, 70, 45])
    : expected.mime_type === "image/png"
    ? starts([137, 80, 78, 71, 13, 10, 26, 10])
    : expected.mime_type === "image/jpeg"
    ? starts([255, 216, 255])
    : false;
  // Signature matching identifies a supported container; it is not malware scanning.
  if (!signatureMatches) {
    throw new Error("Attachment format does not match reservation");
  }
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}
const headers = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization,apikey,content-type,x-client-info",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers });
export function createVerifyConversationAttachmentHandler(
  deps: AttachmentVerifierDependencies,
) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response(null, { headers });
    if (req.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }
    const authorization = req.headers.get("Authorization");
    if (!authorization?.startsWith("Bearer ")) {
      return json({ error: "Staff authorization required" }, 401);
    }
    try {
      const auth = await deps.authenticate(authorization.slice(7));
      if (!auth) return json({ error: "Staff authorization required" }, 401);
      let input: unknown;
      try {
        input = JSON.parse(await boundedBody(req, 1024));
      } catch (error) {
        return json(
          { error: "Exact upload ID required" },
          error instanceof WebhookError && error.status === 413 ? 413 : 400,
        );
      }
      if (
        !input || typeof input !== "object" || Array.isArray(input) ||
        Object.keys(input).length !== 1 || !("id" in input) ||
        typeof input.id !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          input.id,
        )
      ) return json({ error: "Exact upload ID required" }, 400);
      const upload = await auth.readUpload(input.id);
      if (
        !upload || upload.id !== input.id || upload.actor_id !== auth.actorId
      ) return json({ error: "Owned upload required" }, 403);
      if (upload.status !== "uploading" && upload.status !== "ready") {
        return json({ error: "Upload is no longer available" }, 409);
      }
      const blob = await auth.download(upload.storage_path);
      let sha256: string;
      try {
        sha256 = await verifyConversationAttachmentBytes(blob, upload);
      } catch {
        return json({
          error: "File does not match the reserved size and format",
        }, 422);
      }
      const result = await deps.verify({
        p_id: upload.id,
        p_actor_id: auth.actorId,
        p_byte_length: blob.size,
        p_mime_type: upload.mime_type,
        p_sha256: sha256,
      });
      if (!result || typeof result !== "object" || Array.isArray(result)) {
        throw new Error("Verification receipt missing");
      }
      const saved = result as Record<string, unknown>;
      if (
        saved.id !== upload.id || saved.actor_id !== auth.actorId ||
        saved.storage_path !== upload.storage_path ||
        saved.status !== "ready" ||
        saved.byte_length !== blob.size ||
        saved.mime_type !== upload.mime_type ||
        saved.sha256 !== sha256 || typeof saved.verified_at !== "string" ||
        !Number.isFinite(Date.parse(saved.verified_at))
      ) {
        throw new Error("Verification receipt does not match checked bytes");
      }
      return json(result);
    } catch {
      return json({
        error: "Verification could not be confirmed. Retry the same upload.",
      }, 503);
    }
  };
}
