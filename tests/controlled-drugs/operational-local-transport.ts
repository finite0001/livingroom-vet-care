/** Fixed local origin/public-key translation; bearer, request and response stay original. */
import { narcoticsAuthenticatedInputSchema, type NarcoticsAuthenticatedInput } from "./narcotics-authenticated-input.ts";
export const operationalProofConnection = Object.freeze({ projectRef: "abcdefghijklmnopqrst", url: "https://abcdefghijklmnopqrst.supabase.co", publishableKey: "sb_publishable_disposable_local_test" });
const methods = new Set([
  "list_controlled_count_scopes_v1", "narcotics_recovery_status_v1", "narcotics_recovery_preflight_v1", "narcotics_recovery_arm_v1",
  "narcotics_recovery_source_resume_v1", "narcotics_recovery_read_operation_v1", "narcotics_recovery_close_operation_v1",
  "list_narcotics_registers_v1", "create_narcotics_register_v1", "read_narcotics_register_v1", "close_narcotics_register_operation_v1",
  "preserve_narcotics_form_v1", "read_narcotics_form_operation_v1", "download_narcotics_form_v1",
]);
export function createOperationalLocalTransport(supplied: NarcoticsAuthenticatedInput, send: typeof fetch = globalThis.fetch): typeof fetch {
  const input = narcoticsAuthenticatedInputSchema.parse(supplied);
  return (address, init) => {
    const url = new URL(String(address)), match = /^\/rest\/v1\/rpc\/([a-z0-9_]+)$/.exec(url.pathname);
    if (url.origin !== operationalProofConnection.url || !match || !methods.has(match[1]) || url.search || url.hash || init?.method !== "POST")
      throw new Error("Only closed disposable local operational methods are supported");
    const headers = new Headers(init.headers); headers.set("apikey", input.anonKey);
    return send(input.origin + url.pathname, { ...init, headers });
  };
}
