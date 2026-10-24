import { decodeExactJson, type ExactJson } from "../../src/hub/features/controlled-drugs/record-review/exact-json.ts";
import { reviewTransportDigest, type RecordReviewRequest } from "../../src/hub/features/controlled-drugs/record-review/request.ts";
import { reviewMeaning, reviewMeaningText, type ReviewEvidenceAdmission } from "../../src/hub/features/controlled-drugs/record-review/prepared-packet.ts";
import { createReviewPointerStore, type ReviewPointerStorage } from "../../src/hub/features/controlled-drugs/record-review/recovery-pointer.ts";
import type { ReviewIdentity } from "../../src/hub/features/controlled-drugs/record-review/raw-rpc.ts";

export const actor = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", operation = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const event = "cccccccc-cccc-4ccc-8ccc-cccccccccccc", policy = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
export const other = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", session = "ffffffff-ffff-4fff-8fff-ffffffffffff";
export const identity: ReviewIdentity = { actorId: actor, sessionId: session, generation: 1 };
export const request: RecordReviewRequest = { actor_id: actor, operation_id: operation, event_id: event, policy_id: policy,
  read_eligibility_id: actor, review_eligibility_id: policy, decision: "approve", reason: "Reviewed synthetic record" };
export const raw = (input: unknown): ExactJson => decodeExactJson(new TextEncoder().encode(typeof input === "string" ? input : JSON.stringify(input)));
export const deferred = <T>() => {
  let resolve!: (value: T) => void, reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
export async function fixture(req: RecordReviewRequest = request) {
  const digest = await reviewTransportDigest(req);
  const pointer = { version: 3 as const, actor_id: req.actor_id, operation_id: req.operation_id, transport_digest: digest };
  const target = { event_id: req.event_id, product_id: policy, sequence: "9223372036854775807", record_hash: "a".repeat(64),
    original_actor_id: other, policy_version_id: policy, opening_id: operation, engine_revision: 1 };
  const value = { version: 3, state: "prepared", data: { operation_id: req.operation_id, request: { ...req }, transport_digest: digest,
    packet_hash: "b".repeat(64), created_at: "2026-10-23T12:00:00.123456Z", expires_at: "2026-10-23T12:15:00.123456Z",
    packet: { version: 3, meaning: reviewMeaning, meaning_text: reviewMeaningText, meaning_version: 1, target,
      adapter: { version: 1, event_kind: "receive_inventory", adapter_id: "movement_v1", target: { ...target },
        site_basis: "event_transitions", site_id: policy, source_refs: [], native_family_dispense_id: null, provenance_state: "supported", reason: null },
      event: { id: req.event_id, quantity: "0.123456789012345678901234567890", actor_name: "Synthetic original performer", basis: "physical_record",
        observed_at: "2026-10-22T09:00:00.000000Z", recorded_at: "2026-10-22T09:01:00.000000Z", note: "Received synthetic stock" },
      parent_preparation: { id: operation }, original_result: { id: operation },
      clinical_snapshot: { recorded_at: "2010-01-01T00:00:00Z", catalog: { name: "Synthetic medication", unit: "mL" } }, source_rows: [],
      event_lines: [{ id: actor, event_id: req.event_id, cell_id: operation, quantity_delta: "1.125" }],
      cells: [{ id: operation, container_id: policy, channel: "available" }], transitions: [], containers: [{ id: policy, label: "Synthetic vial", stock_unit: "mL" }],
      obligation: { event_id: req.event_id, historical: { version: 1, selection_anchor: "2026-10-22T09:00:00.000000Z", anchor_basis: "observed_at",
        policy_id: null, policy_hash: null, rule: null, family_binding_hash: null, calendar_id: null, calendar_hash: null, anchor_local_date: null,
        selected_staffed_date: null, due_at: null, deadline_basis: "historical_policy_unavailable", unavailable_reason: "no_policy_at_anchor",
        routing_id: null, routing_hash: null, routing_snapshot: null } }, current_authorization: {
        policy: { id: req.policy_id, record_hash: "c".repeat(64), rule: {} },
        read: { id: req.read_eligibility_id, record_hash: "d".repeat(64), actor_id: req.actor_id, roles: ["TECH"] },
        review: { id: req.review_eligibility_id, record_hash: "e".repeat(64), actor_id: req.actor_id, roles: ["TECH"] },
      } },
  } };
  const encode = () => JSON.stringify(value).replaceAll('"9223372036854775807"', "9223372036854775807")
    .replace('"0.123456789012345678901234567890"', "0.123456789012345678901234567890").replaceAll('"1.125"', "1.125");
  const saved = () => raw({ version: 3, state: "saved", data: { operation_id: req.operation_id,
    receipt: { ...pointer, decision: req.decision, recorded_at: "2026-10-23T12:00:01.000000Z", receipt_hash: "f".repeat(64) } } });
  const cancelled = () => raw({ version: 3, state: "cancelled", data: { operation_id: req.operation_id, actor_id: req.actor_id,
    cancellation_kind: "unprepared", transport_digest: null, cancelled_at: "2026-10-23T12:00:01.000000Z" } });
  return { pointer, value, prepared: () => raw(encode()), saved, cancelled, encode };
}
/** Deliberately fixture-only admission, never exported by application code. The
 * production source-specific DTO/obligation validator remains an explicit gate. */
export const syntheticEvidence: ReviewEvidenceAdmission = { validate(packet, req) {
  if (packet.event.id !== req.event_id || String(packet.event.quantity) !== "0.123456789012345678901234567890" || packet.source_rows.length !== 0)
    throw new Error("Synthetic fixture source differs");
} };
export function memoryPointers(options: { failWrite?: boolean; failRemove?: boolean } = {}) {
  const values = new Map<string, string>();
  const storage: ReviewPointerStorage = { getItem: key => values.get(key) ?? null, setItem(key, value) {
    if (options.failWrite) throw new Error("Synthetic storage unavailable"); values.set(key, value);
  }, removeItem(key) { if (options.failRemove) throw new Error("Synthetic cleanup unavailable"); values.delete(key); } };
  const pointers = createReviewPointerStore(storage, { request: async (_name, _options, callback) => callback() });
  return { pointers, values, options };
}
