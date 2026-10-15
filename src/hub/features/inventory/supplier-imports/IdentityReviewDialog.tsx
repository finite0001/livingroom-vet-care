import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useUnsavedChanges } from "../../clinical/use-unsaved-changes";
import type { useIdentityReview } from "./use-identity-review.ts";
interface DialogProps {
  title: string; description: string; dirty: boolean; busy: boolean; pending: boolean;
  close: () => void; children: ReactNode;
}
export function IdentityReviewDialog({ title, description, dirty, busy, pending, close, children }: DialogProps) {
  const guard = useUnsavedChanges(dirty, "This supplier review has unsaved or unconfirmed changes. Check its saved result before leaving");
  function dismiss() {
    if (busy) return;
    if (!dirty || window.confirm(pending ? "Leave this unconfirmed review? Its recovery remains available under Supplier products for this reviewer" : "Discard this unsaved supplier review?")) close();
  }
  return <><Dialog open onOpenChange={(open) => { if (!open) dismiss(); }}><DialogContent
    className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl [&_button]:min-h-11 [&_button]:min-w-11 [&_input]:min-h-11 [&_button]:h-auto [&_button]:whitespace-normal [&_button]:break-words [&>button]:min-w-11">
    <DialogHeader><DialogTitle className="font-display pr-8">{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
    {children}<Button type="button" variant="outline" disabled={busy} onClick={dismiss}>Close supplier review</Button>
  </DialogContent></Dialog>{guard}</>;
}
interface StatusProps { action: ReturnType<typeof useIdentityReview>; canReview: boolean }
export function IdentityReviewStatus({ action, canReview }: StatusProps) {
  return <div className="space-y-2" aria-live="polite">
    {action.error && <p role="alert" className="text-sm text-destructive">{action.error}</p>}
    {action.busy && <p role="status">Checking reviewed inventory work…</p>}
    {action.pending && !action.busy && <div className="rounded-xl border bg-muted/40 p-3 space-y-2">
      <p className="text-sm">This review is unconfirmed. Keep its details unchanged while checking</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" className="min-h-11" onClick={() => void action.recover()}>Check saved supplier review</Button>
        {canReview && <Button type="button" className="min-h-11" variant="outline" onClick={() => void action.retry()}>Retry original supplier review</Button>}
        <Button type="button" className="min-h-11" variant="outline" onClick={() => {
          if (window.confirm("Close this unconfirmed review safely? Any saved result will be recovered first")) void action.closeReview();
        }}>Close unconfirmed supplier review</Button>
      </div>
    </div>}
  </div>;
}
