import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { AdministrationTransportError, createAdministrationOperationClient } from "../../src/hub/features/controlled-drugs/administration/client.ts";
import { createAdministrationOperations } from "../../src/hub/features/controlled-drugs/administration/operation-controller.ts";
import { administrationPointerSchema } from "../../src/hub/features/controlled-drugs/administration/schema.ts";
import type { ReviewSessionSource } from "../../src/hub/features/controlled-drugs/record-review/raw-rpc.ts";
const vectors = JSON.parse(readFileSync(new URL("./administration-wire-vectors.json", import.meta.url), "utf8"));
const { definition: _definition, ...fields } = vectors.request, pointer = administrationPointerSchema.parse(fields);
const identity = { actorId: pointer.actor_id!, sessionId: "30000000-0000-4000-8000-000000000001", generation: 1 };
const config = { projectRef: "a".repeat(20), url: `https://${"a".repeat(20)}.supabase.co`, publishableKey: "sb_publishable_synthetic" };
function sessions() {
  let generation = 1;
  const source: ReviewSessionSource = { current: async () => ({ ...identity, generation, accessToken: "synthetic.token.value" }), isCurrent: who => who.actorId === identity.actorId && who.sessionId === identity.sessionId && who.generation === generation };
  return { source, rotate: () => { generation++; } };
}
function saved() {
  return { schema_version: 1, state: "saved", data: { pointer, receipt: vectors.receipt, preparation: { request: vectors.request, request_digest: vectors.request_digest, source_state: "current", created_at: "2026-10-27T11:59:00.123456Z", expires_at: "2026-10-27T12:14:00.123456Z",
    summary: { site: { id: pointer.site_id, label: vectors.request.definition.site.label }, locations: [{ id: identity.sessionId, label: "Vector-only room", kind: "clinic", initial_custodian_id: null }] } } } };
}
const response = (value: unknown) => new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
test("raw administrator transport has one fixed endpoint and admits an exact saved receipt", async () => {
  const staff = sessions(); let calls = 0;
  const client = createAdministrationOperationClient(config, staff.source, async (url, init) => {
    calls++; assert.equal(url, `${config.url}/rest/v1/rpc/prepare_controlled_stock_administration_v1`);
    assert.equal(init?.credentials, "omit"); assert.equal(init?.redirect, "error"); assert.equal(init?.cache, "no-store");
    assert.deepEqual(JSON.parse(init!.body as string), { p_request: vectors.request });
    assert.equal((init!.headers as Record<string, string>).Authorization, "Bearer synthetic.token.value");
    return response(saved());
  });
  assert.equal((await client.prepare(vectors.request, identity)).state, "saved"); assert.equal(calls, 1);
  assert.throws(() => client.prepare({ ...vectors.request, extra: true }, identity), AdministrationTransportError); assert.equal(calls, 1);
});
test("a same-actor login change during transport rejects its receipt and retains the original ID-only pointer", async () => {
  const staff = sessions(); let calls = 0;
  const client = createAdministrationOperationClient(config, staff.source, async () => { calls++; staff.rotate(); return response(saved()); });
  const state = new Map<string, string>(), controller = createAdministrationOperations(client, { getItem: key => state.get(key) ?? null, setItem: (key, value) => { state.set(key, value); }, removeItem: key => { state.delete(key); } }, { exclusive: (_key, work) => work() });
  await assert.rejects(() => controller.prepare(vectors.request, identity), AdministrationTransportError); assert.equal(calls, 1);
  assert.deepEqual(JSON.parse([...state.values()][0]), pointer); assert.ok(![...state.values()][0].includes("registration_reference"));
});
test("malformed evidence and provider failures never retry or expose server details", async () => {
  for (const make of [() => { const value = saved(); value.data.receipt = { ...vectors.receipt, receipt_digest: "0".repeat(64) }; return response(value); }, () => new Response('{"message":"private server detail"}', { status: 500, headers: { "Content-Type": "application/json" } }), () => new Response("private server detail", { headers: { "Content-Type": "text/html" } })]) {
    let calls = 0; const client = createAdministrationOperationClient(config, sessions().source, async () => { calls++; return make(); });
    await assert.rejects(() => client.prepare(vectors.request, identity), cause => cause instanceof AdministrationTransportError && !cause.message.includes("private server detail"));
    assert.equal(calls, 1);
  }
});
