import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decodeExactJson, ExactJsonNumber } from "../../src/hub/features/controlled-drugs/record-review/exact-json.ts";
import * as hashes from "../../src/hub/features/controlled-drugs/record-review/component-hashes.ts";

interface ComponentVector {
  name: string;
  preparation_raw: string;
  event_raw: string;
  target_raw: string;
  obligation_raw: string;
  context_hash: string;
  parent_request_hash: string;
  source_row_hash: string;
  target_hash: string;
  event_hash: string;
  obligation_hash: string;
}
interface Reference { lifecycle_or_auth_authority: boolean; cases: ComponentVector[] }
// Numeric source values remain inside raw strings until the lossless decoder.
// These PostgreSQL formatter fixtures are not valid lifecycle/clinical records.
const reference = JSON.parse(readFileSync(new URL("./record-review-component-vectors.json", import.meta.url), "utf8")) as Reference;
const decode = (raw: string) => decodeExactJson(new TextEncoder().encode(raw));
for (const vector of reference.cases) test(`PostgreSQL component reference: ${vector.name}`, async () => {
  assert.equal(reference.lifecycle_or_auth_authority, false);
  const preparation = decode(vector.preparation_raw);
  assert.deepEqual(await Promise.all([
    hashes.hashReviewPreparationContext(preparation), hashes.hashReviewParentRequest(preparation),
    hashes.hashReviewSourceRow("public.controlled_stock_preparations", preparation), hashes.hashReviewTarget(decode(vector.target_raw)),
    hashes.hashReviewEvent(decode(vector.event_raw)), hashes.hashReviewObligation(decode(vector.obligation_raw)),
  ]), [vector.context_hash, vector.parent_request_hash, vector.source_row_hash, vector.target_hash, vector.event_hash, vector.obligation_hash]);
});

function preparation(context: unknown) {
  return { ...decode(reference.cases[0].preparation_raw) as object, context };
}
async function refuses(context: unknown) {
  await assert.rejects(async () => hashes.hashReviewPreparationContext(preparation(context)));
}
test("component hashing rejects unsupported values and never invokes getters", async () => {
  for (const value of [1, 1n, undefined, () => "value", new Date(), new Map()]) await refuses({ value });
  let invoked = 0;
  const getter = Object.defineProperty({}, "value", { enumerable: true, get() { invoked++; return "unsafe"; } });
  await refuses(getter); assert.equal(invoked, 0);
  const target = { ...decode(reference.cases[0].target_raw) as object };
  Object.defineProperty(target, "event_id", { enumerable: true, get() { invoked++; return "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"; } });
  await assert.rejects(async () => hashes.hashReviewTarget(target)); assert.equal(invoked, 0);
  const fakeNumber = Object.freeze(Object.defineProperty(Object.create(ExactJsonNumber.prototype), "token", {
    enumerable: true, get() { invoked++; return "1"; },
  }));
  await refuses({ value: fakeNumber }); assert.equal(invoked, 0);
  await refuses({ value: "\ud800" }); await refuses({ value: "\0" });
  await refuses({ value: Object.assign([], { extra: true }) }); await refuses({ value: new Array(1) });
  await refuses({ value: { [Symbol("hidden")]: "value" } });
  const cyclic: Record<string, unknown> = {}; cyclic.value = cyclic; await refuses(cyclic);
});
test("component limits apply before exponent expansion and oversized hashing", async () => {
  for (const token of ["1e131072", "1e-16384", "0e-16384", "0e1073741824", "1e999999999999999999999999"])
    await refuses({ value: new ExactJsonNumber(token) });
  await refuses({ value: Array(100001).fill(null) });
  const wide = Object.fromEntries(Array.from({ length: 300 }, (_, index) => [String(index).padStart(3, "0") + "x".repeat(4093), null]));
  await refuses(wide);
  let deep: unknown = null;
  for (let index = 0; index < 66; index++) deep = { value: deep };
  await refuses(deep);
  const text = "a".repeat(1024 * 1024 - 9);
  assert.match(await hashes.hashReviewPreparationContext(preparation({ s: text })), /^[0-9a-f]{64}$/);
  await refuses({ s: text + "a" });
});
test("only explicit component preimages are exported; the whole packet is refused", async () => {
  assert.equal("hashComponent" in hashes, false);
  const whole = Object.fromEntries(["version", "meaning", "meaning_text", "meaning_version", "target", "adapter", "event", "parent_preparation",
    "original_result", "clinical_snapshot", "source_rows", "event_lines", "cells", "transitions", "containers", "obligation", "current_authorization"].map(key => [key, null]));
  await assert.rejects(async () => hashes.hashReviewSourceRow("public.controlled_stock_events", whole));
  await assert.rejects(async () => hashes.hashReviewSourceRow("public.unadmitted_relation", decode(reference.cases[0].event_raw)));
  for (const hash of [hashes.hashReviewTarget, hashes.hashReviewEvent, hashes.hashReviewPreparationContext, hashes.hashReviewParentRequest, hashes.hashReviewObligation])
    await assert.rejects(async () => hash(whole));
});
