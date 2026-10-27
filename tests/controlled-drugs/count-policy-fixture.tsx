/** Synthetic browser policy inputs only; never real staff or clinic settings. */
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Link, RouterProvider } from "react-router-dom";
import "../../src/index.css";
import { CountPolicyWorkspace } from "../../src/hub/features/controlled-drugs/count/CountPolicyWorkspace";
import { createCountClient } from "../../src/hub/features/controlled-drugs/count/count-client";
import { browserCountOperationLock, createCountOperationController } from "../../src/hub/features/controlled-drugs/count/count-operation-controller";
import { parseCountPolicyPublishRequest, type CountConfiguredPolicy } from "../../src/hub/features/controlled-drugs/count/count-admin-schema";
import { digestCountPolicyClosure, digestCountPolicyReceipt, digestCountPolicyRequest } from "../../src/hub/features/controlled-drugs/count/count-policy-wire";
import type { ReviewStaffSessionSource } from "../../src/hub/features/controlled-drugs/record-review/staff-session";
import { id } from "./count-entry-fixture";
const identity = Object.freeze({ actorId: id(1), sessionId: id(90), generation: 1 });
const sessions: ReviewStaffSessionSource = { getSnapshot: () => identity, subscribe: () => () => {}, current: async () => ({ ...identity, accessToken: "synthetic.policy.token" }),
  isCurrent: who => who.actorId === identity.actorId && who.sessionId === identity.sessionId && who.generation === identity.generation };
let policy: CountConfiguredPolicy | null = null, calls = 0;
const respond = (value: unknown) => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
const client = createCountClient({ projectRef: "a".repeat(20), url: `https://${"a".repeat(20)}.supabase.co`, publishableKey: "sb_publishable_synthetic" }, sessions, async (url, options) => {
  const name = String(url).split("/").at(-1), input = JSON.parse(options!.body as string).p_request;
  if (name === "read_controlled_count_policy_v1") return respond({ schema_version: 1, state: policy ? "configured" : "unconfigured", data: { product_id: id(30), site_id: id(31), policy } });
  if (name === "publish_controlled_count_policy_v1") {
    calls++; document.getElementById("calls")!.textContent = String(calls);
    if (new URLSearchParams(location.search).has("unknown")) throw new Error("Synthetic lost publication");
    const request = parseCountPolicyPublishRequest(input);
    policy = { policy_id: request.operation_id, version: "1", prior_policy_id: null, actor: { id: id(1), name: "Synthetic administrator" }, recorded_at: "2026-10-26T23:00:00.000000Z", settings: request.settings };
    const receipt = { schema_version: 1, action: "policy_publish", actor_id: request.actor_id, operation_id: request.operation_id, product_id: request.product_id, site_id: request.site_id,
      request_digest: await digestCountPolicyRequest(request), result_ref: { kind: "policy", id: request.operation_id, version: "1" }, receipt_digest: "0".repeat(64) };
    return respond({ ...receipt, receipt_digest: await digestCountPolicyReceipt(receipt) });
  }
  if (name === "read_controlled_count_operation_closure_v2" || name === "close_controlled_count_operation_v2") {
    const value = { ...input, action: "operation_closure", state: name.startsWith("close") ? "abandoned" : "pending", receipt: null, receipt_digest: "0".repeat(64) };
    return respond({ ...value, receipt_digest: await digestCountPolicyClosure(value) });
  }
  throw new Error("Unsupported synthetic policy operation");
});
const operations = createCountOperationController(client, localStorage, browserCountOperationLock());
export function Fixture() {
  return <main className="mx-auto min-w-0 max-w-3xl space-y-4 p-4"><p>Synthetic administrator settings. No clinic permissions are changed.</p><Link to="/synthetic-policy-destination">Leave settings</Link>
    <output id="calls" aria-label="Synthetic publications">{calls}</output>
    <CountPolicyWorkspace sessions={sessions} identity={identity} client={client} operations={operations} productId={id(30)} siteId={id(31)} />
  </main>;
}
createRoot(document.getElementById("root")!).render(<RouterProvider router={createBrowserRouter([{ path: "*", element: <Fixture /> }])} />);
