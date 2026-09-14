import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { prepareAttachmentFile, recoverAttachmentFile, captureAttachmentFile } from "./attachment-file-api";
import { parseAttachmentFileIntent, attachmentFileCanCapture, AttachmentFileActionError } from "./attachment-file-state";
import type { AttachmentFileIntent, AttachmentFileRecovery } from "./attachment-file-state";
import type { AttachmentMapping, AttachmentObservation, AttachmentParent } from "./attachment-discovery-state";
interface Props { actor: string; mapping: AttachmentMapping; file: AttachmentObservation; parent: AttachmentParent; parentCurrent: boolean; disabled: boolean; onLocked: (id: string, locked: boolean, busy?: boolean) => void; }
export function AttachmentFileCapture({ actor, mapping, file, parent, parentCurrent, disabled, onLocked }: Props) {
  const queryClient = useQueryClient();
  const identity = `${file.run_id}:${file.page}:${file.snapshot_id}:${file.observed_head_version}`;
  const key = `lrv-attachment-file:${actor}:${mapping.pet_id}:${identity}`;
  const [intent, setIntent] = useState<AttachmentFileIntent | null>(null);
  const [saved, setSaved] = useState<AttachmentFileRecovery | null>(null);
  const [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false);
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
  useEffect(() => { onLocked(identity, busy || uncertain, busy); }, [identity, busy, uncertain, onLocked]);
  async function act(action: "prepare" | "recover" | "capture") {
    if (lock.current || (action !== "recover" && disabled)) return;
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
      if (!state) { setSaved(null); setNotice("No saved file request is visible yet. Keep this reference and retry preparation unchanged; an earlier request may still complete."); return; }
      current = { ...current, requestHash: state.requestHash };
      sessionStorage.setItem(key, JSON.stringify(current)); setIntent(current);
      let captureNotice = "";
      if (action === "capture" && attachmentFileCanCapture(state)) {
        try { await captureAttachmentFile(current); } catch (error) { captureNotice = error instanceof AttachmentFileActionError ? error.message : "Capture response was unconfirmed."; }
        state = await recoverAttachmentFile(current);
        if (!alive.current) return;
        if (!state) throw new AttachmentFileActionError("Saved file request is unavailable. Retain its reference and recheck.");
      }
      setSaved(state); setUncertain(false);
      void queryClient.invalidateQueries({ queryKey: ["attachment-file-history", actor, mapping.pet_id] });
      setNotice(state.captured ? "Private source copy captured. Clinical review is still required." : captureNotice || (state.status === "abandoned" ? "This file request was abandoned. It cannot be resumed." : "File request recovered. Capture uses the saved source context and private Storage."));
    } catch (error) {
      if (alive.current) { setUncertain(!!current); setNotice(error instanceof AttachmentFileActionError ? error.message : "File request is unconfirmed. Recheck it before continuing."); }
    } finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  return <div className="space-y-2 border-t pt-3">
    {notice && <p role={uncertain ? "alert" : "status"} className="text-sm">{notice}</p>}
    {saved?.worker?.lease_active && <p role="status" className="text-sm">A capture worker is active. Recheck before another attempt.</p>}
    {saved?.worker?.retry_after && <p className="text-sm">Capture retry time: {new Date(saved.worker.retry_after).toLocaleString()}.</p>}
    {saved?.worker?.retryable === false && <p className="text-sm">The saved capture failure requires source review before another request.</p>}
    {saved?.captured && <p className="text-sm">Captured source size: {saved.fileSize?.toLocaleString()} bytes.</p>}
    {intent && <p className="break-all text-xs text-muted-foreground">File request reference: {intent.id}</p>}
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" disabled={busy || disabled || invalidPointer || !!saved || (!intent && (!parentCurrent || !file.is_current))} onClick={() => void act("prepare")}>{intent ? "Retry original file preparation" : "Prepare private file copy"}</Button>
      <Button variant="secondary" disabled={busy || !intent} onClick={() => void act("recover")}>Recheck file request</Button>
      <Button variant="secondary" disabled={busy || disabled || uncertain || !saved || !attachmentFileCanCapture(saved)} onClick={() => void act("capture")}>Capture file privately</Button>
    </div>
  </div>;
}
