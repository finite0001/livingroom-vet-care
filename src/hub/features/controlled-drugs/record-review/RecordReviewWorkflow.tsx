import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { displayReviewEvidence } from "./display-evidence.ts";
import { summarizePreparedReview } from "./review-summary.ts";
import { reviewMeaningText } from "./prepared-packet.ts";
import { recordReviewRequestSchema, type RecordReviewRequest } from "./request.ts";
import type { createReviewLifecycle } from "./lifecycle.ts";

export interface RecordReviewSelection {
  actor_id: string;
  event_id: string;
  policy_id: string;
  read_eligibility_id: string;
  review_eligibility_id: string;
}
export interface RecordReviewWorkflowProps {
  model: ReturnType<typeof createReviewLifecycle>;
  /** Accepted server-issued detail selection. Not arbitrary client permissions. */
  selection: Readonly<RecordReviewSelection>;
  /** Presentation only: permits the host to warn before discarding local edits. */
  onDraftDirtyChange?(dirty: boolean): void;
}
const sections = {
  target: "Original record identity", adapter: "Source provenance", event: "Original event",
  parent_preparation: "Original preparation", original_result: "Original result", clinical_snapshot: "Historical clinical details",
  source_rows: "Retained source records", event_lines: "Event lines", cells: "Stock cells", transitions: "Container transitions",
  containers: "Identified containers", obligation: "Review requirement and deadline evidence", current_authorization: "Current review permissions",
};
// Presentation identities only. Equal Auth revisions on different model objects
// must never preserve one model's unsubmitted reason in another model's form.
const formModels = new WeakMap<RecordReviewWorkflowProps["model"], number>();
let nextFormModel = 0;
function formModelKey(model: RecordReviewWorkflowProps["model"]) {
  if (!formModels.has(model)) formModels.set(model, ++nextFormModel);
  return `${formModels.get(model)}:${model.getIdentityRevision()}`;
}

interface ReviewDraftFormProps {
  prepare(decision: "approve" | "reject", reason: string): boolean;
  onDirtyChange?(dirty: boolean): void;
}
function ReviewDraftForm({ prepare, onDirtyChange }: ReviewDraftFormProps) {
  const id = useId(), [decision, setDecision] = useState<"approve" | "reject">("approve"), [reason, setReason] = useState("");
  return <form className="space-y-4" onSubmit={event => { event.preventDefault(); if (prepare(decision, reason)) { setReason(""); setDecision("approve"); onDirtyChange?.(false); } }}>
      <fieldset className="space-y-2"><legend className="font-medium">Your decision</legend>
        <div className="flex flex-wrap gap-3">{(["approve", "reject"] as const).map(value => <label key={value}
          className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border bg-card px-3">
          <input type="radio" name={`${id}-decision`} value={value} checked={decision === value} onChange={() => { setDecision(value); onDirtyChange?.(value !== "approve" || reason !== ""); }} />
          {value === "approve" ? "Approve the record" : "Reject the record"}
        </label>)}</div>
      </fieldset>
      <div className="space-y-2"><Label htmlFor={`${id}-reason`}>Review reason</Label>
        <Textarea id={`${id}-reason`} value={reason} onChange={event => { setReason(event.target.value); onDirtyChange?.(decision !== "approve" || event.target.value !== ""); }} rows={4} required
          aria-describedby={`${id}-reason-help`} className="min-h-28" />
        <p id={`${id}-reason-help`} className="text-sm text-muted-foreground">Explain your decision. Preparation preserves this exact text; signing happens after review.</p>
      </div>
      <Button type="submit" className="min-h-11">Prepare record review</Button>
    </form>;
}


/** Unmounted. No Auth client, effect, route, automatic request or live adapter.
 * The owning accepted Auth boundary synchronously invalidates model identity.
 */
export function RecordReviewWorkflow({ model, selection, onDraftDirtyChange }: RecordReviewWorkflowProps) {
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
  const latestModel = useRef(model), uiLifetime = useRef({ active: false });
  latestModel.current = model;
  const [errorState, setErrorState] = useState<{ model: typeof model; revision: number; message: string } | null>(null);
  const revision = model.getIdentityRevision();
  const error = errorState?.model === model && errorState.revision === revision ? errorState.message : "";
  const setError = (message: string) => setErrorState({ model, revision: model.getIdentityRevision(), message });
  // Lifecycle registration only. No request, retry or signing is effect-driven.
  useEffect(() => {
    const lifetime = { active: true }; uiLifetime.current = lifetime;
    return () => { lifetime.active = false; };
  }, []);
  const busy = !!state.cleanupBusy || ["preparing", "recovering", "confirming", "cancelling"].includes(state.phase);
  const action = (work: () => void | Promise<void>) => {
    const actionModel = model, actionRevision = model.getIdentityRevision(), lifetime = uiLifetime.current;
    const report = () => {
      if (lifetime.active && uiLifetime.current === lifetime && latestModel.current === actionModel && actionModel.getIdentityRevision() === actionRevision)
        setErrorState({ model: actionModel, revision: actionRevision, message: "This action is unavailable. Check the current review and recovery status." });
    };
    setError("");
    try { void Promise.resolve(work()).catch(report); }
    catch { report(); }
  };
  function prepare(decision: "approve" | "reject", reason: string): boolean {
    const request: RecordReviewRequest = { ...selection, operation_id: crypto.randomUUID(), decision, reason };
    if (!recordReviewRequestSchema.safeParse(request).success) { setError("Enter a review reason of 1–4,000 characters without leading or trailing spaces."); return false; }
    action(() => model.prepare(request));
    // Draft reason is held only while editing; the frozen prepared request owns
    // its exact reason after activation. Clear local fields before any await.
    return true;
  }
  const packet = state.prepared?.data.packet;
  const summary = packet ? summarizePreparedReview(packet) : null;
  return <section aria-label="Independent record review" aria-busy={busy} className="min-w-0 space-y-5">
    <header className="space-y-2"><h2 className="font-display text-2xl">Independent record review</h2>
      <p className="max-w-prose text-sm text-muted-foreground">{reviewMeaningText}</p></header>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <div role="status" aria-live="polite" className="text-sm">
      {state.phase === "signed_out" ? "Sign in to prepare or recover a review." : state.phase === "resolved" ? state.outcome?.state === "saved" ? "Record review saved." : "Review preparation cancelled." : busy ? "Checking the original review operation…" :
        state.phase === "idle" ? "Choose a decision and prepare the record for review." : state.phase === "review" ? "Preparation ready. Review the evidence before signing." :
          state.phase === "recoverable" ? "An earlier review operation needs recovery." : state.message}
    </div>
    {state.phase === "idle" && <ReviewDraftForm key={formModelKey(model)} prepare={prepare} onDirtyChange={onDraftDirtyChange} />}
    {state.phase === "review" && packet && state.prepared && <div className="min-w-0 space-y-5 rounded-xl border bg-card p-4 shadow-warm md:p-6">
      <div className="space-y-3"><h3 className="font-display text-xl">Record {String(packet.target.sequence)}</h3>
        <dl className="grid min-w-0 gap-3 text-sm md:grid-cols-2">
          <div><dt className="text-muted-foreground">Decision to record</dt><dd className="font-medium">{state.request!.decision === "approve" ? "Approve" : "Reject"}</dd></div>
          <div><dt className="text-muted-foreground">Server expiry</dt><dd className="break-words"><time dateTime={state.prepared.data.expires_at}>{state.prepared.data.expires_at}</time></dd></div>
          <div className="min-w-0 md:col-span-2"><dt className="text-muted-foreground">Exact review reason</dt><dd className="whitespace-pre-wrap break-words">{state.request!.reason}</dd></div>
          <div className="min-w-0 md:col-span-2"><dt className="text-muted-foreground">Preparation reference</dt><dd className="break-all font-mono text-xs">{state.prepared.data.packet_hash}</dd></div>
        </dl>
      </div>
      {summary && <div className="space-y-5">
        <div className="space-y-3"><h4 className="font-medium">Recorded event</h4>
          <dl className="grid min-w-0 gap-3 text-sm md:grid-cols-2">
            <div><dt className="text-muted-foreground">Event</dt><dd>{summary.eventKind} · {summary.observation}</dd></div>
            <div><dt className="text-muted-foreground">Historical product</dt><dd className="break-words">{summary.product}</dd></div>
            <div><dt className="text-muted-foreground">Original performer</dt><dd className="break-words">{summary.originalPerformer}</dd></div>
            <div><dt className="text-muted-foreground">Actual event time</dt><dd className="break-words">{summary.observedAt ?? "No actual event time retained"}</dd></div>
            <div><dt className="text-muted-foreground">Server recorded time</dt><dd className="break-words">{summary.recordedAt}</dd></div>
            <div className="min-w-0 md:col-span-2"><dt className="text-muted-foreground">Original note</dt><dd className="whitespace-pre-wrap break-words">{summary.originalNote}</dd></div>
            {summary.clinicalDose !== null && <div><dt className="text-muted-foreground">Descriptive clinical dose</dt><dd className="break-words">{summary.clinicalDose}</dd></div>}
            {summary.clinicalRoute !== null && <div><dt className="text-muted-foreground">Recorded clinical route</dt><dd className="break-words">{summary.clinicalRoute}</dd></div>}
          </dl>
        </div>
        <div className="space-y-3"><h4 className="font-medium">Recorded stock changes</h4>
          <p className="text-sm text-muted-foreground">These quantities describe stock and custody changes, separately from a clinical dose.</p>
          {summary.stockLines.length ? <ul className="space-y-2">{summary.stockLines.map(line => <li key={line.id} className="space-y-1 rounded-lg bg-muted p-3 text-sm">
            <p className="break-words font-medium">{line.container} · {line.channel}</p>
            <p className="break-words"><span className="font-mono">{line.quantity}</span> {line.unit}</p>
          </li>)}</ul> : <p className="text-sm">No stock-change lines are retained for this record.</p>}
        </div>
        <div className="space-y-3"><h4 className="font-medium">Correction and amendment relationships</h4>
          {summary.relationships.length ? <dl className="space-y-3 text-sm">{summary.relationships.map((relationship, index) => <div key={index}>
            <dt className="text-muted-foreground">{relationship.label}</dt><dd className="break-all">{relationship.id}
              {relationship.recordHash && <span className="mt-1 block font-mono text-xs">Recorded reference: {relationship.recordHash}</span>}</dd>
          </div>)}</dl> : <p className="text-sm">{["retraction_v1", "discrepancy_v1", "annotation_v1"].includes(packet.adapter.adapter_id) ?
            "Historical relationship information missing." : "No structured correction or amendment relationship is retained for this event."}</p>}
        </div>
        <div className="space-y-3"><h4 className="font-medium">Review deadline provenance</h4>
          <p className="text-sm">{summary.deadline}{summary.dueAt ? ` · ${summary.dueAt}` : " · No resolved due time"}</p>
          {summary.deadlineReason && <p className="text-sm">{summary.deadlineReason}</p>}
          <dl className="grid min-w-0 gap-3 text-sm md:grid-cols-2">
            <div><dt className="text-muted-foreground">Selection time ({summary.anchorBasis})</dt><dd className="break-words">{summary.anchor}</dd></div>
            <div><dt className="text-muted-foreground">Historical local date</dt><dd>{summary.anchorLocalDate}</dd></div>
            <div><dt className="text-muted-foreground">Selected staffed date</dt><dd>{summary.selectedStaffedDate}</dd></div>
            <div><dt className="text-muted-foreground">Historical policy</dt><dd className="break-all">{summary.historicalPolicy}</dd></div>
            <div><dt className="text-muted-foreground">Historical calendar</dt><dd className="break-all">{summary.historicalCalendar}</dd></div>
          </dl>
        </div>
      </div>}
      <div className="space-y-2"><h4 className="font-medium">Complete retained evidence</h4>{Object.entries(sections).map(([key, label]) => <details key={key} className="min-w-0 rounded-lg border">
        <summary className="min-h-11 cursor-pointer px-3 py-3 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">{label}</summary>
        <pre className="min-w-0 whitespace-pre-wrap break-all px-3 pb-3 font-mono text-xs leading-relaxed">{displayReviewEvidence(packet[key])}</pre>
      </details>)}</div>
      {!state.reviewed ? <Button type="button" variant="outline" className="min-h-11" onClick={() => action(() => model.acknowledgeReview(state.prepared!))}>I have reviewed this preparation</Button> :
        <div className="space-y-3"><p className="text-sm">Confirm to record this decision and exact reason against the preparation above.</p>
          <p className="max-w-prose text-sm font-medium">{reviewMeaningText}</p>
          <Button type="button" className="min-h-11" onClick={() => action(model.confirm)}>Confirm and sign record review</Button></div>}
    </div>}
    {state.phase === "resolved" && state.outcome?.state === "saved" && <dl className="space-y-2 text-sm">
      <div><dt className="text-muted-foreground">Recorded decision</dt><dd>{state.outcome.data.receipt.decision === "approve" ? "Approved" : "Rejected"}</dd></div>
      <div><dt className="text-muted-foreground">Recorded at</dt><dd className="break-words">{state.outcome.data.receipt.recorded_at}</dd></div>
      <div><dt className="text-muted-foreground">Receipt reference</dt><dd className="break-all font-mono text-xs">{state.outcome.data.receipt.receipt_hash}</dd></div>
    </dl>}
    {state.phase === "resolved" && state.message && <p className="text-sm">{state.message}</p>}
    <div className="flex flex-wrap gap-3">
      {state.pointer && !busy && state.phase !== "resolved" && <>
        <Button type="button" variant="outline" className="min-h-11" onClick={() => action(model.recover)}>Recover original review</Button>
        <Button type="button" variant="outline" className="min-h-11" onClick={() => action(model.cancel)}>Cancel original preparation</Button>
      </>}
      {state.phase === "attention" && !state.pointer && <Button type="button" variant="outline" className="min-h-11" onClick={() => action(model.reloadRecovery)}>Check recovery storage</Button>}
      {state.phase === "resolved" && (state.cleanupPending ? <Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={() => action(model.cleanup)}>Finish recovery cleanup</Button> :
        <Button type="button" variant="outline" className="min-h-11" onClick={() => action(model.startAnother)}>Start another review</Button>)}
    </div>
  </section>;
}
