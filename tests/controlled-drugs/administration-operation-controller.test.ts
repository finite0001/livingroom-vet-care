import assert from "node:assert/strict";
import test from "node:test";
import { createAdministrationOperations, type AdministrationOperationTransport, type AdministrationOperationLocks } from "../../src/hub/features/controlled-drugs/administration/operation-controller.ts";
import { administrationPointerSchema, type AdministrationReply } from "../../src/hub/features/controlled-drugs/administration/schema.ts";
import { ControlledOperationNotSentError } from "../../src/hub/features/controlled-drugs/operation-errors.ts";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const identity = { actorId: id(1), sessionId: id(2), generation: 1 };
const request = { schema_version: 1, actor_id: id(1), operation_id: id(3), action: "site_register", product_id: null, site_id: id(3), definition: { site: { label: "Clinic", registration_reference: "Actual registration" }, locations: [{ key: "safe", label: "Safe", kind: "clinic", initial_custodian_id: null }] } };
const { definition: _definition, ...fields } = request, pointer = administrationPointerSchema.parse(fields);
function fixture(locks: AdministrationOperationLocks = { exclusive: (_key, work) => work() }) {
  const state = new Map<string, string>(); let called = 0, enteredError: Error | null = null;
  const reply: AdministrationReply = { schema_version: 1, state: "not_found", data: { pointer, preparation: null, receipt: null } };
  const wire = async () => { called++; assert.equal(state.size, 1, "pointer must be durable before transport"); if (enteredError) throw enteredError; return reply; };
  const transport: AdministrationOperationTransport = { prepare: wire, execute: wire, read: wire, close: async () => ({ ...await wire(), state: "abandoned" }) };
  const operations = createAdministrationOperations(transport, { getItem: key => state.get(key) ?? null, setItem: (key, value) => { state.set(key, value); }, removeItem: key => { state.delete(key); } }, locks);
  return { operations, state, called: () => called, fail: (cause: Error) => { enteredError = cause; } };
}
test("known pre-send lock refusal is retryable but an entered transport cannot forge that classification", async () => {
  const local = fixture({ exclusive: async () => { throw new Error("another tab"); } });
  await assert.rejects(() => local.operations.prepare(request, identity), ControlledOperationNotSentError); assert.equal(local.called(), 0); assert.equal(local.state.size, 0);
  const remote = fixture(); remote.fail(new ControlledOperationNotSentError());
  await assert.rejects(() => remote.operations.prepare(request, identity), cause => !(cause instanceof ControlledOperationNotSentError));
  assert.equal(remote.called(), 1); assert.equal(remote.operations.pending(identity.actorId)?.operation_id, id(3));
});
test("owned recovery retains the original pointer and only a verified terminal closure removes it", async () => {
  const local = fixture(); await local.operations.prepare(request, identity); assert.equal(local.called(), 1);
  await assert.rejects(() => local.operations.prepare({ ...request, operation_id: id(4), site_id: id(4) }, identity), ControlledOperationNotSentError);
  assert.equal(local.called(), 1); assert.equal(local.operations.pending(identity.actorId)?.operation_id, id(3));
  await local.operations.recover("read", identity); assert.equal(local.operations.pending(identity.actorId)?.operation_id, id(3));
  const result = await local.operations.recover("close", identity); assert.equal(result.reply.state, "abandoned"); assert.equal(local.state.size, 0);
  await local.operations.readOwned(pointer, identity); assert.equal(local.operations.pending(identity.actorId)?.operation_id, id(3));
});
