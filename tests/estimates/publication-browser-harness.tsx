import React, { useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryRouter,
  RouterProvider,
  useBlocker,
  Link,
} from "react-router-dom";
import { AuthProvider } from "../../src/hub/contexts/AuthContext";
import { HouseholdEstimates } from "../../src/hub/features/estimates/HouseholdEstimates";
import { supabase } from "../../src/integrations/supabase/client";
interface PageProps {
  clientId: string;
}
// Browser-only imperative mount; not an application hot-refresh boundary.
// eslint-disable-next-line react-refresh/only-export-components
function Page({ clientId }: PageProps) {
  const [dirty, setDirty] = useState(false),
    blocker = useBlocker(dirty);
  return (
    <>
      <Link to="/away">Leave estimate household</Link>
      <HouseholdEstimates clientId={clientId} onDirtyChange={setDirty} />
      {blocker.state === "blocked" && (
        <div role="dialog" aria-label="Unfinished household work">
          <button onClick={() => blocker.reset()}>Stay and reconcile</button>
          <button onClick={() => blocker.proceed()}>
            Leave and recover later
          </button>
        </div>
      )}
    </>
  );
}
let root: Root | null = null;
export function mountEstimatePublication(clientId: string) {
  const app = document.getElementById("root");
  if (app) app.hidden = true;
  if (!root) {
    const host = document.createElement("div");
    host.id = "estimate-publication-fixture";
    document.body.append(host);
    root = createRoot(host);
  }
  const router = createMemoryRouter([
    { path: "/", element: <Page key={clientId} clientId={clientId} /> },
    { path: "/away", element: <p>Left estimate household</p> },
  ]);
  root.render(
    <QueryClientProvider client={new QueryClient()}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  );
}
export async function changePublicationStaff(accessToken: string) {
  const { error } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: "synthetic-refresh",
  });
  if (error) throw error;
}
