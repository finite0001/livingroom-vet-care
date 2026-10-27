/** Synthetic client/browser test. No Auth server, database or physical stock. */
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import "../../src/index.css";
import { CountWorkspace } from "../../src/hub/features/controlled-drugs/count/CountWorkspace";
import { createCountClient } from "../../src/hub/features/controlled-drugs/count/count-client";
import { browserCountOperationLock, createCountOperationController } from "../../src/hub/features/controlled-drugs/count/count-operation-controller";
import { digestCountOperationClosureReply } from "../../src/hub/features/controlled-drugs/count/count-operation-closure";
import { digestCountReceipt, digestCountRequest } from "../../src/hub/features/controlled-drugs/count/count-wire";
import { parseCountRequest, type CountFinalizeReceipt, type CountStatementRequest, type CountStatementReceipt } from "../../src/hub/features/controlled-drugs/count/count-request-schema";
import type { ReviewIdentity } from "../../src/hub/features/controlled-drugs/record-review/raw-rpc";
import type { ReviewStaffSessionSource } from "../../src/hub/features/controlled-drugs/record-review/staff-session";
import { id, syntheticCount } from "./count-entry-fixture";

const listeners = new Set<() => void>();
let identity: ReviewIdentity | null = Object.freeze({ actorId: id(1), sessionId: id(90), generation: 1 });
const sessions: ReviewStaffSessionSource = {
  getSnapshot: () => identity, subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  current: async () => identity ? { ...identity, accessToken: "synthetic.test.token" } : null,
  isCurrent: who => identity?.actorId === who.actorId && identity.sessionId === who.sessionId && identity.generation === who.generation,
};
let calls = 0, statement: CountStatementRequest | null = null, receipt: CountStatementReceipt | null = null;
let staleOutcomeId: string | null = null;
const respond = (value: unknown) => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
const data = () => {
  const value = syntheticCount();
  return { ...value, read_at: "2026-10-27T23:00:00.000000Z", current_boundary_state: new URLSearchParams(location.search).has("stale") ? "changed" : "unchanged",
    history_state: staleOutcomeId ? "stale" : "collecting", terminal: staleOutcomeId ? { kind: "outcome", id: staleOutcomeId, history_state: "stale", recorded_at: "2026-10-26T23:00:00.000000Z", actor: { id: id(1), name: "Observer A" }, reason: null } : null,
    participants: value.participants.map(person => ({ ...person, submitted: person.id === statement?.actor_id })),
    own_statement: statement?.actor_id === identity?.actorId ? { slot: "A", actor: { id: id(1), name: "Observer A" }, request: statement,
      recorded_at: "2026-10-26T23:00:00.000000Z", receipt } : null };
};
const client = createCountClient({ projectRef: "a".repeat(20), url: `https://${"a".repeat(20)}.supabase.co`, publishableKey: "sb_publishable_synthetic" }, sessions, async (url, options) => {
  const name = String(url).split("/").at(-1), request = JSON.parse(options!.body as string).p_request;
  if (name === "discover_controlled_counts_v1") return respond({ schema_version: 1, product_id: id(30), site_id: id(31),
    capabilities: { observe: true, manage: true, reconciliation_prepare: false, reconciliation_approve: false, reconciliation_execute: false, reconciliation_confirm: false, cause_resolve: false },
    available_actions: ["start", "statement", "finalize", "cancel", "read", "recover", "operation_closure", "discovery"], observers: [{ id: id(1), name: "Observer A" }, { id: id(2), name: "Observer B" }],
    counts: [{ count_id: id(10), captured_at: data().captured_at, history_state: "open", participants: data().participants }], next_cursor: null, has_more: false });
  if (name === "read_controlled_count_v1") return respond({ schema_version: 1, state: "available", data: data() });
  if (name === "save_controlled_count_statement_v1") {
    calls++; document.getElementById("calls")!.textContent = String(calls);
    if (new URLSearchParams(location.search).has("unknown")) throw new Error("Synthetic lost save response");
    statement = parseCountRequest("statement", request);
    const unsigned: CountStatementReceipt = { schema_version: 1, action: "statement", actor_id: statement.actor_id, operation_id: statement.operation_id, count_id: statement.count_id,
      result_ref: { kind: "statement", id: statement.statement_id, opaque_commitment: "a".repeat(64) }, request_digest: await digestCountRequest("statement", statement), receipt_digest: "0".repeat(64) };
    receipt = { ...unsigned, receipt_digest: await digestCountReceipt(unsigned) };
    return respond(receipt);
  }
  if (name === "finalize_controlled_count_v1") {
    calls++; document.getElementById("calls")!.textContent = String(calls);
    const q = parseCountRequest("finalize", request); staleOutcomeId = q.outcome_id;
    const unsigned: CountFinalizeReceipt = { schema_version: 1, action: "finalize", actor_id: q.actor_id, operation_id: q.operation_id, count_id: q.count_id,
      result_ref: { kind: "outcome", id: q.outcome_id, opaque_commitment: "a".repeat(64) }, request_digest: await digestCountRequest("finalize", q), receipt_digest: "0".repeat(64) };
    return respond({ ...unsigned, receipt_digest: await digestCountReceipt(unsigned) });
  }
  if (name === "read_controlled_count_operation_closure_v1" || name === "close_controlled_count_operation_v1") {
    const result = { ...request, action: "operation_closure", state: name.startsWith("close") ? "abandoned" : "pending", receipt: null, receipt_digest: "0".repeat(64) };
    return respond({ ...result, receipt_digest: await digestCountOperationClosureReply(result) });
  }
  throw new Error("Unsupported synthetic test action");
});
const operations = createCountOperationController(client, localStorage, browserCountOperationLock());
export function Fixture() {
  return <main className="mx-auto min-w-0 max-w-3xl space-y-4 p-4"><p>Synthetic workspace only. No real login, database or physical count.</p>
    <button onClick={() => { identity = Object.freeze({ actorId: id(2), sessionId: id(91), generation: 2 }); listeners.forEach(listener => listener()); }}>Switch synthetic staff login</button>
    <output id="calls" aria-label="Synthetic mutation calls">{calls}</output>
    <CountWorkspace sessions={sessions} client={client} operations={operations} scope={{ product_id: id(30), site_id: id(31), product_name: "Synthetic medication", site_label: "Synthetic clinic" }} />
  </main>;
}
createRoot(document.getElementById("root")!).render(<RouterProvider router={createBrowserRouter([{ path: "*", element: <Fixture /> }])} />);
