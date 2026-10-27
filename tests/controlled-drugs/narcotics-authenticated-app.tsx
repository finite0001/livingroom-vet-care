/** Real SDK/Auth and shared staff workspaces, with only a fixed test-local URL adapter. */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createMemoryRouter, Link, RouterProvider, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Button } from "../../src/components/ui/button";
import { Toaster } from "../../src/components/ui/toaster";
import { AuthProvider } from "../../src/hub/contexts/AuthContext";
import { useAuth } from "../../src/hub/contexts/auth-context";
import LoginPage from "../../src/hub/pages/LoginPage";
import { useReviewStaffSessions } from "../../src/hub/features/controlled-drugs/record-review/staff-session-context";
import { createCountClient } from "../../src/hub/features/controlled-drugs/count/count-client";
import { browserCountOperationLock, createCountOperationController } from "../../src/hub/features/controlled-drugs/count/count-operation-controller";
import { CountWorkspace } from "../../src/hub/features/controlled-drugs/count/CountWorkspace";
import { CountPolicyWorkspace } from "../../src/hub/features/controlled-drugs/count/CountPolicyWorkspace";
import { CountCorrectionWorkspace } from "../../src/hub/features/controlled-drugs/count/CountCorrectionWorkspace";
import type { CountScopeItem } from "../../src/hub/features/controlled-drugs/count/count-admin-schema";
import { createAdministrationClient } from "../../src/hub/features/controlled-drugs/administration/query-client";
import { AdministrationWorkspace } from "../../src/hub/features/controlled-drugs/administration/AdministrationWorkspace";
import type { AdministrationOptions } from "../../src/hub/features/controlled-drugs/administration/queries";
import { WitnessWorkspace } from "../../src/hub/features/controlled-drugs/witness/WitnessWorkspace";
import type { ReviewIdentity } from "../../src/hub/features/controlled-drugs/record-review/raw-rpc";
import type { NarcoticsAuthenticatedInput } from "./narcotics-authenticated-input";
import { createNarcoticsLocalTransport, narcoticsProofConnection as connection } from "./narcotics-local-transport";
import "../../src/index.css";

interface ProofSnapshot { readonly actorId: string | null; readonly sessionId: string | null; readonly generation: number | null; readonly route: string; readonly scopeLoaded: boolean; readonly administrationLoaded: boolean }
interface ProofHandle { snapshot(): ProofSnapshot }
declare global { interface Window { __LRV_NARCOTICS_LOCAL_INPUT__?: unknown; __LRV_NARCOTICS_LOCAL_PROOF__?: ProofHandle } }
interface ProofProps { readonly input: NarcoticsAuthenticatedInput }
interface StaffProps extends ProofProps { readonly identity: Readonly<ReviewIdentity> }
function StaffWorkspaces({ input, identity }: StaffProps) {
  const sessions = useReviewStaffSessions(), auth = useAuth(), route = useLocation().pathname;
  const [scope, setScope] = useState<CountScopeItem | null>(null), [options, setOptions] = useState<AdministrationOptions | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const live = useRef(true), pending = useRef(false);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const localFetch = useMemo(() => createNarcoticsLocalTransport(input), [input]);
  const clients = useMemo(() => {
    const count = createCountClient(connection, sessions, localFetch);
    return { count, administration: createAdministrationClient(connection, sessions, localFetch),
      operations: createCountOperationController(count, localStorage, browserCountOperationLock()) };
  }, [sessions, localFetch]);
  useEffect(() => {
    const handle: ProofHandle = { snapshot: () => ({ actorId: sessions.isCurrent(identity) ? identity.actorId : null,
      sessionId: sessions.isCurrent(identity) ? identity.sessionId : null, generation: sessions.isCurrent(identity) ? identity.generation : null,
      route, scopeLoaded: !!scope, administrationLoaded: !!options }) };
    window.__LRV_NARCOTICS_LOCAL_PROOF__ = handle;
    return () => { if (window.__LRV_NARCOTICS_LOCAL_PROOF__ === handle) delete window.__LRV_NARCOTICS_LOCAL_PROOF__; };
  }, [identity, options, route, scope, sessions]);
  async function load(administration: boolean) {
    if (pending.current || !sessions.isCurrent(identity)) return;
    pending.current = true; setBusy(true); setError("");
    try {
      if (administration) {
        const result = await clients.administration.options({ schema_version: 1, actor_id: identity.actorId, cursor: null, page_size: 100 }, identity);
        if (live.current && sessions.isCurrent(identity)) setOptions(result);
      } else {
        const result = await clients.count.scopes({ schema_version: 1, actor_id: identity.actorId, cursor: null, page_size: 100 }, identity);
        const actual = result.items.find(row => row.product_id === input.scope.product_id && row.site_id === input.scope.site_id);
        if (!actual) throw new Error("Expected synthetic scope is absent from actual authorized discovery");
        if (live.current && sessions.isCurrent(identity)) setScope(actual);
      }
    } catch { if (live.current && sessions.isCurrent(identity)) setError("The actual local backend did not provide the authorized records."); }
    finally { pending.current = false; if (live.current && sessions.isCurrent(identity)) setBusy(false); }
  }
  return <main className="mx-auto min-w-0 max-w-5xl space-y-4 p-4">
    <aside className="rounded-xl border bg-muted p-4 text-sm">Disposable local login and real database verification. Synthetic records only; no physical stock is being observed.</aside>
    <nav aria-label="Local staff verification" className="flex flex-wrap gap-3">{[["/counts", "Counts"], ["/policy", "Count settings"], ["/corrections", "Corrections"], ["/administration", "Administrator setup"], ["/witness", "Independent witness"]].map(([path, label]) => <Link key={path} className="min-h-11 underline" to={path}>{label}</Link>)}<Button variant="outline" onClick={() => void auth.signOut()}>Sign out</Button></nav>
    {error && <p role="alert">{error}</p>}
    {route === "/witness" ? <WitnessWorkspace connection={connection} fetcher={localFetch} /> : route === "/administration" ? options
      ? <AdministrationWorkspace sessions={sessions} identity={identity} client={clients.administration} options={options} onOptionsPage={setOptions} />
      : <Button disabled={busy} onClick={() => void load(true)}>Load administrator records</Button> : !scope
        ? <Button disabled={busy} onClick={() => void load(false)}>Load authorized medication and site</Button>
        : <><h1 className="font-display text-2xl">{scope.product_name} · {scope.site_name}</h1>{route === "/policy"
          ? <CountPolicyWorkspace sessions={sessions} identity={identity} client={clients.count} operations={clients.operations} productId={scope.product_id} siteId={scope.site_id} />
          : route === "/corrections" ? <CountCorrectionWorkspace sessions={sessions} identity={identity} client={clients.count} operations={clients.operations} productId={scope.product_id} siteId={scope.site_id} />
            : <CountWorkspace sessions={sessions} client={clients.count} operations={clients.operations} scope={{ product_id: scope.product_id, site_id: scope.site_id, product_name: scope.product_name, site_label: scope.site_name }} />}</>}
  </main>;
}
function StaffBoundary({ input }: ProofProps) {
  const auth = useAuth(), sessions = useReviewStaffSessions();
  const identity = useSyncExternalStore(sessions.subscribe, sessions.getSnapshot, () => null);
  if (auth.loading) return <p role="status">Checking staff access…</p>;
  if (!auth.session || !auth.profile?.is_active || !identity) return <LoginPage />;
  if (auth.user?.id !== input.actorId || identity.actorId !== input.actorId) return <p role="alert">Only the expected disposable staff account is supported.</p>;
  return <StaffWorkspaces key={`${identity.actorId}:${identity.sessionId}:${identity.generation}`} input={input} identity={identity} />;
}
export function NarcoticsAuthenticatedProof({ input }: ProofProps) {
  const [query] = useState(() => new QueryClient());
  const [router] = useState(() => createMemoryRouter([{ path: "*", element: <StaffBoundary input={input} /> }], { initialEntries: ["/counts"] }));
  return <QueryClientProvider client={query}><AuthProvider><RouterProvider router={router} /><Toaster /></AuthProvider></QueryClientProvider>;
}
