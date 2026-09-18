import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import {
  createMemoryRouter,
  RouterProvider,
  Link,
  useBlocker,
} from "react-router-dom";
import { EstimateDraftWorkspace } from "../../src/hub/features/estimates/HouseholdEstimates";
interface FixturePageProps {
  actor: string;
  clientId: string;
}
// This is an imperative browser fixture, not an application refresh boundary.
// eslint-disable-next-line react-refresh/only-export-components
function Page({ actor, clientId }: FixturePageProps) {
  const [dirty, setDirty] = useState(false);
  const blocker = useBlocker(dirty);
  return (
    <>
      <Link to="/away">Leave household fixture</Link>
      <EstimateDraftWorkspace
        actor={actor}
        clientId={clientId}
        onDirtyChange={setDirty}
      />
      {blocker.state === "blocked" && (
        <div role="dialog" aria-label="Unfinished estimate">
          <p>
            Unsent edits will be discarded; original submitted requests remain
            saved.
          </p>
          <button onClick={() => blocker.reset()}>Stay</button>
          <button onClick={() => blocker.proceed()}>Leave</button>
        </div>
      )}
    </>
  );
}
export function mountEstimateDrafts(actor: string, clientId: string) {
  const app = document.getElementById("root");
  if (app) app.hidden = true;
  const host = document.createElement("div");
  document.body.append(host);
  const router = createMemoryRouter([
    { path: "/", element: <Page actor={actor} clientId={clientId} /> },
    { path: "/away", element: <p>Left household fixture</p> },
  ]);
  createRoot(host).render(<RouterProvider router={router} />);
}
