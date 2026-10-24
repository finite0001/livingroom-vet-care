import { Button } from "@/components/ui/button";
import type { ReviewQueuePage } from "./queue-model.ts";

const labels: Record<string, string> = {
  not_required: "Not required", awaiting_review: "Awaiting review", approved: "Approved", rejected: "Rejected",
  not_configured: "Deadline not configured", not_assigned: "Deadline not assigned", historical_policy_unavailable: "Historical policy unavailable",
  calendar_unavailable: "Calendar unavailable", not_due: "Not yet due", overdue: "Overdue", completed_on_time: "Completed on time",
  completed_late: "Completed late", completed_time_unassessable: "Completion timing unavailable", available: "Available",
  blocked: "Unavailable", terminal: "Already decided", none: "Eligible for review", own_record: "Original performer cannot review",
  no_current_policy: "No current review policy", disabled_current_policy: "Current review policy is disabled", no_read_eligibility: "Read permission unavailable",
  no_review_eligibility: "Review permission unavailable", unsupported_provenance: "Source evidence unavailable", evidence_limit_exceeded: "Evidence exceeds the review limit",
  terminal_outcome: "Recorded decision is final", kind_not_configured: "Event kind not configured", other_native_kind_selected: "Another event kind sets this deadline",
  no_policy_at_anchor: "No historical policy at the event time", policy_disabled_at_anchor: "Historical policy was disabled",
  missing_managed_dispense_family: "Original dispense evidence unavailable", family_site_unproven: "Original dispense site unproven",
  anchor_outside_calendar_range: "Event outside the calendar range", anchor_outside_coverage: "Event outside calendar coverage",
  no_later_staffed_day_in_coverage: "No later staffed day in calendar coverage", site_unproven: "Event site unproven",
};
interface RecordReviewQueueProps {
  page: ReviewQueuePage;
  busy: boolean;
  error?: string;
  openRecord(eventId: string): void;
  nextPage(): void;
  restart(): void;
}

/** Read-only presentation. Mount only behind the accepted v3 backend adapter. */
export function RecordReviewQueue({ page, busy, error, openRecord, nextPage, restart }: RecordReviewQueueProps) {
  return <section aria-label="Controlled-drug record review queue" aria-busy={busy} className="min-w-0 space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="font-display text-xl">Record reviews</h2><p className="text-sm text-muted-foreground">Review the recorded evidence. Physical observation is a separate attestation.</p></div>
      <Button type="button" variant="outline" className="min-h-11" onClick={restart} disabled={busy}>Refresh from first page</Button>
    </div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <p className="text-sm text-muted-foreground">This page examined {page.data.examined} event{page.data.examined === 1 ? "" : "s"}. Refresh from the first page to include newer events. This page does not confirm that all records have been reviewed.</p>
    {page.data.items.length === 0 && <p role="status">No visible records on this page.{page.data.next_cursor ? " More events remain to examine; continue to the next page." : " Refresh to check for newly recorded events."}</p>}
    <ul className="space-y-3">
      {page.data.items.map(item => <li key={item.event_id} className="min-w-0 space-y-3 rounded-xl border bg-card p-4 shadow-warm">
        <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-medium">Record {item.event_sequence}</h3>
          <Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={() => openRecord(item.event_id)}>Open record {item.event_sequence}</Button></div>
        <dl className="grid min-w-0 gap-3 text-sm md:grid-cols-3">
          <div><dt className="text-muted-foreground">Record review</dt><dd>{labels[item.review_state]}</dd></div>
          <div><dt className="text-muted-foreground">Deadline</dt><dd>{labels[item.deadline_state]}</dd></div>
          <div><dt className="text-muted-foreground">Signing</dt><dd>{labels[item.signing_state]} · {labels[item.signing_reason]}</dd></div>
          <div className="min-w-0"><dt className="text-muted-foreground">Event time</dt><dd className="break-words"><time dateTime={item.observed_at}>{item.observed_at}</time></dd></div>
          <div className="min-w-0"><dt className="text-muted-foreground">Recorded time</dt><dd className="break-words"><time dateTime={item.recorded_at}>{item.recorded_at}</time></dd></div>
          <div className="min-w-0"><dt className="text-muted-foreground">Due time</dt><dd className="break-words">{item.due_at ? <time dateTime={item.due_at}>{item.due_at}</time> : "No resolved deadline"}</dd></div>
        </dl>
        {item.unavailable_reason && <p className="text-sm text-muted-foreground">{labels[item.unavailable_reason]}</p>}
      </li>)}
    </ul>
    {page.data.next_cursor && <Button type="button" className="min-h-11" onClick={nextPage} disabled={busy}>Continue to next page</Button>}
  </section>;
}
