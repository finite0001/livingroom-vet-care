import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useReviewStaffSessions } from "../record-review/staff-session-context.ts";
import type { ReviewIdentity, ReviewRpcConfig } from "../record-review/raw-rpc.ts";
import type { ReviewStaffSessionSource } from "../record-review/staff-session.ts";
import { createCountClient } from "../count/count-client.ts";
import { browserCountOperationLock } from "../count/count-operation-controller.ts";
import type { CountScopeItem } from "../count/count-admin-schema.ts";
import { createRecoveryClient } from "../recovery/client.ts";
import { AuthorizedScopeChooser } from "../recovery/AuthorizedScopeChooser";
import { createRegisterClient } from "./client.ts";
import { createRegisterOperations } from "./operation-controller.ts";
import { RegisterWorkspace } from "./RegisterWorkspace";

export interface RegisterPageWorkspaceProps { readonly sessions: ReviewStaffSessionSource; readonly identity: ReviewIdentity; readonly config: ReviewRpcConfig; readonly fetcher?: typeof fetch }
export function RegisterPageWorkspace({ sessions, identity, config, fetcher = globalThis.fetch }: RegisterPageWorkspaceProps) {
  const [known, setKnown] = useState<CountScopeItem[]>([]), [admin, setAdmin] = useState(false), [message, setMessage] = useState("Checking administrator audit access…");
  const alive = useRef(true), navigate = useNavigate(), route = (useParams()["*"] ?? "").split("/").filter(Boolean);
  const selected = route.length === 2 ? known.find(item => item.product_id === route[0] && item.site_id === route[1]) ?? null : null;
  const connection = useMemo(() => {
    try {
      const client = createRegisterClient(config, sessions, fetcher);
      return { client, scopes: createCountClient(config, sessions, fetcher), recovery: createRecoveryClient(config, sessions, fetcher), operations: createRegisterOperations(config.projectRef, client,
        { getItem: key => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value), removeItem: key => localStorage.removeItem(key) }, browserCountOperationLock()) };
    } catch { return null; }
  }, [config, fetcher, sessions]);
  useEffect(() => {
    alive.current = true;
    void connection?.recovery.status(identity).then(value => {
      if (alive.current && sessions.isCurrent(identity)) { setAdmin(value.is_admin && value.fresh_session); setMessage(value.is_admin ? value.fresh_session ? "" : "Sign out and sign in again after recovery, then reopen Reports." : "Reports require current administrator audit access."); }
    }).catch(() => { if (alive.current && sessions.isCurrent(identity)) setMessage("Report access could not be confirmed. Check the application connection and your staff login."); });
    return () => { alive.current = false; };
  }, [connection, identity, sessions]);
  return <main className="mx-auto max-w-5xl space-y-6 p-4 md:p-6"><header className="space-y-2"><h1 className="font-display text-2xl">Narcotics reports and supporting files</h1>
    <p className="text-sm text-muted-foreground">Create a saved register, download its verified CSV, print it, and retain original supporting files.</p>
    <Button asChild variant="outline" className="min-h-11"><Link to="/hub/inventory/narcotics">Back to narcotics log</Link></Button></header>
    {!connection && <p role="alert">The report connection is unavailable.</p>}{connection && message && <p role="status">{message}</p>}
    {connection && admin && <><AuthorizedScopeChooser sessions={sessions} identity={identity} client={connection.scopes} selected={selected} onSelect={scope => { setKnown(previous => [...previous.filter(item => item.product_id !== scope.product_id || item.site_id !== scope.site_id), scope]); navigate(`/hub/inventory/narcotics/reports/${scope.product_id}/${scope.site_id}`); }} />
      {selected && <section className="space-y-4"><h2 className="break-words font-display text-xl">{selected.product_name} · {selected.site_name}</h2>
        <RegisterWorkspace key={`${selected.product_id}:${selected.site_id}`} sessions={sessions} identity={identity} client={connection.client} operations={connection.operations} productId={selected.product_id} siteId={selected.site_id} />
      </section>}</>}
  </main>;
}
export function RegisterPage() {
  const config = useMemo(() => ({ projectRef: import.meta.env.VITE_SUPABASE_PROJECT_ID, url: import.meta.env.VITE_SUPABASE_URL, publishableKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY }), []);
  const sessions = useReviewStaffSessions(), identity = useSyncExternalStore(sessions.subscribe, sessions.getSnapshot, sessions.getSnapshot);
  if (!identity) return <p role="status" className="p-4">Sign in with an active staff account to open narcotics reports.</p>;
  return <RegisterPageWorkspace config={config} key={`${identity.actorId}:${identity.sessionId}:${identity.generation}`} sessions={sessions} identity={identity} />;
}
