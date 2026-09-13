import {paymentAccessConfig, paymentGrantFromContext, materializePaymentCheckout} from "./payment-access-capability.ts";
import type {PaymentScopedCheckoutIntent} from "./payment-access-capability.ts";
import {createStripeRefundHandler} from "./stripe-refund.ts";
import type {RefundContext} from "./stripe-refund.ts";
import {createClient} from "https://esm.sh/@supabase/supabase-js@2.110.3";
import {createStripeProvider} from "./stripe-provider.ts";
import {createStripeCheckoutHandler} from "./stripe-checkout.ts";
import type {CheckoutContext} from "./stripe-checkout.ts";
import {createStripeWebhookHandler} from "./stripe-webhook.ts";
import {processStripeEvent} from "./stripe-event-worker.ts";
import type {StripeEventLease} from "./stripe-event-worker.ts";
import type {CheckoutIntent, RefundIntent} from "./stripe-provider.ts";
import {authenticateWorker} from "./worker-auth.ts";
function service(key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!) {
  return createClient(Deno.env.get("SUPABASE_URL")!, key, {auth: {persistSession: false, autoRefreshToken: false}});
}
function provider() {
  return createStripeProvider({
    STRIPE_PAYMENTS_ENABLED: Deno.env.get("STRIPE_PAYMENTS_ENABLED"),
    STRIPE_SECRET_KEY: Deno.env.get("STRIPE_SECRET_KEY"),
    STRIPE_ACCOUNT_ID: Deno.env.get("STRIPE_ACCOUNT_ID"),
    STRIPE_LIVEMODE: Deno.env.get("STRIPE_LIVEMODE"),
    STRIPE_RETURN_ORIGIN: Deno.env.get("STRIPE_RETURN_ORIGIN"),
  });
}
function rpcClient(key?: string) {
  const db = service(key);
  return {
    db,
    async rpc<T>(name: string, params: Record<string, unknown> = {}): Promise<T> {
      const {data, error} = await db.rpc(name, params);
      if (error) throw error;
      return data as T;
    },
  };
}
async function createVersionedCheckout(intent: PaymentScopedCheckoutIntent) {
  if ((intent.return_context_version ?? 1) === 1) return provider().createCheckout(intent);
  if (intent.return_context_version !== 2 || !intent.return_scope_id) throw new Error("Payment access unavailable");
  const captured = await rpcClient().rpc<unknown>("payment_collection_access_context", {p_grant_id:intent.return_scope_id});
  const config = paymentAccessConfig({origin:Deno.env.get("PAYMENT_ACCESS_ORIGIN"),activeKeyVersion:Deno.env.get("PAYMENT_ACCESS_ACTIVE_KEY_VERSION"),keys:Deno.env.get("PAYMENT_ACCESS_KEYS")});
  const exact = await materializePaymentCheckout(intent,paymentGrantFromContext(captured),config);
  return provider().createCheckout(exact);
}
export function stripeCheckoutRuntime() {
  // Delay client/provider construction until the authenticated handler needs them.
  return createStripeCheckoutHandler({
    origin: Deno.env.get("APP_URL") ?? "",
    enabled: Deno.env.get("STRIPE_PAYMENTS_ENABLED") === "true",
    collectionsEnabled: Deno.env.get("STRIPE_COLLECTIONS_ENABLED") === "true",
    authenticate: async token => {
      const {data, error} = await service().auth.getUser(token);
      if (error || !data.user) return null;
      return data.user.id;
    },
    context: (requestId, actorId) => rpcClient().rpc<CheckoutContext>("checkout_payment_context", {p_request_id: requestId, p_actor_id: actorId}),
    provider: {
      createCheckout: intent => createVersionedCheckout(intent),
      retrieveCheckout: id => provider().retrieveCheckout(id),
      expireCheckout: (id,key) => provider().expireCheckout(id,key),
    },
    apply: async (intent, evidence, eventId) => {
      const result = await rpcClient().rpc<{disposition: "accepted" | "quarantined"}>("apply_checkout_evidence", {
        p_event_id: eventId, p_request_id: intent.id, p_account_id: intent.account_id, p_livemode: intent.livemode,
        p_kind: evidence.state, p_session_id: evidence.session_id, p_payment_id: evidence.payment_id,
        p_amount_cents: evidence.amount_cents, p_currency: evidence.currency, p_source_hash: intent.source_hash,
      });
      return result.disposition;
    },
  });
}
export function stripeWebhookRuntime() {
  const mode = Deno.env.get("STRIPE_LIVEMODE");
  return createStripeWebhookHandler({
    enabled: Deno.env.get("STRIPE_WEBHOOK_ENABLED") === "true" && ["true","false"].includes(mode ?? ""),
    signingSecret: Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "", accountId: Deno.env.get("STRIPE_ACCOUNT_ID") ?? "", livemode: mode === "true",
    receive: async receipt => {await rpcClient().rpc("receive_stripe_event", {p_receipt: receipt});},
  });
}
export async function stripeWorkerRuntime(request: Request): Promise<Response> {
  const key = authenticateWorker(request, {
    SUPABASE_SECRET_KEYS: Deno.env.get("SUPABASE_SECRET_KEYS"),
    SUPABASE_SERVICE_ROLE_KEY: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
  });
  const reply = (status: number, value: object) => Response.json(value, {status, headers: {"Cache-Control": "no-store"}});
  if (request.method !== "POST" || !key) return reply(401, {error: "unauthorized"});
  if (Deno.env.get("STRIPE_PAYMENTS_ENABLED") !== "true" || Deno.env.get("STRIPE_EVENT_PROCESSING_ENABLED") !== "true") return reply(200, {state: "disabled"});
  try {
    const {rpc} = rpcClient(key);
    const result = await processStripeEvent({
      claim: () => rpc<StripeEventLease | null>("claim_stripe_event"),
      checkoutContext: requestId => rpc<CheckoutIntent>("provider_checkout_context", {p_request_id: requestId}),
      refundContext: requestId => rpc<RefundIntent>("provider_refund_context", {p_request_id: requestId}),
      retrieveCheckout: id => provider().retrieveCheckout(id), retrieveRefund: id => provider().retrieveRefund(id),
      finish: async (receiptId, token, evidence) => {await rpc("finish_stripe_event", {p_receipt_id: receiptId, p_lease_token: token, p_evidence: evidence});},
      retry: async (receiptId, token, reason) => {await rpc("retry_stripe_event", {p_receipt_id: receiptId, p_lease_token: token, p_reason: reason});},
    });
    return reply(result === "uncertain" ? 503 : 200, {state: result});
  } catch {return reply(503, {error: "processing_unavailable"});}
}

export function stripeRefundRuntime() {
  return createStripeRefundHandler({
    origin: Deno.env.get("APP_URL") ?? "",
    enabled: Deno.env.get("STRIPE_PAYMENTS_ENABLED") === "true",
    refundsEnabled: Deno.env.get("STRIPE_REFUNDS_ENABLED") === "true",
    authenticate: async token => {
      const {data, error} = await service().auth.getUser(token);
      if (error || !data.user) return null;
      return data.user.id;
    },
    context: (requestId,actorId) => rpcClient().rpc<RefundContext>("refund_payment_context", {p_request_id: requestId, p_actor_id: actorId}),
    create: intent => provider().createRefund(intent), retrieve: id => provider().retrieveRefund(id),
    quarantine: async (requestId, reason) => {await rpcClient().rpc("record_payment_reconciliation", {p_family: "refund", p_request_id: requestId, p_reason: reason});},
    apply: async (intent,evidence,eventId) => {
      const result = await rpcClient().rpc<{disposition: "accepted" | "quarantined"}>("apply_refund_evidence", {
        p_event_id: eventId, p_request_id: intent.id, p_account_id: intent.account_id, p_livemode: intent.livemode,
        p_refund_id: evidence.refund_id, p_provider_payment_id: evidence.provider_payment_id,
        p_amount_cents: evidence.amount_cents, p_currency: evidence.currency, p_status: evidence.status,
      });
      return result.disposition;
    },
  });
}
