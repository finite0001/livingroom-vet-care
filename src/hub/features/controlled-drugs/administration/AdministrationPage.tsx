import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useReviewStaffSessions } from "../record-review/staff-session-context.ts";
import type { ReviewStaffSessionSource } from "../record-review/staff-session.ts";
import type { ReviewIdentity } from "../record-review/raw-rpc.ts";
import { createAdministrationClient, type AdministrationClient } from "./query-client.ts";
import type { AdministrationOptions } from "./queries.ts";
import { AdministrationWorkspace } from "./AdministrationWorkspace";
interface SessionAdministrationPageProps { readonly sessions: ReviewStaffSessionSource; readonly identity: ReviewIdentity; readonly client: AdministrationClient }
function SessionAdministrationPage({ sessions, identity, client }: SessionAdministrationPageProps) {
  const [options, setOptions] = useState<AdministrationOptions | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const inflight = useRef(false), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function load() {
    if (inflight.current || !sessions.isCurrent(identity)) return;
    inflight.current = true; setBusy(true); setError("");
    try { const value = await client.options({ schema_version: 1, actor_id: identity.actorId, cursor: null, page_size: 100 }, identity); if (alive.current && sessions.isCurrent(identity)) setOptions(value); }
    catch { if (alive.current && sessions.isCurrent(identity)) setError("Administrator setup could not be loaded. A current administrator account and the installed backend are required."); }
    finally { inflight.current = false; if (alive.current && sessions.isCurrent(identity)) setBusy(false); }
  }
  return <main className="mx-auto min-w-0 max-w-5xl space-y-6 p-4 md:p-6"><header className="space-y-2"><h1 className="font-display text-2xl">Narcotics log setup</h1><p className="text-sm text-muted-foreground">Register stock, establish an opening, and configure staff permissions and independent review.</p><Button asChild variant="outline" className="min-h-11"><Link to="/hub/inventory/narcotics">Back to narcotics log</Link></Button></header>{error && <p role="alert" className="text-destructive">{error}</p>}{options ? <AdministrationWorkspace sessions={sessions} identity={identity} client={client} options={options} onOptionsPage={setOptions} /> : <Button type="button" className="min-h-11" disabled={busy} onClick={() => void load()}>{busy ? "Loading administrator records…" : "Load administrator records"}</Button>}</main>;
}
export function AdministrationPage() {
  const sessions = useReviewStaffSessions(), identity = useSyncExternalStore(sessions.subscribe, sessions.getSnapshot, sessions.getSnapshot);
  const client = useMemo(() => { try { return createAdministrationClient({ projectRef: import.meta.env.VITE_SUPABASE_PROJECT_ID, url: import.meta.env.VITE_SUPABASE_URL, publishableKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY }, sessions); } catch { return null; } }, [sessions]);
  if (!identity) return <p role="status" className="p-4">Sign in with an active administrator account to configure the narcotics log.</p>;
  if (!client) return <p role="alert" className="p-4">The administrator connection is unavailable. Check the application configuration.</p>;
  return <SessionAdministrationPage key={`${identity.actorId}:${identity.sessionId}:${identity.generation}`} sessions={sessions} identity={identity} client={client} />;
}
