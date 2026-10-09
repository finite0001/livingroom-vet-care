import { z } from "zod";
import { boundedBody, WebhookError } from "./inbound/verification.ts";
import {
  MAX_PHOTO_BYTES,
  photoDigest,
  verifyNormalizedPhoto,
} from "./patient-photo-image.ts";

const documentSchema = z.object({
  id: z.string().uuid(),
  pet_id: z.string().uuid(),
  created_by: z.string().uuid(),
  file_path: z.string(),
  file_size: z.number().int().min(1).max(MAX_PHOTO_BYTES),
  mime_type: z.literal("image/png"),
  status: z.enum(["uploading", "ready"]),
  visibility: z.literal("internal"),
  source: z.literal("Patient identity photo"),
});
const uploadSchema = z.object({
  document: documentSchema,
  object_id: z.string().uuid(),
  expected_sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
const receiptSchema = z.object({
  id: z.string().uuid(),
  actor_id: z.string().uuid(),
  sha256: z.string(),
  width: z.number().int(),
  height: z.number().int(),
});
export interface PhotoVerificationDependencies {
  authenticate(
    token: string,
  ): Promise<
    {
      actorId: string;
      read(id: string): Promise<unknown>;
      download(path: string): Promise<Blob>;
    } | null
  >;
  verify(args: Record<string, unknown>): Promise<unknown>;
}
export function createPatientPhotoVerificationHandler(
  deps: PhotoVerificationDependencies,
) {
  const headers = {
    "Content-Type": "application/json",
    "Cache-Control": "private, no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
      "authorization,apikey,content-type,x-client-info",
    "X-Content-Type-Options": "nosniff",
  };
  const reply = (status: number, error: string) =>
    new Response(JSON.stringify({ error }), { status, headers });
  return async (request: Request): Promise<Response> => {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }
    if (request.method !== "POST") return reply(405, "Method not allowed");
    const token = request.headers.get("Authorization")?.match(/^Bearer (\S+)$/)
      ?.[1];
    if (!token) return reply(401, "Staff sign-in required");
    try {
      const auth = await deps.authenticate(token);
      if (!auth) return reply(401, "Staff sign-in required");
      let id: string;
      try {
        id = z.object({ id: z.string().uuid() }).strict().parse(
          JSON.parse(await boundedBody(request, 1024)),
        ).id;
      } catch (error) {
        return reply(
          error instanceof WebhookError && error.status === 413 ? 413 : 400,
          "Exact photo reservation required",
        );
      }
      const parsed = uploadSchema.safeParse(await auth.read(id));
      if (!parsed.success) {
        return reply(409, "Upload the reserved image before verifying it");
      }
      const { document: doc, object_id: objectId, expected_sha256: expected } =
        parsed.data;
      if (
        doc.id !== id || doc.created_by !== auth.actorId ||
        doc.file_path !== `${auth.actorId}/${doc.pet_id}/${id}/original`
      ) {
        return reply(403, "Owned photo reservation required");
      }
      const blob = await auth.download(doc.file_path);
      if (blob.size !== doc.file_size || blob.type !== doc.mime_type) {
        return reply(422, "Image size or type differs from reservation");
      }
      let width: number, height: number, digest: string;
      try {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        ({ width, height } = await verifyNormalizedPhoto(bytes));
        if (
          width < 1 || height < 1 || width > 4096 || height > 4096 ||
          width * height > 16777216
        ) throw new Error("Image dimensions too large");
        digest = await photoDigest(bytes);
        if (digest !== expected) throw new Error("Different image");
      } catch {
        return reply(422, "Image contents do not match the reserved photo");
      }
      const saved = receiptSchema.parse(
        await deps.verify({
          p_id: id,
          p_actor_id: auth.actorId,
          p_object_id: objectId,
          p_sha256: digest,
          p_width: width,
          p_height: height,
        }),
      );
      if (
        saved.id !== id || saved.actor_id !== auth.actorId ||
        saved.sha256 !== digest || saved.width !== width ||
        saved.height !== height
      ) {
        throw new Error("Verification receipt differs");
      }
      return new Response(JSON.stringify(saved), { status: 200, headers });
    } catch {
      return reply(
        503,
        "Photo verification could not be confirmed. Retry the same photo.",
      );
    }
  };
}
