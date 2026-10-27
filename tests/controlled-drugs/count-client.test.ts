import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { CountClientError, createCountClient } from "../../src/hub/features/controlled-drugs/count/count-client.ts";
import { readCountResponseBytes } from "../../src/hub/features/controlled-drugs/count/count-response.ts";
import { digestCountReceipt } from "../../src/hub/features/controlled-drugs/count/count-wire.ts";
const vectors = JSON.parse(readFileSync(new URL("./count-wire-fixtures/v2-independent-vectors.json", import.meta.url), "utf8"));
const request = vectors.request;
const config = { projectRef: "a".repeat(20), url: `https://${"a".repeat(20)}.supabase.co`, publishableKey: "sb_publishable_test" };
const identity = { actorId: request.request.actor_id, sessionId: "00000000-0000-4000-8000-000000000099", generation: 1 };
const receiptBase = { ...vectors.public_receipts.find((value: { action: string }) => value.action === "cancel"),
  actor_id: request.request.actor_id, operation_id: request.request.operation_id, count_id: request.request.count_id, request_digest: vectors.request_digest,
  result_ref: { ...vectors.public_receipts.find((value: { action: string }) => value.action === "cancel").result_ref, id: request.request.cancellation_id } };
const receipt = { ...receiptBase, receipt_digest: await digestCountReceipt(receiptBase) };
const jsonResponse = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
test("the count client makes one authenticated raw POST and binds its receipt to the independent request vector", async () => {
  let calls = 0;
  const client = createCountClient(config, { current: async () => ({ ...identity, accessToken: "test.token.value" }), isCurrent: () => true }, async (url, options) => {
    calls++; assert.equal(url, `${config.url}/rest/v1/rpc/cancel_controlled_count_v1`);
    assert.deepEqual(JSON.parse(options!.body as string), { p_request: request.request });
    assert.equal(options!.redirect, "error"); assert.equal(options!.cache, "no-store");
    assert.equal((options!.headers as Record<string, string>).Authorization, "Bearer test.token.value");
    return jsonResponse(receipt);
  });
  assert.equal((await client.mutate("cancel", request.request, identity)).data.receipt.receipt_digest, receipt.receipt_digest);
  assert.equal(calls, 1);
});
test("a lost response, invalid response or changed login never retries a mutation or accepts a stale result", async () => {
  for (const mode of ["network", "status", "digest", "identity"] as const) {
    let calls = 0, current = true;
    const client = createCountClient(config, { current: async () => ({ ...identity, accessToken: "test.token.value" }), isCurrent: () => current }, async () => {
      calls++;
      if (mode === "network") throw new Error("private server details");
      if (mode === "identity") current = false;
      return jsonResponse(mode === "digest" ? { ...receipt, receipt_digest: "0".repeat(64) } : receipt, mode === "status" ? 500 : 200);
    });
    await assert.rejects(() => client.mutate("cancel", request.request, identity), error => error instanceof CountClientError && !error.message.includes("private"));
    assert.equal(calls, 1);
  }
});
test("response streaming enforces its real byte bound and cancels unsuccessful/non-JSON/aborted bodies", async () => {
  await assert.rejects(() => readCountResponseBytes(jsonResponse("too large"), 2, new AbortController().signal));
  await assert.rejects(() => readCountResponseBytes(new Response("{}", { headers: { "content-type": "text/html" } }), 99, new AbortController().signal));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(() => readCountResponseBytes(jsonResponse({}), 99, controller.signal));
  assert.equal(new TextDecoder().decode(await readCountResponseBytes(jsonResponse({}), 99, new AbortController().signal)), "{}");
});
