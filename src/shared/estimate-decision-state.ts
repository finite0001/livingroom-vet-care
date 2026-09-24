import {
  estimateClientDecisionOperationSchema,
  sameEstimateDecisionEvidence,
  verifyEstimateDecisionResolution,
  type EstimateClientDecisionOperation,
} from "../../supabase/functions/_shared/estimate-decision-contract.ts";

export interface EstimateDecisionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function key(grantId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(grantId)) {
    throw new Error("Estimate access reference is invalid.");
  }
  return `lrv-estimate-decision:v1:${grantId}`;
}
function decode(raw: string, grantId: string): EstimateClientDecisionOperation {
  if (raw.length > 16384) throw new Error("Saved estimate request is too large to verify.");
  const operation = estimateClientDecisionOperationSchema.parse(JSON.parse(raw));
  if (operation.grant_id !== grantId) throw new Error("Saved estimate request belongs to another link.");
  return operation;
}

/** Caller supplies sessionStorage, never persistent storage or an authentication store. */
export function readPendingEstimateDecision(storage: EstimateDecisionStorage, grantId: string) {
  const raw = storage.getItem(key(grantId));
  // Corruption/storage denial is deliberately not converted to absence: a write
  // may have committed before this tab lost its readable recovery record.
  return raw === null ? null : decode(raw, grantId);
}

/** Complete this synchronously before making any decision mutation request. */
export function retainPendingEstimateDecision(storage: EstimateDecisionStorage, input: unknown) {
  const operation = estimateClientDecisionOperationSchema.parse(input);
  const original = readPendingEstimateDecision(storage, operation.grant_id);
  if (original && !sameEstimateDecisionEvidence(original, operation)) {
    throw new Error("Resolve the original estimate decision before submitting another.");
  }
  const encoded = JSON.stringify(operation);
  if (encoded.length > 16384) throw new Error("Estimate decision request is too large to retain.");
  storage.setItem(key(operation.grant_id), encoded);
  const retained = readPendingEstimateDecision(storage, operation.grant_id);
  if (!retained || !sameEstimateDecisionEvidence(retained, operation)) {
    throw new Error("The estimate decision could not be retained for recovery.");
  }
  return operation;
}

/** Only an exact server receipt or durable closure can retire pending intent. */
export function resolvePendingEstimateDecision(storage: EstimateDecisionStorage, input: unknown, evidence: unknown) {
  const operation = estimateClientDecisionOperationSchema.parse(input);
  const resolution = verifyEstimateDecisionResolution(evidence, operation, true);
  const pending = readPendingEstimateDecision(storage, operation.grant_id);
  if (pending && !sameEstimateDecisionEvidence(pending, operation)) {
    throw new Error("The saved estimate decision changed; its recovery record was preserved.");
  }
  if (pending) {
    storage.removeItem(key(operation.grant_id));
    if (storage.getItem(key(operation.grant_id)) !== null) {
      throw new Error("The confirmed estimate decision could not be cleared from this tab.");
    }
  }
  return resolution;
}
