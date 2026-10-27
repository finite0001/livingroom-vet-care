/** Synthetic source-shaped HTTP data only; no real Auth, source or physical claim. */
import { entryFixtureFromBytes, decode } from "./controlled-entry-fixture.ts";
import { entryObject, serializeEntryJson } from "../../src/hub/features/controlled-drugs/entry/codec.ts";
import { parseWitnessReply, witnessPointerSchema, type WitnessPointer } from "../../src/hub/features/controlled-drugs/witness/schema.ts";
import { witnessReceiptDigest } from "../../src/hub/features/controlled-drugs/witness/wire.ts";
export function witnessFixtureFromBytes(raw: Uint8Array) {
  const entry = entryFixtureFromBytes(raw), actor = "00000000-0000-4000-8000-000000000901";
  const identity = { actorId: actor, sessionId: "00000000-0000-4000-8000-000000000902", generation: 1 };
  const pointer = witnessPointerSchema.parse({ schema_version: 1, actor_id: actor, operation_id: "00000000-0000-4000-8000-000000000903",
    parent_action_id: entry.pointer.operation_id, writer: entry.pointer.writer, product_id: entry.pointer.product_id, event_kind: entry.pointer.event_kind });
  const permission = { ...entryObject(entry.prepared.frozen.permission), witness: "c2_required" };
  const preparation = { version: entry.prepared.version, id: entry.prepared.id, writer: entry.prepared.writer, actor_id: entry.prepared.actor_id,
    canonical_arguments: entry.prepared.canonical_arguments, context: entry.prepared.context,
    frozen: { ...entry.prepared.frozen, permission }, expires_at: entry.prepared.expires_at };
  const recorder = { id: entry.identity.actorId, name: "Synthetic recorder" }, preparationDigest = "a".repeat(64);
  const encode = (value: unknown) => serializeEntryJson(value, 4194304);
  const available = (p: WitnessPointer = pointer) => ({ schema_version: 1, state: "available", data: { pointer: p, preparation,
    preparation_digest: preparationDigest, recorder, receipt: null, blocked_reason: null } });
  async function receipt(p: WitnessPointer = pointer) {
    const result = { action: "witness_attest" as const, ...p, preparation_digest: preparationDigest,
      recorded_at: "2026-10-27T18:00:00.123456Z", receipt_digest: "0".repeat(64) };
    return { ...result, receipt_digest: await witnessReceiptDigest(result) };
  }
  const terminal = (state: "abandoned" | "not_found", p: WitnessPointer = pointer) => ({ schema_version: 1, state, data: { pointer: p,
    preparation: null, preparation_digest: null, recorder: null, receipt: null, blocked_reason: null } });
  const displayed = parseWitnessReply(decode(encode(available())), pointer);
  const task = { parent_action_id: pointer.parent_action_id, writer: pointer.writer, product_id: pointer.product_id, product_name: "Synthetic medication",
    event_kind: pointer.event_kind, recorder, created_at: "2026-10-27T17:45:00.000000Z", expires_at: "2026-10-27T18:00:00.000000Z", available_actions: ["read", "attest"] as ["read", "attest"] };
  return { entry, identity, pointer, preparation, preparationDigest, recorder, task, encode, available, receipt, terminal, displayed };
}
