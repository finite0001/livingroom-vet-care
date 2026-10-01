import { z } from "zod";
import type { PrescriptionRpc } from "../prescriptions/prescription-api.ts";
import {
  estimateDecisionBindingSchema,
  estimateDecisionHeadSchema,
  estimateDecisionTargetSchema,
  sameEstimateDecisionEvidence as equal,
} from "../../../../supabase/functions/_shared/estimate-decision-contract.ts";

/**
 * Staff side of the client estimate link (`/estimate/:id#token`).
 *
 * Issuing a link is three server steps, each idempotent under its own ID:
 *  1. `prepare-estimate-decision-grant` records the issue request and captures
 *     the capability (state `captured`). It never returns a usable link.
 *  2. `record_native_estimate_decision_grant` with kind `activate` is a separate
 *     staff SQL operation that makes the captured grant usable.
 *  3. `recover-estimate-decision-grant` with the original `{id, request}`
 *     materializes the link for its creator while the grant is active and
 *     issuance is enabled.
 * The original issue request is kept in the grant's own event history, so a
 * lost response is recovered from `read_native_estimate_decision_grants`
 * rather than from browser storage.
 */
const uuid = z.string().uuid().refine((value) => value === value.toLowerCase());
const hash = z.string().regex(/^[a-f0-9]{64}$/);
// Browser mirror of the response schemas in
// supabase/functions/_shared/estimate-decision-grant-http.ts. That module is
// server-side and outside the app's TypeScript program; keep the two in step.
const instant = z.string().datetime().refine((v) => Number.isFinite(Date.parse(v)) && !/\.\d{7}/.test(v));
const text = (max: number) => z.string().refine((v) => v === v.trim() && Array.from(v).length >= 1 && Array.from(v).length <= max &&
  !/[\uD800-\uDFFF]/u.test(v) && !Array.from(v).some((c) => { const n = c.charCodeAt(0); return n === 127 || (n < 32 && n !== 9 && n !== 10); }));
const issueRequestSchema = z.object({
  binding: estimateDecisionBindingSchema, expected_publication_head: estimateDecisionHeadSchema, expires_at: instant,
  recipient_label: text(200), purpose: text(500), attest_recipient_authority: z.literal(true),
}).strict();
const activation = z.object({ id: uuid, actor_id: uuid, created_at: instant }).strict();
const grantViewSchema = z.object({
  version: z.literal(1), id: uuid, actor_id: uuid, request: issueRequestSchema, request_hash: hash, created_at: instant,
  capability: z.object({ origin: z.string().max(2048), key_version: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/), context_hash: hash }).strict().nullable(),
  capture: z.object({ captured_at: instant }).strict().nullable(), head: estimateDecisionHeadSchema,
  state: z.enum(["preparing", "captured", "active", "revoked"]), activation: activation.nullable(),
  revocation: activation.extend({ reason: z.string() }).strict().nullable(),
}).strict();
const issueReceiptSchema = z.object({
  version: z.literal(1), id: uuid, actor_id: uuid, mutation: z.object({ kind: z.literal("issue"), request: issueRequestSchema }).strict(),
  request_hash: hash, result: grantViewSchema, created_at: instant,
}).strict();
const preparationResultSchema = z.object({
  version: z.literal(1), receipt: issueReceiptSchema.nullable(), grant: grantViewSchema.nullable(),
  link: z.object({ url: z.string().max(4096), expires_at: instant }).strict().nullable(),
}).strict();
const grantEventSchema = z.object({
  id: uuid, grant_id: uuid, kind: z.enum(["issued", "activated", "revoked"]),
  actor_id: uuid, created_at: z.string(), sequence: z.number().int().positive(),
  request: z.unknown(), eligibility: z.string(),
}).passthrough();
const grantPageSchema = z.object({
  version: z.literal(1), target: estimateDecisionTargetSchema,
  items: z.array(grantEventSchema).max(50),
  next_before_sequence: z.number().int().positive().nullable(), has_more: z.boolean(),
}).strict();
const activationReceiptSchema = z.object({
  version: z.literal(1), id: uuid, actor_id: uuid,
  mutation: z.object({ kind: z.literal("activate"), request: z.unknown() }).strict(),
  request_hash: hash, result: grantViewSchema, created_at: z.string(),
}).strict();
const capabilityToken = /^e1\.[A-Za-z0-9_-]{43}$/;

export interface EstimateGrantTarget { estimate_id: string; client_id: string; pet_id: string }
export interface EstimateGrantHead { event_id: string | null; version: number; record_hash: string | null }
export interface EstimateGrantBinding { target: EstimateGrantTarget; publication_id: string; content_hash: string; artifact_hash: string }
export interface EstimateGrantIssueRequest {
  binding: EstimateGrantBinding; expected_publication_head: EstimateGrantHead;
  expires_at: string; recipient_label: string; purpose: string; attest_recipient_authority: true;
}
export interface EstimateGrantView {
  version: 1; id: string; actor_id: string; request: EstimateGrantIssueRequest; request_hash: string; created_at: string;
  capability: { origin: string; key_version: string; context_hash: string } | null;
  capture: { captured_at: string } | null; head: EstimateGrantHead;
  state: "preparing" | "captured" | "active" | "revoked";
  activation: { id: string; actor_id: string; created_at: string } | null;
  revocation: { id: string; actor_id: string; created_at: string; reason: string } | null;
}
interface EstimateGrantPreparationResult {
  receipt: { id: string; actor_id: string; mutation: { kind: "issue"; request: EstimateGrantIssueRequest } } | null;
  grant: EstimateGrantView | null;
  link: { url: string; expires_at: string } | null;
}
export interface EstimateGrantIntent { id: string; request: EstimateGrantIssueRequest }
export interface EstimateGrantPreview { binding: EstimateGrantBinding; publication_head: EstimateGrantHead; expires_at: string }
export interface EstimateGrantFields { recipient_label: string; purpose: string; expires_at: string; attest_recipient_authority: boolean }
/** An issued grant this staff member created, with the original request needed to recover it. */
export interface EstimateIssuedGrant { intent: EstimateGrantIntent; issued_at: string; eligibility: string }
export type EstimateGrantOutcome =
  | { status: "link"; grant: EstimateGrantView; url: string; expires_at: string }
  | { status: "issuance_disabled"; grant: EstimateGrantView }
  | { status: "not_active"; grant: EstimateGrantView }
  | { status: "absent" };

/** The function refused: issuance switched off, misconfigured, or the estimate changed. The server deliberately does not say which. */
export class EstimateGrantUnavailableError extends Error {
  constructor() {
    super("Client link unavailable. Client-link issuance may be switched off on the server (ESTIMATE_DECISION_ISSUANCE_ENABLED), or this estimate changed. Recover the request before issuing another.");
  }
}

export type EstimateGrantEdgeMode = "prepare" | "recover";
export interface EstimateGrantEdge { post(mode: EstimateGrantEdgeMode, body: EstimateGrantIntent): Promise<unknown> }

export function createEstimateDecisionGrantEdge(
  baseUrl: string,
  getAccessToken: () => Promise<string | null>,
  publishableKey: string,
  fetcher: typeof fetch = fetch,
): EstimateGrantEdge {
  const origin = new URL(baseUrl);
  if (origin.origin !== baseUrl || !publishableKey ||
    (origin.protocol !== "https:" && !(origin.protocol === "http:" && ["localhost", "127.0.0.1"].includes(origin.hostname)))) {
    throw new Error("Estimate link service is not configured.");
  }
  return {
    async post(mode, body) {
      const token = await getAccessToken();
      if (!token) throw new Error("Staff session unavailable.");
      const response = await fetcher(`${baseUrl}/functions/v1/${mode}-estimate-decision-grant`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, apikey: publishableKey, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer", redirect: "error",
      });
      if (response.status === 404) throw new EstimateGrantUnavailableError();
      if (!response.ok || response.headers.get("Content-Type")?.split(";")[0].trim() !== "application/json") {
        throw new Error("The client link request could not be verified. Recover it before issuing another.");
      }
      const payload = await response.text();
      if (payload.length > 65536) throw new Error("The client link response was too large.");
      return JSON.parse(payload);
    },
  };
}

export function createEstimateDecisionGrantApi(edge: EstimateGrantEdge, db: PrescriptionRpc, actorId: string, targetInput: EstimateGrantTarget) {
  uuid.parse(actorId);
  const target = estimateDecisionTargetSchema.parse(targetInput) as EstimateGrantTarget;
  function require(condition: unknown): asserts condition {
    if (!condition) throw new Error("Client link evidence does not match this estimate and staff member.");
  }
  async function call(name: string, args: Record<string, unknown>) {
    const { data, error } = await db.rpc(name, args);
    if (error) throw error;
    return data;
  }
  function verify(intent: EstimateGrantIntent, value: unknown): EstimateGrantPreparationResult {
    const result = preparationResultSchema.parse(value) as EstimateGrantPreparationResult;
    if (!result.receipt) {
      require(result.grant === null && result.link === null);
      return result;
    }
    require(result.receipt.id === intent.id && result.receipt.actor_id === actorId && equal(result.receipt.mutation.request, intent.request) &&
      result.grant && result.grant.id === intent.id && result.grant.actor_id === actorId && equal(result.grant.request, intent.request));
    if (result.link) {
      // The same checks the server applies before it returns a link.
      const url = new URL(result.link.url);
      require(result.grant.state === "active" && result.grant.capability && url.origin === result.grant.capability.origin &&
        url.pathname === `/estimate/${intent.id}` && !url.search && !url.username && !url.password &&
        capabilityToken.test(url.hash.slice(1)) && result.link.expires_at === intent.request.expires_at);
    }
    return result;
  }
  function outcome(result: EstimateGrantPreparationResult): EstimateGrantOutcome {
    if (!result.grant) return { status: "absent" };
    if (result.link) return { status: "link", grant: result.grant, url: result.link.url, expires_at: result.link.expires_at };
    // The creator recovered an active grant but the server withheld the link:
    // issuance is switched off (ESTIMATE_DECISION_ISSUANCE_ENABLED), or the grant just expired.
    if (result.grant.state === "active") return { status: "issuance_disabled", grant: result.grant };
    return { status: "not_active", grant: result.grant };
  }
  function parseIntent(value: unknown): EstimateGrantIntent {
    const intent = z.object({ id: uuid, request: issueRequestSchema }).strict().parse(value) as EstimateGrantIntent;
    require(equal(intent.request.binding.target, target));
    return intent;
  }
  return {
    /** Build an exact issue request from the current publication preview. Nothing is sent. */
    intent(preview: EstimateGrantPreview, fields: EstimateGrantFields): EstimateGrantIntent {
      require(equal(preview.binding.target, target));
      if (Date.parse(fields.expires_at) > Date.parse(preview.expires_at)) {
        throw new Error("The link cannot outlast the estimate's acceptance deadline.");
      }
      return parseIntent({
        id: crypto.randomUUID(),
        request: {
          binding: preview.binding, expected_publication_head: preview.publication_head,
          expires_at: fields.expires_at, recipient_label: fields.recipient_label.trim(), purpose: fields.purpose.trim(),
          attest_recipient_authority: fields.attest_recipient_authority,
        },
      });
    },
    parseIntent,
    async prepare(input: EstimateGrantIntent): Promise<EstimateGrantOutcome> {
      const intent = parseIntent(input);
      return outcome(verify(intent, await edge.post("prepare", intent)));
    },
    async recover(input: EstimateGrantIntent): Promise<EstimateGrantOutcome> {
      const intent = parseIntent(input);
      return outcome(verify(intent, await edge.post("recover", intent)));
    },
    /** Activate a captured grant against the current publication head. A separate staff SQL operation. */
    async activate(grant: EstimateGrantView, publicationHead: EstimateGrantHead): Promise<EstimateGrantView> {
      require(grant.actor_id === actorId && grant.state === "captured" && grant.capability && equal(grant.request.binding.target, target));
      const head = estimateDecisionHeadSchema.parse(publicationHead);
      const receipt = activationReceiptSchema.parse(await call("record_native_estimate_decision_grant", {
        p_id: crypto.randomUUID(),
        p_mutation: { kind: "activate", request: {
          grant_id: grant.id, expected_grant_head: grant.head, expected_publication_head: head,
          expected_context_hash: grant.capability.context_hash, attest_review: true,
        } },
      }));
      require(receipt.actor_id === actorId && receipt.result.id === grant.id && receipt.result.state === "active");
      return receipt.result as EstimateGrantView;
    },
    /** This staff member's issued grants for the estimate, newest first. */
    async issued(): Promise<EstimateIssuedGrant[]> {
      const page = grantPageSchema.parse(await call("read_native_estimate_decision_grants", {
        p_estimate_id: target.estimate_id, p_client_id: target.client_id, p_before_sequence: null, p_limit: 50,
      }));
      require(equal(page.target, target));
      const grants: EstimateIssuedGrant[] = [];
      for (const event of page.items) {
        if (event.kind !== "issued" || event.actor_id !== actorId) continue;
        grants.push({ intent: parseIntent({ id: event.grant_id, request: event.request }), issued_at: event.created_at, eligibility: event.eligibility });
      }
      return grants;
    },
  };
}
