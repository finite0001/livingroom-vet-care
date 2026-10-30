/** Production composition with synthetic HTTP only. No real Auth/DB/signature. */
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import "../../src/index.css";
import source from "./record-review-stock-movement-reference.json?raw";
import { createStaffRecordReviewWorkspace } from "../../src/hub/features/controlled-drugs/record-review/staff-workspace";
import { RecordReviewWorkspace } from "../../src/hub/features/controlled-drugs/record-review/RecordReviewWorkspace";
import { decodeExactJson, ExactJsonNumber, type ExactJson } from "../../src/hub/features/controlled-drugs/record-review/exact-json";
import { reviewPreparedResponseSchema } from "../../src/hub/features/controlled-drugs/record-review/prepared-packet";
import { reviewTransportDigest, type RecordReviewRequest } from "../../src/hub/features/controlled-drugs/record-review/request";
import type { ReviewStaffSessionSource } from "../../src/hub/features/controlled-drugs/record-review/staff-session";
import { sameReviewIdentity } from "../../src/hub/features/controlled-drugs/record-review/raw-rpc";
import type { ReviewQueueRequest } from "../../src/hub/features/controlled-drugs/record-review/queue-model";
const original = reviewPreparedResponseSchema.parse(decodeExactJson(new TextEncoder().encode(source)));
const packet = original.data.packet, event = packet.event, adapter = packet.adapter, auth = packet.current_authorization;
const historical = packet.obligation.historical as { readonly [key: string]: ExactJson };
const identity = { actorId: original.data.request.actor_id, sessionId: "ffffffff-ffff-4fff-8fff-ffffffffffff", generation: 1 };
const sessions: ReviewStaffSessionSource = { getSnapshot: () => identity, isCurrent: value => sameReviewIdentity(value, identity), subscribe: () => () => {}, current: async () => ({ ...identity, accessToken: "synthetic.staff.token" }) };
const summary = { event_id: event.id, event_sequence: String(event.sequence), event_kind: event.event_kind, site_basis: adapter.site_basis, site_id: adapter.site_id,
  observed_at: event.observed_at, recorded_at: event.recorded_at, review_state: "awaiting_review", deadline_state: historical.deadline_basis, deadline_basis: historical.deadline_basis,
  due_at: historical.due_at, unavailable_reason: historical.unavailable_reason, signing_state: "available", signing_reason: "none" };
const detail = { version: new ExactJsonNumber("3"), state: "detail", data: { summary, packet, terminal_review: null, escalations: [], derived_escalation_reasons: [],
  policy_id: auth.policy.id, read_eligibility_id: auth.read.id, review_eligibility_id: auth.review.id } };
function encode(value: unknown): string {
  if (value instanceof ExactJsonNumber) return value.token;
  if (Array.isArray(value)) return `[${value.map(encode).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).map(([key, child]) => `${JSON.stringify(key)}:${encode(child)}`).join(",")}}`;
  return JSON.stringify(value);
}
const respond = (value: unknown) => new Response(encode(value), { headers: { "content-type": "application/json" } });
let prepared: unknown = null, saved: unknown = null, mutations = 0, admissions = 0;
const params = new URLSearchParams(location.search);
const workspace = createStaffRecordReviewWorkspace({ projectRef: "a".repeat(20), url: `https://${"a".repeat(20)}.supabase.co`, publishableKey: "sb_publishable_synthetic" }, sessions, async (url, options) => {
  const method = String(url).split("/").at(-1), request = JSON.parse(options!.body as string).p_request;
  if (method === "list_controlled_record_reviews_v3") return respond({ version: new ExactJsonNumber("3"), state: "page", data: { items: [summary], next_cursor: null, high_water: String(event.sequence), examined: new ExactJsonNumber("1"), coverage: "bounded_page" } });
  if (method === "get_controlled_record_review_event_v3") return respond(detail);
  if (method === "get_controlled_record_review_admission_v1") {
    admissions++; document.getElementById("admissions")!.textContent = String(admissions);
    if (params.has("mismatch")) return respond({ ...detail, data: { ...detail.data, summary: { ...summary, event_sequence: "99999999999" } } });
    return respond(request.view === "detail" ? detail : prepared);
  }
  if (method === "prepare_controlled_record_review_v3") {
    mutations++; document.getElementById("mutations")!.textContent = String(mutations);
    const now = new Date().toISOString().replace(/Z$/, "000Z");
    // Exact 15-minute protocol delta, including microsecond suffix.
    prepared = { ...original, data: { ...original.data, operation_id: request.operation_id, request, transport_digest: await reviewTransportDigest(request), created_at: now,
      expires_at: new Date(Date.parse(now) + 15 * 60000).toISOString().replace(/Z$/, "000Z") } };
    return respond(prepared);
  }
  if (method === "execute_controlled_record_review_v3") {
    mutations++; document.getElementById("mutations")!.textContent = String(mutations);
    const current = (prepared as { data: { request: RecordReviewRequest; transport_digest: string } }).data;
    saved = { version: new ExactJsonNumber("3"), state: "saved", data: { operation_id: request.operation_id, receipt: { version: new ExactJsonNumber("3"), actor_id: identity.actorId,
      operation_id: request.operation_id, transport_digest: current.transport_digest, decision: current.request.decision, recorded_at: new Date().toISOString().replace(/Z$/, "000Z"), receipt_hash: "a".repeat(64) } } };
    if (params.has("unknown")) throw new Error("Synthetic loss after save"); return respond(saved);
  }
  if (method === "read_controlled_record_review_v3") return respond(saved ?? prepared);
  throw new Error("Unsupported synthetic operation");
});
const request = { product_id: packet.target.product_id, site_id: adapter.site_id, event_kind: adapter.event_kind, view: "site", page_size: 50 } as Omit<ReviewQueueRequest, "actor_id" | "cursor">;
export function Fixture() { return <main className="mx-auto max-w-4xl space-y-4 p-4"><p>Synthetic staff composition. No real login, database or signature.</p><output id="mutations" aria-label="Synthetic review mutations">{mutations}</output><output id="admissions" aria-label="Synthetic admission reads">{admissions}</output><RecordReviewWorkspace workspace={workspace} request={request} /></main>; }
createRoot(document.getElementById("root")!).render(<RouterProvider router={createBrowserRouter([{ path: "*", element: <Fixture /> }])} />);
