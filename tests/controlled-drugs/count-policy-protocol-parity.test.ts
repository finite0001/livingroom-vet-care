import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { digestCountPolicyClosure, digestCountPolicyReceipt, digestCountPolicyRequest, verifyCountPolicyClosure, verifyCountPolicyReceipt } from "../../src/hub/features/controlled-drugs/count/count-policy-wire.ts";
import { parseCountPolicyClosureRequest } from "../../src/hub/features/controlled-drugs/count/count-admin-schema.ts";
import { parseCountOperationClosureRequest } from "../../src/hub/features/controlled-drugs/count/count-operation-closure.ts";

// Expected digests come from an independent Python encoder. These synthetic
// examples establish protocol parity, not real authorization or stock facts.
const fixture = JSON.parse(readFileSync(new URL("./count-policy-protocol-vectors.json", import.meta.url), "utf8"));
assert.equal(fixture.publish_vectors, 4);
assert.equal(fixture.closure_vectors, 12);

for (const [index, vector] of fixture.vectors.entries()) {
  test(`policy request, receipt and all closure states match independent protocol vector ${index + 1}`, async () => {
    assert.equal(await digestCountPolicyRequest(vector.request), vector.request_digest);
    assert.equal(await digestCountPolicyReceipt(vector.receipt), vector.receipt.receipt_digest);
    const receipt = await verifyCountPolicyReceipt(vector.request, vector.receipt);
    assert.equal(receipt.result_ref.version, vector.receipt.result_ref.version);
    assert.equal(typeof receipt.result_ref.version, "string");
    assert.deepEqual(parseCountPolicyClosureRequest(vector.stored_policy_pointer), vector.closure_request);
    assert.equal(parseCountOperationClosureRequest(vector.legacy_schema1_pointer).schema_version, 1);
    assert.throws(() => parseCountPolicyClosureRequest({ ...vector.stored_policy_pointer, schema_version: 1 }));
    assert.throws(() => parseCountOperationClosureRequest({ ...vector.stored_policy_pointer, schema_version: 1 }));
    for (const { reply } of vector.closures) {
      assert.equal(await digestCountPolicyClosure(reply), reply.receipt_digest);
      const result = await verifyCountPolicyClosure(vector.closure_request, reply);
      assert.equal(result.state, reply.state);
      assert.equal(result.receipt?.result_ref.version ?? null, reply.receipt?.result_ref.version ?? null);
    }
  });
}
