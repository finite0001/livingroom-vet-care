import { supabase } from "@/integrations/supabase/client";
import {
  overviewSchema,
  pageSchema,
  outboxSchema,
  candidateSchema,
  blockSchema,
  runSchema,
  schedulerStatusSchema,
  type Cursor,
} from "./OperationsState";
interface RpcClient {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: unknown }>;
}
const db = supabase as unknown as RpcClient;
async function read(name: string, args: Record<string, unknown> = {}) {
  const { data, error } = await db.rpc(name, args);
  if (error) throw error;
  return data;
}
export async function overview() {
  return overviewSchema.parse(await read("operations_overview"));
}
export async function outbox(cursor: Cursor | null, filter: string) {
  return pageSchema(outboxSchema).parse(
    await read("operations_outbox", {
      p_filter: filter,
      p_before_at: cursor?.at ?? null,
      p_before_id: cursor?.id ?? null,
      p_limit: 50,
    }),
  );
}
export async function candidates(cursor: Cursor | null) {
  return pageSchema(candidateSchema).parse(
    await read("operations_reminder_candidates", {
      p_after_key: cursor?.key ?? null,
      p_limit: 50,
    }),
  );
}
export async function blocks(cursor: Cursor | null) {
  return pageSchema(blockSchema).parse(
    await read("operations_reminder_blocks", {
      p_before_at: cursor?.at ?? null,
      p_before_kind: cursor?.kind ?? null,
      p_before_id: cursor?.id ?? null,
      p_limit: 50,
    }),
  );
}
export async function runs(cursor: Cursor | null) {
  return pageSchema(runSchema, false).parse(
    await read("operations_scheduler_runs", {
      p_before_at: cursor?.at ?? null,
      p_before_id: cursor?.id ?? null,
      p_limit: 50,
    }),
  );
}
// The scheduled jobs board is a fixed set, not a page: there are as many rows as
// there are jobs, and never more. It is adapted to the section shape rather than
// pretending to paginate.
export async function schedulerJobs() {
  const status = schedulerStatusSchema.parse(
    await read("operations_scheduler_jobs"),
  );
  return {
    items: status.jobs,
    has_more: false,
    observed_at: status.observed_at,
  };
}
