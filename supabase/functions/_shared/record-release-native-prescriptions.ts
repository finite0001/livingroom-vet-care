import type { ReleaseSnapshot } from "./record-release-renderer.ts";
import {
  validateNativePrescriptionArtifact,
  validateNativeDispenseDetails,
  nativePrescriptionInstantMicros,
  type NativePrescriptionArtifact,
  type NativeDispenseDetails,
} from "./native-prescription-renderer.ts";

export interface NativeReleaseStatus {
  state: "active" | "expired" | "cancelled" | "replaced";
  head_id: string | null;
  head_version: number;
  event_at: string | null;
  reason: string | null;
  replacement_id: string | null;
}
export interface NativeReleaseUsage {
  version: 2;
  native_fill_accounting: "implemented";
  dispensed_quantity: string;
  used_fill_slots: number;
  remaining_quantity: string | null;
  forfeited_quantity: string;
  unopened_fill_slots: number | null;
  allowance_basis: "native_practice_stock" | "external_unknown";
  open_slot: { id: string; index: number; version: number; remaining_quantity: string } | null;
  fulfillment_head: { event_id: string | null; version: number };
  external_fulfillment: "unknown";
}
export interface NativePrescriptionRelease {
  id: string;
  authorization_hash: string;
  artifact: NativePrescriptionArtifact;
  status: NativeReleaseStatus;
  usage: NativeReleaseUsage;
}
export interface NativeReleasePickup {
  id: string;
  picked_up_at: string;
  recipient_name: string;
  actor_id: string;
}
export interface NativeReleaseDispenseArtifact extends NativeDispenseDetails {}
export interface NativeDispenseRelease {
  id: string;
  artifact_hash: string;
  artifact: NativeReleaseDispenseArtifact;
  prescription: NativePrescriptionRelease;
  pickup: NativeReleasePickup | null;
}
const fail = (): never => { throw new Error("Invalid native prescription release evidence; review a fresh package."); };
function require(value: unknown): asserts value { if (!value) fail(); }
function keys(value: unknown, names: string): void {
  require(value && typeof value === "object" && !Array.isArray(value));
  const expected = names.split(" ");
  require(Object.keys(value).length === expected.length && expected.every(k => Object.prototype.hasOwnProperty.call(value, k)));
}
const uuid = (v: unknown) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const digest = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const integer = (v: unknown, max = 2147483647) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= max;
const text = (v: unknown, max: number) => typeof v === "string" && v.trim().length > 0 && Array.from(v).length <= max && !Array.from(v).some(c => c.charCodeAt(0) < 32 && ![9, 10, 13].includes(c.charCodeAt(0)));
function instant(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(v) || !Number.isFinite(Date.parse(v))) return false;
  return new Date(v.slice(0, 10) + "T00:00:00Z").toISOString().slice(0, 10) === v.slice(0, 10) && Number(v.slice(11, 13)) < 24 && Number(v.slice(14, 16)) < 60 && Number(v.slice(17, 19)) < 60;
}
function quantity(v: unknown): bigint {
  require(typeof v === "string" && /^(?:0|[1-9]\d{0,14})\.\d{3}$/.test(v));
  return BigInt(v.replace(".", ""));
}
function artifactQuantity(v: string): bigint {
  const [whole, fraction = ""] = v.split(".");
  return BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, "0"));
}
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => same(v, b[i]));
  return Object.keys(a).length === Object.keys(b).length && Object.entries(a).every(([k, v]) => Object.prototype.hasOwnProperty.call(b, k) && same(v, (b as Record<string, unknown>)[k]));
}
function prescription(v: NativePrescriptionRelease, s: ReleaseSnapshot): void {
  keys(v, "id authorization_hash artifact status usage");
  validateNativePrescriptionArtifact(v.artifact);
  const a = v.artifact;
  require(v.id === a.authorization_id && v.authorization_hash === a.authorization_hash && a.patient.id === s.patient.id && a.household.id === s.recipient.client_id);
  const status = v.status;
  keys(status, "state head_id head_version event_at reason replacement_id");
  require(["active", "expired", "cancelled", "replaced"].includes(status.state) && integer(status.head_version));
  if (status.state === "active" || status.state === "expired") {
    require(status.head_id === null && status.head_version === 0 && status.event_at === null && status.reason === null && status.replacement_id === null);
  } else {
    require(uuid(status.head_id) && status.head_version > 0 && instant(status.event_at) && nativePrescriptionInstantMicros(status.event_at) >= nativePrescriptionInstantMicros(a.signed_at) && text(status.reason, 2000));
    require(status.state === "replaced" ? uuid(status.replacement_id) && status.replacement_id !== v.id : status.replacement_id === null);
  }
  const u = v.usage;
  keys(u, "version native_fill_accounting dispensed_quantity used_fill_slots remaining_quantity forfeited_quantity unopened_fill_slots allowance_basis open_slot fulfillment_head external_fulfillment");
  require(u.version === 2 && u.native_fill_accounting === "implemented" && u.external_fulfillment === "unknown" && integer(u.used_fill_slots, a.refills_authorized + 1));
  const dispensed = quantity(u.dispensed_quantity), forfeited = quantity(u.forfeited_quantity);
  keys(u.fulfillment_head, "event_id version");
  require(integer(u.fulfillment_head.version) && (u.fulfillment_head.version === 0 ? u.fulfillment_head.event_id === null : uuid(u.fulfillment_head.event_id)));
  if (a.fulfillment_mode === "external_pharmacy") {
    require(u.allowance_basis === "external_unknown" && dispensed === 0n && forfeited === 0n && u.used_fill_slots === 0 && u.remaining_quantity === null && u.unopened_fill_slots === null && u.open_slot === null && u.fulfillment_head.version === 0);
    return;
  }
  require(u.allowance_basis === "native_practice_stock" && integer(u.unopened_fill_slots, a.refills_authorized + 1) && u.unopened_fill_slots === a.refills_authorized + 1 - u.used_fill_slots);
  const maximum = artifactQuantity(a.quantity_per_fill), remaining = quantity(u.remaining_quantity);
  let open = 0n;
  if (u.open_slot !== null) {
    keys(u.open_slot, "id index version remaining_quantity");
    require(uuid(u.open_slot.id) && integer(u.open_slot.index, a.refills_authorized) && u.open_slot.index === u.used_fill_slots - 1 && integer(u.open_slot.version) && u.open_slot.version > 0);
    open = quantity(u.open_slot.remaining_quantity);
    require(open > 0n && open < maximum);
  }
  require(remaining === BigInt(u.unopened_fill_slots!) * maximum + open && dispensed + forfeited + open === BigInt(u.used_fill_slots) * maximum);
  require(u.used_fill_slots === 0 ? dispensed === 0n && u.fulfillment_head.version === 0 : dispensed >= BigInt(u.used_fill_slots) && u.fulfillment_head.version >= u.used_fill_slots);
}
function selection(ids: unknown, rows: Array<{ id: string }>): void {
  require(Array.isArray(ids) && ids.length <= 20 && ids.length === rows.length && ids.every(uuid) && new Set(ids).size === ids.length);
  const seen = new Set(rows.map(v => v.id));
  require(seen.size === rows.length && ids.every(id => seen.has(id)));
}
/** Validates clinical projections; cryptographic verification of saved source artifacts is server-side. */
export function validateNativePrescriptions(s: ReleaseSnapshot): void {
  if (s.schema_version !== 10) {
    require(s.native_prescriptions === undefined && s.native_dispenses === undefined && s.selection?.native_prescription_ids === undefined && s.selection?.native_dispense_ids === undefined);
    return;
  }
  require(Array.isArray(s.native_prescriptions) && s.native_prescriptions.length <= 20 && Array.isArray(s.native_dispenses) && s.native_dispenses.length <= 20);
  selection(s.selection?.native_prescription_ids, s.native_prescriptions);
  selection(s.selection?.native_dispense_ids, s.native_dispenses);
  const contexts = new Map<string, NativePrescriptionRelease>();
  const include = (p: NativePrescriptionRelease) => {
    prescription(p, s);
    const prior = contexts.get(p.id);
    require(!prior || same(prior, p));
    contexts.set(p.id, p);
  };
  s.native_prescriptions.forEach(include);
  const totals = new Map<string, bigint>();
  const slotTotals = new Map<string, bigint>();
  for (const d of s.native_dispenses) {
    keys(d, "id artifact_hash artifact prescription pickup");
    include(d.prescription);
    validateNativeDispenseDetails(d.artifact, d.prescription.artifact);
    require(d.id === d.artifact.id && digest(d.artifact_hash));
    const key = d.prescription.id;
    totals.set(key, (totals.get(key) ?? 0n) + artifactQuantity(d.artifact.quantity));
    const slotKey = `${key}:${d.artifact.fill_index}`;
    slotTotals.set(slotKey, (slotTotals.get(slotKey) ?? 0n) + artifactQuantity(d.artifact.quantity));
    const maximum = artifactQuantity(d.prescription.artifact.quantity_per_fill);
    const open = d.prescription.usage.open_slot;
    require(slotTotals.get(slotKey)! <= (open?.index === d.artifact.fill_index ? maximum - quantity(open.remaining_quantity) : maximum));
    require(totals.get(key)! <= quantity(d.prescription.usage.dispensed_quantity) && d.artifact.fill_index < d.prescription.usage.used_fill_slots);
    if (d.pickup !== null) {
      keys(d.pickup, "id picked_up_at recipient_name actor_id");
      require(uuid(d.pickup.id) && uuid(d.pickup.actor_id) && instant(d.pickup.picked_up_at) && nativePrescriptionInstantMicros(d.pickup.picked_up_at) >= nativePrescriptionInstantMicros(d.artifact.dispensed_at) && text(d.pickup.recipient_name, 200));
    }
  }
}
const escape = (v: unknown) => String(v ?? "Not recorded").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const field = (label: string, v: unknown) => `<div><dt>${escape(label)}</dt><dd>${escape(v)}</dd></div>`;
function order(v: NativePrescriptionRelease): string {
  const a = v.artifact, u = v.usage;
  return `${v.status.state === "active" ? "" : `<aside><strong>${escape(v.status.state.toUpperCase())} — historical prescription</strong><p>Status recorded when this package was reviewed.</p></aside>`}<dl>${field("Patient at signing", `${a.patient.name} · ${a.patient.species}`)}${field("Client at signing", a.household.name)}${field("Client address at signing", a.household.address)}${field("Medication", a.medication.name)}${field("Strength / form", `${a.medication.strength} / ${a.medication.form}`)}${field("Directions as signed", a.medication.directions)}${field("Route", a.medication.route)}${field("Maximum quantity per fill", `${a.quantity_per_fill} ${a.unit}`)}${field("Refills originally authorized", a.refills_authorized)}${field("Valid from / through", `${a.starts_on} / ${a.expires_on}`)}${field("Prescriber", a.prescriber.name)}${field("License", `${a.prescriber.license_state} ${a.prescriber.license_number}`)}${field("Practice at signing", a.prescriber.practice_name)}${field("Practice address", a.prescriber.practice_address)}${field("Practice phone", a.prescriber.practice_phone)}${field("Electronically signed by", a.signature_name)}${field("Signed at", a.signed_at)}${field("Status when package reviewed", v.status.state)}${field("Status reason", v.status.reason)}${field("Status event time", v.status.event_at)}${field("Replacement authorization reference", v.status.replacement_id)}</dl><p>This frozen order history does not authorize a new fill, confirm administration or establish current eligibility.</p><h4>Native dispensing totals when reviewed</h4><dl>${field("Recorded quantity dispensed", `${u.dispensed_quantity} ${a.unit}`)}${field("Used fill slots", u.used_fill_slots)}${field("Forfeited quantity", `${u.forfeited_quantity} ${a.unit}`)}${field("Recorded remaining allowance", u.remaining_quantity === null ? "Unknown — external pharmacy" : `${u.remaining_quantity} ${a.unit}`)}${field("Unopened fill slots", u.unopened_fill_slots)}</dl><p>Outside pharmacy fulfillment is unknown. These totals may include dispensing events not selected for this package. Remaining allowance is historical accounting, not permission to dispense.</p><dl>${field("Authorization reference", v.id)}${field("Signed authorization fingerprint", v.authorization_hash)}</dl>`;
}
export function renderNativePrescriptions(s: ReleaseSnapshot): string {
  validateNativePrescriptions(s);
  if (s.schema_version !== 10) return "";
  return s.native_prescriptions!.map(v => `<article><h2>Selected signed prescription</h2>${order(v)}</article>`).join("") + s.native_dispenses!.map(d => `<article><h2>Selected recorded dispense</h2><dl>${field("Dispense reference", d.id)}${field("Quantity in this event", `${d.artifact.quantity} ${d.artifact.unit}`)}${field("Fill", d.artifact.fill_index === 0 ? "Initial fill" : `Refill ${d.artifact.fill_index}`)}${field("Dispensed at", d.artifact.dispensed_at)}${field("Recorded by", d.artifact.recorded_by.name)}</dl><p>A dispensing event may be a partial fill; it does not establish administration.</p><h3>Dispensed lots</h3>${d.artifact.lots.map(l => `<dl>${field("Lot number", l.number)}${field("Expiration date", l.expires_on)}${field("Quantity", `${l.quantity} ${d.artifact.unit}`)}</dl>`).join("")}<h3>Pickup when reviewed</h3>${d.pickup ? `<dl>${field("Recipient", d.pickup.recipient_name)}${field("Picked up at", d.pickup.picked_up_at)}${field("Recorded by staff reference", d.pickup.actor_id)}</dl>` : "<p>No pickup recorded for this dispense.</p>"}<h3>Signed prescription context for this dispense</h3><p>This context is included to interpret the selected dispense; it does not select other orders or dispensing events.</p>${order(d.prescription)}${field("Original full dispensing artifact fingerprint (before clinical projection)", d.artifact_hash)}</article>`).join("");
}
