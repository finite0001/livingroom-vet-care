/** Browser-only component fixture; Vite resolves shared dependency identities normally. */
import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { NativeDispenseReturns } from "../../src/hub/features/prescriptions/NativeDispenseReturns";
import type { NativeDispense } from "../../src/hub/features/prescriptions/fulfillment-api";
interface MountOptions {
  actor: string;
  dispense: NativeDispense;
}
export function mountReconciliation({ actor, dispense }: MountOptions) {
  const application = document.getElementById("root");
  if (application) application.hidden = true;
  const host = document.createElement("div");
  host.id = "reconciliation-workspace";
  document.body.append(host);
  const root = createRoot(host);
  root.render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
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
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return () => {
    root.unmount();
    host.remove();
    if (application) application.hidden = false;
  };
}
