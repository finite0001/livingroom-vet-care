import { authenticateWorker, type WorkerAuthEnvironment } from "./worker-auth.ts";
import { boundedBody } from "./inbound/verification.ts";
import { runWorkerBatch, type WorkerBatchOptions } from "./worker-batch.ts";
export interface AttachmentCleanupEnvironment extends WorkerAuthEnvironment {
  ATTACHMENT_CLEANUP_ENABLED?: string;
  ATTACHMENT_CLEANUP_GRACE_HOURS?: string;
}
export type AbandonedCleanupOutcome = { status: "empty" } | { id: string; status: "complete" };
/** Server-side discovery: list_abandoned_attachment_cleanup_candidates under the same grace. Returns upload IDs only. */
export type AbandonedCleanupDiscovery = (graceHours: number, limit: number, credential: string) => Promise<string[]>;
const uploadId = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
/** Candidates discovered per scheduled call. Each still passes the per-upload claim, which is the authorization. */
export const CLEANUP_BATCH_DISCOVERY_LIMIT = 25;
/**
 * Two request shapes:
 *  - `{"upload_id":"<uuid>"}` attempts exactly that upload (operator recovery).
 *  - `{}` (what the scheduler posts) discovers up to 25 eligible uploads with the
 *    server-configured grace and attempts each in turn within the batch budget.
 *    Discovery is a snapshot; every upload is still claimed, revalidated and
 *    finalized individually. The first unconfirmed cleanup stops the batch and
 *    answers 503 naming that upload, exactly as the single-upload mode does.
 */
export function createAbandonedCleanupHandler(env: AttachmentCleanupEnvironment,
  run: (uploadId: string, graceHours: number, credential: string) => Promise<AbandonedCleanupOutcome>,
  discover?: AbandonedCleanupDiscovery,
  batchOptions: WorkerBatchOptions = {}) {
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
    if (discover && Object.keys(body).length === 0) return await batch(grace, credential);
    if (Object.keys(body).length !== 1 || typeof body.upload_id !== "string" || !uploadId.test(body.upload_id))
      return json({ error: "Exact upload identity required" }, 400);
    try { return json(await run(body.upload_id, grace, credential)); }
    catch { return json({ error: "Cleanup is unconfirmed; recover this same upload" }, 503); }
  };
  async function batch(grace: number, credential: string): Promise<Response> {
    let candidates: string[];
    try {
      candidates = await discover!(grace, CLEANUP_BATCH_DISCOVERY_LIMIT, credential);
      if (!Array.isArray(candidates) || candidates.length > CLEANUP_BATCH_DISCOVERY_LIMIT || candidates.some(id => typeof id !== "string" || !uploadId.test(id)))
        throw new Error("Discovery shape");
    } catch { return json({ error: "Cleanup discovery is unavailable" }, 503); }
    let next = 0, unconfirmed: string | null = null;
    const result = await runWorkerBatch<AbandonedCleanupOutcome | { status: "exhausted" } | { status: "unconfirmed" }>(async () => {
      if (next >= candidates.length) return { status: "exhausted" };
      const id = candidates[next++];
      try { return await run(id, grace, credential); }
      catch { unconfirmed = id; return { status: "unconfirmed" }; }
    }, outcome => outcome.status === "exhausted" ? "empty" : outcome.status === "unconfirmed" ? "halt" : "continue",
    { maxItems: CLEANUP_BATCH_DISCOVERY_LIMIT, ...batchOptions });
    const summary = {
      mode: "batch",
      candidates: candidates.length,
      complete: result.results.filter(outcome => outcome.status === "complete").length,
      empty: result.results.filter(outcome => outcome.status === "empty").length,
      stopped: result.stopped,
      elapsed_ms: result.elapsed_ms,
    };
    if (unconfirmed) return json({ ...summary, error: "Cleanup is unconfirmed; recover this same upload", upload_id: unconfirmed }, 503);
    return json(summary);
  }
}
