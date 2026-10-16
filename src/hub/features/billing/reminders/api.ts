import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { detailSchema, policySchema, termsSchema } from "./model";
interface RpcClient {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: unknown }>;
}
async function call(name: string, args: Record<string, unknown>) {
  const { data, error } = await (supabase as unknown as RpcClient).rpc(
    name,
    args,
  );
  if (error) throw error;
  return data;
}
const uuid = z.string().uuid();
export async function readReminders(
  actor: string,
  invoice: string,
  client: string,
) {
  const result = detailSchema.parse(
    await call("read_invoice_reminders", {
      p_actor_id: uuid.parse(actor),
      p_invoice_id: uuid.parse(invoice),
      p_client_id: uuid.parse(client),
    }),
  );
  if (result.invoice_id !== invoice || result.client_id !== client)
    throw new Error("Reminder household differs.");
  return result;
}
export interface ReminderAction {
  id: string;
  actor: string;
  kind: "policy" | "terms";
  request: Record<string, unknown>;
}
function receipt(value: unknown, action: ReminderAction) {
  const result = z
    .object({ id: uuid, actor_id: uuid, version: z.number().int().positive() })
    .passthrough()
    .parse(value);
  if (
    result.id !== action.id ||
    result.actor_id !== action.actor ||
    result.version !== Number(action.request.expected_version) + 1
  )
    throw new Error("Reminder save receipt differs from the original action.");
  if (
    action.kind === "policy" &&
    JSON.stringify(result.definition) !==
      JSON.stringify(action.request.definition)
  ) {
    const returned = policySchema.parse(result.definition),
      expected = policySchema.parse(action.request.definition);
    if (JSON.stringify(returned) !== JSON.stringify(expected))
      throw new Error("Saved reminder policy differs.");
  }
  if (action.kind === "terms") {
    if (
      result.invoice_id !== action.request.invoice_id ||
      result.client_id !== action.request.client_id ||
      JSON.stringify(termsSchema.parse(result.values)) !==
        JSON.stringify(termsSchema.parse(action.request.values))
    )
      throw new Error("Saved invoice reminder terms differ.");
  }
  return result;
}
export async function saveReminderAction(action: ReminderAction) {
  const args = {
    p_actor_id: uuid.parse(action.actor),
    p_id: uuid.parse(action.id),
  };
  if (action.kind === "policy") {
    const request = z
      .object({
        expected_version: z.number().int().nonnegative(),
        definition: policySchema,
      })
      .strict()
      .parse(action.request);
    receipt(
      await call("save_invoice_reminder_policy", {
        ...args,
        p_expected_version: request.expected_version,
        p_definition: request.definition,
      }),
      action,
    );
  } else {
    const request = z
      .object({
        invoice_id: uuid,
        client_id: uuid,
        expected_version: z.number().int().nonnegative(),
        values: termsSchema,
      })
      .strict()
      .parse(action.request);
    receipt(
      await call("save_invoice_reminder_terms", {
        ...args,
        p_invoice_id: request.invoice_id,
        p_client_id: request.client_id,
        p_expected_version: request.expected_version,
        p_values: request.values,
      }),
      action,
    );
  }
}
export async function recoverReminderAction(action: ReminderAction) {
  const value = await call("recover_invoice_reminder_action", {
    p_actor_id: uuid.parse(action.actor),
    p_id: uuid.parse(action.id),
    p_kind: action.kind,
    p_request: action.request,
  });
  return value === null ? null : receipt(value, action);
}
