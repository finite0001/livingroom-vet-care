import assert from "node:assert/strict";
import { test } from "node:test";
import {
  convertedStockQuantity,
  packageConversionSchema,
  packageQuantitySchema,
} from "../../src/hub/features/inventory/supplier-imports/quantity-model.ts";
import {
  gtinSchema,
  normalizedGtin,
  supplierIdentitySchema,
  supplierSkuSchema,
} from "../../src/hub/features/inventory/supplier-imports/identifier-model.ts";

const ratio = (numerator: string, denominator = "1") => ({
  stock_units_numerator: numerator,
  purchase_units_denominator: denominator,
});
test("package conversions preserve exact case, vial and fractional quantities", () => {
  assert.equal(convertedStockQuantity("2", ratio("12")), "24.000");
  assert.equal(convertedStockQuantity("1.25", ratio("10")), "12.500");
  assert.equal(convertedStockQuantity("0.001", ratio("1")), "0.001");
  assert.equal(convertedStockQuantity("3", ratio("1", "3")), "1.000");
  assert.equal(convertedStockQuantity("99999999999.999", ratio("1")), "99999999999.999");
});
test("conversion rejects rounding and quantities beyond numeric(14,3)", () => {
  assert.throws(() => convertedStockQuantity("1", ratio("1", "3")), /represented exactly/);
  assert.throws(() => convertedStockQuantity("0.001", ratio("1", "2")), /represented exactly/);
  assert.throws(() => convertedStockQuantity("99999999999.999", ratio("2")), /supported range/);
});
test("quantity and ratio boundaries reject coercion and malformed or excessive terms", () => {
  for (const value of [1, "0", "-1", "01", "1e3", "NaN", "Infinity", "1.0001", "100000000000", " 1", "1."])
    assert.equal(packageQuantitySchema.safeParse(value).success, false);
  for (const value of ["0", "-1", "1.5", "01", "1e3", "1000000000001", "9".repeat(10000), "x"])
    assert.equal(packageConversionSchema.safeParse(ratio(value)).success, false);
  assert.equal(packageConversionSchema.safeParse({ ...ratio("1"), stock_quantity: "1" }).success, false);
});
test("supplier identities retain leading zeros and distinguish namespace and supplier", () => {
  const namespace = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const mwi = supplierIdentitySchema.parse({ supplier: "mwi", namespace_id: namespace, sku: "000012-A" });
  const midwest = supplierIdentitySchema.parse({ ...mwi, supplier: "midwest" });
  assert.equal(mwi.sku, "000012-A");
  assert.notDeepEqual(mwi, midwest);
  assert.equal(supplierSkuSchema.parse("12345678901234567890"), "12345678901234567890");
  for (const value of [123, "", " SKU", "SKU ", "SKU\n", "A\u001dB"])
    assert.equal(supplierSkuSchema.safeParse(value).success, false);
});
test("validated UPC/EAN normalizes without confusing raw supplier SKU", () => {
  assert.equal(normalizedGtin("036000291452"), "00036000291452");
  assert.equal(normalizedGtin("4006381333931"), "04006381333931");
  assert.equal(normalizedGtin("96385074"), "00000096385074");
  for (const value of ["00000000000000", "036000291453", "4006381333932", "123", 36000291452, "03600029145x", " 036000291452"])
    assert.equal(gtinSchema.safeParse(value).success, false);
  assert.equal(supplierSkuSchema.parse("036000291453"), "036000291453");
});
