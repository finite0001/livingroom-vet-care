import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  deliveryIntent,
  parsePaymentDelivery,
  sameDeliveryIntent,
  verifyDeliveryPreview,
} from "../../src/hub/features/payments/PaymentDeliveryState.ts";
const id = (n: number) =>
  `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
function fixture(channel: "SMS" | "EMAIL" = "EMAIL", attach = false) {
  const args = {
    p_request_id: id(1),
    p_grant_id: id(2),
    p_conversation_id: id(3),
    p_channel: channel,
    p_recipient: channel === "SMS" ? "+15555550123" : "client@example.test",
    p_subject: channel === "SMS" ? "" : "Invoice",
    p_body_template: "Please pay securely: {{payment_link}}",
    p_invoice_email_request_id: attach ? id(7) : null,
    p_invoice_payload_hash: attach ? "d".repeat(64) : null,
  };
  const sender =
    channel === "SMS"
      ? { from: "+15555550100", account_sid: "AC" + "a".repeat(32) }
      : {
          from: "Practice <billing@example.test>",
          reply_to: "billing@example.test",
        };
  const message = args.p_body_template.replace(
    "{{payment_link}}",
    `https://thelivingroom.vet/pay/${id(2)}#p1.${"x".repeat(43)}`,
  );
  const attachment = attach
    ? {
        filename: `invoice-${id(5)}.html`,
        content_type: "text/html",
        content: Buffer.from("<html><p>Invoice café</p></html>").toString(
          "base64",
        ),
      }
    : null;
  const payload =
    channel === "SMS"
      ? new URLSearchParams({
          From: sender.from,
          To: args.p_recipient,
          Body: message,
        }).toString()
      : JSON.stringify({
          from: sender.from,
          reply_to: sender.reply_to,
          to: [args.p_recipient],
          subject: args.p_subject,
          text: message,
          ...(attachment ? { attachments: [attachment] } : {}),
        });
  const raw = {
    request: {
      id: id(1),
      grant_id: id(2),
      actor_id: id(4),
      invoice_id: id(5),
      client_id: id(6),
      source_hash: "a".repeat(64),
      amount_cents: "12500",
      conversation_id: id(3),
      channel,
      recipient: args.p_recipient,
      subject: args.p_subject,
      body_template: args.p_body_template,
      invoice_email_request_id: args.p_invoice_email_request_id,
      invoice_payload_hash: args.p_invoice_payload_hash,
      created_at: new Date().toISOString(),
    },
    capture: {
      request_id: id(1),
      sender_config: sender,
      message_hash: digest(message),
      payload_hash: digest(payload),
      captured_at: new Date().toISOString(),
    },
    receipt: null,
  };
  return {
    args,
    raw,
    preview: {
      message,
      recipient: args.p_recipient,
      subject: args.p_subject,
      sender,
      attachment,
    },
  };
}
test("nonsecret stable nine-argument intent rejects actual capabilities, extra arguments and attachment/channel mismatch", () => {
  const f = fixture();
  assert.deepEqual(deliveryIntent(f.args), f.args);
  for (const patch of [
    { token: "secret" },
    { p_body_template: "p1." + "x".repeat(43) + " {{payment_link}}" },
    { p_body_template: "{{payment_link}} {{payment_link}}" },
    { p_invoice_email_request_id: id(7) },
    { p_channel: "SMS" },
  ])
    assert.throws(() => deliveryIntent({ ...f.args, ...patch }));
});
test("email and SMS preview verifies actual materialized message and exact provider payload hashes", async () => {
  for (const channel of ["EMAIL", "SMS"] as const) {
    const f = fixture(channel),
      parsed = parsePaymentDelivery(f.raw, id(4), id(5), id(6))!;
    assert.ok(sameDeliveryIntent(parsed, f.args));
    const p = await verifyDeliveryPreview(f.preview, parsed);
    assert.equal(p.messageHash, f.raw.capture.message_hash);
    assert.equal(p.payloadHash, f.raw.capture.payload_hash);
    assert.equal(p.message, f.preview.message);
    await assert.rejects(
      verifyDeliveryPreview(
        { ...f.preview, message: f.preview.message + " changed" },
        parsed,
      ),
    );
    await assert.rejects(
      verifyDeliveryPreview(
        { ...f.preview, recipient: "other@example.test" },
        parsed,
      ),
    );
  }
});
test("attachment preview checks original bytes as part of payload and renders correct UTF8", async () => {
  const f = fixture("EMAIL", true),
    parsed = parsePaymentDelivery(f.raw, id(4), id(5), id(6))!;
  assert.match(
    (await verifyDeliveryPreview(f.preview, parsed)).attachment!.html,
    /café/,
  );
  await assert.rejects(
    verifyDeliveryPreview(
      {
        ...f.preview,
        attachment: {
          ...f.preview.attachment,
          content: Buffer.from("changed bytes").toString("base64"),
        },
      },
      parsed,
    ),
  );
  await assert.rejects(
    verifyDeliveryPreview({ ...f.preview, attachment: null }, parsed),
  );
});
test("receipt recovery retains queued versus delivered distinction and does not expose preview contents", async () => {
  const f = fixture(),
    raw = {
      ...f.raw,
      receipt: {
        outbox_id: id(8),
        message_id: id(9),
        state: "uncertain",
        queued: true,
        delivered: false,
      },
    };
  const p = parsePaymentDelivery(raw, id(4), id(5), id(6))!;
  assert.equal(p.receipt?.delivered, false);
  assert.doesNotMatch(JSON.stringify(p), /p1\.|\/pay\//);
  await assert.rejects(verifyDeliveryPreview(f.preview, p));
  assert.throws(() => parsePaymentDelivery(raw, id(9), id(5), id(6)));
  assert.throws(() =>
    parsePaymentDelivery(
      { ...raw, receipt: { ...raw.receipt, delivered: true } },
      id(4),
      id(5),
      id(6),
    ),
  );
});
