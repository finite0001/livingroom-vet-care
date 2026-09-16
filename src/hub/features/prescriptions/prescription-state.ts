/** Operation identity is independent of draft/editor state and server API shape. */
export interface PrescriptionOperation {
  id: string;
  kind: string;
  payload: Readonly<Record<string, unknown>>;
}
export interface PrescriptionOperationReply {
  actor: string;
  patientId: string;
  operationId: string;
}
export interface PrescriptionOperationState {
  actor: string;
  patientId: string;
  phase: "editing" | "review" | "committing" | "uncertain" | "recovering" | "retryable" | "confirmed";
  operation: Readonly<PrescriptionOperation> | null;
  priorUncertainty: boolean;
}
export function emptyPrescriptionOperation(actor: string, patientId: string): PrescriptionOperationState {
  return { actor, patientId, phase: "editing", operation: null, priorUncertainty: false };
}
function freezeJson(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return Object.freeze(value.map(freezeJson));
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, freezeJson(item)])));
  }
  throw new Error("Prescription operation must contain explicit JSON values");
}
export function reviewPrescriptionOperation(state: PrescriptionOperationState, operation: PrescriptionOperation): PrescriptionOperationState {
  if (!["editing", "review", "confirmed"].includes(state.phase)) return state;
  if (!operation.id || !operation.kind) throw new Error("Exact prescription operation identity required");
  return { ...state, phase: "review", priorUncertainty: false, operation: Object.freeze({ ...operation, payload: freezeJson(operation.payload) as Readonly<Record<string, unknown>> }) };
}
export function discardPrescriptionReview(state: PrescriptionOperationState): PrescriptionOperationState {
  return ["editing", "review", "confirmed"].includes(state.phase) ? emptyPrescriptionOperation(state.actor, state.patientId) : state;
}
export function commitPrescriptionOperation(state: PrescriptionOperationState): PrescriptionOperationState {
  return ["review", "retryable"].includes(state.phase) && state.operation ? { ...state, phase: "committing" } : state;
}
function belongs(state: PrescriptionOperationState, reply: PrescriptionOperationReply) {
  return state.actor === reply.actor && state.patientId === reply.patientId && state.operation?.id === reply.operationId;
}
export function prescriptionOperationFailed(state: PrescriptionOperationState, reply: PrescriptionOperationReply, failure: unknown): PrescriptionOperationState {
  if (state.phase !== "committing" || !belongs(state, reply)) return state;
  const code = failure && typeof failure === "object" && "code" in failure ? String(failure.code) : null;
  if (!state.priorUncertainty && code && ["23514", "40001", "42501"].includes(code)) return emptyPrescriptionOperation(state.actor, state.patientId);
  return { ...state, phase: "uncertain", priorUncertainty: true };
}
export function recoverPrescriptionOperation(state: PrescriptionOperationState): PrescriptionOperationState {
  return ["uncertain", "retryable"].includes(state.phase) && state.operation ? { ...state, phase: "recovering" } : state;
}
export function prescriptionRecoveryAbsent(state: PrescriptionOperationState, reply: PrescriptionOperationReply): PrescriptionOperationState {
  return state.phase === "recovering" && belongs(state, reply) ? { ...state, phase: "retryable" } : state;
}
export function prescriptionRecoveryFailed(state: PrescriptionOperationState, reply: PrescriptionOperationReply): PrescriptionOperationState {
  return state.phase === "recovering" && belongs(state, reply) ? { ...state, phase: "uncertain", priorUncertainty: true } : state;
}
/** Call only after the API validates the complete immutable server receipt. */
export function prescriptionOperationConfirmed(state: PrescriptionOperationState, reply: PrescriptionOperationReply): PrescriptionOperationState {
  return ["committing", "recovering"].includes(state.phase) && belongs(state, reply) ? { ...state, phase: "confirmed", operation: null, priorUncertainty: false } : state;
}
export function prescriptionOperationLocked(state: PrescriptionOperationState): boolean {
  return ["committing", "uncertain", "recovering", "retryable"].includes(state.phase);
}
