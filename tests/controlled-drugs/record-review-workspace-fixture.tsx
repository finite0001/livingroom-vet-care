/** DTO-only browser controls. This supplies no real Auth or backend authority. */
import { createRoot } from "react-dom/client";
import { useState } from "react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import source from "./record-review-stock-movement-reference.json?raw";
import { RecordReviewWorkspace } from "../../src/hub/features/controlled-drugs/record-review/RecordReviewWorkspace";
import { createReviewWorkspace } from "../../src/hub/features/controlled-drugs/record-review/workspace";
import { createReviewLifecycle } from "../../src/hub/features/controlled-drugs/record-review/lifecycle";
import { browserReviewPointerStore } from "../../src/hub/features/controlled-drugs/record-review/recovery-pointer";
import { decodeExactJson, ExactJsonNumber, type ExactJson } from "../../src/hub/features/controlled-drugs/record-review/exact-json";
import { reviewRequiredPacketSchema } from "../../src/hub/features/controlled-drugs/record-review/prepared-packet";
import { verifyProspectiveStockMovement } from "../../src/hub/features/controlled-drugs/record-review/prospective-stock-movement";
import { sameReviewIdentity, type ReviewIdentity } from "../../src/hub/features/controlled-drugs/record-review/raw-rpc";
import type { ReviewStaffSessionSource } from "../../src/hub/features/controlled-drugs/record-review/staff-session";
import type { ReviewQueueRequest } from "../../src/hub/features/controlled-drugs/record-review/queue-model";
import { Button } from "../../src/components/ui/button";
import "../../src/index.css";

interface EvidenceObject { [key: string]: ExactJson }
const object = (value: ExactJson) => value as EvidenceObject;
const original = object(decodeExactJson(new TextEncoder().encode(source)));
const packet = object(object(original.data).packet), event = object(packet.event), adapter = object(packet.adapter);
const auth = object(packet.current_authorization), historical = object(object(packet.obligation).historical);
let identity: ReviewIdentity | null = { actorId: String(object(auth.read).actor_id),
  sessionId: "ffffffff-ffff-4fff-8fff-ffffffffffff", generation: 1 };
const listeners = new Set<() => void>(), counts = { list: 0, detail: 0, mutation: 0 };
const sessions: ReviewStaffSessionSource = { getSnapshot: () => identity, isCurrent: current => sameReviewIdentity(current, identity),
  subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; }, async current() { return null; } };
const summary = { event_id: event.id, event_sequence: String(event.sequence), event_kind: event.event_kind, site_basis: adapter.site_basis,
  site_id: adapter.site_id, observed_at: event.observed_at, recorded_at: event.recorded_at, review_state: "awaiting_review",
  deadline_state: historical.deadline_basis, deadline_basis: historical.deadline_basis, due_at: historical.due_at,
  unavailable_reason: historical.unavailable_reason, signing_state: "available", signing_reason: "none" };
const page = { version: new ExactJsonNumber("3"), state: "page", data: { items: [summary], next_cursor: null,
  high_water: String(event.sequence), examined: new ExactJsonNumber("1"), coverage: "bounded_page" } };
const detail = { version: new ExactJsonNumber("3"), state: "detail", data: { summary, packet, terminal_review: null,
  escalations: [], derived_escalation_reasons: [], policy_id: object(auth.policy).id,
  read_eligibility_id: object(auth.read).id, review_eligibility_id: object(auth.review).id } };
const model = createReviewLifecycle({ pointers: browserReviewPointerStore(),
  rpc: { async call() { counts.mutation++; throw new Error("Mutations are forbidden in this DTO fixture"); } },
  evidence: { validate: verifyProspectiveStockMovement } });
const workspace = createReviewWorkspace({ sessions, model,
  reads: { async call(method) {
    if (method === "list_controlled_record_reviews_v3") { counts.list++; return page as ExactJson; }
    counts.detail++; return detail as ExactJson;
  } },
  evidence: { async validate(result, request) {
    if (result.state !== "detail") throw new Error("Complete scalar DTO required");
    await verifyProspectiveStockMovement(reviewRequiredPacketSchema.parse(result.data.packet), request);
  } } });
const request = { product_id: String(object(packet.target).product_id), site_id: String(adapter.site_id),
  event_kind: String(event.event_kind), view: "site", page_size: 1 } as Omit<ReviewQueueRequest, "actor_id" | "cursor">;
declare global { interface Window { __LRV_WORKSPACE_COUNTS__: () => Readonly<typeof counts>; __LRV_WORKSPACE_END_SESSION__: () => void; __LRV_WORKSPACE_CHANGE_SCOPE__: () => void } }
window.__LRV_WORKSPACE_COUNTS__ = () => ({ ...counts });
window.__LRV_WORKSPACE_END_SESSION__ = () => { identity = null; for (const listener of listeners) listener(); };
export function Fixture() {
  const [scope, setScope] = useState(request);
  window.__LRV_WORKSPACE_CHANGE_SCOPE__ = () => setScope({ ...request, site_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" });
  return <main className="mx-auto max-w-4xl space-y-6 p-4 md:p-8">
  <p className="text-sm text-muted-foreground">Synthetic DTO controls · no real staff login or signing</p>
  <Button type="button" variant="outline" className="min-h-11" onClick={window.__LRV_WORKSPACE_END_SESSION__}>End synthetic staff session</Button>
  <RecordReviewWorkspace workspace={workspace} request={scope} />
</main>;
}
const router = createMemoryRouter([{ path: "/", element: <Fixture /> }]);
createRoot(document.getElementById("root")!).render(<RouterProvider router={router} />);
