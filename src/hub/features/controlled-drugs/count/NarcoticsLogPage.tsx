import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Link, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useReviewStaffSessions } from "../record-review/staff-session-context.ts";
import type { ReviewIdentity } from "../record-review/raw-rpc.ts";
import type { ReviewStaffSessionSource } from "../record-review/staff-session.ts";
import { createCountClient, type CountClient } from "./count-client.ts";
import { browserCountOperationLock, createCountOperationController } from "./count-operation-controller.ts";
import type { CountScopeCursor, CountScopeItem, CountScopeReply } from "./count-admin-schema.ts";
import { CountWorkspace } from "./CountWorkspace";
import { CountPolicyWorkspace } from "./CountPolicyWorkspace";
import { CountCorrectionWorkspace } from "./CountCorrectionWorkspace";

type NarcoticsView = "counts" | "settings" | "corrections";
interface SessionPageProps { readonly sessions: ReviewStaffSessionSource; readonly identity: ReviewIdentity; readonly client: CountClient; readonly view: NarcoticsView }
function SessionPage({ sessions, identity, client, view }: SessionPageProps) {
  const settings = view === "settings", corrections = view === "corrections";
  const { productId, siteId } = useParams();
  const [page, setPage] = useState<CountScopeReply | null>(null), [selected, setSelected] = useState<CountScopeItem | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const inflight = useRef(false), generation = useRef(0);
  const alive = useRef(true), routeReadStarted = useRef(false);
  const operations = useMemo(() => createCountOperationController(client, {
    getItem: key => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value), removeItem: key => localStorage.removeItem(key),
  }, browserCountOperationLock()), [client]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const load = useCallback(async (cursor: CountScopeCursor | null = null) => {
    if (inflight.current || !sessions.isCurrent(identity) || selected) return;
    const intent = ++generation.current;
    inflight.current = true; setBusy(true); setError("");
    try {
      const result = await client.scopes({ schema_version: 1, actor_id: identity.actorId, cursor, page_size: 100 }, identity);
      if (!alive.current || intent !== generation.current || !sessions.isCurrent(identity)) return;
      setPage(result);
      if (productId && siteId) setSelected(result.items.find(item => item.product_id === productId && item.site_id === siteId) ?? null);
    } catch {
      if (alive.current && intent === generation.current && sessions.isCurrent(identity)) setError("Medication and site access could not be loaded. Check your login or ask an administrator.");
    } finally { inflight.current = false; if (alive.current && intent === generation.current && sessions.isCurrent(identity)) setBusy(false); }
  }, [client, identity, productId, selected, sessions, siteId]);
  useEffect(() => {
    if (productId && siteId && !routeReadStarted.current) { routeReadStarted.current = true; void load(); }
    // This keyed host performs one read only; all mutations remain explicit.
  }, [load, productId, siteId]);
  const scope = selected && selected.product_id === productId && selected.site_id === siteId ? selected : null;
  return <main className="mx-auto min-w-0 max-w-5xl space-y-6 p-4 md:p-6">
    <header className="space-y-2"><h1 className="font-display text-2xl">Narcotics log</h1><p className="text-sm text-muted-foreground">Controlled-drug records, independent counts, and reviewed stock corrections.</p>
      <div className="flex flex-wrap gap-2"><Button asChild variant="outline" className="min-h-11"><Link to="/hub/inventory">Back to Inventory</Link></Button>
        <Button asChild variant="outline" className="min-h-11"><Link to="/hub/inventory/narcotics/records">Recorded movements and reviews</Link></Button>
        <Button asChild variant="outline" className="min-h-11"><Link to="/hub/inventory/narcotics/witness">Independent witness</Link></Button>
        <Button asChild variant="outline" className="min-h-11"><Link to="/hub/inventory/narcotics/setup">Administrator setup</Link></Button>
        {productId && siteId && <Button asChild variant="outline" className="min-h-11"><Link to="/hub/inventory/narcotics">Choose another medication or site</Link></Button>}</div>
    </header>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {!scope && <section className="space-y-4" aria-label="Choose controlled medication and site"><h2 className="font-display text-xl">Medication and site</h2>
      <p className="text-sm text-muted-foreground">Choose from your authorized registered stock. An administrator can configure counting where it has not been enabled.</p>
      <Button type="button" className="min-h-11" disabled={busy} onClick={() => void load()}>{busy ? "Loading medications…" : "Load medications and sites"}</Button>
      {page && !page.items.length && <p role="status">No authorized controlled-stock scopes are available. An administrator must register stock and configure access first.</p>}
      {page && productId && siteId && !scope && <p role="status">The requested medication and site are not on this page. Select an authorized scope below, or load the next page.</p>}
      {page && <ul className="space-y-3">{page.items.map(item => <li key={`${item.product_id}:${item.site_id}`} className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-xl border p-4">
        <div className="min-w-0"><p className="break-words font-medium">{item.product_name}</p><p className="break-words text-sm text-muted-foreground">{item.site_name} · {item.policy_id ? `Policy version ${item.policy_version}` : "Counting not configured"}</p></div>
        <Button asChild variant="outline" className="min-h-11"><Link to={`/hub/inventory/narcotics/${item.product_id}/${item.site_id}${!item.capabilities.read && item.capabilities.configure ? "/settings" : ""}`}>Open medication</Link></Button>
      </li>)}</ul>}
      {page?.has_more && <Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={() => void load(page.next_cursor)}>More medications and sites</Button>}
    </section>}
    {scope && <div className="space-y-3"><h2 className="break-words font-display text-xl">{scope.product_name} · {scope.site_name}</h2>
      <div className="flex flex-wrap gap-2">{view !== "counts" && <Button asChild variant="outline" className="min-h-11"><Link to={`/hub/inventory/narcotics/${scope.product_id}/${scope.site_id}`}>Back to medication counts</Link></Button>}
        {!settings && scope.capabilities.configure && <Button asChild variant="outline" className="min-h-11"><Link to={`/hub/inventory/narcotics/${scope.product_id}/${scope.site_id}/settings`}>Administrator settings</Link></Button>}
        {!corrections && scope.capabilities.read && <Button asChild variant="outline" className="min-h-11"><Link to={`/hub/inventory/narcotics/${scope.product_id}/${scope.site_id}/corrections`}>Discrepancies and corrections</Link></Button>}</div>
    </div>}
    {scope && settings && (scope.capabilities.configure ? <CountPolicyWorkspace sessions={sessions} identity={identity} client={client} operations={operations} productId={scope.product_id} siteId={scope.site_id} /> : <p role="alert">Current administrator configuration access is required.</p>)}
    {scope?.capabilities.read && corrections && <CountCorrectionWorkspace sessions={sessions} identity={identity} client={client} operations={operations} productId={scope.product_id} siteId={scope.site_id} />}
    {scope?.capabilities.read && view === "counts" && <CountWorkspace sessions={sessions} client={client} operations={operations}
      scope={{ product_id: scope.product_id!, site_id: scope.site_id!, product_name: scope.product_name!, site_label: scope.site_name! }} />}
    {scope && !scope.capabilities.read && !settings && <p role="status">Counting access is not enabled for this medication and site. An administrator must review its settings.</p>}
  </main>;
}

interface NarcoticsLogPageProps { readonly view?: NarcoticsView }
export function NarcoticsLogPage({ view = "counts" }: NarcoticsLogPageProps) {
  const sessions = useReviewStaffSessions(), identity = useSyncExternalStore(sessions.subscribe, sessions.getSnapshot, sessions.getSnapshot);
  const { productId, siteId } = useParams();
  const connection = useMemo(() => {
    try { return createCountClient({ projectRef: import.meta.env.VITE_SUPABASE_PROJECT_ID, url: import.meta.env.VITE_SUPABASE_URL, publishableKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY }, sessions); }
    catch { return null; }
  }, [sessions]);
  if (!identity) return <p role="status" className="p-4">Sign in with an active staff account to open the narcotics log.</p>;
  if (!connection) return <p role="alert" className="p-4">The narcotics log connection is unavailable. Ask an administrator to check the application configuration.</p>;
  return <SessionPage key={`${identity.actorId}:${identity.sessionId}:${identity.generation}:${productId ?? ""}:${siteId ?? ""}:${view}`} sessions={sessions} identity={identity} client={connection} view={view} />;
}
