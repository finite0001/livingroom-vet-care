import { test } from "node:test";
import assert from "node:assert/strict";
import { ExactJsonNumber } from "../../src/hub/features/controlled-drugs/record-review/exact-json.ts";
import { reviewContextQuantity, reviewInstantMicroseconds, reviewQuantityThousandths } from "../../src/hub/features/controlled-drugs/record-review/exact-values.ts";

const quantity = (token: string) => reviewQuantityThousandths(new ExactJsonNumber(token));
test("source quantities retain exact thousandths across scale, exponents and cancellation", () => {
  for (const token of ["1.234", "1234e-3", "0.001234e3", "1.234000", "1234000e-6"]) assert.equal(quantity(token), 1234n);
  assert.equal(quantity("99999999999.999"), 99999999999999n);
  assert.equal(quantity("-99999999999.999"), -99999999999999n);
  assert.equal(quantity("-0.00000"), 0n);
  assert.equal(quantity("1e-3"), 1n);
  const total = Array.from({ length: 200 }, () => quantity("99999999999.999")).reduce((sum, value) => sum + value, 0n);
  assert.equal(total, 19999999999999800n); // Above Number.MAX_SAFE_INTEGER.
  assert.equal(total + 200n * quantity("-99999999999.999"), 0n);
});
test("source quantities refuse rounding, overflow and invalid numeric expansion", () => {
  for (const token of ["0.0001", "-0.0001", "99999999999.9991", "100000000000", "1e100000000", "1e-16384", "0e-16384", "0e1073741824"])
    assert.throws(() => quantity(token));
  assert.throws(() => reviewQuantityThousandths(1 as unknown as ExactJsonNumber));
});
test("context decimal grammar stays separate from general numeric JSON", () => {
  assert.equal(reviewContextQuantity("-123.001"), -123001n);
  assert.equal(reviewContextQuantity("0.000", true), 0n);
  for (const token of ["0", "-0", "0.000", "01", "+1", "1e0", "1.0000", ".1", "1.", "100000000000", " 1"])
    assert.throws(() => reviewContextQuantity(token));
});
test("instants preserve the microsecond boundary and equivalent explicit offsets", () => {
  const utc = reviewInstantMicroseconds("2026-10-24T10:00:00.123456Z");
  assert.equal(utc, reviewInstantMicroseconds("2026-10-24T03:00:00.123456-07:00"));
  assert.equal(utc, reviewInstantMicroseconds("2026-10-24T15:30:00.123456+05:30"));
  assert.equal(reviewInstantMicroseconds("2026-10-24T10:00:00.123457Z") - utc, 1n);
  assert.equal(reviewInstantMicroseconds("2026-10-24T10:15:00.123456Z") - utc, 900000000n);
  assert.equal(reviewInstantMicroseconds("1970-01-01T00:00:00Z"), 0n);
  assert.equal(reviewInstantMicroseconds("1969-12-31T23:59:59.999999Z"), -1n);
  assert.equal(reviewInstantMicroseconds("0001-01-01T00:00:00Z"), -62135596800000000n);
  assert.equal(reviewInstantMicroseconds("2000-03-01T00:00:00Z") - reviewInstantMicroseconds("2000-02-28T00:00:00Z"), 172800000000n);
});
test("instants reject calendar normalization, lost precision and implicit timezones", () => {
  for (const value of ["2026-02-29T00:00:00Z", "1900-02-29T00:00:00Z", "2026-04-31T00:00:00Z", "0000-01-01T00:00:00Z",
    "2026-10-24T24:00:00Z", "2026-10-24T00:60:00Z", "2026-10-24T00:00:60Z", "2026-10-24T00:00:00.1234567Z",
    "2026-10-24T00:00:00", "2026-10-24T00:00:00+16:00", "2026-10-24T00:00:00+01:60", "infinity"])
    assert.throws(() => reviewInstantMicroseconds(value));
});
