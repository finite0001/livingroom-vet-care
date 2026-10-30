import { Button } from "@/components/ui/button";
import type { CountReadData } from "./count-read-wire.ts";

interface CountRecordProps {
  /** Accepted by verifyCountReadReply for the current staff actor. */
  readonly data: CountReadData;
  readonly refreshing: boolean;
  readonly locked?: boolean;
  readonly onRefresh: () => void;
}
const historyLabels = { collecting: "Observations in progress", agreement: "Count agrees", variance: "Count has differences", stale: "Count needs to be repeated", cancelled: "Count cancelled" };

/** Presentation only: never derives a stock adjustment from a physical count. */
export function CountRecord({ data, refreshing, locked = false, onRefresh }: CountRecordProps) {
  const both = data.participants.every(person => person.submitted);
  return <section className="min-w-0 space-y-4" aria-label="Recorded stock count">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 space-y-1"><h2 className="break-words font-display text-xl">{data.product.name} · {data.site.label}</h2>
        <p className="font-medium">{historyLabels[data.history_state]}</p></div>
      <Button type="button" variant="outline" className="min-h-11" disabled={refreshing || locked} onClick={onRefresh}>{refreshing ? "Refreshing count…" : "Refresh count"}</Button>
    </div>
    <ul className="grid gap-2 md:grid-cols-2" aria-label="Count participants">{data.participants.map(person => <li key={person.id} className="min-w-0 rounded-xl border p-3">
      <p className="break-words font-medium">{person.name}</p><p className="text-sm text-muted-foreground">{person.submitted ? "Observation recorded" : "Observation still needed"}</p>
    </li>)}</ul>
    {data.current_boundary_state === "changed" && <p role="status" className="rounded-xl border bg-muted p-3 text-sm">Stock or policy has changed since this count began. This record retains the earlier count; repeat the count before making a new stock decision.</p>}
    {data.own_statement && <div className="space-y-1 rounded-xl border p-3"><h3 className="font-medium">Your saved observation</h3>
      <p className="text-sm">Observed: <time dateTime={data.own_statement.request.observed_at}>{data.own_statement.request.observed_at}</time></p>
      <p className="text-sm">Recorded: <time dateTime={data.own_statement.recorded_at}>{data.own_statement.recorded_at}</time></p>
    </div>}
    {!both && <p className="text-sm text-muted-foreground">Expected stock and the other person’s quantities remain hidden until both observations are recorded.</p>}
    {both && data.comparison && data.statements && <section className="min-w-0 space-y-3" aria-label="Count comparison">
      <h3 className="font-display text-lg">Compare the two observations</h3>
      <p className="text-sm">{data.comparison.agreement ? "Both observations agree with the captured stock record." : "The observations have differences or findings that need review."} Recording a count does not change stock balances.</p>
      {data.comparison.quantity_comparison.map(row => {
        const unit = data.units.find(item => item.cell_id === row.cell_id);
        const container = data.containers.find(item => item.container_id === unit?.container_id);
        const lot = data.lots.find(item => item.id === unit?.lot_id);
        return <div key={row.cell_id} className="min-w-0 space-y-2 rounded-xl border p-3">
          <h4 className="break-words font-medium">{container?.label} · lot {lot?.lot_number}</h4>
          <p className="text-sm text-muted-foreground">{unit?.channel === "prepared" ? "Prepared stock" : unit?.channel === "return_held" ? "Held return" : "Available stock"}</p>
          <dl className="grid gap-2 text-sm md:grid-cols-3">
            <div className="min-w-0"><dt className="text-muted-foreground">Captured expected stock</dt><dd className="break-words font-medium">{row.expected_quantity} {row.stock_unit}</dd></div>
            <div className="min-w-0"><dt className="break-words text-muted-foreground">{data.statements![0].actor.name}</dt><dd className="break-words font-medium">{row.actor_a_quantity} {row.stock_unit}{!row.actor_a_matches_expected && " · differs"}</dd></div>
            <div className="min-w-0"><dt className="break-words text-muted-foreground">{data.statements![1].actor.name}</dt><dd className="break-words font-medium">{row.actor_b_quantity} {row.stock_unit}{!row.actor_b_matches_expected && " · differs"}</dd></div>
          </dl>
        </div>;
      })}
      {data.comparison.container_comparison.map(row => <div key={row.container_id} className="min-w-0 rounded-xl border p-3 text-sm">
        <p className="break-words font-medium">{data.containers.find(item => item.container_id === row.container_id)?.label}</p>
        <p className="break-words">{data.statements![0].actor.name}: {row.actor_a_presence === "present" ? "present" : "missing"}</p>
        <p className="break-words">{data.statements![1].actor.name}: {row.actor_b_presence === "present" ? "present" : "missing"}</p>
      </div>)}
      {data.statements.map(statement => statement.request.findings.length > 0 && <section key={statement.slot} className="min-w-0 space-y-2" aria-label={`${statement.actor.name} findings`}>
        <h4 className="break-words font-medium">Findings from {statement.actor.name}</h4>
        {statement.request.findings.map((finding, index) => <div key={index} className="min-w-0 rounded-xl border p-3 text-sm"><p className="break-words font-medium">{data.locations.find(item => item.id === finding.location_id)?.label}</p><p className="whitespace-pre-wrap break-words">{finding.description}</p></div>)}
      </section>)}
    </section>}
    {data.terminal && <div className="space-y-1 border-t pt-3 text-sm"><p className="break-words">{data.terminal.kind === "cancellation" ? "Cancelled" : "Completed"} by {data.terminal.actor.name} · <time dateTime={data.terminal.recorded_at}>{data.terminal.recorded_at}</time></p>
      {data.terminal.reason && <p className="whitespace-pre-wrap break-words">{data.terminal.reason}</p>}
    </div>}
    <details className="rounded-xl border p-3 text-sm"><summary className="cursor-pointer font-medium">Count meaning</summary><p className="whitespace-pre-wrap break-words pt-2">{data.captured_policy.meaning_text}</p></details>
  </section>;
}
