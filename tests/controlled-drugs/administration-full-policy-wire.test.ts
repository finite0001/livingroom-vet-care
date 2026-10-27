import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { digestAdministrationRequest, digestAdministrationReceipt } from "../../src/hub/features/controlled-drugs/administration/wire.ts";
const vectors = JSON.parse(readFileSync(new URL("./administration-full-policy-vectors.json", import.meta.url), "utf8"));
test("complete stock and review policies with all 22 colon-bearing source keys match independent frame vectors", async () => {
  assert.equal(vectors.kind, "independent-python-all22-vectors-not-SQL-execution");
  assert.equal(vectors.request_vectors.length, 2);
  for (let index = 0; index < vectors.request_vectors.length; index++) {
    const request = vectors.request_vectors[index], receipt = vectors.receipt_vectors[index];
    const rules = request.action === "stock_policy" ? request.definition.policy.permissions : request.definition.body.rules;
    assert.equal(Object.keys(rules).length, 22); assert.ok(Object.keys(rules).some(key => key.includes(":")));
    assert.equal(await digestAdministrationRequest(request), receipt.request_digest);
    assert.equal(await digestAdministrationReceipt(receipt), receipt.receipt_digest);
    const substituted = structuredClone(request), altered = request.action === "stock_policy" ? substituted.definition.policy.permissions : substituted.definition.body.rules;
    altered["unknown:action"] = altered.receive_inventory; delete altered.receive_inventory;
    await assert.rejects(() => digestAdministrationRequest(substituted));
  }
});
