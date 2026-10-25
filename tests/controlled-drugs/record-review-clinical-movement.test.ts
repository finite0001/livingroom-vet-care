import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { decodeExactJson, ExactJsonNumber, type ExactJson } from "../../src/hub/features/controlled-drugs/record-review/exact-json.ts";
import { reviewRequiredPacketSchema } from "../../src/hub/features/controlled-drugs/record-review/prepared-packet.ts";
import { hashReviewClinicalAlertSnapshot, hashReviewEvent, hashReviewObligation, hashReviewParentRequest, hashReviewPreparationContext, hashReviewSourceRow, hashReviewTarget } from "../../src/hub/features/controlled-drugs/record-review/component-hashes.ts";
import { verifyProspectiveClinicalMovement, verifyProspectiveStockMovement } from "../../src/hub/features/controlled-drugs/record-review/prospective-stock-movement.ts";
import { prospectiveSourceShapes } from "../../src/hub/features/controlled-drugs/record-review/prospective-source-shapes.ts";
interface MutableObject { [key: string]: MutableJson }
type MutableJson = null | boolean | string | ExactJsonNumber | MutableJson[] | MutableObject;
const number = (value: string) => new ExactJsonNumber(value);
const object = (value: MutableJson) => value as MutableObject;
const array = (value: MutableJson) => value as MutableJson[];
function clone(value: ExactJson): MutableJson {
  if (value === null || typeof value !== "object" || value instanceof ExactJsonNumber) return value;
  if (Array.isArray(value)) return value.map(clone);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
}
function fixture(kind: "treatment" | "anesthesia") {
  const raw = readFileSync(new URL(`./record-review-${kind}-reference.json`, import.meta.url));
  const envelope = object(clone(decodeExactJson(raw))), packet = object(object(envelope.data).packet);
  const sources = array(packet.source_rows).map(object);
  const rows = (relation: string) => sources.filter(source => source.relation === relation).map(source => object(source.row));
  function row(relation: string): MutableObject { const found = rows(relation); assert.equal(found.length, 1); return found[0]; }
  const event = row("public.controlled_stock_events"), preparation = row("public.controlled_stock_preparations"), action = row("public.controlled_stock_actions");
  const context = object(preparation.context), frozen = object(preparation.frozen), adapter = object(packet.adapter), obligation = object(packet.obligation);
  async function recommit() {
    // Test-only: make commitments internally consistent before testing semantic
    // cross-bindings. This deliberately supplies no genuine database authority.
    event.canonical_result = row("public.patient_treatments");
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
    await verifyProspectiveClinicalMovement(reviewRequiredPacketSchema.parse(packet), { event_id: String(event.id) });
  }
  return { raw, packet, sources, rows, row, event, preparation, action, context, frozen, adapter, obligation, recommit, check };
}

test("both genuine synthetic clinical detail packets pass component and complete available-stock graph checks", async () => {
  const hashes = { treatment: "9086650ad5aca4a589c0207a12c9866d52613ec186292fa47239f2fafc3ac91a", anesthesia: "d878d7d16b2c1b3bdf828f886229135cfe12361e525aebcbaff8abb1a57c65c1" };
  for (const kind of ["treatment", "anesthesia"] as const) {
    const f = fixture(kind);
    assert.equal(createHash("sha256").update(f.raw).digest("hex"), hashes[kind]);
    await f.check();
    await assert.rejects(verifyProspectiveStockMovement(reviewRequiredPacketSchema.parse(f.packet), { event_id: String(f.event.id) }));
  }
});

test("recommitted clinical source substitutions, stock shortages and graph additions still refuse", async t => {
  const other = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  const changes: Record<string, (f: ReturnType<typeof fixture>) => void | Promise<void>> = {
    wrong_patient(f) { f.row("public.patient_treatments").pet_id = other; },
    wrong_invoice(f) { f.row("public.billing_invoice_items").invoice_id = other; },
    wrong_billed_patient(f) { f.row("public.billing_invoice_items").pet_id = other; },
    wrong_billed_product(f) { f.row("public.billing_invoice_items").product_id = other; },
    wrong_billing_actor(f) { f.row("public.billing_invoice_items").created_by = other; },
    wrong_price(f) { f.row("public.billing_invoice_items").unit_price_cents = number("101"); },
    wrong_amount(f) { f.row("public.billing_invoice_items").amount_cents = number("999"); },
    wrong_billing_quantity(f) { f.row("public.billing_invoice_items").quantity = number("0.001"); },
    wrong_treatment_quantity(f) { f.row("public.patient_treatments").quantity = number("0.001"); },
    wrong_product_snapshot(f) { f.row("public.patient_treatments").product_name = "Another product"; },
    wrong_dose(f) { f.row("public.patient_treatments").dose = "Another dose"; },
    wrong_route(f) { f.row("public.patient_treatments").route = "Another route"; },
    wrong_clinician(f) { f.row("public.patient_treatments").veterinarian = "Another clinician"; },
    wrong_lot(f) { f.row("public.patient_treatments").lot_id = other; },
    wrong_manufacturer(f) { f.row("public.patient_treatments").manufacturer = "Another maker"; },
    historical_transcription(f) { f.row("public.patient_treatments").historical = true; },
    wrong_alert_actor(f) { f.row("public.treatment_alert_reviews").reviewed_by = other; },
    wrong_alert_patient(f) { f.row("public.treatment_alert_reviews").pet_id = other; },
    async wrong_snapshot_patient(f) {
      const alert = f.row("public.treatment_alert_reviews"); object(alert.snapshot).pet_id = other;
      alert.source_hash = await hashReviewClinicalAlertSnapshot(alert.snapshot);
      object(object(object(f.preparation.canonical_arguments).request).alert_review).source_hash = alert.source_hash;
      object(object(f.row("public.patient_treatments").request).alert_review).source_hash = alert.source_hash;
      if (f.event.writer === "record_anesthesia_drug_administration") object(object(f.row("public.anesthesia_drug_administrations").request).alert_review).source_hash = alert.source_hash;
    },
    wrong_alert_time(f) { f.row("public.treatment_alert_reviews").reviewed_at = "2026-10-24T00:00:00.000000Z"; },
    expired_lot(f) {
      const date = "2026-10-23";
      f.row("public.inventory_lots").expires_on = date;
      object(object(array(f.frozen.lots)[0]).lot).expires_on = date;
      f.row("public.patient_treatments").expires_on = date;
    },
    future_administration(f) {
      const stamp = "2026-10-24T23:40:00.000000Z";
      object(object(f.preparation.canonical_arguments).request).administered_at = stamp;
      const treatment = f.row("public.patient_treatments"); treatment.administered_at = stamp;
      object(treatment.request).administered_at = stamp;
      if (f.event.writer === "record_anesthesia_drug_administration") object(f.row("public.anesthesia_drug_administrations").request).administered_at = stamp;
    },
    wrong_movement_reason(f) { f.row("public.inventory_movements").reason = "Another treatment"; },
    wrong_provenance_actor(f) { f.row("public.stock_movement_sources").actor_id = other; },
    wrong_site(f) { f.adapter.site_id = other; },
    held_lot(f) { object(array(f.frozen.lots)[0]).native_hold = true; },
    insufficient_lot(f) { object(array(f.frozen.lots)[0]).available = "0.001"; },
    insufficient_container(f) { object(object(array(object(array(f.frozen.containers)[0]).cells)[0]).position).quantity = number("0.001"); },
    extra_unselected_row(f) {
      const row = clone(f.row("public.billing_invoice_items")) as MutableObject; row.id = other;
      f.sources.push({ relation: "public.billing_invoice_items", key: { id: other }, row });
    },
    native_adapter(f) { f.adapter.native_family_dispense_id = other; },
    wrong_expected_effect(f) { object(array(f.frozen.expected_effects)[0]).quantity_delta = "-0.001"; },
    wrong_split(f) { f.row("public.controlled_stock_event_lines").quantity_delta = number("-0.001"); },
  };
  for (const kind of ["treatment", "anesthesia"] as const) for (const [name, change] of Object.entries(changes)) await t.test(kind + ": " + name, async () => {
    const f = fixture(kind); await change(f); await f.recommit(); await assert.rejects(f.check());
  });
});

test("anesthesia request and link identities are server-owned and cannot be substituted", async t => {
  const changes: Record<string, (f: ReturnType<typeof fixture>) => void> = {
    record(f) { f.row("public.anesthesia_drug_administrations").record_id = String(f.event.id); },
    pet(f) { f.row("public.anesthesia_drug_administrations").pet_id = String(f.event.id); },
    actor(f) { f.row("public.anesthesia_drug_administrations").created_by = String(f.event.id); },
    timestamp(f) { f.row("public.anesthesia_drug_administrations").created_at = "2026-10-24T00:00:00.000000Z"; },
    source(f) { object(f.row("public.anesthesia_drug_administrations").request).source = "A caller-selected source"; },
    unknown_field(f) { object(object(f.preparation.canonical_arguments).request).source = "A caller-selected source"; },
  };
  for (const [name, change] of Object.entries(changes)) await t.test(name, async () => {
    const f = fixture("anesthesia"); change(f); await f.recommit(); await assert.rejects(f.check());
  });
});

test("clinical numeric scale stays lossless while context split grammar stays narrow", async () => {
  for (const kind of ["treatment", "anesthesia"] as const) {
    const f = fixture(kind), request = object(object(f.preparation.canonical_arguments).request);
    request.quantity = String(request.quantity) + "00";
    object(f.row("public.patient_treatments").request).quantity = request.quantity;
    if (kind === "anesthesia") object(f.row("public.anesthesia_drug_administrations").request).quantity = request.quantity;
    object(array(f.frozen.expected_effects)[0]).quantity_delta = String(object(array(f.frozen.expected_effects)[0]).quantity_delta) + "00";
    await f.recommit(); await f.check();
  }
});

test("synthetic billing variants use PostgreSQL positive half rounding without floating point", async () => {
  for (const kind of ["treatment", "anesthesia"] as const) {
    const f = fixture(kind), price = kind === "treatment" ? "2" : "1", rounded = kind === "treatment" ? "1" : "2";
    object(f.frozen.catalog).unit_price_cents = number(price);
    const item = f.row("public.billing_invoice_items"); item.unit_price_cents = number(price); item.amount_cents = number(rounded);
    await f.recommit(); await f.check();
    item.amount_cents = number(String(BigInt(rounded) - 1n));
    await f.recommit(); await assert.rejects(f.check());
  }
});

test("calendar model variants reject Denver projections outside four-digit AD years", async () => {
  for (const kind of ["treatment", "anesthesia"] as const) for (const [stamp, admitted] of [
    ["0001-01-01T00:00:00.000001Z", false],
    ["9999-12-31T23:59:59.999999-15:00", false],
    ["0001-01-01T08:00:00.000001Z", true],
    ["9999-12-31T23:00:00.000001Z", true],
  ] as const) {
    // Client-domain models, not additional observed canonical executions.
    const f = fixture(kind), treatment = f.row("public.patient_treatments");
    object(object(f.preparation.canonical_arguments).request).administered_at = stamp;
    object(treatment.request).administered_at = stamp; treatment.administered_at = stamp; treatment.created_at = stamp;
    f.row("public.inventory_movements").created_at = stamp; f.row("public.billing_invoice_items").created_at = stamp;
    f.row("public.treatment_alert_reviews").reviewed_at = stamp;
    if (kind === "anesthesia") {
      const link = f.row("public.anesthesia_drug_administrations"); link.created_at = stamp;
      object(link.request).administered_at = stamp;
    }
    f.row("public.inventory_lots").expires_on = "9999-12-31";
    object(object(array(f.frozen.lots)[0]).lot).expires_on = "9999-12-31"; treatment.expires_on = "9999-12-31";
    await f.recommit();
    if (admitted) await f.check(); else await assert.rejects(f.check());
  }
});
