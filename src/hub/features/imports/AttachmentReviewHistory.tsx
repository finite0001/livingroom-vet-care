import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { captureRpc } from "./attachment-capture-api";
import { parseReviewHistory } from "./attachment-review-history";
import type { ReviewCursor } from "./attachment-review-history";
import type { OriginalCapture } from "./attachment-capture-state";
interface Props { actor: string; capture: OriginalCapture; disabled: boolean }
export function AttachmentReviewHistory({ actor, capture, disabled }: Props) {
  const [cursor, setCursor] = useState<ReviewCursor | null>(null);
  const [authorized, setAuthorized] = useState(true);
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user.id !== actor) setAuthorized(false);
    });
    return () => data.subscription.unsubscribe();
  }, [actor]);
  const history = useQuery({
    queryKey: ["attachment-review-history", actor, capture.id, capture.capture?.capture_hash, cursor],
    enabled: authorized && !disabled && capture.status === "ready", retry: false,
    queryFn: async () => {
      const before = await supabase.auth.getSession();
      if (before.error || before.data.session?.user.id !== actor) throw new Error("Session changed");
      const result = await captureRpc("list_ezyvet_attachment_record_versions", {
        p_request_id: capture.id, p_pet_id: capture.pet_id,
        p_before_at: cursor?.before_at ?? null, p_before_id: cursor?.before_id ?? null, p_limit: 20,
      });
      const after = await supabase.auth.getSession();
      if (after.error || after.data.session?.user.id !== actor) throw new Error("Session changed");
      return parseReviewHistory(result, capture, cursor);
    },
  });
  if (!authorized) return null;
  return <section aria-label="Original review history" className="space-y-2 border-t pt-3">
    <h4 className="font-semibold">Original review history</h4>
    {history.isPending && <p role="status">Loading review history…</p>}
    {history.isError && <p role="alert">Review history unavailable. Refresh to try again.</p>}
    {!history.isError && history.data?.records.length === 0 && <p>No saved reviews on this page.</p>}
    {!history.isError && history.data?.records.map(record => <article key={record.id} className="rounded border p-2">
      <p className="font-medium">{record.title} · Version {record.version}{record.id === history.data.latest_record_id ? " · Latest review" : " · Earlier review"}</p>
      <p className="text-sm text-muted-foreground">{record.review_reason}</p>
      <p className="text-sm text-muted-foreground">{record.created_at}</p>
    </article>)}
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" disabled={disabled || history.isFetching} onClick={() => void history.refetch()}>Refresh review history</Button>
      <Button variant="outline" disabled={disabled || history.isFetching || !cursor} onClick={() => setCursor(null)}>Newest reviews</Button>
      <Button variant="outline" disabled={disabled || history.isFetching || history.isError || !history.data?.next_cursor} onClick={() => setCursor(history.data!.next_cursor)}>Older reviews</Button>
    </div>
  </section>;
}
