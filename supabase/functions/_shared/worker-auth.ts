/** Server-only credentials. Never accept a JWT merely because its decoded role says service_role. */
export interface WorkerAuthEnvironment {
  SUPABASE_SECRET_KEYS?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
}
export function authenticateWorker(
  request: Request,
  env: WorkerAuthEnvironment,
): string | null {
  const supplied = request.headers.get("apikey");
  if (supplied !== null) {
    // An explicit API key cannot fall back to a different Authorization credential.
    if (!/^sb_secret_[A-Za-z0-9_-]+$/.test(supplied)) return null;
    try {
      const configured: unknown = JSON.parse(
        env.SUPABASE_SECRET_KEYS ?? "null",
      );
      if (
        !configured ||
        typeof configured !== "object" ||
        Array.isArray(configured)
      )
        return null;
      const entries = Object.entries(configured);
      if (
        !entries.length ||
        entries.some(
          ([name, key]) =>
            !name ||
            typeof key !== "string" ||
            !/^sb_secret_[A-Za-z0-9_-]+$/.test(key),
        )
      )
        return null;
      return entries.some(([, key]) => key === supplied) ? supplied : null;
    } catch {
      return null;
    }
  }
  const legacy = env.SUPABASE_SERVICE_ROLE_KEY;
  return legacy && request.headers.get("Authorization") === `Bearer ${legacy}`
    ? legacy
    : null;
}
