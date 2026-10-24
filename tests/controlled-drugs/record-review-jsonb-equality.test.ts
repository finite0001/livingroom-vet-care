import { test } from "node:test";
import assert from "node:assert/strict";
import { ExactJsonNumber } from "../../src/hub/features/controlled-drugs/record-review/exact-json.ts";
import { sameReviewJsonb } from "../../src/hub/features/controlled-drugs/record-review/jsonb-equality.ts";
const number = (token: string) => new ExactJsonNumber(token);
test("JSONB equality compares exact numeric value without overwriting scale or expanding exponents", () => {
  const left = number("1.0"), right = number("1.000");
  assert.equal(sameReviewJsonb(left, right), true);
  assert.equal(left.token, "1.0"); assert.equal(right.token, "1.000");
  assert.equal(sameReviewJsonb(number("123000e-3"), number("1.23e2")), true);
  assert.equal(sameReviewJsonb(number("-0.000"), number("0e10000")), true);
  assert.equal(sameReviewJsonb(number("9007199254740992"), number("9007199254740993")), false);
  assert.equal(sameReviewJsonb(number("1e131071"), number("10e131070")), true);
  assert.throws(() => sameReviewJsonb(number("1e-16383"), number("10e-16384"))); // Second token exceeds PostgreSQL dscale.
});
test("JSONB semantic comparison preserves strings, member keys and array order", () => {
  assert.equal(sameReviewJsonb({ a: number("1.0"), b: [number("2e0"), "1.0"] }, { b: [number("2.000"), "1.0"], a: number("1.000") }), true);
  assert.equal(sameReviewJsonb("1.0", "1.000"), false);
  assert.equal(sameReviewJsonb("1.0", number("1.0")), false);
  assert.equal(sameReviewJsonb(["a", "b"], ["b", "a"]), false);
  assert.equal(sameReviewJsonb({ a: null }, { b: null }), false);
});
test("numeric equality refuses values outside PostgreSQL's storage domain", () => {
  for (const token of ["1e131072", "0e-16384", "0e1073741824"])
    assert.throws(() => sameReviewJsonb(number(token), number(token)));
});
