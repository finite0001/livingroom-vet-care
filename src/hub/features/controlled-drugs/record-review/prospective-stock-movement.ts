import { ExactJsonNumber, type ExactJson } from "./exact-json.ts";
import { reviewContextQuantity, reviewInstantMicroseconds, reviewQuantityThousandths, reviewSnapshotTotalThousandths } from "./exact-values.ts";
import { movementAdjustArgumentsSchema, movementContextSchema, movementFrozenSchema, movementReceiveArgumentsSchema } from "./movement-structure.ts";
import { verifyProspectiveComponentConsistency } from "./prospective-component-consistency.ts";
import { sameReviewJsonb as same } from "./jsonb-equality.ts";
import { reviewJsonbTextBytes, type PreparedReviewPacket } from "./prepared-packet.ts";
import type { ReviewEvidenceTarget } from "./request.ts";

interface EvidenceObject { readonly [key: string]: ExactJson }
function invalid(): never { throw new Error("Prospective stock movement evidence is inconsistent or outside the supported local scope"); }
function object(value: ExactJson): EvidenceObject {
  if (!value || typeof value !== "object" || Array.isArray(value) || value instanceof ExactJsonNumber) invalid();
  return value as EvidenceObject;
}
const number = (value: bigint) => new ExactJsonNumber(value.toString());
function integer(value: ExactJson): bigint {
  if (!(value instanceof ExactJsonNumber) || !/^(0|[1-9][0-9]*)$/.test(value.token)) invalid();
  return BigInt(value.token);
}
function quantity(value: ExactJson): bigint {
  if (!(value instanceof ExactJsonNumber)) invalid();
  return reviewQuantityThousandths(value);
}
function storedQuantityText(value: bigint): string {
  const absolute = value < 0n ? -value : value;
  return (value < 0n ? "-" : "") + (absolute / 1000n).toString() + "." + (absolute % 1000n).toString().padStart(3, "0");
}
function rawText(value: ExactJson, max: number): boolean {
  return typeof value === "string" && Array.from(value).length >= 1 && Array.from(value).length <= max;
}
function trimmedText(value: ExactJson, max: number): boolean {
  return typeof value === "string" && rawText(value.replace(/^ +| +$/g, ""), max);
}

/** Prospective stock-container-only receive/adjust LOCAL checker. Native kinds
 * and prepared-container descriptors are explicitly unsupported in this slice.
 * Does not establish database-wide enumeration, site registration, history,
 * original/current authorization or accepted backend/transport authority. Never
 * mount this as a permissive fallback for complete ReviewEvidenceAdmission.
 */
export async function verifyProspectiveStockMovement(packet: PreparedReviewPacket, request: Readonly<ReviewEvidenceTarget>): Promise<void> {
  await verifyProspectiveComponentConsistency(packet, request);
  const event = packet.event, preparation = packet.parent_preparation, receive = event.writer === "receive_inventory";
  if (!receive && event.writer !== "adjust_inventory") invalid();
  if (packet.adapter.adapter_id !== "movement_v1" || packet.adapter.site_basis !== "event_transitions" || packet.adapter.native_family_dispense_id !== null ||
    packet.adapter.source_refs.some(ref => ref.role !== "reviewed_target")) invalid();
  const args = receive ? movementReceiveArgumentsSchema.parse(preparation.canonical_arguments) : movementAdjustArgumentsSchema.parse(preparation.canonical_arguments);
  const context = movementContextSchema.parse(preparation.context), frozen = movementFrozenSchema.parse(preparation.frozen);
  if (reviewJsonbTextBytes(context) > 262144 || reviewJsonbTextBytes(preparation.canonical_arguments) > 131072 ||
    reviewJsonbTextBytes(frozen) > 1048576 || frozen.containers.some(frame => reviewJsonbTextBytes(frame) > 131072)) invalid();
  if (frozen.permission.witness !== "none" || frozen.catalog.id !== event.product_id || frozen.containers.length !== context.containers.length ||
    (receive && (!frozen.catalog.active || frozen.catalog.kind === "service"))) invalid();
  const q = reviewContextQuantity(args.quantity), selected = new Set<EvidenceObject>();
  if (receive && q <= 0n) invalid();
  function add(relation: string, id: ExactJson, field = "id"): EvidenceObject {
    const sources = packet.source_rows.filter(source => source.relation === relation && source.row[field] === id);
    if (sources.length !== 1) invalid();
    selected.add(sources[0].row); return sources[0].row;
  }
  add("public.controlled_stock_events", event.id); add("public.controlled_stock_actions", event.id); add("public.controlled_stock_preparations", event.id);
  const policy = add("public.controlled_stock_policy_versions", event.policy_version_id), opening = add("public.controlled_stock_openings", event.opening_id);
  const sequence = integer(event.sequence);
  if (sequence < 1n || (sequence === 1n) !== (event.prior_event_id === null) || (sequence === 1n) !== (event.prior_record_hash === null) ||
    (event.prior_record_hash !== null && (typeof event.prior_record_hash !== "string" || !/^[a-f0-9]{64}$/.test(event.prior_record_hash))) ||
    integer(policy.version) < 1n || !rawText(event.actor_name, 200) || !rawText(policy.stock_unit, 50) || !rawText(policy.review_reference, 2000) ||
    !Array.isArray(opening.native_custody_boundary) ||
    policy.product_id !== event.product_id || opening.product_id !== event.product_id || !same(policy.engine_revision, event.engine_revision) ||
    policy.stock_unit !== frozen.catalog.unit || !same(policy.identity_snapshot, { id: frozen.catalog.id, name: frozen.catalog.name,
      kind: frozen.catalog.kind, manufacturer: frozen.catalog.manufacturer, unit: frozen.catalog.unit }) ||
    !same(object(policy.permissions)[String(event.event_kind)], frozen.permission) ||
    reviewInstantMicroseconds(String(opening.observed_at)) > reviewInstantMicroseconds(String(event.observed_at)) ||
    reviewInstantMicroseconds(String(preparation.expires_at)) <= reviewInstantMicroseconds(String(preparation.created_at))) invalid();
  object(opening.count_evidence); // Intentionally opaque domain object, retained losslessly.
  const movement = add("public.inventory_movements", event.id), lot = add("public.inventory_lots", args.lot_id);
  const provenance = add("public.stock_movement_sources", event.id, "movement_id");
  if (movement.lot_id !== lot.id || lot.product_id !== event.product_id || !trimmedText(lot.lot_number, 200) || !trimmedText(lot.location, 200) ||
    quantity(movement.quantity) !== q || movement.kind !== (receive ? "receive" : "adjust") ||
    movement.reason !== args.reason || movement.created_by !== event.actor_id || provenance.writer !== event.writer || provenance.source_id !== event.id ||
    provenance.actor_id !== event.actor_id || !same(event.canonical_result, movement)) invalid();
  if (receive) {
    const received = movementReceiveArgumentsSchema.parse(args);
    if (received.product_id !== event.product_id || received.lot_number !== lot.lot_number || received.expires_on !== lot.expires_on || received.location !== lot.location) invalid();
  }
  const beforeLot = frozen.lots[0], expected = frozen.expected_effects[0];
  if (beforeLot.id !== lot.id || (beforeLot.lot === null ? !receive || reviewSnapshotTotalThousandths(beforeLot.available) !== 0n : !same(beforeLot.lot, lot)) ||
    (!receive && (beforeLot.native_hold || reviewSnapshotTotalThousandths(beforeLot.available) + q < 0n)) ||
    expected.lot_id !== lot.id || reviewContextQuantity(expected.quantity_delta) !== q) invalid();
  if (receive && beforeLot.lot === null && (lot.created_by !== event.actor_id ||
    reviewInstantMicroseconds(String(lot.created_at)) !== reviewInstantMicroseconds(String(movement.created_at)))) invalid();
  const available = [{ kind: "movement", id: movement.id, lot_id: lot.id, product_id: lot.product_id,
    quantity_delta: storedQuantityText(q), native_kind: movement.kind }];
  const identity = { version: number(1n), writer: event.writer, root: event.id, actor_id: event.actor_id, product_id: event.product_id };
  if (!same(event.source_bundle, { ...identity, available, native: null }) || !same(event.source_effects, { ...identity,
    basis: "stock_record", available, custody: [], requirements: {}, authorizes_execution: false })) invalid();
  const links = packet.source_rows.filter(source => source.relation === "public.controlled_stock_source_links");
  if (links.length !== 1) invalid();
  const link = add("public.controlled_stock_source_links", links[0].row.id);
  if (link.event_id !== event.id || link.movement_id !== event.id || ["return_event_id", "discrepancy_event_id", "pickup_id", "correction_event_id"].some(key => link[key] !== null)) invalid();
  if (packet.transitions.length !== context.containers.length) invalid();
  let total = 0n, lineCount = 0;
  for (let index = 0; index < context.containers.length; index++) {
    const descriptor = context.containers[index], frame = frozen.containers[index];
    const container = add("public.controlled_stock_containers", descriptor.id);
    const transitions = packet.transitions.filter(transition => transition.container_id === container.id && transition.event_id === event.id);
    if (frame.id !== descriptor.id || transitions.length !== 1 || !rawText(container.label, 200) || container.kind !== "stock" || container.stock_lot_id !== lot.id || container.product_id !== event.product_id ||
      container.stock_unit !== policy.stock_unit || container.controlling_site_id !== packet.adapter.site_id ||
      (container.opening_id === null) === (container.created_event_id === null) || (container.opening_id !== null && container.opening_id !== event.opening_id)) invalid();
    const transition = add("public.controlled_stock_container_transitions", transitions[0].id);
    const beforeVersion = descriptor.expected_version === null ? 0n : integer(descriptor.expected_version);
    if (integer(transition.version_before) !== beforeVersion || integer(transition.version_after) !== beforeVersion + 1n ||
      !same(descriptor.after, { status: transition.after_status, location_id: transition.after_location_id, custodian_id: transition.after_custodian_id })) invalid();
    let before: EvidenceObject;
    if (receive) {
      const created = descriptor.create;
      if (descriptor.expected_version !== null || !created || frame.container !== null || frame.head !== null || frame.cells.length ||
        container.created_event_id !== event.id || container.opening_id !== null || container.actor_id !== event.actor_id || container.session_id !== event.session_id ||
        container.label !== created.label || container.stock_lot_id !== created.stock_lot_id || container.controlling_site_id !== created.site_id ||
        container.initial_location_id !== created.location_id || container.initial_custodian_id !== created.custodian_id ||
        !same(descriptor.after, { status: "onsite", location_id: created.location_id, custodian_id: created.custodian_id })) invalid();
      before = { status: "onsite", location_id: created.location_id, custodian_id: created.custodian_id };
    } else {
      if (descriptor.expected_version === null || descriptor.create !== null || !frame.container || !frame.head || !same(frame.container, container) ||
        frame.head.container_id !== container.id || integer(frame.head.version) !== beforeVersion || frame.cells.length > 1) invalid();
      before = { status: frame.head.status, location_id: frame.head.location_id, custodian_id: frame.head.custodian_id };
      if (!same(descriptor.after, before) || (beforeVersion === 0n && !same(before, { status: "onsite", location_id: container.initial_location_id, custodian_id: container.initial_custodian_id }))) invalid();
    }
    if (!same(before, { status: transition.before_status, location_id: transition.before_location_id, custodian_id: transition.before_custodian_id })) invalid();
    let beforeQuantity = 0n;
    const previous = frame.cells[0];
    if (previous) {
      const cell = previous.cell;
      if (cell.container_id !== container.id || cell.lot_id !== lot.id || cell.channel !== "available" ||
        ["dispense_id", "allocation_id", "intake_id"].some(key => cell[key] !== null) || previous.position.cell_id !== cell.id ||
        (cell.opening_id === null) === (cell.created_event_id === null) || quantity(cell.opening_quantity) < 0n ||
        (cell.created_event_id !== null ? quantity(cell.opening_quantity) !== 0n : cell.opening_id !== container.opening_id)) invalid();
      beforeQuantity = quantity(previous.position.quantity);
    }
    if (before.status !== "onsite" && beforeQuantity !== 0n) invalid();
    const splits = packet.event_lines.filter(line => {
      const cells = packet.cells.filter(cell => cell.id === line.cell_id);
      return cells.length === 1 && cells[0].container_id === container.id;
    });
    if (splits.length !== descriptor.lines.length) invalid();
    let delta = 0n;
    if (descriptor.lines.length) {
      const allocation = descriptor.lines[0], line = add("public.controlled_stock_event_lines", splits[0].id);
      const cell = add("public.controlled_stock_cells", line.cell_id);
      delta = reviewContextQuantity(allocation.quantity_delta); lineCount++;
      if (allocation.lot_id !== lot.id || (delta > 0n) !== (q > 0n) || line.event_id !== event.id || line.source_link_id !== link.id ||
        quantity(line.quantity_delta) !== delta || integer(line.container_version_before) !== beforeVersion || integer(line.container_version_after) !== beforeVersion + 1n ||
        cell.container_id !== container.id || cell.lot_id !== lot.id || cell.channel !== "available" || ["dispense_id", "allocation_id", "intake_id"].some(key => cell[key] !== null)) invalid();
      if (previous ? !same(cell, previous.cell) : delta <= 0n || cell.created_event_id !== event.id || cell.opening_id !== null || quantity(cell.opening_quantity) !== 0n) invalid();
    }
    const afterQuantity = beforeQuantity + delta;
    if (afterQuantity < 0n || afterQuantity > 99999999999999n || (descriptor.after.status !== "onsite" && afterQuantity !== 0n)) invalid();
    total += delta;
  }
  if (total !== q || lineCount !== packet.event_lines.length || selected.size !== packet.source_rows.length) invalid();
}
