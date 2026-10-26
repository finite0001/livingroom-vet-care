import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { decodeExactJson, ExactJsonNumber, type ExactJson } from "../../src/hub/features/controlled-drugs/record-review/exact-json.ts";
import { verifyProspectiveNativeMovement } from "../../src/hub/features/controlled-drugs/record-review/prospective-native-movement.ts";
import { verifyProspectiveComponentConsistency } from "../../src/hub/features/controlled-drugs/record-review/prospective-component-consistency.ts";
import { hashReviewSourceRow, hashReviewEvent, hashReviewPreparationContext, hashReviewParentRequest, hashReviewTarget, hashReviewObligation,
  hashReviewNativeRecord, hashReviewNativeContext, hashReviewNativeArtifact, hashReviewNativeRequest } from "../../src/hub/features/controlled-drugs/record-review/component-hashes.ts";
import { type NativeWriter, type NativeDocumentKind } from "../../src/hub/features/controlled-drugs/record-review/native-movement-structure.ts";
import type { PreparedReviewPacket } from "../../src/hub/features/controlled-drugs/record-review/prepared-packet.ts";
export interface MutableObject { [key: string]: MutableJson }
export type MutableJson = null | string | boolean | ExactJsonNumber | MutableObject | MutableJson[];
interface FixturePin { file: string; bytes: number; sha256: string; event_kind: string }
const directory = new URL("./record-review-native-fixtures/", import.meta.url);
export const provenance = JSON.parse(readFileSync(new URL("provenance.json", directory), "utf8")) as { fixtures: FixturePin[] };
export const n = (value: string) => new ExactJsonNumber(value);
export const o = (value: MutableJson) => value as MutableObject;
export const a = (value: MutableJson) => value as MutableJson[];
export function clone(value: ExactJson): MutableJson {
  if (value === null || typeof value !== "object" || value instanceof ExactJsonNumber) return value;
  return Array.isArray(value) ? value.map(clone) : Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clone(v)]));
}
export function freeze<T>(value: T): T {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } return value;
}
export function fixture(index: number) {
  const raw = readFileSync(new URL(provenance.fixtures[index].file, directory));
  assert.equal(raw.length, provenance.fixtures[index].bytes); assert.equal(createHash("sha256").update(raw).digest("hex"), provenance.fixtures[index].sha256);
  const packet = o(o(o(clone(decodeExactJson(raw))).data).packet), sources = a(packet.source_rows).map(o);
  packet.source_rows = sources;
  const rows = (relation: string) => sources.filter(s => s.relation === relation).map(s => o(s.row));
  const row = (relation: string, id?: MutableJson): MutableObject => {
    const result = rows(relation).filter(r => id === undefined || r.id === id); assert.equal(result.length, 1); return result[0];
  };
  const event = row("public.controlled_stock_events", o(packet.event).id), preparation = row("public.controlled_stock_preparations", event.id), frozen = o(preparation.frozen), context = o(preparation.context), adapter = o(packet.adapter), obligation = o(packet.obligation);
  const native = (kind: string, id = event.id) => row("public.native_" + ({ dispense: "dispenses", pickup: "pickups", return: "return_events", correction: "dispense_correction_events", discrepancy: "return_discrepancy_events" }[kind]), id);
  async function recommit() {
    // Only test commitments are repaired. The domain facts stay mutated, so
    // verifyProspectiveComponentConsistency must pass before domain refusal.
    for (const kind of ["dispense", "pickup", "return", "correction", "discrepancy"] as const) {
      const relation = "public.native_" + ({ dispense: "dispenses", pickup: "pickups", return: "return_events", correction: "dispense_correction_events", discrepancy: "return_discrepancy_events" }[kind]);
      for (const retained of rows(relation)) {
        const document = o(retained.document), opRelation = kind === "dispense" || kind === "pickup" ? "public.native_fulfillment_operations" : "public.native_" + ({ return: "return_operations", correction: "dispense_correction_operations", discrepancy: "return_discrepancy_operations" }[kind]);
        const operation = row(opRelation, retained.id), documentKind: NativeDocumentKind = kind === "return" ? String(document.version) === "1" ? "return_v1" : "return_v2" : kind;
        const writer: NativeWriter = kind === "dispense" ? "record_native_dispense" : kind === "pickup" ? "record_native_pickup" : kind === "return" ? documentKind === "return_v1" ? "record_native_dispense_return" : "record_native_dispense_return_v2" : kind === "correction" ? "append_native_dispense_correction" : "record_native_return_discrepancy";
        if (kind === "pickup") document.reviewed_context = { ...o(document.reviewed_context), dispense: native("dispense", retained.dispense_id).document };
        const captured = kind === "dispense" || kind === "pickup" ? document.reviewed_context : retained.reviewed_context;
        document.reviewed_context_hash = await hashReviewNativeContext(documentKind as Exclude<NativeDocumentKind, "return_policy">, captured); o(operation.request).expected_context_hash = document.reviewed_context_hash;
        operation.request_hash = await hashReviewNativeRequest(writer, operation.actor_id, operation.request);
        if (kind === "dispense") { document.artifact_hash = await hashReviewNativeArtifact(document.artifact); o(operation.result).dispense = document; }
        else { if (kind !== "pickup") { document.record_hash = await hashReviewNativeRecord(documentKind as "return_v1" | "return_v2" | "correction" | "discrepancy", document); retained.record_hash = document.record_hash; } operation.result = document; }
      }
    }
    for (const retained of rows("public.controlled_stock_events")) {
      const parent = row("public.controlled_stock_preparations", retained.id), action = row("public.controlled_stock_actions", retained.id), kind = retained.writer === "record_native_dispense" ? "dispense" : retained.writer === "record_native_pickup" ? "pickup" : String(retained.writer).startsWith("record_native_dispense_return") ? "return" : retained.writer === "append_native_dispense_correction" ? "correction" : "discrepancy";
      const domain = native(kind, retained.id), document = o(domain.document), operation = row(kind === "dispense" || kind === "pickup" ? "public.native_fulfillment_operations" : "public.native_" + ({ return: "return_operations", correction: "dispense_correction_operations", discrepancy: "return_discrepancy_operations" }[kind]), retained.id);
      retained.canonical_result = { version: n(kind === "return" && String(document.version) === "2" ? "2" : "1"), id: operation.id, actor_id: operation.actor_id,
        ...(kind === "dispense" || kind === "pickup" ? { operation: operation.operation } : {}), request: operation.request, request_hash: operation.request_hash, result: operation.result, created_at: operation.created_at };
      o(parent.canonical_arguments).request = operation.request; o(parent.frozen).native = kind === "dispense" || kind === "pickup" ? document.reviewed_context : domain.reviewed_context;
      const bundle = o(o(retained.source_bundle).native); bundle.document = document;
      if (kind === "return") { const intake = native("return", domain.intake_id ?? domain.id); bundle.return_source = { action: domain.action, intake_id: intake.id, intake_document: intake.document, intake_reviewed_context: intake.reviewed_context }; }
      parent.request_hash = await hashReviewParentRequest(parent); retained.context_hash = await hashReviewPreparationContext(parent);
      retained.clinical_snapshot = { catalog: o(parent.frozen).catalog, original_result: retained.canonical_result }; retained.record_hash = await hashReviewEvent(retained);
      action.request_hash = parent.request_hash;
      const transitions = rows("public.controlled_stock_container_transitions").filter(t => t.event_id === retained.id).sort((x, y) => String(x.container_id).localeCompare(String(y.container_id)));
      action.receipt = { version: n("1"), id: retained.id, writer: retained.writer, actor_id: retained.actor_id, canonical_result: retained.canonical_result, event: retained,
        containers: transitions.map(t => ({ container_id: t.container_id, version: t.version_after, location_id: t.after_location_id, custodian_id: t.after_custodian_id, status: t.after_status, last_event_id: t.event_id })) };
    }
    const main = row("public.controlled_stock_events", event.id); packet.event = main; packet.parent_preparation = preparation; packet.original_result = main.canonical_result; packet.clinical_snapshot = main.clinical_snapshot;
    packet.target = { event_id: main.id, product_id: main.product_id, sequence: main.sequence, record_hash: main.record_hash, original_actor_id: main.actor_id, policy_version_id: main.policy_version_id, opening_id: main.opening_id, engine_revision: main.engine_revision };
    adapter.target = packet.target; obligation.target = packet.target; obligation.target_hash = await hashReviewTarget(packet.target); obligation.adapter = adapter; obligation.site_id = adapter.site_id;
    const refs = a(adapter.source_refs).map(o);
    for (let i = 0; i < sources.length; i++) refs[i].row_hash = await hashReviewSourceRow(String(sources[i].relation), sources[i].row);
    for (const [key, relation] of Object.entries({ event_lines: "public.controlled_stock_event_lines", cells: "public.controlled_stock_cells", transitions: "public.controlled_stock_container_transitions", containers: "public.controlled_stock_containers" })) packet[key] = rows(relation);
    obligation.binding_hash = await hashReviewObligation(obligation);
  }
  const input = () => freeze(clone(packet as ExactJson)) as unknown as PreparedReviewPacket;
  const target = () => Object.freeze({ event_id: String(event.id) });
  const component = () => verifyProspectiveComponentConsistency(input(), target());
  const check = () => verifyProspectiveNativeMovement(input(), target());
  return { packet, rows, row, native, event, preparation, context, frozen, adapter, obligation, recommit, check, component, sources };
}
