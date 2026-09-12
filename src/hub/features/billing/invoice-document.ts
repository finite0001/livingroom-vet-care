import { z } from "zod";

const cents = z.string().regex(/^\d+$/);
const timestamp = z
  .string()
  .refine((value) => Number.isFinite(Date.parse(value)), "Invalid timestamp");
export const invoiceDocumentSchema = z
  .object({
    id: z.string().uuid(),
    status: z.enum(["draft", "issued", "void"]),
    currency: z.literal("usd"),
    version: z.number().int().positive(),
    created_at: timestamp,
    issued_at: timestamp.nullable(),
    voided_at: timestamp.nullable(),
    rendered_at: timestamp,
    client: z.object({
      id: z.string().uuid(),
      name: z.string(),
      mailing_address: z.string().nullable(),
    }),
    items: z.array(
      z.object({
        id: z.string().uuid(),
        description: z.string(),
        quantity: z.string().regex(/^\d+(\.\d+)?$/),
        unit_price_cents: cents,
        amount_cents: cents,
      }),
    ),
    credits: z.array(
      z.object({
        id: z.string().uuid(),
        amount_cents: cents,
        created_at: timestamp,
      }),
    ),
    total_cents: cents,
  })
  .superRefine((value, context) => {
    const total = BigInt(value.total_cents);
    const lines = value.items.reduce(
      (sum, item) => sum + BigInt(item.amount_cents),
      0n,
    );
    const credits = value.credits.reduce(
      (sum, item) => sum + BigInt(item.amount_cents),
      0n,
    );
    if (
      lines !== total ||
      credits > total ||
      (value.status !== "draft" && !value.issued_at) ||
      (value.status === "void" && !value.voided_at)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Invoice totals or status are inconsistent. Reload the document.",
      });
    }
  });
export interface InvoiceDocument extends z.infer<
  typeof invoiceDocumentSchema
> {}
export interface InvoicePractice {
  name: string;
  address: string;
  domain: string | null;
}
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ]!,
  );
export function invoiceMoney(value: string | bigint) {
  const amount = BigInt(value);
  return `$${(amount / 100n).toLocaleString("en-US")}.${(amount % 100n).toString().padStart(2, "0")}`;
}
const date = (value: string) =>
  new Date(value).toLocaleString("en-US", {
    timeZone: "America/Denver",
    dateStyle: "medium",
    timeStyle: "short",
  });
export function renderInvoiceDocument(
  input: unknown,
  practice: InvoicePractice,
): string {
  const doc = invoiceDocumentSchema.parse(input);
  const credits = doc.credits.reduce(
    (sum, item) => sum + BigInt(item.amount_cents),
    0n,
  );
  const heading =
    doc.status === "draft"
      ? "DRAFT — NOT ISSUED"
      : doc.status === "void"
        ? "VOID — CANCELLED INVOICE"
        : "Invoice";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${escape(heading)} ${escape(doc.id)}</title><style>
  :root{color-scheme:light;--ink:#172820;--paper:#fff;--rule:#89938d}*{box-sizing:border-box}body{font:14px Georgia,serif;color:var(--ink);background:var(--paper);margin:0;padding:28px;line-height:1.5}main{max-width:780px;margin:auto}h1{font-size:26px;margin-bottom:4px}h2{font-size:18px}p{margin:6px 0}small{font-size:12px}.reference{overflow-wrap:anywhere}.address{white-space:pre-line}table{width:100%;border-collapse:collapse;margin:24px 0;table-layout:fixed}th,td{padding:9px 5px;text-align:left;border-bottom:1px solid var(--rule);overflow-wrap:anywhere;vertical-align:top}th:first-child{width:46%}.number{text-align:right;font-variant-numeric:tabular-nums}.notice{padding:12px;border:1px solid var(--rule)}tr{break-inside:avoid}thead{display:table-header-group}footer{margin-top:28px;border-top:1px solid var(--rule);padding-top:12px}@page{size:Letter;margin:16mm}@media print{body{padding:0}}@media(max-width:480px){body{padding:12px}th,td{padding:6px 3px;font-size:12px}}
  </style></head><body><main><header><h1>${escape(practice.name)}</h1><p>${escape(practice.address)}</p>${practice.domain ? `<p>${escape(practice.domain)}</p>` : ""}<h2>${heading}</h2><p class="reference">Reference: ${escape(doc.id)}</p><p>${doc.issued_at ? `Issued: ${escape(date(doc.issued_at))}` : `Created: ${escape(date(doc.created_at))}`}</p>${doc.voided_at ? `<p>Voided: ${escape(date(doc.voided_at))}</p>` : ""}</header>
  <section aria-label="Bill to"><h2>Bill to</h2><p>${escape(doc.client.name)}</p>${doc.client.mailing_address ? `<p class="address">${escape(doc.client.mailing_address)}</p>` : ""}</section>
  <table><thead><tr><th scope="col">Description</th><th scope="col" class="number">Qty</th><th scope="col" class="number">Unit price</th><th scope="col" class="number">Charge</th></tr></thead><tbody>${doc.items.map((item) => `<tr><td>${escape(item.description)}</td><td class="number">${escape(item.quantity)}</td><td class="number">${invoiceMoney(item.unit_price_cents)}</td><td class="number">${invoiceMoney(item.amount_cents)}</td></tr>`).join("")}</tbody></table>
  <p class="number">${doc.status === "draft" ? "Draft charges" : "Original invoice charges"}: <strong>${invoiceMoney(doc.total_cents)} USD</strong></p>
  ${doc.credits.length ? `<h2>Accounting credits</h2><ul>${doc.credits.map((credit) => `<li>${escape(date(credit.created_at))}: ${invoiceMoney(credit.amount_cents)}</li>`).join("")}</ul><p class="number">Credits: ${invoiceMoney(credits)} USD</p>` : ""}
  ${doc.status === "void" ? '<p class="notice">This invoice is void. Do not pay this invoice.</p>' : `<p class="number">${doc.status === "draft" ? "Draft net charges" : "Net charges after accounting credits"}: <strong>${invoiceMoney(BigInt(doc.total_cents) - credits)} USD</strong></p>`}
  <p class="notice">${doc.status === "draft" ? "Draft for review; charges may change. " : ""}Payment activity is not included in this document. This is not a payment receipt or a statement of outstanding balance.</p>
  <footer><small>Rendered ${escape(date(doc.rendered_at))} (America/Denver). Household name and mailing address reflect the current record at rendering. This copy includes accounting credits recorded at that time.</small></footer></main></body></html>`;
}
