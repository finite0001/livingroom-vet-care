/** Closed local real-SDK proof using the shared workspace. No production route. */
import { useEffect, useState, useSyncExternalStore } from "react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "../../src/components/ui/toaster";
import { AuthProvider } from "../../src/hub/contexts/AuthContext";
import { useAuth } from "../../src/hub/contexts/auth-context";
import LoginPage from "../../src/hub/pages/LoginPage";
import { useReviewStaffSessions } from "../../src/hub/features/controlled-drugs/record-review/staff-session-context";
import { RecordReviewWorkspace } from "../../src/hub/features/controlled-drugs/record-review/RecordReviewWorkspace";
import { createReviewWorkspace } from "../../src/hub/features/controlled-drugs/record-review/workspace";
import { createReviewLifecycle } from "../../src/hub/features/controlled-drugs/record-review/lifecycle";
import { createReviewRawRpc } from "../../src/hub/features/controlled-drugs/record-review/raw-rpc";
import { createReviewReadRpc } from "../../src/hub/features/controlled-drugs/record-review/read-rpc";
import type { ReadReviewSelection } from "../../src/hub/features/controlled-drugs/record-review/read-detail";
import { reviewRequiredPacketSchema } from "../../src/hub/features/controlled-drugs/record-review/prepared-packet";
import { browserReviewPointerStore } from "../../src/hub/features/controlled-drugs/record-review/recovery-pointer";
import { verifyProspectiveClinicalMovement } from "../../src/hub/features/controlled-drugs/record-review/prospective-stock-movement";
import type { LocalAuthenticatedClinicalInput } from "./local-authenticated-clinical-input";
import "../../src/index.css";

interface StaffProofSnapshot {
  phase: string; operationId: string | null; cleanupPending: boolean; receiptHash: string | null;
  queuePhase: string; selection: Readonly<ReadReviewSelection> | null;
  actorId: string | null; sessionId: string | null; generation: number | null;
}
interface StaffProofHandle { snapshot(): StaffProofSnapshot }
declare global { interface Window { __LRV_LOCAL_CLINICAL_INPUT__?: unknown; __LRV_LOCAL_CLINICAL_REVIEW__?: StaffProofHandle } }
interface FixtureProps { input: LocalAuthenticatedClinicalInput }

function ReviewFixture({ input }: FixtureProps) {
  const sessions = useReviewStaffSessions();
  const [workspace] = useState(() => {
    const config = { projectRef: "abcdefghijklmnopqrst", url: "https://abcdefghijklmnopqrst.supabase.co", publishableKey: "sb_publishable_disposable_local_test" };
    let loseFirstExecute = true;
    const localFetch: typeof fetch = async (url, options) => {
      const address = new URL(String(url));
      if (address.origin !== config.url || !/^\/rest\/v1\/rpc\/((prepare|read|execute|cancel)_controlled_record_review_v3|get_controlled_record_review_event_v3|list_controlled_record_reviews_v3)$/.test(address.pathname) || address.search || address.hash)
        throw new Error("Only fixed local review methods are supported");
      const headers = new Headers(options?.headers); headers.set("apikey", input.anonKey);
      const response = await fetch(input.origin + address.pathname, { ...options, headers });
      if (address.pathname.endsWith("/execute_controlled_record_review_v3") && response.ok && loseFirstExecute) {
        loseFirstExecute = false; await response.body?.cancel(); throw new Error("Deliberate loss after the real server response");
      }
      return response;
    };
    return createReviewWorkspace({ sessions, reads: createReviewReadRpc(config, sessions, localFetch),
      model: createReviewLifecycle({ pointers: browserReviewPointerStore(), rpc: createReviewRawRpc(config, sessions, localFetch),
        evidence: { validate: verifyProspectiveClinicalMovement } }),
      evidence: { async validate(result, request) {
        if (result.state !== "detail" || result.data.packet.target.event_id !== input.expectedEventId || result.data.packet.adapter.event_kind !== input.scope.event_kind)
          throw new Error("Only the expected complete clinical detail is supported in this proof");
        if (!request.event_id) throw new Error("The original detail target is required");
        await verifyProspectiveClinicalMovement(reviewRequiredPacketSchema.parse(result.data.packet), { event_id: request.event_id });
      } } });
  });
  useEffect(() => {
    const handle: StaffProofHandle = { snapshot() {
      const state = workspace.getSnapshot(), identity = state.identity, visible = identity && sessions.isCurrent(identity);
      const review = workspace.model.getSnapshot();
      return { phase: visible ? review.phase : "signed_out", operationId: visible ? review.pointer?.operation_id ?? null : null,
        cleanupPending: visible && !!review.cleanupPending, receiptHash: visible && review.outcome?.state === "saved" ? review.outcome.data.receipt.receipt_hash : null,
        queuePhase: visible ? state.queue.phase : "signed_out", selection: visible ? state.detail?.selection ?? null : null,
        actorId: visible ? identity.actorId : null, sessionId: visible ? identity.sessionId : null, generation: visible ? identity.generation : null };
    } };
    window.__LRV_LOCAL_CLINICAL_REVIEW__ = handle;
    return () => { if (window.__LRV_LOCAL_CLINICAL_REVIEW__ === handle) delete window.__LRV_LOCAL_CLINICAL_REVIEW__; };
  }, [sessions, workspace]);
  return <main className="mx-auto max-w-4xl space-y-6 p-4 md:p-8">
    <aside className="rounded-xl border bg-muted p-4 text-sm">Disposable clinical SDK login and shared review workspace · synthetic records</aside>
    <RecordReviewWorkspace workspace={workspace} request={{ ...input.scope, view: "site", page_size: 1 }} />
  </main>;
}
function StaffBoundary({ input }: FixtureProps) {
  const auth = useAuth(), sessions = useReviewStaffSessions();
  const identity = useSyncExternalStore(sessions.subscribe, sessions.getSnapshot, () => null);
  if (auth.loading) return <main className="p-8"><p role="status">Checking staff access…</p></main>;
  if (!auth.session || !auth.profile?.is_active || !identity) return <LoginPage />;
  if (identity.actorId !== input.actorId || auth.user?.id !== input.actorId)
    return <main className="p-8"><p role="alert">Only the expected disposable reviewer is supported.</p></main>;
  return <ReviewFixture input={input} />;
}
export function AuthenticatedClinicalProof({ input }: FixtureProps) {
  const [query] = useState(() => new QueryClient());
  const [router] = useState(() => createMemoryRouter([{ path: "*", element: <StaffBoundary input={input} /> }], { initialEntries: ["/hub/login"] }));
  return <QueryClientProvider client={query}><AuthProvider><RouterProvider router={router} /><Toaster /></AuthProvider></QueryClientProvider>;
}
