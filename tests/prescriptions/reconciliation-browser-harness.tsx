/** Browser-only component fixture; Vite resolves shared dependency identities normally. */
import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { NativeDispenseReturns } from "../../src/hub/features/prescriptions/NativeDispenseReturns";
import type { NativeDispense } from "../../src/hub/features/prescriptions/fulfillment-api";
import { createReviewStaffSessions } from "../../src/hub/features/controlled-drugs/record-review/staff-session";
import { ReviewStaffSessionContext } from "../../src/hub/features/controlled-drugs/record-review/staff-session-context";
import { ControlledStockEntryProvider } from "../fixtures/legacy-stock-entry-provider";
interface MountOptions {
  actor: string;
  dispense: NativeDispense;
}
export function mountReconciliation({ actor, dispense }: MountOptions) {
  // Component-only mocked identity. This fixture makes no genuine Auth claim;
  // the disposable backend suite uses real GoTrue password grants separately.
  const sessions = createReviewStaffSessions();
  const encode = (value: unknown) => btoa(JSON.stringify(value)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  const token = `${encode({ alg: "synthetic" })}.${encode({ sub: actor, session_id: "99999999-9999-4999-8999-999999999999", role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 })}.synthetic`;
  const identity = sessions.offer({ access_token: token, user: { id: actor } });
  if (!identity || !sessions.allow(identity, true)) throw new Error("Synthetic component identity unavailable");
  const application = document.getElementById("root");
  if (application) application.hidden = true;
  const host = document.createElement("div");
  host.id = "reconciliation-workspace";
  document.body.append(host);
  const root = createRoot(host);
  root.render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <ReviewStaffSessionContext.Provider value={sessions.source}>
        <ControlledStockEntryProvider>
        <NativeDispenseReturns
          actor={actor}
          dispense={dispense}
          medicationName="Synthetic medication"
          evidenceRevision={0}
          disabled={false}
          onDirtyChange={() => {}}
          onConfirmed={() => {}}
          onClose={() => {}}
        />
        </ControlledStockEntryProvider>
        </ReviewStaffSessionContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return () => {
    root.unmount();
    sessions.clear();
    host.remove();
    if (application) application.hidden = false;
  };
}
