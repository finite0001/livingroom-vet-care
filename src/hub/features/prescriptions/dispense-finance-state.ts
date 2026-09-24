/** Session-scoped exact operation recovery. Persist before any financial write. */
import { correctionEqual } from "./fulfillment-corrections-api.ts";
import {
  emptyPrescriptionOperation,
  reviewPrescriptionOperation,
  commitPrescriptionOperation,
  prescriptionOperationFailed,
} from "./prescription-state.ts";
import type { PrescriptionOperation } from "./prescription-state.ts";
export interface DispenseFinanceTarget {
  authorization_id: string;
  pet_id: string;
  dispense_id: string;
}
export interface FinanceIntentStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
export interface SavedFinanceIntent {
  version: 1;
  actor: string;
  target: DispenseFinanceTarget;
  operation: Readonly<PrescriptionOperation>;
}
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const invalid = () =>
  new Error(
    "Saved financial intent could not be verified. Reconcile its recorded history before creating another operation.",
  );
export function financeIntentKey(actor: string, target: DispenseFinanceTarget) {
  if (
    !uuid.test(actor) ||
    Object.keys(target).sort().join(",") !==
      "authorization_id,dispense_id,pet_id" ||
    !Object.values(target).every((v) => uuid.test(v))
  )
    throw invalid();
  return `native-dispense-finance:v1:${actor}:${target.authorization_id}:${target.pet_id}:${target.dispense_id}`;
}
export function loadFinanceIntent(
  storage: FinanceIntentStorage,
  actor: string,
  target: DispenseFinanceTarget,
  parseOperation: (value: unknown) => Readonly<PrescriptionOperation>,
): SavedFinanceIntent | null {
  const raw = storage.getItem(financeIntentKey(actor, target));
  if (raw === null) return null;
  const value = JSON.parse(raw) as SavedFinanceIntent;
  if (
    !value ||
    typeof value !== "object" ||
    Object.keys(value).sort().join(",") !== "actor,operation,target,version" ||
    value.version !== 1 ||
    value.actor !== actor ||
    !correctionEqual(value.target, target)
  )
    throw invalid();
  const operation = parseOperation(value.operation);
  // The existing operation state machine makes a deep immutable JSON copy.
  const frozen = reviewPrescriptionOperation(
    emptyPrescriptionOperation(actor, target.pet_id),
    operation,
  ).operation!;
  return { version: 1, actor, target: { ...target }, operation: frozen };
}
export function persistFinanceIntent(
  storage: FinanceIntentStorage,
  actor: string,
  target: DispenseFinanceTarget,
  operation: Readonly<PrescriptionOperation>,
  parseOperation: (value: unknown) => Readonly<PrescriptionOperation>,
) {
  const next = parseOperation(operation),
    prior = loadFinanceIntent(storage, actor, target, parseOperation);
  if (prior && !correctionEqual(prior.operation, next)) throw invalid();
  storage.setItem(
    financeIntentKey(actor, target),
    JSON.stringify({ version: 1, actor, target, operation: next }),
  );
  const saved = loadFinanceIntent(storage, actor, target, parseOperation);
  if (!saved || !correctionEqual(saved.operation, next)) throw invalid();
}
export function clearFinanceIntent(
  storage: FinanceIntentStorage,
  actor: string,
  target: DispenseFinanceTarget,
  operation: Readonly<PrescriptionOperation>,
  parseOperation: (value: unknown) => Readonly<PrescriptionOperation>,
) {
  const saved = loadFinanceIntent(storage, actor, target, parseOperation);
  if (saved && !correctionEqual(saved.operation, operation)) throw invalid();
  storage.removeItem(financeIntentKey(actor, target));
  if (storage.getItem(financeIntentKey(actor, target)) !== null)
    throw invalid();
}
export function restoredFinanceState(
  actor: string,
  target: DispenseFinanceTarget,
  saved: SavedFinanceIntent | null,
) {
  const empty = emptyPrescriptionOperation(actor, target.pet_id);
  if (!saved) return empty;
  const committing = commitPrescriptionOperation(
    reviewPrescriptionOperation(empty, saved.operation),
  );
  return prescriptionOperationFailed(
    committing,
    { actor, patientId: target.pet_id, operationId: saved.operation.id },
    new Error("Recovered persisted attempt"),
  );
}

/** A first-attempt uniqueness conflict is a definitive rejection; prior uncertainty always survives. */
export function financeOperationFailed(
  state: import("./prescription-state.ts").PrescriptionOperationState,
  reply: import("./prescription-state.ts").PrescriptionOperationReply,
  failure: unknown,
) {
  const normalized =
    failure &&
    typeof failure === "object" &&
    "code" in failure &&
    failure.code === "23505"
      ? { code: "23514" }
      : failure;
  return prescriptionOperationFailed(state, reply, normalized);
}
