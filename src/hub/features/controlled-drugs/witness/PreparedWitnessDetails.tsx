import { serializeEntryJson } from "../entry/codec.ts";
import { reviewEventLabels } from "../record-review/review-labels.ts";
import type { WitnessReply } from "./schema.ts";
import { witnessBasisLabels } from "./labels.ts";
interface PreparedWitnessDetailsProps { readonly reply: WitnessReply }
export function PreparedWitnessDetails({ reply }: PreparedWitnessDetailsProps) {
  const p = reply.data.preparation;
  if (!p) return null;
  return <section className="min-w-0 space-y-4" aria-label="Exact prepared action for independent witness">
    <header><h3 className="break-words font-display text-xl">{p.frozen.catalog.name}</h3><p className="text-sm">{reviewEventLabels[reply.data.pointer.event_kind]} · {p.frozen.catalog.unit}</p></header>
    <dl className="grid gap-3 break-words text-sm md:grid-cols-2">
      <div><dt className="font-medium">Recorder</dt><dd>{reply.data.recorder!.name}<span className="block break-all text-xs text-muted-foreground">{reply.data.recorder!.id}</span></dd></div>
      <div><dt className="font-medium">Basis</dt><dd>{witnessBasisLabels[p.context.basis.kind]}</dd></div>
      <div><dt className="font-medium">Recorder’s actual observation time</dt><dd>{p.context.basis.observed_at ?? "No new physical observation for this assertion"}</dd></div>
      <div><dt className="font-medium">Original preparation expires</dt><dd>{p.expires_at}</dd></div>
      <div className="md:col-span-2"><dt className="font-medium">Recorder’s note</dt><dd className="whitespace-pre-wrap">{p.context.basis.note ?? "No note in the preparation"}</dd></div>
    </dl>
    <section className="space-y-3" aria-label="Complete witness stock allocations"><h4 className="font-medium">Exact quantities and custody change</h4>
      {p.context.containers.length === 0 && <p className="text-sm">This assertion selects no physical containers and makes no stock allocation.</p>}
      {p.context.containers.map((container, index) => {
        const before = p.frozen.containers[index];
        return <article key={container.id} className="min-w-0 space-y-2 rounded-lg border p-3 text-sm">
          <h5 className="break-words font-medium">{container.create?.label ?? String(before.container?.label ?? "Captured container")}</h5>
          <p className="break-all text-xs text-muted-foreground">Container {container.id}</p>
          <dl className="grid gap-2 md:grid-cols-2"><div><dt className="font-medium">Before</dt><dd>{container.create ? "New container, no prior head" : before.head?.status}<span className="block break-all text-xs">{before.head?.location_id && `Location ${before.head.location_id}`}{before.head?.custodian_id && ` · Custodian ${before.head.custodian_id}`}</span></dd></div>
            <div><dt className="font-medium">After the recorder executes</dt><dd>{container.after.status}<span className="block break-all text-xs">{container.after.location_id && `Location ${container.after.location_id}`}{container.after.custodian_id && ` · Custodian ${container.after.custodian_id}`}</span></dd></div></dl>
          <ul className="space-y-2">{container.lines.map((line, i) => {
            const lot = p.frozen.lots.find(value => value.id === line.lot_id)?.lot;
            return <li key={i} className="border-t pt-2"><p className="font-medium">Change {line.quantity_delta} {p.frozen.catalog.unit} · {line.channel}</p><p className="break-words">Lot {lot ? String(lot.lot_number) : line.lot_id}{lot && ` · expires ${String(lot.expires_on)}`}</p>
              <p className="break-all text-xs">{line.dispense_id && `Dispense ${line.dispense_id}`}{line.intake_id && ` · Intake ${line.intake_id}`}</p></li>;
          })}</ul>
        </article>;
      })}
    </section>
    <p className="text-sm">Attesting does not post stock or add a new observation. The recorder must separately execute this exact prepared action. Your attestation logging time is not a replacement physical observation time.</p>
    <details><summary className="cursor-pointer font-medium">Complete original action</summary><pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-muted p-3 text-xs">{serializeEntryJson(p.canonical_arguments, 2097152)}</pre></details>
    <details><summary className="cursor-pointer font-medium">Complete immutable preparation and frozen source records</summary><pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-muted p-3 text-xs">{serializeEntryJson(p, 4194304)}</pre></details>
  </section>;
}
