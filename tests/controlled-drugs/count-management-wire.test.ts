import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseCountManagementRequest, parseCountManagementReceipt, parseCountManagementReply,
  decodeCountManagementRequest, decodeCountManagementReply,
  type CountManagementAction, type CountManagementMutationAction,
} from "../../src/hub/features/controlled-drugs/count/count-management-schema.ts";
import {
  countManagementRequestBytes, digestCountManagementRequest, digestCountManagementReceipt,
  verifyCountManagementSavedReply, verifyCountManagementNotFound, verifyCountManagementReadReply,
} from "../../src/hub/features/controlled-drugs/count/count-management-wire.ts";
import { parseCountPublicReceipt } from "../../src/hub/features/controlled-drugs/count/count-request-schema.ts";

const uid = (value: number) => "00000000-0000-0000-0000-" + value.toString(16).padStart(12, "0");
const encoder = new TextEncoder();
const actions: CountManagementMutationAction[] = ["reconciliation_prepare", "reconciliation_approve", "reconciliation_execute", "reconciliation_confirm", "cause_resolve"];
function base() { return { schema_version: 1, actor_id: uid(1), product_id: uid(2), site_id: uid(3) }; }
function requests(): Record<CountManagementAction, Record<string, unknown>> {
  const op = { ...base(), operation_id: uid(10) };
  return {
    reconciliation_prepare: { ...op, reconciliation_id: uid(11), preparation_id: uid(12), parent_action_id: uid(13), target_cause_ids: [uid(20), uid(21)], lot_id: uid(14), quantity_delta: "-1.250", reason: "Synthetic correction review" },
    reconciliation_approve: { ...op, approval_id: uid(15), preparation_id: uid(12) },
    reconciliation_execute: { ...op, execution_id: uid(16), preparation_id: uid(12), approval_id: uid(15) },
    reconciliation_confirm: { ...op, confirmation_id: uid(17), execution_id: uid(16) },
    cause_resolve: { ...op, resolution_id: uid(18), cause_id: uid(20), evidence: { kind: "reconciled_available", confirmation_id: uid(17), post_count_id: uid(19) } },
    read: { ...base(), reconciliation_id: uid(11) }, recover: op,
  };
}
const resultKinds = {
  reconciliation_prepare: ["reconciliation_preparation", "preparation_id"], reconciliation_approve: ["reconciliation_approval", "approval_id"],
  reconciliation_execute: ["reconciliation_execution", "execution_id"], reconciliation_confirm: ["reconciliation_confirmation", "confirmation_id"],
  cause_resolve: ["cause_resolution", "resolution_id"],
} as const;
async function saved(action: CountManagementMutationAction, request = requests()[action]) {
  const receipt = {
    ...base(), action, operation_id: String(request.operation_id), actor_id: String(request.actor_id),
    product_id: String(request.product_id), site_id: String(request.site_id), request_digest: await digestCountManagementRequest(action, request),
    result_ref: { kind: resultKinds[action][0], id: String(request[resultKinds[action][1]]), opaque_commitment: "a".repeat(64) }, receipt_digest: "0".repeat(64),
  };
  receipt.receipt_digest = await digestCountManagementReceipt(receipt);
  return { schema_version: 1, state: "saved", data: { receipt } };
}
function available() {
  return { schema_version: 1, state: "available", data: {
    product_id: uid(2), site_id: uid(3), reconciliation_id: uid(11), preparation_id: uid(12), parent_action_id: uid(13), recorder_id: uid(1),
    lot_id: uid(14), quantity_delta: "-1.250", reason: "Synthetic correction review", parent_expires_at: "2026-10-25T22:00:00.000000Z",
    approval_id: null as string | null, execution_id: null as string | null, confirmation_id: null as string | null,
    history_state: "prepared", current_state: "current", target_cause_ids: [uid(20), uid(21)],
  } };
}
function refuse(action: CountManagementAction, value: unknown) {
  assert.throws(() => parseCountManagementRequest(action, value), error => error instanceof Error && error.message === "Invalid count management wire value");
}

test("seven closed management requests and both resolution evidence kinds retain exact values", async t => {
  for (const [action, value] of Object.entries(requests())) await t.test(action, () => {
    const parsed = parseCountManagementRequest(action as CountManagementAction, value);
    assert.deepEqual(parsed, value); assert.ok(Object.isFrozen(parsed));
    assert.deepEqual(decodeCountManagementRequest(action as CountManagementAction, encoder.encode(JSON.stringify(value))), parsed);
  });
  const input = requests().cause_resolve;
  input.evidence = { kind: "fresh_agreement", post_count_id: uid(19) };
  assert.deepEqual(parseCountManagementRequest("cause_resolve", input), input);
});
test("all five saved receipt kinds bind the original request and public scope", async t => {
  for (const action of actions) await t.test(action, async () => {
    const request = requests()[action], reply = await saved(action, request);
    const checked = await verifyCountManagementSavedReply(action, request, reply);
    assert.deepEqual(checked, reply); assert.ok(Object.isFrozen(checked.data.receipt.result_ref));
    assert.equal(Object.keys(checked.data.receipt).length, 9);
    assert.deepEqual(decodeCountManagementReply(encoder.encode(JSON.stringify(reply))), checked);
    assert.throws(() => parseCountPublicReceipt(checked.data.receipt));
  });
});
test("every retained mutation request field affects its commitment", async t => {
  for (const action of actions) {
    const request = requests()[action], expected = await digestCountManagementRequest(action, request);
    for (const field of Object.keys(request).filter(k => k !== "schema_version")) await t.test(action + ":" + field, async () => {
      const changed = structuredClone(request);
      if (field === "target_cause_ids") changed[field] = [uid(20), uid(22)];
      else if (field === "quantity_delta") changed[field] = "-2.500";
      else if (field === "reason") changed[field] = "Different synthetic correction review";
      else if (field === "evidence") changed[field] = { kind: "fresh_agreement", post_count_id: uid(19) };
      else changed[field] = uid(999);
      assert.notEqual(await digestCountManagementRequest(action, changed), expected);
      await assert.rejects(verifyCountManagementSavedReply(action, request, await saved(action, changed)));
    });
  }
  for (const field of ["confirmation_id", "post_count_id"]) await t.test("evidence:" + field, async () => {
    const request = requests().cause_resolve, changed = structuredClone(request);
    (changed.evidence as Record<string, unknown>)[field] = uid(999);
    assert.notEqual(await digestCountManagementRequest("cause_resolve", changed), await digestCountManagementRequest("cause_resolve", request));
  });
});
test("recommitted receipt identity and digest substitutions cannot change retained request binding", async t => {
  const action = "reconciliation_execute", request = requests()[action];
  for (const field of ["operation_id", "actor_id", "product_id", "site_id", "result_id", "request_digest"]) await t.test(field, async () => {
    const reply = await saved(action, request), receipt = reply.data.receipt;
    if (field === "result_id") receipt.result_ref.id = uid(999);
    else if (field === "request_digest") receipt.request_digest = "0".repeat(64);
    else receipt[field as "operation_id"] = uid(999);
    receipt.receipt_digest = await digestCountManagementReceipt(receipt);
    await assert.rejects(verifyCountManagementSavedReply(action, request, reply));
  });
  const reply = await saved(action, request); reply.data.receipt.receipt_digest = "0".repeat(64);
  await assert.rejects(verifyCountManagementSavedReply(action, request, reply));
});
test("unsupported authority/private fields and mismatched action/result kinds refuse", async t => {
  for (const key of ["approved", "bypass", "policy_hash", "expected_quantity", "private_nonce_hex", "source"]) await t.test(key, async () => {
    refuse("reconciliation_prepare", { ...requests().reconciliation_prepare, [key]: true });
    const reply = await saved("reconciliation_prepare");
    assert.throws(() => parseCountManagementReply({ ...reply, [key]: true }));
    assert.throws(() => parseCountManagementReceipt({ ...reply.data.receipt, [key]: true }));
    assert.throws(() => parseCountManagementReceipt({ ...reply.data.receipt, result_ref: { ...reply.data.receipt.result_ref, [key]: true } }));
  });
  const reply = await saved("reconciliation_prepare");
  assert.throws(() => parseCountManagementReceipt({ ...reply.data.receipt, result_ref: { ...reply.data.receipt.result_ref, kind: "reconciliation_execution" } }));
  assert.throws(() => parseCountManagementReceipt({ ...reply.data.receipt, receipt_digest: 1 }));
  refuse("cause_resolve", { ...requests().cause_resolve, evidence: { kind: "fresh_agreement", post_count_id: uid(19), confirmation_id: uid(17) } });
});
test("getters, unsupported prototypes, cycles and over-cap arrays never become schema inputs", () => {
  let reads = 0;
  const request = requests().reconciliation_prepare;
  Object.defineProperty(request, "reason", { enumerable: true, get() { reads++; throw new Error("hidden"); } });
  refuse("reconciliation_prepare", request); assert.equal(reads, 0);
  const causes = Array.from({ length: 65 }, (_, i) => uid(i + 1));
  Object.defineProperty(causes, "0", { enumerable: true, get() { reads++; throw new Error("hidden"); } });
  refuse("reconciliation_prepare", { ...requests().reconciliation_prepare, target_cause_ids: causes }); assert.equal(reads, 0);
  const input = requests().cause_resolve;
  input.evidence = Object.defineProperty({}, "kind", { enumerable: true, get() { reads++; throw new Error("hidden"); } });
  refuse("cause_resolve", input); assert.equal(reads, 0);
  const cyclic = requests().cause_resolve; cyclic.evidence = cyclic; refuse("cause_resolve", cyclic);
  refuse("recover", Object.assign(Object.create({ inherited: true }), requests().recover));
  const sparse = new Array(2); sparse[1] = uid(21);
  refuse("reconciliation_prepare", { ...requests().reconciliation_prepare, target_cause_ids: sparse });
});
test("parent decimal and clean-text rules preserve aliases and enforce independent bounds", async t => {
  for (const value of ["-99999999999.999", "99999999999.999", "-1", "-1.2", "-1.250", "0.001"]) await t.test("quantity:" + value, () => {
    assert.equal(parseCountManagementRequest("reconciliation_prepare", { ...requests().reconciliation_prepare, quantity_delta: value }).quantity_delta, value);
  });
  for (const value of ["0", "-0", "0.000", "-0.000", "01", "1e0", "+1", "1.0000", "100000000000", -1]) refuse("reconciliation_prepare", { ...requests().reconciliation_prepare, quantity_delta: value });
  for (const reason of ["x\ty", "x\ny", "\u0085x", "x\u200b", "😀".repeat(2000)]) await t.test("clean text length:" + reason.length, () => {
    assert.equal(parseCountManagementRequest("reconciliation_prepare", { ...requests().reconciliation_prepare, reason }).reason, reason);
  });
  for (const reason of ["", "\u0085\u200b", " x", "x\ufeff", "x\ry", "x\u007fy", "x\u0000y", "\ud800", "x".repeat(2001), "😀".repeat(2001)]) refuse("reconciliation_prepare", { ...requests().reconciliation_prepare, reason });
  const first = await digestCountManagementRequest("reconciliation_prepare", { ...requests().reconciliation_prepare, quantity_delta: "-1" });
  assert.notEqual(first, await digestCountManagementRequest("reconciliation_prepare", { ...requests().reconciliation_prepare, quantity_delta: "-1.000" }));
});
test("complete sorted cause sets include64 and refuse omission, duplicate, foreign syntax or65", () => {
  const request = requests().reconciliation_prepare;
  assert.equal(parseCountManagementRequest("reconciliation_prepare", { ...request, target_cause_ids: Array.from({ length: 64 }, (_, i) => uid(i + 1)) }).target_cause_ids.length, 64);
  for (const values of [[], [uid(20), uid(20)], [uid(21), uid(20)], [uid(0)], [uid(0xabcdef).toUpperCase()], Array.from({ length: 65 }, (_, i) => uid(i + 1))]) refuse("reconciliation_prepare", { ...request, target_cause_ids: values });
});
test("raw duplicate keys, invalid UTF8, retained numeric scale and excessive depth refuse", () => {
  const request = JSON.stringify(requests().recover);
  for (const token of ["1e0", "0.1e1", "0.01e2"]) assert.deepEqual(decodeCountManagementRequest("recover", encoder.encode(request.replace('"schema_version":1', '"schema_version":' + token))), requests().recover);
  for (const token of ["1.0", "10e-1", "-1", "1e999999999", "true"]) assert.throws(() => decodeCountManagementRequest("recover", encoder.encode(request.replace('"schema_version":1', '"schema_version":' + token))));
  assert.throws(() => decodeCountManagementRequest("recover", encoder.encode(request.replace('"schema_version":1', '"schema_version":1,"schema_version":1'))));
  assert.throws(() => decodeCountManagementRequest("recover", new Uint8Array([0xc0, 0xaf])));
  assert.throws(() => decodeCountManagementRequest("recover", encoder.encode("[".repeat(8) + "1" + "]".repeat(8))));
  assert.throws(() => decodeCountManagementRequest("recover", new Uint8Array(131073)));
});
test("raw Unicode escapes may exceed16KiB while parsed management values remain within their own cap", () => {
  const request = { ...requests().reconciliation_prepare, reason: "😀".repeat(2000) };
  const raw = encoder.encode(JSON.stringify(request).replaceAll("😀", "\\ud83d\\ude00"));
  assert.ok(raw.byteLength > 16384);
  assert.deepEqual(decodeCountManagementRequest("reconciliation_prepare", raw), request);
});
test("compact absence and closed management read bind scope without implying authorization", () => {
  const recover = requests().recover;
  const absent = { schema_version: 1, state: "not_found", data: { operation_id: uid(10), product_id: uid(2), site_id: uid(3) } };
  assert.deepEqual(verifyCountManagementNotFound(recover, absent), absent);
  for (const key of ["operation_id", "product_id", "site_id"]) assert.throws(() => verifyCountManagementNotFound(recover, { ...absent, data: { ...absent.data, [key]: uid(999) } }));
  for (const [stage, count] of [["prepared", 0], ["approved", 1], ["executed", 2], ["confirmed", 3]] as const) {
    const reply = available(); reply.data.history_state = stage;
    if (count >= 1) reply.data.approval_id = uid(15);
    if (count >= 2) reply.data.execution_id = uid(16);
    if (count >= 3) reply.data.confirmation_id = uid(17);
    for (const status of ["current", "stale", "expired", "cancelled", "blocked"]) { reply.data.current_state = status; assert.deepEqual(verifyCountManagementReadReply(requests().read, reply), reply); }
  }
  const impossible = available(); impossible.data.execution_id = uid(16); assert.throws(() => parseCountManagementReply(impossible));
  const privateReply = available(); assert.throws(() => parseCountManagementReply({ ...privateReply, data: { ...privateReply.data, boundary_hash: "0".repeat(64) } }));
  for (const value of ["2023-02-29T22:00:00.000000Z", "2026-10-25T22:00:00Z", "2026-10-25T22:00:00.000000+00:00"]) assert.throws(() => parseCountManagementReply({ ...available(), data: { ...available().data, parent_expires_at: value } }));
  assert.throws(() => verifyCountManagementReadReply({ ...requests().read, site_id: uid(999) }, available()));
});
test("caller mutation after an async operation starts cannot alter the retained input or reply", async () => {
  const action = "reconciliation_prepare", request = requests()[action], expected = await digestCountManagementRequest(action, request);
  const pending = digestCountManagementRequest(action, request); request.reason = "Later caller edit";
  assert.equal(await pending, expected);
  const original = requests()[action], reply = await saved(action, original);
  const verification = verifyCountManagementSavedReply(action, original, reply);
  original.reason = "Later edit"; reply.data.receipt.result_ref.id = uid(999);
  assert.equal((await verification).data.receipt.result_ref.id, uid(12));
  const bytes = countManagementRequestBytes(action, requests()[action]); bytes.fill(0);
  assert.notDeepEqual(bytes, countManagementRequestBytes(action, requests()[action]));
});
