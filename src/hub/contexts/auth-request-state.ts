export interface AuthRequest {
  revision: number;
  userId: string | null;
  identityChanged: boolean;
  preserveAccess: boolean;
}

// Keep request ordering independent of React rendering: token refreshes may overlap
// each other, sign-out, or an account switch while their queries are in flight.
export function createAuthRequestState() {
  let revision = 0;
  let userId: string | null = null;
  let verified = false;
  const isCurrent = (request: AuthRequest) => request.revision === revision && request.userId === userId;
  const begin = (nextUserId: string | null): AuthRequest => {
    const identityChanged = userId !== nextUserId;
    if (identityChanged) verified = false;
    userId = nextUserId;
    return { revision: ++revision, userId, identityChanged, preserveAccess: Boolean(userId) && verified };
  };
  return {
    begin,
    refresh(expectedUserId: string): AuthRequest | null {
      return userId === expectedUserId ? begin(expectedUserId) : null;
    },
    isCurrent,
    resolve(request: AuthRequest, active: boolean) {
      if (!isCurrent(request)) return false;
      verified = active;
      return true;
    },
    invalidate() {
      revision++;
      verified = false;
    },
  };
}
