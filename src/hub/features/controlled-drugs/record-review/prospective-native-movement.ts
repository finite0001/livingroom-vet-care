import { ExactJsonNumber, type ExactJson } from "./exact-json.ts";
import { reviewContextQuantity, reviewInstantMicroseconds, reviewQuantityThousandths, reviewSnapshotTotalThousandths } from "./exact-values.ts";
import { sameReviewJsonb as same } from "./jsonb-equality.ts";
import { hashReviewClinicalAlertSnapshot, hashReviewNativeArtifact, hashReviewNativeContext, hashReviewNativeDocument, hashReviewNativeRecord, hashReviewNativeRequest, hashReviewNativeFulfillmentReceipt } from "./component-hashes.ts";
import { verifyProspectiveComponentConsistency } from "./prospective-component-consistency.ts";
import { nativeArray as arr, nativeObject as obj, nativeInvalid as invalid, nativeInteger as integer, nativeQuantity as quantity,
  nativeEventKinds, nativeHeadSchema, nativeRequestSchemas, nativeDocumentSchemas, nativeContextSchemas, nativeC0ContextSchema, nativeFrozenSchema,
  snapshotNativeEvidence, nativeText, nativeSlotSchema, nativeRefillContextSchema, nativeFulfillmentRefillEventSchema, nativeOpeningEntrySchema, type NativeDocumentKind, type NativeWriter, type NativeObject } from "./native-movement-structure.ts";
import { reviewJsonbTextBytes, type PreparedReviewPacket } from "./prepared-packet.ts";
import type { ReviewEvidenceTarget } from "./request.ts";

const number = (value: bigint) => new ExactJsonNumber(value.toString());
const roles = ["reviewed_target", "correction_target", "case_report", "ordinary_source", "original_intake", "original_pickup", "amendment_predecessor", "original_dispense", "resolution_correction", "opening_basis", "retained_context"] as const;
type Role = typeof roles[number];
const nativeRelations = { dispense: "public.native_dispenses", pickup: "public.native_pickups", return: "public.native_return_events", correction: "public.native_dispense_correction_events", discrepancy: "public.native_return_discrepancy_events" } as const;
const opRelations = { dispense: "public.native_fulfillment_operations", pickup: "public.native_fulfillment_operations", return: "public.native_return_operations", correction: "public.native_dispense_correction_operations", discrepancy: "public.native_return_discrepancy_operations" } as const;
const provenanceRelations = { pickup: "public.stock_pickup_sources", return: "public.stock_custody_sources", correction: "public.stock_correction_sources", discrepancy: "public.stock_discrepancy_sources" } as const;
type Kind = keyof typeof nativeRelations;
function str(value: ExactJson): string { if (typeof value !== "string") invalid(); return value; }
function numeric(value: ExactJson): bigint { if (!(value instanceof ExactJsonNumber)) invalid(); return reviewQuantityThousandths(value); }
function count(value: ExactJson, maximum = 9223372036854775807n): bigint {
  if (!(value instanceof ExactJsonNumber) || !/^(0|[1-9][0-9]{0,18})$/.test(value.token) || BigInt(value.token) > maximum) invalid();
  return BigInt(value.token);
}
function stamp(value: ExactJson): bigint { return reviewInstantMicroseconds(str(value)); }
function stored(value: bigint): string { return (value < 0n ? "-" : "") + (value < 0n ? -value : value) / 1000n + "." + ((value < 0n ? -value : value) % 1000n).toString().padStart(3, "0"); }
function aggregateQuantity(value: ExactJson, maximum: bigint): bigint {
  const text = str(value);
  if (!/^(0|[1-9][0-9]{0,20})\.[0-9]{3}$/.test(text)) invalid();
  const q = reviewSnapshotTotalThousandths(text); if (q < 0n || q > maximum) invalid(); return q;
}
function keys(value: NativeObject, names: readonly string[]) { if (Object.keys(value).length !== names.length || names.some(k => !Object.prototype.hasOwnProperty.call(value, k))) invalid(); }
function sameTarget(a: NativeObject, b: NativeObject) { if (a.authorization_id !== b.authorization_id || a.pet_id !== b.pet_id || a.dispense_id !== b.dispense_id) invalid(); }
function uuidValue(value: ExactJson): string { return str(value).toLowerCase(); }
function canonicalId(value: ExactJson): string {
  const id = str(value);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id) || id === "00000000-0000-0000-0000-000000000000") invalid();
  return id;
}
function kindOf(row: NativeObject, kind: Kind): NativeDocumentKind { return kind === "return" ? integer(obj(row.document).version, 1n, 2n) === 1n ? "return_v1" : "return_v2" : kind; }
function writerOf(row: NativeObject, kind: Kind): NativeWriter {
  switch (kind) {
    case "dispense": return "record_native_dispense";
    case "pickup": return "record_native_pickup";
    case "return": return kindOf(row, kind) === "return_v1" ? "record_native_dispense_return" : "record_native_dispense_return_v2";
    case "correction": return "append_native_dispense_correction";
    case "discrepancy": return "record_native_return_discrepancy";
  }
}
function denverDate(value: ExactJson): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", era: "short", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(str(value)));
  const part = (name: string) => parts.find(p => p.type === name)?.value ?? invalid();
  if (part("era") !== "AD") invalid(); return part("year").padStart(4, "0") + "-" + part("month") + "-" + part("day");
}
interface Source { relation: string; row: NativeObject; role: Role }
interface ExpectedEffect { lot_id: ExactJson; channel: string; dispense_id: ExactJson; intake_id: ExactJson; q: bigint }
interface NativeResult { row: NativeObject; operation: NativeObject; document: NativeObject; context: NativeObject; kind: NativeDocumentKind; writer: NativeWriter }

// Literal extraction origins only: this is supplied immutable-fact consistency,
// not a generic field walker, PK lookup or completeness/authorization claim.
const visibleHeadStreams = {
  "return.row+document": "return", "return.context.head": "return",
  "discrepancy.context.return_head+document.return_head": "return", "opening.entry.return_head": "return",
  "correction.row+document": "correction", "correction.context.head": "correction",
  "correction.context.latest_pickup_amendment": "correction", "return.context.correction_head": "correction", "opening.entry.correction_head": "correction",
  "discrepancy.row+document": "discrepancy", "return.context.discrepancy_head": "discrepancy", "discrepancy.context.discrepancy_head": "discrepancy",
  "return.context.discrepancies.head": "discrepancy", "discrepancy.context.discrepancies.head": "discrepancy",
  "snapshot.cases[*].report": "discrepancy", "snapshot.cases[*].decisions[*]": "discrepancy", "opening.entry.discrepancy_head": "discrepancy",
  "dispense.context.refill.head_id+refill.version": "refill", "dispense.result.refill_event.id+revision+before+after": "refill",
  "pickup.context.refill.head_id+refill.version": "refill", "dispense.refill_event.prior_event_id+before.version": "refill",
  "pickup.document.refill_event_id (fresh identity only)": "refill",
  "dispense.context.authorization.head_id+head_version": "authorization", "pickup.context.authorization.head_id+head_version": "authorization",
  "dispense.context.usage.fulfillment_head": "fulfillment", "dispense.document.id (fresh identity only; no supplied version)": "fulfillment",
} as const;
type VisibleHeadOrigin = keyof typeof visibleHeadStreams;
interface VisibleHeadDetails { hash?: ExactJson; payload?: NativeObject; kind?: ExactJson; amendment?: ExactJson; refill?: NativeObject }
interface VisibleHeadFact extends VisibleHeadDetails { owner: string; id: string; version?: bigint }
class NativeVisibleHeads {
  private readonly ids = new Map<string, VisibleHeadFact>();
  private readonly revisions = new Map<string, VisibleHeadFact>();
  record(origin: VisibleHeadOrigin, ownerValue: ExactJson, idValue: ExactJson, version: bigint | undefined, details: VisibleHeadDetails = {}): void {
    const stream = visibleHeadStreams[origin], owner = canonicalId(ownerValue);
    if (idValue === null) { if (version !== 0n || details.hash !== undefined && details.hash !== null) invalid(); return; }
    if (version !== undefined && version <= 0n) invalid();
    const id = canonicalId(idValue), idKey = stream + "/" + id;
    const prior = this.ids.get(idKey);
    if (prior && (prior.owner !== owner || prior.version !== undefined && version !== undefined && prior.version !== version)) invalid();
    if (details.hash !== undefined && (typeof details.hash !== "string" || !/^[a-f0-9]{64}$/.test(details.hash))) invalid();
    const fact = prior ?? { owner, id, version };
    for (const field of ["hash", "payload", "kind", "amendment", "refill"] as const) {
      if (fact[field] !== undefined && details[field] !== undefined && !same(fact[field] as ExactJson, details[field] as ExactJson)) invalid();
    }
    if (version !== undefined) {
      const revisionKey = stream + "/" + owner + "/" + version, existing = this.revisions.get(revisionKey);
      if (existing && existing.id !== id) invalid();
      fact.version = version; this.revisions.set(revisionKey, fact);
    }
    Object.assign(fact, Object.fromEntries(Object.entries(details).filter(([, value]) => value !== undefined))); this.ids.set(idKey, fact);
  }
  head(origin: VisibleHeadOrigin, owner: ExactJson, value: ExactJson): void {
    const h = obj(value); nativeHeadSchema.parse(h);
    this.record(origin, owner, h.event_id, integer(h.version), { hash: h.record_hash });
  }
}

/** LOCAL supplied native-document, direct-graph and physical-line consistency.
 * The admitted immutable backend/source, exact authenticated transport, H0/W,
 * omitted authorization/refill/policy/prefix membership and global historical
 * selection remain independent composition prerequisites. No P hash, mutation,
 * Auth attestation, route or permissive admission callback is supplied here.
 */
export async function verifyProspectiveNativeMovement(packetInput: PreparedReviewPacket, targetInput: Readonly<ReviewEvidenceTarget>): Promise<void> {
  try {
    const packet = snapshotNativeEvidence(packetInput) as unknown as PreparedReviewPacket;
    const target = snapshotNativeEvidence(targetInput) as unknown as Readonly<ReviewEvidenceTarget>;
    if (!Object.prototype.hasOwnProperty.call(nativeEventKinds, packet.adapter.event_kind)) invalid();
    await verifyProspectiveComponentConsistency(packet, target);
    const graph = new NativeGraph(packet);
    graph.collect();
    await graph.validate();
  } catch { throw new Error("Native review evidence is inconsistent or outside the supported local scope"); }
}
class NativeGraph {
  private readonly sources: Source[];
  private readonly expected = new Map<Source, Role>();
  private readonly visits = new Set<string>();
  private readonly validated = new Map<string, Promise<NativeResult>>();
  private readonly visible = new NativeVisibleHeads();
  private readonly packet: PreparedReviewPacket;
  constructor(packet: PreparedReviewPacket) {
    this.packet = packet;
    this.sources = packet.source_rows.map((source, i) => ({ relation: source.relation, row: obj(source.row), role: packet.adapter.source_refs[i].role as Role }));
    if (this.sources.length > 512 || this.sources.filter(s => Object.values(nativeRelations).includes(s.relation as never)).length > 100 || this.list("public.native_dispense_allocations").length > 100) invalid();
  }
  private list(relation: string, field?: string, value?: ExactJson): NativeObject[] {
    return this.sources.filter(s => s.relation === relation && (field === undefined || s.row[field] === value)).map(s => s.row);
  }
  private optional(relation: string, id: ExactJson, field = "id"): NativeObject | null {
    const rows = this.list(relation, field, id); if (rows.length > 1) invalid(); return rows[0] ?? null;
  }
  private need(relation: string, id: ExactJson, field = "id"): NativeObject { return this.optional(relation, id, field) ?? invalid(); }
  private mark(relation: string, row: NativeObject, role: Role): void {
    const source = this.sources.find(s => s.relation === relation && s.row === row) ?? invalid();
    const prior = this.expected.get(source);
    if (!prior || roles.indexOf(role) < roles.indexOf(prior)) this.expected.set(source, role);
  }
  private add(relation: string, id: ExactJson, role: Role, field = "id"): NativeObject {
    const row = this.need(relation, id, field); this.mark(relation, row, role); return row;
  }
  private parent(id: ExactJson, role: Role): void {
    const event = this.add("public.controlled_stock_events", id, role);
    if (event.product_id !== this.packet.event.product_id || event.opening_id !== this.packet.event.opening_id) invalid();
    this.add("public.controlled_stock_actions", id, role); this.add("public.controlled_stock_preparations", id, role);
    this.add("public.controlled_stock_policy_versions", event.policy_version_id, role); this.add("public.controlled_stock_openings", event.opening_id, role);
    for (const relation of ["public.controlled_stock_source_links", "public.controlled_stock_event_lines", "public.controlled_stock_container_transitions"]) {
      for (const row of this.list(relation, "event_id", id)) {
        this.mark(relation, row, role);
        if (relation === "public.controlled_stock_event_lines") {
          const cell = this.add("public.controlled_stock_cells", row.cell_id, role); this.add("public.controlled_stock_containers", cell.container_id, role);
        } else if (relation === "public.controlled_stock_container_transitions") this.add("public.controlled_stock_containers", row.container_id, role);
      }
    }
  }
  private movement(id: ExactJson, sourceId: ExactJson, writer: NativeWriter, actor: ExactJson, role: Role, managed: boolean, contextOnly = false): void {
    const m = this.add("public.inventory_movements", id, role), lot = this.add("public.inventory_lots", m.lot_id, role);
    if (lot.product_id !== this.packet.event.product_id || m.created_by !== actor) invalid();
    const provenance = this.optional("public.stock_movement_sources", id, "movement_id");
    if (provenance) {
      if (provenance.writer !== writer || provenance.source_id !== sourceId || provenance.actor_id !== actor) invalid();
      this.mark("public.stock_movement_sources", provenance, role);
    } else if (managed) invalid();
    const boundary = this.optional("public.controlled_stock_opening_movements", id, "movement_id");
    const links = this.list("public.controlled_stock_source_links", "movement_id", id);
    if (managed) { if (boundary || links.length !== 1 || links[0].event_id !== sourceId) invalid(); }
    else if (boundary) {
      if (boundary.opening_id !== this.packet.event.opening_id || boundary.lot_id !== m.lot_id || !same(boundary.quantity, m.quantity) || !same(boundary.source_snapshot, m) || links.length) invalid();
      this.mark("public.controlled_stock_opening_movements", boundary, "opening_basis");
    } else if (!contextOnly || !provenance) invalid();
  }
  private native(kind: Kind, id: ExactJson, role: Role, depth: number): void {
    if (depth > 4) invalid();
    const row = this.add(nativeRelations[kind], id, role), op = this.add(opRelations[kind], id, role);
    if (op.actor_id !== row.actor_id) invalid();
    const parent = this.optional("public.controlled_stock_events", id);
    if (parent && (kind === "dispense" || kind === "pickup" || kind === "return" && ["reviewed_target", "correction_target", "ordinary_source"].includes(role))) this.parent(id, role);
    if (kind !== "dispense") {
      const provenance = this.optional(provenanceRelations[kind], id, "event_id");
      if (provenance) {
        if (provenance.actor_id !== row.actor_id || kind === "return" && provenance.writer !== writerOf(row, kind)) invalid();
        this.mark(provenanceRelations[kind], provenance, role);
      } else if (parent) invalid();
    }
    // Revisit with a higher-priority role to reproduce adapter_add promotion.
    const visit = kind + ":" + str(id) + ":" + role;
    if (this.visits.has(visit)) return; this.visits.add(visit);
    if (kind === "dispense") {
      this.add("public.billing_invoice_items", row.invoice_item_id, role);
      const allocations = this.list("public.native_dispense_allocations", "dispense_id", id);
      if (!allocations.length || allocations.length > 100) invalid();
      for (const a of allocations) { this.mark("public.native_dispense_allocations", a, role); this.movement(a.movement_id, id, "record_native_dispense", row.actor_id, role, parent !== null); }
    } else if (kind === "pickup") this.native("dispense", row.dispense_id, "original_dispense", depth + 1);
    else if (kind === "return") {
      this.native("dispense", row.dispense_id, "original_dispense", depth + 1);
      if (row.intake_id !== null) this.native("return", row.intake_id, "original_intake", depth + 1);
      const doc = obj(row.document), action = str(row.action), writer = writerOf(row, kind);
      if (action.startsWith("retract_")) this.native("return", obj(doc.correction_target).event_id, "correction_target", depth + 1);
      if (action === "restock" || action === "retract_restock") {
        const relation = action === "restock" ? "public.native_return_stock_links" : "public.native_return_compensation_links";
        for (const link of this.list(relation, "event_id", id)) {
          this.mark(relation, link, role);
          if (action === "retract_restock") {
            const original = this.list("public.native_return_stock_links", "event_id", link.target_event_id).filter(x => x.allocation_id === link.allocation_id);
            if (original.length !== 1) invalid(); this.mark("public.native_return_stock_links", original[0], "correction_target");
          }
          this.movement(link.movement_id, id, writer, row.actor_id, role, parent !== null, ["original_intake", "resolution_correction"].includes(role));
        }
      }
    }
  }
  collect(): void {
    const event = this.packet.event; this.parent(event.id, "reviewed_target");
    if (event.writer === "record_native_dispense") this.native("dispense", event.id, "reviewed_target", 0);
    else if (event.writer === "record_native_pickup") this.native("pickup", event.id, "reviewed_target", 0);
    else if (event.writer === "record_native_dispense_return" || event.writer === "record_native_dispense_return_v2") this.native("return", event.id, "reviewed_target", 0);
    else if (event.writer === "append_native_dispense_correction") {
      const row = this.add(nativeRelations.correction, event.id, "reviewed_target"), doc = obj(row.document);
      this.native("correction", row.id, "reviewed_target", 0);
      if (doc.amends_event_id !== null) this.native("correction", doc.amends_event_id, "amendment_predecessor", 0);
      this.native("dispense", row.dispense_id, "original_dispense", 1);
      if (row.kind === "pickup_amendment") this.native("pickup", obj(doc.pickup_amendment).original_pickup_id, "original_pickup", 1);
    } else if (event.writer === "record_native_return_discrepancy") {
      const row = this.add(nativeRelations.discrepancy, event.id, "reviewed_target"), doc = obj(row.document);
      this.native("discrepancy", row.id, "reviewed_target", 0);
      if (row.case_id !== row.id) this.native("discrepancy", row.case_id, "case_report", 0);
      this.native("return", obj(doc.source).event_id, "ordinary_source", 1);
      for (const id of arr(doc.correction_ids)) {
        const links = this.list("public.native_return_discrepancy_correction_links", "correction_id", id);
        if (links.length !== 1 || links[0].case_id !== row.case_id || links[0].resolution_id !== row.id) invalid();
        this.mark("public.native_return_discrepancy_correction_links", links[0], "reviewed_target");
        this.native("return", id, "resolution_correction", 1);
      }
    } else invalid();
    if (event.writer === "append_native_dispense_correction") {
      const correction = this.need(nativeRelations.correction, event.id);
      if (["clinical_annotation", "operational_annotation"].includes(str(correction.kind)) && !this.optional("public.controlled_stock_events", correction.dispense_id)) {
        for (const cell of this.list("public.controlled_stock_cells").filter(c => c.opening_id === event.opening_id && c.dispense_id === correction.dispense_id && c.channel === "prepared")) {
          this.mark("public.controlled_stock_cells", cell, "opening_basis"); this.add("public.controlled_stock_containers", cell.container_id, "opening_basis");
        }
      }
    }
    if (this.expected.size !== this.sources.length || this.sources.some(s => this.expected.get(s) !== s.role)) invalid();
  }
  private async document(kind: Kind, row: NativeObject): Promise<NativeResult> {
    const key = kind + ":" + str(row.id), prior = this.validated.get(key);
    if (prior) return prior;
    const result = this.validateDocument(kind, row); this.validated.set(key, result); return result;
  }
  private visibleDiscrepancies(owner: ExactJson, input: ExactJson, fromReturn: boolean): void {
    const snapshot = obj(input);
    if (fromReturn) this.visible.head("return.context.discrepancies.head", owner, snapshot.head);
    else this.visible.head("discrepancy.context.discrepancies.head", owner, snapshot.head);
    for (const c of arr(snapshot.cases).map(obj)) {
      const report = obj(c.report);
      this.visible.record("snapshot.cases[*].report", owner, report.id, integer(report.sequence, 1n), { hash: report.record_hash, payload: report });
      for (const decision of arr(c.decisions).map(obj)) this.visible.record("snapshot.cases[*].decisions[*]", owner, decision.id, integer(decision.sequence, 1n), { hash: decision.record_hash, payload: decision });
    }
  }
  private visibleFacts(): void {
    // All these source rows/documents have completed document() validation.
    // Only the listed literal schemas supply facts, never arbitrary JSON keys.
    for (const row of this.list(nativeRelations.return)) {
      const doc = obj(row.document), c = obj(row.reviewed_context);
      this.visible.record("return.row+document", row.dispense_id, row.id, integer(row.sequence, 1n), { hash: row.record_hash, payload: doc });
      this.visible.head("return.context.head", row.dispense_id, c.head);
      this.visible.head("return.context.correction_head", row.dispense_id, c.correction_head);
      if (integer(doc.version, 1n, 2n) === 2n) {
        this.visible.head("return.context.discrepancy_head", row.dispense_id, c.discrepancy_head);
        this.visibleDiscrepancies(row.dispense_id, c.discrepancies, true);
      }
    }
    for (const row of this.list(nativeRelations.correction)) {
      const doc = obj(row.document), c = obj(row.reviewed_context);
      this.visible.record("correction.row+document", row.dispense_id, row.id, integer(row.sequence, 1n), { hash: row.record_hash, payload: doc, kind: row.kind, amendment: doc.pickup_amendment });
      this.visible.head("correction.context.head", row.dispense_id, c.head);
      if (c.latest_pickup_amendment !== null) {
        const latest = obj(c.latest_pickup_amendment);
        if (integer(latest.version, 1n) > integer(obj(c.head).version)) invalid();
        this.visible.record("correction.context.latest_pickup_amendment", row.dispense_id, latest.event_id, integer(latest.version, 1n), { kind: "pickup_amendment", amendment: latest.value });
      }
    }
    for (const row of this.list(nativeRelations.discrepancy)) {
      const doc = obj(row.document), c = obj(row.reviewed_context);
      this.visible.record("discrepancy.row+document", row.dispense_id, row.id, integer(row.sequence, 1n), { hash: row.record_hash, payload: doc });
      this.visible.head("discrepancy.context.return_head+document.return_head", row.dispense_id, c.return_head);
      this.visible.head("discrepancy.context.return_head+document.return_head", row.dispense_id, doc.return_head);
      this.visible.head("discrepancy.context.discrepancy_head", row.dispense_id, c.discrepancy_head);
      this.visibleDiscrepancies(row.dispense_id, c.discrepancies, false);
    }
    for (const row of this.list(nativeRelations.dispense)) {
      const doc = obj(row.document), c = obj(doc.reviewed_context), authorization = obj(c.authorization), usage = obj(obj(c.usage).fulfillment_head);
      this.visible.record("dispense.context.authorization.head_id+head_version", row.authorization_id, authorization.head_id, integer(authorization.head_version));
      this.visible.record("dispense.context.usage.fulfillment_head", row.authorization_id, usage.event_id, integer(usage.version));
      // Freshness is relative to this append's proven prior observation, not
      // every later snapshot that can legitimately name this new event.
      if (doc.id === usage.event_id) invalid();
      this.visible.record("dispense.document.id (fresh identity only; no supplied version)", row.authorization_id, doc.id, undefined);
      if (c.refill !== null) {
        const before = obj(obj(c.refill).refill), event = obj(obj(this.need(opRelations.dispense, row.id).result).refill_event);
        this.visible.record("dispense.context.refill.head_id+refill.version", before.id, obj(c.refill).head_id, integer(before.version, 1n), { refill: before });
        this.visible.record("dispense.refill_event.prior_event_id+before.version", event.refill_id, event.prior_event_id, integer(obj(event.before).version, 1n), { refill: obj(event.before) });
        this.visible.record("dispense.result.refill_event.id+revision+before+after", event.refill_id, event.id, integer(event.revision, 1n), { payload: event, refill: obj(event.after) });
      }
    }
    for (const row of this.list(nativeRelations.pickup)) {
      const doc = obj(row.document), c = obj(doc.reviewed_context), authorization = obj(c.authorization);
      this.visible.record("pickup.context.authorization.head_id+head_version", row.authorization_id, authorization.head_id, integer(authorization.head_version));
      if (c.refill !== null) {
        const before = obj(obj(c.refill).refill), original = obj(obj(this.need(opRelations.dispense, row.dispense_id).result).refill_event);
        this.visible.record("pickup.context.refill.head_id+refill.version", before.id, obj(c.refill).head_id, integer(before.version, 1n), { refill: before });
        if ([obj(c.refill).head_id, original.id, original.prior_event_id].includes(doc.refill_event_id)) invalid();
        this.visible.record("pickup.document.refill_event_id (fresh identity only)", before.id, doc.refill_event_id, undefined);
      }
    }
  }
  private async validateDocument(kind: Kind, row: NativeObject): Promise<NativeResult> {
    const op = this.need(opRelations[kind], row.id), writer = writerOf(row, kind), docKind = kindOf(row, kind), doc = obj(row.document);
    const context = obj(kind === "dispense" || kind === "pickup" ? doc.reviewed_context : row.reviewed_context);
    nativeDocumentSchemas[docKind].parse(doc); nativeContextSchemas[docKind as Exclude<NativeDocumentKind, "return_policy">].parse(context); nativeRequestSchemas[writer].parse(op.request);
    if (op.id !== row.id || op.actor_id !== row.actor_id || await hashReviewNativeRequest(writer, op.actor_id, op.request) !== op.request_hash ||
      await hashReviewNativeContext(docKind as Exclude<NativeDocumentKind, "return_policy">, context) !== doc.reviewed_context_hash || obj(op.request).expected_context_hash !== doc.reviewed_context_hash) invalid();
    if (kind === "dispense" ? !same(obj(op.result).dispense, doc) : !same(op.result, doc)) invalid();
    if (kind === "dispense" || kind === "pickup") {
      if (op.operation !== (kind === "dispense" ? "dispense" : "pickup") || doc.actor_id !== row.actor_id || doc.id !== row.id || doc.authorization_id !== row.authorization_id || doc.pet_id !== row.pet_id ||
        stamp(kind === "dispense" ? doc.dispensed_at : doc.picked_up_at) !== stamp(kind === "dispense" ? row.dispensed_at : row.picked_up_at) || stamp(op.created_at) < stamp(kind === "dispense" ? row.dispensed_at : row.picked_up_at)) invalid();
    } else {
      if (doc.id !== row.id || obj(doc.actor).id !== row.actor_id || !same(doc.sequence, row.sequence) || doc.prior_event_id !== row.prior_event_id || stamp(doc.created_at) !== stamp(row.created_at) || stamp(op.created_at) !== stamp(row.created_at) ||
        await hashReviewNativeRecord(docKind as "return_v1" | "return_v2" | "correction" | "discrepancy", doc) !== row.record_hash || doc.record_hash !== row.record_hash) invalid();
      sameTarget(obj(doc.target), row);
      const head = obj(kind === "discrepancy" ? context.discrepancy_head : context.head);
      if (integer(head.version) + 1n !== integer(row.sequence, 1n) || head.event_id !== row.prior_event_id || head.record_hash !== doc.prior_record_hash || head.version instanceof ExactJsonNumber && integer(head.version) === 0n && row.prior_event_id !== null) invalid();
      const previous = row.prior_event_id === null ? null : this.optional(nativeRelations[kind], row.prior_event_id);
      if (previous && (previous.dispense_id !== row.dispense_id || integer(previous.sequence, 1n) + 1n !== integer(row.sequence, 1n) || previous.record_hash !== doc.prior_record_hash || stamp(previous.created_at) > stamp(row.created_at))) invalid();
      sameTarget(obj(context.target), obj(doc.target));
    }
    if (kind === "dispense") await this.dispense(row, op, doc, context);
    else {
      const dispense = this.need(nativeRelations.dispense, row.dispense_id);
      const original = await this.document("dispense", dispense), d = original.document;
      if (row.authorization_id !== dispense.authorization_id || row.pet_id !== dispense.pet_id ||
        stamp(kind === "pickup" ? row.picked_up_at : row.created_at) < stamp(dispense.dispensed_at)) invalid();
      if (kind === "pickup") this.pickup(row, op, doc, context, d);
      else {
        if (kind !== "discrepancy" && (doc.authorization_hash !== d.authorization_hash || doc.dispense_document_hash !== await hashReviewNativeDocument("dispense", d) || context.authorization_hash !== d.authorization_hash || context.dispense_document_hash !== doc.dispense_document_hash)) invalid();
        if (kind !== "discrepancy" && stamp(context.dispensed_at) !== stamp(d.dispensed_at)) invalid();
        if (kind === "return") await this.returnEvent(row, op, doc, context, d);
        else if (kind === "correction") {
          this.correction(row, op, doc, context, d);
          if (context.original_pickup !== null) {
            const summary = obj(context.original_pickup), pickup = this.optional(nativeRelations.pickup, summary.id);
            if (pickup && summary.document_hash !== await hashReviewNativeDocument("pickup", pickup.document)) invalid();
          }
        }
        else await this.discrepancy(row, op, doc, context, d);
      }
    }
    return { row, operation: op, document: doc, context, kind: docKind, writer };
  }
  private async dispense(row: NativeObject, op: NativeObject, doc: NativeObject, context: NativeObject): Promise<void> {
    const request = obj(op.request), t = obj(context.target), product = obj(context.product), invoice = obj(context.invoice), patient = obj(context.patient), house = obj(context.household), auth = obj(context.authorization), charge = obj(context.charge);
    if (!same(t, Object.fromEntries(Object.entries(request).filter(([k]) => !["expected_context_hash", "reason", "attest_alert_review", "attest_dispense_review"].includes(k)))) ||
      uuidValue(request.authorization_id) !== row.authorization_id || uuidValue(request.pet_id) !== row.pet_id || uuidValue(request.invoice_id) !== row.invoice_id ||
      doc.slot_id !== row.slot_id || doc.invoice_id !== row.invoice_id || doc.invoice_item_id !== row.invoice_item_id || quantity(doc.quantity) !== numeric(row.quantity) || quantity(request.quantity) !== numeric(row.quantity) || doc.reason !== request.reason ||
      auth.id !== row.authorization_id || auth.hash !== doc.authorization_hash || auth.state !== "active" || patient.id !== row.pet_id || patient.client_id !== house.id || doc.client_id !== house.id || patient.archived_at !== null || patient.deceased_at !== null ||
      product.id !== this.packet.event.product_id || product.active !== true || product.kind !== "medication" || product.unit !== doc.unit || obj(context.signed_artifact).unit !== doc.unit ||
      invoice.id !== row.invoice_id || invoice.client_id !== house.id || invoice.status !== "draft" || !same(invoice.version, doc.invoice_version_before) || integer(doc.invoice_version_after, 1n) !== integer(doc.invoice_version_before, 1n) + 1n ||
      context.denver_date !== denverDate(doc.dispensed_at) || obj(charge).quantity !== doc.quantity || charge.unit_price_cents !== product.unit_price_cents || charge.amount_cents !== doc.amount_cents) invalid();
    const signed = obj(context.signed_artifact), usage = obj(context.usage), alerts = obj(context.alerts);
    if (signed.authorization_id !== row.authorization_id || signed.authorization_hash !== doc.authorization_hash || obj(signed.patient).id !== row.pet_id || obj(signed.household).id !== house.id ||
      signed.signature_name !== obj(signed.prescriber).name || obj(alerts.snapshot).pet_id !== row.pet_id || !same(obj(alerts.snapshot).patient_version, patient.version) ||
      await hashReviewClinicalAlertSnapshot(alerts.snapshot) !== alerts.source_hash) invalid();
    keys(usage, ["version", "native_fill_accounting", "dispensed_quantity", "used_fill_slots", "remaining_quantity", "forfeited_quantity", "unopened_fill_slots", "allowance_basis", "open_slot", "fulfillment_head", "external_fulfillment"]);
    const usageHead = obj(usage.fulfillment_head);
    if ((integer(usageHead.version) === 0n) !== (usageHead.event_id === null)) invalid();
    const allowedSlots = integer(signed.refills_authorized, 0n, 1000n) + 1n, usedSlots = integer(usage.used_fill_slots, 0n, 1001n), perFill = quantity(signed.quantity_per_fill);
    if (signed.fulfillment_mode !== "practice_stock" || integer(usage.version, 2n, 2n) !== 2n || usage.native_fill_accounting !== "implemented" || usage.allowance_basis !== "native_practice_stock" || usage.external_fulfillment !== "unknown" ||
      str(signed.starts_on) > str(context.denver_date) || str(signed.expires_on) < str(context.denver_date) || usedSlots > allowedSlots || integer(usage.unopened_fill_slots, 0n, 1001n) !== allowedSlots - usedSlots ||
      aggregateQuantity(usage.dispensed_quantity, perFill * allowedSlots) + aggregateQuantity(usage.forfeited_quantity, perFill * allowedSlots) + aggregateQuantity(usage.remaining_quantity, perFill * allowedSlots) !== perFill * allowedSlots) invalid();
    const beforeSlot = context.slot === null ? null : obj(context.slot), previousSlot = context.previous_slot === null ? null : obj(context.previous_slot), slotIndex = integer(request.slot_index, 0n, 1000n);
    if (slotIndex >= allowedSlots || (slotIndex === 0n ? previousSlot !== null : !previousSlot || previousSlot.authorization_id !== row.authorization_id || previousSlot.state !== "closed" || integer(previousSlot.index, 0n, 1000n) !== slotIndex - 1n)) invalid();
    if (beforeSlot) {
      if (beforeSlot.authorization_id !== row.authorization_id || !same(beforeSlot.index, request.slot_index) || quantity(beforeSlot.maximum_quantity) !== perFill ||
        quantity(beforeSlot.remaining_quantity) !== perFill - quantity(beforeSlot.dispensed_quantity) || !same(usage.open_slot, { id: beforeSlot.id, index: beforeSlot.index, version: beforeSlot.version, remaining_quantity: beforeSlot.remaining_quantity })) invalid();
    } else if (usage.open_slot !== null || slotIndex !== usedSlots || numeric(row.quantity) > perFill) invalid();
    const q = numeric(row.quantity), price = BigInt(str(product.unit_price_cents)), amount = (q * price + 500n) / 1000n;
    if (price > 100000000n || BigInt(str(doc.amount_cents)) !== amount || BigInt(str(charge.projected_invoice_total_cents)) !== BigInt(str(invoice.existing_items_total_cents)) + amount || amount > 9223372036854775807n) invalid();
    const item = this.need("public.billing_invoice_items", row.invoice_item_id);
    if (item.product_id !== product.id || item.invoice_id !== row.invoice_id || item.pet_id !== row.pet_id || item.created_by !== row.actor_id || item.description !== product.name || numeric(item.quantity) !== q ||
      !(item.unit_price_cents instanceof ExactJsonNumber) || BigInt(item.unit_price_cents.token) !== price || !(item.amount_cents instanceof ExactJsonNumber) || BigInt(item.amount_cents.token) !== amount) invalid();
    const allocations = this.list("public.native_dispense_allocations", "dispense_id", row.id).sort((a, b) => str(a.lot_id).localeCompare(str(b.lot_id)));
    const targetAllocations = arr(request.allocations).map(obj), lots = arr(context.lots).map(obj), declared = arr(doc.allocations).map(obj);
    if (!allocations.length || allocations.length !== lots.length || allocations.length !== targetAllocations.length || allocations.length !== declared.length) invalid();
    let total = 0n;
    const seenLots = new Set<string>(), seenMovements = new Set<string>();
    for (let i = 0; i < allocations.length; i++) {
      const a = allocations[i], lot = this.need("public.inventory_lots", a.lot_id), m = this.need("public.inventory_movements", a.movement_id), prior = lots[i], input = targetAllocations[i], output = declared[i];
      const allocated = numeric(a.quantity); total += allocated;
      if (allocated <= 0n || seenLots.has(str(a.lot_id)) || seenMovements.has(str(a.movement_id)) || lot.product_id !== product.id ||
        m.lot_id !== lot.id || numeric(m.quantity) !== -allocated || m.kind !== "dispense" || m.created_by !== row.actor_id ||
        uuidValue(input.lot_id) !== lot.id || quantity(input.quantity) !== allocated || prior.id !== lot.id || prior.product_id !== product.id || prior.lot_number !== lot.lot_number || prior.expires_on !== lot.expires_on || prior.location !== lot.location ||
        quantity(prior.quantity) !== allocated || quantity(prior.balance, true) < allocated || str(lot.expires_on) < str(context.denver_date) ||
        output.lot_id !== lot.id || output.movement_id !== m.id || quantity(output.quantity) !== allocated) invalid();
      nativeText(200).parse(lot.lot_number); nativeText(200).parse(lot.location);
      seenLots.add(str(a.lot_id)); seenMovements.add(str(a.movement_id));
    }
    if (total !== q || await hashReviewNativeArtifact(doc.artifact) !== doc.artifact_hash) invalid();
    const artifact = { id: doc.id, authorization_id: doc.authorization_id, authorization_hash: doc.authorization_hash, fill_index: doc.slot_index,
      quantity: doc.quantity, unit: doc.unit, dispensed_at: doc.dispensed_at, recorded_by: { user_id: doc.actor_id, name: obj(obj(doc.artifact).recorded_by).name }, invoice_id: doc.invoice_id,
      lots: lots.map(l => ({ id: l.id, number: l.lot_number, expires_on: l.expires_on, quantity: l.quantity })) };
    if (!same(doc.artifact, artifact) || !same(doc.slot_index, request.slot_index) || !same(doc.slot_version_before, request.expected_slot_version)) invalid();
    const result = obj(op.result); keys(result, ["dispense", "slot", "refill_event"]);
    nativeSlotSchema.parse(result.slot);
    const after = obj(result.slot), before = context.slot === null ? null : obj(context.slot), maximum = before ? quantity(before.maximum_quantity) : quantity(obj(context.signed_artifact).quantity_per_fill);
    const priorQuantity = before ? quantity(before.dispensed_quantity) : 0n, remaining = maximum - priorQuantity - q, closed = remaining === 0n;
    if (remaining < 0n || before && (before.id !== row.slot_id || before.state !== "open" || !same(before.version, request.expected_slot_version)) || !before && request.expected_slot_version !== null ||
      after.id !== row.slot_id || after.authorization_id !== row.authorization_id || !same(after.index, request.slot_index) || integer(after.version, 1n) !== (before ? integer(before.version, 1n) : 0n) + 1n || !same(after.version, doc.slot_version_after) ||
      quantity(after.maximum_quantity) !== maximum || quantity(after.dispensed_quantity) !== priorQuantity + q || quantity(after.remaining_quantity, true) !== remaining ||
      after.state !== (closed ? "closed" : "open") || after.closure_kind !== (closed ? "filled" : null) || after.closed_by !== (closed ? row.actor_id : null) ||
      after.close_reason !== null || (closed ? stamp(after.closed_at) !== stamp(row.dispensed_at) : after.closed_at !== null) ||
      after.opened_by !== (before ? before.opened_by : row.actor_id) || stamp(after.opened_at) !== stamp(before ? before.opened_at : row.dispensed_at)) invalid();
    if (context.refill === null) {
      if (request.refill !== null || result.refill_event !== null || doc.refill_id !== null || doc.refill_event_id !== null) invalid();
    } else {
      const before = this.refillBefore(context.refill, request.refill, doc), wrapper = obj(context.refill), event = obj(result.refill_event);
      nativeFulfillmentRefillEventSchema.parse(event);
      const after = obj(event.after);
      if (doc.refill_id !== obj(request.refill).id || uuidValue(doc.refill_id) !== before.id || event.refill_id !== before.id || event.id !== doc.refill_event_id || event.action !== "dispense" || event.actor_id !== row.actor_id ||
        event.reason !== request.reason || event.prior_event_id !== wrapper.head_id || event.id === wrapper.head_id || integer(event.revision, 2n) !== integer(before.version, 1n) + 1n || !same(event.before, before) ||
        !same(after, { ...before, version: event.revision, state: "open", updated_by: row.actor_id, updated_at: after.updated_at }) ||
        !same(event.fulfillment_reference, { kind: "dispense", id: row.id, dispense_id: row.id, authorization_id: row.authorization_id })) invalid();
    }
  }
  private pickup(row: NativeObject, op: NativeObject, doc: NativeObject, context: NativeObject, dispense: NativeObject): void {
    const request = obj(op.request), auth = obj(context.authorization);
    if (row.dispense_id !== doc.dispense_id || uuidValue(request.authorization_id) !== row.authorization_id || uuidValue(request.pet_id) !== row.pet_id || uuidValue(request.dispense_id) !== row.dispense_id ||
      doc.recipient_name !== request.recipient_name || doc.recipient_relationship !== request.recipient_relationship || doc.reason !== request.reason || context.existing_pickup_id !== null || !same(context.dispense, dispense) ||
      auth.id !== row.authorization_id || auth.hash !== dispense.authorization_hash) invalid();
    if (context.refill === null) {
      // Closing is optional even when the original dispense linked a refill.
      if (request.refill_close !== null || doc.refill_id !== null || doc.refill_event_id !== null) invalid();
    } else {
      const before = this.refillBefore(context.refill, request.refill_close, dispense);
      if (doc.refill_id !== obj(request.refill_close).id || uuidValue(doc.refill_id) !== before.id || uuidValue(dispense.refill_id) !== before.id || doc.refill_event_id === null || doc.refill_event_id === obj(context.refill).head_id || doc.refill_event_id === dispense.refill_event_id) invalid();
      const original = obj(obj(this.need(opRelations.dispense, row.dispense_id).result).refill_event), after = obj(original.after);
      const sameRevision = same(before.version, after.version), sameHead = obj(context.refill).head_id === original.id;
      if (integer(before.version, 1n) < integer(after.version, 1n) ||
        (sameRevision || sameHead) && (!sameRevision || !sameHead || !same(before, after))) invalid();
      // The pickup after/event row is NOT in P. Its exact PK, closed transition,
      // actor/reason/reference and typed time interval remain backend-owned.
    }
  }
  private refillBefore(contextValue: ExactJson, requestValue: ExactJson, dispense: NativeObject): NativeObject {
    nativeRefillContextSchema.parse(contextValue);
    const context = obj(contextValue), before = obj(context.refill), request = obj(requestValue);
    if (context.head_id === null || uuidValue(request.id) !== before.id || !same(request.expected_version, before.version) || before.state !== "open" ||
      before.pet_id !== dispense.pet_id || before.client_id !== dispense.client_id || before.authorization_id !== dispense.authorization_id || before.authorization_hash !== dispense.authorization_hash) invalid();
    return before;
  }
  private correction(row: NativeObject, op: NativeObject, doc: NativeObject, context: NativeObject, dispense: NativeObject): void {
    const request = obj(op.request);
    if (doc.kind !== row.kind || context.dispense_artifact_hash !== dispense.artifact_hash ||
      uuidValue(request.authorization_id) !== row.authorization_id || uuidValue(request.pet_id) !== row.pet_id || uuidValue(request.dispense_id) !== row.dispense_id ||
      !same(request.expected_head, context.head) || !same(Object.fromEntries(Object.entries(request).filter(([key]) => !["authorization_id", "pet_id", "dispense_id", "expected_context_hash", "expected_head", "attest_review"].includes(key))),
        { kind: doc.kind, reason: doc.reason, note: doc.note, amends_event_id: doc.amends_event_id, pickup_amendment: doc.pickup_amendment }) ||
      obj(doc.actor).authority !== (row.kind === "clinical_annotation" ? "active_dvm" : "active_staff")) invalid();
    if (doc.amends_event_id !== null) {
      const predecessor = this.need(nativeRelations.correction, doc.amends_event_id);
      if (predecessor.dispense_id !== row.dispense_id || predecessor.kind !== row.kind || integer(predecessor.sequence, 1n) >= integer(row.sequence, 1n) || stamp(predecessor.created_at) > stamp(row.created_at)) invalid();
    }
    if (context.latest_pickup_amendment !== null) {
      const latest = obj(context.latest_pickup_amendment); keys(latest, ["event_id", "version", "value"]); canonicalId(latest.event_id);
      const retained = this.optional(nativeRelations.correction, latest.event_id);
      if (retained && (retained.kind !== "pickup_amendment" || retained.dispense_id !== row.dispense_id || integer(retained.sequence, 1n) >= integer(row.sequence, 1n) || !same(retained.sequence, latest.version) || !same(obj(retained.document).pickup_amendment, latest.value))) invalid();
    }
    if (context.original_pickup !== null) {
      const summary = obj(context.original_pickup); keys(summary, ["id", "document_hash", "picked_up_at", "recipient_name", "recipient_relationship", "actor_id"]);
      const pickup = this.optional(nativeRelations.pickup, summary.id);
      if (pickup && (pickup.dispense_id !== row.dispense_id || summary.actor_id !== pickup.actor_id || stamp(summary.picked_up_at) !== stamp(pickup.picked_up_at) ||
        summary.recipient_name !== obj(pickup.document).recipient_name || summary.recipient_relationship !== obj(pickup.document).recipient_relationship)) invalid();
    }
    if (row.kind === "pickup_amendment") {
      const amendment = obj(doc.pickup_amendment), pickup = this.need(nativeRelations.pickup, amendment.original_pickup_id);
      if (pickup.dispense_id !== row.dispense_id || context.original_pickup === null || obj(context.original_pickup).id !== pickup.id || stamp(row.created_at) < stamp(pickup.picked_up_at) ||
        doc.amends_event_id !== (context.latest_pickup_amendment === null ? null : obj(context.latest_pickup_amendment).event_id)) invalid();
      if (amendment.handoff !== null) {
        const at = stamp(obj(amendment.handoff).picked_up_at);
        if (at < stamp(dispense.dispensed_at) || at > stamp(row.created_at)) invalid();
      }
    } else if (doc.pickup_amendment !== null) invalid();
  }
  private allocationBalances(context: NativeObject, originals: NativeObject[]): Map<string, NativeObject> {
    const balances = arr(context.allocations).map(obj), result = new Map<string, NativeObject>();
    if (balances.length !== originals.length) invalid();
    let prior = "";
    for (const b of balances) {
      keys(b, ["allocation_id", "lot_id", "lot_number", "expires_on", "dispensed_quantity", "returned_quantity", "remaining_returnable_quantity", "held_quantity", "disposed_quantity", "restocked_quantity"]);
      const a = originals.find(x => x.id === b.allocation_id) ?? invalid(), lot = this.need("public.inventory_lots", a.lot_id), maximum = numeric(a.quantity);
      if (str(b.allocation_id) <= prior || b.lot_id !== a.lot_id || b.lot_number !== lot.lot_number || b.expires_on !== lot.expires_on) invalid(); prior = str(b.allocation_id);
      for (const key of ["dispensed_quantity", "returned_quantity", "remaining_returnable_quantity", "held_quantity", "disposed_quantity", "restocked_quantity"]) {
        if (!/^(0|[1-9][0-9]{0,10})\.[0-9]{3}$/.test(str(b[key])) || quantity(b[key], true) > maximum) invalid();
      }
      if (quantity(b.dispensed_quantity) !== maximum || quantity(b.returned_quantity, true) !== quantity(b.held_quantity, true) + quantity(b.disposed_quantity, true) + quantity(b.restocked_quantity, true) ||
        quantity(b.remaining_returnable_quantity, true) !== maximum - quantity(b.returned_quantity, true)) invalid();
      result.set(str(b.allocation_id), b);
    }
    return result;
  }
  private intakeBalances(row: NativeObject, context: NativeObject): Map<string, NativeObject> {
    const result = new Map<string, NativeObject>();
    if (row.intake_id === null) { if (context.intake !== null) invalid(); return result; }
    const intake = obj(context.intake); keys(intake, ["id", "sequence", "custody", "package_condition", "storage_history", "allocations"]);
    const original = this.need(nativeRelations.return, row.intake_id), doc = obj(original.document);
    if (intake.id !== row.intake_id || original.action !== "intake" || original.dispense_id !== row.dispense_id || integer(original.sequence, 1n) >= integer(row.sequence, 1n) || stamp(original.created_at) > stamp(row.created_at) ||
      !same(intake.sequence, original.sequence) || intake.custody !== doc.custody || intake.package_condition !== doc.package_condition || intake.storage_history !== doc.storage_history || arr(intake.allocations).length !== arr(doc.allocations).length) invalid();
    let prior = "";
    for (const b of arr(intake.allocations).map(obj)) {
      keys(b, ["allocation_id", "lot_id", "quantity", "held_quantity", "disposed_quantity", "restocked_quantity"]);
      const a = arr(doc.allocations).map(obj).find(a => a.allocation_id === b.allocation_id) ?? invalid(), maximum = quantity(a.quantity);
      if (str(b.allocation_id) <= prior || b.lot_id !== a.lot_id) invalid(); prior = str(b.allocation_id);
      for (const key of ["quantity", "held_quantity", "disposed_quantity", "restocked_quantity"]) if (quantity(b[key], true) > maximum) invalid();
      if (quantity(b.quantity, true) !== quantity(b.held_quantity, true) + quantity(b.disposed_quantity, true) + quantity(b.restocked_quantity, true)) invalid();
      result.set(str(b.allocation_id), b);
    }
    return result;
  }
  private replay(context: NativeObject, originals: NativeObject[], sequence: bigint): void {
    const replay = obj(context.replay); keys(replay, ["allocations", "intakes", "correction_remaining", "historical"]);
    if (reviewJsonbTextBytes(replay) > 1048576 || arr(replay.allocations).length !== originals.length || arr(replay.historical).length !== originals.length || BigInt(arr(replay.intakes).length) > sequence || BigInt(arr(replay.correction_remaining).length) > sequence) invalid();
    const summaries = this.allocationBalances(context, originals), sums = new Map<string, bigint[]>(), totals = new Map<string, NativeObject>();
    let prior = "";
    for (const b of arr(replay.allocations).map(obj)) {
      keys(b, ["allocation_id", "lot_id", "dispensed_quantity", "returned_quantity", "remaining_returnable_quantity", "held_quantity", "disposed_quantity", "restocked_quantity"]);
      const own = summaries.get(str(b.allocation_id)) ?? invalid();
      if (str(b.allocation_id) <= prior || !same(b, Object.fromEntries(Object.entries(own).filter(([k]) => !["lot_number", "expires_on"].includes(k))))) invalid(); prior = str(b.allocation_id);
      totals.set(str(b.allocation_id), b); sums.set(str(b.allocation_id), [0n, 0n, 0n, 0n]);
    }
    const seen = new Set<string>();
    for (const intake of arr(replay.intakes).map(obj)) {
      keys(intake, ["id", "allocations"]); const id = canonicalId(intake.id);
      if (seen.has(id) || !arr(intake.allocations).length || arr(intake.allocations).length > 100) invalid(); seen.add(id); prior = "";
      const retained = this.optional(nativeRelations.return, intake.id);
      if (retained && (retained.action !== "intake" || integer(retained.sequence, 1n) > sequence)) invalid();
      for (const b of arr(intake.allocations).map(obj)) {
        keys(b, ["allocation_id", "lot_id", "quantity", "held_quantity", "disposed_quantity", "restocked_quantity"]);
        const a = originals.find(a => a.id === b.allocation_id) ?? invalid(), values = ["quantity", "held_quantity", "disposed_quantity", "restocked_quantity"].map(k => quantity(b[k], true));
        if (str(b.allocation_id) <= prior || b.lot_id !== a.lot_id || values.some(q => q > numeric(a.quantity)) || values[0] !== values[1] + values[2] + values[3]) invalid(); prior = str(b.allocation_id);
        const sum = sums.get(str(b.allocation_id)) ?? invalid(); values.forEach((v, i) => { sum[i] += v; });
        if (retained) {
          const actual = arr(obj(retained.document).allocations).map(obj).find(x => x.allocation_id === b.allocation_id);
          if (!actual || actual.lot_id !== b.lot_id || values[0] > quantity(actual.quantity)) invalid();
        }
      }
    }
    for (const [id, sum] of sums) {
      const b = totals.get(id) ?? invalid();
      if (["returned_quantity", "held_quantity", "disposed_quantity", "restocked_quantity"].some((k, i) => sum[i] !== quantity(b[k], true))) invalid();
    }
    prior = "";
    for (const history of arr(replay.historical).map(obj)) {
      keys(history, ["allocation_id", "lot_id", "gross_intake_quantity", "gross_disposed_quantity", "gross_restocked_quantity", "retracted_intake_quantity", "retracted_disposed_quantity", "retracted_restocked_quantity"]);
      const a = originals.find(a => a.id === history.allocation_id) ?? invalid(), current = totals.get(str(a.id)) ?? invalid(), maximum = numeric(a.quantity) * sequence;
      if (str(a.id) <= prior || history.lot_id !== a.lot_id) invalid(); prior = str(a.id);
      const qs = ["gross_intake_quantity", "gross_disposed_quantity", "gross_restocked_quantity", "retracted_intake_quantity", "retracted_disposed_quantity", "retracted_restocked_quantity"].map(k => {
        const text = str(history[k]); if (!/^(0|[1-9][0-9]{0,20})\.[0-9]{3}$/.test(text)) invalid();
        const q = reviewSnapshotTotalThousandths(text); if (q < 0n || q > maximum) invalid(); return q;
      });
      if (qs[0] - qs[3] !== quantity(current.returned_quantity, true) || qs[1] - qs[4] !== quantity(current.disposed_quantity, true) || qs[2] - qs[5] !== quantity(current.restocked_quantity, true)) invalid();
    }
    seen.clear();
    for (const remaining of arr(replay.correction_remaining).map(obj)) {
      keys(remaining, ["event_id", "allocations"]); const id = canonicalId(remaining.event_id);
      if (seen.has(id) || !arr(remaining.allocations).length || arr(remaining.allocations).length > 100) invalid(); seen.add(id); prior = "";
      const actual = this.optional(nativeRelations.return, remaining.event_id);
      if (actual && (integer(actual.sequence, 1n) > sequence || !["intake", "dispose", "restock"].includes(str(actual.action)) || arr(obj(actual.document).allocations).length !== arr(remaining.allocations).length)) invalid();
      for (const b of arr(remaining.allocations).map(obj)) {
        keys(b, ["allocation_id", "quantity"]); const a = originals.find(a => a.id === b.allocation_id) ?? invalid();
        if (str(b.allocation_id) <= prior || quantity(b.quantity, true) > numeric(a.quantity)) invalid(); prior = str(b.allocation_id);
        if (actual) { const original = arr(obj(actual.document).allocations).map(obj).find(x => x.allocation_id === b.allocation_id); if (!original || quantity(b.quantity, true) > quantity(original.quantity)) invalid(); }
      }
    }
  }
  private async returnEvent(row: NativeObject, op: NativeObject, doc: NativeObject, context: NativeObject, dispense: NativeObject): Promise<void> {
    const request = obj(op.request), intent = obj(request.intent), action = str(row.action), version2 = integer(doc.version, 1n, 2n) === 2n;
    if (doc.action !== action || doc.intake_id !== row.intake_id || !same(context.intent, intent) || !same(request.expected_head, context.head) || !same(intent.target, doc.target) || intent.action !== action || intent.intake_id !== row.intake_id ||
      doc.reason !== intent.reason || doc.note !== intent.note || doc.custody !== intent.custody || doc.package_condition !== intent.package_condition || doc.storage_history !== intent.storage_history ||
      obj(doc.actor).authority !== (["intake", "dispose"].includes(action) ? "active_staff" : "active_dvm") || request.attest_restock !== (action === "restock")) invalid();
    const originals = this.list("public.native_dispense_allocations", "dispense_id", row.dispense_id), balances = this.allocationBalances(context, originals), intakes = this.intakeBalances(row, context);
    if (version2) {
      const expected = { reviewed_physical_facts: true, intake_claim_incorrect: action === "retract_intake", remains_physically_held: ["retract_disposal", "retract_restock"].includes(action), was_not_destroyed: action === "retract_disposal", removed_from_available_stock: action === "retract_restock" };
      if (!same(request.physical_attestations, expected) || !same(doc.physical_attestations, expected) || !same(request.expected_discrepancy_head, context.discrepancy_head) ||
        !same(doc.correction_target, intent.correction_target) || doc.discrepancy_id !== intent.discrepancy_id) invalid();
      this.replay(context, originals, integer(row.sequence, 1n) - 1n);
      await this.discrepancySnapshot(context.discrepancies, obj(doc.target), row.created_at);
      if (!same(obj(context.discrepancies).head, context.discrepancy_head)) invalid();
    }
    const declared = arr(doc.allocations).map(obj), inputs = arr(intent.allocations).map(obj), stock = this.list("public.native_return_stock_links", "event_id", row.id), compensation = this.list("public.native_return_compensation_links", "event_id", row.id);
    if (declared.length !== inputs.length || stock.length !== (action === "restock" ? declared.length : 0) || compensation.length !== (action === "retract_restock" ? declared.length : 0)) invalid();
    let correction: NativeObject | null = null;
    if (action.startsWith("retract_")) {
      correction = this.need(nativeRelations.return, obj(doc.correction_target).event_id);
      const expectedAction = action === "retract_intake" ? "intake" : action === "retract_disposal" ? "dispose" : "restock";
      if (correction.dispense_id !== row.dispense_id || correction.action !== expectedAction || correction.record_hash !== obj(doc.correction_target).record_hash || integer(correction.sequence, 1n) >= integer(row.sequence, 1n) ||
        stamp(correction.created_at) > stamp(row.created_at) || row.intake_id !== (expectedAction === "intake" ? correction.id : correction.intake_id)) invalid();
      const targetParent = this.need("public.controlled_stock_events", correction.id);
      if (targetParent.writer !== (integer(obj(correction.document).version, 1n, 2n) === 1n ? "record_native_dispense_return" : "record_native_dispense_return_v2")) invalid();
    }
    for (let i = 0; i < declared.length; i++) {
      const a = declared[i], input = inputs[i], original = originals.find(x => x.id === a.allocation_id) ?? invalid(), q = quantity(a.quantity), b = balances.get(str(a.allocation_id)) ?? invalid(), intake = intakes.get(str(a.allocation_id));
      if (a.allocation_id !== input.allocation_id || a.lot_id !== original.lot_id || q !== quantity(input.quantity) || q > numeric(original.quantity)) invalid();
      if (action === "intake" ? q > quantity(b.remaining_returnable_quantity, true) : !intake || q > quantity(intake[action === "retract_disposal" ? "disposed_quantity" : action === "retract_restock" ? "restocked_quantity" : "held_quantity"], true)) invalid();
      if (correction) {
        const actual = arr(obj(correction.document).allocations).map(obj).find(x => x.allocation_id === a.allocation_id) ?? invalid();
        const remaining = arr(obj(context.replay).correction_remaining).map(obj).find(x => x.event_id === correction!.id) ?? invalid();
        const bound = arr(remaining.allocations).map(obj).find(x => x.allocation_id === a.allocation_id) ?? invalid();
        if (q > quantity(actual.quantity) || q > quantity(bound.quantity, true) || actual.lot_id !== a.lot_id) invalid();
      }
      if (action === "restock" || action === "retract_restock") {
        const links = action === "restock" ? stock : compensation, link = links.find(x => x.allocation_id === a.allocation_id) ?? invalid(), movement = this.need("public.inventory_movements", link.movement_id);
        if (link.lot_id !== a.lot_id || numeric(link.quantity) !== q || movement.lot_id !== a.lot_id || numeric(movement.quantity) !== (action === "restock" ? q : -q) || movement.kind !== (action === "restock" ? "native_return" : "native_return_compensation") ||
          movement.created_by !== row.actor_id || stamp(movement.created_at) !== stamp(row.created_at) || a.movement_id !== movement.id) invalid();
        if (action === "retract_restock") {
          const originalLink = this.list("public.native_return_stock_links", "event_id", correction!.id).find(x => x.allocation_id === a.allocation_id) ?? invalid();
          if (link.target_event_id !== correction!.id || link.original_movement_id !== originalLink.movement_id || link.lot_id !== originalLink.lot_id) invalid();
        }
      } else if (a.movement_id !== null) invalid();
    }
    const root = row.intake_id === null ? row : this.need(nativeRelations.return, row.intake_id);
    if (obj(root.document).custody !== "clinic_retained" || context.original_pickup !== null) invalid();
    if (action === "restock") {
      const policy = obj(doc.policy); nativeDocumentSchemas.return_policy.parse(policy);
      if (!same(doc.policy, context.policy) || policy.enabled !== true || stamp(policy.reviewed_at) > stamp(row.created_at) || await hashReviewNativeRecord("return_policy", policy) !== policy.record_hash ||
        obj(root.document).package_condition !== "sealed_intact" || obj(root.document).storage_history !== "controlled") invalid();
    } else if (doc.policy !== null || context.policy !== null) invalid();
    if (action === "restock" || action === "retract_restock") {
      const review = obj(context.stock_review); keys(review, ["practice_date", "product", "lots"]);
      const product = obj(review.product); keys(product, ["id", "version", "active", "name", "unit"]);
      if (product.id !== this.packet.event.product_id || product.unit !== dispense.unit || review.practice_date !== denverDate(row.created_at) || action === "restock" && product.active !== true) invalid();
      const lots = arr(review.lots).map(obj), selectedLots = new Set(declared.map(a => str(a.lot_id)));
      if (lots.length !== selectedLots.size) invalid();
      for (const lot of lots) {
        keys(lot, ["lot_id", "balance"]);
        if (!selectedLots.delete(str(lot.lot_id))) invalid();
        const actual = this.need("public.inventory_lots", lot.lot_id), q = declared.filter(a => a.lot_id === lot.lot_id).reduce((n, a) => n + quantity(a.quantity), 0n);
        if (quantity(lot.balance, true) > 99999999999999n || action === "retract_restock" && quantity(lot.balance, true) < q || action === "restock" && str(actual.expires_on) < str(review.practice_date)) invalid();
        if (action === "restock" && version2 && arr(obj(context.discrepancies).held_lot_ids).includes(lot.lot_id)) invalid();
      }
    } else if (context.stock_review !== null) invalid();
  }
  private async discrepancySnapshot(input: ExactJson, target: NativeObject, maximumTime: ExactJson): Promise<void> {
    const snapshot = obj(input); keys(snapshot, ["version", "head", "open_case_count", "held_lot_ids", "cases"]);
    const head = obj(snapshot.head); nativeHeadSchema.parse(head);
    const cases = arr(snapshot.cases).map(obj), documents: NativeObject[] = [], seen = new Set<string>();
    if (integer(snapshot.version, 1n, 1n) !== 1n || reviewJsonbTextBytes(snapshot) > 1048576) invalid();
    for (const c of cases) {
      keys(c, ["id", "source", "allocations", "status", "report", "decisions"]);
      const report = obj(c.report);
      if (report.id !== c.id || report.case_id !== c.id || report.action !== "report" || !same(report.source, c.source) || !same(report.allocations, c.allocations)) invalid();
      documents.push(report, ...arr(c.decisions).map(obj));
    }
    if (BigInt(documents.length) !== integer(head.version)) invalid();
    documents.sort((a, b) => Number(integer(a.sequence, 1n) - integer(b.sequence, 1n)));
    const rebuilt = new Map<string, { report: NativeObject; decisions: NativeObject[]; status: string }>();
    let prior: NativeObject | null = null;
    for (const doc of documents) {
      nativeDocumentSchemas.discrepancy.parse(doc); sameTarget(obj(doc.target), target);
      const id = str(doc.id), expectedSequence = BigInt(seen.size + 1);
      if (seen.has(id) || integer(doc.sequence, 1n) !== expectedSequence || doc.prior_event_id !== (prior?.id ?? null) || doc.prior_record_hash !== (prior?.record_hash ?? null) ||
        stamp(doc.created_at) > stamp(maximumTime) || prior && stamp(doc.created_at) < stamp(prior.created_at) || await hashReviewNativeRecord("discrepancy", doc) !== doc.record_hash) invalid();
      seen.add(id);
      const actual = this.optional(nativeRelations.discrepancy, doc.id);
      if (actual && !same(actual.document, doc)) invalid();
      const source = this.optional(nativeRelations.return, obj(doc.source).event_id);
      if (source && (source.record_hash !== obj(doc.source).record_hash || !["intake", "dispose", "restock"].includes(str(source.action)) || source.dispense_id !== target.dispense_id || stamp(source.created_at) > stamp(doc.created_at))) invalid();
      if (doc.action === "report") {
        if (doc.case_id !== doc.id || rebuilt.has(id)) invalid();
        rebuilt.set(id, { report: doc, decisions: [], status: "open" });
      } else {
        const c = rebuilt.get(str(doc.case_id)) ?? invalid();
        if (c.status !== "open" || !same(c.report.source, doc.source) || !same(c.report.allocations, doc.allocations)) invalid();
        if (doc.action === "resolve_corrected" || doc.action === "resolve_confirmed_original") {
          if (obj(doc.actor).authority !== "active_dvm") invalid(); c.status = doc.action === "resolve_corrected" ? "resolved_corrected" : "resolved_confirmed_original";
        }
        c.decisions.push(doc);
      }
      if (doc.action === "resolve_corrected" ? arr(doc.correction_ids).length === 0 : arr(doc.correction_ids).length !== 0) invalid();
      prior = doc;
    }
    const expectedHead = prior ? { event_id: prior.id, version: prior.sequence, record_hash: prior.record_hash } : { event_id: null, version: number(0n), record_hash: null };
    if (!same(head, expectedHead) || cases.length !== rebuilt.size) invalid();
    const expectedCases = [...rebuilt.values()].map(c => ({ id: c.report.id, source: c.report.source, allocations: c.report.allocations, status: c.status, report: c.report, decisions: c.decisions }));
    if (!same(snapshot.cases, expectedCases)) invalid();
    const open = expectedCases.filter(c => c.status === "open"), lots = [...new Set(open.flatMap(c => arr(c.allocations).map(a => str(obj(a).lot_id))))].sort();
    if (integer(snapshot.open_case_count) !== BigInt(open.length) || !same(snapshot.held_lot_ids, lots)) invalid();
  }
  private async discrepancy(row: NativeObject, op: NativeObject, doc: NativeObject, context: NativeObject, _dispense: NativeObject): Promise<void> {
    const request = obj(op.request), intent = obj(request.intent), source = this.need(nativeRelations.return, obj(doc.source).event_id), sourceDoc = obj(source.document), action = str(row.action);
    if (doc.action !== action || doc.case_id !== row.case_id || !same(doc.target, intent.target) || !same(doc.source, intent.source) || !same(doc.correction_ids, intent.correction_ids) || doc.observation !== intent.observation ||
      intent.action !== action || !same(context.intent, intent) || !same(context.source, sourceDoc) || !same(request.expected_return_head, context.return_head) || !same(doc.return_head, context.return_head) ||
      !same(request.expected_discrepancy_head, context.discrepancy_head) || request.attest_original_quantities_custody_and_stock_accurate !== (action === "resolve_confirmed_original") ||
      source.dispense_id !== row.dispense_id || source.record_hash !== obj(doc.source).record_hash || !["intake", "dispose", "restock"].includes(str(source.action)) || stamp(source.created_at) > stamp(row.created_at)) invalid();
    if ((action === "report") !== (row.case_id === row.id) || intent.case_id !== (action === "report" ? null : row.case_id)) invalid();
    const prior = obj(context.discrepancies); await this.discrepancySnapshot(prior, obj(doc.target), row.created_at);
    if (!same(prior.head, context.discrepancy_head)) invalid();
    const previousCase = arr(prior.cases).map(obj).find(c => c.id === row.case_id);
    if (action === "report" ? previousCase !== undefined : !previousCase || previousCase.status !== "open" || !same(previousCase.source, doc.source) || !same(previousCase.allocations, doc.allocations)) invalid();
    if (action.startsWith("resolve_") && obj(doc.actor).authority !== "active_dvm") invalid();
    const declared = arr(doc.allocations).map(obj), inputs = arr(intent.allocations).map(obj);
    if (declared.length !== inputs.length) invalid();
    const correctionTotals = new Map<string, bigint>();
    for (const id of arr(doc.correction_ids)) {
      const correction = this.need(nativeRelations.return, id), c = obj(correction.document), links = this.list("public.native_return_discrepancy_correction_links", "correction_id", id);
      if (links.length !== 1 || links[0].case_id !== row.case_id || links[0].resolution_id !== row.id || correction.dispense_id !== row.dispense_id || !str(correction.action).startsWith("retract_") || integer(c.version, 2n, 2n) !== 2n || !same(c.correction_target, doc.source) || c.discrepancy_id !== row.case_id || stamp(correction.created_at) > stamp(row.created_at)) invalid();
      for (const allocation of arr(c.allocations).map(obj)) correctionTotals.set(str(allocation.allocation_id), (correctionTotals.get(str(allocation.allocation_id)) ?? 0n) + quantity(allocation.quantity));
    }
    if (action === "resolve_corrected" && correctionTotals.size !== declared.length || action === "resolve_confirmed_original" && this.list(nativeRelations.return).some(r => obj(r.document).discrepancy_id === row.case_id)) invalid();
    for (let i = 0; i < declared.length; i++) {
      const a = declared[i], input = inputs[i], original = arr(sourceDoc.allocations).map(obj).find(x => x.allocation_id === a.allocation_id) ?? invalid();
      if (a.allocation_id !== input.allocation_id || a.lot_id !== original.lot_id || quantity(a.quantity) !== quantity(input.quantity) || quantity(a.quantity) > quantity(original.quantity) ||
        action === "resolve_corrected" && correctionTotals.get(str(a.allocation_id)) !== quantity(a.quantity)) invalid();
    }
    if (this.list("public.native_return_discrepancy_correction_links", "resolution_id", row.id).length !== arr(doc.correction_ids).length) invalid();
    const returnHead = obj(context.return_head), retainedHead = this.optional(nativeRelations.return, returnHead.event_id);
    if (integer(returnHead.version, 1n) < integer(source.sequence, 1n) || retainedHead && (!same(retainedHead.sequence, returnHead.version) || retainedHead.record_hash !== returnHead.record_hash || retainedHead.dispense_id !== row.dispense_id || stamp(retainedHead.created_at) > stamp(row.created_at))) invalid();
    // Prefix completeness/PKs omitted by the DTO remain the stated backend
    // premise; every exposed quantity is still internally conserved locally.
    const originals = this.list("public.native_dispense_allocations", "dispense_id", row.dispense_id);
    const balanceRows = arr(obj(context.replay).allocations).map(obj).map(b => {
      const lot = this.need("public.inventory_lots", b.lot_id); return { ...b, lot_number: lot.lot_number, expires_on: lot.expires_on };
    });
    this.replay({ ...context, allocations: balanceRows }, originals, integer(returnHead.version));
  }
  private resultForEvent(event: NativeObject): Promise<NativeResult> {
    switch (event.writer) {
      case "record_native_dispense": return this.document("dispense", this.need(nativeRelations.dispense, event.id));
      case "record_native_pickup": return this.document("pickup", this.need(nativeRelations.pickup, event.id));
      case "record_native_dispense_return": case "record_native_dispense_return_v2": return this.document("return", this.need(nativeRelations.return, event.id));
      case "append_native_dispense_correction": return this.document("correction", this.need(nativeRelations.correction, event.id));
      case "record_native_return_discrepancy": return this.document("discrepancy", this.need(nativeRelations.discrepancy, event.id));
      default: return invalid();
    }
  }
  private originalAllocations(dispenseId: ExactJson): NativeObject[] {
    return this.list("public.native_dispense_allocations", "dispense_id", dispenseId).sort((a, b) => str(a.lot_id) < str(b.lot_id) ? -1 : str(a.lot_id) > str(b.lot_id) ? 1 : 0)
      .map(a => ({ allocation_id: a.id, dispense_id: a.dispense_id, lot_id: a.lot_id, movement_id: a.movement_id, quantity: stored(numeric(a.quantity)) }));
  }
  private effects(event: NativeObject, result: NativeResult): { bundle: NativeObject; effects: NativeObject; plan: ExpectedEffect[] } {
    const { row, document: doc, context, writer } = result;
    const kind: Kind = result.kind === "return_v1" || result.kind === "return_v2" ? "return" : result.kind as Kind;
    const dispenseId = kind === "dispense" ? row.id : row.dispense_id, originals = this.originalAllocations(dispenseId);
    const movements = this.list("public.stock_movement_sources").filter(s => s.writer === writer && s.source_id === row.id).map(s => this.need("public.inventory_movements", s.movement_id)).sort((a, b) => str(a.id) < str(b.id) ? -1 : 1);
    const available = movements.map(m => ({ kind: "movement", id: m.id, lot_id: m.lot_id, product_id: this.packet.event.product_id, quantity_delta: stored(numeric(m.quantity)), native_kind: m.kind }));
    const custody: NativeObject[] = [], plan: ExpectedEffect[] = [];
    let basis = "", requirements: NativeObject = {}, returnSource: ExactJson = null;
    const add = (lot: ExactJson, channel: string, did: ExactJson, iid: ExactJson, q: bigint) => plan.push({ lot_id: lot, channel, dispense_id: did, intake_id: iid, q });
    if (kind === "dispense" || kind === "pickup") {
      basis = kind === "dispense" ? "preparation_record" : "handoff_record";
      requirements = kind === "dispense" ? { exact_available_container_allocations_required: true } : { complete_original_prepared_package: true, expected_container_heads_required: true };
      for (const a of originals) {
        const q = quantity(a.quantity), signed = kind === "dispense" ? q : -q;
        if (kind === "dispense") add(a.lot_id, "available", null, null, -q);
        add(a.lot_id, "prepared", dispenseId, null, signed);
        custody.push({ source_kind: kind, source_id: row.id, allocation_id: a.allocation_id, lot_id: a.lot_id, dispense_id: dispenseId, intake_id: null, channel: "prepared", quantity_delta: stored(signed) });
      }
    } else if (kind === "return") {
      const action = str(row.action), intakeId = row.intake_id ?? row.id, intake = this.need(nativeRelations.return, intakeId), intakeDocument = obj(intake.document);
      returnSource = { action: row.action, intake_id: intakeId, intake_document: intake.document, intake_reviewed_context: intake.reviewed_context };
      basis = action.startsWith("retract_") ? "correction_assertion" : "custody_record";
      requirements = { original_intake_id: intakeId, original_intake_custody: intakeDocument.custody, clinic_retained_before_handoff_required: true, actual_original_pickup_must_be_checked: true, expected_container_heads_required: true, explicit_restock_destination_required: ["restock", "retract_restock"].includes(action) };
      for (const a of arr(doc.allocations).map(obj)) {
        const q = quantity(a.quantity), prepared = action === "intake" ? -q : action === "retract_intake" ? q : 0n;
        const held = ["intake", "retract_disposal", "retract_restock"].includes(action) ? q : -q;
        if (action === "restock" || action === "retract_restock") add(a.lot_id, "available", null, null, action === "restock" ? q : -q);
        if (prepared) { add(a.lot_id, "prepared", dispenseId, null, prepared); custody.push({ source_kind: "return", source_id: row.id, allocation_id: a.allocation_id, lot_id: a.lot_id, dispense_id: dispenseId, intake_id: null, channel: "prepared", quantity_delta: stored(prepared) }); }
        add(a.lot_id, "return_held", dispenseId, intakeId, held); custody.push({ source_kind: "return", source_id: row.id, allocation_id: a.allocation_id, lot_id: a.lot_id, dispense_id: dispenseId, intake_id: intakeId, channel: "return_held", quantity_delta: stored(held) });
      }
    } else if (kind === "correction") { basis = "annotation"; requirements = { annotation_cannot_restore_stock_or_prove_physical_return: true }; }
    else { basis = "discrepancy_assertion"; requirements = { native_and_controlled_holds_must_compose: true }; }
    const identity = { version: number(1n), writer: event.writer, root: event.id, actor_id: event.actor_id, product_id: event.product_id };
    const bundle = { ...identity, available, native: { kind, id: row.id, dispense_id: dispenseId, document: doc, original_allocations: originals, return_source: returnSource } };
    const effects = { ...identity, basis, available, custody, requirements, authorizes_execution: false };
    // Exact movement membership must follow the selected allocation actions.
    if ((kind === "dispense" && movements.length !== originals.length) || (kind === "pickup" || kind === "correction" || kind === "discrepancy") && movements.length !== 0 ||
      kind === "return" && movements.length !== (["restock", "retract_restock"].includes(str(row.action)) ? arr(doc.allocations).length : 0)) invalid();
    void context; return { bundle, effects, plan };
  }
  private async controlled(event: NativeObject): Promise<void> {
    const preparation = this.need("public.controlled_stock_preparations", event.id), policy = this.need("public.controlled_stock_policy_versions", event.policy_version_id), opening = this.need("public.controlled_stock_openings", event.opening_id);
    const context = obj(preparation.context), frozen = obj(preparation.frozen), args = obj(preparation.canonical_arguments);
    keys(args, ["request"]); nativeC0ContextSchema.parse(context); nativeFrozenSchema.parse(frozen);
    const result = await this.resultForEvent(event), request = obj(args.request), permission = obj(frozen.permission), catalog = obj(frozen.catalog), writer = result.writer;
    nativeRequestSchemas[writer].parse(request);
    if (result.row.id !== event.id || result.row.actor_id !== event.actor_id || result.writer !== event.writer || !same(request, result.operation.request) || !same(frozen.native, result.context) || permission.witness !== "none" || !same(obj(policy.permissions)[str(event.event_kind)], permission) || permission.basis !== event.basis ||
      catalog.id !== event.product_id || policy.product_id !== event.product_id || opening.product_id !== event.product_id || policy.stock_unit !== catalog.unit || integer(policy.version, 1n) < 1n ||
      !same(policy.engine_revision, event.engine_revision) || !same(policy.identity_snapshot, { id: catalog.id, name: catalog.name, kind: catalog.kind, manufacturer: catalog.manufacturer, unit: catalog.unit }) ||
      count(event.sequence) < 1n || (count(event.sequence) === 1n) !== (event.prior_event_id === null) || (count(event.sequence) === 1n) !== (event.prior_record_hash === null) ||
      stamp(preparation.expires_at) <= stamp(preparation.created_at) || reviewJsonbTextBytes(context) > 262144 || reviewJsonbTextBytes(args) > 131072 || reviewJsonbTextBytes(frozen) > 1048576 ||
      (event.basis === "physical_record" && stamp(event.observed_at) < stamp(opening.observed_at))) invalid();
    nativeText(200, false).parse(event.actor_name);
    if (!Array.isArray(opening.native_custody_boundary) || Array.from(str(policy.stock_unit)).length < 1 || Array.from(str(policy.stock_unit)).length > 50 ||
      Array.from(str(policy.review_reference)).length < 1 || Array.from(str(policy.review_reference)).length > 2000) invalid();
    for (const [key, max] of [["name", 200], ["unit", 50]] as const) if (!str(catalog[key]).replace(/^ +| +$/g, "") || Array.from(str(catalog[key]).replace(/^ +| +$/g, "")).length > max) invalid();
    if (result.kind === "dispense") {
      const product = obj(result.context.product);
      if (["id", "name", "kind", "unit", "active", "version"].some(key => !same(product[key], catalog[key])) || !(catalog.unit_price_cents instanceof ExactJsonNumber) || BigInt(catalog.unit_price_cents.token) !== BigInt(str(product.unit_price_cents))) invalid();
    } else if ((result.kind === "return_v1" || result.kind === "return_v2") && result.context.stock_review !== null) {
      const product = obj(obj(result.context.stock_review).product);
      if (["id", "name", "unit", "active", "version"].some(key => !same(product[key], catalog[key]))) invalid();
    }
    if ((writer === "record_native_dispense_return" || writer === "record_native_dispense_return_v2") && policy.clinic_retained_return_permitted !== true) invalid();
    const desiredBasis = result.kind === "correction" ? "annotation" : result.kind === "discrepancy" ? "discrepancy_assertion" : str(result.row.action ?? "").startsWith("retract_") ? "correction_assertion" : "physical_record";
    if (event.basis !== desiredBasis || context.basis === null) invalid();
    const canonicalResult = { version: number(result.kind === "return_v2" ? 2n : 1n), id: result.row.id, actor_id: result.row.actor_id,
      ...(result.kind === "dispense" || result.kind === "pickup" ? { operation: result.operation.operation } : {}), request: result.operation.request, request_hash: result.operation.request_hash, result: result.operation.result, created_at: result.operation.created_at };
    if (!same(event.canonical_result, canonicalResult)) invalid();
    const derived = this.effects(event, result);
    if (!same(event.source_bundle, derived.bundle) || !same(event.source_effects, derived.effects)) invalid();
    const frozenPlan = arr(frozen.expected_effects).map(obj);
    if (frozenPlan.length !== derived.plan.length) invalid();
    const expected = new Map<string, bigint>();
    const effectKey = (a: { lot_id: ExactJson; channel: string; dispense_id: ExactJson; intake_id: ExactJson }) => [a.lot_id, a.channel, a.dispense_id ?? "", a.intake_id ?? ""].join("|");
    for (let i = 0; i < derived.plan.length; i++) {
      const a = derived.plan[i], f = frozenPlan[i], key = effectKey(a);
      if (expected.has(key) || f.lot_id !== a.lot_id || f.channel !== a.channel || f.dispense_id !== a.dispense_id || f.intake_id !== a.intake_id || reviewContextQuantity(str(f.quantity_delta)) !== a.q) invalid();
      expected.set(key, a.q);
    }
    const links = this.list("public.controlled_stock_source_links", "event_id", event.id), available = arr(obj(derived.effects).available).map(obj), native = obj(obj(derived.bundle).native), nativeField = native.kind === "return" ? "return_event_id" : native.kind === "pickup" ? "pickup_id" : native.kind === "correction" ? "correction_event_id" : native.kind === "discrepancy" ? "discrepancy_event_id" : null;
    if (links.length !== available.length + (nativeField ? 1 : 0)) invalid();
    const seenLinks = new Set<string>();
    for (const l of links) {
      const fields = ["movement_id", "return_event_id", "pickup_id", "correction_event_id", "discrepancy_event_id"].filter(k => l[k] !== null);
      if (fields.length !== 1) invalid(); const field = fields[0], key = field + ":" + str(l[field]);
      if (seenLinks.has(key)) invalid(); seenLinks.add(key);
      if (field === "movement_id" ? !available.some(a => a.id === l.movement_id) : field !== nativeField || l[field] !== event.id) invalid();
    }
    const containers = arr(context.containers).map(obj), frames = arr(frozen.containers).map(obj), actualTransitions = this.list("public.controlled_stock_container_transitions", "event_id", event.id), actualLines = this.list("public.controlled_stock_event_lines", "event_id", event.id);
    if (containers.length !== frames.length || containers.length !== actualTransitions.length || actualLines.length > 200) invalid();
    const plannedLots = new Set<string>(), frozenLots = arr(frozen.lots).map(obj), actualTotals = new Map<string, bigint>(), consumedLines = new Set<NativeObject>();
    let lineCount = 0;
    for (let i = 0; i < containers.length; i++) {
      const c = containers[i], frame = frames[i], container = this.need("public.controlled_stock_containers", c.id), transitions = actualTransitions.filter(t => t.container_id === c.id);
      if (frame.id !== c.id || reviewJsonbTextBytes(frame) > 131072 || transitions.length !== 1 || container.product_id !== event.product_id || container.stock_unit !== policy.stock_unit ||
        (container.opening_id === null) === (container.created_event_id === null) || container.opening_id !== null && container.opening_id !== event.opening_id) invalid();
      nativeText(200, false).parse(container.label);
      const transition = transitions[0], after = obj(c.after), created = c.create === null ? null : obj(c.create), beforeVersion = c.expected_version === null ? 0n : count(c.expected_version, 2147483647n);
      if (count(transition.version_before) !== beforeVersion || count(transition.version_after) !== beforeVersion + 1n || !same(after, { status: transition.after_status, location_id: transition.after_location_id, custodian_id: transition.after_custodian_id })) invalid();
      let before: NativeObject;
      if (created) {
        if (writer !== "record_native_dispense" || c.expected_version !== null || created.kind !== "prepared" || created.stock_lot_id !== null || frame.container !== null || frame.head !== null || arr(frame.cells).length ||
          container.created_event_id !== event.id || container.actor_id !== event.actor_id || container.session_id !== event.session_id || container.kind !== created.kind || container.stock_lot_id !== null ||
          container.controlling_site_id !== created.site_id || container.label !== created.label || container.initial_location_id !== created.location_id || container.initial_custodian_id !== created.custodian_id ||
          !same(after, { status: "onsite", location_id: created.location_id, custodian_id: created.custodian_id })) invalid();
        before = { status: "onsite", location_id: created.location_id, custodian_id: created.custodian_id };
      } else {
        if (c.expected_version === null || !same(frame.container, container)) invalid();
        const head = obj(frame.head);
        if (head.container_id !== c.id || count(head.version) !== beforeVersion || (beforeVersion === 0n) !== (head.last_event_id === null)) invalid();
        before = { status: head.status, location_id: head.location_id, custodian_id: head.custodian_id };
        if (before.status === "onsite" ? before.location_id === null : before.location_id !== null || before.custodian_id !== null) invalid();
        if (beforeVersion === 0n && !same(before, { status: "onsite", location_id: container.initial_location_id, custodian_id: container.initial_custodian_id })) invalid();
        if (writer === "record_native_pickup") {
          if (container.kind !== "prepared" || !same(after, { status: "handed_off", location_id: null, custodian_id: null })) invalid();
        } else if (["record_native_dispense_return", "record_native_dispense_return_v2"].includes(writer) && result.row.action === "dispose" && container.kind === "prepared" && after.status === "disposed") {
          if (after.location_id !== null || after.custodian_id !== null) invalid();
        } else if (writer === "record_native_dispense_return_v2" && result.row.action === "retract_disposal" && before.status === "disposed" && container.kind === "prepared" && after.status === "onsite") {
          if (after.location_id === null) invalid();
        } else if (!same(after, before)) invalid();
        if (writer === "record_native_dispense" && container.kind === "prepared") invalid();
      }
      if (!same(before, { status: transition.before_status, location_id: transition.before_location_id, custodian_id: transition.before_custodian_id })) invalid();
      const positions = new Map<string, { cell: NativeObject; q: bigint }>(); let priorCell = "";
      for (const slot of arr(frame.cells).map(obj)) {
        const cell = obj(slot.cell), position = obj(slot.position), q = numeric(position.quantity);
        if (str(cell.id) <= priorCell || position.cell_id !== cell.id || cell.container_id !== c.id || q < 0n || numeric(cell.opening_quantity) < 0n ||
          (cell.opening_id === null) === (cell.created_event_id === null) || cell.opening_id !== null && cell.opening_id !== container.opening_id || cell.created_event_id !== null && numeric(cell.opening_quantity) !== 0n) invalid();
        priorCell = str(cell.id); this.cellIdentity(cell, container); const key = this.cellKey(cell);
        if (positions.has(key)) invalid(); positions.set(key, { cell, q });
      }
      if (before.status !== "onsite" && [...positions.values()].some(p => p.q !== 0n)) invalid();
      const unique = new Set<string>(), perLot = new Map<string, bigint[]>();
      for (const descriptor of arr(c.lines).map(obj)) {
        lineCount++; const q = reviewContextQuantity(str(descriptor.quantity_delta)), key = this.cellKey(descriptor), effect = effectKey({ lot_id: descriptor.lot_id, channel: str(descriptor.channel), dispense_id: descriptor.dispense_id, intake_id: descriptor.intake_id }), targetDelta = expected.get(effect);
        if (unique.has(key) || targetDelta === undefined || (q > 0n) !== (targetDelta > 0n) || created && q <= 0n) invalid(); unique.add(key); plannedLots.add(str(descriptor.lot_id));
        actualTotals.set(effect, (actualTotals.get(effect) ?? 0n) + q);
        const matches = actualLines.filter(l => {
          const cell = this.need("public.controlled_stock_cells", l.cell_id); return cell.container_id === c.id && this.cellKey(cell) === key;
        });
        if (matches.length !== 1) invalid(); const line = matches[0], cell = this.need("public.controlled_stock_cells", line.cell_id), previous = positions.get(key);
        this.cellIdentity(cell, container);
        if (consumedLines.has(line) || numeric(line.quantity_delta) !== q || count(line.container_version_before) !== beforeVersion || count(line.container_version_after) !== beforeVersion + 1n ||
          (previous ? !same(previous.cell, cell) : q <= 0n || cell.created_event_id !== event.id || cell.opening_id !== null || numeric(cell.opening_quantity) !== 0n)) invalid(); consumedLines.add(line);
        const afterQ = (previous?.q ?? 0n) + q;
        if (afterQ < 0n || afterQ > 99999999999999n) invalid(); positions.set(key, { cell, q: afterQ });
        const source = this.need("public.controlled_stock_source_links", line.source_link_id);
        const original = descriptor.dispense_id === null ? null : this.list("public.native_dispense_allocations", "dispense_id", descriptor.dispense_id).find(a => a.lot_id === descriptor.lot_id) ?? invalid();
        if (source.event_id !== event.id || (descriptor.channel === "available" ? source.movement_id === null || this.need("public.inventory_movements", source.movement_id).lot_id !== descriptor.lot_id : native.kind === "dispense" ? source.movement_id !== original!.movement_id : nativeField === null || source[nativeField] !== event.id)) invalid();
        if (str(result.row.action ?? "").startsWith("retract_")) {
          const targetId = obj(result.document.correction_target).event_id, originals = this.list("public.controlled_stock_event_lines", "event_id", targetId).filter(l => l.cell_id === cell.id);
          const originalQ = originals.reduce((n, l) => n + numeric(l.quantity_delta), 0n);
          if (!originals.length || (q > 0n) === (originalQ > 0n) || (q < 0n ? -q : q) > (originalQ < 0n ? -originalQ : originalQ)) invalid();
        }
        const pair = perLot.get(str(descriptor.lot_id)) ?? [0n, 0n];
        if (descriptor.channel === "prepared") pair[0] += q; if (descriptor.channel === "return_held") pair[1] += q; perLot.set(str(descriptor.lot_id), pair);
      }
      if (after.status !== "onsite" && [...positions.values()].some(p => p.q !== 0n)) invalid();
      if (["intake", "retract_intake"].includes(str(result.row.action ?? "")) && [...perLot.values()].some(([prepared, held]) => prepared !== -held)) invalid();
    }
    if (lineCount > 200 || consumedLines.size !== actualLines.length || actualTotals.size !== expected.size || [...expected].some(([key, q]) => actualTotals.get(key) !== q) || frozenLots.length !== plannedLots.size) invalid();
    const seenLots = new Set<string>(); let previousLot = "";
    for (const frame of frozenLots) {
      const id = str(frame.id), lot = this.need("public.inventory_lots", frame.id);
      if (id <= previousLot || !plannedLots.has(id) || seenLots.has(id) || !same(frame.lot, lot) || lot.product_id !== event.product_id) invalid(); previousLot = id; seenLots.add(id);
      const availableBefore = reviewSnapshotTotalThousandths(str(frame.available)), debit = derived.plan.filter(a => a.channel === "available" && a.lot_id === id).reduce((n, a) => n + a.q, 0n);
      if (availableBefore + debit < 0n) invalid();
      if (result.kind === "dispense") {
        const nativeLot = arr(result.context.lots).map(obj).find(l => l.id === id) ?? invalid();
        if (quantity(nativeLot.balance, true) !== availableBefore || frame.native_hold !== false) invalid();
      }
      if (result.kind === "return_v1" || result.kind === "return_v2") {
        if (result.row.action === "restock" && frame.native_hold !== false) invalid();
        const review = result.context.stock_review;
        if (review !== null) { const nativeLot = arr(obj(review).lots).map(obj).find(l => l.lot_id === id); if (nativeLot && quantity(nativeLot.balance, true) !== availableBefore) invalid(); }
      }
    }
  }
  private cellKey(cell: NativeObject): string { return [cell.lot_id, cell.channel, cell.dispense_id ?? "", cell.intake_id ?? ""].join("|"); }
  private cellIdentity(cell: NativeObject, container: NativeObject): void {
    const lot = this.need("public.inventory_lots", cell.lot_id);
    if (lot.product_id !== this.packet.event.product_id || cell.container_id !== undefined && cell.container_id !== container.id) invalid();
    if (container.kind === "stock") {
      if (cell.channel !== "available" || container.stock_lot_id !== cell.lot_id || cell.dispense_id !== null || cell.allocation_id !== null || cell.intake_id !== null) invalid();
    } else if (container.kind === "prepared") {
      if (container.stock_lot_id !== null || !["prepared", "return_held"].includes(str(cell.channel)) || cell.dispense_id === null || (cell.channel === "prepared") !== (cell.intake_id === null)) invalid();
      const allocations = this.list("public.native_dispense_allocations", "dispense_id", cell.dispense_id).filter(a => a.lot_id === cell.lot_id);
      if (allocations.length !== 1 || cell.allocation_id !== allocations[0].id) invalid();
    } else invalid();
  }
  private async openingSite(main: NativeResult): Promise<ExactJson> {
    const event = this.packet.event, did = main.row.dispense_id, opening = this.need("public.controlled_stock_openings", event.opening_id), policy = this.need("public.controlled_stock_policy_versions", event.policy_version_id);
    const boundary = arr(opening.native_custody_boundary);
    if (boundary.length > 200 || reviewJsonbTextBytes(boundary) > 1048576 || opening.product_id !== event.product_id || this.optional("public.controlled_stock_events", did)) invalid();
    const entries = boundary.map(obj).filter(e => e.dispense_id === did);
    if (entries.length !== 1) invalid(); const entry = entries[0]; nativeOpeningEntrySchema.parse(entry);
    this.visible.head("opening.entry.return_head", did, entry.return_head);
    this.visible.head("opening.entry.correction_head", did, entry.correction_head);
    this.visible.head("opening.entry.discrepancy_head", did, entry.discrepancy_head);
    const dispense = this.need(nativeRelations.dispense, did), operation = this.need(opRelations.dispense, did), document = obj(dispense.document), allocations = this.list("public.native_dispense_allocations", "dispense_id", did);
    if (entry.dispense_document_hash !== await hashReviewNativeDocument("dispense", document) || entry.dispense_operation_hash !== await hashReviewNativeFulfillmentReceipt({ version: number(1n), ...operation }) ||
      integer(obj(entry.return_head).version) !== 0n || integer(obj(entry.discrepancy_head).version) !== 0n || entry.pickup !== null ||
      integer(main.row.sequence, 1n) <= integer(obj(entry.correction_head).version) || document.unit !== policy.stock_unit || arr(entry.allocations).length !== allocations.length) invalid();
    const boundaryHead = obj(entry.correction_head), boundaryVersion = integer(boundaryHead.version);
    // One family/sequence or one non-null immutable UUID denotes one head.
    // Different UUIDs at different versions may name legitimate omitted gaps.
    const currentHead = obj(main.context.head);
    if ((boundaryVersion === integer(currentHead.version) || boundaryHead.event_id !== null && boundaryHead.event_id === currentHead.event_id) && !same(boundaryHead, currentHead)) invalid();
    for (const row of this.list(nativeRelations.correction)) {
      if (!(row.id === boundaryHead.event_id || row.dispense_id === did && integer(row.sequence, 1n) === boundaryVersion)) continue;
      if (row.dispense_id !== did || row.authorization_id !== dispense.authorization_id || row.pet_id !== dispense.pet_id ||
        row.id !== boundaryHead.event_id || !same(row.sequence, boundaryHead.version) || row.record_hash !== boundaryHead.record_hash ||
        !["clinical_annotation", "operational_annotation"].includes(str(row.kind)) || stamp(row.created_at) > stamp(main.row.created_at)) invalid();
      // Every supplied row's full document/operation/context/hash/source binding
      // was checked by document(); no historical actor is reauthorized today.
    }
    const wanted = new Map<string, bigint>(), sums = new Map<string, bigint>(), sites = new Set<string>(), zeroSites = new Set<string>();
    for (const a of arr(entry.allocations).map(obj)) {
      const original = allocations.find(x => x.id === a.allocation_id) ?? invalid();
      if (a.lot_id !== original.lot_id || quantity(a.dispensed_quantity) !== numeric(original.quantity) || quantity(a.prepared_quantity, true) !== numeric(original.quantity) || arr(a.held).length) invalid();
      wanted.set(str(a.allocation_id), quantity(a.prepared_quantity, true));
    }
    const cells = this.list("public.controlled_stock_cells").filter(c => c.opening_id === opening.id && c.dispense_id === did && c.channel === "prepared");
    if (cells.length > 512) invalid();
    for (const cell of cells) {
      const box = this.need("public.controlled_stock_containers", cell.container_id), a = allocations.find(a => a.id === cell.allocation_id) ?? invalid(), q = numeric(cell.opening_quantity);
      if (!wanted.has(str(a.id)) || cell.lot_id !== a.lot_id || cell.intake_id !== null || cell.created_event_id !== null || q < 0n ||
        box.opening_id !== opening.id || box.product_id !== event.product_id || box.stock_unit !== policy.stock_unit || box.kind !== "prepared" || box.stock_lot_id !== null || box.created_event_id !== null) invalid();
      sums.set(str(a.id), (sums.get(str(a.id)) ?? 0n) + q); (q > 0n ? sites : zeroSites).add(canonicalId(box.controlling_site_id));
    }
    if (sites.size !== 1 || [...zeroSites].some(site => !sites.has(site)) || [...wanted].some(([id, q]) => (sums.get(id) ?? 0n) !== q)) invalid();
    // Complete initial opening/prefix membership and original opening-policy PK
    // are omitted source facts established by admitted backend H0/W validators.
    return [...sites][0];
  }
  async validate(): Promise<void> {
    for (const kind of Object.keys(nativeRelations) as Kind[]) for (const row of this.list(nativeRelations[kind])) await this.document(kind, row);
    this.visibleFacts();
    for (const event of this.list("public.controlled_stock_events")) await this.controlled(event);
    const event = this.packet.event, adapter = this.packet.adapter;
    const main = await this.resultForEvent(obj(event));
    const did = main.kind === "dispense" ? main.row.id : main.row.dispense_id;
    if (adapter.adapter_id !== nativeEventKinds[adapter.event_kind as keyof typeof nativeEventKinds] || adapter.native_family_dispense_id !== (["dispense", "pickup"].includes(main.kind) ? did : null)) invalid();
    const eventSite = (id: ExactJson): ExactJson => {
      const transitions = this.list("public.controlled_stock_container_transitions", "event_id", id);
      const sites = new Set(transitions.map(t => str(this.need("public.controlled_stock_containers", t.container_id).controlling_site_id)));
      if (sites.size !== 1 || !this.list("public.controlled_stock_event_lines", "event_id", id).length) invalid(); return [...sites][0];
    };
    let expectedBasis = "event_transitions", site: ExactJson;
    if (main.kind === "correction") {
      if (this.optional("public.controlled_stock_events", did)) { expectedBasis = "managed_dispense"; site = eventSite(did); }
      else if (main.row.kind === "pickup_amendment" && this.optional("public.controlled_stock_events", obj(main.document.pickup_amendment).original_pickup_id)) { expectedBasis = "managed_pickup"; site = eventSite(obj(main.document.pickup_amendment).original_pickup_id); }
      else if (["clinical_annotation", "operational_annotation"].includes(str(main.row.kind))) { expectedBasis = "opening_custody_site"; site = await this.openingSite(main); }
      else invalid();
    } else if (main.kind === "discrepancy") { expectedBasis = "managed_return"; site = eventSite(obj(main.document.source).event_id); }
    else site = eventSite(event.id);
    if (adapter.site_basis !== expectedBasis || adapter.site_id !== site || this.list("public.controlled_stock_containers").some(c => c.controlling_site_id !== site)) invalid();
  }
}
