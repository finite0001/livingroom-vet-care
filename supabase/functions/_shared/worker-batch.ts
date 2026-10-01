/**
 * Bounded batch loop for scheduler-invoked workers.
 *
 * The scheduler (supabase/migrations/20260922120000_b1_scheduler.sql) invokes
 * each queue worker at most once a minute. A worker that handles one item per
 * call therefore caps throughput at 60 items an hour, below what reminders can
 * enqueue. Each call now claims repeatedly until the queue is empty, an item cap
 * is reached, the elapsed-time budget is spent, or a step reports a condition
 * that should stop the batch (a transient failure, a provider outage, a
 * misconfiguration). Stopping on the first failure keeps a misconfigured
 * installation at the old one-item-a-minute failure rate instead of burning
 * through the whole queue.
 *
 * The budget is checked before each claim, never mid-item: an item that has
 * been claimed always runs to completion under its own lease. The default
 * budget (20 s) stays below the scheduler's pg_net timeout (30 s, migration
 * 20260930130000) so a typical batch answers before the caller gives up.
 */
export const WORKER_BATCH_MAX_ITEMS = 25;
export const WORKER_BATCH_BUDGET_MS = 20_000;

export interface WorkerBatchOptions {
  maxItems?: number;
  budgetMs?: number;
  now?: () => number;
}

/** "empty": nothing was claimed. "continue": an item was handled; claim another. "halt": an item was handled; stop now. */
export type WorkerBatchDisposition = "empty" | "continue" | "halt";
export type WorkerBatchStop = "empty" | "item_cap" | "time_budget" | "halted";

export interface WorkerBatchResult<T> {
  /** Results of every step that handled an item, in order. The final empty step is not included. */
  results: T[];
  stopped: WorkerBatchStop;
  elapsed_ms: number;
}

export async function runWorkerBatch<T>(
  step: () => Promise<T>,
  classify: (result: T) => WorkerBatchDisposition,
  options: WorkerBatchOptions = {},
): Promise<WorkerBatchResult<T>> {
  const maxItems = options.maxItems ?? WORKER_BATCH_MAX_ITEMS;
  const budgetMs = options.budgetMs ?? WORKER_BATCH_BUDGET_MS;
  const now = options.now ?? Date.now;
  if (!Number.isInteger(maxItems) || maxItems < 1 || maxItems > 100) {
    throw new Error("Worker batch item cap must be 1 to 100");
  }
  if (!Number.isFinite(budgetMs) || budgetMs < 0) {
    throw new Error("Worker batch budget must be non-negative");
  }
  const started = now();
  const results: T[] = [];
  let stopped: WorkerBatchStop = "item_cap";
  // The first claim always runs, even with a spent budget, so one call can never
  // do less than the single-item worker it replaces.
  for (let index = 0; index < maxItems; index++) {
    if (index > 0 && now() - started >= budgetMs) {
      stopped = "time_budget";
      break;
    }
    const result = await step();
    const disposition = classify(result);
    if (disposition === "empty") {
      stopped = "empty";
      break;
    }
    results.push(result);
    if (disposition === "halt") {
      stopped = "halted";
      break;
    }
  }
  return { results, stopped, elapsed_ms: Math.max(0, now() - started) };
}

/** Counts results by a string key, for compact response summaries. */
export function countBy<T>(results: T[], key: (result: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const result of results) {
    const name = key(result);
    counts[name] = (counts[name] ?? 0) + 1;
  }
  return counts;
}
