import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { prescriberFieldsSchema } from "./prescription-api";
import type { PrescriptionApi, PrescriberEntry, PrescriberFields } from "./prescription-api";
import { usePrescriptionOperation } from "./usePrescriptionOperation";
import { PrescriptionOperationControls } from "./PrescriptionOperationControls";
interface Props { api: PrescriptionApi; actor: string; patientId: string; entries: PrescriberEntry[]; isAdmin: boolean; disabled: boolean; onDirtyChange: (dirty: boolean) => void; onSaved: () => void }
const empty = (): PrescriberFields => ({ active: false, license_number: "", license_state: "", license_expires_on: "", practice_name: "", practice_address: "", practice_phone: null, clinical_review_note: "" });
export function PrescriptionSettings({ api, actor, patientId, entries, isAdmin, disabled, onDirtyChange, onSaved }: Props) {
  const [selected, setSelected] = useState<PrescriberEntry | null>(null), [fields, setFields] = useState(empty), [modified, setModified] = useState(false), [attest, setAttest] = useState(false), [error, setError] = useState("");
  const operation = usePrescriptionOperation({ actor, patientId, execute: api.execute, recover: api.recover, onConfirmed: receipt => {
    if (receipt.operation !== "configure_prescriber") throw new Error("Wrong configuration receipt");
    setSelected(previous => previous ? { ...previous, configuration: receipt.result } : previous); setFields(receipt.result.fields); setModified(false); setAttest(false); onSaved();
  } });
  const dirty = modified || operation.dirty;
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);
  const locked = operation.dirty || disabled || !isAdmin;
  function choose(id: string) { const entry = entries.find(e => e.user_id === id) ?? null; setSelected(entry); setFields(entry?.configuration?.fields ?? empty()); setModified(false); setAttest(false); setError(""); }
  function review() {
    setError("");
    const parsed = prescriberFieldsSchema.safeParse(fields);
    if (!selected || !parsed.success || !attest) { setError("Complete the credential fields and explicit review attestation before saving."); return; }
    operation.review({ id: crypto.randomUUID(), kind: "configure_prescriber", payload: { user_id: selected.user_id, expected_version: selected.configuration?.version ?? null, fields: parsed.data, attest_review: true } });
  }
  return <section className="space-y-3 rounded-md border p-4" aria-label="Prescriber eligibility settings">
    <h3 className="font-medium">Prescriber eligibility</h3><p className="text-sm text-muted-foreground">An active DVM role and an administrator-reviewed, current credential configuration are both required for new signatures.</p>
    <Label htmlFor="native-prescriber-user">Prescriber</Label><select id="native-prescriber-user" className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={selected?.user_id ?? ""} disabled={dirty || disabled} onChange={e => choose(e.target.value)}><option value="">Select prescriber</option>{entries.map(e => <option key={e.user_id} value={e.user_id}>{e.name || e.user_id} · {e.eligible ? "Eligible" : e.configuration ? "Not currently eligible" : "Not configured"}</option>)}</select>
    {selected && <><p className="break-all text-xs text-muted-foreground">Staff ID: {selected.user_id}. Configuration revision: {selected.configuration?.version ?? "none"}.</p><fieldset disabled={locked} className="grid gap-3 md:grid-cols-2"><legend className="sr-only">Credential configuration</legend>
      {([['license_number', 'License number'], ['license_state', 'Licensing state / jurisdiction'], ['license_expires_on', 'License expiration'], ['practice_name', 'Practice name'], ['practice_phone', 'Practice phone (optional)']] as const).map(([key, label]) => <div key={key}><Label htmlFor={`prescriber-${key}`}>{label}</Label><Input id={`prescriber-${key}`} type={key === 'license_expires_on' ? 'date' : 'text'} value={fields[key] ?? ""} onChange={e => { setFields({ ...fields, [key]: key === 'practice_phone' && !e.target.value ? null : e.target.value }); setModified(true); setAttest(false); }} /></div>)}
      <div><Label htmlFor="prescriber-practice-address">Practice address</Label><Textarea id="prescriber-practice-address" value={fields.practice_address} onChange={e => { setFields({ ...fields, practice_address: e.target.value }); setModified(true); setAttest(false); }} /></div>
      <div className="md:col-span-2"><Label htmlFor="prescriber-review-note">Credential and clinical workflow review evidence</Label><Textarea id="prescriber-review-note" value={fields.clinical_review_note} onChange={e => { setFields({ ...fields, clinical_review_note: e.target.value }); setModified(true); setAttest(false); }} /></div>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={fields.active} onChange={e => { setFields({ ...fields, active: e.target.checked }); setModified(true); setAttest(false); }} />Enable this reviewed prescriber configuration</label>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={attest} onChange={e => { setAttest(e.target.checked); setModified(true); }} />I reviewed these credentials and the clinical prescribing workflow for practice use.</label>
    </fieldset>{!isAdmin && <p className="text-sm">Only an active administrator can configure prescribers.</p>}
    {!operation.dirty && <div className="flex gap-2"><Button disabled={disabled || !isAdmin || !modified || !attest} onClick={review}>Review configuration</Button><Button variant="outline" disabled={disabled || !modified} onClick={() => choose(selected.user_id)}>Discard configuration changes</Button></div>}</>}
    {error && <p role="alert">{error}</p>}
    <PrescriptionOperationControls state={operation.state} error={operation.error} notice={operation.notice} commitLabel="Save reviewed configuration" reviewConfirmed={attest && isAdmin && !disabled} onCommit={operation.commit} onRecover={operation.recoverOriginal} onDiscard={operation.discard} />
  </section>;
}
