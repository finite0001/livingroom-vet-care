/**
 * A liveness probe for the deployed backend.
 *
 * This endpoint is public by design: an uptime monitor has no credential, so it
 * must answer without one. That is exactly why it discloses nothing. It reports
 * only whether the database answered and when it was asked. It never returns the
 * database error, a version, a table name or a count, because a public endpoint's
 * error text is free reconnaissance for anyone who asks it at a bad moment.
 *
 * It is deliberately not a readiness report either: it says the database answers,
 * and says nothing about whether providers are configured, whether delivery is
 * enabled, or whether the scheduler is running. Those are visible to staff on
 * /hub/admin/operations, which is behind an administrator check.
 */
export interface HealthDependencies {
  /** Resolves when the database answered; rejects when it did not. */
  pingDatabase: () => Promise<void>;
  /** Injected so the response timestamp can be asserted. */
  now?: () => Date;
}

const headers = {
  "Content-Type": "application/json",
  // A monitor must never be shown a cached answer from a healthier moment.
  "Cache-Control": "no-store",
};

export function createHealthHandler(deps: HealthDependencies) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { ...headers, Allow: "GET, HEAD" },
      });
    }

    const checked_at = (deps.now?.() ?? new Date()).toISOString();
    let status = 200;
    let body: Record<string, unknown> = { status: "ok", checked_at };

    try {
      await deps.pingDatabase();
    } catch {
      // Opaque on purpose - see the file comment.
      status = 503;
      body = { status: "unavailable", checked_at };
    }

    return new Response(request.method === "HEAD" ? null : JSON.stringify(body), {
      status,
      headers,
    });
  };
}
