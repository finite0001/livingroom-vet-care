import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { listAttachmentReviewHistory } from "./attachment-file-api";
import type { AttachmentFileIntent } from "./attachment-file-state";
import type { AttachmentReviewCursor } from "./attachment-review-state";
interface Props { intent: AttachmentFileIntent; disabled: boolean; }
export function AttachmentReviewHistory({ intent, disabled }: Props) {
  const [cursor, setCursor] = useState<AttachmentReviewCursor | null>(null);
  const history = useQuery({ queryKey: ["attachment-review-history", intent.actor, intent.pet, intent.id, cursor], queryFn: () => listAttachmentReviewHistory(intent, cursor), retry: false });
  return <section aria-label="API attachment approval history" className="space-y-2 border-t pt-3">
    <h4 className="text-sm font-medium">API attachment approval history</h4>
    <p className="text-sm text-muted-foreground">Saved staff decisions retain API source provenance. A latest approval can still have an outdated source; it does not authorize release.</p>
    {history.isFetching && <p role="status" className="text-sm">Checking saved approval versions…</p>}
    {history.isError && <p role="alert" className="text-sm">Approval history could not be verified. Recheck before making a review decision.</p>}
    {!history.isFetching && !history.isError && history.data && <>
      {!history.data.records.length && <p className="text-sm">No approval versions are recorded on this page.</p>}
      <ul className="space-y-3">{history.data.records.map(r => <li key={r.id} className="space-y-1 text-sm">
        <p className="font-medium">Version {r.version}: {r.title}</p>
        <p>{r.id === history.data.latest_record_id ? "Latest saved approval" : "Earlier approval version"} · {new Date(r.created_at).toLocaleString()}</p>
        <p className="whitespace-pre-wrap break-words">{r.review_reason}</p>
        <p>Source: ezyVet API attachment {r.attachment_external_id}; {r.source_context.parent.parent_type} {r.source_context.parent.parent_external_id}.</p>
        <p className="break-all text-xs text-muted-foreground">Approval reference: {r.id}. {r.previous_record_id && `Replaces approval ${r.previous_record_id}.`}</p>
      </li>)}</ul>
    </>}
    <div className="flex flex-wrap gap-2"><Button variant="secondary" disabled={disabled || history.isFetching} onClick={() => void history.refetch()}>Recheck approval history</Button>
      <Button variant="secondary" disabled={disabled || history.isFetching || !cursor} onClick={() => setCursor(null)}>Newest approval versions</Button>
      <Button variant="secondary" disabled={disabled || history.isFetching || history.isError || !history.data?.next_cursor} onClick={() => setCursor(history.data!.next_cursor)}>Older approval versions</Button></div>
  </section>;
}
