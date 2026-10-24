/** Synthetic browser host only. No real Auth, backend or clinical signing. */
import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import { createBrowserRouter, Link, Outlet, RouterProvider } from "react-router-dom";
import { RecordReviewDialog } from "../../src/hub/features/controlled-drugs/record-review/RecordReviewDialog";
import { createReviewLifecycle } from "../../src/hub/features/controlled-drugs/record-review/lifecycle";
import { browserReviewPointerStore } from "../../src/hub/features/controlled-drugs/record-review/recovery-pointer";
import { recordReviewRequestSchema } from "../../src/hub/features/controlled-drugs/record-review/request";
import { fixture, identity, other, raw, request, syntheticEvidence } from "./record-review-lifecycle-fixture";
import "../../src/index.css";

const home = "/tests/controlled-drugs/record-review-dialog-fixture.html";
const fixtures = new Map<string, Awaited<ReturnType<typeof fixture>>>();
let calls = 0;
const makeModel = () => createReviewLifecycle({ pointers: browserReviewPointerStore(), evidence: syntheticEvidence, rpc: { async call(method, input) {
  calls++; document.querySelector("[data-testid=rpc-count]")!.textContent = String(calls);
  const req = input as { operation_id: string };
  if (method === "prepare_controlled_record_review_v3") fixtures.set(req.operation_id, await fixture(recordReviewRequestSchema.parse(input)));
  const f = fixtures.get(req.operation_id);
  if (!f) return raw({ version: 3, state: "not_found", data: { operation_id: req.operation_id } });
  return method === "execute_controlled_record_review_v3" ? f.saved() : method === "cancel_controlled_record_review_v3" ? f.cancelled() : f.prepared();
} } });
let model = makeModel();
model.setIdentity(identity);
let replaceModel = () => { throw new Error("Synthetic home is not mounted"); };
export function Home() {
  const [currentModel, setCurrentModel] = useState(model);
  useEffect(() => {
    replaceModel = () => {
      model = makeModel(); model.setIdentity({ ...identity, sessionId: other, generation: 2 }); setCurrentModel(model);
    };
    return () => { replaceModel = () => { throw new Error("Synthetic home is not mounted"); }; };
  }, []);
  return <RecordReviewDialog model={currentModel} selection={{ actor_id: request.actor_id, event_id: request.event_id,
    policy_id: request.policy_id, read_eligibility_id: request.read_eligibility_id, review_eligibility_id: request.review_eligibility_id }} />;
}
const router = createBrowserRouter([{ element: <main className="mx-auto max-w-4xl space-y-6 p-4 md:p-8">
  <aside className="space-y-2"><p>Synthetic dialog host · no real Auth or backend</p><p>Local RPC calls: <span data-testid="rpc-count">0</span></p></aside><Outlet />
</main>, children: [
  { path: home, element: <Home /> },
  { path: "/synthetic-review-away", element: <><h1>Away from synthetic review</h1><Link to={home}>Return to review</Link></> },
] }]);
Object.assign(window, {
  syntheticReviewNavigate: () => router.navigate("/synthetic-review-away"),
  syntheticReviewChangeSession: () => model.setIdentity({ ...identity, sessionId: other, generation: 2 }),
  syntheticReviewReplaceModel: () => replaceModel(),
});
createRoot(document.getElementById("root")!).render(<RouterProvider router={router} />);
