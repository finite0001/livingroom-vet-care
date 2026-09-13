import { checkoutEvidence, refundEvidence } from "./stripe-provider.ts";
import type { CheckoutIntent, RefundIntent, StripeObject } from "./stripe-provider.ts";
import type { StripeWebhookReceipt } from "./stripe-webhook.ts";
export interface StripeEventLease {
  receipt: StripeWebhookReceipt & {id: string};
  lease_token: string;
  lease_expires_at: string;
  attempt_count: number;
}
export interface StripeEventWorkerDependencies {
  claim: () => Promise<StripeEventLease | null>;
  checkoutContext: (requestId: string) => Promise<CheckoutIntent>;
  refundContext: (requestId: string) => Promise<RefundIntent>;
  retrieveCheckout: (sessionId: string) => Promise<StripeObject>;
  retrieveRefund: (refundId: string) => Promise<StripeObject>;
  finish: (receiptId: string, leaseToken: string, evidence: Record<string, unknown>) => Promise<void>;
  retry: (receiptId: string, leaseToken: string, reason: "provider_unavailable") => Promise<void>;
}
/** One leased event per call. A missed acknowledgement is recovered by lease expiry. */
export async function processStripeEvent(deps: StripeEventWorkerDependencies): Promise<"empty" | "finished" | "retry" | "uncertain"> {
  const lease = await deps.claim();
  if (!lease) return "empty";
  const receipt = lease.receipt;
  const finish = async (evidence: Record<string, unknown>) => {
    try { await deps.finish(receipt.id, lease.lease_token, evidence); return "finished" as const; }
    catch { return "uncertain" as const; }
  };
  const quarantine = (reason: string) => finish({family: "quarantine", reason});
  if (!receipt.request_id || !receipt.object_id) return quarantine("unattributed_provider_object");
  const isCheckout = receipt.event_type.startsWith("checkout.session.");
  const isRefund = receipt.event_type.startsWith("refund.");
  if (!isCheckout && !isRefund) return quarantine("unsupported_event");
  let intent: CheckoutIntent | RefundIntent;
  try { intent = isCheckout ? await deps.checkoutContext(receipt.request_id) : await deps.refundContext(receipt.request_id); }
  catch {
    // A database outage is not proof that the request is unattributed.
    try { await deps.retry(receipt.id, lease.lease_token, "provider_unavailable"); return "retry"; } catch { return "uncertain"; }
  }
  if (intent.id !== receipt.request_id || intent.account_id !== receipt.account_id || intent.livemode !== receipt.livemode) return quarantine("provider_context_mismatch");
  let value: StripeObject;
  try { value = isCheckout ? await deps.retrieveCheckout(receipt.object_id) : await deps.retrieveRefund(receipt.object_id); }
  catch { try { await deps.retry(receipt.id, lease.lease_token, "provider_unavailable"); return "retry"; } catch { return "uncertain"; } }
  if (value.id !== receipt.object_id) return quarantine("provider_context_mismatch");
  let evidence: Record<string, unknown>;
  try {
    if (isCheckout) {
      const checkout = intent as CheckoutIntent;
      const result = checkoutEvidence(value, checkout);
      evidence = {family: "checkout", account_id: checkout.account_id, livemode: checkout.livemode,
        kind: result.state, session_id: result.session_id, payment_id: result.payment_id,
        amount_cents: result.amount_cents, currency: result.currency, source_hash: checkout.source_hash};
    } else {
      const refund = intent as RefundIntent;
      evidence = {family: "refund", account_id: refund.account_id, livemode: refund.livemode, ...refundEvidence(value, refund)};
    }
  } catch { return quarantine("provider_context_mismatch"); }
  return finish(evidence);
}
