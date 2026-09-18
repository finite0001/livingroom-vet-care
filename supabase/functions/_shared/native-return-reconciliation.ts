/** Clinical projection validation; PostgreSQL owns canonical hashes, authority and stock writes. */
import { correctionEvidenceEqual as same, validateCorrectionHead, renderNativePrescriptionV2, type CorrectionTarget, type CorrectionPickupIdentity } from "./native-dispense-corrections.ts";
import { validateReturnBalance, validateReturnPolicy, type ReturnEvent, type NativePrescriptionPrintV3 } from "./native-dispense-returns.ts";
import { replayNativeReturnQuantities, type ReturnQuantityReplay } from "./native-return-quantity-replay.ts";
import { nativePrescriptionInstantMicros as instant, type NativeDispenseDetails } from "./native-prescription-renderer.ts";
import type { ReconciliationEvent, ReconciliationDisclosure, ReconciliationSummary, ReturnDiscrepancyEvent, ReturnDiscrepancyState, ReturnPhysicalAttestations } from "./native-return-reconciliation-contract.ts";

export interface NativePrescriptionPrintV4 extends Omit<NativePrescriptionPrintV3, "version" | "return_summary" | "dispense_returns"> {
  version: 4; return_summary: ReconciliationSummary; dispense_returns: ReconciliationDisclosure | null;
}
const fail = (): never => { throw new Error("Invalid return reconciliation evidence; review a fresh patient record."); };
function require(value: unknown): asserts value { if (!value) fail(); }
function keys(value: unknown, fields: string): void {
  require(value !== null && typeof value === "object" && !Array.isArray(value));
  const expected = fields.split(" ");
  require(Object.keys(value).length === expected.length && expected.every(key => Object.prototype.hasOwnProperty.call(value, key)));
}
const uuid = (v: unknown) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
const hash = (v: unknown) => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);
const integer = (v: unknown) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= 2147483647;
const text = (v: unknown, max: number) => typeof v === "string" && !!v && v === v.trim() && Array.from(v).length <= max && !Array.from(v).some(c => (c.charCodeAt(0) < 32 && ![9, 10].includes(c.charCodeAt(0))) || c.charCodeAt(0) === 127);
function quantity(v: unknown, historical = false): bigint {
  require(typeof v === "string" && (historical ? /^(0|[1-9][0-9]{0,20})\.[0-9]{3}$/ : /^(0|[1-9][0-9]{0,10})\.[0-9]{3}$/).test(v));
  return BigInt(v.replace(".", ""));
}
function target(v: CorrectionTarget): void { keys(v, "authorization_id pet_id dispense_id"); require(uuid(v.authorization_id) && uuid(v.pet_id) && uuid(v.dispense_id)); }
function source(v: { event_id: string; record_hash: string }): void { keys(v, "event_id record_hash"); require(uuid(v.event_id) && hash(v.record_hash)); }
function actor(v: ReturnEvent["actor"]): void { keys(v, "id name authority"); require(uuid(v.id) && text(v.name, 200) && ["active_staff", "active_dvm"].includes(v.authority)); }
function orderedIds(values: string[]): void { require(Array.isArray(values) && values.every((id, i) => uuid(id) && (!i || id > values[i - 1]))); }
function physical(v: ReturnPhysicalAttestations, action: ReconciliationEvent["action"]): void {
  keys(v, "reviewed_physical_facts intake_claim_incorrect remains_physically_held was_not_destroyed removed_from_available_stock");
  require(v.reviewed_physical_facts === true && v.intake_claim_incorrect === (action === "retract_intake") && v.remains_physically_held === ["retract_disposal", "retract_restock"].includes(action) && v.was_not_destroyed === (action === "retract_disposal") && v.removed_from_available_stock === (action === "retract_restock"));
}

/** Shape and action facts only. Complete disclosure additionally binds original sources and all prior events. */
export function validateReconciliationEventShape(e: ReturnEvent | ReconciliationEvent): void {
  const base = "version id target authorization_hash dispense_document_hash sequence prior_event_id prior_record_hash actor action intake_id allocations custody package_condition storage_history reason note policy reviewed_context_hash created_at record_hash";
  require(e && [1, 2].includes(e.version));
  keys(e, base + (e.version === 2 ? " correction_target discrepancy_id physical_attestations" : ""));
  target(e.target); actor(e.actor);
  require(uuid(e.id) && hash(e.authorization_hash) && hash(e.dispense_document_hash) && hash(e.reviewed_context_hash) && hash(e.record_hash) && integer(e.sequence) && e.sequence > 0);
  require(e.sequence === 1 ? e.prior_event_id === null && e.prior_record_hash === null : uuid(e.prior_event_id) && hash(e.prior_record_hash));
  instant(e.created_at); require(text(e.reason, 2000) && text(e.note, 4000));
  const retract = ["retract_intake", "retract_disposal", "retract_restock"].includes(e.action);
  require(["intake", "dispose", "restock"].includes(e.action) || (e.version === 2 && retract));
  require(e.actor.authority === (retract || e.action === "restock" ? "active_dvm" : "active_staff"));
  if (e.action === "intake") {
    require(e.intake_id === null && ["clinic_retained", "client_returned", "unknown"].includes(e.custody!) && ["sealed_intact", "opened", "damaged", "unknown"].includes(e.package_condition!) && ["controlled", "compromised", "unknown"].includes(e.storage_history!));
  } else require(uuid(e.intake_id) && e.custody === null && e.package_condition === null && e.storage_history === null);
  if (e.action === "restock") { require(e.policy !== null); validateReturnPolicy(e.policy); require(e.policy.enabled && e.policy.version > 0 && instant(e.policy.reviewed_at!) <= instant(e.created_at)); }
  else require(e.policy === null);
  if (e.version === 2) {
    physical(e.physical_attestations, e.action);
    if (retract) { require(e.correction_target !== null); source(e.correction_target); }
    else require(e.correction_target === null && e.discrepancy_id === null);
    require(e.discrepancy_id === null || uuid(e.discrepancy_id));
  }
  require(Array.isArray(e.allocations) && e.allocations.length > 0 && e.allocations.length <= 100);
  orderedIds(e.allocations.map(a => a.allocation_id));
  for (const a of e.allocations) {
    keys(a, "allocation_id lot_id quantity movement_id"); require(uuid(a.lot_id) && quantity(a.quantity) > 0n);
    require(["restock", "retract_restock"].includes(e.action) ? uuid(a.movement_id) : a.movement_id === null);
  }
}

export function validateReconciliationReplayShape(v: ReturnQuantityReplay): void {
  keys(v, "allocations intakes correction_remaining historical");
  require(Array.isArray(v.allocations) && v.allocations.length > 0 && v.allocations.length <= 100 && Array.isArray(v.intakes) && Array.isArray(v.correction_remaining) && Array.isArray(v.historical));
  orderedIds(v.allocations.map(a => a.allocation_id));
  const balances = new Map(v.allocations.map(a => {
    keys(a, "allocation_id lot_id dispensed_quantity returned_quantity remaining_returnable_quantity held_quantity disposed_quantity restocked_quantity");
    require(uuid(a.lot_id) && quantity(a.dispensed_quantity) > 0n && quantity(a.returned_quantity) + quantity(a.remaining_returnable_quantity) === quantity(a.dispensed_quantity) && quantity(a.held_quantity) + quantity(a.disposed_quantity) + quantity(a.restocked_quantity) === quantity(a.returned_quantity));
    return [a.allocation_id, a] as const;
  }));
  const intakeIds = new Set<string>();
  const sums = new Map<string, { received: bigint; held: bigint; disposed: bigint; restocked: bigint }>();
  for (const i of v.intakes) {
    keys(i, "id allocations"); require(uuid(i.id) && !intakeIds.has(i.id) && Array.isArray(i.allocations) && i.allocations.length > 0 && i.allocations.length <= 100); intakeIds.add(i.id);
    orderedIds(i.allocations.map(a => a.allocation_id));
    for (const a of i.allocations) {
      keys(a, "allocation_id lot_id quantity held_quantity disposed_quantity restocked_quantity");
      const b = balances.get(a.allocation_id); require(b && a.lot_id === b.lot_id);
      const received = quantity(a.quantity), held = quantity(a.held_quantity), disposed = quantity(a.disposed_quantity), restocked = quantity(a.restocked_quantity);
      require(received === held + disposed + restocked);
      const total = sums.get(a.allocation_id) ?? { received: 0n, held: 0n, disposed: 0n, restocked: 0n };
      total.received += received; total.held += held; total.disposed += disposed; total.restocked += restocked; sums.set(a.allocation_id, total);
    }
  }
  for (const b of balances.values()) { const n = sums.get(b.allocation_id); require((n?.received ?? 0n) === quantity(b.returned_quantity) && (n?.held ?? 0n) === quantity(b.held_quantity) && (n?.disposed ?? 0n) === quantity(b.disposed_quantity) && (n?.restocked ?? 0n) === quantity(b.restocked_quantity)); }
  const sourceIds = new Set<string>();
  for (const row of v.correction_remaining) {
    keys(row, "event_id allocations"); require(uuid(row.event_id) && !sourceIds.has(row.event_id) && Array.isArray(row.allocations) && row.allocations.length > 0 && row.allocations.length <= 100); sourceIds.add(row.event_id);
    orderedIds(row.allocations.map(a => a.allocation_id));
    for (const a of row.allocations) { keys(a, "allocation_id quantity"); const b = balances.get(a.allocation_id); require(b && quantity(a.quantity) <= quantity(b.dispensed_quantity)); }
  }
  require(v.historical.length === v.allocations.length); orderedIds(v.historical.map(h => h.allocation_id));
  for (const h of v.historical) {
    keys(h, "allocation_id lot_id gross_intake_quantity gross_disposed_quantity gross_restocked_quantity retracted_intake_quantity retracted_disposed_quantity retracted_restocked_quantity");
    const b = balances.get(h.allocation_id); require(b && h.lot_id === b.lot_id);
    require(quantity(h.gross_intake_quantity, true) - quantity(h.retracted_intake_quantity, true) === quantity(b.returned_quantity) && quantity(h.gross_disposed_quantity, true) - quantity(h.retracted_disposed_quantity, true) === quantity(b.disposed_quantity) && quantity(h.gross_restocked_quantity, true) - quantity(h.retracted_restocked_quantity, true) === quantity(b.restocked_quantity));
  }
}

export function validateDiscrepancyEventShape(e: ReturnDiscrepancyEvent, expectedTarget: CorrectionTarget): void {
  keys(e, "version id target sequence prior_event_id prior_record_hash actor action case_id source allocations observation correction_ids return_head reviewed_context_hash created_at record_hash");
  target(e.target); actor(e.actor); source(e.source); validateCorrectionHead(e.return_head);
  require(e.version === 1 && uuid(e.id) && uuid(e.case_id) && same(e.target, expectedTarget) && integer(e.sequence) && e.sequence > 0 && hash(e.reviewed_context_hash) && hash(e.record_hash) && text(e.observation, 4000));
  require(["report", "note", "resolve_corrected", "resolve_confirmed_original"].includes(e.action));
  require(e.actor.authority === (e.action.startsWith("resolve_") ? "active_dvm" : "active_staff"));
  require(e.sequence === 1 ? e.prior_event_id === null && e.prior_record_hash === null : uuid(e.prior_event_id) && hash(e.prior_record_hash));
  instant(e.created_at); require(Array.isArray(e.allocations) && e.allocations.length > 0 && e.allocations.length <= 100); orderedIds(e.allocations.map(a => a.allocation_id));
  for (const a of e.allocations) { keys(a, "allocation_id lot_id quantity"); require(uuid(a.lot_id) && quantity(a.quantity) > 0n); }
  orderedIds(e.correction_ids); require(e.correction_ids.length <= 100 && (e.action === "resolve_corrected" ? e.correction_ids.length > 0 : e.correction_ids.length === 0));
}

/** Staff transport shape plus internally complete discrepancy chain; no print-specific history cap. */
export function validateDiscrepancyStateShape(v: ReturnDiscrepancyState, expectedTarget: CorrectionTarget): void {
  keys(v, "version head open_case_count held_lot_ids cases"); target(expectedTarget); validateCorrectionHead(v.head);
  require(v.version === 1 && integer(v.open_case_count) && Array.isArray(v.cases)); orderedIds(v.held_lot_ids);
  const caseIds = new Set<string>(), eventIds = new Set<string>(), holds = new Set<string>();
  const events: ReturnDiscrepancyEvent[] = []; let open = 0;
  for (const c of v.cases) {
    keys(c, "id source allocations status report decisions"); source(c.source);
    require(uuid(c.id) && !caseIds.has(c.id) && Array.isArray(c.decisions)); caseIds.add(c.id);
    validateDiscrepancyEventShape(c.report, expectedTarget);
    require(c.report.action === "report" && c.report.id === c.id && c.report.case_id === c.id && same(c.source, c.report.source) && same(c.allocations, c.report.allocations));
    let prior = c.report, status = "open";
    for (const e of c.decisions) {
      validateDiscrepancyEventShape(e, expectedTarget);
      require(e.case_id === c.id && e.action !== "report" && same(e.source, c.source) && same(e.allocations, c.allocations) && e.sequence > prior.sequence && instant(e.created_at) >= instant(prior.created_at) && status === "open");
      if (e.action === "resolve_corrected") status = "resolved_corrected";
      if (e.action === "resolve_confirmed_original") status = "resolved_confirmed_original";
      prior = e;
    }
    require(c.status === status);
    if (status === "open") { open++; for (const a of c.allocations) holds.add(a.lot_id); }
    events.push(c.report, ...c.decisions);
  }
  events.sort((a, b) => a.sequence - b.sequence);
  let prior: ReturnDiscrepancyEvent | undefined;
  for (const e of events) {
    require(!eventIds.has(e.id) && e.sequence === eventIds.size + 1 && e.prior_event_id === (prior?.id ?? null) && e.prior_record_hash === (prior?.record_hash ?? null) && (!prior || (instant(e.created_at) >= instant(prior.created_at) && e.return_head.version >= prior.return_head.version)));
    eventIds.add(e.id); prior = e;
  }
  require(v.head.version === events.length && v.head.event_id === (prior?.id ?? null) && v.head.record_hash === (prior?.record_hash ?? null) && v.open_case_count === open && same(v.held_lot_ids, [...holds].sort()));
}

export function validateReconciliationSummary(v: ReconciliationSummary): void {
  keys(v, "version event_count discrepancy_event_count open_case_count affected_dispense_count heads_hash");
  require(v.version === 2 && integer(v.event_count) && integer(v.discrepancy_event_count) && integer(v.open_case_count) && integer(v.affected_dispense_count) && hash(v.heads_hash));
  require(v.event_count + v.discrepancy_event_count > 0 || v.heads_hash === "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945");
  require(v.open_case_count <= v.discrepancy_event_count && v.affected_dispense_count <= v.event_count + v.discrepancy_event_count && ((v.event_count + v.discrepancy_event_count === 0) === (v.affected_dispense_count === 0)));
}

export function validateReconciliationDisclosure(v: ReconciliationDisclosure, expectedTarget: CorrectionTarget, authorizationHash: string, fill: NativeDispenseDetails, pickup: CorrectionPickupIdentity | null, observedAt?: string): void {
  keys(v, "version head events allocations replay discrepancies"); target(expectedTarget); validateCorrectionHead(v.head);
  require(v.version === 2 && hash(authorizationHash) && fill.id === expectedTarget.dispense_id && fill.authorization_id === expectedTarget.authorization_id && fill.authorization_hash === authorizationHash && Array.isArray(v.events) && v.events.length === v.head.version && v.events.length <= 100);
  require(Array.isArray(v.allocations) && v.allocations.length === fill.lots.length); orderedIds(v.allocations.map(a => a.allocation_id));
  const lots = new Set<string>();
  for (const a of v.allocations) {
    validateReturnBalance(a); const lot = fill.lots.find(l => l.id === a.lot_id);
    require(lot && !lots.has(a.lot_id) && lot.number === a.lot_number && lot.expires_on === a.expires_on && quantity(`${lot.quantity.split(".")[0]}.${(lot.quantity.split(".")[1] ?? "").padEnd(3, "0")}`) === quantity(a.dispensed_quantity)); lots.add(a.lot_id);
  }
  const events = new Map<string, ReturnEvent | ReconciliationEvent>(), movements = new Set<string>(); let prior: ReturnEvent | ReconciliationEvent | undefined;
  for (const e of v.events) {
    validateReconciliationEventShape(e);
    require(!events.has(e.id) && same(e.target, expectedTarget) && e.authorization_hash === authorizationHash && e.sequence === events.size + 1 && e.prior_event_id === (prior?.id ?? null) && e.prior_record_hash === (prior?.record_hash ?? null) && (!prior || e.dispense_document_hash === prior.dispense_document_hash));
    require(instant(e.created_at) >= instant(fill.dispensed_at) && (!prior || instant(e.created_at) >= instant(prior.created_at)) && (observedAt === undefined || instant(e.created_at) <= instant(observedAt)));
    if (e.action === "restock") { const intake = events.get(e.intake_id!); require(intake?.action === "intake" && intake.custody === "clinic_retained" && intake.package_condition === "sealed_intact" && intake.storage_history === "controlled" && pickup === null); }
    if (e.version === 2 && e.correction_target) { const original = events.get(e.correction_target.event_id); require(original && original.record_hash === e.correction_target.record_hash); }
    for (const a of e.allocations) if (a.movement_id !== null) { require(!movements.has(a.movement_id)); movements.add(a.movement_id); }
    events.set(e.id, e); prior = e;
  }
  require(v.head.event_id === (prior?.id ?? null) && v.head.record_hash === (prior?.record_hash ?? null));
  const replay = replayNativeReturnQuantities(v.allocations.map(a => ({ allocation_id: a.allocation_id, lot_id: a.lot_id, quantity: a.dispensed_quantity })), v.events.map(e => ({ id: e.id, sequence: e.sequence, action: e.action, intake_id: e.intake_id, correction_target_id: e.version === 2 ? e.correction_target?.event_id ?? null : null, allocations: e.allocations.map(a => ({ allocation_id: a.allocation_id, lot_id: a.lot_id, quantity: a.quantity })) })));
  validateReconciliationReplayShape(v.replay); require(same(replay, v.replay) && same(replay.allocations, v.allocations.map(({ lot_number: _number, expires_on: _expiry, ...a }) => a)));
  validateDiscrepancyStateShape(v.discrepancies, expectedTarget); require(v.discrepancies.head.version <= 100);
  for (const c of v.discrepancies.cases) {
    const original = events.get(c.source.event_id); require(original && original.record_hash === c.source.record_hash && ["intake", "dispose", "restock"].includes(original.action));
    for (const a of c.allocations) { const sourceAllocation = original.allocations.find(x => x.allocation_id === a.allocation_id); require(sourceAllocation && sourceAllocation.lot_id === a.lot_id && quantity(a.quantity) <= quantity(sourceAllocation.quantity)); }
    const linked = v.events.filter((e): e is ReconciliationEvent => e.version === 2 && e.discrepancy_id === c.id);
    const cumulative = new Map<string, bigint>();
    const resolution = c.decisions.find(d => d.action.startsWith("resolve_"));
    for (const e of linked) {
      require(same(e.correction_target, c.source) && e.sequence > c.report.return_head.version && instant(e.created_at) >= instant(c.report.created_at));
      require(!resolution || (resolution.action === "resolve_corrected" && e.sequence <= resolution.return_head.version));
      for (const a of e.allocations) {
        const reported = c.allocations.find(r => r.allocation_id === a.allocation_id);
        const total = (cumulative.get(a.allocation_id) ?? 0n) + quantity(a.quantity);
        require(reported && reported.lot_id === a.lot_id && total <= quantity(reported.quantity));
        cumulative.set(a.allocation_id, total);
      }
    }
    for (const d of [c.report, ...c.decisions]) {
      const atHead = v.events[d.return_head.version - 1]; require(atHead && atHead.id === d.return_head.event_id && atHead.record_hash === d.return_head.record_hash && original.sequence <= d.return_head.version && instant(d.created_at) >= instant(atHead.created_at) && (observedAt === undefined || instant(d.created_at) <= instant(observedAt)));
      if (d.action === "resolve_corrected") {
        require(same(d.correction_ids, linked.map(e => e.id).sort()));
        const sums = new Map<string, bigint>();
        for (const id of d.correction_ids) { const e = events.get(id); require(e?.version === 2 && e.discrepancy_id === c.id && e.correction_target !== null && same(e.correction_target, c.source) && e.sequence <= d.return_head.version); for (const a of e.allocations) sums.set(a.allocation_id, (sums.get(a.allocation_id) ?? 0n) + quantity(a.quantity)); }
        require(sums.size === c.allocations.length && c.allocations.every(a => sums.get(a.allocation_id) === quantity(a.quantity)));
      }
    }
  }
  for (const e of v.events) if (e.version === 2 && e.discrepancy_id !== null) { const c = v.discrepancies.cases.find(c => c.id === e.discrepancy_id); require(c && same(c.source, e.correction_target) && instant(c.report.created_at) <= instant(e.created_at)); }
}

const escape = (v: unknown) => String(v ?? "Not recorded").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const field = (label: string, v: unknown) => `<div><dt>${escape(label)}</dt><dd>${escape(v)}</dd></div>`;
export function renderReconciliationSummary(v: ReconciliationSummary): string {
  validateReconciliationSummary(v);
  return `<section><h3>Return reconciliation when reviewed</h3><p>${v.event_count} quantity event(s); ${v.discrepancy_event_count} discrepancy decision(s); ${v.open_case_count} unresolved case(s) across ${v.affected_dispense_count} dispensing record(s).</p></section>`;
}
/** Call only after complete source-bound disclosure validation. */
export function renderReconciliationDisclosure(v: ReconciliationDisclosure, unit: string): string {
  const names = { intake: "Received into held custody", dispose: "Disposal recorded", restock: "Returned to available stock", retract_intake: "Incorrect intake quantity retracted", retract_disposal: "Incorrect disposal quantity retracted", retract_restock: "Incorrect restock quantity compensated" };
  const history = v.allocations.map(a => {
    const h = v.replay.historical.find(row => row.allocation_id === a.allocation_id)!;
    return `<section><h4>Lot ${escape(a.lot_number)}</h4><dl>${field("Effective returned quantity", `${a.returned_quantity} ${unit}`)}${field("Currently held", `${a.held_quantity} ${unit}`)}${field("Disposed", `${a.disposed_quantity} ${unit}`)}${field("Restocked", `${a.restocked_quantity} ${unit}`)}${field("Total recorded intake / retracted", `${h.gross_intake_quantity} / ${h.retracted_intake_quantity} ${unit}`)}${field("Total recorded disposal / retracted", `${h.gross_disposed_quantity} / ${h.retracted_disposed_quantity} ${unit}`)}${field("Total recorded restock / retracted", `${h.gross_restocked_quantity} / ${h.retracted_restocked_quantity} ${unit}`)}</dl></section>`;
  }).join("");
  const entries = v.events.map(e => `<section><h4>${e.sequence}. ${escape(names[e.action])}</h4><dl>${field("Event reference", e.id)}${field("Recorded by", e.actor.name)}${field("Recorded at", e.created_at)}${field("Reason", e.reason)}${field("Note", e.note)}${e.action === "intake" ? field("Custody", e.custody) + field("Package condition", e.package_condition) + field("Storage history", e.storage_history) : ""}${e.version === 2 && e.correction_target ? field("Corrected event", e.correction_target.event_id) : ""}${e.version === 2 && e.discrepancy_id ? field("Discrepancy reference", e.discrepancy_id) : ""}</dl>${e.allocations.map(a => `<p>${escape(v.allocations.find(b => b.allocation_id === a.allocation_id)!.lot_number)}: ${escape(a.quantity)} ${escape(unit)}</p>`).join("")}</section>`).join("");
  const cases = v.discrepancies.cases.map(c => `<section><h4>Discrepancy: ${escape(c.status.replace(/_/g, " "))}</h4><dl>${field("Case reference", c.id)}${field("Source event", c.source.event_id)}</dl>${c.allocations.map(a => `<p>${escape(v.allocations.find(b => b.allocation_id === a.allocation_id)!.lot_number)}: ${escape(a.quantity)} ${escape(unit)}</p>`).join("")}${[c.report, ...c.decisions].map(d => `<dl>${field("Decision", d.action.replace(/_/g, " "))}${field("Recorded by", d.actor.name)}${field("Recorded at", d.created_at)}${field("Observation", d.observation)}</dl>`).join("")}</section>`).join("");
  return `<section><h3>Physical returns and reconciliation</h3><p>Original dispensing, prescription allowance and financial history remain unchanged. Held medication is not available stock.</p>${v.discrepancies.open_case_count ? "<p>Unresolved discrepancies require inventory review; the affected lots are held from available-stock use.</p>" : ""}${history}${entries}${cases}</section>`;
}
export function renderNativePrescriptionV4(v: NativePrescriptionPrintV4): string {
  keys(v, "version prescription status dispense correction_summary dispense_corrections original_pickup return_summary dispense_returns"); require(v.version === 4);
  const { return_summary: summary, dispense_returns: disclosure, ...base } = v;
  const html = renderNativePrescriptionV2({ ...base, version: 2 }); validateReconciliationSummary(summary);
  if (v.dispense === null) require(disclosure === null);
  else {
    require(disclosure !== null); validateReconciliationDisclosure(disclosure, { authorization_id: v.prescription.authorization_id, pet_id: v.prescription.patient.id, dispense_id: v.dispense.id }, v.prescription.authorization_hash, v.dispense, v.original_pickup, v.status.checked_at);
    require(disclosure.events.length <= summary.event_count && disclosure.discrepancies.head.version <= summary.discrepancy_event_count && disclosure.discrepancies.open_case_count <= summary.open_case_count && (!disclosure.events.length && !disclosure.discrepancies.head.version || summary.affected_dispense_count > 0));
  }
  return html.replace("<footer>", `${renderReconciliationSummary(summary)}${disclosure ? renderReconciliationDisclosure(disclosure, v.prescription.unit) : ""}<footer>`).replace("Native prescription print format 2", "Native prescription print format 4");
}
