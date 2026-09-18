import { useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { FileText } from "lucide-react";
import type { ConversationEmailReview } from "@/hub/features/communications/conversation-email-review";

interface AttachmentEmailReviewDialogProps {
  review: ConversationEmailReview;
  open: boolean;
  busy?: boolean;
  onClose: () => void;
  onInspect: (uploadId: string) => Promise<void>;
  onQueue: (requestId: string, payloadHash: string) => Promise<void>;
}

/** Mount only after an owned captured request has passed review-response validation. */
export function AttachmentEmailReviewDialog({ review, open, busy = false, onClose, onInspect, onQueue }: AttachmentEmailReviewDialogProps) {
  const identity = `${review.requestId}:${review.payloadHash}`;
  const [attested, setAttested] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<{ identity: string; message: string } | null>(null);
  const running = useRef(false);
  const disabled = busy || working;
  const operate = async (action: () => Promise<void>) => {
    if (disabled || running.current) return;
    running.current = true;
    setWorking(true);
    setError(null);
    try { await action(); }
    catch (cause) { setError({ identity, message: cause instanceof Error ? cause.message : "This action could not be confirmed. Recover the saved email before retrying." }); }
    finally { running.current = false; setWorking(false); }
  };
  const close = () => { if (!disabled) { setAttested(null); onClose(); } };
  return (
    <Dialog open={open} onOpenChange={next => { if (!next) close(); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl" onEscapeKeyDown={event => { if (disabled) event.preventDefault(); }} onInteractOutside={event => { if (disabled) event.preventDefault(); }}>
        <DialogHeader>
          <DialogTitle>Review email and attachments</DialogTitle>
          <DialogDescription>Check the recipient, message, and files before adding this email to the outgoing queue.</DialogDescription>
        </DialogHeader>
        <dl className="space-y-3 text-sm">
          <div><dt className="font-medium text-muted-foreground">To</dt><dd className="break-all">{review.payload.to}</dd></div>
          <div><dt className="font-medium text-muted-foreground">Subject</dt><dd className="break-words">{review.payload.subject}</dd></div>
        </dl>
        <div className="whitespace-pre-wrap break-words rounded-md border bg-muted/30 p-3 text-sm">{review.payload.body}</div>
        <ul aria-label="Email attachments" className="space-y-2">
          {review.files.map(file => (
            <li key={file.uploadId} className="flex items-center gap-3 rounded-md border p-3">
              <FileText aria-hidden="true" className="h-5 w-5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1"><p className="break-words text-sm font-medium">{file.name}</p><p className="text-xs text-muted-foreground">{(file.size / 1024).toFixed(1)} KB · {file.mimeType}</p></div>
              <Button type="button" variant="outline" size="sm" disabled={disabled} aria-label={`Download ${file.name} for review`} onClick={() => void operate(() => onInspect(file.uploadId))}>Download file</Button>
            </li>
          ))}
        </ul>
        {review.receipt ? <p role="status" className="text-sm">This email is already queued. Current status: {review.receipt.state}.</p> : (
          <div className="flex items-start gap-3">
            <Checkbox id="attachment-email-reviewed" checked={attested === identity} disabled={disabled} onCheckedChange={checked => setAttested(checked === true ? identity : null)} />
            <Label htmlFor="attachment-email-reviewed" className="text-sm leading-relaxed">I reviewed the recipient, message, and attached files.</Label>
          </div>
        )}
        {error?.identity === identity && <p role="alert" className="text-sm text-destructive">{error.message}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={disabled} onClick={close}>Close</Button>
          {!review.receipt && <Button type="button" disabled={disabled || attested !== identity} onClick={() => void operate(() => onQueue(review.requestId, review.payloadHash))}>{working ? "Working…" : "Queue email"}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
