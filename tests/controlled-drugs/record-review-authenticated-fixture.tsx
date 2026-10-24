/** Test-only real local API composition. No production route or default gate.
 * Runtime source/metadata admission must precede opening this fixed fixture.
 * The local harness supplies disposable JWTs from actual password sign-in; this
 * is not production origin/key/selection/global/native admission.
 */
import { createRoot } from "react-dom/client";
import { RecordReviewWorkflow } from "../../src/hub/features/controlled-drugs/record-review/RecordReviewWorkflow";
import { createReviewLifecycle } from "../../src/hub/features/controlled-drugs/record-review/lifecycle";
import { createReviewRawRpc, sameReviewIdentity } from "../../src/hub/features/controlled-drugs/record-review/raw-rpc";
import { browserReviewPointerStore } from "../../src/hub/features/controlled-drugs/record-review/recovery-pointer";
import { verifyProspectiveStockMovement } from "../../src/hub/features/controlled-drugs/record-review/prospective-stock-movement";
import { localAuthenticatedReviewInputSchema, type LocalAuthenticatedReviewInput } from "./local-authenticated-review-input";
import "../../src/index.css";

declare global {
  interface Window {
    __LRV_LOCAL_AUTH_INPUT__?: unknown;
    __LRV_LOCAL_REVIEW__?: { snapshot(): { phase: string; operationId: string | null; cleanupPending: boolean; receiptHash: string | null };
      calls(): readonly { method: string; status: number; responseLost: boolean }[] };
  }
}
const result = localAuthenticatedReviewInputSchema.safeParse(window.__LRV_LOCAL_AUTH_INPUT__);
if (!result.success) {
  createRoot(document.getElementById("root")!).render(<main className="p-8"><p>Private disposable local test input is required. No API request was sent.</p></main>);
} else {
  const input = result.data as LocalAuthenticatedReviewInput, sessions = { current: async () => input.session, isCurrent: identity => sameReviewIdentity(identity, input.session) };
  const calls: { method: string; status: number; responseLost: boolean }[] = [];
  const testOrigin = "https://abcdefghijklmnopqrst.supabase.co";
  let loseFirstExecute = true;
  const transport = createReviewRawRpc({ projectRef: "abcdefghijklmnopqrst", url: testOrigin, publishableKey: "sb_publishable_disposable_local_test" }, sessions,
    async (url, options) => {
      const parsed = new URL(String(url));
      if (parsed.origin !== testOrigin || !/^\/rest\/v1\/rpc\/(prepare|read|execute|cancel)_controlled_record_review_v3$/.test(parsed.pathname) || parsed.search || parsed.hash)
        throw new Error("Only the fixed local review methods are supported");
      // Origin and public gateway-key translation are explicit test adapters.
      // Bearer token, method/body and production transport logic stay unchanged.
      const headers = new Headers(options?.headers); headers.set("apikey", input.anonKey);
      const response = await fetch(input.origin + parsed.pathname, { ...options, headers });
      const responseLost = parsed.pathname.endsWith("/execute_controlled_record_review_v3") && response.ok && loseFirstExecute;
      calls.push({ method: parsed.pathname.split("/").pop()!, status: response.status, responseLost });
      if (responseLost) {
        loseFirstExecute = false; await response.body?.cancel();
        throw new Error("Deliberate test-only loss after the real server response");
      }
      return response;
    });
  const model = createReviewLifecycle({ pointers: browserReviewPointerStore(), rpc: transport,
    evidence: { validate: verifyProspectiveStockMovement } }); // Scoped local source-bound demonstration only.
  model.setIdentity({ actorId: input.session.actorId, sessionId: input.session.sessionId, generation: input.session.generation });
  window.__LRV_LOCAL_REVIEW__ = {
    snapshot() {
      const state = model.getSnapshot();
      return { phase: state.phase, operationId: state.pointer?.operation_id ?? null, cleanupPending: !!state.cleanupPending,
        receiptHash: state.outcome?.state === "saved" ? state.outcome.data.receipt.receipt_hash : null };
    },
    calls: () => calls.map(call => ({ ...call })),
  };
  createRoot(document.getElementById("root")!).render(<main className="mx-auto max-w-4xl space-y-6 p-4 md:p-8">
    <aside className="rounded-xl border bg-muted p-4 text-sm">Disposable local authenticated review · synthetic records · no production activation</aside>
    <RecordReviewWorkflow model={model} selection={input.selection} />
  </main>);
}
