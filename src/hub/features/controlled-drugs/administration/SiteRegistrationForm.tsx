import { useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { ControlledOperationNotSentError } from "../operation-errors.ts";
import { siteRegistrationDefinitionSchema, type SiteRegistrationDefinition } from "./site-definition.ts";
import { SelectField, TextField } from "./FormFields";
import type { AdministrationStaff } from "./queries.ts";
interface LocationDraft { readonly key: string; readonly label: string; readonly kind: string; readonly custodian: string }
interface SiteRegistrationFormProps { readonly staff: readonly AdministrationStaff[]; readonly disabled: boolean; readonly onSubmit: (definition: SiteRegistrationDefinition) => Promise<void>; readonly onDirtyChange: () => void }
export function SiteRegistrationForm({ staff, disabled, onSubmit, onDirtyChange }: SiteRegistrationFormProps) {
  const [label, setLabel] = useState(""), [reference, setReference] = useState(""), [locations, setLocations] = useState<readonly LocationDraft[]>([]);
  const [error, setError] = useState(""), [attempted, setAttempted] = useState(false), sent = useRef(false);
  function change() { setError(""); onDirtyChange(); }
  function patch(key: string, values: Partial<LocationDraft>) { change(); setLocations(rows => rows.map(row => row.key === key ? { ...row, ...values } : row)); }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (disabled || sent.current) return;
    let definition: SiteRegistrationDefinition;
    try { definition = siteRegistrationDefinitionSchema.parse({ site: { label, registration_reference: reference }, locations: [...locations].sort((a, b) => a.key < b.key ? -1 : 1).map(row => ({ key: row.key, label: row.label, kind: row.kind, initial_custodian_id: row.kind === "clinic" ? null : row.custodian })) }); }
    catch { setError("Enter the site, registration reference, and every location. Choose a custodian for each mobile kit."); return; }
    sent.current = true; setAttempted(true); setError("");
    try { await onSubmit(definition); } catch (cause) { if (cause instanceof ControlledOperationNotSentError) { sent.current = false; setAttempted(false); setError("The preparation was not sent. Your entries are preserved."); } else setError("Check the original operation before submitting again."); }
  }
  return <form className="space-y-5" onSubmit={event => void submit(event)} aria-label="Register controlled stock site"><h2 className="font-display text-xl">Register a stock site</h2><p className="text-sm text-muted-foreground">Use the clinic’s actual registration and locations. This does not create an opening balance.</p>{error && <p role="alert" className="text-destructive">{error}</p>}<fieldset disabled={disabled || attempted} className="space-y-4">
    <TextField label="Site name" value={label} onChange={value => { change(); setLabel(value); }} /><TextField label="Registration reference" value={reference} maxLength={2000} onChange={value => { change(); setReference(value); }} />
    {locations.map((row, index) => <fieldset key={row.key} className="space-y-3 rounded-xl border p-4"><legend className="px-1 font-medium">Location {index + 1}</legend><TextField label="Location name" value={row.label} onChange={value => patch(row.key, { label: value })} /><SelectField label="Location type" value={row.kind} onChange={value => patch(row.key, { kind: value, custodian: "" })} choices={[{ value: "clinic", label: "Clinic" }, { value: "mobile_kit", label: "Mobile kit" }]} />{row.kind === "mobile_kit" && <SelectField label="Initial custodian" value={row.custodian} onChange={value => patch(row.key, { custodian: value })} choices={staff.map(person => ({ value: person.id!, label: person.name! }))} />}<Button type="button" variant="outline" className="min-h-11" onClick={() => { change(); setLocations(rows => rows.filter(value => value.key !== row.key)); }}>Remove location</Button></fieldset>)}
    <Button type="button" variant="outline" className="min-h-11" disabled={locations.length >= 256} onClick={() => { change(); setLocations(rows => [...rows, { key: "loc_" + crypto.randomUUID().replace(/-/g, ""), label: "", kind: "", custodian: "" }]); }}>Add location</Button>
    <div><Button type="submit" className="min-h-11">Prepare site for review</Button></div></fieldset></form>;
}
