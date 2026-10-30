import assert from "node:assert/strict";
import test from "node:test";
import { parseCountInvestigationReply, parseCountReconciliationListReply } from "../../src/hub/features/controlled-drugs/count/count-dashboard.ts";
import { parseCountCauseDiscoveryReply } from "../../src/hub/features/controlled-drugs/count/count-causes.ts";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const raw = (input: unknown) => new TextEncoder().encode(JSON.stringify(input));
const request = { schema_version: 1, actor_id: id(1), product_id: id(2), site_id: id(3), cursor: null, page_size: 100 };
const base = { product_id: id(2), site_id: id(3), reconciliation_id: id(4), preparation_id: id(5), parent_action_id: id(6), recorder_id: id(7), lot_id: id(8), quantity_delta: "1.250", reason: "Synthetic correction",
  parent_expires_at: "2026-10-26T12:05:00.000000Z", approval_id: null, execution_id: null, confirmation_id: null, history_state: "prepared", current_state: "current", target_cause_ids: [id(9)] };
const row = () => ({ ...base, prepared_at: "2026-10-26T12:00:00.000000Z", recorder_name: "Synthetic preparer", available_actions: ["management_read", "reconciliation_approve"] });
const reply = () => ({ schema_version: 1, product_id: id(2), site_id: id(3), items: [row()], next_cursor: null, has_more: false });
test("staff handoff retains exact management data, original names and offered stage actions", () => {
  const value = parseCountReconciliationListReply(raw(reply()), request);
  assert.equal(value.items[0].quantity_delta, "1.250"); assert.ok(Object.isFrozen(value.items[0].target_cause_ids));
  assert.throws(() => parseCountReconciliationListReply(raw({ ...reply(), items: [{ ...row(), nonce: "private" }] }), request));
  assert.throws(() => parseCountReconciliationListReply(raw({ ...reply(), product_id: id(99) }), request));
});
test("handoff rejects wrong actors/stages, hidden status filters, duplicates and cursor drift", () => {
  for (const change of [{ recorder_id: id(1) }, { history_state: "approved", approval_id: id(20) }, { current_state: "expired" }, { available_actions: ["reconciliation_approve"] },
    { available_actions: ["management_read", "management_read"] }, { prepared_at: "2026-02-30T12:00:00.000000Z" }])
    assert.throws(() => parseCountReconciliationListReply(raw({ ...reply(), items: [{ ...row(), ...change }] }), request));
  assert.throws(() => parseCountReconciliationListReply(raw({ ...reply(), items: [row(), row()] }), request));
  assert.throws(() => parseCountReconciliationListReply(raw({ ...reply(), has_more: true }), request));
  assert.throws(() => parseCountReconciliationListReply(raw(reply()), { ...request, history_state: "prepared" }));
});
test("investigations preserve the other-site warning and expose no observation or private source fields", () => {
  const value = { schema_version: 1, product_id: id(2), site_id: id(3), items: [{ cause_id: id(9), source_count_id: id(10), history_state: "stale", recorded_at: "2026-10-26T12:00:00.000000Z" }],
    other_scope_causes: true, next_cursor: null, has_more: false };
  assert.equal(parseCountInvestigationReply(raw(value), request).other_scope_causes, true);
  assert.throws(() => parseCountInvestigationReply(raw({ ...value, items: [{ ...value.items[0], statement_id: id(11) }] }), request));
  assert.throws(() => parseCountInvestigationReply(raw({ ...value, items: [value.items[0], value.items[0]] }), request));
  assert.throws(() => parseCountInvestigationReply(raw(value), { ...request, cursor: { cause_id: id(9) } }));
});
test("eligible correction discovery remains distinct from blocked and empty; no partial cause selection", () => {
  const input = { schema_version: 1, actor_id: id(1), product_id: id(2), site_id: id(3) };
  const data = { product_id: id(2), site_id: id(3), causes: [{ cause_id: id(9), source_count_id: id(10), source_outcome_id: id(11), category: "terminal_variance" }],
    footprint: { cell_id: id(12), container_id: id(13), lot_id: id(8), site_id: id(3), location_id: id(14), stock_unit: "mL", channel: "available" }, meaning: { version: "synthetic-v1", text: " Preserved source meaning " }, blocked_reason: null };
  assert.equal(parseCountCauseDiscoveryReply(raw({ schema_version: 1, state: "eligible", data }), input).data.meaning?.text, data.meaning.text);
  assert.throws(() => parseCountCauseDiscoveryReply(raw({ schema_version: 1, state: "blocked", data }), input));
  assert.throws(() => parseCountCauseDiscoveryReply(raw({ schema_version: 1, state: "eligible", data: { ...data, causes: [] } }), input));
  const blocked = { ...data, causes: null, footprint: null, meaning: null, blocked_reason: "investigation_required" };
  assert.equal(parseCountCauseDiscoveryReply(raw({ schema_version: 1, state: "blocked", data: blocked }), input).state, "blocked");
  assert.throws(() => parseCountCauseDiscoveryReply(raw({ schema_version: 1, state: "empty", data: blocked }), input));
});
