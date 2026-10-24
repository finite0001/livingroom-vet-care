import type { AdmittedReviewDetail } from "./read-detail";
import { displayReviewEvidence } from "./display-evidence";
import { reviewStatusCopy } from "./status-copy";

interface RecordReviewDetailProps { detail: AdmittedReviewDetail }
const sections = {
  target: "Original record identity", adapter: "Source provenance", event: "Original event",
  parent_preparation: "Original preparation", original_result: "Original result", clinical_snapshot: "Historical clinical details",
  source_rows: "Retained source records", event_lines: "Event lines", cells: "Stock cells", transitions: "Container transitions",
  containers: "Identified containers", obligation: "Review requirement and deadline evidence", current_authorization: "Current review permissions",
};

/** Read-only admitted data, including nullable policy and non-signable history.
 * Opening details creates no preparation or operation and records no decision.
 */
export function RecordReviewDetail({ detail }: RecordReviewDetailProps) {
  const response = detail.response, summary = response.data.summary;
  return <section aria-label="Opened record details" className="min-w-0 space-y-4 rounded-xl border bg-card p-4 shadow-warm md:p-6">
    <header className="space-y-2"><h2 className="font-display text-xl">Record {summary.event_sequence}</h2>
      <p className="text-sm text-muted-foreground">Opening this record does not prepare or sign a review.</p></header>
    <dl className="grid min-w-0 gap-3 text-sm md:grid-cols-3">
      <div><dt className="text-muted-foreground">Record review</dt><dd>{reviewStatusCopy[summary.review_state]}</dd></div>
      <div><dt className="text-muted-foreground">Deadline</dt><dd>{reviewStatusCopy[summary.deadline_state]}</dd></div>
      <div><dt className="text-muted-foreground">Signing</dt><dd>{reviewStatusCopy[summary.signing_state]} · {reviewStatusCopy[summary.signing_reason]}</dd></div>
    </dl>
    {response.state === "exception" ? <p role="status" className="text-sm text-muted-foreground">This record has no available signing evidence. Its queue status remains visible.</p> : <>
      {response.data.terminal_review && <div className="space-y-3">
        <h3 className="font-medium">Recorded decision</h3>
        <dl className="grid min-w-0 gap-3 text-sm md:grid-cols-2">
          <div><dt className="text-muted-foreground">Reviewer</dt><dd className="break-words">{response.data.terminal_review.actor_name}</dd></div>
          <div><dt className="text-muted-foreground">Recorded at</dt><dd className="break-words"><time dateTime={response.data.terminal_review.recorded_at}>{response.data.terminal_review.recorded_at}</time></dd></div>
          <div className="min-w-0 md:col-span-2"><dt className="text-muted-foreground">Exact review reason</dt><dd className="whitespace-pre-wrap break-words">{response.data.terminal_review.reason}</dd></div>
        </dl>
        <p className="text-sm text-muted-foreground">{response.data.terminal_review.meaning_text}</p>
      </div>}
      <div className="space-y-2"><h3 className="font-medium">Complete retained evidence</h3>
        {Object.entries(sections).map(([key, label]) => <details key={key} className="min-w-0 rounded-lg border">
          <summary className="min-h-11 cursor-pointer px-3 py-3 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">{label}</summary>
          <pre className="min-w-0 whitespace-pre-wrap break-all px-3 pb-3 font-mono text-xs leading-relaxed">{displayReviewEvidence(response.data.packet[key])}</pre>
        </details>)}
        <details className="min-w-0 rounded-lg border"><summary className="min-h-11 cursor-pointer px-3 py-3 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">Review and escalation history</summary>
          <pre className="min-w-0 whitespace-pre-wrap break-all px-3 pb-3 font-mono text-xs leading-relaxed">{displayReviewEvidence({
            terminal_review: response.data.terminal_review, escalations: response.data.escalations,
            derived_escalation_reasons: response.data.derived_escalation_reasons,
          })}</pre>
        </details>
      </div>
    </>}
  </section>;
}
