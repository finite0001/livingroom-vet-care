import { useMemo, useSyncExternalStore } from "react";
import { Link, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useReviewStaffSessions } from "./staff-session-context";
import type { ReviewStaffSessionSource } from "./staff-session";
import type { ReviewIdentity } from "./raw-rpc";
import { createStaffRecordReviewWorkspace } from "./staff-workspace";
import { RecordReviewWorkspace } from "./RecordReviewWorkspace";
import { reviewEventKindSchema, reviewQueueRequestSchema, type ReviewQueueRequest } from "./queue-model";
import { reviewEventLabels } from "./review-labels";
import { reviewUuidSchema } from "./request";

interface StaffRegisterProps {
  readonly sessions: ReviewStaffSessionSource;
  readonly identity: ReviewIdentity;
  readonly request: Readonly<Omit<ReviewQueueRequest, "actor_id" | "cursor">>;
}
function StaffRegister({ sessions, identity, request }: StaffRegisterProps) {
  const connection = useMemo(() => {
    try {
      const config = { projectRef: import.meta.env.VITE_SUPABASE_PROJECT_ID, url: import.meta.env.VITE_SUPABASE_URL,
        publishableKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY };
      return createStaffRecordReviewWorkspace(config, sessions);
    } catch { return null; }
  }, [sessions]);
  if (!sessions.isCurrent(identity)) return <p role="status">Sign in again to load current record access.</p>;
  if (!connection) return <p role="alert">Record review is unavailable. Check the application connection and use a secure browser with recovery storage enabled.</p>;
  return <RecordReviewWorkspace workspace={connection} request={request} />;
}
/** The URL selects a scope, never authority. Every list, detail, preparation and
 * signature is independently authorized by the backend for the current login. */
interface RecordReviewPageProps { readonly exceptions?: boolean }
export function RecordReviewPage({ exceptions = false }: RecordReviewPageProps) {
  const sessions = useReviewStaffSessions(), identity = useSyncExternalStore(sessions.subscribe, sessions.getSnapshot, sessions.getSnapshot);
  const { productId, siteId, eventKind } = useParams();
  const scope = useMemo(() => {
    if (!identity) return null;
    const product = reviewUuidSchema.safeParse(productId), site = reviewUuidSchema.safeParse(siteId);
    const kind = reviewEventKindSchema.safeParse(eventKind);
    if (!product.success || !exceptions && (!site.success || !kind.success)) return null;
    const parsed = reviewQueueRequestSchema.safeParse({ actor_id: identity.actorId, product_id: product.data, site_id: exceptions ? null : site.data,
      event_kind: exceptions ? null : kind.data, view: exceptions ? "exceptions" : "site", page_size: 50, cursor: null });
    if (!parsed.success) return null;
    const { actor_id: _actor, cursor: _cursor, ...request } = parsed.data;
    return request as Omit<ReviewQueueRequest, "actor_id" | "cursor">;
  }, [identity, productId, siteId, eventKind, exceptions]);
  return <main className="mx-auto min-w-0 max-w-5xl space-y-6 p-4 md:p-6">
    <header className="space-y-3"><h1 className="font-display text-2xl">Controlled-drug record review</h1>
      {scope && <h2 className="font-display text-xl">{exceptions ? "Records with unproven site" : reviewEventLabels[scope.event_kind!]}</h2>}
      <p className="text-sm text-muted-foreground">Read the recorded evidence before preparing an independent review. A signature records your review of the record.</p>
      <Button asChild variant="outline" className="min-h-11"><Link to="/hub/inventory/narcotics/records">Choose record access</Link></Button>
    </header>
    {!identity ? <p role="status">Sign in with an active staff account to review records.</p> : !scope ? <p role="alert">This record-review link is incomplete. Choose a medication and record type from the narcotics log.</p> :
      <StaffRegister key={`${identity.actorId}:${identity.sessionId}:${identity.generation}:${productId}:${siteId}:${eventKind}:${exceptions}`} sessions={sessions} identity={identity} request={scope} />}
  </main>;
}
