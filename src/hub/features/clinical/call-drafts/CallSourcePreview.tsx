import { formatDateTime } from "@/hub/features/patient-360/model";
import type { CallSource } from "./model";
interface CallSourcePreviewProps {
  source: CallSource;
  patientName?: string;
  householdName?: string;
  encounterDate?: string;
}
export function CallSourcePreview({ source, patientName, householdName, encounterDate }: CallSourcePreviewProps) {
  const document = source.document;
  return <section aria-label="Frozen call transcript" className="min-w-0 space-y-4 rounded-lg border border-border bg-background p-3">
    <h4 className="font-semibold">Complete captured transcript</h4>
    <p className="break-words text-sm">Current patient: {patientName ?? "Selected saved patient"} · current household: {householdName ?? "Assigned household"}</p>
    <p className="text-sm">{encounterDate ? `Linked encounter: ${formatDateTime(encounterDate)} (Denver; current saved encounter date).` : "This source belongs to another saved encounter for this patient; its exact link is retained in capture audit details."}</p>
    <dl className="grid min-w-0 gap-2 text-sm sm:grid-cols-2">
      <div className="min-w-0"><dt className="text-muted-foreground">Call started</dt><dd className="break-words">{source.context.call_started_at ? `${formatDateTime(source.context.call_started_at)} (Denver)` : "Not supplied"}</dd></div>
      <div className="min-w-0"><dt className="text-muted-foreground">Call ended</dt><dd className="break-words">{formatDateTime(source.context.call_ended_at)} (Denver)</dd></div>
      <div className="min-w-0"><dt className="text-muted-foreground">Transcript captured</dt><dd className="break-words">{formatDateTime(document.captured_until)} (Denver)</dd></div>
      <div className="min-w-0"><dt className="text-muted-foreground">Transcript</dt><dd>{document.segments.length} segments · language {document.language}</dd></div>
    </dl>
    <p className="text-sm text-muted-foreground">Original speaker labels and relative call times are preserved. A label does not establish a clinician’s identity or which pet was discussed. The capture date is separate from the original call date.</p>
    <p className="text-sm text-muted-foreground">Two complete observed enumerations matched during capture. This is retained evidence, not a guaranteed atomic provider revision or a statement that the remote transcript remains unchanged.</p>
    <section aria-label="Original call speaker labels" className="space-y-2">
      <h5 className="font-medium">Original speaker labels</h5>
      {document.callers.map((caller) => <p key={caller.localIdentifier} className="break-words text-sm">{caller.localIdentifier} · provider role {caller.type}</p>)}
    </section>
    <section aria-label="All captured call segments" className="min-w-0 space-y-3">
      {document.segments.map((segment) => <article key={segment.ordinal} aria-label={`Call segment ${segment.ordinal}`} className="min-w-0 space-y-2 rounded-md border border-border p-3">
        <h5 className="break-words text-sm font-medium">Segment {segment.ordinal} · {segment.start}–{segment.end} seconds · original speaker {segment.caller}</h5>
        <p className="whitespace-pre-wrap break-words text-sm">{segment.text}</p>
      </article>)}
    </section>
    <details aria-label="Capture audit details" className="min-w-0 space-y-3 rounded-md border border-border p-3">
      <summary className="min-h-11 cursor-pointer text-sm font-medium">Capture audit details</summary>
      <dl className="grid min-w-0 gap-2 text-xs text-muted-foreground sm:grid-cols-2">
        {Object.entries({ source: source.id, capture: source.capture_id, patient: source.pet_id, encounter: source.encounter_id, household: source.client_id, conversation: source.conversation_id, call: source.call_uuid, provider_call: source.call_id, policy_version: source.policy_version, operator: source.actor_id, captured_from: document.captured_from, captured_until: document.captured_until, ...source.context }).map(([label, value]) => <div key={label} className="min-w-0"><dt>{label.replace(/_/g, " ")}</dt><dd className="break-all">{value ?? "Not supplied"}</dd></div>)}
      </dl>
      <p className="break-all text-xs text-muted-foreground">Source manifest SHA256 (call context and transcript): {source.sha256}</p>
      {document.callers.map((caller) => <p key={caller.localIdentifier} className="break-words text-xs text-muted-foreground">Original speaker {caller.localIdentifier} · provider identity {caller.id ?? "Not supplied"}</p>)}
      <details className="min-w-0 rounded-md border border-border p-3"><summary className="min-h-11 cursor-pointer text-sm font-medium">Exact transcript projection and page evidence</summary>
        <pre className="whitespace-pre-wrap break-words text-xs">{document.projection}</pre>
        {document.pages.map((page, index) => <p key={index} className="break-all text-xs text-muted-foreground">Pass {page.pass} · offset {page.offset} · {page.count}/{page.total} segments · retrieved {page.retrieved_at} · SHA256 {page.sha256}</p>)}
      </details>
      <details className="min-w-0 rounded-md border border-border p-3"><summary className="min-h-11 cursor-pointer text-sm font-medium">Segment evidence hashes and projection offsets</summary>
        {document.segments.map((segment) => <p key={segment.ordinal} className="break-all text-xs text-muted-foreground">Segment {segment.ordinal} · text SHA256 {segment.text_sha256} · projection offsets {segment.projection_from}–{segment.projection_to}</p>)}
      </details>
    </details>
    <p className="text-sm text-muted-foreground">Private call evidence only. No AI draft, SOAP update, signature or delivery occurs in this workflow.</p>
  </section>;
}
