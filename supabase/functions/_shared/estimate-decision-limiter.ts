export interface EstimateDecisionLimiterOptions {
  limit?: number;
  windowMs?: number;
  now?: () => number;
}

/** Coarse per-isolate guard before parsing bodies or looking up grants.
 * SQL separately enforces the grant budget; this is not a distributed gateway policy.
 * No IP address, token or client data is retained.
 */
export function createEstimateDecisionLimiter(options: EstimateDecisionLimiterOptions = {}) {
  const limit = options.limit ?? 60, windowMs = options.windowMs ?? 60000;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000 ||
      !Number.isSafeInteger(windowMs) || windowMs < 1000 || windowMs > 3600000) {
    throw new Error("Invalid estimate request budget.");
  }
  const now = options.now ?? Date.now;
  let started: number | null = null, last: number | null = null, used = 0;
  return async (): Promise<boolean> => {
    const stamp = now();
    if (!Number.isFinite(stamp)) return false;
    // A clock reversal must not replenish capacity. Wait for the old clock to
    // catch up rather than treating each reversal as a new window.
    if (last !== null && stamp < last) return false;
    last = stamp;
    if (started === null || stamp - started >= windowMs) { started = stamp; used = 0; }
    if (used >= limit) return false;
    used += 1;
    return true;
  };
}
