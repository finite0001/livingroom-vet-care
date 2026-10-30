import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Link, Navigate, Outlet, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useReviewStaffSessions } from "../record-review/staff-session-context.ts";
import { createRecoveryClient } from "./client.ts";
import type { RecoveryStatus } from "./schema.ts";

/** A visible staff gate; database admission remains the authority for every write. */
export function NarcoticsOperationalBoundary() {
  const sessions = useReviewStaffSessions(), identity = useSyncExternalStore(sessions.subscribe, sessions.getSnapshot, sessions.getSnapshot), location = useLocation();
  const [state, setState] = useState<{ status: RecoveryStatus | null; error: boolean }>({ status: null, error: false }), [revision, setRevision] = useState(0);
  const client = useMemo(() => {
    try { return createRecoveryClient({ projectRef: import.meta.env.VITE_SUPABASE_PROJECT_ID, url: import.meta.env.VITE_SUPABASE_URL, publishableKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY }, sessions); }
    catch { return null; }
  }, [sessions]);
  useEffect(() => {
    let active = true; setState({ status: null, error: false });
    if (client && identity) void client.status(identity).then(status => { if (active && sessions.isCurrent(identity)) setState({ status, error: false }); })
      .catch(() => { if (active && sessions.isCurrent(identity)) setState({ status: null, error: true }); });
    return () => { active = false; };
  }, [client, identity, location.pathname, revision, sessions]);
  if (!identity) return <p role="status" className="p-4">Sign in with an active staff account to open the narcotics log.</p>;
  if (state.status?.mode === "armed") return <Navigate to="/hub/inventory/narcotics/recovery" replace />;
  return <><nav aria-label="Narcotics tools" className="flex flex-wrap gap-2 px-4 pt-4 md:px-6">
    <Button asChild variant="outline" className="min-h-11"><Link to="/hub/inventory/narcotics/reports">Reports and supporting files</Link></Button>
    <Button asChild variant="outline" className="min-h-11"><Link to="/hub/inventory/narcotics/recovery">Backup and recovery</Link></Button></nav>
    {!client || state.error ? <section className="space-y-3 p-4 md:p-6"><p role="alert">Narcotics access could not be confirmed. Check your staff login and application connection.</p>
      <Button type="button" variant="outline" className="min-h-11" onClick={() => setRevision(value => value + 1)}>Check access again</Button></section>
      : !state.status ? <p role="status" className="p-4">Checking narcotics access…</p>
        : !state.status.fresh_session ? <p role="alert" className="p-4">Sign out and sign in again after recovery, then reopen the narcotics log.</p> : <Outlet />}
  </>;
}
