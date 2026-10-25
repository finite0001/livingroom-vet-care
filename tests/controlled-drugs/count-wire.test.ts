import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { decodeCountReply, decodeCountRequest, parseCountPublicReceipt, parseCountReply, parseCountRequest, type CountAction, type CountMutationAction } from "../../src/hub/features/controlled-drugs/count/count-request-schema.ts";
import { countReceiptBytes, countRequestBytes, digestCountReceipt, digestCountRequest, verifyCountNotFound, verifyCountNotReady, verifyCountSavedReply } from "../../src/hub/features/controlled-drugs/count/count-wire.ts";
const vectors = JSON.parse(readFileSync(new URL("./count-wire-fixtures/v2-independent-vectors.json", import.meta.url), "utf8"));
const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const base = { schema_version: 1, actor_id: uuid(1), count_id: uuid(2) };
const op = { ...base, operation_id: uuid(3) };
function request(action: CountAction): Record<string, unknown> {
  switch (action) {
    case "start": return { ...op, actor_b_id: uuid(4), product_id: uuid(5), site_id: uuid(6) };
    case "statement": return { ...op, snapshot_id: uuid(7), statement_id: uuid(8), observed_at: "2026-10-25T00:00:00.123456Z", method: "manual_count", quantities: [{ cell_id: uuid(9), quantity: "0.000" }], container_checks: [{ container_id: uuid(10), presence: "present" }], findings: [{ location_id: uuid(11), description: "é🙂\n" }] };
    case "finalize": return { ...op, outcome_id: uuid(12) };
    case "cancel": return { ...op, cancellation_id: uuid(13), reason: "Synthetic unit data only" };
    case "recover": return { ...op };
    case "read": return { ...base };
  }
}
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
async function reply(action: CountMutationAction, input = request(action)) {
  const resultId = action === "start" ? input.count_id : input[`${action === "finalize" ? "outcome" : action === "cancel" ? "cancellation" : "statement"}_id`];
  const kind = { start: "cycle", statement: "statement", finalize: "outcome", cancel: "cancellation" }[action];
  const receipt = { schema_version: 1, action, operation_id: input.operation_id, actor_id: input.actor_id, count_id: input.count_id,
    request_digest: await digestCountRequest(action, input), result_ref: { kind, id: resultId, opaque_commitment: "a".repeat(64) }, receipt_digest: "0".repeat(64) };
  receipt.receipt_digest = await digestCountReceipt(receipt);
  return { schema_version: 1, state: "saved", data: { receipt } };
}
for (const action of ["start", "statement", "finalize", "cancel", "recover", "read"] as const) {
  test(`${action}: closed snapshot with no caller mutation or missing/extra keys`, () => {
    const input = request(action), result = parseCountRequest(action, input);
    assert.deepEqual(JSON.parse(JSON.stringify(result)), input); assert.ok(Object.isFrozen(result));
    assert.throws(() => parseCountRequest(action, { ...input, private_expected: "7.000" }));
    for (const key of Object.keys(input)) { const bad = { ...input }; delete bad[key]; assert.throws(() => parseCountRequest(action, bad)); }
    assert.throws(() => parseCountRequest(action, { ...input, actor_id: String(input.actor_id).toUpperCase().replace("4000", "A000") }));
    assert.throws(() => parseCountRequest(action, { ...input, count_id: "00000000-0000-0000-0000-000000000000" }));
    input.actor_id = uuid(99); assert.equal(result.actor_id, uuid(1));
  });
  test(`${action}: accessors and hostile non-JSON fields refuse without reading getter`, () => {
    let calls = 0; const input = request(action);
    Object.defineProperty(input, "actor_id", { enumerable: true, get() { calls++; return uuid(1); } });
    assert.throws(() => parseCountRequest(action, input)); assert.equal(calls, 0);
    assert.throws(() => parseCountRequest(action, Object.assign(Object.create({ extra: true }), request(action))));
    assert.throws(() => parseCountRequest(action, { ...request(action), [Symbol("hidden")]: 1 }));
    const hidden = request(action); Object.defineProperty(hidden, "hidden", { value: 1 }); assert.throws(() => parseCountRequest(action, hidden));
  });
  test(`${action}: duplicate-aware bytes and parsed PG version constant`, () => {
    const raw = JSON.stringify(request(action));
    for (const token of ["1", "1e0", "1e+0", "1e-0", "0.1e1"]) assert.equal(decodeCountRequest(action, new TextEncoder().encode(raw.replace('"schema_version":1', `"schema_version":${token}`))).schema_version, 1);
    for (const token of ["1.0", "1.00", "10e-1", "0", "2", "-1", "1e9999999", "true", '"1"']) assert.throws(() => decodeCountRequest(action, new TextEncoder().encode(raw.replace('"schema_version":1', `"schema_version":${token}`))));
    assert.throws(() => decodeCountRequest(action, new TextEncoder().encode(raw.replace('"schema_version":1', '"schema_version":1,"schema_version":1'))));
    assert.throws(() => decodeCountRequest(action, new Uint8Array([0xff])));
    assert.throws(() => decodeCountRequest(action, new TextEncoder().encode(`\ufeff${raw}`)));
  });
}
test("shape ceilings precede traversal; sparse/accessor/extra/cyclic arrays refuse", () => {
  let calls = 0;
  const oversized = new Array(513); Object.defineProperty(oversized, "0", { get() { calls++; return {}; }, enumerable: true });
  assert.throws(() => parseCountRequest("statement", { ...request("statement"), quantities: oversized })); assert.equal(calls, 0);
  for (const quantities of [new Array(1), Object.assign([], { extra: 1 }), [null], [request("statement")]]) assert.throws(() => parseCountRequest("statement", { ...request("statement"), quantities }));
  const nested = { cell_id: uuid(1), quantity: "1.000" }; Object.defineProperty(nested, "quantity", { get() { calls++; return "1.000"; }, enumerable: true });
  assert.throws(() => parseCountRequest("statement", { ...request("statement"), quantities: [nested] })); assert.equal(calls, 0);
  assert.throws(() => decodeCountRequest("read", new Uint8Array(262145)));
});
test("512 complete sorted units/checks and32 findings are admitted; overflow/duplicates/order refuse", () => {
  const quantities = Array.from({ length: 512 }, (_, i) => ({ cell_id: uuid(i + 1), quantity: "99999999999.999" }));
  const checks = Array.from({ length: 512 }, (_, i) => ({ container_id: uuid(i + 1), presence: "missing" }));
  const findings = Array.from({ length: 32 }, () => ({ location_id: uuid(1), description: "x".repeat(512) }));
  const input = { ...request("statement"), quantities, container_checks: checks, findings };
  assert.equal(parseCountRequest("statement", input).quantities.length, 512);
  assert.equal(decodeCountRequest("statement", bytes(input)).container_checks.length, 512);
  for (const bad of [{ ...input, quantities: [...quantities, quantities[0]] }, { ...input, container_checks: [...checks, checks[0]] }, { ...input, findings: [...findings, findings[0]] }, { ...input, quantities: [quantities[0], quantities[0]] }, { ...input, container_checks: [...checks].reverse() }]) assert.throws(() => parseCountRequest("statement", bad));
});
test("exact quantities reject all decimal aliases; zero rows stay explicit", () => {
  for (const quantity of ["0.000", "1.000", "99999999999.999"]) assert.equal(parseCountRequest("statement", { ...request("statement"), quantities: [{ cell_id: uuid(1), quantity }] }).quantities[0].quantity, quantity);
  for (const quantity of [0, "1", "1.0", "01.000", "-0.000", "+1.000", "1e0", "100000000000.000", " 1.000", "1.000\n"]) assert.throws(() => parseCountRequest("statement", { ...request("statement"), quantities: [{ cell_id: uuid(1), quantity }] }));
});
test("literal27 blank scalars, UTF8 byte caps, no trimming/Unicode normalization or surrogate replacement", () => {
  for (const hex of vectors.blank_codepoints) { const blank = String.fromCodePoint(parseInt(hex.slice(2), 16)); assert.throws(() => parseCountRequest("cancel", { ...request("cancel"), reason: blank })); }
  for (const reason of ["\u200c", "\u2060", " e\u0301 ", "é🙂\n", "a".repeat(1024)]) assert.equal(parseCountRequest("cancel", { ...request("cancel"), reason }).reason, reason);
  for (const reason of ["a\0", "\ud800", "\udc00", "🙂".repeat(257), "a".repeat(1025)]) assert.throws(() => parseCountRequest("cancel", { ...request("cancel"), reason }));
  assert.throws(() => parseCountRequest("statement", { ...request("statement"), findings: [{ location_id: uuid(1), description: "é".repeat(257) }] }));
});
test("Gregorian UTC retains every microsecond and rejects Date aliases", () => {
  for (const observed_at of ["0001-01-01T00:00:00.000001Z", "2000-02-29T23:59:59.123456Z", "9999-12-31T23:59:59.999999Z"]) assert.equal(parseCountRequest("statement", { ...request("statement"), observed_at }).observed_at, observed_at);
  for (const observed_at of ["0000-01-01T00:00:00.000000Z", "1900-02-29T00:00:00.000000Z", "2000-02-30T00:00:00.000000Z", "2026-10-25T24:00:00.000000Z", "2026-10-25T00:00:60.000000Z", "2026-10-25T00:00:00.123Z", "2026-10-25T00:00:00.123456+00:00"]) assert.throws(() => parseCountRequest("statement", { ...request("statement"), observed_at }));
});
test("independent V2 request and4 receipt frames/digests match byte for byte", async () => {
  assert.equal(Buffer.from(countRequestBytes("cancel", vectors.request.request)).toString("hex"), `${Buffer.from("lrv-controlled-count-request-v1\0").toString("hex")}${vectors.request_frame_hex}`);
  assert.equal(await digestCountRequest("cancel", vectors.request.request), vectors.request_digest);
  for (const receipt of vectors.public_receipts) assert.equal(await digestCountReceipt(receipt), receipt.receipt_digest);
  assert.notEqual(await digestCountRequest("cancel", { ...vectors.request.request, reason: "e\u0301🙂\n" }), vectors.request_digest);
});
for (const action of ["start", "statement", "finalize", "cancel"] as const) {
  test(`${action}: typed saved receipt binds retained request/result identity/digests`, async () => {
    const input = request(action), value = await reply(action, input);
    const admitted = await verifyCountSavedReply(action, input, value); assert.ok(Object.isFrozen(admitted.data.receipt.result_ref));
    assert.deepEqual(decodeCountReply(bytes(value)), parseCountReply(value));
    for (const key of ["operation_id", "actor_id", "count_id"]) { const bad = structuredClone(value); bad.data.receipt[key] = uuid(99); bad.data.receipt.receipt_digest = await digestCountReceipt(bad.data.receipt); await assert.rejects(verifyCountSavedReply(action, input, bad)); }
    const wrongId = structuredClone(value); wrongId.data.receipt.result_ref.id = uuid(99); wrongId.data.receipt.receipt_digest = await digestCountReceipt(wrongId.data.receipt); await assert.rejects(verifyCountSavedReply(action, input, wrongId));
    const wrongDigest = structuredClone(value); wrongDigest.data.receipt.request_digest = "b".repeat(64); wrongDigest.data.receipt.receipt_digest = await digestCountReceipt(wrongDigest.data.receipt); await assert.rejects(verifyCountSavedReply(action, input, wrongDigest));
    const wrongKind = structuredClone(value); wrongKind.data.receipt.result_ref.kind = "wrong"; assert.throws(() => parseCountReply(wrongKind));
    const unknown = structuredClone(value); Object.assign(unknown.data.receipt, { expected: "7.000" }); assert.throws(() => parseCountReply(unknown));
    const session = structuredClone(value); Object.assign(session.data.receipt, { session_id: uuid(50) }); assert.throws(() => parseCountReply(session));
  });
}
test("excluded receipt_digest accessors/objects reject without invoking nested getters", async () => {
  const value = await reply("start"); let calls = 0;
  const hostile = { get then() { calls++; return undefined; } };
  assert.throws(() => countReceiptBytes({ ...value.data.receipt, receipt_digest: hostile })); assert.equal(calls, 0);
  const receipt = { ...value.data.receipt }; Object.defineProperty(receipt, "receipt_digest", { enumerable: true, get() { calls++; return "0".repeat(64); } });
  assert.throws(() => parseCountPublicReceipt(receipt)); assert.equal(calls, 0);
});
test("snapshot before async hashing prevents caller mutation/reentry from rebinding a receipt", async () => {
  const input = request("cancel"), value = await reply("cancel", input);
  const pending = verifyCountSavedReply("cancel", input, value); input.reason = "changed"; value.data.receipt.result_ref.id = uuid(99);
  const result = await pending; assert.equal(result.data.receipt.result_ref.id, uuid(13));
});
test("explicit recover/read and not_ready remain nonwriting, closed and separately bound", () => {
  const recover = request("recover"), absent = { schema_version: 1, state: "not_found", data: { operation_id: op.operation_id, count_id: op.count_id } };
  assert.equal(verifyCountNotFound(recover, absent).state, "not_found");
  assert.throws(() => verifyCountNotFound({ ...recover, operation_id: uuid(99) }, absent));
  assert.throws(() => verifyCountNotFound(recover, { ...absent, expected: "7.000" }));
  assert.equal(verifyCountNotReady(request("finalize"), { schema_version: 1, state: "not_ready", data: { count_id: op.count_id } }).state, "not_ready");
  assert.throws(() => verifyCountNotReady(request("finalize"), { schema_version: 1, state: "not_ready", data: { count_id: op.count_id, receipt: {} } }));
  assert.throws(() => parseCountRequest("read", { ...request("read"), operation_id: uuid(3) }));
});
const validationVectors = JSON.parse(readFileSync(new URL("./count-wire-fixtures/validation-vectors.json", import.meta.url), "utf8"));
for (const vector of validationVectors.cases) {
  test(`source-unit parity vector: ${vector.name}`, () => {
    const decode = () => decodeCountRequest(vector.action, new TextEncoder().encode(vector.raw));
    if (vector.accepted) assert.ok(decode()); else assert.throws(decode);
  });
}
test("action remains a primitive fixed endpoint selector, not a coercible callback", () => {
  let calls = 0;
  const action = { toString() { calls++; return "read"; } };
  assert.throws(() => parseCountRequest(action as unknown as CountAction, request("read"))); assert.equal(calls, 0);
});
for (const action of ["start", "statement", "finalize", "cancel"] as const) {
  test(`${action}: each valid changed field invalidates the original saved commitment`, async () => {
    const input = request(action), saved = await reply(action, input);
    for (const [key, value] of Object.entries(input)) {
      if (key === "schema_version" || key === "method") continue;
      const changed = structuredClone(input);
      if (key.endsWith("_id")) changed[key] = uuid(99);
      else if (key === "reason") changed[key] = `${value} changed`;
      else if (key === "observed_at") changed[key] = "2026-10-25T00:00:00.123457Z";
      else if (key === "quantities") changed[key] = [{ cell_id: uuid(9), quantity: "0.001" }];
      else if (key === "container_checks") changed[key] = [{ container_id: uuid(10), presence: "missing" }];
      else if (key === "findings") changed[key] = [{ location_id: uuid(11), description: "Changed finding" }];
      else assert.fail(`uncovered field ${key}`);
      await assert.rejects(verifyCountSavedReply(action, changed, saved));
    }
  });
}
test("all eight receipt fields and three result fields are mandatory; concealed fields never parse", async () => {
  const value = await reply("cancel");
  for (const key of Object.keys(value.data.receipt)) { const bad = structuredClone(value); delete (bad.data.receipt as unknown as Record<string, unknown>)[key]; assert.throws(() => parseCountReply(bad)); }
  for (const key of Object.keys(value.data.receipt.result_ref)) { const bad = structuredClone(value); delete (bad.data.receipt.result_ref as unknown as Record<string, unknown>)[key]; assert.throws(() => parseCountReply(bad)); }
  for (const key of ["private_nonce_hex", "expected", "boundary_hash", "other_statement", "comparison", "snapshot"]) {
    for (const level of ["envelope", "data", "receipt", "result"] as const) {
      const bad = structuredClone(value); const target = level === "envelope" ? bad : level === "data" ? bad.data : level === "receipt" ? bad.data.receipt : bad.data.receipt.result_ref;
      Object.assign(target, { [key]: "concealed unit sentinel" }); assert.throws(() => parseCountReply(bad));
    }
  }
  const wrong = structuredClone(value); wrong.data.receipt.receipt_digest = "f".repeat(64); await assert.rejects(verifyCountSavedReply("cancel", request("cancel"), wrong));
  assert.throws(() => parseCountReply({ ...value, schema_version: 1.1 }));
});
test("long numeric aliases use bounded scale/digit comparisons, not a new token cap or exponent expansion", () => {
  const raw = JSON.stringify(request("read"));
  for (const token of [`1e${"0".repeat(1024)}`, `0.${"0".repeat(1024)}1e1025`, `1e-${"0".repeat(1024)}`]) {
    assert.equal(decodeCountRequest("read", new TextEncoder().encode(raw.replace('"schema_version":1', `"schema_version":${token}`))).schema_version, 1);
  }
  for (const token of [`1e${"9".repeat(1024)}`, `0.${"0".repeat(1024)}1e1024`]) assert.throws(() => decodeCountRequest("read", new TextEncoder().encode(raw.replace('"schema_version":1', `"schema_version":${token}`))));
});
