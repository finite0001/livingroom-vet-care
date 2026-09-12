import test from "node:test";
import assert from "node:assert/strict";
import {
  invoiceMoney,
  renderInvoiceDocument,
} from "../../src/hub/features/billing/invoice-document.ts";
const id = "94000000-0000-4000-8000-000000000001";
const timestamp = "2026-09-12T18:00:00Z";
const practice = {
  name: "The Living Room Vet",
  address: "2619 Spruce Street, Boulder, CO",
  domain: "thelivingroom.vet",
};
const sample = {
  id,
  status: "issued",
  currency: "usd",
  version: 3,
  created_at: timestamp,
  issued_at: timestamp,
  voided_at: null,
  rendered_at: timestamp,
  client: {
    id,
    name: "Family <script>alert(1)</script>",
    mailing_address: "123 A & B",
  },
  items: [
    {
      id,
      description: '<img src=x onerror="alert(1)">',
      quantity: "1.500",
      unit_price_cents: "1001",
      amount_cents: "1502",
    },
  ],
  credits: [{ id, amount_cents: "29", created_at: timestamp }],
  total_cents: "1502",
};
test("invoice document escapes untrusted text and states exact credits separately from payment", () => {
  const html = renderInvoiceDocument(sample, practice);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /<script|<img/);
  assert.match(html, /\$15\.02/);
  assert.match(html, /\$14\.73/);
  assert.match(html, /not a payment receipt/);
  assert.match(html, /current record at rendering/);
  assert.match(html, /default-src 'none'/);
});
test("draft and void copies cannot be mistaken for issued payable invoices", () => {
  assert.match(
    renderInvoiceDocument(
      { ...sample, status: "draft", issued_at: null, credits: [] },
      practice,
    ),
    /DRAFT — NOT ISSUED/,
  );
  const html = renderInvoiceDocument(
    { ...sample, status: "void", voided_at: timestamp, credits: [] },
    practice,
  );
  assert.match(html, /VOID — CANCELLED INVOICE/);
  assert.match(html, /Do not pay this invoice/);
  assert.doesNotMatch(html, /Net charges after/);
});
test("rejects inconsistent totals and dates instead of presenting an unreliable document", () => {
  assert.throws(() =>
    renderInvoiceDocument({ ...sample, total_cents: "1503" }, practice),
  );
  assert.throws(() =>
    renderInvoiceDocument(
      {
        ...sample,
        credits: [{ id, amount_cents: "1503", created_at: timestamp }],
      },
      practice,
    ),
  );
  assert.throws(() =>
    renderInvoiceDocument({ ...sample, issued_at: null }, practice),
  );
  assert.throws(() =>
    renderInvoiceDocument({ ...sample, rendered_at: "infinity" }, practice),
  );
});
test("large integer cent values retain exact precision", () => {
  assert.equal(invoiceMoney("9007199254740993"), "$90,071,992,547,409.93");
});
