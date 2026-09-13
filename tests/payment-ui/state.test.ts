import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkoutUrl,
  formatCents,
  parsePaymentState,
  parseProfile,
  validateIntent,
  verifyPrepared,
  type PendingIntent,
} from "../../src/hub/features/payments/state.ts";
import { clearOtherInvoiceEmailIntents } from "../../src/hub/contexts/session-draft-retention.ts";
const invoice = "22222222-2222-4222-8222-222222222222",
  client = "33333333-3333-4333-8333-333333333333",
  request = "44444444-4444-4444-8444-444444444444";
const intent: PendingIntent = {
  family: "checkout",
  args: {
    p_request_id: request,
    p_invoice_id: invoice,
    p_client_id: client,
    p_source_hash: "a".repeat(64),
    p_amount_cents: 12500,
    p_account_id: "acct_test",
    p_livemode: false,
    p_success_url: "https://thelivingroom.vet/payment/return",
    p_cancel_url: "https://thelivingroom.vet/payment/cancel",
  },
};
test("money display preserves cents beyond floating point range", () => {
  assert.equal(
    formatCents("9007199254740993123"),
    "$90,071,992,547,409,931.23",
  );
  assert.throws(() => formatCents("12.5"));
});
test("profile cannot silently select multiple accounts, insecure origins or a string mode", () => {
  assert.equal(parseProfile([]), null);
  assert.equal(
    parseProfile([
      {
        account_id: "acct_test",
        livemode: false,
        return_origin: "https://thelivingroom.vet",
      },
    ])?.livemode,
    false,
  );
  assert.throws(() => parseProfile([{}, {}]));
  assert.throws(() =>
    parseProfile([
      {
        account_id: "acct_test",
        livemode: "false",
        return_origin: "https://thelivingroom.vet",
      },
    ]),
  );
  assert.throws(() =>
    parseProfile([
      {
        account_id: "acct_test",
        livemode: false,
        return_origin: "http://thelivingroom.vet",
      },
    ]),
  );
});
test("Checkout URL accepts only the provider-hosted path and rejects deceptive origins", () => {
  assert.equal(checkoutUrl(null), null);
  assert.equal(
    checkoutUrl("https://checkout.stripe.com/c/pay/cs_test_123"),
    "https://checkout.stripe.com/c/pay/cs_test_123",
  );
  for (const url of [
    "https://checkout.stripe.com.evil.test/c/pay/a",
    "https://evil@checkout.stripe.com/c/pay/a",
    "javascript:alert(1)",
    "https://checkout.stripe.com/pay/a",
  ])
    assert.throws(() => checkoutUrl(url));
});
test("durable intent rejects household changes, unsafe cents and persisted provider URLs", () => {
  assert.deepEqual(validateIntent(intent, invoice, client), intent);
  assert.throws(() => validateIntent(intent, invoice, "other"));
  assert.throws(() =>
    validateIntent(
      { ...intent, client_url: "https://checkout.stripe.com/c/pay/secret" },
      invoice,
      client,
    ),
  );
  assert.throws(() =>
    validateIntent(
      { ...intent, args: { ...intent.args, p_amount_cents: 125.5 } },
      invoice,
      client,
    ),
  );
  assert.throws(() =>
    validateIntent(
      {
        ...intent,
        args: {
          ...intent.args,
          p_success_url: "https://evil.test/payment/return",
        },
      },
      invoice,
      client,
    ),
  );
});
test("prepare composite receipt requires exact numeric cents and original actor", () => {
  const row = {
    id: request,
    invoice_id: invoice,
    actor_id: "actor",
    amount_cents: 12500,
  };
  verifyPrepared(row, intent, "actor");
  assert.throws(() =>
    verifyPrepared({ ...row, amount_cents: "12500" }, intent, "actor"),
  );
  assert.throws(() =>
    verifyPrepared({ ...row, actor_id: "other" }, intent, "actor"),
  );
});
test("missing cash state is unavailable rather than an invented zero balance", () => {
  assert.throws(() => parsePaymentState([], invoice, client));
  assert.throws(() =>
    parsePaymentState(
      {
        invoice_id: invoice,
        client_id: client,
        source_hash: "a".repeat(64),
        balance: {},
      },
      invoice,
      client,
    ),
  );
});
test("authentication changes clear payment intents while retaining unrelated storage", () => {
  const entries = new Map([
    ["invoice-payment-intent:actor:a", "x"],
    ["invoice-payment-intent:other:b", "y"],
    ["unrelated", "z"],
  ]);
  const storage = {
    get length() {
      return entries.size;
    },
    key: (i: number) => [...entries.keys()][i] ?? null,
    removeItem: (key: string) => {
      entries.delete(key);
    },
  };
  clearOtherInvoiceEmailIntents(storage, "actor");
  assert.ok(entries.has("invoice-payment-intent:actor:a"));
  assert.equal(entries.has("invoice-payment-intent:other:b"), false);
  clearOtherInvoiceEmailIntents(storage, null);
  assert.deepEqual([...entries.keys()], ["unrelated"]);
});
