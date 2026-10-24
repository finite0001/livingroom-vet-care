import { z } from "zod";
import { decodeExactJson, ExactJsonNumber, protocolInteger } from "./exact-json.ts";
import { reviewUuidSchema } from "./request.ts";
import { sameReviewIdentity, type ReviewIdentity, type ReviewSession, type ReviewSessionSource } from "./raw-rpc.ts";

const sdkSession = z.object({ access_token: z.string().max(16384).regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/),
  user: z.object({ id: reviewUuidSchema }).passthrough() }).passthrough();
const claims = z.object({ sub: reviewUuidSchema, session_id: reviewUuidSchema, role: z.literal("authenticated"),
  exp: z.instanceof(ExactJsonNumber).transform(value => protocolInteger(value, 1, 253402300799)) }).passthrough();
export interface ReviewStaffSessionSource extends ReviewSessionSource {
  /** Presentation identity only: never a token, profile or authorization claim. */
  getSnapshot(): Readonly<ReviewIdentity> | null;
  subscribe(listener: () => void): () => void;
}
interface Candidate {
  identity: Readonly<ReviewIdentity>;
  token: string;
  expiresAt: number;
}
interface ReviewStaffSessionOptions { now?(): number }

/** AuthProvider owns offer/allow/clear. Consumers receive only source.
 * JWT decoding extracts identity/expiry, not signature or server authorization.
 * Every sensitive RPC still authenticates and authorizes on the backend.
 */
export function createReviewStaffSessions(options: ReviewStaffSessionOptions = {}) {
  const now = options.now ?? Date.now, listeners = new Set<() => void>();
  let generation = 0, candidate: Candidate | null = null, allowed = false, expired = false, suspended = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  function clock(): number | null {
    try { const time = now(); return Number.isFinite(time) ? time : null; } catch { return null; }
  }
  function notify() { for (const listener of listeners) { try { listener(); } catch { /* Continue invalidating other consumers. */ } } }
  function stopTimer() { if (timer !== undefined) clearTimeout(timer); timer = undefined; }
  function visible(): Readonly<ReviewIdentity> | null {
    if (!candidate || !allowed || expired) return null;
    const time = clock(); if (time === null || time >= candidate.expiresAt) expired = true;
    return expired ? null : candidate.identity;
  }
  function clear() {
    generation++; stopTimer(); candidate = null; allowed = false; expired = false; notify();
  }
  function scheduleExpiry() {
    stopTimer();
    if (!candidate) return;
    const time = clock(); if (time === null || time >= candidate.expiresAt) { clear(); return; }
    const identity = candidate.identity;
    timer = setTimeout(() => {
      if (!sameReviewIdentity(candidate?.identity ?? null, identity)) return;
      const currentTime = clock();
      if (currentTime === null || currentTime >= candidate!.expiresAt || expired) clear(); else scheduleExpiry();
    }, Math.min(2147483647, Math.max(0, candidate.expiresAt - time)));
  }
  function offer(input: unknown, force = false): Readonly<ReviewIdentity> | null {
    // Identical SDK events on tab focus do not change the authenticated session.
    // Explicit revalidation and actual token changes always advance generation.
    if (!force && !suspended && candidate && !expired) {
      try {
        const session = sdkSession.parse(input), time = clock();
        if (time !== null && time < candidate.expiresAt && session.access_token === candidate.token && session.user.id === candidate.identity.actorId)
          return candidate.identity;
      } catch { /* Malformed input still clears the old identity below. */ }
    }
    clear();
    if (suspended) return null;
    try {
      const session = sdkSession.parse(input), segment = session.access_token.split(".")[1];
      const bytes = Uint8Array.from(atob(segment.replace(/-/g, "+").replace(/_/g, "/")), char => char.charCodeAt(0));
      const parsed = claims.parse(decodeExactJson(bytes));
      const time = clock();
      if (parsed.sub !== session.user.id || time === null || parsed.exp * 1000 <= time) return null;
      const identity = Object.freeze({ actorId: parsed.sub, sessionId: parsed.session_id, generation });
      candidate = { identity, token: session.access_token, expiresAt: parsed.exp * 1000 };
      scheduleExpiry();
      return candidate ? identity : null;
    } catch { return null; }
  }
  function revalidate(): Readonly<ReviewIdentity> | null {
    const current = candidate;
    if (!current) { clear(); return null; }
    return offer({ access_token: current.token, user: { id: current.identity.actorId } }, true);
  }
  function allow(identity: ReviewIdentity | null, active: boolean): boolean {
    if (!identity || !sameReviewIdentity(candidate?.identity ?? null, identity)) return false;
    allowed = active === true;
    if (!allowed) {
      candidate = { ...candidate!, identity: Object.freeze({ ...candidate!.identity, generation: ++generation }) };
      scheduleExpiry();
    }
    const accepted = visible() !== null; notify(); return accepted;
  }
  const source: ReviewStaffSessionSource = Object.freeze({
    getSnapshot: visible,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async current(): Promise<ReviewSession | null> {
      const identity = visible();
      return identity && candidate ? Object.freeze({ ...identity, accessToken: candidate.token }) : null;
    },
    isCurrent(identity: ReviewIdentity) { return sameReviewIdentity(visible(), identity); },
  });
  return { source, offer, revalidate, allow, clear,
    /** Logout intent survives late SDK events and a failed server sign-out. */
    suspend() { suspended = true; clear(); },
    /** AuthProvider calls this only after an explicit successful sign-in. */
    resume(input: unknown) { suspended = false; return offer(input); },
  };
}
