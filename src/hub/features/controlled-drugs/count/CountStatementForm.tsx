import { ControlledOperationNotSentError } from "../operation-errors.ts";
import { useId, useMemo, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { buildCountStatement, countObservationChoices, type CountEntryFields, type CountObservationChoice, type CountStatementIdentity } from "./count-entry.ts";
import type { CountReadData } from "./count-read-wire.ts";
import type { CountStatementRequest } from "./count-request-schema.ts";

interface CountStatementFormProps {
  readonly identity: CountStatementIdentity;
  /** The host admits this through verifyCountReadReply before display. */
  readonly data: CountReadData;
  readonly busy: boolean;
  readonly pendingRecovery: boolean;
  readonly onSubmit: (request: CountStatementRequest) => Promise<void>;
  readonly onDirtyChange?: (dirty: boolean) => void;
}
const selectClass = "min-h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm";

function ObservationForm({ identity, data, busy, pendingRecovery, onSubmit, onDirtyChange }: CountStatementFormProps) {
  const prefix = useId();
  const submitted = useRef(false);
  const [attempted, setAttempted] = useState(false);
  const [fields, setFields] = useState<CountEntryFields>(() => ({
    observedAt: "", observedOffset: "", attest: false,
    quantities: Object.fromEntries(data.units.map(unit => [unit.cell_id, ""])),
    presence: Object.fromEntries(data.containers.map(container => [container.container_id, ""])), findings: [],
  }));
  const [error, setError] = useState("");
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const timeChoices = useMemo<readonly CountObservationChoice[]>(() => {
    if (!timeZone) return [];
    try { return fields.observedAt ? countObservationChoices(fields.observedAt) : []; }
    catch { return []; /* Validate again on explicit submit. */ }
  }, [fields.observedAt, timeZone]);
  const disabled = busy || pendingRecovery || attempted || data.history_state !== "collecting" || data.current_boundary_state !== "unchanged";
  function change(next: CountEntryFields) { setFields(next); setError(""); onDirtyChange?.(true); }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled || submitted.current) return;
    let request: CountStatementRequest;
    try { request = buildCountStatement(identity, data, fields); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Check the count entries."); return; }
    submitted.current = true;
    setAttempted(true);
    setError("");
    try { await onSubmit(request); }
    catch (error) {
      if (error instanceof ControlledOperationNotSentError) { submitted.current = false; setAttempted(false); setError("Your observation was not sent. Your entries are preserved; submit deliberately after the other action finishes."); }
      else setError("The saved result is unconfirmed. Check recovery before trying again.");
    }
  }
  const own = data.participants.find(person => person.id === identity.actor_id);
  if (!own) return <p role="alert">You are not a participant in this count.</p>;
  if (own.submitted || data.own_statement) return <p role="status">Your observation is recorded. Refresh to check the other participant’s progress.</p>;
  return <form onSubmit={event => void submit(event)} className="min-w-0 space-y-5" aria-label="Your physical stock count">
    <div className="space-y-1"><h3 className="font-display text-lg">Record your count</h3>
      <p className="text-sm text-muted-foreground">{data.product.name} · {data.site.label}. Enter what you personally observed. Expected quantities stay hidden until both people submit.</p></div>
    {data.current_boundary_state === "changed" && <p role="alert" className="text-destructive">Stock or policy changed. Refresh and start a new count.</p>}
    <fieldset disabled={disabled} className="min-w-0 space-y-5">
      <div className="grid gap-1"><Label htmlFor={`${prefix}-observed`}>When did you observe the stock?</Label>
        <Input id={`${prefix}-observed`} type="datetime-local" step="1" required value={fields.observedAt} onChange={event => change({ ...fields, observedAt: event.target.value, observedOffset: "" })} />
        <p className="text-xs text-muted-foreground">Local time: {timeZone}</p>
        {timeChoices.length > 1 && <><Label htmlFor={`${prefix}-offset`}>Which occurrence of this time?</Label>
          <select id={`${prefix}-offset`} required className={selectClass} value={fields.observedOffset} onChange={event => change({ ...fields, observedOffset: event.target.value })}>
            <option value="">Choose the observation’s UTC offset</option>{timeChoices.map((choice, index) => <option key={choice.instant} value={choice.offset}>UTC{choice.offset} · {index === 0 ? "first occurrence" : "later occurrence"}</option>)}
          </select></>}
      </div>
      {data.containers.map(container => {
        const location = data.locations.find(item => item.id === container.location_id);
        return <fieldset key={container.container_id} className="min-w-0 space-y-3 rounded-xl border p-4">
          <legend className="max-w-full break-words px-1 font-medium">{container.label}</legend>
          <p className="break-words text-sm text-muted-foreground">{location?.label} · {container.kind === "prepared" ? "Prepared container" : "Stock container"}</p>
          <div className="grid gap-1"><Label htmlFor={`${prefix}-presence-${container.container_id}`}>Was this container present?</Label>
            <select id={`${prefix}-presence-${container.container_id}`} required className={selectClass} value={fields.presence[container.container_id]} onChange={event => change({ ...fields, presence: { ...fields.presence, [container.container_id]: event.target.value as "present" | "missing" | "" } })}>
              <option value="">Choose your observation</option><option value="present">Present</option><option value="missing">Missing</option>
            </select></div>
          {data.units.filter(unit => unit.container_id === container.container_id).map(unit => {
            const lot = data.lots.find(item => item.id === unit.lot_id);
            const channel = { available: "Available stock", prepared: "Prepared stock", return_held: "Held return" }[unit.channel];
            return <div key={unit.cell_id} className="grid gap-1 border-t pt-3">
              <Label htmlFor={`${prefix}-quantity-${unit.cell_id}`}>{channel} · lot {lot?.lot_number} · quantity ({unit.stock_unit})</Label>
              <Input id={`${prefix}-quantity-${unit.cell_id}`} inputMode="decimal" autoComplete="off" maxLength={15} required value={fields.quantities[unit.cell_id]} onChange={event => change({ ...fields, quantities: { ...fields.quantities, [unit.cell_id]: event.target.value } })} />
              <p className="text-xs text-muted-foreground">Enter zero if you observed none. Up to three decimal places.</p>
            </div>;
          })}
        </fieldset>;
      })}
      <section className="min-w-0 space-y-3" aria-label="Additional count findings">
        <h4 className="font-medium">Additional findings</h4>
        <p className="text-sm text-muted-foreground">Record unexpected stock, labels, or other issues you observed.</p>
        {fields.findings.map((finding, index) => <fieldset key={index} className="grid min-w-0 gap-2 rounded-xl border p-3">
          <legend className="px-1 text-sm">Finding {index + 1}</legend>
          <Label htmlFor={`${prefix}-location-${index}`}>Location</Label>
          <select id={`${prefix}-location-${index}`} required className={selectClass} value={finding.location_id} onChange={event => change({ ...fields, findings: fields.findings.map((item, at) => at === index ? { ...item, location_id: event.target.value } : item) })}>
            <option value="">Select a location</option>{data.locations.map(location => <option key={location.id} value={location.id}>{location.label}</option>)}
          </select>
          <Label htmlFor={`${prefix}-finding-${index}`}>What did you observe?</Label>
          <Textarea id={`${prefix}-finding-${index}`} required maxLength={512} value={finding.description} onChange={event => change({ ...fields, findings: fields.findings.map((item, at) => at === index ? { ...item, description: event.target.value } : item) })} />
          <Button type="button" variant="outline" className="min-h-11 justify-self-start" onClick={() => change({ ...fields, findings: fields.findings.filter((_, at) => at !== index) })}>Remove finding {index + 1}</Button>
        </fieldset>)}
        <Button type="button" variant="outline" className="min-h-11" disabled={fields.findings.length >= 32} onClick={() => change({ ...fields, findings: [...fields.findings, { location_id: "", description: "" }] })}>Add a finding</Button>
      </section>
      <label className="flex min-h-11 items-start gap-3 text-sm"><input className="mt-1 h-4 w-4 accent-primary" type="checkbox" checked={fields.attest} onChange={event => change({ ...fields, attest: event.target.checked })} />
        <span>I personally observed these quantities, container checks, and findings at the time entered.</span></label>
    </fieldset>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {(pendingRecovery || attempted) && <p role="status" className="text-sm">Check the pending save before recording anything else.</p>}
    <Button type="submit" className="min-h-11" disabled={disabled || !fields.attest}>{busy ? "Checking save…" : "Record my observation"}</Button>
  </form>;
}

/** Identity/snapshot changes discard the old actor's local draft before render. */
export function CountStatementForm(props: CountStatementFormProps) {
  const identity = props.identity;
  return <ObservationForm key={`${identity.actor_id}:${identity.count_id}:${identity.snapshot_id}:${identity.operation_id}:${identity.statement_id}`} {...props} />;
}
