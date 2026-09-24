/** Clinical projections of immutable correction evidence. The database verifies
 * canonical JSONB hashes; this module validates identities, chain links and display. */
import {
  nativePrescriptionInstantMicros,
  renderNativePrescription,
  type NativePrescriptionArtifact,
  type NativeDispenseArtifact,
  type NativePrescriptionPrintStatus,
} from "./native-prescription-renderer.ts";
export interface CorrectionHead { event_id: string | null; version: number; record_hash: string | null }
export interface CorrectionTarget { authorization_id: string; pet_id: string; dispense_id: string }
export interface CorrectionActor { id: string; name: string; authority: "active_staff" | "active_dvm" }
export interface OriginalPickupRef {
  id: string; document_hash: string; picked_up_at: string;
  recipient_name: string; recipient_relationship: string; actor_id: string;
}
export interface HandoffAssertion { picked_up_at: string; recipient_name: string; recipient_relationship: string }
export interface PickupAmendment {
  original_pickup_id: string;
  disposition: "recorded_in_error" | "corrected_handoff";
  handoff: HandoffAssertion | null;
}
export interface PickupAmendmentHead { event_id: string; version: number; value: PickupAmendment }
export interface CorrectionContext {
  version: 1; target: CorrectionTarget; authorization_hash: string;
  dispense_document_hash: string; dispense_artifact_hash: string; dispensed_at: string;
  original_pickup: OriginalPickupRef | null; head: CorrectionHead;
  latest_pickup_amendment: PickupAmendmentHead | null;
}
export interface CorrectionPreview { version: 1; actor_id: string; context: CorrectionContext; context_hash: string; observed_at: string }
export interface CorrectionRequest extends CorrectionTarget {
  kind: "clinical_annotation" | "operational_annotation" | "pickup_amendment";
  expected_context_hash: string; expected_head: CorrectionHead;
  reason: string; note: string; amends_event_id: string | null;
  pickup_amendment: PickupAmendment | null; attest_review: true;
}
export interface CorrectionEvent {
  version: 1; id: string; target: CorrectionTarget; authorization_hash: string;
  dispense_document_hash: string; sequence: number; prior_event_id: string | null;
  prior_record_hash: string | null; actor: CorrectionActor; kind: CorrectionRequest["kind"];
  reason: string; note: string; amends_event_id: string | null;
  pickup_amendment: PickupAmendment | null; reviewed_context_hash: string;
  created_at: string; record_hash: string;
}
export interface CorrectionReceipt { version: 1; id: string; actor_id: string; request: CorrectionRequest; request_hash: string; result: CorrectionEvent; created_at: string }
export interface CorrectionRead { version: 1; context: CorrectionContext; context_hash: string }
export interface CorrectionPage { version: 1; target: CorrectionTarget; head: CorrectionHead; events: CorrectionEvent[]; next_before_version: number | null }
export interface AuthorizationCorrectionSummary { version: 1; event_count: number; affected_dispense_count: number; heads_hash: string }
export interface DispenseCorrectionDisclosure { version: 1; head: CorrectionHead; events: CorrectionEvent[]; latest_pickup_amendment: PickupAmendmentHead | null }
export interface NativePrescriptionPrintV2 {
  version: 2; prescription: NativePrescriptionArtifact; status: NativePrescriptionPrintStatus;
  dispense: NativeDispenseArtifact | null; correction_summary: AuthorizationCorrectionSummary;
  dispense_corrections: DispenseCorrectionDisclosure | null; original_pickup: OriginalPickupRef | null;
}
export interface CorrectionPickupIdentity { id: string; picked_up_at: string; recipient_name: string; actor_id: string }
const fail = (): never => { throw new Error("Invalid dispensing correction evidence; refresh the exact record."); };
function require(value: unknown): asserts value { if (!value) fail(); }
function keys(value: unknown, names: string): void {
  require(value && typeof value === "object" && !Array.isArray(value));
  const expected = names.split(" ");
  require(Object.keys(value).length === expected.length && expected.every(k => Object.prototype.hasOwnProperty.call(value, k)));
}
const uuid = (v: unknown) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const hash = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const integer = (v: unknown, max = 2147483647) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= max;
const text = (v: unknown, max: number) => typeof v === "string" && v === v.trim() && !!v && Array.from(v).length <= max && !Array.from(v).some(c => (c.charCodeAt(0) < 32 && ![9, 10].includes(c.charCodeAt(0))) || c.charCodeAt(0) === 127);
export function correctionEvidenceEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => correctionEvidenceEqual(v, b[i]));
  return Object.keys(a).length === Object.keys(b).length && Object.entries(a).every(([k, v]) => Object.prototype.hasOwnProperty.call(b, k) && correctionEvidenceEqual(v, (b as Record<string, unknown>)[k]));
}
export function validateCorrectionHead(value: CorrectionHead): void {
  keys(value, "event_id version record_hash");
  require(integer(value.version) && (value.version === 0 ? value.event_id === null && value.record_hash === null : uuid(value.event_id) && hash(value.record_hash)));
}
export function validateAuthorizationCorrectionSummary(value: AuthorizationCorrectionSummary): void {
  keys(value, "version event_count affected_dispense_count heads_hash");
  require(value.version === 1 && integer(value.event_count, Number.MAX_SAFE_INTEGER) && integer(value.affected_dispense_count, Number.MAX_SAFE_INTEGER) && hash(value.heads_hash) && value.affected_dispense_count <= value.event_count);
  require(value.event_count === 0 ? value.affected_dispense_count === 0 && value.heads_hash === "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945" : value.affected_dispense_count > 0);
}
function target(value: CorrectionTarget): void {
  keys(value, "authorization_id pet_id dispense_id");
  require(uuid(value.authorization_id) && uuid(value.pet_id) && uuid(value.dispense_id));
}
function amendment(value: PickupAmendment, pickup: CorrectionPickupIdentity | null, dispensedAt: string, observedAt: string): void {
  keys(value, "original_pickup_id disposition handoff");
  require(pickup !== null && value.original_pickup_id === pickup.id);
  if (value.disposition === "recorded_in_error") require(value.handoff === null);
  else {
    require(value.disposition === "corrected_handoff"); keys(value.handoff, "picked_up_at recipient_name recipient_relationship");
    const handoff = value.handoff!;
    require(text(handoff.recipient_name, 200) && text(handoff.recipient_relationship, 200));
    const at = nativePrescriptionInstantMicros(handoff.picked_up_at);
    require(at >= nativePrescriptionInstantMicros(dispensedAt) && at <= nativePrescriptionInstantMicros(observedAt));
  }
}
export function validateOriginalPickup(value: OriginalPickupRef, dispensedAt: string, observedAt?: string): void {
  keys(value, "id document_hash picked_up_at recipient_name recipient_relationship actor_id");
  require(uuid(value.id) && hash(value.document_hash) && uuid(value.actor_id) && text(value.recipient_name, 200) && text(value.recipient_relationship, 200));
  const at = nativePrescriptionInstantMicros(value.picked_up_at);
  require(at >= nativePrescriptionInstantMicros(dispensedAt) && (observedAt === undefined || at <= nativePrescriptionInstantMicros(observedAt)));
}
/** Complete ascending history, not an arbitrary paginated slice. */
export function validateDispenseCorrectionDisclosure(
  value: DispenseCorrectionDisclosure, expected: CorrectionTarget,
  authorizationHash: string, dispensedAt: string, pickup: CorrectionPickupIdentity | null,
  observedAt?: string,
): void {
  target(expected); require(hash(authorizationHash));
  keys(value, "version head events latest_pickup_amendment"); validateCorrectionHead(value.head);
  require(value.version === 1 && Array.isArray(value.events) && value.events.length <= 100 && value.events.length === value.head.version);
  let predecessor: CorrectionEvent | undefined, latest: PickupAmendmentHead | null = null;
  const entries = new Map<string, CorrectionEvent>();
  for (const e of value.events) {
    keys(e, "version id target authorization_hash dispense_document_hash sequence prior_event_id prior_record_hash actor kind reason note amends_event_id pickup_amendment reviewed_context_hash created_at record_hash");
    target(e.target); keys(e.actor, "id name authority");
    require(e.version === 1 && uuid(e.id) && !entries.has(e.id) && correctionEvidenceEqual(e.target, expected) && e.authorization_hash === authorizationHash && hash(e.dispense_document_hash) && hash(e.reviewed_context_hash) && hash(e.record_hash));
    require(e.sequence === entries.size + 1 && e.prior_event_id === (predecessor?.id ?? null) && e.prior_record_hash === (predecessor?.record_hash ?? null));
    require(!predecessor || e.dispense_document_hash === predecessor.dispense_document_hash);
    require(uuid(e.actor.id) && text(e.actor.name, 200) && ["clinical_annotation", "operational_annotation", "pickup_amendment"].includes(e.kind) && e.actor.authority === (e.kind === "clinical_annotation" ? "active_dvm" : "active_staff") && text(e.reason, 2000) && text(e.note, 4000));
    const at = nativePrescriptionInstantMicros(e.created_at);
    require(at >= nativePrescriptionInstantMicros(dispensedAt) && (!predecessor || at >= nativePrescriptionInstantMicros(predecessor.created_at)) && (observedAt === undefined || at <= nativePrescriptionInstantMicros(observedAt)));
    if (e.kind === "pickup_amendment") {
      require(e.pickup_amendment !== null && e.amends_event_id === (latest?.event_id ?? null));
      amendment(e.pickup_amendment, pickup, dispensedAt, e.created_at);
      require(pickup !== null && at >= nativePrescriptionInstantMicros(pickup.picked_up_at));
      latest = { event_id: e.id, version: e.sequence, value: e.pickup_amendment };
    } else require(e.pickup_amendment === null && (e.amends_event_id === null || (uuid(e.amends_event_id) && entries.get(e.amends_event_id)?.kind === e.kind)));
    entries.set(e.id, e); predecessor = e;
  }
  require(value.head.event_id === (predecessor?.id ?? null) && value.head.record_hash === (predecessor?.record_hash ?? null) && correctionEvidenceEqual(value.latest_pickup_amendment, latest));
}
const escape = (v: unknown) => String(v ?? "Not recorded").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const field = (label: string, v: unknown) => `<div><dt>${escape(label)}</dt><dd>${escape(v)}</dd></div>`;
export function renderAuthorizationCorrectionSummary(value: AuthorizationCorrectionSummary): string {
  validateAuthorizationCorrectionSummary(value);
  return `<section><h3>Dispensing corrections when reviewed</h3><p>${value.event_count} recorded amendment(s) across ${value.affected_dispense_count} dispensing record(s). Detailed amendments appear only for explicitly included dispensing records.</p>${field("Correction summary fingerprint", value.heads_hash)}</section>`;
}
/** Call only after validateDispenseCorrectionDisclosure has bound the complete chain. */
export function renderDispenseCorrectionDisclosure(value: DispenseCorrectionDisclosure, pickup: CorrectionPickupIdentity | null): string {
  return `<section><h3>Original pickup record</h3>${pickup ? `<dl>${field("Originally recorded recipient", pickup.recipient_name)}${field("Originally recorded pickup time", pickup.picked_up_at)}${field("Original pickup reference", pickup.id)}</dl>` : "<p>No original pickup recorded.</p>"}<h3>Dispensing amendments</h3>${value.events.length ? "<p>Original dispensing and pickup facts remain visible. These attributed assertions do not restore allowance, change stock, credit an invoice or refund money.</p>" : "<p>No amendments recorded when reviewed.</p>"}${value.events.map(e => `<section><h4>${e.kind === "clinical_annotation" ? "Clinical annotation" : e.kind === "operational_annotation" ? "Operational annotation" : "Pickup amendment"} · ${e.sequence}</h4><dl>${field("Recorded by", e.actor.name)}${field("Authority at recording", e.actor.authority === "active_dvm" ? "DVM clinical annotation — not a new prescription" : "Staff assertion")}${field("Recorded at", e.created_at)}${field("Reason", e.reason)}${field("Annotation", e.note)}${field("Amends prior entry", e.amends_event_id)}</dl>${e.pickup_amendment ? e.pickup_amendment.disposition === "recorded_in_error" ? "<p><strong>Original pickup recorded in error.</strong> This disputes the recorded handoff; it does not assert that no handoff occurred.</p>" : `<p><strong>Corrected handoff assertion</strong></p><dl>${field("Asserted recipient", e.pickup_amendment.handoff!.recipient_name)}${field("Asserted relationship", e.pickup_amendment.handoff!.recipient_relationship)}${field("Asserted pickup time", e.pickup_amendment.handoff!.picked_up_at)}</dl>` : ""}${field("Amendment reference", e.id)}${field("Amendment fingerprint", e.record_hash)}</section>`).join("")}${value.latest_pickup_amendment ? `<p>Latest pickup interpretation: ${value.latest_pickup_amendment.value.disposition === "recorded_in_error" ? "the original pickup assertion is disputed" : "use the latest corrected handoff assertion shown above"}. Original and superseded statements remain historical evidence.</p>` : ""}</section>`;
}
export function renderNativePrescriptionV2(value: NativePrescriptionPrintV2): string {
  keys(value, "version prescription status dispense correction_summary dispense_corrections original_pickup");
  require(value.version === 2);
  const html = renderNativePrescription(value.prescription, value.status, value.dispense ?? undefined);
  validateAuthorizationCorrectionSummary(value.correction_summary);
  let history = "";
  if (value.dispense === null) require(value.dispense_corrections === null && value.original_pickup === null);
  else {
    require(value.dispense_corrections !== null);
    if (value.original_pickup !== null) validateOriginalPickup(value.original_pickup, value.dispense.dispensed_at, value.status.checked_at);
    validateDispenseCorrectionDisclosure(value.dispense_corrections, { authorization_id: value.prescription.authorization_id, pet_id: value.prescription.patient.id, dispense_id: value.dispense.id }, value.prescription.authorization_hash, value.dispense.dispensed_at, value.original_pickup, value.status.checked_at);
    require(value.dispense_corrections.events.length <= value.correction_summary.event_count && (value.dispense_corrections.events.length === 0 || value.correction_summary.affected_dispense_count > 0));
    history = renderDispenseCorrectionDisclosure(value.dispense_corrections, value.original_pickup);
  }
  return html.replace("<footer>", `${renderAuthorizationCorrectionSummary(value.correction_summary)}${history}<footer>`).replace("Native prescription print format 1", "Native prescription print format 2 — original artifact preserved with current amendment disclosure");
}
