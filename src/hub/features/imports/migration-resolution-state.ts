export interface MigrationResolutionRequest {
  id: string;
  scope_id: string;
  target_kind: "scope" | "observation";
  binding_id: string | null;
  page: number | null;
  ordinal: number | null;
  snapshot_id: string | null;
  evidence_hash: string | null;
  action: "exclude" | "reopen";
  reason: string;
  expected_context_hash: string;
  replaces_id: string | null;
}

export interface MigrationResolutionState {
  actor: string;
  targetKey: string;
  phase: "editable" | "saving" | "uncertain" | "recovering" | "retryable";
  priorSaveUncertain: boolean;
  request: Readonly<MigrationResolutionRequest> | null;
}

export interface MigrationResolutionReply {
  actor: string;
  targetKey: string;
  requestId: string;
}

export function emptyResolutionState(actor: string, targetKey: string): MigrationResolutionState {
  return { actor, targetKey, phase: "editable", priorSaveUncertain: false, request: null };
}

// The API validates request/receipt identities; this layer controls when a
// network reply may unlock a draft or permit another request.
function belongs(state: MigrationResolutionState, reply: MigrationResolutionReply) {
  return reply.actor === state.actor && reply.targetKey === state.targetKey && reply.requestId === state.request?.id;
}

export function beginResolutionSave(state: MigrationResolutionState, request: MigrationResolutionRequest): MigrationResolutionState {
  if (state.phase === "retryable" && state.request) {
    // Ignore changed UI input: a retry always sends the frozen original.
    return { ...state, phase: "saving" };
  }
  if (state.phase !== "editable") return state;
  return { ...state, phase: "saving", request: Object.freeze({ ...request }) };
}

export function resolutionSaveFailed(state: MigrationResolutionState, reply: MigrationResolutionReply, error: unknown): MigrationResolutionState {
  if (!belongs(state, reply) || state.phase !== "saving") return state;
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : null;
  // These database errors abort the transaction. Unknown errors, including
  // response validation failures, cannot prove that the write did not commit.
  if (!state.priorSaveUncertain && code && ["23514", "40001", "42501"].includes(code)) return emptyResolutionState(state.actor, state.targetKey);
  // An absent recovery can race an original write still in flight. Rejection
  // of a later retry does not prove that the original transaction rolled back.
  return { ...state, phase: "uncertain", priorSaveUncertain: true };
}

export function beginResolutionRecovery(state: MigrationResolutionState): MigrationResolutionState {
  if (!["uncertain", "retryable"].includes(state.phase) || !state.request) return state;
  return { ...state, phase: "recovering" };
}

export function resolutionRecoveryAbsent(state: MigrationResolutionState, reply: MigrationResolutionReply): MigrationResolutionState {
  if (!belongs(state, reply) || state.phase !== "recovering") return state;
  return { ...state, phase: "retryable" };
}

export function resolutionRecoveryFailed(state: MigrationResolutionState, reply: MigrationResolutionReply): MigrationResolutionState {
  if (!belongs(state, reply) || state.phase !== "recovering") return state;
  return { ...state, phase: "uncertain" };
}

export function resolutionConfirmed(state: MigrationResolutionState, reply: MigrationResolutionReply): MigrationResolutionState {
  if (!belongs(state, reply) || !["saving", "recovering"].includes(state.phase)) return state;
  return emptyResolutionState(state.actor, state.targetKey);
}
