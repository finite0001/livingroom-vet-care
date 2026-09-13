import {
  authenticateWorker,
  type WorkerAuthEnvironment,
} from "./worker-auth.ts";
export interface ReminderSchedulerEnvironment extends WorkerAuthEnvironment {
  REMINDER_SCHEDULER_ENABLED?: string;
  APP_ENV?: string;
}
export interface ReminderSchedulerDatabase {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: unknown }>;
}
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
export function createReminderSchedulerHandler(
  env: ReminderSchedulerEnvironment,
  createDatabase: (key: string) => ReminderSchedulerDatabase,
) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }
    const key = authenticateWorker(request, env);
    if (!key) return json({ error: "Service authorization required" }, 401);
    // Disabled means no database client, no claims and no outbox work.
    if (env.REMINDER_SCHEDULER_ENABLED !== "true") {
      return json({ disabled: true, queued: 0, dispatched: false });
    }
    if (!["staging", "production"].includes(env.APP_ENV ?? "")) {
      return json(
        {
          error: "Explicit staging or production environment required",
          dispatched: false,
        },
        503,
      );
    }
    let limit = 25;
    try {
      const text = await boundedBody(request);
      if (text === null) return json({ error: "Request too large" }, 413);
      if (text) {
        const input: unknown = JSON.parse(text);
        if (
          !input ||
          typeof input !== "object" ||
          Array.isArray(input) ||
          Object.keys(input).some((key) => key !== "limit")
        ) {
          return json({ error: "Only a bounded limit is accepted" }, 400);
        }
        if ("limit" in input) {
          if (
            !Number.isInteger(input.limit) ||
            Number(input.limit) < 1 ||
            Number(input.limit) > 100
          ) {
            return json(
              { error: "Limit must be an integer from 1 to 100" },
              400,
            );
          }
          limit = Number(input.limit);
        }
      }
    } catch {
      return json({ error: "Invalid JSON request" }, 400);
    }
    const runId = crypto.randomUUID();
    let database: ReminderSchedulerDatabase;
    const unknown = () =>
      json({ run_id: runId, outcome: "unknown", dispatched: false }, 202);
    const respond = (run: SchedulerRun) =>
      json(
        { ...run, dispatched: false },
        run.outcome === "started" ? 202 : 200,
      );
    try {
      database = createDatabase(key);
      const started = await database.rpc("start_reminder_scheduler_run", {
        p_run_id: runId,
        p_limit: limit,
      });
      if (started.error) throw started.error;
      const receipt = readRun(started.data, runId, limit);
      if (!receipt) throw new Error("Invalid start receipt");
      if (receipt.outcome !== "started") return respond(receipt);
      const executed = await database.rpc("execute_reminder_scheduler_run", {
        p_run_id: runId,
      });
      if (executed.error) throw executed.error;
      const completed = readRun(executed.data, runId, limit);
      if (!completed || completed.outcome === "started") {
        throw new Error("Missing terminal receipt");
      }
      return respond(completed);
    } catch {
      // Recovery is read-only. Never repeat queue execution to reconstruct an ACK.
      try {
        const recovered = await database!.rpc(
          "recover_reminder_scheduler_run",
          { p_run_id: runId },
        );
        if (recovered.error) return unknown();
        const receipt = readRun(recovered.data, runId, limit);
        return receipt ? respond(receipt) : unknown();
      } catch {
        return unknown();
      }
    }
  };
}

interface SchedulerRun {
  run_id: string;
  requested_limit: number;
  started_at: string;
  outcome: "started" | "completed" | "failed";
  finished_at: string | null;
  counts: {
    queued: number;
    blocked: number;
    skipped: number;
    dispatched: false;
  } | null;
  failure_code: "queue_transaction_rolled_back" | null;
}
function readRun(
  value: unknown,
  runId: string,
  limit: number,
): SchedulerRun | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const r = value as Record<string, unknown>;
  const timestamp = (v: unknown): v is string =>
    typeof v === "string" && Number.isFinite(Date.parse(v));
  if (
    r.run_id !== runId || r.requested_limit !== limit ||
    !timestamp(r.started_at)
  ) return null;
  if (r.outcome === "started") {
    if (
      r.finished_at !== null || r.counts !== null || r.failure_code !== null
    ) return null;
  } else {
    if (
      !timestamp(r.finished_at) ||
      Date.parse(r.finished_at) < Date.parse(r.started_at)
    ) return null;
    if (r.outcome === "failed") {
      if (
        r.counts !== null || r.failure_code !== "queue_transaction_rolled_back"
      ) return null;
    } else if (r.outcome === "completed") {
      if (
        !r.counts || typeof r.counts !== "object" || Array.isArray(r.counts) ||
        r.failure_code !== null
      ) return null;
      const c = r.counts as Record<string, unknown>;
      if (
        c.dispatched !== false || [c.queued, c.blocked, c.skipped].some((n) =>
          typeof n !== "number" || !Number.isSafeInteger(n) || n < 0
        ) || Number(c.queued) + Number(c.blocked) + Number(c.skipped) > limit
      ) {
        return null;
      }
      r.counts = {
        queued: c.queued,
        blocked: c.blocked,
        skipped: c.skipped,
        dispatched: false,
      };
    } else return null;
  }
  // Explicit projection prevents unexpected RPC metadata becoming HTTP output.
  return {
    run_id: runId,
    requested_limit: limit,
    started_at: r.started_at,
    outcome: r.outcome,
    finished_at: r.finished_at,
    counts: r.counts,
    failure_code: r.failure_code,
  } as SchedulerRun;
}

async function boundedBody(request: Request): Promise<string | null> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1024) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
