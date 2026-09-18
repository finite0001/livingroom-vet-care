import { authenticateWorker, type WorkerAuthEnvironment } from "./worker-auth.ts";
import { boundedBody } from "./inbound/verification.ts";
export interface AttachmentCleanupEnvironment extends WorkerAuthEnvironment {
  ATTACHMENT_CLEANUP_ENABLED?: string;
  ATTACHMENT_CLEANUP_GRACE_HOURS?: string;
}
export function createAbandonedCleanupHandler(env: AttachmentCleanupEnvironment,
  run: (uploadId: string, graceHours: number, credential: string) => Promise<{ status: "empty" } | { id: string; status: "complete" }>) {
  const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
    const credential = authenticateWorker(request, env);
    if (!credential) return json({ error: "Worker authentication required" }, 401);
    if (env.ATTACHMENT_CLEANUP_ENABLED !== "true") return json({ error: "Attachment cleanup is disabled" }, 503);
    const configuredGrace = env.ATTACHMENT_CLEANUP_GRACE_HOURS ?? "";
    const grace = Number(configuredGrace);
    if (!/^\d+$/.test(configuredGrace) || !Number.isInteger(grace) || grace < 24 || grace > 720)
      return json({ error: "Attachment cleanup grace is not configured" }, 503);
    let input: unknown;
    try { input = JSON.parse(await boundedBody(request, 512)); } catch { return json({ error: "Exact upload identity required" }, 400); }
    if (!input || typeof input !== "object" || Array.isArray(input)) return json({ error: "Exact upload identity required" }, 400);
    const body = input as Record<string, unknown>;
    if (Object.keys(body).length !== 1 || typeof body.upload_id !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(body.upload_id))
      return json({ error: "Exact upload identity required" }, 400);
    try { return json(await run(body.upload_id, grace, credential)); }
    catch { return json({ error: "Cleanup is unconfirmed; recover this same upload" }, 503); }
  };
}
