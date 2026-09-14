import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel } from "@/components/ui/alert-dialog";
import { AttachmentCleanupHistory } from "./AttachmentCleanupHistory";
import { recoverAttachmentFile, recoverAttachmentCleanup, runAttachmentCleanup } from "./attachment-file-api";
import { AttachmentFileActionError, type AttachmentFileIntent } from "./attachment-file-state";
import { parseAttachmentCleanupOperation, type AttachmentCleanupOperation, type parseAttachmentCleanupRecovery } from "./attachment-cleanup-state";
interface Props { intent: AttachmentFileIntent; intentHash: string; disabled: boolean; onState: (locked: boolean, busy: boolean) => void; }
export function AttachmentCleanupActions({ intent, intentHash, disabled, onState }: Props) {
  const key = `lrv-attachment-cleanup:${intent.actor}:${intent.pet}:${intent.id}`;
  const [op, setOp] = useState<AttachmentCleanupOperation | null>(null);
  const [saved, setSaved] = useState<ReturnType<typeof parseAttachmentCleanupRecovery>>(null);
  const [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false), [invalid, setInvalid] = useState(false);
  const [confirm, setConfirm] = useState<"same" | "new" | null>(null), [notice, setNotice] = useState("");
  const queryClient = useQueryClient(), lock = useRef(false), alive = useRef(true);
  const context = useRef({ intent, intentHash });
  useEffect(() => {
    alive.current = true;
    try { const value = sessionStorage.getItem(key); if (value) { setOp(parseAttachmentCleanupOperation(JSON.parse(value), context.current.intent, context.current.intentHash)); setUncertain(true); setNotice("An earlier cleanup reference is retained. Recheck that attempt before continuing."); } }
    catch { setInvalid(true); setNotice("The local cleanup reference could not be read. Recover a saved cleanup attempt from history."); }
    return () => { alive.current = false; onState(false, false); };
  }, [key, onState]);
  useEffect(() => { onState(busy || uncertain, busy); }, [busy, uncertain, onState]);
  const active = !!saved && !saved.receipt && Date.parse(saved.attempt.lease_until) > Date.now();
  async function act(mode: "recover" | "same" | "new", selectedId?: string) {
    if (lock.current || (disabled && mode !== "recover")) return;
    lock.current = true; setBusy(true); setNotice("");
    let current = op, tracked = !!op;
    try {
      const file = await recoverAttachmentFile(intent);
      if (!file || file.status !== "abandoned" || file.captured || file.cleanupIntentHash !== intentHash) throw new AttachmentFileActionError("The abandoned reserved file could not be verified. No cleanup was started.");
      if (selectedId && current && selectedId !== current.id) {
        const prior = await recoverAttachmentCleanup(current);
        if (!prior || (!prior.receipt && Date.parse(prior.attempt.lease_until) > Date.now())) throw new AttachmentFileActionError("The current cleanup attempt is unresolved. Recover its original reference before selecting another.");
      }
      if (selectedId) current = parseAttachmentCleanupOperation({ id: selectedId, request: intent.id, actor: intent.actor, pet: intent.pet, requestHash: intent.requestHash, intentHash }, intent, intentHash);
      if (mode === "new") {
        if (invalid) throw new AttachmentFileActionError("Recover the saved cleanup reference first.");
        if (current) {
          const prior = await recoverAttachmentCleanup(current);
          if (!prior || (!prior.receipt && Date.parse(prior.attempt.lease_until) > Date.now())) throw new AttachmentFileActionError("The previous cleanup attempt is unresolved. Recheck or retry its original reference.");
        }
        current = parseAttachmentCleanupOperation({ id: crypto.randomUUID(), request: intent.id, actor: intent.actor, pet: intent.pet, requestHash: intent.requestHash, intentHash }, intent, intentHash);
      }
      if (!current) throw new AttachmentFileActionError("Select a saved cleanup attempt first.");
      // Persist before a mutation; history selection is validated before repairing the pointer.
      if (mode === "new") { sessionStorage.setItem(key, JSON.stringify(current)); tracked = true; setOp(current); setUncertain(true); }
      let state = await recoverAttachmentCleanup(current);
      if (!alive.current) return;
      if (selectedId && !state) throw new AttachmentFileActionError("That saved cleanup attempt is unavailable. The local reference was retained.");
      sessionStorage.setItem(key, JSON.stringify(current)); tracked = true; setOp(current); setInvalid(false); setUncertain(true);
      let message = "";
      if (mode !== "recover" && !state?.receipt && (!state || Date.parse(state.attempt.lease_until) > Date.now())) {
        try { await runAttachmentCleanup(current); } catch (error) { message = error instanceof AttachmentFileActionError ? error.message : "Cleanup response was unconfirmed."; }
        state = await recoverAttachmentCleanup(current);
        if (!alive.current) return;
      }
      setSaved(state);
      setUncertain(!state || (!state.receipt && Date.parse(state.attempt.lease_until) > Date.now()));
      setNotice(state?.receipt ? `Storage absence verified at ${new Date(state.receipt.verified_absent_at).toLocaleString()}. This is a point-in-time receipt.` : message || (state ? "No absence receipt is recorded. Recheck an active attempt; an expired attempt requires a new explicit sweep." : "No saved cleanup attempt is visible. Retain this reference and retry the same attempt; an earlier call may still complete."));
      void queryClient.invalidateQueries({ queryKey: ["attachment-cleanup-history", intent.actor, intent.pet, intent.id] });
    } catch (error) {
      if (alive.current) { setUncertain(tracked); setNotice(error instanceof AttachmentFileActionError ? error.message : tracked ? "Cleanup is unconfirmed. Retain the original reference and recheck." : "The cleanup reference could not be saved or verified. No cleanup was started."); }
    } finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  return <div className="space-y-2">
    <AlertDialog open={confirm !== null} onOpenChange={open => { if (!open) setConfirm(null); }}>
      <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Clean up this abandoned temporary file?</AlertDialogTitle><AlertDialogDescription>This removes only the reserved private copy for this abandoned request. Captured clinical evidence is protected. The request and cleanup receipts remain in history. The server checks eligibility and the grace period before removal.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep temporary file</AlertDialogCancel><Button variant="secondary" onClick={() => { const mode = confirm; setConfirm(null); if (mode) void act(mode); }}>Confirm temporary file cleanup</Button></AlertDialogFooter></AlertDialogContent>
    </AlertDialog>
    {notice && <p role={uncertain ? "alert" : "status"} className="text-sm">{notice}</p>}
    {op && <p className="break-all text-xs text-muted-foreground">Current cleanup reference: {op.id}</p>}
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" disabled={busy || disabled || invalid || uncertain || active || (!!op && !saved)} onClick={() => setConfirm("new")}>{op ? "Start a new cleanup sweep" : "Clean up temporary file"}</Button>
      <Button variant="secondary" disabled={busy || !op} onClick={() => void act("recover")}>Recheck cleanup attempt</Button>
      <Button variant="secondary" disabled={busy || disabled || !op || !!saved?.receipt || (!!saved && !active)} onClick={() => setConfirm("same")}>Retry original cleanup</Button>
    </div>
    <AttachmentCleanupHistory intent={intent} disabled={busy || disabled} onRecover={id => void act("recover", id)} />
  </div>;
}
