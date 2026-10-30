import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useReviewStaffSessions } from "./staff-session-context";
import type { ReviewStaffSessionSource } from "./staff-session";
import type { ReviewIdentity } from "./raw-rpc";
import { createReviewReadRpc } from "./read-rpc";
import { verifyReviewScopeReply, type ReviewScopeCursor, type ReviewScopeReply } from "./scope-discovery";
import { reviewEventLabels } from "./review-labels";
interface StaffScopeChooserProps { readonly sessions: ReviewStaffSessionSource; readonly identity: ReviewIdentity }
function StaffScopeChooser({ sessions, identity }: StaffScopeChooserProps) {
  const reads = useMemo(() => {
    try { return createReviewReadRpc({ projectRef: import.meta.env.VITE_SUPABASE_PROJECT_ID, url: import.meta.env.VITE_SUPABASE_URL,
      publishableKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY }, sessions); } catch { return null; }
  }, [sessions]);
  const [page, setPage] = useState<Readonly<ReviewScopeReply> | null>(null), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const alive = useRef(true), inflight = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function load(cursor: ReviewScopeCursor | null = null) {
    if (!reads || inflight.current || !sessions.isCurrent(identity)) return;
    const check = () => { if (!alive.current || !sessions.isCurrent(identity)) throw new Error("Staff login changed"); };
    inflight.current = true; setBusy(true); setMessage("");
    try {
      const request = { schema_version: 1 as const, actor_id: identity.actorId, cursor, page_size: 100 };
      const response = await reads.call("discover_controlled_record_review_scopes_v1", request, identity, check); check();
      const value = verifyReviewScopeReply(request, response); check(); setPage(value);
    } catch { if (alive.current && sessions.isCurrent(identity)) setMessage("Record access could not be loaded. Confirm your login or ask an administrator to check register access."); }
    finally { inflight.current = false; if (alive.current && sessions.isCurrent(identity)) setBusy(false); }
  }
  if (!reads) return <p role="alert">The record-review connection is unavailable.</p>;
  return <section className="space-y-4" aria-label="Choose records to review">
    <p className="text-sm text-muted-foreground">Choose from the medications, sites and record types your current account can read.</p>
    {message && <p role="alert" className="text-destructive">{message}</p>}
    <Button type="button" className="min-h-11" disabled={busy} onClick={() => void load()}>{busy ? "Loading record access…" : "Load record access"}</Button>
    {page && !page.items.length && <p role="status">No register scopes are authorized for your account. Ask an administrator to review your register access.</p>}
    {page && <ul className="space-y-4">{page.items.map(item => <li key={`${item.product_id}:${item.view}:${item.site_id ?? ""}`} className="min-w-0 space-y-3 rounded-xl border p-4">
      <h2 className="break-words font-display text-lg">{item.product_name}</h2>
      <p className="break-words text-sm text-muted-foreground">{item.view === "exceptions" ? "Records whose site could not be established" : item.site_name}</p>
      <div className="flex flex-wrap gap-2">{item.view === "exceptions" ? <Button asChild variant="outline" className="min-h-11"><Link to={`/hub/inventory/narcotics/records/${item.product_id}/exceptions`}>Open site exceptions</Link></Button> :
        item.event_kinds.map(kind => <Button key={kind} asChild variant="outline" className="min-h-11 max-w-full whitespace-normal text-left"><Link to={`/hub/inventory/narcotics/${item.product_id}/${item.site_id}/records/${encodeURIComponent(kind)}`}>{reviewEventLabels[kind]}</Link></Button>)}</div>
    </li>)}</ul>}
    {page?.has_more && <Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={() => void load(page.next_cursor)}>More record access</Button>}
  </section>;
}
export function RecordReviewScopeChooser() {
  const sessions = useReviewStaffSessions(), identity = useSyncExternalStore(sessions.subscribe, sessions.getSnapshot, sessions.getSnapshot);
  return <main className="mx-auto min-w-0 max-w-5xl space-y-6 p-4 md:p-6">
    <header className="space-y-3"><h1 className="font-display text-2xl">Controlled-drug records</h1>
      <Button asChild variant="outline" className="min-h-11"><Link to="/hub/inventory/narcotics">Back to narcotics log</Link></Button></header>
    {!identity ? <p role="status">Sign in with an active staff account to read records.</p> : <StaffScopeChooser key={`${identity.actorId}:${identity.sessionId}:${identity.generation}`} sessions={sessions} identity={identity} />}
  </main>;
}
