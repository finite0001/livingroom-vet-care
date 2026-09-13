import type { SupabaseClient } from "@supabase/supabase-js";
import { paymentDb } from "./api";
import { parsePaymentState } from "./state";
import { supabase } from "@/integrations/supabase/client";
import {
  reconciliationDiscovery,
  type ReconciliationIntent,
} from "./ReconciliationState";
interface ReconciliationDatabase {
  public: {
    Tables: Record<never, never>;
    Views: Record<never, never>;
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
    Functions: {
      list_payment_reconciliation_workspace: {
        Args: { p_invoice_id: string };
        Returns: unknown;
      };
      complete_payment_reconciliation: {
        Args: {
          p_case_id: string;
          p_reviewed_proof_hash: string;
          p_expected_case_hash: string;
          p_attest: boolean;
        };
        Returns: unknown;
      };
    };
  };
}
export const reconciliationDb =
  supabase as unknown as SupabaseClient<ReconciliationDatabase>;
export async function previewReconciliation(
  invoice: string,
  family: "checkout" | "refund",
  request: string,
  object: string,
) {
  const { data, error } = await supabase.functions.invoke(
    "verify-payment-reconciliation",
    {
      body: {
        action: "preview",
        p_invoice_id: invoice,
        p_family: family,
        p_request_id: request,
        p_provider_object_id: object,
      },
    },
  );
  if (error) throw error;
  return data as unknown;
}
export async function prepareReconciliation(intent: ReconciliationIntent) {
  const { data, error } = await supabase.functions.invoke(
    "verify-payment-reconciliation",
    { body: { action: "prepare", ...intent } },
  );
  if (error) throw error;
  return data as unknown;
}
export async function recoverReconciliation(id: string) {
  const { data, error } = await supabase.functions.invoke(
    "verify-payment-reconciliation",
    { body: { action: "recover", p_case_id: id } },
  );
  if (error) throw error;
  return data as unknown;
}

export async function readReconciliationWorkspace(
  invoice: string,
  client: string,
  actor: string,
) {
  const { data, error } = await reconciliationDb.rpc(
    "list_payment_reconciliation_workspace",
    { p_invoice_id: invoice },
  );
  if (error) throw error;
  const workspace = reconciliationDiscovery(data, invoice, actor);
  const payment = await paymentDb.rpc("read_invoice_payment_state", {
    p_invoice_id: invoice,
    p_client_id: client,
  });
  if (payment.error) throw payment.error;
  const state = parsePaymentState(payment.data, invoice, client);
  for (const target of workspace.targets)
    target.reasons = state.reconciliation_observations
      .filter(
        (row) =>
          row.family === target.family && row.request_id === target.request_id,
      )
      .map((row) => row.reason);
  for (const [family, rows] of [
    ["checkout", state.attempts],
    ["refund", state.refund_requests],
  ] as const) {
    for (const row of rows)
      if (
        !workspace.targets.some(
          (t) => t.family === family && t.request_id === row.id,
        ) &&
        (row.state === "reconciliation" ||
          state.reconciliation_observations.some(
            (o) =>
              o.family === family &&
              o.request_id === row.id &&
              o.resolved !== true,
          ))
      )
        workspace.targets.push({
          family,
          request_id: row.id,
          provider_object_id: null,
          amount_cents: row.amount_cents,
          reviewable: false,
          reasons: state.reconciliation_observations
            .filter((o) => o.family === family && o.request_id === row.id)
            .map((o) => o.reason),
        });
  }
  return workspace;
}
