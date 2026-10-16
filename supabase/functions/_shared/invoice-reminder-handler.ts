import { z } from "zod";
import {
  authenticateWorker,
  type WorkerAuthEnvironment,
} from "./worker-auth.ts";
export interface InvoiceReminderEnvironment extends WorkerAuthEnvironment {
  INVOICE_REMINDERS_ENABLED?: string;
  APP_ENV?: string;
}
export interface InvoiceReminderDatabase {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: unknown }>;
}
const requestSchema = z
  .object({
    run_id: z.string().uuid().optional(),
    limit: z.number().int().min(1).max(100).default(25),
  })
  .strict();
const receiptSchema = z
  .object({
    run_id: z.string().uuid(),
    requested_limit: z.number().int().min(1).max(100),
    queued: z.number().int().min(0).max(100),
    dispatched: z.literal(false),
  })
  .strict()
  .refine((r) => r.queued <= r.requested_limit);
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
async function readBody(request: Request) {
  if (!request.body) return "";
  const reader = request.body.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 1024) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
export function createInvoiceReminderHandler(
  env: InvoiceReminderEnvironment,
  createDatabase: (key: string) => InvoiceReminderDatabase,
) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST")
      return json({ error: "Method not allowed" }, 405);
    const key = authenticateWorker(request, env);
    if (!key) return json({ error: "Service authorization required" }, 401);
    if (env.INVOICE_REMINDERS_ENABLED !== "true")
      return json({ disabled: true, queued: 0, dispatched: false });
    if (!["staging", "production"].includes(env.APP_ENV ?? ""))
      return json({ error: "Explicit environment required" }, 503);
    let input;
    try {
      const text = await readBody(request);
      if (text === null) return json({ error: "Request too large" }, 413);
      input = requestSchema.parse(text.trim() ? JSON.parse(text) : {});
    } catch {
      return json(
        { error: "Only a run identity and bounded integer limit are accepted" },
        400,
      );
    }
    const run = input.run_id ?? crypto.randomUUID();
    const args = { p_run_id: run, p_limit: input.limit };
    const read = (data: unknown) => {
      const r = receiptSchema.parse(data);
      if (r.run_id !== run || r.requested_limit !== input.limit)
        throw new Error("Reminder receipt mismatch");
      return r;
    };
    let db: InvoiceReminderDatabase | null = null;
    try {
      db = createDatabase(key);
      const { data, error } = await db.rpc(
        "execute_invoice_reminder_run",
        args,
      );
      if (error) throw error;
      return json(read(data));
    } catch {
      if (db)
        try {
          const { data, error } = await db.rpc(
            "recover_invoice_reminder_run",
            args,
          );
          if (error) throw error;
          if (data) return json(read(data));
        } catch {
          /* An uncertain acknowledgement never executes queue work twice. */
        }
      return json(
        {
          run_id: run,
          requested_limit: input.limit,
          outcome: "unknown",
          dispatched: false,
        },
        202,
      );
    }
  };
}
