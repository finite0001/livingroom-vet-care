import test from "node:test";
import assert from "node:assert/strict";
import {
  parseInvoiceEmail,
  invoiceEmailArgs,
} from "../../src/hub/features/billing/invoice-email-state.ts";
import { clearOtherInvoiceEmailIntents } from "../../src/hub/contexts/session-draft-retention.ts";
const sample = () => ({
  request: {
    id: "request",
    invoice_id: "invoice",
    actor_id: "actor",
    client_id: "client",
    conversation_id: "conversation",
    recipient: "household@example.test",
    subject: "Invoice",
    body: "Attached invoice",
    invoice_hash: "a".repeat(64),
    state: "ready",
  },
  payload_hash: "b".repeat(64),
  manifest: [
    {
      filename: "invoice.html",
      mime_type: "text/html",
      file_size: 123,
      sha256: "c".repeat(64),
    },
  ],
  report_html: "<h1>Invoice</h1>",
  purged_at: null,
  receipt: null,
});
test("invoice recovery rejects another actor/household/invoice and incomplete frozen data", () => {
  for (const key of ["actor_id", "client_id", "invoice_id"]) {
    const value = sample();
    (value.request as Record<string, string>)[key] = "other";
    assert.throws(() => parseInvoiceEmail(value, "invoice", "client", "actor"));
  }
  for (const key of ["report_html", "manifest", "payload_hash"]) {
    const value = sample();
    (value as Record<string, unknown>)[key] = null;
    assert.throws(() => parseInvoiceEmail(value, "invoice", "client", "actor"));
  }
});
test("queued receipt and exact immutable retry arguments are validated", () => {
  const value = sample();
  const parsed = parseInvoiceEmail(value, "invoice", "client", "actor")!;
  assert.equal(invoiceEmailArgs(parsed).p_request_id, "request");
  assert.equal(
    invoiceEmailArgs(parsed).p_invoice_hash,
    value.request.invoice_hash,
  );
  value.request.state = "queued";
  assert.throws(() => parseInvoiceEmail(value, "invoice", "client", "actor"));
  assert.equal(parseInvoiceEmail(null, "invoice", "client", "actor"), null);
});
test("auth transitions remove other staff pending text; signout removes all invoice intents", () => {
  const map = new Map([
    ["invoice-email-intent:actor:invoice:client", "sensitive"],
    ["invoice-email-intent:other:invoice:client", "other text"],
    ["lrv-ezyvet-clinical-run:actor:mapping:history", "original-run"],
    ["lrv-ezyvet-clinical-run:other:mapping:history", "other-run"],
    ["ezyvet-history-intent:actor:patient:extraction", "original-review"],
    ["ezyvet-history-intent:other:patient:approval", "other-review"],
    ["unrelated", "keep"],
  ]);
  const storage = {
    get length() {
      return map.size;
    },
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => {
      map.delete(key);
    },
  };
  clearOtherInvoiceEmailIntents(storage, "actor");
  assert.equal(map.has("invoice-email-intent:actor:invoice:client"), true);
  assert.equal(map.has("invoice-email-intent:other:invoice:client"), false);
  assert.equal(map.has("lrv-ezyvet-clinical-run:actor:mapping:history"), true);
  assert.equal(map.has("lrv-ezyvet-clinical-run:other:mapping:history"), false);
  assert.equal(map.has("ezyvet-history-intent:actor:patient:extraction"), true);
  assert.equal(map.has("ezyvet-history-intent:other:patient:approval"), false);
  clearOtherInvoiceEmailIntents(storage, null);
  assert.deepEqual([...map.entries()], [["unrelated", "keep"]]);
});
