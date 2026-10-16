import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useAuth } from "@/hub/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import * as api from "./api";
import { actionSchema, emptyValues, modalities, parsePending, viewerUrlSchema, validateSources, type ImagingDetail, type ImagingForm, type ImagingStudy, type PendingImaging } from "./model";

interface Props { petId: string; patientName: string; species: string; inactive: boolean; disabled: boolean; onDirtyChange: (dirty: boolean) => void }
interface ActorProps extends Props { actor: string }
interface Editor { kind: "record" | "correct" | "void"; original: ImagingStudy | null; values: ImagingForm; reason: string }
const selectClass = "min-h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm";
const buttonClass = "min-h-11 whitespace-normal";

export function PatientImaging(props: Props) {
  const { session } = useAuth();
  return session?.user.id ? <ImagingWorkspace key={`${session.user.id}:${props.petId}`} {...props} actor={session.user.id} /> : <p role="alert">Sign in to view imaging studies.</p>;
}
function ImagingWorkspace({ actor, petId, patientName, species, inactive, disabled, onDirtyChange }: ActorProps) {
  const cache = useQueryClient(), key = `lrv:imaging-action:${actor}:${petId}`;
  const [restored] = useState(() => {
    try { const text = sessionStorage.getItem(key); return { pending: text ? parsePending(text, actor, petId) : null, problem: false }; }
    catch { return { pending: null, problem: true }; }
  });
  const [pending, setPending] = useState<PendingImaging | null>(restored.pending);
  const [storageProblem, setStorageProblem] = useState(restored.problem);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null), [previous, setPrevious] = useState<(string | null)[]>([]);
  const [historyBefore, setHistoryBefore] = useState<number | null>(null), [historyPrevious, setHistoryPrevious] = useState<(number | null)[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const lock = useRef(false);
  const dirty = Boolean(editor || pending || storageProblem || busy), frozen = Boolean(disabled || busy || pending || storageProblem);
  useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false); }, [dirty, onDirtyChange]);
  const listKey = ["imaging-studies", actor, petId];
  const list = useQuery({ queryKey: [...listKey, cursor], queryFn: () => api.listStudies(actor, petId, cursor), enabled: !editor && !pending && !storageProblem, refetchOnWindowFocus: !dirty, refetchOnReconnect: !dirty });
  const current = useQuery({ queryKey: ["imaging-study", actor, petId, selected], queryFn: () => api.readStudy(actor, petId, selected!), enabled: Boolean(selected) && !dirty, refetchOnWindowFocus: !dirty, refetchOnReconnect: !dirty });
  const sources = useQuery({ queryKey: ["imaging-sources", actor, petId], queryFn: () => api.readSources(actor, petId), enabled: Boolean(editor && editor.kind !== "void") && !pending && !storageProblem, refetchOnWindowFocus: false, refetchOnReconnect: false, staleTime: 0 });
  const history = useQuery({ queryKey: ["imaging-history", actor, petId, selected, historyBefore], queryFn: () => api.listHistory(actor, petId, selected!, historyBefore), enabled: Boolean(historyOpen && selected) && !dirty, refetchOnWindowFocus: !dirty });
  function persist(value: PendingImaging | null) {
    try { if (value) sessionStorage.setItem(key, JSON.stringify(value)); else sessionStorage.removeItem(key); }
    catch { throw new Error("Browser storage is unavailable. Keep this page open and check the original request before continuing."); }
    setPending(value);
  }
  function choose(id: string) { setSelected(id); setHistoryOpen(false); setHistoryBefore(null); setHistoryPrevious([]); setError(""); setNotice(""); }
  function begin(kind: Editor["kind"], study: ImagingStudy | null = null) {
    if (frozen || editor || (kind === "record" && inactive)) return;
    setEditor({ kind, original: study, values: study ? { ...study.values, identity_verified: false } : emptyValues(), reason: "" });
    setError(""); setNotice("");
    void cache.invalidateQueries({ queryKey: ["imaging-sources", actor, petId] });
  }
  function change<K extends keyof ImagingForm>(field: K, value: ImagingForm[K]) { setEditor(old => old ? { ...old, values: { ...old.values, [field]: value } } : old); }
  async function finish(receipt: ImagingDetail) {
    persist(null); setEditor(null); setStorageProblem(false); choose(receipt.study.id);
    cache.setQueryData(["imaging-study", actor, petId, receipt.study.id], receipt);
    setNotice("Imaging action confirmed. The original study identity and prior versions are retained.");
    await Promise.all([cache.invalidateQueries({ queryKey: listKey }), cache.invalidateQueries({ queryKey: ["imaging-study", actor, petId, receipt.study.id] }), cache.invalidateQueries({ queryKey: ["imaging-history", actor, petId, receipt.study.id] })]);
  }
  async function work(operation: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(""); setNotice("");
    try { await operation(); }
    catch { setError("The imaging operation could not be confirmed. Retain your selections and check saved work before retrying. Reload sources if they changed."); }
    finally { lock.current = false; setBusy(false); }
  }
  async function submit() {
    if (!editor || frozen) return;
    const input = { actor_id: actor, action_id: crypto.randomUUID(), id: editor.original?.id ?? crypto.randomUUID(), pet_id: petId, expected_version: editor.original?.version ?? null, kind: editor.kind, values: editor.kind === "void" ? null : editor.values, reason: editor.reason };
    if (!editor.values.identity_verified) { setError("Confirm that this study and any report belong to the patient shown."); return; }
    const parsed = actionSchema.safeParse(input);
    if (!parsed.success) { setError(parsed.error.issues.map(issue => issue.message).join(". ")); return; }
    const action = parsed.data;
    if (action.values && (action.values.encounter_id || action.values.document_id)) {
      try { if (!sources.data || sources.isFetching || sources.isError) throw new Error("Reload current encounter and PDF choices before saving."); validateSources(action.values, petId, sources.data); }
      catch { setError("Reload and reselect current sources. A PDF associated with an encounter requires that same encounter here."); return; }
    }
    await work(async () => { persist({ action, state: "uncertain" }); await finish(await api.saveStudy(action)); });
  }
  async function recover() {
    if (!pending || disabled) return;
    await work(async () => {
      const receipt = await api.recoverAction(pending.action);
      if (receipt) await finish(receipt);
      else { persist({ action: pending.action, state: "not_saved" }); setNotice("No saved receipt was found for this exact request. Retry the same request, or cancel it before editing so a delayed save cannot arrive afterward."); }
    });
  }
  async function retry() {
    if (!pending || pending.state !== "not_saved" || disabled) return;
    await work(async () => { persist({ action: pending.action, state: "uncertain" }); await finish(await api.saveStudy(pending.action)); });
  }
  async function returnToEditing() {
    if (!pending || pending.state !== "not_saved" || busy || disabled) return;
    const a = pending.action;
    await work(async () => {
      // A read returning null cannot rule out a delayed HTTP write. Cancellation serializes with that original action.
      const result = await api.cancelAction(a);
      if (result.receipt) { await finish(result.receipt); return; }
      if (!result.cancelled) throw new Error("Cancellation unconfirmed");
      persist(null);
      if (a.kind === "record" && a.values) setEditor({ kind: "record", original: null, values: { ...a.values, identity_verified: false }, reason: "" });
      else { setEditor(null); choose(a.id); setNotice("The original request is cancelled. Reload the current study before preparing a new correction or void."); }
    });
  }
  async function openViewer() {
    if (!selected || dirty || disabled) return;
    await work(async () => {
      const latest = await api.readStudy(actor, petId, selected);
      if (!latest || latest.study.status !== "recorded") throw new Error("Unavailable study");
      const url = viewerUrlSchema.parse(latest.study.values.viewer_url);
      openPrivate(url); setNotice("VetRocket opened in a separate tab. Its authorization and link expiry are controlled by VetRocket.");
    });
  }
  async function downloadReport() {
    if (!selected || dirty || disabled) return;
    await work(async () => { const report = await api.reportDownload(actor, petId, selected); openPrivate(report.url, report.name); setNotice("Private report download requested. The download link expires in one minute."); });
  }
  const currentStudy = current.data?.study;
  return <Card>
    <CardHeader><CardTitle>Imaging</CardTitle><p className="text-sm text-muted-foreground">Manually link a VetRocket study and its PDF report to this patient. Images open in VetRocket; automatic PACS synchronization is not connected.</p></CardHeader>
    <CardContent className="min-w-0 space-y-5">
      <div className="rounded-lg border bg-muted/30 p-3"><p className="font-medium">{patientName} · {species}</p><p className="break-all text-xs text-muted-foreground">Patient ID: {petId}</p></div>
      {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}
      {notice && <p role="status" className="text-sm">{notice}</p>}
      {storageProblem && <div className="space-y-2" role="alert"><p>An existing imaging request could not be read from this browser. Restore browser storage access before preparing another save.</p><Button className={buttonClass} variant="outline" onClick={() => {
        try { const text = sessionStorage.getItem(key); setPending(text ? parsePending(text, actor, petId) : null); setStorageProblem(false); setError(""); }
        catch { setError("The original imaging request still cannot be read. Keep this page open and restore browser storage access."); }
      }}>Recheck browser storage</Button></div>}
      {pending && <div className="space-y-3 rounded-lg border border-warning p-4" aria-label="Unconfirmed imaging request">
        <p className="font-medium">Check saved work</p><p className="text-sm">A {pending.action.kind} request needs confirmation. Editing is paused so a connection failure cannot create a duplicate study.</p>
        <p className="break-all text-xs">Study: {pending.action.id} · Request: {pending.action.action_id}</p>
        <div className="flex flex-wrap gap-2"><Button className={buttonClass} disabled={busy || disabled} onClick={() => void recover()}>Check saved work</Button>
          {pending.state === "not_saved" && <><Button className={buttonClass} variant="outline" disabled={busy || disabled} onClick={() => void retry()}>Retry original request</Button><Button className={buttonClass} variant="outline" disabled={busy || disabled} onClick={() => void returnToEditing()}>Cancel request and return to editing</Button></>}
        </div>
      </div>}
      {!editor && !pending && <Button className={buttonClass} disabled={frozen || inactive} onClick={() => begin("record")}>Link imaging study</Button>}
      {inactive && <p className="text-sm text-muted-foreground">Historical studies remain available. New studies cannot be added for an archived or deceased patient.</p>}
      {editor && <form onSubmit={event => { event.preventDefault(); void submit(); }} className="space-y-4 rounded-lg border p-3 md:p-4" aria-label="Imaging study editor">
        <h3 className="font-display text-lg">{editor.kind === "record" ? "Link imaging study" : editor.kind === "correct" ? "Correct imaging details" : "Void imaging record"}</h3>
        {editor.kind === "void" ? <p className="text-sm">Voiding retains this study and its complete history. Its identity cannot be reused or assigned to another patient.</p> : <>
          <fieldset disabled={frozen} className="grid min-w-0 gap-4 md:grid-cols-2">
            <TextField name="account_label" label="VetRocket account / clinic label" value={editor.values.account_label} onChange={value => change("account_label", value)} disabled={editor.kind !== "record"} />
            <TextField name="vendor_patient_id" label="Patient ID in VetRocket" value={editor.values.vendor_patient_id} onChange={value => change("vendor_patient_id", value)} disabled={editor.kind !== "record"} />
            <TextField name="external_study_id" label="VetRocket study ID" value={editor.values.external_study_id} onChange={value => change("external_study_id", value)} disabled={editor.kind !== "record"} />
            <TextField name="accession" label="Accession (optional)" value={editor.values.accession} onChange={value => change("accession", value)} />
            <TextField name="study_date" label="Study date" value={editor.values.study_date} onChange={value => change("study_date", value)} inputType="date" />
            <div className="min-w-0 space-y-1"><Label htmlFor={`imaging-modality-${petId}`}>Modality</Label><select id={`imaging-modality-${petId}`} className={selectClass} value={editor.values.modality} onChange={event => change("modality", event.target.value as ImagingForm["modality"])}>{modalities.map(value => <option key={value} value={value}>{modalityLabel(value)}</option>)}</select></div>
            <TextField name="description" label="Study description" value={editor.values.description} onChange={value => change("description", value)} />
            <TextField name="body_region" label="Body region (optional)" value={editor.values.body_region} onChange={value => change("body_region", value)} />
            <div className="min-w-0 space-y-1 md:col-span-2"><Label htmlFor={`imaging-url-${petId}`}>VetRocket study share link</Label><Input id={`imaging-url-${petId}`} className="min-h-11 min-w-0" type="url" autoComplete="off" value={editor.values.viewer_url} maxLength={2048} onChange={event => change("viewer_url", event.target.value)} /><p className="text-xs text-muted-foreground">Use the study-specific share link from your clinic’s vetrocket.net viewer. A login page or home page cannot identify a study.</p></div>
            <div className="min-w-0 space-y-1"><Label htmlFor={`imaging-encounter-${petId}`}>Encounter (optional)</Label><select id={`imaging-encounter-${petId}`} className={selectClass} value={editor.values.encounter_id ?? ""} onChange={event => { const row = sources.data?.encounters.find(item => item.id === event.target.value); setEditor(old => old ? { ...old, values: { ...old.values, encounter_id: row?.id ?? null, encounter_version: row?.version ?? null } } : old); }}><option value="">No encounter association</option>{editor.values.encounter_id && !sources.data?.encounters.some(row => row.id === editor.values.encounter_id && row.version === editor.values.encounter_version) && <option value={editor.values.encounter_id} disabled>Saved encounter changed — reselect current version</option>}{sources.data?.encounters.map(row => <option key={row.id} value={row.id}>{new Date(row.visit_at).toLocaleDateString()} · {row.status} · v{row.version} · {row.id.slice(0, 8)}</option>)}</select></div>
            <div className="min-w-0 space-y-1"><Label htmlFor={`imaging-report-${petId}`}>Report PDF (optional)</Label><select id={`imaging-report-${petId}`} className={selectClass} value={editor.values.document_id ?? ""} onChange={event => { const row = sources.data?.documents.find(item => item.id === event.target.value); setEditor(old => old ? { ...old, values: { ...old.values, document_id: row?.id ?? null, document_version: row?.version ?? null } } : old); }}><option value="">No report attached</option>{editor.values.document_id && !sources.data?.documents.some(row => row.id === editor.values.document_id && row.version === editor.values.document_version && (!row.encounter_id || row.encounter_id === editor.values.encounter_id)) && <option value={editor.values.document_id} disabled>Saved PDF unavailable or changed — reselect</option>}{sources.data?.documents.filter(row => !row.encounter_id || row.encounter_id === editor.values.encounter_id).map(row => <option key={row.id} value={row.id}>{row.file_name} · v{row.version}</option>)}</select></div>
          </fieldset>
          {editor.kind === "correct" && <p className="text-xs text-muted-foreground">The account, vendor patient ID and study ID are retained permanently. If that identity is wrong, void this record and review it before recording another.</p>}
          <div className="flex flex-wrap items-center gap-2 text-sm"><Button type="button" variant="outline" className={buttonClass} disabled={frozen || sources.isFetching} onClick={() => void sources.refetch()}>Reload encounter and PDF choices</Button>{sources.isFetching && <span role="status">Loading current sources…</span>}{sources.isError && <span role="alert">Sources could not be loaded. Reload before selecting a source.</span>}</div>
          <p className="text-sm text-muted-foreground">Upload a report under <Link className="text-primary underline" to={`?tab=documents&section=documents`}>Documents</Link>, then return here and reload choices. Only a current, ready PDF for this patient can be attached. A report already associated with an encounter requires selecting that encounter above.</p>
          <div className="space-y-1"><Label htmlFor={`imaging-review-${petId}`}>Identity review note</Label><Textarea id={`imaging-review-${petId}`} disabled={frozen} value={editor.values.review_note} maxLength={2000} onChange={event => change("review_note", event.target.value)} placeholder="How you checked the patient and study identity" /></div>
        </>}
        {editor.kind !== "record" && <div className="space-y-1"><Label htmlFor={`imaging-reason-${petId}`}>{editor.kind === "void" ? "Reason for voiding" : "Reason for correction"}</Label><Textarea id={`imaging-reason-${petId}`} value={editor.reason} disabled={frozen} maxLength={1000} onChange={event => setEditor(old => old ? { ...old, reason: event.target.value } : old)} /></div>}
        <label className="flex min-h-11 items-start gap-3 py-2"><input className="mt-1 h-5 w-5 shrink-0 accent-primary" type="checkbox" checked={editor.values.identity_verified} disabled={frozen} onChange={event => change("identity_verified", event.target.checked)} /><span className="min-w-0 text-sm [overflow-wrap:anywhere]">I checked the study and any report against {patientName} ({species}), patient ID {petId}, and confirm this is the correct patient. This confirms identity; it does not claim radiology interpretation or approval.</span></label>
        <div className="flex flex-wrap gap-2"><Button type="submit" className={buttonClass} variant={editor.kind === "void" ? "destructive" : "default"} disabled={frozen}>{editor.kind === "record" ? "Save linked study" : editor.kind === "correct" ? "Save correction" : "Void study"}</Button><Button type="button" className={buttonClass} variant="outline" disabled={Boolean(pending || busy || storageProblem)} onClick={() => { if (window.confirm("Discard these unsaved imaging selections?")) { setEditor(null); setError(""); } }}>Cancel changes</Button></div>
      </form>}
      <div className="space-y-3" aria-label="Patient imaging studies">
        {list.isPending && <p role="status">Loading imaging studies…</p>}
        {list.isError && <p role="alert">Imaging studies could not be loaded. <Button variant="link" disabled={dirty} onClick={() => void list.refetch()}>Retry studies</Button></p>}
        {list.data?.items.length === 0 && <p className="text-sm text-muted-foreground">No imaging studies on this page.</p>}
        <ul className="space-y-2">{list.data?.items.map(detail => <li key={detail.study.id} className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-lg border p-3"><div className="min-w-0"><p className="break-words font-medium">{detail.study.values.description}</p><p className="text-sm text-muted-foreground">{detail.study.values.study_date} · {detail.study.values.modality} · v{detail.study.version}</p><Badge variant={detail.study.status === "void" ? "destructive" : "secondary"}>{detail.study.status === "void" ? "Void — history retained" : "Manually linked"}</Badge></div><Button className={buttonClass} variant="outline" disabled={dirty} onClick={() => choose(detail.study.id)}>View study</Button></li>)}</ul>
        <div className="flex flex-wrap gap-2"><Button className={buttonClass} variant="outline" disabled={dirty || previous.length === 0} onClick={() => { setCursor(previous[previous.length - 1]); setPrevious(old => old.slice(0, -1)); }}>Previous studies</Button><Button className={buttonClass} variant="outline" disabled={dirty || !list.data?.next} onClick={() => { setPrevious(old => [...old, cursor]); setCursor(list.data!.next); }}>Next studies</Button></div>
      </div>
      {selected && <section className="space-y-3 rounded-lg border p-3 md:p-4" aria-label="Selected imaging study">
        {current.isPending && <p role="status">Loading selected study…</p>}
        {current.isError && <p role="alert">Selected study could not be loaded. <Button variant="link" disabled={dirty} onClick={() => void current.refetch()}>Reload study</Button></p>}
        {current.data === null && <p role="alert">This study is unavailable for the current patient.</p>}
        {currentStudy && <><StudySummary study={currentStudy} />
          <p className="text-sm text-muted-foreground">Report: {current.data?.report_available === true ? "Current PDF available" : current.data?.report_available === false ? "Saved PDF changed or is unavailable; its original association is retained" : "No PDF attached"}</p>
          <div className="flex flex-wrap gap-2"><Button className={buttonClass} disabled={dirty || disabled || currentStudy.status !== "recorded"} onClick={() => void openViewer()}>Open VetRocket viewer</Button><Button className={buttonClass} variant="outline" disabled={dirty || disabled || currentStudy.status !== "recorded" || current.data?.report_available !== true} onClick={() => void downloadReport()}>Download current PDF</Button><Button className={buttonClass} variant="outline" disabled={dirty || disabled || currentStudy.status !== "recorded"} onClick={() => begin("correct", currentStudy)}>Correct details</Button><Button className={buttonClass} variant="outline" disabled={dirty || disabled || currentStudy.status !== "recorded"} onClick={() => begin("void", currentStudy)}>Void record</Button><Button className={buttonClass} variant="outline" disabled={dirty} onClick={() => setHistoryOpen(old => !old)}>{historyOpen ? "Hide history" : "View history"}</Button></div>
          <p className="text-xs text-muted-foreground">VetRocket controls access and expiration. If the viewer link no longer works, obtain a current study share link and save a correction. Viewer links are not included in outgoing records.</p>
        </>}
        {historyOpen && <div className="space-y-3" aria-label="Imaging history">
          {history.isPending && <p role="status">Loading imaging history…</p>}
          {history.isError && <p role="alert">History could not be loaded. <Button variant="link" disabled={dirty} onClick={() => void history.refetch()}>Retry history</Button></p>}
          {history.data?.items.map(revision => <article className="space-y-2 rounded-md border p-3" key={revision.version}><StudySummary study={revision.snapshot} /><p className="whitespace-pre-wrap break-words text-sm">{revision.reason || "Original recorded identity"}</p><p className="break-all text-xs text-muted-foreground">Recorded by {revision.actor_id} · {new Date(revision.created_at).toLocaleString()}</p></article>)}
          <div className="flex flex-wrap gap-2"><Button className={buttonClass} variant="outline" disabled={dirty || historyPrevious.length === 0} onClick={() => { setHistoryBefore(historyPrevious[historyPrevious.length - 1]); setHistoryPrevious(old => old.slice(0, -1)); }}>Newer versions</Button><Button className={buttonClass} variant="outline" disabled={dirty || !history.data?.next} onClick={() => { setHistoryPrevious(old => [...old, historyBefore]); setHistoryBefore(history.data!.next); }}>Older versions</Button></div>
        </div>}
      </section>}
    </CardContent>
  </Card>;
}
interface TextFieldProps { name: string; label: string; value: string; onChange: (value: string) => void; disabled?: boolean; inputType?: "date" | "text" }
function TextField({ name, label, value, onChange, disabled, inputType = "text" }: TextFieldProps) {
  return <div className="min-w-0 space-y-1"><Label htmlFor={`imaging-${name}`}>{label}</Label><Input id={`imaging-${name}`} type={inputType} className="min-h-11 min-w-0" value={value} maxLength={160} disabled={disabled} onChange={event => onChange(event.target.value)} /></div>;
}
function modalityLabel(value: string) { return ({ DX: "DX — digital radiography", CR: "CR — computed radiography", US: "US — ultrasound", CT: "CT — computed tomography", MR: "MR — magnetic resonance", IO: "IO — intraoral radiography", ES: "ES — endoscopy", OT: "OT — other" } as Record<string, string>)[value]; }
function StudySummary({ study }: { study: ImagingStudy }) {
  const values = study.values;
  const fields = [["Account", values.account_label], ["Vendor patient ID", values.vendor_patient_id], ["Study ID", values.external_study_id], ["Accession", values.accession || "Not recorded"], ["Study date", values.study_date], ["Modality", modalityLabel(values.modality)], ["Body region", values.body_region || "Not recorded"], ["Encounter", values.encounter_id ? `${values.encounter_id} · v${values.encounter_version}` : "No association"], ["Report document", values.document_id ? `${values.document_id} · v${values.document_version}` : "No report attached"]];
  return <div className="space-y-3"><h3 className="break-words font-display text-lg">{values.description} · v{study.version}</h3><Badge variant={study.status === "void" ? "destructive" : "secondary"}>{study.status === "void" ? "Void — retained history" : "Manually linked"}</Badge><dl className="grid min-w-0 gap-3 text-sm md:grid-cols-2">{fields.map(([label, value]) => <div className="min-w-0" key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="break-words [overflow-wrap:anywhere]">{value}</dd></div>)}</dl><p className="whitespace-pre-wrap break-words text-sm">Identity review: {values.review_note}</p></div>;
}
function openPrivate(url: string, name?: string) {
  const link = document.createElement("a"); link.href = url; link.target = "_blank"; link.rel = "noopener noreferrer"; link.referrerPolicy = "no-referrer";
  if (name) link.download = name;
  link.click();
}
