import assert from "node:assert/strict";
import test from "node:test";
import { decodeCountPolicyClosureReply, parseCountPolicyClosureRequest, parseCountPolicyPublishRequest, parseCountPolicySettings, parseCountScopeReply, type CountPolicySettings } from "../../src/hub/features/controlled-drugs/count/count-admin-schema.ts";
import { countPolicyDraft, countPolicySettingsFromDraft } from "../../src/hub/features/controlled-drugs/count/count-policy-form.ts";
import { digestCountPolicyClosure, digestCountPolicyReceipt, digestCountPolicyRequest, verifyCountPolicyClosure, verifyCountPolicyReceipt } from "../../src/hub/features/controlled-drugs/count/count-policy-wire.ts";
import { createCountOperationController, type CountPointerStorage } from "../../src/hub/features/controlled-drugs/count/count-operation-controller.ts";
import type { CountClient } from "../../src/hub/features/controlled-drugs/count/count-client.ts";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const settings: CountPolicySettings = { observation_enabled: true, management_enabled: true, read_enabled: true, reconciliation_enabled: true,
  methods: ["manual_count"], observer_roles: ["DVM", "TECH"], manager_roles: ["ADMIN"], reader_roles: ["ADMIN", "DVM", "TECH"],
  reconciliation_preparer_roles: ["DVM"], reconciliation_approver_roles: ["ADMIN"], reconciliation_executor_roles: ["DVM"], reconciliation_confirmer_roles: ["ADMIN"], reconciliation_resolver_roles: ["ADMIN"],
  max_observation_age_seconds: 3600, max_reconciliation_preparation_age_seconds: 300, max_reconciliation_approval_age_seconds: 300, max_reconciliation_confirmation_age_seconds: 300,
  meaning_text: "Synthetic count meaning", meaning_version: "synthetic-v1", reconciliation_meaning_text: "Synthetic correction meaning", reconciliation_meaning_version: "synthetic-v1" };
const request = { schema_version: 1, actor_id: id(1), operation_id: id(2), product_id: id(3), site_id: id(4), expected_prior_policy_id: null, settings };
test("new configuration has no preselected permissions, limits, meanings or methods", () => {
  const draft = countPolicyDraft(null);
  assert.ok(Object.values(draft.flags).every(value => value === "")); assert.ok(Object.values(draft.roles).every(value => !value.length));
  assert.ok(Object.values(draft.ages).every(value => value === "")); assert.equal(draft.method, "");
  assert.throws(() => countPolicySettingsFromDraft(draft));
  assert.deepEqual(countPolicySettingsFromDraft(countPolicyDraft(settings)), settings);
});
test("enabled capabilities require explicit sorted roles, a method and bounded integer limits", () => {
  assert.ok(Object.isFrozen(parseCountPolicySettings(settings).observer_roles));
  for (const change of [{ observer_roles: [] }, { reader_roles: ["TECH", "DVM"] }, { manager_roles: ["ADMIN", "ADMIN"] }, { methods: [] },
    { max_observation_age_seconds: 86401 }, { max_reconciliation_approval_age_seconds: 901 }, { max_observation_age_seconds: 1.5 }, { meaning_text: "\u200b" }])
    assert.throws(() => parseCountPolicySettings({ ...settings, ...change }));
  const astral = parseCountPolicySettings({ ...settings, meaning_text: "𐐀".repeat(2000) }); assert.equal([...astral.meaning_text].length, 2000);
  assert.throws(() => parseCountPolicySettings({ ...settings, meaning_text: "𐐀".repeat(2001) }));
  assert.equal(parseCountPolicySettings({ ...settings, meaning_text: " preserved wording " }).meaning_text, " preserved wording ");
});
test("policy requests snapshot data without accessors and keep versions out of binary numbers", () => {
  const getter = { ...request }; Object.defineProperty(getter, "settings", { enumerable: true, get() { throw new Error("getter ran"); } });
  assert.throws(() => parseCountPolicyPublishRequest(getter), error => error instanceof Error && !error.message.includes("getter ran"));
  assert.throws(() => parseCountPolicyPublishRequest({ ...request, version: 1 }));
});
test("policy digests bind every setting, original identity and exact prior-version intent", async () => {
  const revisionRequest = { ...request, expected_prior_policy_id: id(8) };
  const base = { schema_version: 1 as const, action: "policy_publish" as const, actor_id: id(1), operation_id: id(2), product_id: id(3), site_id: id(4),
    request_digest: await digestCountPolicyRequest(revisionRequest), result_ref: { kind: "policy" as const, id: id(2), version: "9223372036854775807" }, receipt_digest: "0".repeat(64) };
  const receipt = { ...base, receipt_digest: await digestCountPolicyReceipt(base) };
  assert.equal((await verifyCountPolicyReceipt(revisionRequest, receipt)).result_ref.version, "9223372036854775807");
  await assert.rejects(() => verifyCountPolicyReceipt({ ...request, expected_prior_policy_id: id(9) }, receipt));
  await assert.rejects(() => verifyCountPolicyReceipt({ ...request, settings: { ...settings, max_observation_age_seconds: 7200 } }, receipt));
  await assert.rejects(() => verifyCountPolicyReceipt(request, { ...receipt, product_id: id(99) }));
  const falseFirst = { ...base, request_digest: await digestCountPolicyRequest(request) };
  const falseFirstReceipt = { ...falseFirst, receipt_digest: await digestCountPolicyReceipt(falseFirst) };
  await assert.rejects(() => verifyCountPolicyReceipt(request, falseFirstReceipt));
  const falseRevision = { ...base, result_ref: { ...base.result_ref, version: "1" } };
  const falseRevisionReceipt = { ...falseRevision, receipt_digest: await digestCountPolicyReceipt(falseRevision) };
  await assert.rejects(() => verifyCountPolicyReceipt(revisionRequest, falseRevisionReceipt));
  assert.notEqual(await digestCountPolicyRequest(request), await digestCountPolicyRequest({ ...request, settings: { ...settings, meaning_text: "Different meaning" } }));
});
test("scope discovery does not invent access for unconfigured stock and retains exact pagination", () => {
  const caps = { configure: true, read: false, observe: false, manage: false, reconciliation_prepare: false, reconciliation_approve: false, reconciliation_execute: false, reconciliation_confirm: false, cause_resolve: false };
  const value = { schema_version: 1, items: [{ product_id: id(3), product_name: "Synthetic", site_id: id(4), site_name: "Synthetic site", policy_id: null, policy_version: null, capabilities: caps }], next_cursor: null, has_more: false };
  const input = { schema_version: 1, actor_id: id(1), cursor: null, page_size: 100 }, raw = (body: unknown) => new TextEncoder().encode(JSON.stringify(body));
  assert.equal(parseCountScopeReply(raw(value), input).items[0].capabilities.read, false);
  assert.throws(() => parseCountScopeReply(raw({ ...value, items: [{ ...value.items[0], capabilities: { ...caps, observe: true } }] }), input));
  assert.throws(() => parseCountScopeReply(raw({ ...value, has_more: true }), input));
  assert.throws(() => parseCountScopeReply(raw(value), { ...input, cursor: { product_id: id(3), site_id: id(4) } }));
});
test("policy V2 closure is explicit, identity-bound and verifies the nested saved receipt", async () => {
  const pointer = parseCountPolicyClosureRequest({ schema_version: 2, actor_id: id(1), operation_id: id(2), original_action: "policy_publish", scope_id: id(2), product_id: id(3), site_id: id(4) });
  assert.throws(() => parseCountPolicyClosureRequest({ ...pointer, schema_version: 1 }));
  assert.throws(() => parseCountPolicyClosureRequest({ ...pointer, scope_id: id(99) }));
  const inner = { schema_version: 1 as const, action: "policy_publish" as const, actor_id: id(1), operation_id: id(2), product_id: id(3), site_id: id(4),
    request_digest: await digestCountPolicyRequest(request), result_ref: { kind: "policy" as const, id: id(2), version: "1" }, receipt_digest: "0".repeat(64) };
  const receipt = { ...inner, receipt_digest: await digestCountPolicyReceipt(inner) };
  const unsigned = { ...pointer, action: "operation_closure", state: "saved", receipt, receipt_digest: "0".repeat(64) };
  const reply = { ...unsigned, receipt_digest: await digestCountPolicyClosure(unsigned) };
  assert.equal((await verifyCountPolicyClosure(pointer, reply)).receipt?.result_ref.version, "1");
  const badNested = { ...unsigned, receipt: { ...receipt, receipt_digest: "f".repeat(64) } };
  const badReply = { ...badNested, receipt_digest: await digestCountPolicyClosure(badNested) };
  await assert.rejects(() => verifyCountPolicyClosure(pointer, badReply));
  const raw = JSON.stringify(reply).replace('"schema_version":2', '"schema_version":2e0');
  assert.throws(() => decodeCountPolicyClosureReply(new TextEncoder().encode(raw)));
});
test("lost policy publication retains only its V2 IDs and blocks count saves until terminal recovery", async () => {
  const values = new Map<string, string>(), storage: CountPointerStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } };
  let publishes = 0, closures = 0, countCalls = 0;
  const client = { async publishPolicy() { publishes++; throw new Error("lost response"); }, async mutate() { countCalls++; throw new Error("must not send"); },
    async policyClosure(_mode, pointer) { closures++; return { ...pointer, action: "operation_closure", state: "abandoned", receipt: null, receipt_digest: "a".repeat(64) }; } } as CountClient;
  const lock = { async exclusive<T>(_name: string, task: () => Promise<T>): Promise<T> { return task(); } };
  const identity = { actorId: id(1), sessionId: id(10), generation: 1 }, controller = createCountOperationController(client, storage, lock);
  await assert.rejects(() => controller.publishPolicy(request, identity));
  assert.equal(controller.pending(id(1))?.schema_version, 2); assert.ok(![...values.values()][0].includes("Synthetic count meaning"));
  await assert.rejects(() => controller.mutate("cancel", { schema_version: 1, actor_id: id(1), count_id: id(5), operation_id: id(6), cancellation_id: id(7), reason: "Synthetic" }, { product_id: id(3), site_id: id(4) }, identity));
  const reloaded = createCountOperationController(client, storage, lock);
  assert.equal((await reloaded.recover("close", { ...identity, sessionId: id(11), generation: 2 })).state, "abandoned");
  assert.equal(reloaded.pending(id(1)), null); assert.equal(publishes, 1); assert.equal(closures, 1); assert.equal(countCalls, 0);
});
