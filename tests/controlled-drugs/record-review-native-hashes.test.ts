import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decodeExactJson, ExactJsonNumber, type ExactJson } from "../../src/hub/features/controlled-drugs/record-review/exact-json.ts";
import { hashReviewNativeDocument, hashReviewNativeRecord, hashReviewNativeContext, hashReviewNativeRequest, hashReviewNativeArtifact } from "../../src/hub/features/controlled-drugs/record-review/component-hashes.ts";
import { snapshotNativeEvidence } from "../../src/hub/features/controlled-drugs/record-review/native-movement-structure.ts";
interface ObjectValue { [key: string]: ExactJson }
const object = (value: ExactJson) => value as ObjectValue;
const raw = decodeExactJson(readFileSync(new URL("./record-review-native-fixtures/native-detail-00.json", import.meta.url)));
const packet = object(object(object(raw).data).packet), sources = packet.source_rows as ObjectValue[];
const retained = (relation: string) => object(sources.find(s => s.relation === relation)!.row);
const dispense = retained("public.native_dispenses"), document = object(dispense.document), operation = retained("public.native_fulfillment_operations");
test("narrow native hash frames match independent retained context/artifact/request commitments", async () => {
  assert.equal(await hashReviewNativeContext("dispense", document.reviewed_context), document.reviewed_context_hash);
  assert.equal(await hashReviewNativeArtifact(document.artifact), document.artifact_hash);
  assert.equal(await hashReviewNativeRequest("record_native_dispense", operation.actor_id, operation.request), operation.request_hash);
  assert.notEqual(await hashReviewNativeDocument("dispense", document), document.artifact_hash);
  await assert.rejects(hashReviewNativeRequest("record_native_pickup", operation.actor_id, operation.request));
  await assert.rejects(hashReviewNativeDocument("dispense", packet));
  assert.throws(() => hashReviewNativeRecord("dispense" as "correction", document));
});
test("own data admission precedes Zod and no accessor or forged numeric token executes", async () => {
  let invoked = 0;
  const getter = Object.defineProperty({}, "version", { enumerable: true, get() { invoked++; throw new Error("private sentinel"); } });
  assert.throws(() => hashReviewNativeDocument("dispense", getter));
  const forged = Object.create(ExactJsonNumber.prototype);
  Object.defineProperty(forged, "token", { enumerable: true, get() { invoked++; throw new Error("private token"); } }); Object.freeze(forged);
  await assert.rejects(hashReviewNativeDocument("dispense", { ...document, version: forged }));
  assert.equal(invoked, 0);
  const inherited = Object.create({ secret: true }); assert.throws(() => hashReviewNativeDocument("dispense", inherited));
  await assert.rejects(hashReviewNativeContext("dispense", { ...object(document.reviewed_context), extra: true }));
});
test("component resource refusal covers expansion, nesting, symbol/array properties and async mutation", async () => {
  await assert.rejects(hashReviewNativeDocument("dispense", { ...document, version: new ExactJsonNumber("1e1000000") }));
  const array = Object.freeze(Object.assign([], { extra: true })); assert.throws(() => snapshotNativeEvidence(array));
  const symbol = Object.freeze({ [Symbol("hidden")]: true }); assert.throws(() => snapshotNativeEvidence(symbol));
  let nested: unknown = null; for (let i = 0; i < 66; i++) nested = Object.freeze({ nested }); assert.throws(() => snapshotNativeEvidence(nested));
  const numeric = Object.freeze({ value: new ExactJsonNumber("1e10000000") }); assert.throws(() => snapshotNativeEvidence(numeric));
  // Hashing snapshots its own encoded component synchronously. A later caller
  // mutation cannot change the digest whose bytes have already been submitted.
  const mutable = { ...document }, digest = hashReviewNativeDocument("dispense", mutable); mutable.reason = "late caller mutation";
  assert.equal(await digest, await hashReviewNativeDocument("dispense", document));
});

test("every record kind rejects hostile excluded record_hash before any getter and preserves normal preimages", async t => {
  const vectors = [
    ["return_v1", 11, "public.native_return_events"], ["return_v2", 1, "public.native_return_events"],
    ["correction", 8, "public.native_dispense_correction_events"], ["discrepancy", 14, "public.native_return_discrepancy_events"],
    ["return_policy", 13, "public.native_return_events"],
  ] as const;
  for (const [kind, index, relation] of vectors) await t.test(kind, async () => {
    const raw = decodeExactJson(readFileSync(new URL(`./record-review-native-fixtures/native-detail-${String(index).padStart(2, "0")}.json`, import.meta.url)));
    const p = object(object(object(raw).data).packet), event = object(p.event), rows = p.source_rows as ObjectValue[];
    const retained = object(rows.find(row => row.relation === relation && object(row.row).id === event.id)!.row), document = object(retained.document);
    const value = kind === "return_policy" ? object(document.policy) : document;
    assert.equal(await hashReviewNativeRecord(kind, value), value.record_hash);
    let invoked = 0;
    const hostile = Object.freeze(Object.defineProperty({}, "then", { enumerable: true, get() { invoked++; return undefined; } }));
    assert.throws(() => hashReviewNativeRecord(kind, { ...value, record_hash: hostile }));
    const throwing = Object.freeze(Object.defineProperty({}, "then", { enumerable: true, get() { invoked++; throw new Error("private sentinel"); } }));
    assert.throws(() => hashReviewNativeRecord(kind, { ...value, record_hash: throwing }));
    const top = Object.defineProperty({ ...value }, "record_hash", { enumerable: true, get() { invoked++; return value.record_hash; } });
    assert.throws(() => hashReviewNativeRecord(kind, top));
    const absent = Object.assign(Object.create(null), value); delete absent.record_hash;
    assert.throws(() => hashReviewNativeRecord(kind, absent));
    for (const digest of [null, false, new ExactJsonNumber("1"), [], "A".repeat(64), "0".repeat(63)]) assert.throws(() => hashReviewNativeRecord(kind, { ...value, record_hash: digest }));
    assert.equal(invoked, 0);
  });
});
