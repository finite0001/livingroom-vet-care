/** Immutable print contract. Authorized adapters must verify snapshot hashes and fetch
 * current status; this renderer performs no live lookups and grants no fill authority. */
export interface NativePrescriptionArtifact {
  schema_version: 1;
  authorization_id: string;
  authorization_hash: string;
  signed_at: string;
  signature_name: string;
  patient: { id: string; name: string; species: string };
  household: { id: string; name: string; address: string };
  prescriber: {
    user_id: string; name: string; license_number: string; license_state: string;
    practice_name: string; practice_address: string; practice_phone: string | null;
  };
  medication: { name: string; strength: string; form: string; directions: string; route: string };
  quantity_per_fill: string;
  unit: string;
  refills_authorized: number;
  fulfillment_mode: "practice_stock" | "external_pharmacy";
  starts_on: string;
  expires_on: string;
}
export interface NativeDispenseDetails {
  id: string;
  authorization_id: string;
  authorization_hash: string;
  fill_index: number;
  quantity: string;
  unit: string;
  dispensed_at: string;
  recorded_by: { user_id: string; name: string };
  lots: Array<{ id: string; number: string; expires_on: string; quantity: string }>;
}
export interface NativeDispenseArtifact extends NativeDispenseDetails {
  invoice_id: string;
}
export interface NativePrescriptionPrintStatus {
  authorization_id: string;
  authorization_hash: string;
  checked_at: string;
  state: "active" | "cancelled" | "replaced" | "expired";
  reason: string | null;
  replacement_id: string | null;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hash = /^[0-9a-f]{64}$/;
function fail(): never { throw new Error("Invalid native prescription print snapshot; refresh the authorized record."); }
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail();
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== keys.length || keys.some(key => !Object.prototype.hasOwnProperty.call(record, key))) fail();
  return record;
}
function text(value: unknown, max = 200): asserts value is string {
  if (typeof value !== "string" || !value.trim() || Array.from(value).length > max || Array.from(value).some(char => char.charCodeAt(0) < 32 && ![9, 10, 13].includes(char.charCodeAt(0)))) fail();
}
function id(value: unknown) { if (typeof value !== "string" || !uuid.test(value)) fail(); }
function digest(value: unknown) { if (typeof value !== "string" || !hash.test(value)) fail(); }
function day(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail();
  const parsed = new Date(value + "T00:00:00Z");
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) fail();
}
function instant(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) fail();
  day(value.slice(0, 10));
  if (Number(value.slice(11, 13)) > 23 || Number(value.slice(14, 16)) > 59 || Number(value.slice(17, 19)) > 59) fail();
}
export function nativePrescriptionInstantMicros(value: string): bigint {
  instant(value);
  const fraction = /\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/.exec(value)?.[1] ?? "";
  return BigInt(Date.parse(value)) * 1000n + BigInt(fraction.padEnd(6, "0").slice(3));
}
function quantity(value: unknown): bigint {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d{0,10})(?:\.\d{1,3})?$/.test(value)) fail();
  const [whole, fraction = ""] = value.split(".");
  const milli = BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, "0"));
  if (milli <= 0n) fail();
  return milli;
}
function integer(value: unknown, max: number) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > max) fail();
}
export function validateNativePrescriptionArtifact(value: unknown): asserts value is NativePrescriptionArtifact {
  const s = object(value, ["schema_version", "authorization_id", "authorization_hash", "signed_at", "signature_name", "patient", "household", "prescriber", "medication", "quantity_per_fill", "unit", "refills_authorized", "fulfillment_mode", "starts_on", "expires_on"]);
  if (s.schema_version !== 1 || !["practice_stock", "external_pharmacy"].includes(s.fulfillment_mode as string)) fail();
  id(s.authorization_id); digest(s.authorization_hash); instant(s.signed_at); text(s.signature_name);
  const patient = object(s.patient, ["id", "name", "species"]); id(patient.id); text(patient.name); text(patient.species);
  const household = object(s.household, ["id", "name", "address"]); id(household.id); text(household.name); text(household.address, 1000);
  const issuer = object(s.prescriber, ["user_id", "name", "license_number", "license_state", "practice_name", "practice_address", "practice_phone"]);
  id(issuer.user_id);
  for (const key of ["name", "license_number", "license_state", "practice_name"]) text(issuer[key]);
  text(issuer.practice_address, 1000); if (issuer.practice_phone !== null) text(issuer.practice_phone, 100);
  const medication = object(s.medication, ["name", "strength", "form", "directions", "route"]);
  for (const key of ["name", "strength", "form", "route"]) text(medication[key]);
  text(medication.directions, 8000); quantity(s.quantity_per_fill); text(s.unit, 50);
  integer(s.refills_authorized, 1000); day(s.starts_on); day(s.expires_on);
  if (s.expires_on < s.starts_on) fail();
}
function validateStatus(value: unknown, s: NativePrescriptionArtifact): asserts value is NativePrescriptionPrintStatus {
  if (value === null) throw new Error("Refresh prescription status before printing.");
  const status = object(value, ["authorization_id", "authorization_hash", "checked_at", "state", "reason", "replacement_id"]);
  if (status.authorization_id !== s.authorization_id || status.authorization_hash !== s.authorization_hash || !["active", "cancelled", "replaced", "expired"].includes(status.state as string)) fail();
  instant(status.checked_at); if (nativePrescriptionInstantMicros(status.checked_at) < nativePrescriptionInstantMicros(s.signed_at)) fail();
  if (status.state === "cancelled" || status.state === "replaced") text(status.reason, 2000);
  else if (status.reason !== null) text(status.reason, 2000);
  if (status.state === "replaced") { id(status.replacement_id); if (status.replacement_id === s.authorization_id) fail(); }
  else if (status.replacement_id !== null) fail();
}
export function validateNativeDispenseArtifact(value: unknown, s: NativePrescriptionArtifact): asserts value is NativeDispenseArtifact {
  const d = object(value, ["id", "authorization_id", "authorization_hash", "fill_index", "quantity", "unit", "dispensed_at", "recorded_by", "invoice_id", "lots"]);
  id(d.invoice_id);
  const details = { ...d };
  delete details.invoice_id;
  validateNativeDispenseDetails(details, s);
}
export function validateNativeDispenseDetails(value: unknown, s: NativePrescriptionArtifact): asserts value is NativeDispenseDetails {
  const d = object(value, ["id", "authorization_id", "authorization_hash", "fill_index", "quantity", "unit", "dispensed_at", "recorded_by", "lots"]);
  id(d.id);
  if (s.fulfillment_mode !== "practice_stock" || d.authorization_id !== s.authorization_id || d.authorization_hash !== s.authorization_hash || d.unit !== s.unit) fail();
  integer(d.fill_index, s.refills_authorized); instant(d.dispensed_at);
  if (nativePrescriptionInstantMicros(d.dispensed_at) < nativePrescriptionInstantMicros(s.signed_at)) fail();
  const actor = object(d.recorded_by, ["user_id", "name"]); id(actor.user_id); text(actor.name);
  const total = quantity(d.quantity); if (total > quantity(s.quantity_per_fill)) fail();
  if (!Array.isArray(d.lots) || !d.lots.length || d.lots.length > 100) fail();
  const ids = new Set(); let allocated = 0n;
  for (const item of d.lots) {
    const lot = object(item, ["id", "number", "expires_on", "quantity"]);
    id(lot.id); text(lot.number); day(lot.expires_on);
    if (ids.has(lot.id)) fail(); ids.add(lot.id); allocated += quantity(lot.quantity);
  }
  if (allocated !== total) fail();
}
const escape = (value: string | number) => String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
const field = (label: string, value: string | number) => `<div><dt>${escape(label)}</dt><dd>${escape(value)}</dd></div>`;
/** Status must come from a fresh authorized read bound to this exact signed snapshot.
 * Order copies are not dispensing receipts; printing never consumes an allowance. */
export function renderNativePrescription(
  prescription: NativePrescriptionArtifact,
  status: NativePrescriptionPrintStatus | null,
  dispense?: NativeDispenseArtifact,
): string {
  validateNativePrescriptionArtifact(prescription); validateStatus(status, prescription);
  if (dispense !== undefined) {
    validateNativeDispenseArtifact(dispense, prescription);
    if (nativePrescriptionInstantMicros(status.checked_at) < nativePrescriptionInstantMicros(dispense.dispensed_at)) fail();
  }
  const s = prescription;
  const title = dispense ? "Recorded prescription dispense" : "Signed prescription order copy";
  const warning = status.state === "active" ? "" : `<aside role="alert"><strong>${escape(status.state.toUpperCase())} — historical copy</strong><p>${escape(status.reason ?? "Authorization is no longer active.")}</p>${status.replacement_id ? field("Replacement authorization", status.replacement_id) : ""}</aside>`;
  const fill = dispense ? `<section><h2>Recorded dispensing</h2><dl>${field("Quantity in this dispensing event", `${dispense.quantity} ${dispense.unit}`)}${field("Fill", dispense.fill_index === 0 ? "Initial fill" : `Refill ${dispense.fill_index}`)}${field("Dispensed at (recorded timestamp)", dispense.dispensed_at)}${field("Recorded by", dispense.recorded_by.name)}${field("Dispense reference", dispense.id)}${field("Invoice reference", dispense.invoice_id)}</dl><ul>${dispense.lots.map(lot => `<li>${escape(lot.quantity)} ${escape(dispense.unit)} · Lot ${escape(lot.number)} · Expires ${escape(lot.expires_on)}</li>`).join("")}</ul><p>This event may be a partial fill. It does not establish the remaining refill balance or confirm pickup.</p></section>` : "<p>This signed order copy does not confirm dispensing, administration, pharmacy transmission or pickup.</p>";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><style>body{overflow-wrap:anywhere;font-family:system-ui,sans-serif;color:CanvasText;background:Canvas;max-width:48rem;margin:2rem auto;padding:1rem}h1{font-size:1.5rem}dl>div{margin:.6rem 0}dt{font-weight:600}dd{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}aside{border:2px solid currentColor;padding:1rem}section{break-inside:avoid}footer{font-size:.8rem;overflow-wrap:anywhere}@media print{body{margin:0;max-width:none}}</style></head><body><header><h1>${title}</h1><p>${escape(s.prescriber.practice_name)}<br>${escape(s.prescriber.practice_address)}<br>${escape(s.prescriber.practice_phone ?? "Practice phone not recorded")}</p></header>${warning}<dl>${field("Patient", `${s.patient.name} · ${s.patient.species}`)}${field("Client", s.household.name)}${field("Client address at signing", s.household.address)}${field("Medication", s.medication.name)}${field("Strength / form", `${s.medication.strength} / ${s.medication.form}`)}${field("Directions as signed", s.medication.directions)}${field("Route", s.medication.route)}${field("Maximum quantity per fill", `${s.quantity_per_fill} ${s.unit}`)}${field("Refills originally authorized", s.refills_authorized)}${field("Fulfillment", s.fulfillment_mode === "practice_stock" ? "Practice stock" : "External pharmacy — fulfillment not confirmed")}${field("Valid from / through", `${s.starts_on} / ${s.expires_on}`)}${field("Prescriber", s.prescriber.name)}${field("License", `${s.prescriber.license_state} ${s.prescriber.license_number}`)}${field("Electronically signed by", s.signature_name)}${field("Signed at (recorded timestamp)", s.signed_at)}</dl>${fill}<footer><p>Saved instructions are reproduced without recalculation. This copy is not a current fill-eligibility check.</p>${field("Authorization reference", s.authorization_id)}${field("Signed snapshot hash", s.authorization_hash)}${field("Status checked at", status.checked_at)}<p>Native prescription print format 1</p></footer></body></html>`;
}
