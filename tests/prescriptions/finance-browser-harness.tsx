import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NativeDispenseFinance } from "../../src/hub/features/prescriptions/NativeDispenseFinance";
import type { NativeDispense } from "../../src/hub/features/prescriptions/fulfillment-api";
let cache: QueryClient;
export function invalidateFinanceInvoice(invoiceId: string) {
  return cache.invalidateQueries({ queryKey: ["invoice", invoiceId] });
}
export function financeInvoiceInvalidated(invoiceId: string) {
  return cache.getQueryState(["invoice", invoiceId])?.isInvalidated;
}
export function mountFinance(actor: string, dispense: NativeDispense) {
  const app = document.getElementById("root");
  if (app) app.hidden = true;
  const host = document.createElement("div");
  document.body.append(host);
  cache = new QueryClient();
  cache.setQueryData(["invoice", dispense.invoice_id], {});
  createRoot(host).render(
    <QueryClientProvider client={cache}>
      <NativeDispenseFinance
        actor={actor}
        dispense={dispense}
        medicationName="Synthetic medication"
        evidenceRevision={0}
        disabled={false}
        onDirtyChange={() => {}}
        onClose={() => {}}
      />
    </QueryClientProvider>,
  );
}
