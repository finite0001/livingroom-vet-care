import { AttachmentFileHistory } from "./AttachmentFileHistory";
import type { AttachmentFileIntent } from "./attachment-file-state";
import { AttachmentFileCapture } from "./AttachmentFileCapture";
import { AttachmentScanPreparation } from "./AttachmentScanPreparation";
import { AttachmentPageError, attachmentPageError } from "./attachment-page-errors";
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { searchMappings } from "./clinical-api";
import { listAttachmentRuns, listAttachmentObservations, recoverAttachmentRun, stageAttachmentPage } from "./attachment-discovery-api";
import type { AttachmentMapping, AttachmentHistoryCursor, AttachmentObservationCursor, AttachmentRun } from "./attachment-discovery-state";
import { attachmentScanCanContinue } from "./attachment-discovery-state";
interface Props { actor: string; onDirtyChange: (dirty: boolean) => void; }
interface SelectedMapping extends AttachmentMapping { patient_name: string; household_name: string; }
export function AttachmentScanHistory({ actor, onDirtyChange }: Props) {
  const [locked, setLocked] = useState(false);
  useEffect(() => { onDirtyChange(locked); }, [locked, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);
  const [search, setSearch] = useState("");
  const [mapping, setMapping] = useState<SelectedMapping | null>(null);
  const patients = useQuery({ queryKey: ["attachment-patients", actor, search], enabled: search.trim().length >= 2, queryFn: () => searchMappings(search), retry: false });
  return <section aria-label="Attachment scan history" className="space-y-4 rounded-md border p-4">
    <div><h2 className="text-xl font-semibold">Source attachment history</h2><p className="text-sm text-muted-foreground">Find files observed in your saved ezyVet scans. Source files require review before they become part of the medical record.</p></div>
    <label className="block">Find attachment history patient<Input disabled={locked} value={search} onChange={event => setSearch(event.target.value)} maxLength={200} /></label>
    {patients.isFetching && <p role="status">Finding mapped patients…</p>}
    {patients.isError && <p role="alert">Patient search is unavailable. Try again without changing the saved scan.</p>}
    {patients.data?.length === 0 && <p>No mapped patients match this search.</p>}
    {/* searchMappings validates these required fields; the project's non-strict null typing makes its inferred fields optional. */}
    <div className="flex flex-wrap gap-2">{patients.data?.map(item => <Button key={item.link_id} disabled={locked} variant="secondary" aria-pressed={mapping?.link_id === item.link_id} onClick={() => setMapping(item as SelectedMapping)}>{item.patient_name} · {item.household_name}</Button>)}</div>
    {mapping && <PatientScans key={`${actor}:${mapping.link_id}`} actor={actor} mapping={mapping} onLocked={setLocked} />}
  </section>;
}
interface PatientProps { actor: string; mapping: SelectedMapping; onLocked: (locked: boolean) => void; }
function PatientScans({ actor, mapping, onLocked }: PatientProps) {
  const [locked, setLocked] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [fileBusy, setFileBusy] = useState(false);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [focusedFile, setFocusedFile] = useState<AttachmentFileIntent | null>(null);
  useEffect(() => { onLocked(locked || preparing || historyBusy); }, [locked, preparing, historyBusy, onLocked]);
  const [cursor, setCursor] = useState<AttachmentHistoryCursor | null>(null);
  const [selected, setSelected] = useState<AttachmentRun | null>(null);
  const scans = useQuery({ queryKey: ["attachment-scans", actor, mapping.link_id, cursor], queryFn: () => listAttachmentRuns(actor, mapping, cursor), retry: false });
  useEffect(() => { if (scans.data) setSelected(previous => previous ? scans.data.runs.find(item => item.id === previous.id) ?? previous : null); }, [scans.data]);
  const labels = { running: "Scan in progress", review_ready: "Scan complete", page_limit_reached: "Scan limit reached" };
  return <div className="space-y-3">
    <p className="font-medium">Selected patient: {mapping.patient_name} · {mapping.household_name}</p>
    <AttachmentScanPreparation actor={actor} mapping={mapping} disabled={locked || historyBusy} onLocked={setPreparing} onCreated={run => { setFocusedFile(null); setSelected(run); setCursor(null); }} />
    <AttachmentFileHistory actor={actor} mapping={mapping} disabled={fileBusy || preparing} onLocked={setHistoryBusy} onOpen={(run, intent) => { setFocusedFile(intent); setSelected(run); }} />
    {scans.isFetching && <p role="status">Loading saved attachment scans…</p>}
    {scans.isError && <p role="alert">Saved attachment scans are unavailable. Recheck before choosing a file.</p>}
    {!scans.isError && scans.data?.runs.length === 0 && <p>No saved attachment scans on this page.</p>}
    {!scans.isError && scans.data?.runs.map(item => <div key={item.id} className="flex flex-wrap items-center gap-2 rounded border p-3">
      <Badge variant="secondary">{item.parent_context.parent_type === "Animal" ? "Patient files" : `Consultation ${item.parent_context.parent_external_id}`}</Badge>
      <span>{labels[item.status]} · {new Date(item.created_at).toLocaleString()}</span>
      <Button variant="secondary" disabled={locked || preparing || historyBusy} onClick={() => { setFocusedFile(null); setSelected(item); }} aria-pressed={selected?.id === item.id}>View files from scan {item.id.slice(0, 8)}</Button>
    </div>)}
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" disabled={scans.isFetching} onClick={() => void scans.refetch()}>Refresh attachment scans</Button>
      <Button variant="secondary" disabled={!cursor || scans.isFetching} onClick={() => setCursor(null)}>Newest attachment scans</Button>
      <Button variant="secondary" disabled={scans.isFetching || scans.isError || !scans.data?.next_cursor} onClick={() => setCursor(scans.data?.next_cursor ?? null)}>Older attachment scans</Button>
    </div>
    {selected && !preparing && <ScanFiles key={`${selected.id}:${focusedFile?.id ?? "history"}`} initialFile={focusedFile} disabled={historyBusy} onWorking={setFileBusy} actor={actor} mapping={mapping} scan={selected} onLocked={setLocked} />}
  </div>;
}
interface FilesProps extends PatientProps { scan: AttachmentRun; disabled?: boolean; initialFile?: AttachmentFileIntent | null; onWorking?: (busy: boolean) => void; }
function ScanFiles({ actor, mapping, scan, onLocked, initialFile, disabled = false, onWorking }: FilesProps) {
  const [scanLocked, setScanLocked] = useState(false);
  const [fileLocks, setFileLocks] = useState<Record<string, boolean>>({});
  const fileLocked = Object.values(fileLocks).some(Boolean);
  const [workingFiles, setWorkingFiles] = useState<Record<string, boolean>>({});
  const anyFileBusy = Object.values(workingFiles).some(Boolean);
  const updateFileLock = useCallback((id: string, locked: boolean, busy = false) => {
    setFileLocks(previous => previous[id] === locked ? previous : { ...previous, [id]: locked });
    setWorkingFiles(previous => previous[id] === busy ? previous : { ...previous, [id]: busy });
  }, []);
  useEffect(() => { onWorking?.(anyFileBusy); }, [anyFileBusy, onWorking]);
  useEffect(() => () => onWorking?.(false), [onWorking]);
  useEffect(() => { onLocked(scanLocked || fileLocked); }, [scanLocked, fileLocked, onLocked]);
  useEffect(() => () => onLocked(false), [onLocked]);
  const [cursor, setCursor] = useState<AttachmentObservationCursor | null>(initialFile ? { after_page: initialFile.page!, after_snapshot_id: "00000000-0000-0000-0000-000000000000" } : null);
  const files = useQuery({ queryKey: ["attachment-observations", actor, mapping.link_id, scan.id, cursor], queryFn: () => listAttachmentObservations(scan.id, mapping, scan.parent_context, cursor), retry: false });
  return <section aria-label="Files observed in selected scan" className="space-y-3">
    <h3 className="font-semibold">Files observed in this scan</h3>
    <AttachmentScanActions actor={actor} mapping={mapping} scan={scan} onLocked={setScanLocked} disabled={fileLocked || disabled} />
    <p className="text-sm text-muted-foreground">{scan.status === "running" ? "This scan is still in progress. The list includes only pages already saved." : scan.status === "page_limit_reached" ? "The scan reached its limit. More source files may remain." : "This scan completed for the selected patient or consultation. It does not establish complete migration of the patient's records."}</p>
    {files.isFetching && <p role="status">Loading observed files…</p>}
    {files.isError && <p role="alert">File evidence is unavailable or changed unexpectedly. Recheck the saved scan.</p>}
    {!files.isError && files.data && <>
      {!files.data.parent_is_current && <p role="status">The patient or consultation source has changed since this scan. These original observations are retained for review.</p>}
      {files.data.observations.length === 0 && <p>No observed files on this page.</p>}
      {files.data.observations.map(file => <article key={`${file.page}:${file.snapshot_id}`} className="space-y-2 rounded border p-3">
        <h4 className="break-words font-medium">{file.metadata.name || `Source attachment ${file.external_id}`}{file.metadata.name_truncated ? "… (name shortened)" : ""}</h4>
        <div className="flex flex-wrap gap-2"><Badge variant="secondary">{file.is_current ? "Latest observed file revision" : "File source changed"}</Badge><span className="text-sm">{file.metadata.mime_type || "File type not supplied"}</span></div>
        {file.metadata.mime_type && !["application/pdf", "image/jpeg", "image/png", "application/octet-stream"].includes(file.metadata.mime_type.toLowerCase().split(";")[0].trim()) && <p className="text-sm">This file type needs separate review; it is not supported by the current file capture process.</p>}
        {file.metadata.notes && <p className="whitespace-pre-wrap break-words text-sm">{file.metadata.notes}{file.metadata.notes_truncated ? "\nNotes preview shortened; full source evidence is retained." : ""}</p>}
        <AttachmentFileCapture actor={actor} mapping={mapping} file={file} parent={scan.parent_context} parentCurrent={files.data.parent_is_current} disabled={disabled || scanLocked || Object.entries(fileLocks).some(([id, locked]) => locked && id !== `${file.run_id}:${file.page}:${file.snapshot_id}:${file.observed_head_version}`)} onLocked={updateFileLock} />
        <p className="text-xs text-muted-foreground">Source attachment {file.external_id} · saved page {file.page} · observed revision {file.observed_head_version}</p>
      </article>)}
    </>}
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" disabled={files.isFetching || fileLocked || scanLocked || disabled} onClick={() => void files.refetch()}>Recheck observed files</Button>
      <Button variant="secondary" disabled={!cursor || files.isFetching || fileLocked || scanLocked || disabled} onClick={() => setCursor(null)}>First file page</Button>
      <Button variant="secondary" disabled={files.isFetching || fileLocked || scanLocked || disabled || files.isError || !files.data?.next_cursor} onClick={() => setCursor(files.data?.next_cursor ?? null)}>Next file page</Button>
    </div>
  </section>;
}

function AttachmentScanActions({ actor, mapping, scan, onLocked, disabled = false }: FilesProps) {
  const queryClient = useQueryClient();
  const [current, setCurrent] = useState(scan);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [notice, setNotice] = useState("");
  const [sourceFailure, setSourceFailure] = useState<AttachmentPageError | null>(null);
  const lock = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; onLocked(false); }; }, [onLocked]);
  useEffect(() => { onLocked(busy || uncertain); }, [busy, uncertain, onLocked]);
  async function act(readPage: boolean) {
    if (lock.current || disabled) return;
    lock.current = true; setBusy(true); setNotice("");
    try {
      let recovered = await recoverAttachmentRun(actor, mapping, scan);
      if (!alive.current) return;
      setCurrent(recovered); setUncertain(false);
      let pageError: AttachmentPageError | null = null;
      if (readPage && !sourceFailure?.requiresNewScan && attachmentScanCanContinue(recovered)) {
        setUncertain(true);
        try { await stageAttachmentPage(actor, mapping, recovered); setSourceFailure(null); } catch (error) { pageError = error instanceof AttachmentPageError ? error : attachmentPageError(undefined); if (alive.current) setSourceFailure(pageError); }
        // Both success and a lost response require the authoritative saved state.
        recovered = await recoverAttachmentRun(actor, mapping, scan);
        if (!alive.current) return;
        setCurrent(recovered); setUncertain(false);
      }
      setNotice(pageError ? "The page response was unconfirmed. Saved scan state was recovered; review it before another request." : recovered.status === "running" ? "Saved scan recovered. Recheck after any active scan or provider cooldown ends." : "Saved scan is complete or has reached its limit. No additional pages will be requested.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["attachment-scans", actor, mapping.link_id] }),
        queryClient.invalidateQueries({ queryKey: ["attachment-observations", actor, mapping.link_id, scan.id] }),
      ]);
    } catch {
      if (alive.current) { setUncertain(true); setNotice("Scan state is unconfirmed. Recheck this original saved scan before changing patients or requesting another page."); }
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return <div className="space-y-2 rounded border p-3">
    <p className="text-sm">Saved scan: {current.status === "running" ? `next page ${current.next_page}` : current.status === "review_ready" ? "complete" : "page limit reached"}. Reading a page saves source metadata for review.</p>
    {current.lease_active && <p role="status">Another request is active for this scan. Recheck its saved state.</p>}
    {current.retry_after && <p className="text-sm">Provider retry time: {new Date(current.retry_after).toLocaleString()}.</p>}
    {sourceFailure && <p role="alert">{sourceFailure.message}</p>}
    {notice && <p role={uncertain ? "alert" : "status"}>{notice}</p>}
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" disabled={busy || disabled} onClick={() => void act(false)}>Recheck saved attachment scan</Button>
      <Button variant="secondary" disabled={busy || disabled || uncertain || !!sourceFailure?.requiresNewScan || !attachmentScanCanContinue(current)} onClick={() => void act(true)}>Read next attachment page</Button>
    </div>
  </div>;
}
