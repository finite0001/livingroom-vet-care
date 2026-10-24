/** Closed local source-bound composition; no production route/default gate. */
import { useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { Button } from "../../src/components/ui/button";
import { RecordReviewQueue } from "../../src/hub/features/controlled-drugs/record-review/RecordReviewQueue";
import { RecordReviewWorkflow, type RecordReviewSelection } from "../../src/hub/features/controlled-drugs/record-review/RecordReviewWorkflow";
import { createReviewLifecycle } from "../../src/hub/features/controlled-drugs/record-review/lifecycle";
import { createReviewRawRpc, sameReviewIdentity, type ReviewSessionSource } from "../../src/hub/features/controlled-drugs/record-review/raw-rpc";
import { createReviewReadRpc } from "../../src/hub/features/controlled-drugs/record-review/read-rpc";
import { createReviewQueueReader } from "../../src/hub/features/controlled-drugs/record-review/queue-reader";
import { verifyReviewDetail } from "../../src/hub/features/controlled-drugs/record-review/read-detail";
import { reviewRequiredPacketSchema } from "../../src/hub/features/controlled-drugs/record-review/prepared-packet";
import { browserReviewPointerStore } from "../../src/hub/features/controlled-drugs/record-review/recovery-pointer";
import { verifyProspectiveStockMovement } from "../../src/hub/features/controlled-drugs/record-review/prospective-stock-movement";
import { localAuthenticatedReviewReadInputSchema, type LocalAuthenticatedReviewReadInput } from "./local-authenticated-review-read-input";
import "../../src/index.css";

declare global {
  interface Window {
    __LRV_LOCAL_AUTH_READ_INPUT__?: unknown;
    __LRV_LOCAL_READ_REVIEW__?: { snapshot(): { phase: string; operationId: string | null; cleanupPending: boolean;
      receiptHash: string | null; queuePhase: string; selection: Readonly<RecordReviewSelection> | null } };
  }
}
const parsed = localAuthenticatedReviewReadInputSchema.safeParse(window.__LRV_LOCAL_AUTH_READ_INPUT__);
if (!parsed.success) {
  createRoot(document.getElementById("root")!).render(<main className="p-8"><p>Private disposable local input is required. No API request was sent.</p></main>);
} else {
  const input = parsed.data as LocalAuthenticatedReviewReadInput;
  const identity = { actorId: input.session.actorId, sessionId: input.session.sessionId, generation: input.session.generation };
  const sessions: ReviewSessionSource = { current: async () => input.session, isCurrent: current => sameReviewIdentity(current, identity) };
  const config = { projectRef: "abcdefghijklmnopqrst", url: "https://abcdefghijklmnopqrst.supabase.co", publishableKey: "sb_publishable_disposable_local_test" };
  let loseFirstExecute = true;
  const localFetch: typeof fetch = async (url, options) => {
    const address = new URL(String(url));
    if (address.origin !== config.url || !/^\/rest\/v1\/rpc\/((prepare|read|execute|cancel)_controlled_record_review_v3|get_controlled_record_review_event_v3|list_controlled_record_reviews_v3)$/.test(address.pathname) || address.search || address.hash)
      throw new Error("Only fixed local review methods are supported");
    // Explicit test-only origin/public-key adapter; actual bearer/body unchanged.
    const headers = new Headers(options?.headers); headers.set("apikey", input.anonKey);
    const response = await fetch(input.origin + address.pathname, { ...options, headers });
    if (address.pathname.endsWith("/execute_controlled_record_review_v3") && response.ok && loseFirstExecute) {
      loseFirstExecute = false; await response.body?.cancel();
      throw new Error("Deliberate loss after the real server response");
    }
    return response;
  };
  const reads = createReviewReadRpc(config, sessions, localFetch);
  const queue = createReviewQueueReader({ rpc: reads, isCurrent: sessions.isCurrent });
  const model = createReviewLifecycle({ pointers: browserReviewPointerStore(), rpc: createReviewRawRpc(config, sessions, localFetch),
    evidence: { validate: verifyProspectiveStockMovement } });
  queue.setIdentity(identity); model.setIdentity(identity);
  let selection: Readonly<RecordReviewSelection> | null = null;
  window.__LRV_LOCAL_READ_REVIEW__ = { snapshot() {
    const state = model.getSnapshot();
    return { phase: state.phase, operationId: state.pointer?.operation_id ?? null, cleanupPending: !!state.cleanupPending,
      receiptHash: state.outcome?.state === "saved" ? state.outcome.data.receipt.receipt_hash : null,
      queuePhase: queue.getSnapshot().phase, selection };
  } };
  function Fixture() {
    const state = useSyncExternalStore(queue.subscribe, queue.getSnapshot, queue.getSnapshot);
    const [selected, setSelected] = useState<Readonly<RecordReviewSelection> | null>(null);
    const [busy, setBusy] = useState(false), [error, setError] = useState(""), [dirty, setDirty] = useState(false);
    const check = () => { if (!sessions.isCurrent(identity)) throw new Error("Obsolete local identity"); };
    const mayReplace = () => !dirty || window.confirm("Discard the unsubmitted review draft?");
    async function refresh() {
      if (busy || !mayReplace()) return;
      selection = null; setSelected(null); setError("");
      await queue.refresh({ actor_id: identity.actorId, ...input.scope, view: "site", page_size: 1, cursor: null });
    }
    async function openRecord(eventId: string) {
      if (busy || !mayReplace()) return;
      const page = queue.getSnapshot().page;
      if (!page || page.data.items.length !== 1 || page.data.items[0].event_id !== eventId || eventId !== input.expectedEventId) {
        setError("The returned synthetic queue row differs."); return;
      }
      const opened = page.data.items[0];
      selection = null; setSelected(null); setBusy(true); setError("");
      try {
        const request = { actor_id: identity.actorId, event_id: eventId };
        const raw = await reads.call("get_controlled_record_review_event_v3", request, identity, check); check();
        const accepted = await verifyReviewDetail(request, raw, { async validate(result) {
          if (result.state !== "detail") throw new Error("This local proof enables complete scalar detail only");
          await verifyProspectiveStockMovement(reviewRequiredPacketSchema.parse(result.data.packet), request);
        } }, check); check();
        if (accepted.response.state !== "detail" || accepted.response.data.packet.target.product_id !== input.scope.product_id ||
          accepted.response.data.summary.site_id !== input.scope.site_id || accepted.response.data.summary.event_kind !== input.scope.event_kind ||
          Object.keys(opened).some(key => {
            const field = key as keyof typeof opened;
            return accepted.response.data.summary[field] !== opened[field];
          }))
          throw new Error("The admitted detail differs from the opened queue scope or row");
        if (!accepted.selection) throw new Error("No available server selection");
        // The strict runtime schema requires all five keys; this repository's
        // non-strict-null TypeScript mode otherwise infers optional Zod keys.
        selection = accepted.selection as Readonly<RecordReviewSelection>; setSelected(selection);
      } catch { setError("The record could not be admitted for this local review."); }
      finally { setBusy(false); }
    }
    return <main className="mx-auto max-w-4xl space-y-6 p-4 md:p-8">
      <aside className="rounded-xl border bg-muted p-4 text-sm">Disposable local authenticated queue and review · synthetic records · no production activation</aside>
      {error && <p role="alert">{error}</p>}
      {!state.page && <Button className="min-h-11" disabled={busy || state.phase === "loading"} onClick={() => { void refresh(); }}>Load review records</Button>}
      {state.page && <RecordReviewQueue page={state.page} busy={busy} openRecord={eventId => { void openRecord(eventId); }}
        restart={() => { void refresh(); }} nextPage={() => { void queue.nextPage(); }} />}
      <RecordReviewWorkflow model={model} selection={selected} onDraftDirtyChange={setDirty} />
    </main>;
  }
  createRoot(document.getElementById("root")!).render(<Fixture />);
}
