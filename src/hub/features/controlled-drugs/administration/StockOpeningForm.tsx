import { useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { ControlledOperationNotSentError } from "../operation-errors.ts";
import { CheckField, LocalInstantField, SelectField, TextField } from "./FormFields";
import { StockPermissionFields } from "./StockPermissionFields";
import { initialStockPolicyDraft } from "./stock-policy-form.ts";
import { buildStockOpening, type OpeningFormDraft, type OpeningPlacementDraft } from "./opening-form.ts";
import { openingSlotIdentity, type StockOpeningDefinition } from "./opening-definition.ts";
import type { AdministrationOptions, StockOpeningPreview } from "./queries.ts";
interface StockOpeningFormProps { readonly preview: StockOpeningPreview; readonly options: AdministrationOptions; readonly disabled: boolean; readonly onSubmit: (definition: StockOpeningDefinition) => Promise<void>; readonly onDirtyChange: () => void }
export function StockOpeningForm({ preview, options, disabled, onSubmit, onDirtyChange }: StockOpeningFormProps) {
  const [draft, setDraft] = useState<OpeningFormDraft>(() => ({ policy: initialStockPolicyDraft(), completedLocal: "", completedOffset: "", note: "", attest: false,
    placements: (preview.data.slots ?? []).map(source => ({ slotKey: openingSlotIdentity(source.slot), label: "", location: "", custodian: "", quantity: "", observedLocal: "", observedOffset: "" })) }));
  const [error, setError] = useState(""), [attempted, setAttempted] = useState(false), sent = useRef(false);
  const slots = preview.data.slots;
  function change(next: OpeningFormDraft) { setDraft(next); setError(""); onDirtyChange(); }
  function placement(index: number, patch: Partial<OpeningPlacementDraft>) { change({ ...draft, placements: draft.placements.map((row, at) => at === index ? { ...row, ...patch } : row) }); }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (disabled || sent.current) return;
    let definition: StockOpeningDefinition;
    try { definition = buildStockOpening(preview, draft, options.locations, options.staff.map(person => person.id!), options.sites.map(site => site.id!)); }
    catch (cause) { setError(cause instanceof Error && !cause.name.includes("Zod") ? cause.message : "Complete the policy, every stock position, observation time, and opening reference."); return; }
    sent.current = true; setAttempted(true); setError("");
    try { await onSubmit(definition); } catch (cause) { if (cause instanceof ControlledOperationNotSentError) { sent.current = false; setAttempted(false); setError("The preparation was not sent. Your entries are preserved."); } else setError("Check the original operation before submitting again."); }
  }
  if (preview.state !== "available" || !slots) return <p role="alert">Opening stock is blocked: {preview.data.blocked_reason}</p>;
  return <form className="space-y-5" aria-label="Establish controlled opening stock" onSubmit={event => void submit(event)}><h2 className="font-display text-xl">Opening stock · {preview.data.product.name}</h2><p className="text-sm text-muted-foreground">Record the complete captured stock before activating the log. Recorded quantities are reference information; enter what you actually observe.</p>{error && <p role="alert" className="text-destructive">{error}</p>}<fieldset className="space-y-5" disabled={disabled || attempted}>
    <StockPermissionFields value={draft.policy} sites={options.sites} onChange={policy => change({ ...draft, policy })} />
    {slots.map((source, index) => { const row = draft.placements[index], location = options.locations.find(item => item.id === row.location); return <fieldset key={row.slotKey} className="min-w-0 space-y-3 rounded-xl border p-4"><legend className="max-w-full break-words px-1 font-medium">{source.display_label}</legend><p className="text-sm text-muted-foreground">Recorded: {source.recorded_quantity} {preview.data.product.stock_unit} · {source.custody_state === "onsite" ? "On site" : source.custody_state === "handed_off" ? "Handed to client" : "Disposed"}</p><TextField label="Container label" value={row.label} onChange={label => placement(index, { label })} /><SelectField label="Registered location" value={row.location} onChange={value => placement(index, { location: value, custodian: "" })} choices={options.locations.filter(item => draft.policy.sites.includes(item.site_id!)).map(item => ({ value: item.id!, label: `${options.sites.find(site => site.id === item.site_id)?.label} · ${item.label}` }))} />{location?.kind === "mobile_kit" && <SelectField label="Custodian" value={row.custodian} onChange={custodian => placement(index, { custodian })} choices={options.staff.map(person => ({ value: person.id!, label: person.name! }))} />}
      {source.observation_required ? <><TextField label={`Observed quantity (${preview.data.product.stock_unit})`} value={row.quantity} maxLength={15} hint="Enter zero if you observed none. Up to three decimal places." onChange={quantity => placement(index, { quantity })} /><LocalInstantField label="When did you observe this position?" value={{ local: row.observedLocal, offset: row.observedOffset }} onChange={value => placement(index, { observedLocal: value.local, observedOffset: value.offset })} /></> : <p className="text-sm text-muted-foreground">This source position does not require a new physical observation. Its recorded custody state is preserved.</p>}</fieldset>; })}
    <LocalInstantField label="When was the complete opening finished?" value={{ local: draft.completedLocal, offset: draft.completedOffset }} onChange={value => change({ ...draft, completedLocal: value.local, completedOffset: value.offset })} /><TextField label="Opening note and reference" value={draft.note} maxLength={2000} onChange={note => change({ ...draft, note })} /><CheckField checked={draft.attest} required onChange={attest => change({ ...draft, attest })}>These are the complete positions and my actual physical observations.</CheckField><Button type="submit" className="min-h-11">Prepare opening for review</Button>
  </fieldset></form>;
}
