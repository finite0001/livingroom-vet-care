/** Test-only fixed origin/key translation. No bearer, body or response rewriting. */
import type { NarcoticsAuthenticatedInput } from "./narcotics-authenticated-input.ts";
export const narcoticsProofConnection = Object.freeze({ projectRef: "abcdefghijklmnopqrst", url: "https://abcdefghijklmnopqrst.supabase.co", publishableKey: "sb_publishable_disposable_local_test" });
const methods = new Set([
  "list_controlled_count_scopes_v1", "read_controlled_count_policy_v1", "publish_controlled_count_policy_v1",
  "discover_controlled_counts_v1", "start_controlled_count_v1", "read_controlled_count_v1", "save_controlled_count_statement_v1", "finalize_controlled_count_v1", "cancel_controlled_count_v1",
  "read_controlled_count_operation_closure_v1", "close_controlled_count_operation_v1", "read_controlled_count_operation_closure_v2", "close_controlled_count_operation_v2",
  "prepare_controlled_count_reconciliation_v1", "approve_controlled_count_reconciliation_v1", "execute_controlled_count_reconciliation_v1", "confirm_controlled_count_reconciliation_v1", "resolve_controlled_count_cause_v1", "read_controlled_count_reconciliation_v1",
  "discover_controlled_count_causes_v1", "list_controlled_count_investigations_v1", "list_controlled_count_reconciliations_v1", "read_controlled_count_reconciliation_detail_v1",
  "list_controlled_stock_administration_options_v1", "preview_controlled_stock_opening_v1", "read_current_stock_policy_v1", "read_controlled_stock_administration_configuration_v1", "project_controlled_review_calendar_v1", "list_controlled_stock_administration_operations_v1",
  "prepare_controlled_stock_administration_v1", "read_controlled_stock_administration_operation_v1", "execute_controlled_stock_administration_v1", "close_controlled_stock_administration_operation_v1",
  "list_managed_stock_witness_tasks_v1", "read_managed_stock_witness_v1", "attest_managed_stock_witness_v1", "read_managed_stock_witness_operation_v1", "close_managed_stock_witness_operation_v1",
]);
export function createNarcoticsLocalTransport(input: NarcoticsAuthenticatedInput, send: typeof fetch = globalThis.fetch): typeof fetch {
  return async (address, init) => {
    const url = new URL(String(address));
    const match = /^\/rest\/v1\/rpc\/([a-z0-9_]+)$/.exec(url.pathname);
    if (input.origin !== "http://127.0.0.1:64661" || url.origin !== narcoticsProofConnection.url || !match || !methods.has(match[1]) || url.search || url.hash || init?.method !== "POST")
      throw new Error("Only closed disposable local narcotics methods are supported");
    const headers = new Headers(init.headers); headers.set("apikey", input.anonKey);
    return send(input.origin + url.pathname, { ...init, headers });
  };
}
