import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { listAttachmentCleanupHistory } from "./attachment-file-api";
import type { AttachmentFileIntent } from "./attachment-file-state";
import type { AttachmentCleanupCursor } from "./attachment-cleanup-state";
interface Props { intent: AttachmentFileIntent; disabled: boolean; onRecover?: (id: string) => void; }
export function AttachmentCleanupHistory({ intent, disabled, onRecover }: Props) {
  const [cursor, setCursor] = useState<AttachmentCleanupCursor | null>(null);
  const history = useQuery({ queryKey: ["attachment-cleanup-history", intent.actor, intent.pet, intent.id, intent.requestHash, cursor], queryFn: () => listAttachmentCleanupHistory(intent, cursor), retry: false });
  return <section aria-label="Temporary file cleanup history" className="space-y-2 border-t pt-3">
    <h4 className="text-sm font-medium">Temporary file cleanup history</h4>
    <p className="text-sm text-muted-foreground">Abandonment does not delete a file. A cleanup receipt records when absence was verified; it does not guarantee the file remains absent.</p>
    {history.isFetching && <p role="status" className="text-sm">Checking saved cleanup attempts…</p>}
    {history.isError && <p role="alert" className="text-sm">Cleanup history could not be verified. No file deletion is confirmed.</p>}
    {!history.isFetching && !history.isError && history.data && <>
      {history.data.cleanups.length === 0 && <p className="text-sm">No cleanup attempts are recorded on this page.</p>}
      <ul className="space-y-2">{history.data.cleanups.map(row => <li key={row.attempt.id} className="text-sm">
        <p>{row.receipt ? `Storage absence verified at ${new Date(row.receipt.verified_absent_at).toLocaleString()}.` : row.lease_active ? "Cleanup worker is active. Recheck for a saved receipt." : "Cleanup attempt ended without an absence receipt."}</p>
        <p className="break-all text-xs text-muted-foreground">Cleanup reference: {row.attempt.id}</p>
        {onRecover && <Button variant="secondary" disabled={disabled} onClick={() => onRecover(row.attempt.id)}>Recover cleanup {row.attempt.id.slice(0, 8)}</Button>}
      </li>)}</ul>
    </>}
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" disabled={disabled || history.isFetching} onClick={() => void history.refetch()}>Recheck cleanup history</Button>
      <Button variant="secondary" disabled={disabled || history.isFetching || !cursor} onClick={() => setCursor(null)}>Newest cleanup attempts</Button>
      <Button variant="secondary" disabled={disabled || history.isFetching || history.isError || !history.data?.next_cursor} onClick={() => setCursor(history.data!.next_cursor)}>Older cleanup attempts</Button>
    </div>
  </section>;
}
