import { test } from "node:test";
import assert from "node:assert/strict";
import { createEstimateDecisionLimiter } from "../../supabase/functions/_shared/estimate-decision-limiter.ts";

test("pre-database request guard bounds bursts and replenishes only after its window", async () => {
  let clock = 10000;
  const allow = createEstimateDecisionLimiter({ limit: 2, windowMs: 1000, now: () => clock });
  assert.deepEqual(await Promise.all([allow(), allow(), allow(), allow()]), [true, true, false, false]);
  clock = 10999; assert.equal(await allow(), false);
  clock = 11000; assert.equal(await allow(), true);
  assert.equal(await allow(), true); assert.equal(await allow(), false);
});
test("clock reversal and invalid time do not replenish exhausted capacity", async () => {
  let clock = 10000;
  const allow = createEstimateDecisionLimiter({ limit: 1, windowMs: 1000, now: () => clock });
  assert.equal(await allow(), true);
  clock = 1; assert.equal(await allow(), false);
  clock = NaN; assert.equal(await allow(), false);
  clock = 10000; assert.equal(await allow(), false);
  clock = 11000; assert.equal(await allow(), true);
});
