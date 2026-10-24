import { test } from "node:test";
import assert from "node:assert/strict";
import { ExactJsonNumber, type ExactJson } from "../../src/hub/features/controlled-drugs/record-review/exact-json.ts";
import { hashReviewEvent, hashReviewObligation, hashReviewParentRequest, hashReviewPreparationContext, hashReviewSourceRow, hashReviewTarget } from "../../src/hub/features/controlled-drugs/record-review/component-hashes.ts";
import { verifyProspectiveComponentConsistency } from "../../src/hub/features/controlled-drugs/record-review/prospective-component-consistency.ts";
import { reviewMeaning, reviewMeaningText, type PreparedReviewPacket } from "../../src/hub/features/controlled-drugs/record-review/prepared-packet.ts";
import { actor, event as eventId, operation, other, policy, request, session } from "./record-review-lifecycle-fixture.ts";

interface MutableObject { [key: string]: ExactJson }
const number = (value: string) => new ExactJsonNumber(value);
const hash = "a".repeat(64);
/** Minimal synthetic component-consistency fixture; deliberately NOT a valid
 * clinical parent, complete native graph, database row set or Auth proof. */
async function components() {
  const context = { version: number("1"), product_id: policy, policy_version_id: policy, state_head_id: actor, opening_id: operation,
    basis: { kind: "physical_record", observed_at: "2000-01-01T00:00:00.000001Z", note: "Synthetic note" }, containers: [] };
  const frozen = { catalog: { label: "Synthetic stock" }, containers: [], lots: [], native: null, expected_effects: [], permission: { secondary_review: true } };
  const preparation = { id: eventId, writer: "receive_inventory", actor_id: other, session_id: session, product_id: policy, policy_version_id: policy,
    state_head_id: actor, opening_id: operation, canonical_arguments: {}, context, frozen, request_hash: hash,
    created_at: "2000-01-01T00:00:00Z", expires_at: "2000-01-01T00:15:00Z" };
  preparation.request_hash = await hashReviewParentRequest(preparation);
  const result = { id: eventId }, clinical = { catalog: frozen.catalog, original_result: result };
  const event: MutableObject = { id: eventId, product_id: policy, sequence: number("1"), prior_event_id: null, policy_version_id: policy,
    opening_id: operation, engine_revision: number("1"), writer: "receive_inventory", event_kind: "receive_inventory", actor_id: other,
    session_id: session, actor_name: "Synthetic performer", basis: "physical_record", observed_at: context.basis.observed_at,
    recorded_at: "2000-01-01T00:00:00.000002Z", note: context.basis.note, context_hash: await hashReviewPreparationContext(preparation),
    canonical_result: result, source_bundle: {}, source_effects: {}, clinical_snapshot: clinical,
    secondary_review_required: true, prior_record_hash: null, record_hash: hash };
  event.record_hash = await hashReviewEvent(event);
  const target = { event_id: eventId, product_id: policy, sequence: number("1"), record_hash: String(event.record_hash), original_actor_id: other,
    policy_version_id: policy, opening_id: operation, engine_revision: number("1") };
  const action: MutableObject = { id: eventId, actor_id: other, writer: "receive_inventory", session_id: session, request_hash: preparation.request_hash,
    recorded_at: event.recorded_at, receipt: { version: number("1"), id: eventId, writer: "receive_inventory", actor_id: other,
      canonical_result: result, event, containers: [] } };
  const source_rows = [{ relation: "public.controlled_stock_actions", key: { id: eventId }, row: action },
    { relation: "public.controlled_stock_events", key: { id: eventId }, row: event },
    { relation: "public.controlled_stock_preparations", key: { id: eventId }, row: preparation }];
  const adapter: PreparedReviewPacket["adapter"] = { version: number("1"), event_kind: "receive_inventory", adapter_id: "movement_v1", target,
    site_basis: "event_transitions", site_id: policy, source_refs: [], native_family_dispense_id: null, provenance_state: "supported", reason: null };
  const obligation: MutableObject = { event_id: eventId, product_id: policy, event_sequence: "1", meaning: reviewMeaning, target,
    target_hash: await hashReviewTarget(target), adapter, binding_hash: hash, site_id: policy, due_at: null, family_dispense_id: null,
    historical: { version: number("1"), selection_anchor: context.basis.observed_at, anchor_basis: "observed_at", policy_id: null, policy_hash: null,
      rule: null, family_binding_hash: null, calendar_id: null, calendar_hash: null, anchor_local_date: null, selected_staffed_date: null,
      due_at: null, deadline_basis: "historical_policy_unavailable", unavailable_reason: "no_policy_at_anchor", routing_id: null, routing_hash: null, routing_snapshot: null } };
  const packet: PreparedReviewPacket = { version: number("3"), meaning: reviewMeaning, meaning_text: reviewMeaningText, meaning_version: number("1"),
    target, adapter, event, parent_preparation: preparation, original_result: result, clinical_snapshot: clinical, source_rows,
    event_lines: [], cells: [], transitions: [], containers: [], obligation, current_authorization: {
      policy: { id: policy, record_hash: hash, rule: { enabled: true, adapter_version: number("1"), meaning: reviewMeaning, quorum: number("1"),
        deadline_mode: "not_configured", deadline_anchor: "observed_at", escalation_mode: "not_configured" } },
      read: { id: actor, record_hash: hash, actor_id: actor, roles: ["TECH"] },
      review: { id: policy, record_hash: hash, actor_id: actor, roles: ["TECH"] },
    } };
  async function refresh() {
    adapter.source_refs = await Promise.all(source_rows.map(async source => ({ relation: source.relation, key: source.key,
      role: "reviewed_target", row_hash: await hashReviewSourceRow(source.relation, source.row) })));
    obligation.binding_hash = await hashReviewObligation(obligation);
  }
  async function recommitParent() {
    preparation.request_hash = await hashReviewParentRequest(preparation);
    action.request_hash = preparation.request_hash;
    event.context_hash = await hashReviewPreparationContext(preparation);
    event.record_hash = await hashReviewEvent(event);
    packet.target.record_hash = String(event.record_hash);
    obligation.target_hash = await hashReviewTarget(packet.target);
    await refresh();
  }
  await refresh();
  return { packet, event, preparation, context, action, obligation, refresh, recommitParent };
}

test("specific component commitments agree without claiming a complete evidence admission", async () => {
  const f = await components();
  await verifyProspectiveComponentConsistency(f.packet, request);
});
test("uncommitted source, context, target and obligation edits are refused", async () => {
  const changes = [f => { f.action.writer = "adjust_inventory"; }, f => { f.context.basis.note = "Changed note"; },
    f => { f.packet.target.record_hash = hash; }, f => { f.obligation.binding_hash = hash; }];
  for (const change of changes) {
    const f = await components(); change(f);
    await assert.rejects(verifyProspectiveComponentConsistency(f.packet, request));
  }
});
test("recomputed hashes cannot hide inconsistent parent identity, receipt or signing anchor", async () => {
  const changes = [f => { f.action.session_id = actor; }, f => { f.action.actor_id = actor; },
    f => { f.action.request_hash = hash; }, f => { f.preparation.writer = "adjust_inventory"; },
    f => { f.action.recorded_at = "2000-01-01T00:00:00.000003Z"; },
    f => { f.action.receipt = { event: f.event }; }, f => { f.context.state_head_id = other; },
    f => { (f.obligation.historical as MutableObject).selection_anchor = "2000-01-01T00:00:00.000002Z"; },
    f => { (f.obligation.historical as MutableObject).anchor_basis = "recorded_at"; },
    f => { f.packet.adapter.adapter_id = "treatment_v1"; }];
  for (const change of changes) {
    const f = await components(); change(f); await f.refresh();
    await assert.rejects(verifyProspectiveComponentConsistency(f.packet, request));
  }
});
test("an omitted action is refused even when every remaining row hash matches", async () => {
  const f = await components(); f.packet.source_rows.shift(); f.packet.adapter.source_refs.shift();
  f.obligation.binding_hash = await hashReviewObligation(f.obligation);
  await assert.rejects(verifyProspectiveComponentConsistency(f.packet, request));
});
test("fully recommitting a changed context cannot hide a different retained preparation identity", async () => {
  const f = await components(); f.context.state_head_id = other;
  await f.recommitParent();
  await assert.rejects(verifyProspectiveComponentConsistency(f.packet, request));
});
test("target parent rows cannot be relabeled as incidental retained context", async () => {
  const f = await components(); f.packet.adapter.source_refs[0].role = "retained_context";
  f.obligation.binding_hash = await hashReviewObligation(f.obligation);
  await assert.rejects(verifyProspectiveComponentConsistency(f.packet, request));
});
test("parent policy and opening remain bound to the original event after recomputing all component commitments", async () => {
  for (const field of ["policy_version_id", "opening_id"] as const) {
    const f = await components(); f.preparation[field] = actor; f.context[field] = actor;
    await f.recommitParent();
    await assert.rejects(verifyProspectiveComponentConsistency(f.packet, request));
  }
});
test("an original actor may execute after a session change while action and event retain the executing session", async () => {
  const f = await components(); f.preparation.session_id = actor;
  // Original C0 binds the same actor, not the preparation's earlier session.
  await f.refresh();
  await verifyProspectiveComponentConsistency(f.packet, request);
});
test("every supplied controlled parent keeps its own preparation and receipt, including a parent with no secondary review", async () => {
  const f = await components(), earlier = await components();
  earlier.event.id = operation; earlier.preparation.id = operation; earlier.action.id = operation;
  earlier.event.secondary_review_required = false; earlier.preparation.frozen.permission.secondary_review = false;
  (earlier.action.receipt as MutableObject).id = operation;
  await earlier.recommitParent();
  f.packet.source_rows.push(...earlier.packet.source_rows);
  f.packet.source_rows.sort((a, b) => (a.relation + "\n" + a.row.id) < (b.relation + "\n" + b.row.id) ? -1 : 1);
  async function commitRows() {
    f.packet.adapter.source_refs = await Promise.all(f.packet.source_rows.map(async source => ({ relation: source.relation,
      key: { id: String(source.row.id) }, row_hash: await hashReviewSourceRow(source.relation, source.row),
      role: source.row.id === operation ? "ordinary_source" : "reviewed_target" })));
    f.obligation.binding_hash = await hashReviewObligation(f.obligation);
  }
  // The source keys must identify the second parent rather than the main target.
  for (const source of earlier.packet.source_rows) source.key.id = operation;
  await commitRows();
  await verifyProspectiveComponentConsistency(f.packet, request);
  earlier.action.receipt = { substituted: "unrelated receipt" };
  await commitRows();
  await assert.rejects(verifyProspectiveComponentConsistency(f.packet, request));
});
