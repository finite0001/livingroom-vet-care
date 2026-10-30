/** Synthetic browser controls. No real Auth, database, authority or stock. */
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider, Link } from "react-router-dom";
import "../../src/index.css";
import { CountCorrectionWorkspace } from "../../src/hub/features/controlled-drugs/count/CountCorrectionWorkspace";
import { createCountClient } from "../../src/hub/features/controlled-drugs/count/count-client";
import { createCountOperationController, browserCountOperationLock } from "../../src/hub/features/controlled-drugs/count/count-operation-controller";
import { digestCountManagementRequest, digestCountManagementReceipt } from "../../src/hub/features/controlled-drugs/count/count-management-wire";
import { parseCountManagementRequest } from "../../src/hub/features/controlled-drugs/count/count-management-schema";
import { digestCountOperationClosureReply } from "../../src/hub/features/controlled-drugs/count/count-operation-closure";
import { syntheticComparedCount, id } from "./count-entry-fixture";
import type { ReviewStaffSessionSource } from "../../src/hub/features/controlled-drugs/record-review/staff-session";
const identity = { actorId: id(3), sessionId: id(90), generation: 1 };
const sessions: ReviewStaffSessionSource = { getSnapshot: () => identity, isCurrent: value => value.actorId === identity.actorId && value.sessionId === identity.sessionId && value.generation === identity.generation,
  subscribe: () => () => {}, current: async () => ({ ...identity, accessToken: "synthetic.test.token" }) };
const scope = { schema_version: 1, product_id: id(30), site_id: id(31) };
const params = new URLSearchParams(location.search), unknown = params.has("unknown"), stage = params.get("stage") ?? "prepared";
let mutations = 0;
const summary = { product_id: id(30), site_id: id(31), reconciliation_id: id(60), preparation_id: id(61), parent_action_id: id(62), recorder_id: id(4), lot_id: id(22), quantity_delta: "-0.875", reason: "Synthetic proposal",
  parent_expires_at: "2026-10-27T12:05:00.000000Z", approval_id: stage === "prepared" ? null : id(63), execution_id: stage === "executed" || stage === "confirmed" ? id(64) : null,
  confirmation_id: stage === "confirmed" ? id(65) : null, history_state: stage, current_state: "current", target_cause_ids: [id(70)] };
const respond = (value: unknown) => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
const count = async () => { const value = await syntheticComparedCount(); return { ...value, own_statement: null, history_state: "variance", terminal: { kind: "outcome", id: id(71), history_state: "variance", recorded_at: "2026-10-26T10:03:00.000000Z", actor: { id: id(1), name: "Observer A" }, reason: null } }; };
const freshCount = async () => {
  const value = await syntheticComparedCount();
  return { ...value, count_id: id(12), snapshot_id: id(13), own_statement: null, captured_at: "2026-10-27T11:00:00.000000Z", read_at: "2026-10-27T12:00:00.000000Z", history_state: "agreement",
    statements: value.statements!.map(statement => ({ ...statement, recorded_at: "2026-10-27T11:02:00.000000Z", request: { ...statement.request, count_id: id(12), snapshot_id: id(13), observed_at: "2026-10-27T11:01:00.000000Z", quantities: [{ cell_id: id(20), quantity: "12.000" }] } })),
    comparison: { ...value.comparison!, agreement: true, quantity_comparison: value.comparison!.quantity_comparison.map(row => ({ ...row, actor_a_quantity: "12.000", actor_b_quantity: "12.000", actor_a_matches_expected: true, actor_b_matches_expected: true })) },
    terminal: { kind: "outcome", id: id(72), history_state: "agreement", recorded_at: "2026-10-27T11:03:00.000000Z", actor: { id: id(1), name: "Observer A" }, reason: null },
  };
};
async function countPage(cursor: unknown) {
  if (!params.has("paged") || cursor) return { counts: [{ count_id: id(12), captured_at: "2026-10-27T11:00:00.000000Z", history_state: "agreement", participants: (await freshCount()).participants }], next_cursor: null, has_more: false };
  const participants = (await freshCount()).participants.map(person => ({ ...person, submitted: false }));
  const counts = Array.from({ length: 100 }, (_, index) => ({ count_id: id(100 + index), captured_at: new Date(Date.parse("2026-10-27T11:30:00.000Z") - index * 1000).toISOString().replace(/Z$/, "000Z"), history_state: "cancelled", participants }));
  return { counts, next_cursor: { captured_at: counts[99].captured_at, count_id: counts[99].count_id }, has_more: true };
}
const client = createCountClient({ projectRef: "a".repeat(20), url: `https://${"a".repeat(20)}.supabase.co`, publishableKey: "sb_publishable_synthetic" }, sessions, async (url, options) => {
  const name = String(url).split("/").at(-1), request = JSON.parse(options!.body as string).p_request;
  if (name === "discover_controlled_counts_v1") return respond({ ...scope, capabilities: { observe: false, manage: true, reconciliation_prepare: true, reconciliation_approve: true, reconciliation_execute: false, reconciliation_confirm: true, cause_resolve: true },
    available_actions: ["read", "discovery", "operation_closure", "management_read", "management_recover", "reconciliation_prepare", "reconciliation_approve", "reconciliation_confirm", "cause_resolve"], observers: [], ...await countPage(request.cursor) });
  if (name === "list_controlled_count_investigations_v1") return respond({ ...scope, items: [{ cause_id: id(70), source_count_id: id(10), history_state: "variance", recorded_at: "2026-10-26T10:03:00.000000Z" }], other_scope_causes: true, next_cursor: null, has_more: false });
  if (name === "list_controlled_count_reconciliations_v1") return respond({ ...scope, items: [{ ...summary, prepared_at: "2026-10-27T12:00:00.000000Z", recorder_name: "Synthetic preparer", available_actions: stage === "prepared" ? ["management_read", "reconciliation_approve"] : stage === "executed" ? ["management_read", "reconciliation_confirm"] : ["management_read"] }], next_cursor: null, has_more: false });
  if (name === "read_controlled_count_reconciliation_detail_v1") return respond({ schema_version: 1, state: "available", data: { summary, prepared_at: "2026-10-27T12:00:00.000000Z", recorder_name: "Synthetic preparer", stock_unit: "mL", meaning: { version: "synthetic-v1", text: "Synthetic correction wording" },
    target_causes: [{ cause_id: id(70), source_count_id: id(10), source_outcome_id: id(71) }], before_quantity: "12.000", proposed_after_quantity: "11.125" } });
  if (name === "read_controlled_count_v1") return respond({ schema_version: 1, state: "available", data: request.count_id === id(12) ? await freshCount() : await count() });
  if (name === "discover_controlled_count_causes_v1") return respond({ schema_version: 1, state: "eligible", data: { product_id: id(30), site_id: id(31), causes: [{ cause_id: id(70), source_count_id: id(10), source_outcome_id: id(71), category: "terminal_variance" }],
    footprint: { cell_id: id(20), container_id: id(21), lot_id: id(22), site_id: id(31), location_id: id(23), stock_unit: "mL", channel: "available" }, meaning: { version: "synthetic-v1", text: "Synthetic correction wording" }, blocked_reason: null } });
  if (name === "resolve_controlled_count_cause_v1") {
    mutations++; document.getElementById("calls")!.textContent = String(mutations);
    const q = parseCountManagementRequest("cause_resolve", request);
    if (q.evidence.kind !== "reconciled_available" || q.evidence.confirmation_id !== id(65) || q.evidence.post_count_id !== id(12)) throw new Error("Synthetic resolution evidence differs");
    const receipt = { ...scope, actor_id: q.actor_id, operation_id: q.operation_id, action: "cause_resolve", result_ref: { kind: "cause_resolution", id: q.resolution_id, opaque_commitment: "a".repeat(64) }, request_digest: await digestCountManagementRequest("cause_resolve", q), receipt_digest: "0".repeat(64) };
    return respond({ ...receipt, receipt_digest: await digestCountManagementReceipt(receipt) });
  }
  if (name === "approve_controlled_count_reconciliation_v1") {
    mutations++; document.getElementById("calls")!.textContent = String(mutations);
    if (unknown) throw new Error("Synthetic lost response");
    const q = parseCountManagementRequest("reconciliation_approve", request);
    const receipt = { ...scope, actor_id: q.actor_id, operation_id: q.operation_id, action: "reconciliation_approve", result_ref: { kind: "reconciliation_approval", id: q.approval_id, opaque_commitment: "a".repeat(64) }, request_digest: await digestCountManagementRequest("reconciliation_approve", q), receipt_digest: "0".repeat(64) };
    return respond({ ...receipt, receipt_digest: await digestCountManagementReceipt(receipt) });
  }
  if (name === "read_controlled_count_operation_closure_v1" || name === "close_controlled_count_operation_v1") {
    const reply = { ...request, action: "operation_closure", state: name.startsWith("close") ? "abandoned" : "pending", receipt: null, receipt_digest: "0".repeat(64) };
    return respond({ ...reply, receipt_digest: await digestCountOperationClosureReply(reply) });
  }
  throw new Error("Unsupported synthetic method");
});
const operations = createCountOperationController(client, localStorage, browserCountOperationLock());
export function Fixture() { return <main className="mx-auto min-w-0 max-w-4xl space-y-4 p-4"><p>Synthetic correction controls only.</p><Link to="/away">Leave synthetic correction</Link><output id="calls" aria-label="Synthetic mutations">{mutations}</output>
  <CountCorrectionWorkspace sessions={sessions} identity={identity} client={client} operations={operations} productId={id(30)} siteId={id(31)} />
</main>; }
createRoot(document.getElementById("root")!).render(<RouterProvider router={createBrowserRouter([{ path: "/away", element: <p>Away</p> }, { path: "*", element: <Fixture /> }])} />);
