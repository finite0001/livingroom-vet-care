import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { decodeExactJson, ExactJsonNumber, type ExactJson } from "../../src/hub/features/controlled-drugs/record-review/exact-json.ts";
import { verifyPreparedReview } from "../../src/hub/features/controlled-drugs/record-review/prepared-packet.ts";
import { hashReviewEvent, hashReviewObligation, hashReviewParentRequest, hashReviewPreparationContext, hashReviewSourceRow, hashReviewTarget } from "../../src/hub/features/controlled-drugs/record-review/component-hashes.ts";
import { verifyProspectiveStockMovement } from "../../src/hub/features/controlled-drugs/record-review/prospective-stock-movement.ts";
import { prospectiveSourceShapes } from "../../src/hub/features/controlled-drugs/record-review/prospective-source-shapes.ts";
import type { RecordReviewRequest } from "../../src/hub/features/controlled-drugs/record-review/request.ts";

interface MutableObject { [key: string]: MutableJson }
type MutableJson = null | boolean | string | ExactJsonNumber | MutableJson[] | MutableObject;
const reference = readFileSync(new URL("./record-review-stock-movement-reference.json", import.meta.url));
const referenceHash = "60bf756a1f311ea9dee213b253040adb3859af78564f25fac213a550b8eb32a9";
const number = (value: string) => new ExactJsonNumber(value);
function object(value: MutableJson): MutableObject { return value as MutableObject; }
function array(value: MutableJson): MutableJson[] { return value as MutableJson[]; }
function clone(value: ExactJson): MutableJson {
  if (value === null || typeof value !== "object" || value instanceof ExactJsonNumber) return value;
  if (Array.isArray(value)) return value.map(clone);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
}
/** Byte-exact synthetic response from PG17.6 through real local HTTP. The source
 * prototype's final audit-accounting check failed; this is component/DTO parity
 * evidence only, never complete Auth/protocol/production acceptance. No tokens,
 * passwords, real clinic identities or patient information are in this file.
 */
function fixture() {
  const envelope = object(clone(decodeExactJson(reference))), data = object(envelope.data), packet = object(data.packet);
  const request = object(data.request) as unknown as RecordReviewRequest;
  const sources = array(packet.source_rows).map(object);
  const rows = (relation: string) => sources.filter(source => source.relation === relation).map(source => object(source.row));
  function row(relation: string): MutableObject { const found = rows(relation); assert.equal(found.length, 1); return found[0]; }
  const event = row("public.controlled_stock_events"), preparation = row("public.controlled_stock_preparations"), action = row("public.controlled_stock_actions");
  const context = object(preparation.context), frozen = object(preparation.frozen), adapter = object(packet.adapter), obligation = object(packet.obligation);
  async function recommit() {
    // Test-only: make commitments internally consistent before testing semantic
    // cross-bindings. This deliberately supplies no genuine database authority.
    preparation.request_hash = await hashReviewParentRequest(preparation);
    event.context_hash = await hashReviewPreparationContext(preparation);
    event.clinical_snapshot = { catalog: frozen.catalog, original_result: event.canonical_result };
    event.record_hash = await hashReviewEvent(event);
    packet.event = event; packet.parent_preparation = preparation; packet.original_result = event.canonical_result; packet.clinical_snapshot = event.clinical_snapshot;
    packet.target = { event_id: event.id, product_id: event.product_id, sequence: event.sequence, record_hash: event.record_hash,
      original_actor_id: event.actor_id, policy_version_id: event.policy_version_id, opening_id: event.opening_id, engine_revision: event.engine_revision };
    adapter.target = packet.target; obligation.target = packet.target; obligation.adapter = adapter; obligation.site_id = adapter.site_id;
    obligation.target_hash = await hashReviewTarget(packet.target);
    action.request_hash = preparation.request_hash;
    const transitions = rows("public.controlled_stock_container_transitions").sort((a, b) => String(a.container_id) < String(b.container_id) ? -1 : 1);
    action.receipt = { version: number("1"), id: event.id, writer: event.writer, actor_id: event.actor_id, canonical_result: event.canonical_result,
      event, containers: transitions.map(transition => ({ container_id: transition.container_id, version: transition.version_after,
        location_id: transition.after_location_id, custodian_id: transition.after_custodian_id, status: transition.after_status, last_event_id: transition.event_id })) };
    const refs: MutableObject[] = [];
    for (const source of sources) {
      const shape = prospectiveSourceShapes[String(source.relation) as keyof typeof prospectiveSourceShapes], retained = object(source.row);
      source.key = Object.fromEntries(shape.key.map(key => [key, retained[key]]));
    }
    sources.sort((a, b) => (String(a.relation) + "\n" + JSON.stringify(a.key)) < (String(b.relation) + "\n" + JSON.stringify(b.key)) ? -1 : 1);
    packet.source_rows = sources;
    for (const source of sources) refs.push({ relation: source.relation, key: source.key, role: "reviewed_target",
      row_hash: await hashReviewSourceRow(String(source.relation), source.row) });
    adapter.source_refs = refs;
    for (const [field, relation] of Object.entries({ event_lines: "public.controlled_stock_event_lines", cells: "public.controlled_stock_cells",
      transitions: "public.controlled_stock_container_transitions", containers: "public.controlled_stock_containers" })) packet[field] = rows(relation);
    obligation.binding_hash = await hashReviewObligation(obligation);
  }
  async function check() {
    const pointer = { version: 3 as const, actor_id: request.actor_id, operation_id: request.operation_id, transport_digest: String(data.transport_digest) };
    await verifyPreparedReview(pointer, envelope, { validate: verifyProspectiveStockMovement }, () => {}, request);
  }
  return { packet, sources, rows, row, event, preparation, action, context, frozen, adapter, obligation, recommit, check };
}

test("actual synthetic PG17.6 HTTP packet passes full envelope and scoped stock checks", async () => {
  assert.equal(createHash("sha256").update(reference).digest("hex"), referenceHash);
  await fixture().check();
});
test("scalar split, provenance, site, hold and graph mutations still refuse after recommitting their hashes", async t => {
  const changes = {
    wrong_split_total(f) {
      object(array(object(array(f.context.containers)[0]).lines)[0]).quantity_delta = "-0.500";
      f.row("public.controlled_stock_event_lines").quantity_delta = number("-0.500");
    },
    wrong_original_actor(f) { f.row("public.stock_movement_sources").actor_id = f.obligation.event_id; },
    wrong_site(f) { f.adapter.site_id = f.obligation.event_id; },
    native_hold(f) { object(array(f.frozen.lots)[0]).native_hold = true; },
    insufficient_physical_position(f) {
      const frame = object(array(f.frozen.containers)[0]); object(object(array(frame.cells)[0]).position).quantity = number("0");
    },
    missing_referenced_cell(f) { f.sources.splice(f.sources.findIndex(source => source.relation === "public.controlled_stock_cells"), 1); },
    extra_unreachable_lot(f) {
      const extra = clone(f.row("public.inventory_lots") as ExactJson) as MutableObject; extra.id = f.obligation.event_id;
      f.sources.push({ relation: "public.inventory_lots", key: { id: extra.id }, row: extra });
    },
    empty_policy_reference(f) { f.row("public.controlled_stock_policy_versions").review_reference = ""; },
    invalid_opening_domain_shape(f) { f.row("public.controlled_stock_openings").native_custody_boundary = {}; },
    changed_container_version(f) { f.row("public.controlled_stock_container_transitions").version_after = number("9"); },
  };
  for (const [name, change] of Object.entries(changes)) await t.test(name, async () => {
    const f = fixture(); change(f); await f.recommit(); await assert.rejects(f.check());
  });
});
test("equivalent numeric JSON aliases preserve independent commitments and stay valid", async () => {
  const f = fixture(); object(f.event.canonical_result).quantity = number("-1.0000");
  await f.recommit(); await f.check();
});

function receivingFixture(newLot: boolean) {
  // Construct local-consistency branches from synthetic components. These are
  // not additional backend/Auth executions or claims about historical selection.
  const f = fixture(), lot = f.row("public.inventory_lots"), movement = f.row("public.inventory_movements");
  const container = f.row("public.controlled_stock_containers"), cell = f.row("public.controlled_stock_cells");
  const descriptor = object(array(f.context.containers)[0]), frame = object(array(f.frozen.containers)[0]), lotFrame = object(array(f.frozen.lots)[0]);
  f.event.writer = f.event.event_kind = f.preparation.writer = f.action.writer = f.adapter.event_kind = "receive_inventory";
  f.row("public.stock_movement_sources").writer = "receive_inventory";
  f.preparation.canonical_arguments = { lot_id: lot.id, product_id: lot.product_id, lot_number: lot.lot_number, expires_on: lot.expires_on,
    location: lot.location, quantity: "1.0", reason: movement.reason };
  movement.quantity = number("1.000"); movement.kind = "receive"; f.event.canonical_result = movement;
  for (const value of [object(f.event.source_bundle), object(f.event.source_effects)]) {
    value.writer = "receive_inventory"; const available = object(array(value.available)[0]); available.quantity_delta = "1.000"; available.native_kind = "receive";
  }
  f.frozen.permission = object(f.row("public.controlled_stock_policy_versions").permissions).receive_inventory;
  object(array(f.frozen.expected_effects)[0]).quantity_delta = "1.000";
  descriptor.expected_version = null;
  descriptor.create = { kind: "stock", label: container.label, stock_lot_id: lot.id, site_id: container.controlling_site_id,
    location_id: container.initial_location_id, custodian_id: container.initial_custodian_id };
  descriptor.after = { status: "onsite", location_id: container.initial_location_id, custodian_id: container.initial_custodian_id };
  object(array(descriptor.lines)[0]).quantity_delta = "1.00";
  frame.container = frame.head = null; frame.cells = [];
  container.opening_id = null; container.created_event_id = f.event.id; container.actor_id = f.event.actor_id; container.session_id = f.event.session_id;
  cell.opening_id = null; cell.created_event_id = f.event.id; cell.opening_quantity = number("0.000");
  f.row("public.controlled_stock_event_lines").quantity_delta = number("1.000");
  if (newLot) { lotFrame.lot = null; lotFrame.available = "0"; lot.created_by = f.event.actor_id; lot.created_at = movement.created_at; }
  else { lot.created_by = f.obligation.event_id; lot.created_at = "2000-01-01T00:00:00Z"; lotFrame.lot = lot; }
  lotFrame.native_hold = true; // Receiving may add stock while a native hold exists.
  return f;
}
test("receiving supports both new lots and unchanged reused lots with another original creator", async () => {
  for (const newLot of [true, false]) { const f = receivingFixture(newLot); await f.recommit(); await f.check(); }
});
test("new receiving lots must bind the creator and exact canonical transaction time", async () => {
  for (const field of ["created_by", "created_at"] as const) {
    const f = receivingFixture(true), lot = f.row("public.inventory_lots");
    lot[field] = field === "created_by" ? f.obligation.event_id : "2000-01-01T00:00:00Z";
    await f.recommit(); await assert.rejects(f.check());
  }
});
test("positive adjustment may create a new cell in an existing empty stock container", async () => {
  const f = fixture(), movement = f.row("public.inventory_movements"), cell = f.row("public.controlled_stock_cells");
  object(f.preparation.canonical_arguments).quantity = "1"; movement.quantity = number("1.000"); f.event.canonical_result = movement;
  object(array(object(array(f.context.containers)[0]).lines)[0]).quantity_delta = "1.0";
  object(array(f.frozen.expected_effects)[0]).quantity_delta = "1.000";
  object(array(f.frozen.containers)[0]).cells = [];
  cell.id = "00000000-0000-4000-8000-000000000001"; cell.opening_id = null; cell.created_event_id = f.event.id; cell.opening_quantity = number("0");
  const line = f.row("public.controlled_stock_event_lines"); line.cell_id = cell.id; line.quantity_delta = number("1.000");
  for (const value of [object(f.event.source_bundle), object(f.event.source_effects)]) object(array(value.available)[0]).quantity_delta = "1.000";
  await f.recommit(); await f.check();
});

function addEmptyStockDescriptor(f: ReturnType<typeof fixture>) {
  const container = clone(f.row("public.controlled_stock_containers") as ExactJson) as MutableObject;
  container.id = "00000000-0000-4000-8000-000000000002";
  const transition = clone(f.row("public.controlled_stock_container_transitions") as ExactJson) as MutableObject;
  transition.id = "00000000-0000-4000-8000-000000000003"; transition.container_id = container.id;
  const descriptor: MutableObject = { id: container.id, expected_version: number("0"), create: null,
    after: { status: "onsite", location_id: container.initial_location_id, custodian_id: container.initial_custodian_id }, lines: [] };
  const frame: MutableObject = { id: container.id, container,
    head: { container_id: container.id, version: number("0"), location_id: container.initial_location_id,
      custodian_id: container.initial_custodian_id, status: "onsite", last_event_id: null }, cells: [] };
  array(f.context.containers).push(descriptor); array(f.context.containers).sort((a, b) => String(object(a).id) < String(object(b).id) ? -1 : 1);
  array(f.frozen.containers).push(frame); array(f.frozen.containers).sort((a, b) => String(object(a).id) < String(object(b).id) ? -1 : 1);
  f.sources.push({ relation: "public.controlled_stock_containers", key: { id: container.id }, row: container },
    { relation: "public.controlled_stock_container_transitions", key: { id: transition.id }, row: transition });
  return { descriptor, container };
}
test("empty stock descriptors remain in transitions and receipt without inventing a line", async () => {
  const f = fixture(); addEmptyStockDescriptor(f); await f.recommit(); await f.check();
});
test("opposing physical splits cannot net to the requested adjustment", async () => {
  const f = fixture(), originalLine = f.row("public.controlled_stock_event_lines"), originalCell = f.row("public.controlled_stock_cells");
  object(array(object(array(f.context.containers)[0]).lines)[0]).quantity_delta = "-1.500"; originalLine.quantity_delta = number("-1.500");
  const { descriptor, container } = addEmptyStockDescriptor(f);
  const cell = clone(originalCell as ExactJson) as MutableObject, line = clone(originalLine as ExactJson) as MutableObject;
  cell.id = "00000000-0000-4000-8000-000000000004"; cell.container_id = container.id;
  cell.opening_id = null; cell.created_event_id = f.event.id; cell.opening_quantity = number("0");
  line.id = "00000000-0000-4000-8000-000000000005"; line.cell_id = cell.id; line.quantity_delta = number("0.500");
  descriptor.lines = [{ lot_id: cell.lot_id, channel: "available", dispense_id: null, intake_id: null, quantity_delta: "0.500" }];
  f.sources.push({ relation: "public.controlled_stock_cells", key: { id: cell.id }, row: cell },
    { relation: "public.controlled_stock_event_lines", key: { id: line.id }, row: line });
  await f.recommit(); await assert.rejects(f.check());
});
