/** Synthetic unmanaged classification for legacy browser regressions only. */
import { snapshotControlledLegacyIntent } from "../../src/hub/features/controlled-drugs/entry/legacy-intent";
import { canonicalEntryArguments } from "../../src/hub/features/controlled-drugs/entry/schema";
import { serializeEntryJson, entryObject } from "../../src/hub/features/controlled-drugs/entry/codec";
import { controlledStockWriterSchema } from "../../src/hub/features/controlled-drugs/entry/gateway";
import { ExactJsonNumber } from "../../src/hub/features/controlled-drugs/record-review/exact-json";

interface ProbeArguments { p_request: { actor_id: string; writer: unknown; legacy_arguments: unknown } }
export function unmanagedStockProbe(input: ProbeArguments, productId: string) {
  const query = input.p_request, writer = controlledStockWriterSchema.parse(query.writer);
  const snapshot = snapshotControlledLegacyIntent(writer, query.legacy_arguments);
  const legacy = entryObject(snapshot.legacyArguments);
  const request = legacy.p_request ? entryObject(legacy.p_request) : null;
  const historical = writer === "record_patient_treatment" && request?.historical === true;
  let kind: string = writer;
  if (writer === "append_native_dispense_correction") kind += ":" + request!.kind;
  if (["record_native_dispense_return", "record_native_dispense_return_v2", "record_native_return_discrepancy"].includes(writer))
    kind += ":" + entryObject(request!.intent).action;
  return serializeEntryJson({ schema_version: new ExactJsonNumber("1"), actor_id: query.actor_id,
    intent: { writer, operation_id: snapshot.operationId, product_id: historical ? null : productId,
      event_kind: historical ? null : kind, legacy_arguments: snapshot.legacyArguments,
      canonical_arguments: canonicalEntryArguments(snapshot) }, mode: "unmanaged", blocked_reason: null, options: null });
}
