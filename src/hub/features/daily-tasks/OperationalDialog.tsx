import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useUnsavedChanges } from "../clinical/use-unsaved-changes";
import type { useOperationalAction } from "./use-task-action";
interface OperationalDialogProps {
  title: string;
  description: string;
  dirty: boolean;
  busy: boolean;
  pending: boolean;
  close: () => void;
  children: ReactNode;
}
export function OperationalDialog({
  title,
  description,
  dirty,
  busy,
  pending,
  close,
  children,
}: OperationalDialogProps) {
  const guard = useUnsavedChanges(
    dirty,
    "This operational review has unsaved or unconfirmed work. Check its saved result before leaving.",
  );
  function dismiss() {
    if (busy) return;
    if (
      !dirty ||
      window.confirm(
        pending
          ? "Leave this unconfirmed review? Its recovery remains available under Operational recovery."
          : "Discard this unsaved operational review?",
      )
    )
      close();
  }
  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) dismiss();
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto [&_button]:whitespace-normal [&_button]:min-h-11 [&_button]:h-auto [&_button]:break-words sm:max-w-2xl [&>button]:min-h-11 [&>button]:min-w-11">
          <DialogHeader>
            <DialogTitle className="pr-8 break-words">{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          {children}
          <Button
            className="min-h-11"
            variant="outline"
            type="button"
            disabled={busy}
            onClick={dismiss}
          >
            Close operational review
          </Button>
        </DialogContent>
      </Dialog>
      {guard}
    </>
  );
}
interface OperationalActionStatusProps {
  action: ReturnType<typeof useOperationalAction>;
}
export function OperationalActionStatus({
  action,
}: OperationalActionStatusProps) {
  return (
    <div className="space-y-2" aria-live="polite">
      {action.error && (
        <p role="alert" className="text-sm text-destructive">
          {action.error}
        </p>
      )}
      {action.busy && (
        <p role="status" className="text-sm">
          Saving reviewed work…
        </p>
      )}
      {action.pending && !action.busy && (
        <div className="space-y-2 rounded-xl border p-3">
          <p className="text-sm">
            This save is unconfirmed. Keep it unchanged while checking.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              className="min-h-11"
              type="button"
              onClick={() => void action.checkSaved()}
            >
              Check saved work
            </Button>
            <Button
              className="min-h-11"
              type="button"
              variant="outline"
              onClick={() => void action.retry()}
            >
              Retry unchanged save
            </Button>
            <Button
              className="min-h-11"
              type="button"
              variant="outline"
              onClick={() => {
                if (
                  window.confirm(
                    "Cancel this unconfirmed action? Any committed result will be recovered first.",
                  )
                )
                  void action.release();
              }}
            >
              Cancel unconfirmed action
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
