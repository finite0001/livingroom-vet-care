import { z } from "zod";
import { parseReviewIdentity, sameReviewIdentity, type ReviewIdentity, type ReviewRpcConfig, type ReviewSessionSource } from "../record-review/raw-rpc.ts";
import { decodeCountPublicReceipt, parseCountRequest, type CountMutationAction, type CountSavedReply } from "./count-request-schema.ts";
import { verifyCountSavedReply } from "./count-wire.ts";
import { verifyCountReadReply, type CountReadReply } from "./count-read-wire.ts";
import { decodeCountManagementReceipt, decodeCountManagementReply, parseCountManagementRequest, type CountManagementMutationAction, type CountManagementReadReply, type CountManagementSavedReply } from "./count-management-schema.ts";
import { verifyCountManagementReadReply, verifyCountManagementSavedReply } from "./count-management-wire.ts";
import { parseCountOperationClosureRequest, verifyCountOperationClosureReply, type CountOperationClosureReply } from "./count-operation-closure.ts";
import { parseCountDiscoveryReply, parseCountDiscoveryRequest, type CountDiscoveryReply } from "./count-discovery.ts";
import { readCountResponseBytes } from "./count-response.ts";
import { decodeCountPolicyClosureReply, decodeCountPolicyPublishReceipt, parseCountPolicyClosureRequest, parseCountPolicyPublishRequest, parseCountPolicyReply, parseCountPolicyRequest, parseCountScopeReply, parseCountScopeRequest,
  type CountPolicyClosureReply, type CountPolicyPublishReceipt, type CountPolicyReply, type CountScopeReply } from "./count-admin-schema.ts";
import { verifyCountPolicyClosure, verifyCountPolicyReceipt } from "./count-policy-wire.ts";
import { parseCountCauseDiscoveryReply, type CountCauseDiscoveryReply } from "./count-causes.ts";
import { parseCountInvestigationReply, parseCountInvestigationRequest, parseCountReconciliationListReply, parseCountReconciliationListRequest,
  type CountInvestigationReply, type CountReconciliationListReply } from "./count-dashboard.ts";
import { parseCountReconciliationDetail, type CountReconciliationDetailReply } from "./count-reconciliation-detail.ts";

const configSchema = z.object({ projectRef: z.string().regex(/^[a-z]{20}$/), url: z.string().url(),
  publishableKey: z.string().regex(/^sb_publishable_[A-Za-z0-9_-]+$/).max(4096) }).strict()
  .refine(value => value.url === `https://${value.projectRef}.supabase.co`);
const countRpc = { start: "start_controlled_count_v1", statement: "save_controlled_count_statement_v1",
  finalize: "finalize_controlled_count_v1", cancel: "cancel_controlled_count_v1" } as const;
const managementRpc = { reconciliation_prepare: "prepare_controlled_count_reconciliation_v1", reconciliation_approve: "approve_controlled_count_reconciliation_v1",
  reconciliation_execute: "execute_controlled_count_reconciliation_v1", reconciliation_confirm: "confirm_controlled_count_reconciliation_v1", cause_resolve: "resolve_controlled_count_cause_v1" } as const;
export class CountClientError extends Error {
  readonly kind: "identity_changed" | "unconfirmed";
  constructor(kind: "identity_changed" | "unconfirmed") {
    super(kind === "identity_changed" ? "Staff login changed. Sign in and recover the original operation." : "The outcome is unconfirmed. Check the original operation before continuing.");
    this.name = "CountClientError"; this.kind = kind;
  }
}
export interface CountClient {
  mutate(action: CountMutationAction, request: unknown, identity: ReviewIdentity): Promise<CountSavedReply>;
  read(request: unknown, identity: ReviewIdentity): Promise<CountReadReply>;
  discover(request: unknown, identity: ReviewIdentity): Promise<CountDiscoveryReply>;
  closure(mode: "read" | "close", request: unknown, identity: ReviewIdentity): Promise<CountOperationClosureReply>;
  manage(action: CountManagementMutationAction, request: unknown, identity: ReviewIdentity): Promise<CountManagementSavedReply>;
  readManagement(request: unknown, identity: ReviewIdentity): Promise<CountManagementReadReply>;
  scopes(request: unknown, identity: ReviewIdentity): Promise<CountScopeReply>;
  policy(request: unknown, identity: ReviewIdentity): Promise<CountPolicyReply>;
  publishPolicy(request: unknown, identity: ReviewIdentity): Promise<CountPolicyPublishReceipt>;
  policyClosure(mode: "read" | "close", request: unknown, identity: ReviewIdentity): Promise<CountPolicyClosureReply>;
  causes(request: unknown, identity: ReviewIdentity): Promise<CountCauseDiscoveryReply>;
  investigations(request: unknown, identity: ReviewIdentity): Promise<CountInvestigationReply>;
  reconciliations(request: unknown, identity: ReviewIdentity): Promise<CountReconciliationListReply>;
  reconciliationDetail(request: unknown, identity: ReviewIdentity): Promise<CountReconciliationDetailReply>;
}
/** One POST per call, no retry. One deadline includes Auth, streaming and verification. */
export function createCountClient(configInput: ReviewRpcConfig, sessions: ReviewSessionSource, fetcher: typeof fetch = globalThis.fetch): CountClient {
  const configResult = configSchema.safeParse(configInput);
  if (!configResult.success) throw new Error("The count connection configuration is invalid.");
  const config = Object.freeze(configResult.data);
  async function call<T>(rpc: string, request: { readonly actor_id: string }, identityInput: ReviewIdentity, limit: number, verify: (raw: Uint8Array) => T | Promise<T>): Promise<T> {
    const identity = parseReviewIdentity(identityInput);
    if (request.actor_id !== identity.actorId) throw new CountClientError("identity_changed");
    const body = JSON.stringify({ p_request: request });
    if (new TextEncoder().encode(body).length > 263168) throw new CountClientError("unconfirmed");
    const controller = new AbortController(), deadline = performance.now() + 30000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = () => {
      if (controller.signal.aborted || performance.now() >= deadline) throw new CountClientError("unconfirmed");
      if (!sessions.isCurrent(identity)) throw new CountClientError("identity_changed");
    };
    const work = async () => {
      check(); const session = await sessions.current(); check();
      if (!session || !sameReviewIdentity(identity, session) || !/^[A-Za-z0-9_.-]{1,16384}$/.test(session.accessToken)) throw new CountClientError("identity_changed");
      const response = await fetcher(`${config.url}/rest/v1/rpc/${rpc}`, { method: "POST", mode: "cors", credentials: "omit",
        redirect: "error", cache: "no-store", signal: controller.signal,
        headers: { apikey: config.publishableKey, Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json", Accept: "application/json" }, body });
      check(); const raw = await readCountResponseBytes(response, limit, controller.signal); check();
      const value = await verify(raw); check(); return value;
    };
    try {
      return await Promise.race([work(), new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new CountClientError("unconfirmed")); }, 30000);
      })]);
    } catch (error) {
      controller.abort();
      if (error instanceof CountClientError) throw error;
      throw new CountClientError("unconfirmed");
    } finally { if (timer !== undefined) clearTimeout(timer); }
  }
  return Object.freeze({
    mutate(action: CountMutationAction, input: unknown, identity: ReviewIdentity) {
      const request = parseCountRequest(action, input);
      return call(countRpc[action], request, identity, 4096, raw => verifyCountSavedReply(action, request,
        { schema_version: 1, state: "saved", data: { receipt: decodeCountPublicReceipt(raw) } }));
    },
    read(input: unknown, identity: ReviewIdentity) {
      const request = parseCountRequest("read", input);
      return call("read_controlled_count_v1", request, identity, 2 * 1024 * 1024, raw => verifyCountReadReply(raw, request));
    },
    discover(input: unknown, identity: ReviewIdentity) {
      const request = parseCountDiscoveryRequest(input);
      return call("discover_controlled_counts_v1", request, identity, 2 * 1024 * 1024, raw => parseCountDiscoveryReply(raw, request));
    },
    closure(mode: "read" | "close", input: unknown, identity: ReviewIdentity) {
      const request = parseCountOperationClosureRequest(input);
      if (mode !== "read" && mode !== "close") throw new CountClientError("unconfirmed");
      return call(mode === "read" ? "read_controlled_count_operation_closure_v1" : "close_controlled_count_operation_v1", request, identity, 8192,
        raw => verifyCountOperationClosureReply(raw, request));
    },
    manage(action: CountManagementMutationAction, input: unknown, identity: ReviewIdentity) {
      const request = parseCountManagementRequest(action, input);
      return call(managementRpc[action], request, identity, 4096, raw => verifyCountManagementSavedReply(action, request,
        { schema_version: 1, state: "saved", data: { receipt: decodeCountManagementReceipt(raw) } }));
    },
    readManagement(input: unknown, identity: ReviewIdentity) {
      const request = parseCountManagementRequest("read", input);
      return call("read_controlled_count_reconciliation_v1", request, identity, 131072, raw => verifyCountManagementReadReply(request, decodeCountManagementReply(raw)));
    },
    scopes(input: unknown, identity: ReviewIdentity) {
      const request = parseCountScopeRequest(input);
      return call("list_controlled_count_scopes_v1", request, identity, 262144, raw => parseCountScopeReply(raw, request));
    },
    policy(input: unknown, identity: ReviewIdentity) {
      const request = parseCountPolicyRequest(input);
      return call("read_controlled_count_policy_v1", request, identity, 65536, raw => parseCountPolicyReply(raw, request));
    },
    publishPolicy(input: unknown, identity: ReviewIdentity) {
      const request = parseCountPolicyPublishRequest(input);
      return call("publish_controlled_count_policy_v1", request, identity, 4096, raw => verifyCountPolicyReceipt(request, decodeCountPolicyPublishReceipt(raw)));
    },
    policyClosure(mode: "read" | "close", input: unknown, identity: ReviewIdentity) {
      const request = parseCountPolicyClosureRequest(input);
      if (mode !== "read" && mode !== "close") throw new CountClientError("unconfirmed");
      return call(mode === "read" ? "read_controlled_count_operation_closure_v2" : "close_controlled_count_operation_v2", request, identity, 8192,
        raw => verifyCountPolicyClosure(request, decodeCountPolicyClosureReply(raw)));
    },
    causes(input: unknown, identity: ReviewIdentity) {
      const request = parseCountPolicyRequest(input);
      return call("discover_controlled_count_causes_v1", request, identity, 32768, raw => parseCountCauseDiscoveryReply(raw, request));
    },
    investigations(input: unknown, identity: ReviewIdentity) {
      const request = parseCountInvestigationRequest(input);
      return call("list_controlled_count_investigations_v1", request, identity, 32768, raw => parseCountInvestigationReply(raw, request));
    },
    reconciliations(input: unknown, identity: ReviewIdentity) {
      const request = parseCountReconciliationListRequest(input);
      return call("list_controlled_count_reconciliations_v1", request, identity, 1048576, raw => parseCountReconciliationListReply(raw, request));
    },
    reconciliationDetail(input: unknown, identity: ReviewIdentity) {
      const request = parseCountManagementRequest("read", input);
      return call("read_controlled_count_reconciliation_detail_v1", request, identity, 32768, raw => parseCountReconciliationDetail(raw, request));
    },
  });
}
