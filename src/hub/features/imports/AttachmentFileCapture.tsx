import { AttachmentOriginal } from "./AttachmentOriginal";
import { AttachmentCleanupActions } from "./AttachmentCleanupActions";
import { AttachmentCleanupHistory } from "./AttachmentCleanupHistory";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel } from "@/components/ui/alert-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { prepareAttachmentFile, recoverAttachmentFile, captureAttachmentFile, abandonAttachmentFile } from "./attachment-file-api";
import { parseAttachmentFileIntent, attachmentFileCanCapture, AttachmentFileActionError } from "./attachment-file-state";
import type { AttachmentFileIntent, AttachmentFileRecovery } from "./attachment-file-state";
import type { AttachmentMapping, AttachmentObservation, AttachmentParent } from "./attachment-discovery-state";
interface Props { actor: string; mapping: AttachmentMapping; file: AttachmentObservation; parent: AttachmentParent; parentCurrent: boolean; disabled: boolean; onLocked: (id: string, locked: boolean, busy?: boolean) => void; }
export function AttachmentFileCapture({ actor, mapping, file, parent, parentCurrent, disabled, onLocked }: Props) {
  const [inspectionBusy, setInspectionBusy] = useState(false);
  const [cleanupLocked, setCleanupLocked] = useState(false), [cleanupBusy, setCleanupBusy] = useState(false);
  const onCleanupState = useCallback((locked: boolean, working: boolean) => { setCleanupLocked(locked); setCleanupBusy(working); }, []);
  const queryClient = useQueryClient();
  const identity = `${file.run_id}:${file.page}:${file.snapshot_id}:${file.observed_head_version}`;
  const key = `lrv-attachment-file:${actor}:${mapping.pet_id}:${identity}`;
  const [intent, setIntent] = useState<AttachmentFileIntent | null>(null);
  const [saved, setSaved] = useState<AttachmentFileRecovery | null>(null);
  const [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false);
  const [confirmAbandon, setConfirmAbandon] = useState(false);
  const [invalidPointer, setInvalidPointer] = useState(false);
  const [notice, setNotice] = useState("");
  const lock = useRef(false), alive = useRef(true);
  // Pinned source identity is immutable for this keyed file card.
  const context = useRef({ actor, mapping, file, parent });
  useEffect(() => {
    alive.current = true;
    try {
      const value = sessionStorage.getItem(key);
      if (value) { const parsed = parseAttachmentFileIntent(JSON.parse(value), context.current.actor, context.current.mapping); if (`${parsed.runId}:${parsed.page}:${parsed.snapshotId}:${parsed.headVersion}` !== identity) throw new Error("Different source"); setIntent(parsed); setUncertain(true); setNotice("An earlier file request is retained. Recheck it before continuing."); }
    } catch { setNotice("The local file reference could not be read. Saved request history must be recovered before preparing another copy."); setInvalidPointer(true); }
    return () => { alive.current = false; onLocked(identity, false, false); };
  }, [identity, key, onLocked]);
  useEffect(() => { onLocked(identity, busy || uncertain || cleanupLocked || inspectionBusy, busy || cleanupBusy || inspectionBusy); }, [identity, busy, uncertain, cleanupLocked, cleanupBusy, inspectionBusy, onLocked]);
  async function act(action: "prepare" | "recover" | "capture" | "abandon") {
    if (inspectionBusy || cleanupLocked || lock.current || (action !== "recover" && disabled)) return;
    lock.current = true; setBusy(true); setNotice("");
    let current = intent;
    try {
      if (!current) {
        if (action !== "prepare" || !parentCurrent || !file.is_current) throw new AttachmentFileActionError("Select current source evidence before preparing a copy.");
        current = parseAttachmentFileIntent({ id: crypto.randomUUID(), actor, pet: mapping.pet_id, runId: file.run_id, page: file.page, snapshotId: file.snapshot_id, payloadHash: file.payload_hash, headVersion: file.observed_head_version, externalId: file.external_id, parent, name: file.metadata.name || `Source attachment ${file.external_id}` }, actor, mapping);
        sessionStorage.setItem(key, JSON.stringify(current)); setIntent(current);
      }
      setUncertain(true);
      let state = action === "prepare" ? await prepareAttachmentFile(current) : await recoverAttachmentFile(current);
      if (!alive.current) return;
      let abandonmentNotice = "";
      if (action === "abandon" && (!state || (state.status === "pending" && !state.worker?.lease_active))) {
        try { await abandonAttachmentFile(current); } catch { abandonmentNotice = "Abandonment response was unconfirmed. The saved request has been rechecked."; }
        state = await recoverAttachmentFile(current);
        if (!alive.current) return;
      }
      if (!state) { setSaved(null); setNotice("No saved file request is visible yet. Keep this reference and retry preparation unchanged; an earlier request may still complete."); return; }
      current = state.requestHash ? { ...current, requestHash: state.requestHash } : current;
      sessionStorage.setItem(key, JSON.stringify(current)); setIntent(current);
      let captureNotice = abandonmentNotice;
      if (action === "capture" && attachmentFileCanCapture(state)) {
        try { await captureAttachmentFile(current); } catch (error) { captureNotice = error instanceof AttachmentFileActionError ? error.message : "Capture response was unconfirmed."; }
        state = await recoverAttachmentFile(current);
        if (!alive.current) return;
        if (!state) throw new AttachmentFileActionError("Saved file request is unavailable. Retain its reference and recheck.");
      }
      setSaved(state); setUncertain(false);
      void queryClient.invalidateQueries({ queryKey: ["attachment-file-history", actor, mapping.pet_id] });
      setNotice(state.captured ? "Private source copy captured. Clinical review is still required." : state.status === "abandoned" ? "This file request was abandoned. It cannot be resumed." : captureNotice || "File request recovered. Capture uses the saved source context and private Storage.");
    } catch (error) {
      if (alive.current) { setUncertain(!!current); setNotice(error instanceof AttachmentFileActionError ? error.message : "File request is unconfirmed. Recheck it before continuing."); }
    } finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  function startAnother() {
    if (saved?.status !== "abandoned" || busy || disabled || cleanupLocked) return;
    try { sessionStorage.removeItem(key); setIntent(null); setSaved(null); setUncertain(false); setNotice("The abandoned request remains in history. Prepare a new request only if this source is still current."); }
    catch { setNotice("The local reference could not be cleared. Keep the saved request and restore browser storage access."); }
  }
  return <div className="space-y-2 border-t pt-3">
    <AlertDialog open={confirmAbandon} onOpenChange={setConfirmAbandon}>
      <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Abandon this file request?</AlertDialogTitle><AlertDialogDescription>This prevents further capture under this request ID. Captured evidence cannot be abandoned. Removing any reserved temporary file is a separate cleanup step.</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel>Keep file request</AlertDialogCancel><Button variant="secondary" onClick={() => { setConfirmAbandon(false); void act("abandon"); }}>Confirm file abandonment</Button></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    {notice && <p role={uncertain ? "alert" : "status"} className="text-sm">{notice}</p>}
    {saved?.worker?.lease_active && <p role="status" className="text-sm">A capture worker is active. Recheck before another attempt.</p>}
    {saved?.worker?.retry_after && <p className="text-sm">Capture retry time: {new Date(saved.worker.retry_after).toLocaleString()}.</p>}
    {saved?.worker?.retryable === false && <p className="text-sm">The saved capture failure requires source review before another request.</p>}
    {saved?.captured && <p className="text-sm">Captured source size: {saved.fileSize?.toLocaleString()} bytes.</p>}
    {intent && <p className="break-all text-xs text-muted-foreground">File request reference: {intent.id}</p>}
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" disabled={inspectionBusy || cleanupLocked || busy || disabled || invalidPointer || !!saved || (!intent && (!parentCurrent || !file.is_current))} onClick={() => void act("prepare")}>{intent ? "Retry original file preparation" : "Prepare private file copy"}</Button>
      <Button variant="secondary" disabled={inspectionBusy || cleanupLocked || busy || !intent} onClick={() => void act("recover")}>Recheck file request</Button>
      <Button variant="secondary" disabled={inspectionBusy || cleanupLocked || busy || disabled || !intent || saved?.status === "captured" || saved?.status === "abandoned" || saved?.worker?.lease_active} onClick={() => setConfirmAbandon(true)}>Abandon file request</Button>
      {saved?.status === "abandoned" && <Button variant="secondary" disabled={inspectionBusy || cleanupLocked || busy || disabled || !parentCurrent || !file.is_current} onClick={startAnother}>Start another file request</Button>}
      <Button variant="secondary" disabled={inspectionBusy || cleanupLocked || busy || disabled || uncertain || !saved || !attachmentFileCanCapture(saved)} onClick={() => void act("capture")}>Capture file privately</Button>
    </div>
    {intent && saved?.captured && !uncertain && <AttachmentOriginal key={intent.id} intent={intent} disabled={busy || disabled} onBusy={setInspectionBusy} />}
    {intent && saved?.status === "abandoned" && !uncertain && (saved.cleanupIntentHash ? <AttachmentCleanupActions key={intent.id} intent={intent} intentHash={saved.cleanupIntentHash} disabled={busy || disabled} onState={onCleanupState} /> : <AttachmentCleanupHistory key={intent.id} intent={intent} disabled={busy || disabled} />)}
  </div>;
}
