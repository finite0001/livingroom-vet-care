import { useMemo, useState, useSyncExternalStore } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider, useLocation } from "react-router-dom";
import { AuthProvider } from "../../src/hub/contexts/AuthContext";
import { useAuth } from "../../src/hub/contexts/auth-context";
import LoginPage from "../../src/hub/pages/LoginPage";
import { Toaster } from "../../src/components/ui/toaster";
import { useReviewStaffSessions } from "../../src/hub/features/controlled-drugs/record-review/staff-session-context";
import { RecoveryWorkspace } from "../../src/hub/features/controlled-drugs/recovery/RecoveryPage";
import { RegisterPageWorkspace } from "../../src/hub/features/controlled-drugs/register/RegisterPage";
import { createOperationalLocalTransport, operationalProofConnection } from "./operational-local-transport";
import type { NarcoticsAuthenticatedInput } from "./narcotics-authenticated-input";

interface OperationalProofProps { readonly input: NarcoticsAuthenticatedInput }
function StaffBoundary({ input }: OperationalProofProps) {
  const auth = useAuth(), sessions = useReviewStaffSessions(), path = useLocation().pathname;
  const identity = useSyncExternalStore(sessions.subscribe, sessions.getSnapshot, sessions.getSnapshot);
  const fetcher = useMemo(() => createOperationalLocalTransport(input), [input]);
  if (auth.loading) return <p role="status">Checking staff access…</p>;
  if (!auth.session || !auth.profile?.is_active || !identity) return <LoginPage />;
  if (auth.user?.id !== input.actorId || identity.actorId !== input.actorId) return <p role="alert">Only the expected disposable staff account is supported.</p>;
  const props = { config: operationalProofConnection, fetcher, sessions, identity };
  return path.startsWith("/hub/inventory/narcotics/reports") ? <RegisterPageWorkspace key={identity.sessionId} {...props} /> : <RecoveryWorkspace key={identity.sessionId} {...props} />;
}
export function OperationalAuthenticatedProof({ input }: OperationalProofProps) {
  const [query] = useState(() => new QueryClient());
  const [router] = useState(() => createMemoryRouter([
    { path: "/hub/inventory/narcotics/recovery/*", element: <StaffBoundary input={input} /> },
    { path: "/hub/inventory/narcotics/reports/*", element: <StaffBoundary input={input} /> },
  ], { initialEntries: [{ pathname: "/hub/inventory/narcotics/recovery", state: { from: "/hub/inventory/narcotics/recovery" } }] }));
  return <QueryClientProvider client={query}><AuthProvider><RouterProvider router={router} /><Toaster /></AuthProvider></QueryClientProvider>;
}
