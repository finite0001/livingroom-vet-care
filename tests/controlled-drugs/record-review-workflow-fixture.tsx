/** Synthetic local browser transport. No real Auth/backend/provider acceptance. */
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { Button } from "../../src/components/ui/button";
import { RecordReviewWorkflow } from "../../src/hub/features/controlled-drugs/record-review/RecordReviewWorkflow";
import { createReviewLifecycle } from "../../src/hub/features/controlled-drugs/record-review/lifecycle";
import { browserReviewPointerStore } from "../../src/hub/features/controlled-drugs/record-review/recovery-pointer";
import { recordReviewRequestSchema } from "../../src/hub/features/controlled-drugs/record-review/request";
import { fixture, identity, other, raw, request, syntheticEvidence } from "./record-review-lifecycle-fixture";
import "../../src/index.css";
const fixtures = new Map<string, Awaited<ReturnType<typeof fixture>>>();
let drop = false, notFound = false, calls = 0, failCleanup = false, pauseCleanup = false;
let rejectCleanup: ((error: Error) => void) | null = null;
const browserPointers = browserReviewPointerStore();
const model = createReviewLifecycle({ pointers: { ...browserPointers, async resolve(pointer, outcome) {
  if (pauseCleanup) await new Promise<void>((_resolve, reject) => { rejectCleanup = reject; });
  if (failCleanup) throw new Error("Synthetic cleanup unavailable");
  return browserPointers.resolve(pointer, outcome);
} }, evidence: syntheticEvidence, rpc: { async call(method, input) {
  calls++; document.querySelector("[data-testid=rpc-count]")!.textContent = String(calls);
  const req = input as { operation_id: string };
  if (method === "prepare_controlled_record_review_v3") fixtures.set(req.operation_id, await fixture(recordReviewRequestSchema.parse(input)));
  if (drop) { drop = false; throw new Error("Synthetic response loss after request"); }
  const f = fixtures.get(req.operation_id);
  if (method === "read_controlled_record_review_v3" && (notFound || !f)) return raw({ version: 3, state: "not_found", data: { operation_id: req.operation_id } });
  if (!f) throw new Error("No synthetic server record in this tab");
  return method === "execute_controlled_record_review_v3" ? f.saved() : method === "cancel_controlled_record_review_v3" ? f.cancelled() : f.prepared();
} } });
model.setIdentity(identity);
export function Fixture() {
  const [sessionChanged, setSessionChanged] = useState(false);
  const [selectionAvailable, setSelectionAvailable] = useState(true), [selectedEvent, setSelectedEvent] = useState(request.event_id);
  const [draftDirty, setDraftDirty] = useState(false);
  return <main className="mx-auto max-w-4xl space-y-6 p-4 md:p-8">
    <aside aria-label="Synthetic test controls" className="space-y-3 rounded-xl border bg-muted p-4 text-sm">
      <p>Synthetic staff workflow · no real Auth, backend or clinical signing</p>
      <p>Local RPC calls: <span data-testid="rpc-count">0</span></p>
      <p>Local draft guard: <span data-testid="draft-dirty">{draftDirty ? "dirty" : "clean"}</span></p>
      <div className="flex flex-wrap gap-3">
        <Button variant="outline" className="min-h-11" onClick={() => { drop = true; }}>Lose next response</Button>
        <Button variant="outline" className="min-h-11" onClick={() => { notFound = true; }}>Return not found on recovery</Button>
        <Button variant="outline" className="min-h-11" onClick={() => { failCleanup = true; }}>Fail recovery cleanup</Button>
        <Button variant="outline" className="min-h-11" onClick={() => { pauseCleanup = true; }}>Pause cleanup retry</Button>
        <Button variant="outline" className="min-h-11" onClick={() => { rejectCleanup?.(new Error("Synthetic delayed cleanup failure")); }}>Reject paused cleanup</Button>
        <Button variant="outline" className="min-h-11" onClick={() => { setSelectionAvailable(value => !value); }}>Toggle record selection</Button>
        <Button variant="outline" className="min-h-11" onClick={() => { setSelectedEvent(other); }}>Select another synthetic record</Button>
        <Button variant="outline" className="min-h-11" onClick={() => {
          model.setIdentity({ ...identity, sessionId: other, generation: 2 }); setSessionChanged(true);
        }}>Change synthetic session</Button>
      </div>
      {sessionChanged && <p>New synthetic session selected.</p>}
    </aside>
    <RecordReviewWorkflow model={model} selection={selectionAvailable ? { actor_id: request.actor_id, event_id: selectedEvent, policy_id: request.policy_id,
      read_eligibility_id: request.read_eligibility_id, review_eligibility_id: request.review_eligibility_id } : null} onDraftDirtyChange={setDraftDirty} />
  </main>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
