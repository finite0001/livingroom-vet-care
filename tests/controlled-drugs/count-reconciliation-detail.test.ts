import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCountReconciliationDetail } from "../../src/hub/features/controlled-drugs/count/count-reconciliation-detail.ts";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const request = { schema_version: 1, actor_id: id(1), product_id: id(2), site_id: id(3), reconciliation_id: id(4) };
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
function fixture() {
  return { schema_version: 1, state: "available", data: { summary: {
    product_id: id(2), site_id: id(3), reconciliation_id: id(4), preparation_id: id(5), parent_action_id: id(6), recorder_id: id(7), lot_id: id(8),
    quantity_delta: "-0.001", reason: "Synthetic correction", parent_expires_at: "2026-10-27T12:05:00.000000Z", approval_id: null, execution_id: null,
    confirmation_id: null, history_state: "prepared", current_state: "current", target_cause_ids: [id(9)],
  }, prepared_at: "2026-10-27T12:00:00.000000Z", recorder_name: "Synthetic preparer", stock_unit: "mL",
  meaning: { version: "synthetic-v1", text: " Captured wording stays exact " }, target_causes: [{ cause_id: id(9), source_count_id: id(10), source_outcome_id: id(11) }],
  before_quantity: "99999999999.999", proposed_after_quantity: "99999999999.998" } };
}
test("correction details retain exact thousandths, captured wording and complete cause references", () => {
  const value = parseCountReconciliationDetail(bytes(fixture()), request);
  assert.equal(value.data.proposed_after_quantity, "99999999999.998"); assert.equal(value.data.meaning.text, " Captured wording stays exact ");
  assert.ok(Object.isFrozen(value.data.target_causes[0]));
});
test("correction details reject rounding, changed scope, source omission and hidden extras", () => {
  for (const change of [
    f => { f.data.proposed_after_quantity = "99999999999.999"; }, f => { f.data.before_quantity = "99999999999.9990"; },
    f => { f.data.target_causes[0].cause_id = id(20); }, f => { f.data.target_causes = []; },
    f => { f.data.summary.product_id = id(20); }, f => { f.data.prepared_at = "2026-10-27T12:06:00.000000Z"; },
    f => { f.data.actual_after_quantity = "99999999999.998"; }, f => { f.data.proposed_after_quantity = -1; },
  ]) { const value = fixture(); change(value); assert.throws(() => parseCountReconciliationDetail(bytes(value), request)); }
});
