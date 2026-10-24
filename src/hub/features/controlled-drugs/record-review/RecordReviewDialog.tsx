import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useBlocker } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { RecordReviewWorkflow, type RecordReviewWorkflowProps } from "./RecordReviewWorkflow";

interface DraftStatus {
  model: RecordReviewWorkflowProps["model"];
  revision: number;
  dirty: boolean;
}

/** Unmounted host slice. Requires the accepted lifecycle and a data-router host.
 * Leaving only changes presentation. It never calls a mutation or clears storage.
 */
export function RecordReviewDialog({ model, selection }: Omit<RecordReviewWorkflowProps, "onDraftDirtyChange">) {
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
  const revision = model.getIdentityRevision();
  const [open, setOpen] = useState(false);
  const [closeRequest, setCloseRequest] = useState<Omit<DraftStatus, "dirty"> | null>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const warningReturnFocus = useRef<HTMLElement | null>(null);
  const [draft, setDraft] = useState<DraftStatus | null>(null);
  const dirty = open && state.phase === "idle" && draft?.model === model && draft.revision === revision && draft.dirty;
  const durable = !!state.pointer;
  const inProgress = ["preparing", "recovering", "confirming", "cancelling"].includes(state.phase);
  const needsRecoveryCheck = state.phase === "attention";
  const warn = dirty || durable || inProgress || needsRecoveryCheck;
  const closeRequested = closeRequest?.model === model && closeRequest.revision === revision && warn;
  const blocker = useBlocker(({ currentLocation, nextLocation }) => warn && (
    currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search || currentLocation.hash !== nextLocation.hash));

  useEffect(() => {
    if (!warn) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [warn]);
  useEffect(() => {
    // A completed operation or changed identity may remove the reason to warn.
    // Reset a pending route attempt; never resume navigation automatically.
    if (!warn && blocker.state === "blocked") blocker.reset();
  }, [warn, blocker]);

  const description = durable ? state.phase === "resolved" ?
    "The outcome is confirmed, but recovery storage still needs cleanup. Leaving keeps the recovery pointer so you can finish cleanup later." :
    "This review has a durable recovery operation. Leaving does not sign or cancel it. The original recovery pointer stays saved; return to check that operation before starting another." : inProgress ?
    "A review request is in progress and may already be recorded. Leaving does not sign or cancel it. Return and check recovery before starting another review." : needsRecoveryCheck ?
    "Recovery storage needs checking. Leaving does not resolve any earlier operation. Return and check recovery storage before preparing another review." :
    "Your unsubmitted decision and reason will be discarded. No review request has been submitted.";
  const close = () => { setCloseRequest(null); setDraft(null); setOpen(false); };
  const stay = () => { setCloseRequest(null); if (blocker.state === "blocked") blocker.reset(); };
  const leave = () => { if (blocker.state === "blocked") { setCloseRequest(null); blocker.proceed(); } else close(); };

  return <>
    <Dialog open={open} onOpenChange={next => {
      if (next) { setDraft(null); setOpen(true); }
      else if (warn) setCloseRequest({ model, revision });
      else close();
    }}>
      <DialogTrigger asChild><Button type="button" variant="outline" className="min-h-11">Open record review</Button></DialogTrigger>
      <DialogContent className="max-h-[90dvh] w-[95vw] max-w-4xl overflow-y-auto p-4 md:p-6 [&>button:last-child]:min-h-11 [&>button:last-child]:min-w-11"
        onOpenAutoFocus={event => { event.preventDefault(); title.current?.focus(); }}>
        <DialogHeader className="pr-12 text-left">
          <DialogTitle ref={title} tabIndex={-1} className="font-display text-xl">Record review workspace</DialogTitle>
          <DialogDescription>Prepare, inspect and deliberately confirm a record review. Closing this workspace does not cancel a preparation.</DialogDescription>
        </DialogHeader>
        <RecordReviewWorkflow model={model} selection={selection} onDraftDirtyChange={value => setDraft({ model, revision, dirty: value })} />
      </DialogContent>
    </Dialog>
    <AlertDialog open={closeRequested || blocker.state === "blocked"} onOpenChange={next => { if (!next) stay(); }}>
      <AlertDialogContent onOpenAutoFocus={() => {
        warningReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      }} onCloseAutoFocus={event => {
        event.preventDefault();
        const target = warningReturnFocus.current; warningReturnFocus.current = null;
        if (target?.isConnected) target.focus();
        else if (open) title.current?.focus();
      }}>
        <AlertDialogHeader><AlertDialogTitle>{durable || inProgress || needsRecoveryCheck ? "Leave and recover later?" : "Leave unsubmitted review edits?"}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel className="min-h-11">Stay with review</AlertDialogCancel>
          <AlertDialogAction className="min-h-11" onClick={event => { event.preventDefault(); leave(); }}>{durable || inProgress || needsRecoveryCheck ? "Leave and recover later" : "Discard edits and leave"}</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>;
}
