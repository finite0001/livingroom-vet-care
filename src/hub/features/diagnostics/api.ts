import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import {
  actionSchema,
  detailSchema,
  pageSchema,
  historySchema,
  trendsSchema,
  cursorSchema,
  type DiagnosticAction,
} from "./model";
interface RpcClient {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: unknown }>;
}
async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await (supabase as unknown as RpcClient).rpc(
    name,
    args,
  );
  if (error) throw error;
  return data;
}
const uuid = z.string().uuid();
export async function list(
  pet: string,
  before: z.infer<typeof cursorSchema> | null,
) {
  const r = pageSchema.parse(
    await rpc("list_diagnostic_panels", {
      p_pet_id: uuid.parse(pet),
      p_before: cursorSchema.nullable().parse(before),
      p_limit: 20,
    }),
  );
  if (r.items.some((d) => d.panel.pet_id !== pet))
    throw new Error("Diagnostic page patient differs");
  return r;
}
export async function read(id: string, pet: string) {
  const r = detailSchema.nullable().parse(
    await rpc("read_diagnostic_panel", {
      p_id: uuid.parse(id),
      p_pet_id: uuid.parse(pet),
    }),
  );
  if (r && (r.panel.id !== id || r.panel.pet_id !== pet))
    throw new Error("Diagnostic identity differs");
  return r;
}
export async function history(id: string, pet: string, before: number | null) {
  const r = historySchema.parse(
    await rpc("list_diagnostic_history", {
      p_id: uuid.parse(id),
      p_pet_id: uuid.parse(pet),
      p_before: z.number().int().positive().nullable().parse(before),
      p_limit: 20,
    }),
  );
  if (r.items.some((v) => v.panel_id !== id || v.pet_id !== pet))
    throw new Error("Diagnostic history differs");
  return r;
}
export async function trends(
  pet: string,
  cursor: { after: string; hash: string } | null,
) {
  const r = trendsSchema.parse(
    await rpc("list_diagnostic_trends", {
      p_pet_id: uuid.parse(pet),
      p_after: cursor ? uuid.parse(cursor.after) : null,
      p_limit: 50,
      p_census_hash: cursor
        ? z
            .string()
            .regex(/^[a-f0-9]{64}$/)
            .parse(cursor.hash)
        : null,
    }),
  );
  if (r.items.some((v) => v.pet_id !== pet))
    throw new Error("Diagnostic trend patient differs");
  return r;
}
function args(actionId: string, value: DiagnosticAction) {
  const a = actionSchema.parse(value);
  return {
    p_action_id: uuid.parse(actionId),
    p_id: a.id,
    p_pet_id: a.pet_id,
    p_expected_version: a.expected_version,
    p_kind: a.kind,
    p_values: a.values,
    p_review_note: a.review_note,
    p_correction_reason: a.correction_reason,
  };
}
export async function save(id: string, a: DiagnosticAction) {
  const r = detailSchema.parse(await rpc("save_diagnostic_panel", args(id, a)));
  if (r.panel.id !== a.id || r.panel.pet_id !== a.pet_id)
    throw new Error("Saved diagnostic identity differs");
  return r;
}
export async function recover(id: string, a: DiagnosticAction) {
  const r = detailSchema
    .nullable()
    .parse(await rpc("read_diagnostic_action", args(id, a)));
  if (r && (r.panel.id !== a.id || r.panel.pet_id !== a.pet_id))
    throw new Error("Recovered diagnostic identity differs");
  return r;
}
