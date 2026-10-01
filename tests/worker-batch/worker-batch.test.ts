import { test } from "node:test";
import assert from "node:assert/strict";
import { runWorkerBatch, WORKER_BATCH_BUDGET_MS, WORKER_BATCH_MAX_ITEMS } from "../../supabase/functions/_shared/worker-batch.ts";

const queue = (items: number) => {
  let left = items, calls = 0;
  return { step: async () => { calls++; return left-- > 0 ? "item" : "empty"; }, calls: () => calls };
};
const classify = (value: string) => value === "empty" ? "empty" as const : value === "halt" ? "halt" as const : "continue" as const;

test("drains the queue and reports the empty stop without counting the empty claim", async () => {
  const q = queue(3);
  const result = await runWorkerBatch(q.step, classify);
  assert.deepEqual(result.results, ["item", "item", "item"]);
  assert.equal(result.stopped, "empty");
  assert.equal(q.calls(), 4);
});
test("stops at the item cap without claiming more", async () => {
  const q = queue(1000);
  const result = await runWorkerBatch(q.step, classify);
  assert.equal(result.results.length, WORKER_BATCH_MAX_ITEMS);
  assert.equal(result.stopped, "item_cap");
  assert.equal(q.calls(), WORKER_BATCH_MAX_ITEMS);
  assert.ok(WORKER_BATCH_BUDGET_MS < 30_000, "worker budget stays below the scheduler's pg_net timeout");
});
test("checks the time budget before each claim, never mid-item, and always makes the first claim", async () => {
  let clock = 0;
  const q = queue(10);
  const step = async () => { clock += 8_000; return q.step(); };
  const result = await runWorkerBatch(step, classify, { now: () => clock, budgetMs: 20_000 });
  assert.equal(result.results.length, 3);
  assert.equal(result.stopped, "time_budget");
  assert.equal(result.elapsed_ms, 24_000);
  const spent = await runWorkerBatch(queue(10).step, classify, { now: () => clock, budgetMs: 0 });
  assert.equal(spent.results.length, 1, "a spent budget still processes one item, like the single-item worker");
});
test("a halting result is kept and stops the batch", async () => {
  const values = ["item", "halt", "item"];
  const result = await runWorkerBatch(async () => values.shift() ?? "empty", classify);
  assert.deepEqual(result.results, ["item", "halt"]);
  assert.equal(result.stopped, "halted");
});
test("errors propagate and invalid bounds are refused", async () => {
  await assert.rejects(runWorkerBatch(async () => { throw new Error("persistence"); }, classify), /persistence/);
  await assert.rejects(runWorkerBatch(queue(1).step, classify, { maxItems: 0 }));
  await assert.rejects(runWorkerBatch(queue(1).step, classify, { maxItems: 101 }));
});
