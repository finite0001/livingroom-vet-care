import test from "node:test";
import assert from "node:assert/strict";
import { dollarsToCents, money } from "../../src/hub/features/billing/money.ts";
test("accounting credit parses exact cents without floating-point rounding", () => {
  assert.equal(dollarsToCents("0.29"), 29);
  assert.equal(dollarsToCents("12.3"), 1230);
  assert.equal(money(1230), "$12.30");
  for (const invalid of [
    "0",
    "-1",
    "1.001",
    "1e3",
    "1,000",
    "Infinity",
    "9007199254740992",
  ])
    assert.throws(() => dollarsToCents(invalid));
});
