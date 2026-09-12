import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import type { useMessageQueue } from "@/hub/hooks/use-message-queue";
import type { MessageIntent } from "@/hub/features/communications/queue-intent";
interface Props {
  queue: ReturnType<typeof useMessageQueue>;
  hasDraft: boolean;
  onRestore: (payload: MessageIntent) => void | Promise<void>;
  onAcknowledged?: (payload: MessageIntent | null) => void;
}
export function MessageRecoveryPanel({
  queue,
  hasDraft,
  onRestore,
  onAcknowledged,
}: Props) {
  const [confirm, setConfirm] = useState<"restore" | "discard" | null>(null);
  const [working, setWorking] = useState(false);
  const recovery = queue.recovery;
  if (!recovery) return null;
  const busy = queue.pending || working;
  const run = async (work: () => Promise<unknown>) => {
    setWorking(true);
    try {
      await work();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Recovery could not be confirmed. The saved request is retained.",
      );
    } finally {
      setWorking(false);
      setConfirm(null);
    }
  };
  const restore = () =>
    run(async () => {
      if (recovery.payload) await onRestore(recovery.payload);
    });
  return (
    <section
      aria-label="Saved message recovery"
      className="space-y-2 rounded-md border border-border bg-background p-3 text-sm"
    >
      {recovery.status === "loading" ? (
        <p role="status">Checking for a saved message…</p>
      ) : (
        <>
          <p className="font-semibold">
            {recovery.receipt
              ? "This message is already queued"
              : recovery.status === "prepared"
                ? "A saved message needs review"
                : "Message preparation is not confirmed"}
          </p>
          {recovery.receipt ? (
            <p>
              Recorded status: <strong>{recovery.receipt.state}</strong>.
              Recovery will not send it again.
            </p>
          ) : (
            <p>
              {recovery.error ??
                "Restore the exact saved draft to retry, or explicitly discard this request before composing a different message."}
            </p>
          )}
          {recovery.payload && (
            <details>
              <summary className="cursor-pointer">
                Review saved recipient and content
              </summary>
              <p className="mt-2 break-all">
                {recovery.payload.channel} to {recovery.payload.to}
              </p>
              {recovery.payload.subject && (
                <p>Subject: {recovery.payload.subject}</p>
              )}
              <p className="max-h-32 overflow-auto whitespace-pre-wrap break-words">
                {recovery.payload.body}
              </p>
            </details>
          )}
          <div className="flex flex-wrap gap-2">
            {recovery.receipt ? (
              <Button
                size="sm"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const result = await queue.acknowledgeRecovery();
                    onAcknowledged?.(result?.payload ?? recovery.payload);
                    toast.success("Existing queued message acknowledged.");
                  })
                }
              >
                Acknowledge queued message
              </Button>
            ) : (
              <>
                {recovery.payload && (
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      if (hasDraft) setConfirm("restore");
                      else void restore();
                    }}
                  >
                    Restore saved draft
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void run(() => queue.recover())}
                >
                  Retry recovery
                </Button>
                {recovery.requestId && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => setConfirm("discard")}
                  >
                    Discard saved request
                  </Button>
                )}
              </>
            )}
          </div>
        </>
      )}
      <AlertDialog
        open={!!confirm}
        onOpenChange={(open) => {
          if (!busy && !open) setConfirm(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm === "restore"
                ? "Replace the current draft?"
                : "Discard this saved request?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === "restore"
                ? "The saved recipient, channel, subject and message will replace the current draft. This does not send anything."
                : "This prevents an unqueued request from sending, including a delayed preparation. If it was already queued, its existing receipt will be acknowledged; this cannot unsend it. Your current typed draft is kept."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>
              Keep current state
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={() => {
                if (confirm === "restore") void restore();
                else
                  void run(async () => {
                    const result = await queue.discardRecovery();
                    if (result?.receipt) {
                      onAcknowledged?.(result.payload);
                      toast.success(
                        `Already queued: ${result.receipt.state}. Existing receipt acknowledged.`,
                      );
                    } else
                      toast.success(
                        "Saved request discarded. Current draft kept.",
                      );
                  });
              }}
            >
              {confirm === "restore"
                ? "Replace with saved draft"
                : "Confirm discard"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
