import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import {
  helperRequestSchema,
  helperResultSchema,
} from "../../../../supabase/functions/_shared/clinical-helper-contract";
const uuid = z.string().uuid(),
  instant = z.iso.datetime({ offset: true });
export const clinicalToolsSchema = z.object({
  can_review: z.boolean(),
  protocols: z.array(
    z.object({
      tool: z.string(),
      version: z.string(),
      approved_at: instant,
      review_note: z.string(),
    }),
  ),
  patient: z
    .object({ id: uuid, name: z.string(), species: z.string() })
    .nullable(),
  encounters: z.array(
    z.object({ id: uuid, visit_at: instant, assessment: z.string() }),
  ),
  labs: z.array(
    z.object({
      id: uuid,
      test_name: z.string(),
      result_date: z.iso.date(),
      version: z.number(),
    }),
  ),
  calculations: z.array(
    z.object({
      id: uuid,
      pet_id: uuid,
      tool: z.string(),
      result: z.object({
        version: z.string(),
        values: z.record(z.string(), z.union([z.string(), z.number()])),
      }),
      created_at: instant,
    }),
  ),
  helpers: z.array(
    z.object({
      id: uuid,
      pet_id: uuid,
      kind: z.string(),
      state: z.enum(["GENERATING", "GENERATED", "FAILED", "APPROVED"]),
      result: helperResultSchema.nullable(),
      failure: z.string().nullable(),
      reviewed_text: z.string().nullable(),
      reviewed_at: instant.nullable(),
      created_at: instant,
    }),
  ),
  pill_references: z.array(
    z.object({
      id: uuid,
      name: z.string(),
      imprint: z.string(),
      shape: z.string(),
      color: z.string(),
      strength: z.string(),
      source_url: z.url().startsWith("https://"),
    }),
  ),
});
interface RpcClient {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}
export async function clinicalCall(
  name: string,
  args: Record<string, unknown>,
) {
  const { data, error } = await (supabase as unknown as RpcClient).rpc(
    name,
    args,
  );
  if (error) throw new Error(error.message);
  return data;
}
export async function readClinicalTools(pet: string | null) {
  return clinicalToolsSchema.parse(
    await clinicalCall("clinical_tools_read", {
      p_pet_id: uuid.nullable().parse(pet),
    }),
  );
}
export async function generateHelper(value: unknown) {
  const input = helperRequestSchema.safeParse(value);
  if (!input.success)
    throw new Error(input.error.issues.map((i) => i.message).join("; "));
  const { data, error } = await supabase.functions.invoke("clinical-helper", {
    body: input.data,
  });
  if (error) {
    if (error.context instanceof Response) {
      const body = z.object({ error: z.string() }).safeParse(
        await error.context
          .clone()
          .json()
          .catch(() => null),
      );
      if (body.success) throw new Error(body.data.error);
    }
    throw error;
  }
  const receipt = z
    .object({ id: uuid, state: z.literal("GENERATED") })
    .parse(data);
  if (receipt.id !== input.data.id)
    throw new Error("Refresh the saved job before retrying.");
}
