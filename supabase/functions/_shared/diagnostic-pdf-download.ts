import { z } from "zod";
import { verifiedDiagnosticPdfResponse } from "./diagnostic-pdf-bytes.ts";
import { boundedBody } from "./inbound/verification.ts";
const uuid = z.string().uuid();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const diagnosticPdfDownloadRequestSchema = z
  .object({ id: uuid, job_id: uuid, pet_id: uuid })
  .strict();
const authoritySchema = z
  .object({
    authority_id: uuid,
    job_id: uuid,
    pet_id: uuid,
    actor_id: uuid,
    sha256: hash,
    byte_length: z.number().int().min(1).max(3145728),
    expires_at: z.string().datetime({ offset: true }),
  })
  .strict();
const contextSchema = authoritySchema.extend({
  bucket: z.literal("diagnostic-pdfs"),
  object_path: z
    .string()
    .regex(/^[a-f0-9-]{36}\/[a-f0-9-]{36}\/[a-f0-9]{64}\.pdf$/),
});
const receiptSchema = authoritySchema
  .omit({ expires_at: true })
  .extend({ outcome: z.literal("response_prepared") });
export interface DiagnosticPdfDatabase {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: unknown }>;
}
export interface DiagnosticPdfDownloadDependencies {
  authenticate(
    token: string,
  ): Promise<{ actorId: string; db: DiagnosticPdfDatabase } | null>;
  service: DiagnosticPdfDatabase;
  download(context: z.infer<typeof contextSchema>): Promise<Response>;
}
function base64(bytes: Uint8Array) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 16384)
    binary += String.fromCharCode(...bytes.subarray(i, i + 16384));
  return btoa(binary);
}
async function rpc(
  db: DiagnosticPdfDatabase,
  name: string,
  args: Record<string, unknown>,
) {
  const { data, error } = await db.rpc(name, args);
  if (error) throw error;
  return data;
}
const headers = {
  "Cache-Control": "private, no-store",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization,apikey,content-type,x-client-info",
  "Access-Control-Expose-Headers":
    "content-disposition,content-type,content-length,x-diagnostic-pdf-sha256",
};
export function createDiagnosticPdfDownloadHandler(
  deps: DiagnosticPdfDownloadDependencies,
) {
  return async (request: Request): Promise<Response> => {
    const deny = (status: number) =>
      Response.json(
        {
          error:
            "Diagnostic PDF unavailable. Refresh the report and try again.",
        },
        { status, headers },
      );
    if (request.method === "OPTIONS")
      return new Response(null, { status: 204, headers });
    if (request.method !== "POST" || new URL(request.url).search)
      return deny(405);
    const token = request.headers
      .get("Authorization")
      ?.match(/^Bearer (\S+)$/)?.[1];
    if (!token) return deny(401);
    let input: z.infer<typeof diagnosticPdfDownloadRequestSchema>;
    try {
      if (
        request.headers.get("Content-Type")?.split(";")[0].trim() !==
        "application/json"
      )
        return deny(400);
      input = diagnosticPdfDownloadRequestSchema.parse(
        JSON.parse(await boundedBody(request, 1024)),
      );
    } catch {
      return deny(400);
    }
    try {
      const auth = await deps.authenticate(token);
      if (!auth || !uuid.safeParse(auth.actorId).success) return deny(401);
      const authority = authoritySchema.parse(
        await rpc(auth.db, "authorize_diagnostic_pdf_download", {
          p_id: input.id,
          p_job: input.job_id,
          p_pet: input.pet_id,
        }),
      );
      if (
        authority.authority_id !== input.id ||
        authority.job_id !== input.job_id ||
        authority.pet_id !== input.pet_id ||
        authority.actor_id !== auth.actorId
      )
        throw new Error("Authority differs");
      const context = contextSchema.parse(
        await rpc(deps.service, "read_diagnostic_pdf_download_context", {
          p_id: input.id,
          p_actor: auth.actorId,
        }),
      );
      if (
        JSON.stringify(authoritySchema.strip().parse(context)) !==
        JSON.stringify(authority)
      )
        throw new Error("Download context differs");
      if (
        context.object_path !==
        `${input.pet_id}/${input.job_id}/${authority.sha256}.pdf`
      )
        throw new Error("Private PDF path differs");
      const bytes = await verifiedDiagnosticPdfResponse(
        await deps.download(context),
        context.byte_length,
        context.sha256,
      );
      const receipt = receiptSchema.parse(
        await rpc(deps.service, "complete_diagnostic_pdf_download", {
          p_id: input.id,
          p_actor: auth.actorId,
          p_base64: base64(bytes),
        }),
      );
      if (
        JSON.stringify(
          receiptSchema
            .strip()
            .parse({ ...authority, outcome: "response_prepared" }),
        ) !== JSON.stringify(receipt)
      )
        throw new Error("Prepared response differs");
      return new Response(bytes, {
        status: 200,
        headers: {
          ...headers,
          "Content-Type": "application/pdf",
          "Content-Length": String(bytes.length),
          "Content-Disposition": `attachment; filename="diagnostic-${input.job_id}.pdf"`,
          "X-Diagnostic-Pdf-Sha256": authority.sha256,
        },
      });
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error
          ? String(error.code)
          : "";
      return deny(
        code === "42501"
          ? 404
          : ["PT409", "23505", "23514"].includes(code)
            ? 409
            : 503,
      );
    }
  };
}
