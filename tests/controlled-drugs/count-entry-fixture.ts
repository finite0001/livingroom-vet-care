/** Synthetic display data only; never authorizes a physical count or backend. */
import { parseCountReadReply } from "../../src/hub/features/controlled-drugs/count/count-read-wire.ts";
import { verifyCountReadReply } from "../../src/hub/features/controlled-drugs/count/count-read-wire.ts";
import { digestCountReceipt, digestCountRequest } from "../../src/hub/features/controlled-drugs/count/count-wire.ts";

export const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
export function syntheticCount() {
  const reply = { schema_version: 1, state: "available", data: {
    count_id: id(10), snapshot_id: id(11), product: { id: id(30), name: "Synthetic medication", stock_unit: "mL" },
    site: { id: id(31), label: "Synthetic clinic" }, locations: [{ id: id(23), kind: "storage", label: "Medication safe" }],
    lots: [{ id: id(22), lot_number: "SYNTHETIC", expires_on: "2027-12-31" }],
    units: [{ cell_id: id(20), container_id: id(21), lot_id: id(22), channel: "available", dispense_id: null, allocation_id: null, intake_id: null,
      stock_unit: "mL", location_id: id(23), custodian_id: null, status: "onsite" }],
    containers: [{ container_id: id(21), kind: "stock", label: "Synthetic bottle", stock_unit: "mL", location_id: id(23), custodian_id: null, status: "onsite" }],
    participants: [{ slot: "A", id: id(1), name: "Observer A", submitted: false }, { slot: "B", id: id(2), name: "Observer B", submitted: false }],
    captured_policy: { id: id(32), version: "1", meaning_version: "count-v1", meaning_text: "Synthetic observation fixture" },
    captured_at: "2026-10-26T10:00:00.000000Z", history_state: "collecting", current_boundary_state: "unchanged", own_statement: null,
    statements: null, expected: null, comparison: null, terminal: null, read_at: "2026-10-26T11:00:00.000000Z",
  } };
  return parseCountReadReply(new TextEncoder().encode(JSON.stringify(reply)), { schema_version: 1, actor_id: id(1), count_id: id(10) }).data;
}
export const identity = { actor_id: id(1), count_id: id(10), snapshot_id: id(11), operation_id: id(40), statement_id: id(41) };

export async function syntheticComparedCount() {
  const data = syntheticCount();
  const statements = (["A", "B"] as const).map((slot, index) => ({ slot, actor: { id: id(index + 1), name: `Observer ${slot}` }, recorded_at: "2026-10-26T10:02:00.000000Z", request: {
    schema_version: 1 as const, actor_id: id(index + 1), count_id: id(10), snapshot_id: id(11), operation_id: id(40 + index), statement_id: id(50 + index),
    observed_at: "2026-10-26T10:01:00.000000Z", method: "manual_count" as const,
    quantities: [{ cell_id: id(20), quantity: "11.125" }], container_checks: [{ container_id: id(21), presence: "present" as const }], findings: [],
  } }));
  const receipt = { schema_version: 1 as const, action: "statement" as const, actor_id: id(1), count_id: id(10), operation_id: id(40),
    result_ref: { kind: "statement" as const, id: id(50), opaque_commitment: "a".repeat(64) }, request_digest: await digestCountRequest("statement", statements[0].request), receipt_digest: "0".repeat(64) };
  receipt.receipt_digest = await digestCountReceipt(receipt);
  const reply = { schema_version: 1, state: "available", data: { ...data,
    participants: data.participants.map(person => ({ ...person, submitted: true })), statements,
    own_statement: { ...statements[0], receipt }, expected: [{ cell_id: id(20), quantity: "12.000", stock_unit: "mL" }],
    comparison: { agreement: false, quantity_comparison: [{ cell_id: id(20), stock_unit: "mL", expected_quantity: "12.000", actor_a_quantity: "11.125", actor_b_quantity: "11.125", actor_a_matches_expected: false, actor_b_matches_expected: false, statements_match: true }],
      container_comparison: [{ container_id: id(21), actor_a_presence: "present", actor_b_presence: "present" }], finding_counts: { a: 0, b: 0 } },
  } };
  return (await verifyCountReadReply(new TextEncoder().encode(JSON.stringify(reply)), { schema_version: 1, actor_id: id(1), count_id: id(10) })).data;
}
