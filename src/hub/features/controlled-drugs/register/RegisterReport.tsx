import type { RegisterDataset } from "./schema.ts";
import { parseRegisterReviewHistory, parseRegisterWitnessDocument } from "./wire.ts";

interface RegisterReportProps { readonly dataset: RegisterDataset; readonly datasetHash: string; readonly csvHash: string }
/** All original labels are rendered as React text, including spreadsheet-leading text. */
export function RegisterReport({ dataset, datasetHash, csvHash }: RegisterReportProps) {
  return <article className="narcotics-register-report space-y-6">
    <header className="space-y-2">
      <h2 className="font-display text-xl">Schedule {dataset.schedule} · {dataset.product_name}</h2>
      <p>{dataset.site_label} · {dataset.stock_unit}</p>
      <p className="text-sm">Period: {dataset.request.from_at} to {dataset.request.to_at} (end excluded).</p>
      <p className="text-sm">Captured: {dataset.captured_at}</p>
      <p className="text-sm text-muted-foreground">{dataset.time_basis}</p>
    </header>
    <section className="space-y-3" aria-label="Register balances">
      <h3 className="font-display text-lg">Opening and closing stock</h3>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm">
        <caption className="sr-only">Exact balances for every stock position in this report</caption>
        <thead><tr className="border-b"><th scope="col" className="p-2">Container</th><th scope="col" className="p-2">Stock</th><th scope="col" className="p-2">Opening</th><th scope="col" className="p-2">Closing</th><th scope="col" className="p-2">Custody at start</th><th scope="col" className="p-2">Custody at end</th></tr></thead>
        <tbody>{dataset.cells.map(cell => <tr key={cell.cell_id} className="border-b align-top">
          <td className="p-2">{cell.label}<p className="text-xs text-muted-foreground">{cell.kind}</p></td><td className="p-2">{cell.channel}</td>
          <td className="p-2 font-mono tabular-nums">{cell.opening_quantity} {cell.stock_unit}</td><td className="p-2 font-mono tabular-nums">{cell.closing_quantity} {cell.stock_unit}</td>
          {[cell.custody_at_start, cell.custody_at_end].map((custody, index) => <td key={index} className="max-w-40 break-all p-2 text-xs">{custody ? <><p>{custody.status}</p><p>Location: {custody.location_id ?? "None"}</p><p>Custodian: {custody.custodian_id ?? "None"}</p></> : "Not yet present"}</td>)}
        </tr>)}</tbody>
      </table></div>
      {!dataset.cells.length && <p>No stock positions existed before this period ended.</p>}
      {dataset.cells.filter(cell => cell.period_opening_entry).map(cell => <p key={cell.cell_id} className="text-sm">Original register opening · {cell.label}: {cell.period_opening_entry.quantity} {cell.stock_unit} · Observed {cell.period_opening_entry.observed_at} · Recorded {cell.period_opening_entry.recorded_at}. This represents existing stock, not a new receipt.</p>)}
    </section>
    <section className="space-y-3" aria-label="Recorded movements">
      <h3 className="font-display text-lg">Recorded movements</h3>
      {!dataset.events.length && <p>No movements were recorded in this period. The balances above still include earlier validated history.</p>}
      {dataset.events.map(event => { const history = parseRegisterReviewHistory(event.review_history_text), review = history.terminal_review;
        return <section key={event.event_id} className="narcotics-register-event space-y-2 rounded-xl border p-4">
        <h4 className="font-medium">#{event.sequence} · {event.event_kind.replace(/_/g, " ")}</h4>
        <p className="text-sm">Recorded by {event.actor_name} · {event.recorded_at}</p>
        <p className="text-sm text-muted-foreground">{event.observed_at ? `Observed: ${event.observed_at}` : "Not a physical observation"} · {event.basis.replace(/_/g, " ")}</p>
        {event.current_display && <p className="text-sm">Patient: {event.current_display.patient_name} · Client: {event.current_display.client_name} <span className="text-muted-foreground">(names at export)</span></p>}
        {event.note && <p className="whitespace-pre-wrap break-words text-sm">{event.note}</p>}
        {event.lines.length > 0 && <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b">
          <th scope="col" className="p-2">Container</th><th scope="col" className="p-2">Stock</th><th scope="col" className="p-2">Change</th><th scope="col" className="p-2">Running quantity</th>
        </tr></thead><tbody>{event.lines.map(line => <tr key={line.cell_id} className="border-b"><td className="p-2">{dataset.cells.find(cell => cell.cell_id === line.cell_id)?.label ?? "Recorded stock position"}</td>
          <td className="p-2">{line.channel}</td><td className="p-2 font-mono">{line.quantity_delta} {dataset.stock_unit}</td><td className="p-2 font-mono">{line.running_quantity} {dataset.stock_unit}</td></tr>)}</tbody></table></div>}
        {!event.lines.length && <p className="text-sm">This record has no quantity change.</p>}
        <p className="break-all font-mono text-xs text-muted-foreground">Record SHA-256: {event.record_hash}</p>
        {review ? <div className="space-y-1 text-sm"><p>Independent record review: {review.decision === "approve" ? "Approved" : "Rejected"} by {review.actor_name} · {review.recorded_at}</p><p>{review.reason}</p><p className="text-xs">{review.meaning_text}</p><p className="break-all font-mono text-xs">Review receipt SHA-256: {review.receipt_hash}</p></div>
          : <p className="text-sm">Independent record review: {event.secondary_review_required ? "Not completed at export" : "Not required"}.</p>}
        {history.escalations.map(item => <p key={item.reason} className="text-xs">Review follow-up: {item.reason.replace(/_/g, " ")} · First detected {item.first_detected_at} · {item.has_acknowledgment ? "Acknowledged" : "Not acknowledged"} · {item.has_resolution_note ? "Resolution note recorded" : "No resolution note"}</p>)}
        {event.saved_witnesses.map(item => { const witness = parseRegisterWitnessDocument(item.document_text); return <div key={item.operation_id} className="space-y-1 text-sm"><p>Saved witness: {witness.actor_name} · Recorder: {witness.recorder_name} · {witness.recorded_at}</p><p className="break-all font-mono text-xs">Witness receipt SHA-256: {witness.receipt.receipt_digest}</p></div>; })}
        <p className="text-xs text-muted-foreground">Original source, review history and {event.saved_witnesses.length} saved witness receipt(s) are preserved in the verified evidence download.</p>
      </section>; })}
    </section>
    <section className="space-y-2"><h3 className="font-display text-lg">Independent counts</h3>
      <p className="text-sm">{dataset.counts.length} finalized count(s) recorded in this period. Private and unfinished observations are excluded.</p>
      {dataset.counts.map(count => <details key={count.count_id} open className="space-y-2"><summary className="break-all text-sm">{count.state === "agreement" ? "Agreement" : "Variance"} · Evidence SHA-256: {count.projection_hash}</summary><pre className="whitespace-pre-wrap break-all text-xs">{count.projection_text}</pre></details>)}
    </section>
    <section className="space-y-3"><h3 className="font-display text-lg">Original registration and opening evidence</h3>
      <details open><summary className="text-sm font-medium">Registered site evidence</summary><pre className="whitespace-pre-wrap break-all text-xs">{dataset.registration_evidence_text}</pre></details>
      <details open><summary className="text-sm font-medium">Original register opening</summary><pre className="whitespace-pre-wrap break-all text-xs">{dataset.opening_evidence_text}</pre></details>
    </section>
    <section className="space-y-2"><h3 className="font-display text-lg">Supporting originals</h3>
      {!dataset.supporting_forms.length && <p className="text-sm">No supporting files were preserved for this report.</p>}
      {dataset.supporting_forms.map(form => <div key={form.form_id} className="space-y-1 text-sm"><p>{form.title} · {form.filename}</p><p className="text-muted-foreground">{form.kind.replace(/_/g, " ")} · Staff-reported obtained time: {form.obtained_at}</p><p className="break-all font-mono text-xs">SHA-256: {form.sha256}</p></div>)}
    </section>
    <footer className="space-y-2 border-t pt-4 text-xs text-muted-foreground">
      {dataset.evidence_gaps.map(gap => <p key={gap}>{gap}</p>)}
      <p className="break-all font-mono">Dataset SHA-256: {datasetHash}</p><p className="break-all font-mono">CSV SHA-256: {csvHash}</p>
      <p>Report {dataset.report_id}</p>
    </footer>
  </article>;
}
