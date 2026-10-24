import assert from "node:assert/strict";
import { test } from "node:test";
import { verifyPreparedReview } from "../../src/hub/features/controlled-drugs/record-review/prepared-packet.ts";
import { verifyProspectivePacketStructure } from "../../src/hub/features/controlled-drugs/record-review/prospective-packet-structure.ts";
import { fixture, actor, event, other, policy, request, session } from "./record-review-lifecycle-fixture.ts";

/** Explicit synthetic shapes, not a real immutable packet or source admission. */
async function prospective() {
  const f = await fixture(), p = f.value.data.packet, t = p.target;
  const result = { id: event }, clinical = { catalog: {}, original_result: result };
  const ev = { id: event, product_id: t.product_id, sequence: t.sequence, prior_event_id: other, policy_version_id: t.policy_version_id,
    opening_id: t.opening_id, engine_revision: 1, writer: "receive_inventory", event_kind: "receive_inventory", actor_id: other, session_id: session,
    actor_name: "Synthetic original actor", basis: "physical_record", observed_at: "2000-01-01T00:00:00Z", recorded_at: "2000-01-01T00:00:00Z",
    note: "Synthetic historical note", context_hash: "a".repeat(64), canonical_result: result, source_bundle: {}, source_effects: {}, clinical_snapshot: clinical,
    secondary_review_required: true, prior_record_hash: "b".repeat(64), record_hash: t.record_hash };
  const preparation = { id: event, writer: "receive_inventory", actor_id: other, session_id: session, product_id: t.product_id,
    policy_version_id: t.policy_version_id, state_head_id: actor, opening_id: t.opening_id, canonical_arguments: {}, context: {}, frozen: {},
    request_hash: "c".repeat(64), created_at: "2000-01-01T00:00:00Z", expires_at: "2000-01-01T00:15:00Z" };
  p.event = ev; p.parent_preparation = preparation; p.original_result = result; p.clinical_snapshot = clinical;
  p.event_lines = []; p.cells = []; p.containers = [];
  p.current_authorization.policy.rule = { enabled: true, adapter_version: 1, meaning: p.meaning, quorum: 1,
    deadline_mode: "not_configured", deadline_anchor: "observed_at", escalation_mode: "not_configured" };
  p.obligation = { event_id: event, product_id: t.product_id, event_sequence: "9223372036854775807", meaning: p.meaning,
    target: t, target_hash: "d".repeat(64), adapter: p.adapter, binding_hash: "e".repeat(64), site_id: policy, due_at: null, family_dispense_id: null,
    historical: { version: 1, selection_anchor: "2000-01-01T00:00:00Z", anchor_basis: "observed_at", policy_id: null, policy_hash: null, rule: null,
      family_binding_hash: null, calendar_id: null, calendar_hash: null, anchor_local_date: null, selected_staffed_date: null, due_at: null,
      deadline_basis: "historical_policy_unavailable", unavailable_reason: "no_policy_at_anchor", routing_id: null, routing_hash: null, routing_snapshot: null } };
  p.source_rows = [{ relation: "public.controlled_stock_events", key: { id: event }, row: ev },
    { relation: "public.controlled_stock_preparations", key: { id: event }, row: preparation }];
  p.adapter.source_refs = p.source_rows.map(row => ({ relation: row.relation, key: row.key, row_hash: "a".repeat(64), role: "reviewed_target" }));
  // Only target.sequence and source event.sequence are numeric. The obligation
  // event_sequence must remain the independent canonical string projection.
  const encoded = () => f.encode().replace('"event_sequence":9223372036854775807', '"event_sequence":"9223372036854775807"');
  return { ...f, p, ev, preparation, encoded };
}
const admission = { validate: verifyProspectivePacketStructure }; // Test-only structural seam, never production authority.
test("prospective DTO controls preserve full old rows and distinguish numeric target from wire sequence", async () => {
  const f = await prospective();
  const { decodeExactJson } = await import("../../src/hub/features/controlled-drugs/record-review/exact-json.ts");
  const prepared = await verifyPreparedReview(f.pointer, decodeExactJson(new TextEncoder().encode(f.encoded())), admission, () => {}, request);
  assert.equal(String(prepared.data.packet.event.sequence), "9223372036854775807");
  assert.equal(prepared.data.packet.obligation.event_sequence, "9223372036854775807");
  assert.equal(prepared.data.packet.clinical_snapshot.catalog && Object.keys(prepared.data.packet.clinical_snapshot.catalog).length, 0);
});
test("prospective DTO refuses added/missing/null/type/source/order/binding drift", async () => {
  const changes = [f => { f.ev.extra = "unrecognized"; }, f => { delete f.ev.note; }, f => { f.ev.record_hash = null; },
    f => { f.ev.engine_revision = "1"; }, f => { f.p.obligation.materialized_at = "2000-01-01T00:00:00Z"; },
    f => { f.p.obligation.historical.routing_id = actor; }, f => { f.p.obligation.historical.policy_hash = "a".repeat(64); },
    f => { f.p.obligation.historical.due_at = "2000-01-02T00:00:00Z"; }, f => { f.p.event_lines.push({ id: actor }); },
    f => { f.p.source_rows.push(f.p.source_rows[0]); f.p.adapter.source_refs.push(f.p.adapter.source_refs[0]); },
    f => { f.p.source_rows.reverse(); f.p.adapter.source_refs.reverse(); },
    f => { f.p.source_rows[0].key = { id: other }; f.p.adapter.source_refs[0].key = { id: other }; },
    f => { f.p.source_rows[0].relation = "public.profiles"; f.p.adapter.source_refs[0].relation = "public.profiles"; },
    f => { f.p.adapter.source_refs[0].role = "live_roster"; }, f => { f.preparation.id = other; },
    f => { f.p.obligation.event_sequence = "9007199254740992"; },
  ];
  const { decodeExactJson } = await import("../../src/hub/features/controlled-drugs/record-review/exact-json.ts");
  for (const change of changes) {
    const f = await prospective(); change(f);
    await assert.rejects(verifyPreparedReview(f.pointer, decodeExactJson(new TextEncoder().encode(f.encoded())), admission, () => {}, request));
  }
});
