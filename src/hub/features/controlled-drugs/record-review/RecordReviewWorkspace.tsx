import { useEffect, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { RecordReviewQueue } from "./RecordReviewQueue";
import { RecordReviewDialog } from "./RecordReviewDialog";
import { RecordReviewDetail } from "./RecordReviewDetail";
import type { ReviewQueueRequest } from "./queue-model";
import type { createReviewWorkspace } from "./workspace";

export interface RecordReviewWorkspaceProps {
  workspace: ReturnType<typeof createReviewWorkspace>;
  /** Product/site/kind chosen through the owning accepted configuration UI. */
  request: Readonly<Omit<ReviewQueueRequest, "actor_id" | "cursor">>;
}

/** Shared explicit read → open → prepare → confirm/recover presentation.
 * Requires a data-router host and commissioned backend/evidence adapters.
 */
export function RecordReviewWorkspace({ workspace, request }: RecordReviewWorkspaceProps) {
  const state = useSyncExternalStore(workspace.subscribe, workspace.getSnapshot, workspace.getSnapshot);
  const review = useSyncExternalStore(workspace.model.subscribe, workspace.model.getSnapshot, workspace.model.getSnapshot);
  useEffect(() => workspace.connect(), [workspace]);
  const loaded = state.queue.request;
  const sameScope = !loaded || (loaded.product_id === request.product_id && loaded.site_id === request.site_id &&
    loaded.event_kind === request.event_kind && loaded.view === request.view);
  const page = sameScope ? state.queue.page : undefined, detail = sameScope ? state.detail : undefined;
  const busy = sameScope && (state.queue.phase === "loading" || state.detailPhase === "loading");
  const ids = detail?.selection;
  const selection = ids?.actor_id && ids.event_id && ids.policy_id && ids.read_eligibility_id && ids.review_eligibility_id ? {
    actor_id: ids.actor_id, event_id: ids.event_id, policy_id: ids.policy_id,
    read_eligibility_id: ids.read_eligibility_id, review_eligibility_id: ids.review_eligibility_id,
  } : null;
  function refresh() {
    if (busy || !state.identity) return;
    void workspace.refresh({ ...request, actor_id: state.identity.actorId, cursor: null });
  }
  if (!state.identity) return <p role="status" className="text-sm text-muted-foreground">Sign in with an active staff account to review records.</p>;
  return <div className="min-w-0 space-y-6">
    {!sameScope && <p role="status" className="text-sm text-muted-foreground">Filters changed. Load records for the selected product and site.</p>}
    {!sameScope && review.phase !== "idle" && review.phase !== "signed_out" && <p className="text-sm text-muted-foreground">Your existing review remains bound to its original record. Recover or finish that original operation separately from these filters.</p>}
    {sameScope && state.message && <p role="alert" className="text-sm text-destructive">{state.message}</p>}
    {sameScope && state.queue.message && <p role="alert" className="text-sm text-destructive">{state.queue.message}</p>}
    {!page && <Button type="button" className="min-h-11" onClick={refresh} disabled={busy}>Load review records</Button>}
    {page && <RecordReviewQueue page={page} busy={busy} restart={refresh}
      openRecord={eventId => { if (!busy) void workspace.openRecord(eventId); }}
      nextPage={() => { if (!busy) void workspace.nextPage(); }} />}
    {sameScope && state.detailPhase === "loading" && <p role="status" className="text-sm text-muted-foreground">Opening the recorded evidence…</p>}
    {detail && <RecordReviewDetail detail={detail} />}
    <RecordReviewDialog model={workspace.model} selection={selection} />
  </div>;
}
