import type { ReviewRpcConfig } from "./raw-rpc.ts";
import { createReviewRawRpc } from "./raw-rpc.ts";
import { createReviewReadRpc } from "./read-rpc.ts";
import type { ReviewStaffSessionSource } from "./staff-session.ts";
import { browserReviewPointerStore } from "./recovery-pointer.ts";
import { createReconstructedReviewEvidence } from "./reconstructed-evidence.ts";
import { createReviewLifecycle } from "./lifecycle.ts";
import { createReviewWorkspace } from "./workspace.ts";
/** One composition for the staff page. There is no permissive evidence adapter
 * or unlocked storage fallback. Construction does not read, prepare or sign. */
export function createStaffRecordReviewWorkspace(config: ReviewRpcConfig, sessions: ReviewStaffSessionSource, fetcher: typeof fetch = globalThis.fetch) {
  const reads = createReviewReadRpc(config, sessions, fetcher);
  const evidence = createReconstructedReviewEvidence(reads, sessions);
  const model = createReviewLifecycle({ pointers: browserReviewPointerStore(), rpc: createReviewRawRpc(config, sessions, fetcher), evidence: evidence.prepared });
  return createReviewWorkspace({ sessions, reads, model, evidence: evidence.detail });
}
