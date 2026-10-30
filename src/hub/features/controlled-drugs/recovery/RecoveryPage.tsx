import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useReviewStaffSessions } from "../record-review/staff-session-context.ts";
import type { ReviewIdentity, ReviewRpcConfig } from "../record-review/raw-rpc.ts";
import type { ReviewStaffSessionSource } from "../record-review/staff-session.ts";
import { createCountClient } from "../count/count-client.ts";
import { browserCountOperationLock, createCountOperationController } from "../count/count-operation-controller.ts";
import type { CountScopeItem } from "../count/count-admin-schema.ts";
import type { CountReadData } from "../count/count-read-wire.ts";
import { CountWorkspace } from "../count/CountWorkspace";
import { CountCorrectionWorkspace } from "../count/CountCorrectionWorkspace";
import { AuthorizedScopeChooser } from "./AuthorizedScopeChooser";
import { createRecoveryClient } from "./client.ts";
import { createRecoveryCountClient } from "./count-client.ts";
import { createRecoveryOperations } from "./operation-controller.ts";
import type { RecoveryReceipt, RecoveryStatus } from "./schema.ts";
import { RecoveryOverview } from "./RecoveryOverview";

export interface RecoveryAgreement { readonly product_id: string; readonly site_id: string; readonly count_id: string; readonly outcome_id: string }
export interface RecoveryWorkspaceProps { readonly sessions: ReviewStaffSessionSource; readonly identity: ReviewIdentity; readonly config: ReviewRpcConfig; readonly fetcher?: typeof fetch }
export function RecoveryWorkspace({ sessions, identity, config, fetcher = globalThis.fetch }: RecoveryWorkspaceProps) {
  const [status, setStatus] = useState<RecoveryStatus | null>(null), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [receipt, setReceipt] = useState<RecoveryReceipt | null>(null), [known, setKnown] = useState<CountScopeItem[]>([]), [agreements, setAgreements] = useState<RecoveryAgreement[]>([]);
  const alive = useRef(true), running = useRef(false), currentStatus = useRef(status); currentStatus.current = status;
  const navigate = useNavigate(), route = (useParams()["*"] ?? "").split("/").filter(Boolean);
  const validRoute = route.length === 0 || route.length === 2 || route.length === 3 && route[2] === "corrections";
  const selected = validRoute && route.length >= 2 ? known.find(item => item.product_id === route[0] && item.site_id === route[1]) ?? null : null;
  const corrections = route.length === 3 && route[2] === "corrections", overview = route.length === 0;
  const connection = useMemo(() => {
    try {
      const client = createRecoveryClient(config, sessions, fetcher), count = createCountClient(config, sessions, fetcher), lock = browserCountOperationLock();
      const operations = createRecoveryOperations(config.projectRef, client, { getItem: key => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value), removeItem: key => localStorage.removeItem(key) }, lock);
      return { client, count, operations };
    } catch { return null; }
  }, [config, fetcher, sessions]);
  const observeCount = useCallback((data: CountReadData, reader: ReviewIdentity) => {
    const current = currentStatus.current;
    if (!alive.current || !sessions.isCurrent(reader) || !current?.epoch_started_at || !current.scopes.some(scope => scope.product_id === data.product.id && scope.site_id === data.site.id)) return;
    setAgreements(previous => {
      const retained = previous.filter(item => item.product_id !== data.product.id || item.site_id !== data.site.id);
      return data.history_state === "agreement" && data.current_boundary_state === "unchanged" && data.captured_at > current.epoch_started_at && data.terminal?.kind === "outcome"
        ? [...retained, { product_id: data.product.id, site_id: data.site.id, count_id: data.count_id, outcome_id: data.terminal.id }] : retained;
    });
  }, [sessions]);
  const count = useMemo(() => connection ? createRecoveryCountClient(connection.count, connection.operations, sessions, () => currentStatus.current, observeCount) : null, [connection, observeCount, sessions]);
  const countOperations = useMemo(() => count ? createCountOperationController(count,
    { getItem: key => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value), removeItem: key => localStorage.removeItem(key) }, browserCountOperationLock()) : null, [count]);
  const refresh = useCallback(async () => {
    if (!connection) return;
    const value = await connection.client.status(identity);
    if (alive.current && sessions.isCurrent(identity)) setStatus(value);
  }, [connection, identity, sessions]);
  useEffect(() => {
    alive.current = true; void refresh().catch(() => { if (alive.current && sessions.isCurrent(identity)) setMessage("Recovery status could not be confirmed. Check your staff login and application connection."); });
    return () => { alive.current = false; };
  }, [identity, refresh, sessions]);
  useEffect(() => { setAgreements([]); }, [status?.epoch_id]);
  async function work(task: () => Promise<void>) {
    if (running.current || !sessions.isCurrent(identity)) return; running.current = true; setBusy(true); setMessage("");
    try { await task(); }
    catch { if (alive.current && sessions.isCurrent(identity)) setMessage("The result is unconfirmed. Check any pending original action before starting another."); }
    finally { running.current = false; if (alive.current && sessions.isCurrent(identity)) setBusy(false); }
  }
  async function save(input: unknown) {
    if (!connection) return;
    const value = await connection.operations.save(input, identity);
    if (!alive.current || !sessions.isCurrent(identity)) return;
    setReceipt(value); setMessage("Saved and verified."); await refresh();
  }
  function choose(scope: CountScopeItem) {
    setKnown(previous => [...previous.filter(item => item.product_id !== scope.product_id || item.site_id !== scope.site_id), scope]);
    navigate(`/hub/inventory/narcotics/recovery/${scope.product_id}/${scope.site_id}`);
  }
  let pending = false, storageBlocked = false;
  try { pending = !!connection?.operations.pending(identity.actorId); } catch { storageBlocked = true; }
  return <main className="mx-auto min-w-0 max-w-5xl space-y-6 p-4 md:p-6"><header className="space-y-2"><h1 className="font-display text-2xl">Narcotics recovery</h1>
    <p className="text-sm text-muted-foreground">Review a restored backup, independently recount stock, and resolve differences before normal recording resumes.</p>
    <nav aria-label="Narcotics recovery navigation" className="flex flex-wrap gap-2"><Button asChild variant="outline" className="min-h-11"><Link to="/hub/inventory/narcotics">Narcotics log</Link></Button>
      <Button asChild variant="outline" className="min-h-11"><Link to="/hub/inventory/narcotics/recovery">Recovery overview</Link></Button>
      <Button asChild variant="outline" className="min-h-11"><Link to="/hub/inventory/narcotics/reports">Reports and files</Link></Button></nav></header>
    {!validRoute && <p role="alert">This recovery address is unavailable. Open the recovery overview to choose a medication and site.</p>}
    {!connection && <p role="alert">The recovery connection is unavailable.</p>}{message && <p role="status">{message}</p>}
    {connection && <Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={() => void work(refresh)}>Refresh recovery status</Button>}
    {storageBlocked && <p role="alert" className="text-destructive">The saved recovery pointer is damaged or unavailable. Ask an administrator to inspect it before recording another action.</p>}
    {pending && connection && <section className="space-y-3 rounded-xl border bg-card p-4" aria-label="Pending recovery action"><h2 className="font-display text-xl">Check the original action</h2>
      <p>A previous action has an uncertain result. Checking never repeats it. Permanently closing an unsaved action prevents that action from arriving later; an already saved result is preserved.</p>
      <div className="flex flex-wrap gap-2">{(["read", "close"] as const).map(mode => <Button key={mode} type="button" variant={mode === "read" ? "default" : "outline"} className="min-h-11" disabled={busy} onClick={() => void work(async () => {
        const value = await connection.operations.recover(mode, identity);
        if (!alive.current || !sessions.isCurrent(identity)) return;
        setReceipt(value.receipt); setMessage(value.state === "pending" ? "No saved result is visible yet. Keep the original action pending, or permanently close it before starting another." : value.state === "saved" ? "The original saved result is verified. If it started a count, also check the count action in that medication's count screen." : "The original unsaved action is permanently closed."); await refresh();
      })}>{mode === "read" ? "Check original result" : "Permanently close unsaved action"}</Button>)}</div>
    </section>}
    {status && connection && <><section className="space-y-2 rounded-xl border bg-card p-4" aria-label="Current recovery status"><h2 className="font-display text-xl">{status.mode === "armed" ? "Normal recording is paused" : "Recovery hold is clear"}</h2>
      <p>{status.mode === "armed" ? status.epoch_id ? status.needs_new_epoch ? "The server restarted. An administrator must begin a new recovery attempt; earlier evidence stays on file." : "Complete independent counts and evidence review for every captured medication and site." : "The backup is armed. Prepare the backup on the original server, then begin recovery on the restored server." : "Existing stock restrictions and required reviews still apply."}</p>
      {!status.fresh_session && <p role="alert">Sign out and sign in again, then refresh this page. Recovery requires a new staff login.</p>}</section>
      {overview && <RecoveryOverview sessions={sessions} identity={identity} status={status} client={connection.client} operations={connection.operations} countClient={connection.count}
        busy={busy} locked={busy || pending || storageBlocked} receipt={receipt} agreements={agreements} work={work} save={save} />}
      {validRoute && !overview && status.mode === "armed" && status.epoch_id && !status.needs_new_epoch && status.fresh_session && count && countOperations && <>
        <AuthorizedScopeChooser sessions={sessions} identity={identity} client={count} allowed={status.scopes} selected={selected} onSelect={choose} />
        {selected && <section className="space-y-4"><h2 className="break-words font-display text-xl">{selected.product_name} · {selected.site_name}</h2>
          <div className="flex flex-wrap gap-2"><Button asChild variant="outline" className="min-h-11"><Link to={`/hub/inventory/narcotics/recovery/${selected.product_id}/${selected.site_id}`}>Independent counts</Link></Button>
            <Button asChild variant="outline" className="min-h-11"><Link to={`/hub/inventory/narcotics/recovery/${selected.product_id}/${selected.site_id}/corrections`}>Discrepancies and corrections</Link></Button></div>
          {corrections ? <CountCorrectionWorkspace key={`${selected.product_id}:${selected.site_id}:corrections`} sessions={sessions} identity={identity} client={count} operations={countOperations} productId={selected.product_id} siteId={selected.site_id} />
            : <CountWorkspace key={`${selected.product_id}:${selected.site_id}:counts`} sessions={sessions} client={count} operations={countOperations} scope={{ product_id: selected.product_id, site_id: selected.site_id, product_name: selected.product_name, site_label: selected.site_name }} />}
        </section>}
      </>}
      {overview && status.mode === "armed" && status.epoch_id && status.fresh_session && !status.needs_new_epoch && <AuthorizedScopeChooser sessions={sessions} identity={identity} client={connection.count} allowed={status.scopes} selected={null} onSelect={choose} />}
    </>}
  </main>;
}
export function RecoveryPage() {
  const config = useMemo(() => ({ projectRef: import.meta.env.VITE_SUPABASE_PROJECT_ID, url: import.meta.env.VITE_SUPABASE_URL, publishableKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY }), []);
  const sessions = useReviewStaffSessions(), identity = useSyncExternalStore(sessions.subscribe, sessions.getSnapshot, sessions.getSnapshot);
  if (!identity) return <p role="status" className="p-4">Sign in with an active staff account to open narcotics recovery.</p>;
  return <RecoveryWorkspace config={config} key={`${identity.actorId}:${identity.sessionId}:${identity.generation}`} sessions={sessions} identity={identity} />;
}
