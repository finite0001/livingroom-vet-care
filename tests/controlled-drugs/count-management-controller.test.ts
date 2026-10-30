import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createCountOperationController, type CountPointerStorage } from "../../src/hub/features/controlled-drugs/count/count-operation-controller.ts";
import type { CountClient } from "../../src/hub/features/controlled-drugs/count/count-client.ts";
const vectors = JSON.parse(readFileSync(new URL("./count-management-wire-fixtures/independent-vectors.json", import.meta.url), "utf8"));
const cases = Object.fromEntries(vectors.request_cases.filter((row: { action: string }) => row.action.startsWith("reconciliation_")).map((row: { action: string; request: unknown }) => [row.action, row.request]));
const prepared = cases.reconciliation_prepare;
const anchor = { schema_version: 1, state: "available", data: { product_id: prepared.product_id, site_id: prepared.site_id, reconciliation_id: prepared.reconciliation_id, preparation_id: prepared.preparation_id, parent_action_id: prepared.parent_action_id,
  recorder_id: prepared.actor_id, lot_id: prepared.lot_id, quantity_delta: prepared.quantity_delta, reason: prepared.reason, parent_expires_at: "2026-10-26T12:05:00.000000Z", approval_id: null, execution_id: null, confirmation_id: null,
  history_state: "prepared", current_state: "current", target_cause_ids: prepared.target_cause_ids } };
test("management recovery pointers retain reconciliation scope instead of confusing preparation IDs", async () => {
  const values = new Map<string, string>(), storage: CountPointerStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } };
  let calls = 0;
  const client = { async manage() { calls++; throw new Error("lost"); } } as unknown as CountClient;
  const locks = { async exclusive<T>(_name: string, task: () => Promise<T>): Promise<T> { return task(); } };
  for (const action of ["reconciliation_prepare", "reconciliation_approve", "reconciliation_execute", "reconciliation_confirm"] as const) {
    values.clear(); const request = cases[action], identity = { actorId: request.actor_id, sessionId: prepared.parent_action_id, generation: 1 };
    const current = { ...anchor, data: { ...anchor.data, history_state: action === "reconciliation_execute" ? "approved" : action === "reconciliation_confirm" ? "executed" : "prepared",
      approval_id: action === "reconciliation_execute" || action === "reconciliation_confirm" ? cases.reconciliation_execute.approval_id : null,
      execution_id: action === "reconciliation_confirm" ? cases.reconciliation_confirm.execution_id : null } };
    const controller = createCountOperationController(client, storage, locks);
    await assert.rejects(() => controller.manage(action, request, current, identity));
    assert.equal(controller.pending(identity.actorId)?.scope_id, prepared.reconciliation_id);
    assert.ok(![...values.values()][0].includes(prepared.reason));
  }
  assert.equal(calls, 4);
});
test("an unrelated preparation anchor prevents management transmission and creates no recovery pointer", () => {
  let calls = 0;
  const client = { async manage() { calls++; throw new Error("must not send"); } } as unknown as CountClient;
  const storage: CountPointerStorage = { getItem: () => null, setItem: () => { throw new Error("must not persist"); }, removeItem: () => {} };
  const locks = { async exclusive<T>(_name: string, task: () => Promise<T>): Promise<T> { return task(); } };
  const request = cases.reconciliation_approve, controller = createCountOperationController(client, storage, locks);
  assert.throws(() => controller.manage("reconciliation_approve", { ...request, preparation_id: prepared.lot_id }, anchor, { actorId: request.actor_id, sessionId: prepared.parent_action_id, generation: 1 }));
  assert.equal(calls, 0);
});
