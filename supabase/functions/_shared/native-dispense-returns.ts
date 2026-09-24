/** Native return evidence contracts. PostgreSQL owns canonical hashes and stock mutations. */
import type { CorrectionHead, CorrectionTarget, OriginalPickupRef } from "./native-dispense-corrections.ts";
import { replayNativeReturnQuantities } from "./native-return-quantity-replay.ts";
export interface ReturnPolicy {
  version: number; enabled: boolean; review_reference: string | null;
  actor_id: string | null; actor_name: string | null; reviewed_at: string | null; record_hash: string | null;
}
export interface ReturnPolicyRequest { expected_version: number; enabled: boolean; review_reference: string; attest_review: true }
export interface ReturnPolicyReceipt { version: 1; id: string; actor_id: string; request: ReturnPolicyRequest; request_hash: string; result: ReturnPolicy; created_at: string }
export interface ReturnAllocationInput { allocation_id: string; quantity: string }
export interface ReturnIntent {
  target: CorrectionTarget; action: "intake" | "dispose" | "restock"; intake_id: string | null;
  allocations: ReturnAllocationInput[];
  custody: "clinic_retained" | "client_returned" | "unknown" | null;
  package_condition: "sealed_intact" | "opened" | "damaged" | "unknown" | null;
  storage_history: "controlled" | "compromised" | "unknown" | null;
  reason: string; note: string;
}
export interface ReturnRequest { intent: ReturnIntent; expected_context_hash: string; expected_head: CorrectionHead; attest_review: true; attest_restock: boolean }
export interface ReturnBalance {
  allocation_id: string; lot_id: string; lot_number: string; expires_on: string;
  dispensed_quantity: string; returned_quantity: string; remaining_returnable_quantity: string;
  held_quantity: string; disposed_quantity: string; restocked_quantity: string;
}
export interface ReturnIntakeAllocation { allocation_id: string; lot_id: string; quantity: string; held_quantity: string; disposed_quantity: string; restocked_quantity: string }
export interface ReturnIntakeBalance {
  id: string; sequence: number; custody: NonNullable<ReturnIntent["custody"]>;
  package_condition: NonNullable<ReturnIntent["package_condition"]>; storage_history: NonNullable<ReturnIntent["storage_history"]>;
  allocations: ReturnIntakeAllocation[];
}
export interface ReturnStockReview {
  product: { id: string; name: string; unit: string; active: boolean; version: number };
  lots: Array<{ lot_id: string; balance: string }>; practice_date: string;
}
export interface ReturnContext {
  version: 1; target: CorrectionTarget; authorization_hash: string; dispense_document_hash: string; dispensed_at: string;
  head: CorrectionHead; original_pickup: OriginalPickupRef | null; correction_head: CorrectionHead;
  allocations: ReturnBalance[]; intake: ReturnIntakeBalance | null; stock_review: ReturnStockReview | null;
  policy: ReturnPolicy | null; intent: ReturnIntent;
}
export interface ReturnPreview { version: 1; actor_id: string; observed_at: string; context: ReturnContext; context_hash: string; allowed: boolean; blockers: string[] }
export interface ReturnEventAllocation { allocation_id: string; lot_id: string; quantity: string; movement_id: string | null }
export interface ReturnEvent {
  version: 1; id: string; target: CorrectionTarget; authorization_hash: string; dispense_document_hash: string;
  sequence: number; prior_event_id: string | null; prior_record_hash: string | null;
  actor: { id: string; name: string; authority: "active_staff" | "active_dvm" };
  action: ReturnIntent["action"]; intake_id: string | null; allocations: ReturnEventAllocation[];
  custody: ReturnIntent["custody"]; package_condition: ReturnIntent["package_condition"]; storage_history: ReturnIntent["storage_history"];
  reason: string; note: string; policy: ReturnPolicy | null;
  reviewed_context_hash: string; created_at: string; record_hash: string;
}
export interface ReturnReceipt { version: 1; id: string; actor_id: string; request: ReturnRequest; request_hash: string; result: ReturnEvent; created_at: string }
export interface ReturnRead { version: 1; target: CorrectionTarget; authorization_hash: string; dispense_document_hash: string; dispensed_at: string; head: CorrectionHead; allocations: ReturnBalance[] }
export interface ReturnIntakeRead { version: 1; target: CorrectionTarget; head: CorrectionHead; intake: ReturnIntakeBalance }
export interface ReturnPage { version: 1; target: CorrectionTarget; head: CorrectionHead; events: ReturnEvent[]; next_before_version: number | null }
export interface ReturnSummary { version: 1; event_count: number; affected_dispense_count: number; heads_hash: string }
export interface ReturnDisclosure { version: 1; head: CorrectionHead; events: ReturnEvent[]; allocations: ReturnBalance[] }

import { correctionEvidenceEqual, validateCorrectionHead, validateAuthorizationCorrectionSummary, renderNativePrescriptionV2, type NativePrescriptionPrintV2, type CorrectionPickupIdentity } from "./native-dispense-corrections.ts";
import { nativePrescriptionInstantMicros, type NativeDispenseDetails } from "./native-prescription-renderer.ts";
export interface NativePrescriptionPrintV3 extends Omit<NativePrescriptionPrintV2, "version"> { version: 3; return_summary: ReturnSummary; dispense_returns: ReturnDisclosure | null }
const invalid = (): never => { throw new Error("Invalid physical return evidence; refresh the exact dispensing record."); };
function require(value: unknown): asserts value { if (!value) invalid(); }
function keys(value: unknown, names: string): void {
  require(value && typeof value === "object" && !Array.isArray(value));
  const expected = names.split(" ");
  require(Object.keys(value).length === expected.length && expected.every(k => Object.prototype.hasOwnProperty.call(value, k)));
}
const uuid = (v: unknown) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
const hash = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const integer = (v: unknown) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= 2147483647;
const text = (v: unknown, max: number) => typeof v === "string" && v === v.trim() && !!v && Array.from(v).length <= max && !Array.from(v).some(c => (c.charCodeAt(0) < 32 && ![9, 10].includes(c.charCodeAt(0))) || c.charCodeAt(0) === 127);
function quantity(v: unknown, fixed = true): bigint {
  require(typeof v === "string" && (fixed ? /^(0|[1-9][0-9]{0,10})\.[0-9]{3}$/ : /^(0|[1-9][0-9]{0,10})(\.[0-9]{1,3})?$/).test(v));
  const [whole, fraction = ""] = v.split("."); return BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, "0"));
}
export function validateReturnPolicy(v: ReturnPolicy): void {
  keys(v, "version enabled review_reference actor_id actor_name reviewed_at record_hash");
  require(integer(v.version) && typeof v.enabled === "boolean");
  if (v.version === 0) require(v.enabled === false && v.review_reference === null && v.actor_id === null && v.actor_name === null && v.reviewed_at === null && v.record_hash === null);
  else {
    require(text(v.review_reference, 2000) && uuid(v.actor_id) && text(v.actor_name, 200) && hash(v.record_hash));
    nativePrescriptionInstantMicros(v.reviewed_at!);
  }
}
export function validateReturnBalance(v: ReturnBalance): void {
  keys(v, "allocation_id lot_id lot_number expires_on dispensed_quantity returned_quantity remaining_returnable_quantity held_quantity disposed_quantity restocked_quantity");
  require(uuid(v.allocation_id) && uuid(v.lot_id) && text(v.lot_number, 200));
  require(typeof v.expires_on === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.expires_on) && new Date(v.expires_on).toISOString().slice(0, 10) === v.expires_on);
  const original = quantity(v.dispensed_quantity), returned = quantity(v.returned_quantity);
  require(original > 0n && returned <= original && returned + quantity(v.remaining_returnable_quantity) === original);
  require(quantity(v.held_quantity) + quantity(v.disposed_quantity) + quantity(v.restocked_quantity) === returned);
}
/** Verify complete clinical disclosure, including quantity accounting, not merely a history page. */
export function validateReturnDisclosure(v: ReturnDisclosure, target: CorrectionTarget, authorizationHash: string, fill: NativeDispenseDetails, pickup: CorrectionPickupIdentity | null, observedAt?: string): void {
  keys(v, "version head events allocations"); keys(target, "authorization_id pet_id dispense_id");
  require(uuid(target.authorization_id) && uuid(target.pet_id) && uuid(target.dispense_id) && hash(authorizationHash) && fill.id === target.dispense_id && fill.authorization_id === target.authorization_id && fill.authorization_hash === authorizationHash);
  validateCorrectionHead(v.head);
  require(v.version === 1 && Array.isArray(v.events) && v.events.length <= 100 && v.events.length === v.head.version && Array.isArray(v.allocations) && v.allocations.length === fill.lots.length);
  const balances = new Map<string, ReturnBalance>(), lots = new Set<string>(), intakes = new Map<string, ReturnEvent>(), ids = new Set<string>(), movementIds = new Set<string>();
  let previousAllocation: string | null = null;
  for (const b of v.allocations) {
    validateReturnBalance(b); require(previousAllocation === null || b.allocation_id > previousAllocation); previousAllocation = b.allocation_id;
    const source = fill.lots.find(l => l.id === b.lot_id);
    require(source && !lots.has(b.lot_id) && source.number === b.lot_number && source.expires_on === b.expires_on && quantity(source.quantity, false) === quantity(b.dispensed_quantity));
    lots.add(b.lot_id); balances.set(b.allocation_id, b);
  }
  let prior: ReturnEvent | undefined;
  for (const e of v.events) {
    keys(e, "version id target authorization_hash dispense_document_hash sequence prior_event_id prior_record_hash actor action intake_id allocations custody package_condition storage_history reason note policy reviewed_context_hash created_at record_hash");
    keys(e.actor, "id name authority");
    require(e.version === 1 && uuid(e.id) && !ids.has(e.id) && correctionEvidenceEqual(e.target, target) && e.authorization_hash === authorizationHash && hash(e.dispense_document_hash) && hash(e.reviewed_context_hash) && hash(e.record_hash));
    require(e.sequence === ids.size + 1 && e.prior_event_id === (prior?.id ?? null) && e.prior_record_hash === (prior?.record_hash ?? null) && (!prior || prior.dispense_document_hash === e.dispense_document_hash));
    require(uuid(e.actor.id) && text(e.actor.name, 200) && text(e.reason, 2000) && text(e.note, 4000));
    const at = nativePrescriptionInstantMicros(e.created_at);
    require(at >= nativePrescriptionInstantMicros(fill.dispensed_at) && (!prior || at >= nativePrescriptionInstantMicros(prior.created_at)) && (observedAt === undefined || at <= nativePrescriptionInstantMicros(observedAt)));
    require(["intake", "dispose", "restock"].includes(e.action) && e.actor.authority === (e.action === "restock" ? "active_dvm" : "active_staff"));
    let intake: ReturnEvent | undefined;
    if (e.action === "intake") {
      require(e.intake_id === null && e.policy === null && ["clinic_retained", "client_returned", "unknown"].includes(e.custody!) && ["sealed_intact", "opened", "damaged", "unknown"].includes(e.package_condition!) && ["controlled", "compromised", "unknown"].includes(e.storage_history!));
      intakes.set(e.id, e);
    } else {
      require(uuid(e.intake_id) && e.custody === null && e.package_condition === null && e.storage_history === null);
      intake = intakes.get(e.intake_id!); require(intake && nativePrescriptionInstantMicros(intake.created_at) <= at);
      if (e.action === "restock") {
        require(e.policy !== null); validateReturnPolicy(e.policy);
        require(e.policy.enabled && e.policy.version > 0 && nativePrescriptionInstantMicros(e.policy.reviewed_at!) <= at && pickup === null && intake.custody === "clinic_retained" && intake.package_condition === "sealed_intact" && intake.storage_history === "controlled");
      } else require(e.policy === null);
    }
    require(Array.isArray(e.allocations) && e.allocations.length > 0 && e.allocations.length <= 100);
    previousAllocation = null;
    for (const a of e.allocations) {
      keys(a, "allocation_id lot_id quantity movement_id");
      require(uuid(a.allocation_id) && uuid(a.lot_id) && (previousAllocation === null || a.allocation_id > previousAllocation)); previousAllocation = a.allocation_id;
      const b = balances.get(a.allocation_id);
      require(b && b.lot_id === a.lot_id && quantity(a.quantity) > 0n);
      if (e.action === "restock") {
        require(uuid(a.movement_id) && !movementIds.has(a.movement_id!)); movementIds.add(a.movement_id!);
      } else require(a.movement_id === null);
    }
    ids.add(e.id); prior = e;
  }
  require(v.head.event_id === (prior?.id ?? null) && v.head.record_hash === (prior?.record_hash ?? null));
  const replay = replayNativeReturnQuantities(
    v.allocations.map(a => ({ allocation_id: a.allocation_id, lot_id: a.lot_id, quantity: a.dispensed_quantity })),
    v.events.map(e => ({
      id: e.id, sequence: e.sequence, action: e.action, intake_id: e.intake_id, correction_target_id: null,
      allocations: e.allocations.map(a => ({ allocation_id: a.allocation_id, lot_id: a.lot_id, quantity: a.quantity })),
    })),
  );
  require(correctionEvidenceEqual(replay.allocations, v.allocations.map(({ lot_number: _lotNumber, expires_on: _expiresOn, ...balance }) => balance)));
}
const escape = (v: unknown) => String(v ?? "Not recorded").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const field = (label: string, v: unknown) => `<div><dt>${escape(label)}</dt><dd>${escape(v)}</dd></div>`;
export function renderReturnSummary(v: ReturnSummary): string {
  validateAuthorizationCorrectionSummary(v);
  return `<section><h3>Physical returns when reviewed</h3><p>${v.event_count} return intake or disposition event(s) across ${v.affected_dispense_count} dispensing record(s). Details appear only for selected dispensing records.</p></section>`;
}
/** Call after full disclosure validation. */
export function renderReturnDisclosure(v: ReturnDisclosure, unit: string): string {
  return `<section><h3>Physical return history</h3><p>Original dispensing remains recorded. Returned quantities do not restore prescription allowance or establish a credit or cash refund. Held medication is not available stock.</p>${v.allocations.map(a => `<section><h4>Lot ${escape(a.lot_number)}</h4><dl>${field("Originally dispensed", `${a.dispensed_quantity} ${unit}`)}${field("Received into held custody", `${a.returned_quantity} ${unit}`)}${field("Currently held", `${a.held_quantity} ${unit}`)}${field("Disposed", `${a.disposed_quantity} ${unit}`)}${field("Returned to available stock", `${a.restocked_quantity} ${unit}`)}</dl></section>`).join("")}${v.events.map(e => `<section><h4>${e.sequence}. ${e.action === "intake" ? "Received into held custody" : e.action === "dispose" ? "Disposal recorded" : "Return to available stock"}</h4><dl>${field("Recorded by", e.actor.name)}${field("Recorded at", e.created_at)}${field("Reason", e.reason)}${field("Note", e.note)}${e.action === "intake" ? field("Custody", e.custody === "clinic_retained" ? "Retained at clinic" : e.custody === "client_returned" ? "Returned by client" : "Unknown") + field("Package condition", e.package_condition) + field("Storage history", e.storage_history) : field("Original return intake", e.intake_id)}</dl>${e.allocations.map(a => `<p>${escape(v.allocations.find(b => b.allocation_id === a.allocation_id)!.lot_number)}: ${escape(a.quantity)} ${escape(unit)}</p>`).join("")}</section>`).join("")}</section>`;
}
export function renderNativePrescriptionV3(v: NativePrescriptionPrintV3): string {
  keys(v, "version prescription status dispense correction_summary dispense_corrections original_pickup return_summary dispense_returns"); require(v.version === 3);
  const { return_summary: summary, dispense_returns: returns, ...base } = v;
  const html = renderNativePrescriptionV2({ ...base, version: 2 });
  validateAuthorizationCorrectionSummary(summary);
  if (v.dispense === null) require(returns === null);
  else {
    require(returns !== null);
    validateReturnDisclosure(returns, { authorization_id: v.prescription.authorization_id, pet_id: v.prescription.patient.id, dispense_id: v.dispense.id }, v.prescription.authorization_hash, v.dispense, v.original_pickup, v.status.checked_at);
    require(returns.events.length <= summary.event_count && (!returns.events.length || summary.affected_dispense_count > 0));
  }
  return html.replace("<footer>", `${renderReturnSummary(summary)}${returns ? renderReturnDisclosure(returns, v.prescription.unit) : ""}<footer>`).replace("Native prescription print format 2", "Native prescription print format 3");
}
