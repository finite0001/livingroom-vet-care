export interface ReminderSchedulerEnvironment {
  SUPABASE_SERVICE_ROLE_KEY?: string;
  REMINDER_SCHEDULER_ENABLED?: string;
  APP_ENV?: string;
}
export interface ReminderSchedulerDatabase {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: unknown }>;
}
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
export function createReminderSchedulerHandler(
  env: ReminderSchedulerEnvironment,
  createDatabase: () => ReminderSchedulerDatabase,
) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST")
      return json({ error: "Method not allowed" }, 405);
    if (
      !env.SUPABASE_SERVICE_ROLE_KEY ||
      request.headers.get("Authorization") !==
        `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
    )
      return json({ error: "Service authorization required" }, 401);
    // Disabled means no database client, no claims and no outbox work.
    if (env.REMINDER_SCHEDULER_ENABLED !== "true")
      return json({ disabled: true, queued: 0, dispatched: false });
    if (!["staging", "production"].includes(env.APP_ENV ?? ""))
      return json(
        {
          error: "Explicit staging or production environment required",
          dispatched: false,
        },
        503,
      );
    let limit = 25;
    try {
      const text = await request.text();
      if (text.length > 1024) return json({ error: "Request too large" }, 413);
      if (text) {
        const input: unknown = JSON.parse(text);
        if (
          !input ||
          typeof input !== "object" ||
          Array.isArray(input) ||
          Object.keys(input).some((key) => key !== "limit")
        )
          return json({ error: "Only a bounded limit is accepted" }, 400);
        if ("limit" in input) {
          if (
            !Number.isInteger(input.limit) ||
            Number(input.limit) < 1 ||
            Number(input.limit) > 100
          )
            return json(
              { error: "Limit must be an integer from 1 to 100" },
              400,
            );
          limit = Number(input.limit);
        }
      }
    } catch {
      return json({ error: "Invalid JSON request" }, 400);
    }
    try {
      const { data, error } = await createDatabase().rpc(
        "queue_due_reminders",
        { p_limit: limit },
      );
      if (error) throw error;
      return json({ result: data, dispatched: false });
    } catch {
      return json(
        {
          error:
            "Queue persistence failed; reconcile durable job and outbox identities before retrying",
          dispatched: false,
        },
        500,
      );
    }
  };
}
