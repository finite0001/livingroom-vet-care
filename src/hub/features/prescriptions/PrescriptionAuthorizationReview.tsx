import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { prescriptionChangeReasonSchema, reconciliationSchema } from "./prescription-api";
import type { PrescriptionApi, PrescriptionAuthorization, PrescriptionChangePreview, PrescriptionCurrentStatus, PrescriptionCursor, PrescriptionDraft, PrescriptionEvent, PrescriptionReconciliation, PrescriptionReplacementPreview } from "./prescription-api";
import { usePrescriptionOperation } from "./usePrescriptionOperation";
import { PrescriptionOperationControls } from "./PrescriptionOperationControls";
import { renderReviewedPrescriptionCopy } from "./prescription-print";
interface Props { evidenceRevision: number; onEvidenceChanged: () => void; api: PrescriptionApi; actor: string; petId: string; authorization: PrescriptionAuthorization; drafts: PrescriptionDraft[]; isDvm: boolean; inactive: boolean; disabled: boolean; onDirtyChange: (dirty: boolean) => void; onReplacement: (authorization: PrescriptionAuthorization) => void }
const emptyReconciliation = (): PrescriptionReconciliation => ({ native_use_note: "", external_use_status: "unknown", external_use_note: "", remaining_allowance_note: "", attest_review: true });
function UsageEvidence({ usage }: { usage: PrescriptionCurrentStatus["usage"] }) {
  if (usage.version === 1) return <p className="text-sm">Native fill accounting is unavailable. Prior dispensed quantity, used fill slots and remaining allowance: unavailable. External fulfillment: unknown.</p>;
  return <div className="space-y-1 text-sm"><p>Native dispensed quantity: {usage.dispensed_quantity} · used fill slots: {usage.used_fill_slots} · forfeited quantity: {usage.forfeited_quantity}</p>{usage.allowance_basis === "external_unknown" ? <p>External use and remaining allowance are unknown; native ledger counts do not describe outside pharmacy activity.</p> : <p>Unopened fill slots: {usage.unopened_fill_slots} · remaining mathematical allowance: {usage.remaining_quantity}{usage.open_slot ? ` · open fill remainder: ${usage.open_slot.remaining_quantity}` : ""}. Current order status controls whether allowance can be used.</p>}<p>External fulfillment: unknown.</p></div>;
}
export function PrescriptionAuthorizationReview({ evidenceRevision, onEvidenceChanged, api, actor, petId, authorization, drafts, isDvm, inactive, disabled, onDirtyChange, onReplacement }: Props) {
  const alive = useRef(true), loading = useRef(false), popup = useRef<Window | null>(null);
  const attemptedRevision = useRef(-1);
  const [observedRevision, setObservedRevision] = useState(-1);
  const [status, setStatus] = useState<PrescriptionCurrentStatus | null>(null), [events, setEvents] = useState<PrescriptionEvent[]>([]), [cursor, setCursor] = useState<PrescriptionCursor | null>(null), [loaded, setLoaded] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [mode, setMode] = useState<"cancel" | "replace" | null>(null), [reason, setReason] = useState(""), [draftId, setDraftId] = useState(""), [reconciliation, setReconciliation] = useState(emptyReconciliation), [manualAttest, setManualAttest] = useState(false), [ack, setAck] = useState(false);
  const [cancelPreview, setCancelPreview] = useState<PrescriptionChangePreview | null>(null), [replacePreview, setReplacePreview] = useState<PrescriptionReplacementPreview | null>(null), [printHtml, setPrintHtml] = useState("");
  useEffect(() => { alive.current = true; return () => { alive.current = false; popup.current?.close(); }; }, []);
  const operation = usePrescriptionOperation({ actor, patientId: petId, execute: api.execute, recover: api.recover, onConfirmed: receipt => {
    if (receipt.operation !== "cancel" && receipt.operation !== "replace") throw new Error("Wrong authorization change receipt");
    onEvidenceChanged();
    setMode(null); setAck(false); setManualAttest(false); setCancelPreview(null); setReplacePreview(null); setPrintHtml(""); setStatus(null);
    if (receipt.operation === "replace") onReplacement(receipt.result.authorization);
    else { setEvents(previous => [receipt.result, ...previous.filter(e => e.id !== receipt.result.id)]); }
  } });
  const dirty = mode !== null || operation.dirty;
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);
  async function read(action: () => Promise<void>) {
    if (loading.current) return; loading.current = true; setBusy(true); setError("");
    try { await action(); } catch { if (alive.current) setError("Current authorization evidence could not be confirmed. Existing reviewed requests and signed history are retained; refresh and review again."); }
    finally { loading.current = false; if (alive.current) setBusy(false); }
  }
  async function refresh() { await read(async () => { const [nextStatus, page] = await Promise.all([api.readStatus(authorization), api.listEvents(authorization)]); if (!alive.current) return; if (!nextStatus) throw new Error("Authorization unavailable"); setStatus(nextStatus); setEvents(page.events); setCursor(page.next_cursor); setLoaded(true); setObservedRevision(evidenceRevision); setPrintHtml(""); }); }
  const evidenceStale = observedRevision !== evidenceRevision;
  useEffect(() => {
    if (!dirty && !busy && evidenceStale && attemptedRevision.current !== evidenceRevision) {
      attemptedRevision.current = evidenceRevision; void refresh();
    }
    // Retry failed reads explicitly; preserve uncertain operations across evidence invalidation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, busy, evidenceRevision, observedRevision]);

  const locked = disabled || busy || operation.dirty;
  const terminal = status?.status.state === "cancelled" || status?.status.state === "replaced";
  function begin(next: "cancel" | "replace") { operation.discard(); setMode(next); setReason(""); setDraftId(""); setReconciliation(emptyReconciliation()); setManualAttest(false); setAck(false); setCancelPreview(null); setReplacePreview(null); setPrintHtml(""); setError(""); }
  async function review() {
    setError(""); if (!prescriptionChangeReasonSchema.safeParse(reason).success) { setError("Enter a trimmed reason of 1–2,000 characters without control characters."); return; }
    if (mode === "replace" && (!draftId || !manualAttest || !reconciliationSchema.safeParse(reconciliation).success || (authorization.artifact.fulfillment_mode === "external_pharmacy" && reconciliation.external_use_status !== "reconciled"))) { setError("Select an unsigned draft and complete the explicit use and new-allowance review. An external order requires manually reconciled external use."); return; }
    await read(async () => {
      const id = crypto.randomUUID();
      if (mode === "cancel") {
        const preview = await api.previewCancel(authorization); if (!alive.current) return;
        if (["cancelled", "replaced"].includes(preview.context.head.state)) throw new Error("Authorization already terminal");
        setCancelPreview(preview); setAck(false); operation.review({ id, kind: "cancel", payload: { authorization_id: authorization.id, pet_id: petId, expected_event_id: preview.context.head.id, expected_context_hash: preview.context_hash, reason, attest_review: true } });
      } else {
        const draft = await api.readDraft(draftId); if (!draft || draft.status !== "draft") throw new Error("Unsigned draft unavailable");
        const preview = await api.previewReplacement(authorization, draft); if (!alive.current) return;
        if (["cancelled", "replaced"].includes(preview.context.prior.head.state)) throw new Error("Authorization already terminal");
        setReplacePreview(preview); setAck(false); operation.review({ id, kind: "replace", payload: { authorization_id: authorization.id, pet_id: petId, expected_event_id: preview.context.prior.head.id, expected_context_hash: preview.context_hash, reason, attest_review: true, draft_id: draft.id, expected_version: draft.version, signature_name: preview.context.new_sign.prescriber.name, reconciliation } });
      }
    });
  }
  async function print(openWindow: boolean) {
    if (loading.current || dirty || disabled) return;
    setPrintHtml("");
    const windowForCopy = openWindow ? window.open("", "_blank") : null;
    if (openWindow && !windowForCopy) { setError("The print window was blocked. Allow popups for this site, then retry the fresh print request."); return; }
    if (windowForCopy) { windowForCopy.opener = null; popup.current = windowForCopy; }
    await read(async () => {
      try {
        const bundle = await api.readPrint(authorization); if (!alive.current) { windowForCopy?.close(); return; }
        const html = renderReviewedPrescriptionCopy(bundle, { patientId: petId, authorizationId: authorization.id, dispenseId: null }); setPrintHtml(html);
        if (windowForCopy) { windowForCopy.document.open(); windowForCopy.document.write(html); windowForCopy.document.close(); windowForCopy.focus(); windowForCopy.print(); }
      } catch (failure) { windowForCopy?.close(); throw failure; }
    });
  }
  const preview = cancelPreview?.context ?? replacePreview?.context.prior;
  return <section className="space-y-4 rounded-md border p-4" aria-label="Prescription lifecycle">{evidenceStale && <p role="status">Authorization evidence needs refresh after a saved change. Displayed status and quantities may be stale; pending requests are retained.</p>}
    <h3 className="font-semibold">Current authorization status</h3><p className="text-sm">Current status is separate from the immutable signed instructions above. It is not permission to dispense medication.</p>
    {status && <><p className="font-medium">{status.status.state.toUpperCase()} · checked {status.status.checked_at}</p>{status.status.reason && <p className="whitespace-pre-wrap">Recorded reason: {status.status.reason}</p>}{status.status.replacement_id && <p className="break-all text-sm">Replacement authorization: {status.status.replacement_id}</p>}<UsageEvidence usage={status.usage} /></>}
    {busy && <p role="status">Loading current authorization evidence…</p>}{error && <p role="alert">{error}</p>}
    <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={dirty || disabled || busy} onClick={() => void refresh()}>Refresh authorization status</Button><Button variant="outline" disabled={!loaded || evidenceStale || dirty || disabled || busy} onClick={() => void print(false)}>Preview fresh order copy</Button><Button variant="outline" disabled={!loaded || evidenceStale || dirty || disabled || busy} onClick={() => void print(true)}>Print fresh order copy</Button></div>
    {!mode && <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={!loaded || evidenceStale || terminal || !isDvm || disabled || busy || operation.dirty} onClick={() => begin("cancel")}>Cancel this authorization</Button><Button variant="outline" disabled={!loaded || evidenceStale || terminal || !isDvm || inactive || disabled || busy || operation.dirty} onClick={() => begin("replace")}>Replace with an unsigned draft</Button></div>}
    {!isDvm && <p className="text-sm">An eligible DVM must review cancellation or replacement.</p>}
    {mode && <section className="space-y-3" aria-label="Authorization change review"><h4 className="font-medium">{mode === "cancel" ? "Cancel this exact authorization" : "Replace this authorization"}</h4><p className="break-all text-xs text-muted-foreground">Target: {authorization.id}</p><p className="text-sm">This action updates the practice record. No pharmacy or client message is sent.</p><fieldset disabled={locked || !isDvm} className="space-y-3"><Label htmlFor="prescription-change-reason">Clinical reason for {mode === "cancel" ? "cancellation" : "replacement"}</Label><Textarea id="prescription-change-reason" value={reason} onChange={e => { setReason(e.target.value); setAck(false); }} />
      {mode === "replace" && <><p className="text-sm">Prepare and save an independently authored draft before replacing. New quantity and refills come from that draft, never from an assumed remaining balance. The new signature and retirement of the old order commit together.</p><Label htmlFor="prescription-replacement-draft">Unsigned replacement draft</Label><select id="prescription-replacement-draft" className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={draftId} onChange={e => { setDraftId(e.target.value); setAck(false); }}><option value="">Select a saved unsigned draft</option>{drafts.filter(d => d.status === "draft").map(d => <option key={d.id} value={d.id}>{d.fields.medication.name} · {d.fields.medication.strength} · revision {d.version}</option>)}</select><p className="text-xs text-muted-foreground">Only currently loaded drafts appear; close this review to load more history if needed.</p>
        {([['native_use_note', status?.usage.version === 2 ? 'Review of native dispensing and forfeiture history' : 'Review of unavailable native fill accounting'], ['external_use_note', 'External-use review evidence'], ['remaining_allowance_note', 'Reason for the deliberately new quantity and refill allowance']] as const).map(([key,label]) => <div key={key}><Label htmlFor={`replacement-${key}`}>{label}</Label><Textarea id={`replacement-${key}`} value={reconciliation[key]} onChange={e => { setReconciliation({ ...reconciliation, [key]: e.target.value }); setManualAttest(false); setAck(false); }} /></div>)}
        <Label htmlFor="replacement-external-status">External fulfillment review status</Label><select id="replacement-external-status" className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={reconciliation.external_use_status} onChange={e => { setReconciliation({ ...reconciliation, external_use_status: e.target.value as "unknown" | "reconciled" }); setManualAttest(false); setAck(false); }}><option value="unknown">Unknown</option><option value="reconciled">Manually reconciled by reviewing DVM</option></select><p className="text-sm">Manual reconciliation is the DVM's documented review. It does not mean a pharmacy was contacted or its records verified by this application.</p><label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={manualAttest} onChange={e => setManualAttest(e.target.checked)} />I reviewed prior use, accounting limitations and the deliberately new allowance.</label>
      </>}
      <Button disabled={mode === "replace" && (!draftId || !manualAttest || inactive)} onClick={() => void review()}>Load current evidence for review</Button>
    </fieldset>
    {preview && operation.dirty && <section className="space-y-3 rounded-md border p-3" aria-label="Frozen authorization change evidence"><p>Current head: {preview.head.state} · revision {preview.head.version} · {preview.head.id ?? "no previous event"}</p><p className="text-sm">Current patient: {preview.patient_current.id} · household {preview.patient_current.client_id}{preview.patient_current.archived_at ? " · archived" : ""}{preview.patient_current.deceased_at ? " · deceased" : ""}</p><p className="text-sm">Reviewed DVM: {preview.prescriber.name} · {preview.prescriber.configuration.fields.license_state} {preview.prescriber.configuration.fields.license_number} · license expires {preview.prescriber.configuration.fields.license_expires_on}</p><h5 className="font-medium text-clinical-alert">Current important patient alerts</h5>{preview.alerts.snapshot.important_problems.map(p => <div key={p.id} className="rounded border border-destructive p-2 text-clinical-alert"><p>{p.title} · {p.status}</p><p className="whitespace-pre-wrap">{p.notes}</p></div>)}{!preview.alerts.snapshot.important_problems.length && <p>No structured high-importance problems in this snapshot.</p>}<p className="whitespace-pre-wrap">Existing allergy text: {preview.alerts.snapshot.legacy_allergies.text || "None recorded"}</p><p className="text-xs text-muted-foreground">{preview.alerts.snapshot.legacy_allergies.provenance}</p><UsageEvidence usage={preview.usage} />
      {replacePreview && <div className="space-y-2 rounded-md border p-3"><h5 className="font-medium">New authorization to sign</h5><p>{replacePreview.context.new_sign.patient.name} · {replacePreview.context.new_sign.household.name}</p><p>{replacePreview.context.new_sign.draft.fields.medication.name} · {replacePreview.context.new_sign.draft.fields.medication.strength} · {replacePreview.context.new_sign.draft.fields.medication.form}</p><p className="whitespace-pre-wrap">{replacePreview.context.new_sign.draft.fields.medication.directions}</p><p>Route: {replacePreview.context.new_sign.draft.fields.medication.route}</p><p>New maximum per fill: {replacePreview.context.new_sign.draft.fields.quantity_per_fill} {replacePreview.context.new_sign.draft.fields.unit}; additional refills: {replacePreview.context.new_sign.draft.fields.refills_authorized}</p><p>{replacePreview.context.new_sign.draft.fields.starts_on} through {replacePreview.context.new_sign.draft.fields.expires_on} · {replacePreview.context.new_sign.draft.fields.fulfillment_mode}</p><p className="break-all text-xs">Exact product: {replacePreview.context.new_sign.draft.fields.product_id ?? "external order"}; draft {replacePreview.context.new_sign.draft.id}, revision {replacePreview.context.new_sign.draft.version}</p></div>}
    </section>}
    {operation.state.phase === "review" && <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={ack} disabled={disabled || !isDvm} onChange={e => setAck(e.target.checked)} />{mode === "replace" ? "I reviewed both orders, current patient alerts, manual reconciliation and new allowance. Sign the replacement and retire the original together." : "I reviewed the exact order, reason, current patient alerts and credentials. Cancel this authorization."}</label>}
    {!operation.dirty && <Button variant="outline" disabled={busy || disabled} onClick={() => { setMode(null); setCancelPreview(null); setReplacePreview(null); setAck(false); }}>Discard change review</Button>}
    </section>}
    <PrescriptionOperationControls state={operation.state} error={operation.error} notice={operation.notice} commitLabel={mode === "replace" ? "Sign replacement and retire original" : "Confirm authorization cancellation"} reviewConfirmed={ack && isDvm && !disabled && (mode !== "replace" || !inactive)} onCommit={operation.commit} onRecover={operation.recoverOriginal} onDiscard={() => { operation.discard(); setCancelPreview(null); setReplacePreview(null); setAck(false); }} />
    <section className="space-y-2" aria-label="Authorization event history"><h4 className="font-medium">Immutable authorization events</h4>{loaded && !events.length && <p className="text-sm">No cancellation or replacement events recorded.</p>}{events.map(event => <div key={event.id} className="rounded-md border p-3"><p>{event.action === "cancel" ? "Cancelled" : "Replaced"} · {event.created_at}</p><p className="whitespace-pre-wrap">{event.reason}</p><p className="break-all text-xs text-muted-foreground">Event {event.id} · actor {event.actor_id} · predecessor {event.prior_event_id ?? "none"}</p>{event.reconciliation && <p className="whitespace-pre-wrap text-sm">Native fill review: {event.reconciliation.native_use_note}{"\n"}External use ({event.reconciliation.external_use_status}; manually reviewed): {event.reconciliation.external_use_note}{"\n"}New allowance review: {event.reconciliation.remaining_allowance_note}</p>}</div>)}{cursor && <Button variant="outline" disabled={dirty || busy || disabled} onClick={() => void read(async () => { const page = await api.listEvents(authorization, cursor); if (!alive.current) return; setEvents(previous => [...previous, ...page.events.filter(e => !previous.some(p => p.id === e.id))]); setCursor(page.next_cursor); })}>Load more authorization events</Button>}</section>
    {printHtml && <section className="space-y-2" aria-label="Prescription order copy"><p className="text-sm">This preview reflects status at its displayed check time. Printing always fetches status again.</p><iframe title="Native prescription order copy" sandbox="" srcDoc={printHtml} className="h-[36rem] w-full rounded-md border bg-background" /></section>}
  </section>;
}
