import { z } from "zod";

// Engineering ceilings, not clinical intervals or practice task defaults.
export const reconciliationLimits = {
  defaultBatch: 5,
  maxBatch: 25,
  maxFanOut: 256,
  maxBudgetMs: 5000,
  maxBodyBytes: 1024,
} as const;
const uuid = z.string().uuid().transform((value) => value.toLowerCase());
const count = z.number().int().nonnegative().safe();
const instant = z.string().datetime({ offset: true }).refine((value) => Number.isFinite(Date.parse(value)));

function micros(value: string): bigint {
  const fraction = value.match(/\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/i)?.[1] ?? "";
  return BigInt(Date.parse(value)) * 1000n + BigInt(fraction.padEnd(6, "0").slice(3, 6));
}

export const reconciliationRequestSchema = z.object({
  run_id: uuid.optional(),
  limit: z.number().int().min(1).max(reconciliationLimits.maxBatch).default(reconciliationLimits.defaultBatch),
}).strict();
export interface ReconciliationRequest extends z.infer<typeof reconciliationRequestSchema> {}

const position = z.object({
  lane: z.enum(["appointment", "use"]),
  after_id: uuid.nullable(),
}).strict();
const checkpoint = z.object({
  version: count,
  lane: z.enum(["appointment", "use", "complete"]),
  after_id: uuid.nullable(),
}).strict().refine((value) => value.lane !== "complete" || value.after_id === null, "A complete sweep has no next source");
const counts = z.object({
  examined: count,
  generated: count,
  revised: count,
  unresolved: count,
}).strict();

export const reconciliationRunSchema = z.object({
  run_id: uuid,
  requested_limit: z.number().int().min(1).max(reconciliationLimits.maxBatch),
  policy_version: z.number().int().positive().safe(),
  window_from: instant,
  window_until: instant,
  fan_out_limit: z.number().int().min(1).max(reconciliationLimits.maxFanOut),
  budget_ms: z.number().int().min(100).max(reconciliationLimits.maxBudgetMs),
  sweep_id: uuid,
  sweep_started_at: instant,
  checkpoint_version: count,
  before: position,
  started_at: instant,
  outcome: z.enum(["started", "completed", "failed", "paused"]),
  finished_at: instant.nullable(),
  counts: counts.nullable(),
  checkpoint: checkpoint.nullable(),
  sweep_complete: z.boolean().nullable(),
  failure_code: z.enum(["batch_transaction_rolled_back", "fan_out_limit", "deadline", "lock_timeout", "policy_changed"]).nullable(),
}).strict().superRefine((run, context) => {
  // Zod can continue refinements after a string format error. Do not convert
  // an invalid Date.parse result to BigInt while reporting that validation error.
  if ([run.window_from, run.window_until, run.sweep_started_at, run.started_at, run.finished_at]
    .some((value) => value !== null && !Number.isFinite(Date.parse(value)))) return;
  const invalid = (message: string) => context.addIssue({ code: z.ZodIssueCode.custom, message });
  if (micros(run.window_until) <= micros(run.window_from) || micros(run.window_until) - micros(run.window_from) > 31n * 86400000000n)
    invalid("A reviewed appointment window of at most 31 days is required");
  if (micros(run.started_at) < micros(run.sweep_started_at) || (run.finished_at && micros(run.finished_at) < micros(run.started_at)))
    invalid("Run timestamps contradict their sweep");
  if (run.outcome === "started") {
    if (run.finished_at !== null || run.counts !== null || run.checkpoint !== null || run.sweep_complete !== null || run.failure_code !== null)
      invalid("Uncommitted work has no result or counts");
    return;
  }
  if (!run.finished_at) invalid("A terminal run needs a finished timestamp");
  if (run.outcome !== "completed") {
    if (run.counts !== null || run.checkpoint !== null || run.sweep_complete !== null || run.failure_code === null || (run.outcome === "paused") !== (run.failure_code === "policy_changed"))
      invalid("Stopped work cannot claim committed counts or checkpoint advancement");
    return;
  }
  if (!run.counts || !run.checkpoint || run.sweep_complete === null || run.failure_code !== null) {
    invalid("A completed batch requires committed result and checkpoint evidence");
    return;
  }
  if (run.counts.examined > run.requested_limit || run.counts.unresolved > run.counts.examined || run.counts.generated + run.counts.revised > run.counts.examined * run.fan_out_limit)
    invalid("Counts exceed the captured source or fan-out bounds");
  if (run.checkpoint.version !== run.checkpoint_version + 1 || run.sweep_complete !== (run.checkpoint.lane === "complete"))
    invalid("Completion must advance exactly one durable checkpoint");
  if (run.before.lane === "use" && run.checkpoint.lane === "appointment")
    invalid("A batch cannot move backwards between source lanes");
  if (run.before.lane === run.checkpoint.lane && run.before.after_id && (!run.checkpoint.after_id || run.checkpoint.after_id <= run.before.after_id))
    invalid("A continuation must advance past its previous source");
  if (run.counts.examined > 0 && run.before.lane === run.checkpoint.lane && !run.checkpoint.after_id)
    invalid("Examined work in the same lane needs a saved source continuation");
  if (run.counts.examined === 0 && !run.sweep_complete)
    invalid("An empty batch cannot claim unfinished progress");
});
export interface ReconciliationRun extends z.infer<typeof reconciliationRunSchema> {}

export function readReconciliationRun(value: unknown, runId: string, limit: number): ReconciliationRun | null {
  const parsed = reconciliationRunSchema.safeParse(value);
  return parsed.success && parsed.data.run_id === runId.toLowerCase() && parsed.data.requested_limit === limit ? parsed.data : null;
}

export function sameReconciliationRequest(first: ReconciliationRun, result: ReconciliationRun): boolean {
  return first.run_id === result.run_id && first.requested_limit === result.requested_limit &&
    first.policy_version === result.policy_version && first.fan_out_limit === result.fan_out_limit &&
    first.budget_ms === result.budget_ms && first.sweep_id === result.sweep_id &&
    first.checkpoint_version === result.checkpoint_version && first.before.lane === result.before.lane &&
    first.before.after_id === result.before.after_id &&
    micros(first.window_from) === micros(result.window_from) && micros(first.window_until) === micros(result.window_until) &&
    micros(first.sweep_started_at) === micros(result.sweep_started_at) && micros(first.started_at) === micros(result.started_at);
}
