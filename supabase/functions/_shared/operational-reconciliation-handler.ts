import { z } from "zod";
import { authenticateWorker, type WorkerAuthEnvironment } from "./worker-auth.ts";
import {
  reconciliationLimits,
  reconciliationRequestSchema,
  readReconciliationRun,
  sameReconciliationRequest,
  type ReconciliationRun,
} from "./operational-reconciliation-contract.ts";

export interface ReconciliationEnvironment extends WorkerAuthEnvironment {
  OPERATIONAL_RECONCILIATION_ENABLED?: string;
  APP_ENV?: string;
}
export interface ReconciliationDatabase {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}
const disabledSchema = z.object({ disabled: z.literal(true) }).strict();
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
});

async function boundedBody(request: Request): Promise<string | null> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0, text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) return text + decoder.decode();
      bytes += chunk.value.byteLength;
      if (bytes > reconciliationLimits.maxBodyBytes) {
        await reader.cancel();
        return null;
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
}

export function createOperationalReconciliationHandler(
  env: ReconciliationEnvironment,
  createDatabase: (key: string) => ReconciliationDatabase,
) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
    const key = authenticateWorker(request, env);
    if (!key) return json({ error: "Service authorization required" }, 401);
    // The environment gate cannot create a client, a run, or a cursor.
    if (env.OPERATIONAL_RECONCILIATION_ENABLED !== "true") return json({ disabled: true, reconciled: false });
    if (!["staging", "production"].includes(env.APP_ENV ?? ""))
      return json({ error: "Explicit staging or production environment required", reconciled: false }, 503);
    let input;
    try {
      const body = await boundedBody(request);
      if (body === null) return json({ error: "Request too large" }, 413);
      const parsed = reconciliationRequestSchema.safeParse(body.trim() ? JSON.parse(body) : {});
      if (!parsed.success) return json({ error: "Only a run identity and bounded integer limit are accepted" }, 400);
      input = parsed.data;
    } catch {
      return json({ error: "Invalid JSON request" }, 400);
    }
    const runId = input.run_id ?? crypto.randomUUID(), limit = input.limit;
    let database: ReconciliationDatabase | null = null;
    let prepared: ReconciliationRun | null = null;
    const unknown = () => json({ run_id: runId, requested_limit: limit, outcome: "unknown", reconciled: false }, 202);
    const respond = (run: ReconciliationRun) => json({ ...run, reconciled: run.outcome === "completed" }, run.outcome === "started" ? 202 : 200);
    try {
      database = createDatabase(key);
      const started = await database.rpc("start_operational_reconciliation_run", { p_run_id: runId, p_limit: limit });
      if (started.error) throw started.error;
      if (disabledSchema.safeParse(started.data).success) return json({ disabled: true, reconciled: false });
      const receipt = readReconciliationRun(started.data, runId, limit);
      if (!receipt) throw new Error("Invalid start receipt");
      prepared = receipt;
      if (receipt.outcome !== "started") return respond(receipt);
      const executed = await database.rpc("execute_operational_reconciliation_run", { p_run_id: runId, p_limit: limit });
      if (executed.error) throw executed.error;
      const completed = readReconciliationRun(executed.data, runId, limit);
      if (!completed || completed.outcome === "started" || !sameReconciliationRequest(receipt, completed)) throw new Error("Missing matching terminal receipt");
      return respond(completed);
    } catch {
      if (!database) return unknown();
      // Recover reads the original UUID/request only. It never materializes work.
      try {
        const recovered = await database.rpc("recover_operational_reconciliation_run", { p_run_id: runId, p_limit: limit });
        if (recovered.error) throw recovered.error;
        const receipt = readReconciliationRun(recovered.data, runId, limit);
        return receipt && (!prepared || sameReconciliationRequest(prepared, receipt)) ? respond(receipt) : unknown();
      } catch {
        return unknown();
      }
    }
  };
}
