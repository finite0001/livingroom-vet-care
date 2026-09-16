import { z } from "zod";

const maximumCents = 9223372036854775807n;
const uuid = z.string().uuid().refine(value => value === value.toLowerCase());
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const revision = z.number().int().min(1).max(2147483647);
const text = (min: number, max: number) => z.string().refine(value =>
  value === value.trim() && Array.from(value).length >= min && Array.from(value).length <= max &&
  !/[\uD800-\uDFFF]/u.test(value) &&
  !Array.from(value).some(char => {
    const code = char.charCodeAt(0);
    return code === 127 || (code < 32 && code !== 9 && code !== 10);
  }));
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return value >= "0001-01-01" && Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
});
const instant = z.string().datetime({ offset: true }).refine(value =>
  Number.isFinite(Date.parse(value)) && !/\.\d{7}/.test(value));
const cents = z.string().refine(value => /^(0|[1-9]\d*)$/.test(value) && value.length <= 19 && BigInt(value) <= maximumCents);
const quantity = z.string().regex(/^(?:0|[1-9]\d{0,10})(?:\.\d{0,2}[1-9])?$/).refine(value => value !== "0");
const lineSchema = z.object({
  id: uuid, product_id: uuid, product_version: revision,
  description: text(1, 300), kind: z.enum(["service", "medication", "vaccine"]),
  unit: text(1, 50), quantity,
  pricing: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("unit"), unit_price_cents: cents }).strict(),
    z.object({ kind: z.literal("allocated"), amount_cents: cents }).strict(),
  ]),
  pricing_reason: text(1, 2000).nullable(),
}).strict();

/** An already frozen server snapshot. Parsing confers no publication authority. */
export const estimatePublicationSnapshotSchema = z.object({
  schema_version: z.literal(1), preparation_id: uuid, prepared_at: instant,
  target: z.object({ estimate_id: uuid, client_id: uuid, pet_id: uuid }).strict(),
  draft_version: revision, draft_record_hash: hash,
  practice: z.object({
    version: z.literal(1), name: z.literal("The Living Room Veterinary Care"),
    address: z.literal("2619 Spruce Street, Boulder, CO"), domain: z.literal("thelivingroom.vet"),
  }).strict(),
  client: z.object({ id: uuid, version: revision, name: text(1, 301), mailing_address: text(0, 1000).nullable() }).strict(),
  patient: z.object({ id: uuid, version: revision, name: text(1, 150), species: text(1, 100), breed: text(0, 150).nullable() }).strict(),
  title: text(1, 200), notes: text(0, 4000), terms: text(1, 8000),
  lines: z.array(z.object({ line: lineSchema, amount_cents: cents }).strict()).min(1).max(100),
  total_cents: cents, currency: z.literal("usd"),
  acceptance: z.object({
    accept_by: day, timezone: z.literal("America/Denver"), expires_at: instant,
    acknowledgment_version: z.literal(1), scope: z.literal("entire_exact_revision"),
    price_validity: z.literal("accepted_quantities"), not_clinical_consent: z.literal(true), not_payment: z.literal(true),
  }).strict(),
}).strict().superRefine((snapshot, context) => {
  // Zod also calls refinements for dirty child parses; never perform arithmetic
  // or timezone formatting until primitive validation has succeeded.
  if (!day.safeParse(snapshot.acceptance.accept_by).success ||
      !instant.safeParse(snapshot.acceptance.expires_at).success ||
      !instant.safeParse(snapshot.prepared_at).success || !cents.safeParse(snapshot.total_cents).success ||
      snapshot.lines.some(({ line, amount_cents }) => !quantity.safeParse(line.quantity).success ||
        !cents.safeParse(amount_cents).success || !cents.safeParse(line.pricing.kind === "unit" ?
          line.pricing.unit_price_cents : line.pricing.amount_cents).success)) return;
  const reject = (message: string) => context.addIssue({ code: "custom", message });
  if (snapshot.client.id !== snapshot.target.client_id || snapshot.patient.id !== snapshot.target.pet_id)
    reject("Estimate household or patient identity does not match.");
  if (new Set(snapshot.lines.map(({ line }) => line.id)).size !== snapshot.lines.length)
    reject("Duplicate estimate line identity.");
  let total = 0n;
  for (const { line, amount_cents } of snapshot.lines) {
    const [whole, fraction = ""] = line.quantity.split(".");
    const thousandths = BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, "0"));
    const expected = line.pricing.kind === "allocated" ? BigInt(line.pricing.amount_cents) :
      (thousandths * BigInt(line.pricing.unit_price_cents) + 500n) / 1000n;
    if (expected !== BigInt(amount_cents) || expected > maximumCents) reject("Estimate line amount is inconsistent.");
    if ((line.pricing.kind === "allocated" || expected === 0n) && !line.pricing_reason)
      reject("Allocated and zero amounts require a pricing reason.");
    total += expected;
  }
  if (total !== BigInt(snapshot.total_cents) || total > maximumCents) reject("Estimate total is inconsistent.");
  const expiry = new Date(snapshot.acceptance.expires_at);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Denver", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(expiry);
  const part = (name: string) => parts.find(value => value.type === name)?.value ?? "";
  const nextDay = new Date(`${snapshot.acceptance.accept_by}T00:00:00Z`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const localDate = `${part("year").padStart(4, "0")}-${part("month")}-${part("day")}`;
  if (localDate !== nextDay.toISOString().slice(0, 10) ||
      part("hour") !== "00" || part("minute") !== "00" || part("second") !== "00" ||
      /\.[0-9]*[1-9][0-9]*(?:Z|[+-])/.test(snapshot.acceptance.expires_at))
    reject("Acceptance must expire at the following Denver midnight.");
  if (Date.parse(snapshot.prepared_at) >= expiry.getTime()) reject("Estimate was prepared after its acceptance deadline.");
});

export interface EstimatePublicationSnapshot extends z.infer<typeof estimatePublicationSnapshotSchema> {}
export interface EstimatePublicationArtifact {
  filename: string;
  mime_type: "text/html; charset=utf-8";
  byte_length: number;
  sha256: string;
  renderer_version: 1;
}

const escape = (value: string) => value.replace(/[&<>"']/g, char =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
const money = (value: string) => {
  const amount = BigInt(value);
  const whole = (amount / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `$${whole}.${(amount % 100n).toString().padStart(2, "0")}`;
};

export function estimatePublicationFilename(snapshot: EstimatePublicationSnapshot): string {
  return `estimate-${snapshot.target.estimate_id}-draft-${snapshot.draft_version}-publication-${snapshot.preparation_id}.html`;
}

export function renderEstimatePublication(input: unknown): string {
  const snapshot = estimatePublicationSnapshotSchema.parse(input);
  const rows = snapshot.lines.map(({ line, amount_cents }) => `<tr>
    <td><strong>${escape(line.description)}</strong><p>${escape(line.kind)} · ${escape(line.unit)}</p>${line.pricing_reason ? `<p>Pricing reason: ${escape(line.pricing_reason)}</p>` : ""}</td>
    <td class="number">${escape(line.quantity)}</td>
    <td class="number">${line.pricing.kind === "unit" ? `${money(line.pricing.unit_price_cents)} per ${escape(line.unit)}` : "Allocated line total"}</td>
    <td class="number">${money(amount_cents)}</td></tr>`).join("");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${escape(snapshot.title)}</title><style>
    :root{color-scheme:light;--ink:CanvasText;--paper:Canvas;--rule:GrayText}*{box-sizing:border-box}body{font:14px Georgia,serif;color:var(--ink);background:var(--paper);padding:24px;margin:0;line-height:1.5}main{max-width:800px;margin:auto}p{white-space:pre-wrap;overflow-wrap:anywhere}h1{font-size:26px}h2{font-size:19px}table{border-collapse:collapse;width:100%;table-layout:fixed;margin:24px 0}th,td{padding:8px;text-align:left;vertical-align:top;border-bottom:1px solid var(--rule);overflow-wrap:anywhere}th:first-child{width:44%}.number{text-align:right;font-variant-numeric:tabular-nums}.notice{border:1px solid var(--rule);padding:12px}.reference{font-size:12px;overflow-wrap:anywhere}thead{display:table-header-group}tr{break-inside:avoid}footer{border-top:1px solid var(--rule);margin-top:24px;padding-top:12px}@page{size:Letter;margin:16mm}@media print{body{padding:0}}@media(max-width:480px){body{padding:12px}th,td{padding:5px;font-size:12px}}
  </style></head><body><main><header><h1>${escape(snapshot.practice.name)}</h1><p>${escape(snapshot.practice.address)}<br>${escape(snapshot.practice.domain)}</p><h2>${escape(snapshot.title)}</h2><p>Care estimate · draft revision ${snapshot.draft_version}</p></header>
  <section aria-label="Client and patient"><h2>Prepared for</h2><p>${escape(snapshot.client.name)}</p>${snapshot.client.mailing_address ? `<p>${escape(snapshot.client.mailing_address)}</p>` : ""}<p>Patient: ${escape(snapshot.patient.name)} · ${escape(snapshot.patient.species)}${snapshot.patient.breed ? ` · ${escape(snapshot.patient.breed)}` : ""}</p></section>
  <table><thead><tr><th scope="col">Proposed item</th><th scope="col" class="number">Quantity</th><th scope="col" class="number">Pricing</th><th scope="col" class="number">Amount</th></tr></thead><tbody>${rows}</tbody></table><p class="number"><strong>Estimate total: ${money(snapshot.total_cents)} USD</strong></p>
  ${snapshot.notes ? `<section><h2>Notes</h2><p>${escape(snapshot.notes)}</p></section>` : ""}<section><h2>Terms</h2><p>${escape(snapshot.terms)}</p><p>Accept by ${escape(snapshot.acceptance.accept_by)} (America/Denver). Acceptance closes at the start of the next day. This deadline limits acceptance, not performance of previously accepted quantities.</p><p>Any acceptance applies to this entire exact revision and its quoted quantities. Publication, current availability and acceptance are recorded separately.</p></section>
  <p class="notice">This document is a commercial proposal. It is not clinical consent, authorization to prescribe or perform treatment, an invoice, a payment request or a receipt. It does not confirm stock availability or that any work has been performed.</p>
  <footer><p class="reference">Estimate: ${escape(snapshot.target.estimate_id)}<br>Preparation: ${escape(snapshot.preparation_id)}<br>Prepared: ${escape(snapshot.prepared_at)}<br>Draft evidence: ${escape(snapshot.draft_record_hash)}</p><p class="reference">Names, contact details, prices and terms are retained as reviewed. This document does not update when live records change. See the publication record for publication time and current status.</p></footer></main></body></html>`;
  if (new TextEncoder().encode(html).byteLength > 2097152) throw new Error("Estimate document exceeds the retained artifact limit.");
  return html;
}

export async function estimatePublicationArtifact(input: unknown): Promise<{ html: string; artifact: EstimatePublicationArtifact }> {
  const snapshot = estimatePublicationSnapshotSchema.parse(input);
  const html = renderEstimatePublication(snapshot);
  const bytes = new TextEncoder().encode(html);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const sha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  return { html, artifact: { filename: estimatePublicationFilename(snapshot), mime_type: "text/html; charset=utf-8",
    byte_length: bytes.byteLength, sha256, renderer_version: 1 } };
}
