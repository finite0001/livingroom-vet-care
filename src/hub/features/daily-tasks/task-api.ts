import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import {
  operationalMetadataSchema,
  operationalAppointmentSchema,
  operationalHistoryItemSchema,
  verifyOperationalReceipt,
  operationalOperationSchema,
  operationalPolicySchema,
  operationalTaskSchema,
  operationalTemplateSchema,
  operationalUseSchema,
  parseOperationalReceipt,
  validateOperationalRequest,
  type OperationalMetadata,
  type OperationalReceipt,
  type OperationalRequest,
} from "./task-model";
interface OperationalRpc {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: unknown }>;
}
const db = supabase as unknown as OperationalRpc;
async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await db.rpc(name, args);
  if (error) throw error;
  return data;
}
const uuid = z.string().uuid(),
  instant = z.string().datetime({ offset: true });
export async function operationalTemplatesPage(after: string | null = null) {
  return z
    .object({
      items: z.array(operationalTemplateSchema).max(50),
      next: uuid.nullable(),
    })
    .strict()
    .parse(
      await rpc("list_operational_templates", {
        p_after: uuid.nullable().parse(after),
        p_limit: 50,
      }),
    );
}
export async function operationalTemplates() {
  const entries: Awaited<ReturnType<typeof operationalTemplatesPage>>["items"] =
      [],
    seen = new Set<string>();
  let after: string | null = null;
  for (let page = 0; page < 100; page++) {
    const result = await operationalTemplatesPage(after);
    entries.push(...result.items);
    if (!result.next) return entries;
    if (seen.has(result.next))
      throw new Error("Operational template pagination did not advance");
    seen.add(result.next);
    after = result.next;
  }
  throw new Error("Operational templates exceeded the safe page limit");
}
export async function operationalUsesPage(
  appointmentId: string,
  after: string | null = null,
) {
  return z
    .object({
      items: z.array(operationalUseSchema).max(50),
      next: uuid.nullable(),
    })
    .strict()
    .parse(
      await rpc("list_operational_uses", {
        p_appointment_id: uuid.parse(appointmentId),
        p_after: uuid.nullable().parse(after),
        p_limit: 50,
      }),
    );
}
export async function operationalTasksPage(
  from: string,
  until: string,
  resourceId: string | null = null,
  after: string | null = null,
) {
  return z
    .object({
      items: z.array(operationalTaskSchema).max(50),
      next: uuid.nullable(),
    })
    .strict()
    .parse(
      await rpc("list_operational_tasks", {
        p_from: instant.parse(from),
        p_until: instant.parse(until),
        p_resource_id: uuid.nullable().parse(resourceId),
        p_after: uuid.nullable().parse(after),
        p_limit: 50,
        p_include_backlog: true,
      }),
    );
}
export async function operationalAssignees(
  roles: ("STAFF" | "TECH" | "DVM" | "ADMIN")[],
) {
  return z
    .array(
      z
        .object({
          id: uuid,
          name: z.string().nullable(),
          roles: z.array(z.string()),
        })
        .strict(),
    )
    .parse(
      await rpc("list_operational_assignees", {
        p_roles: z
          .array(z.enum(["STAFF", "TECH", "DVM", "ADMIN"]))
          .min(1)
          .max(4)
          .refine((values) => new Set(values).size === values.length)
          .parse(roles),
      }),
    );
}
export async function operationalGenerationPolicy() {
  return operationalPolicySchema
    .nullable()
    .parse(await rpc("read_operational_generation_policy", {}));
}
function args(metadata: OperationalMetadata) {
  const value = operationalMetadataSchema.parse(metadata);
  return { p_actor_id: value.actor_id, p_action_id: value.id };
}
const reviewSchema = z
  .object({
    id: uuid,
    actor_id: uuid,
    operation: operationalOperationSchema,
    request: z.unknown(),
    expires_at: instant,
    receipt: z.unknown().nullable(),
    state: z.enum(["prepared", "saved", "expired", "cancelled"]),
  })
  .strict();
export interface OperationalReview {
  id: string;
  actor_id: string;
  operation: OperationalMetadata["operation"];
  request: OperationalRequest;
  expires_at: string;
  receipt: OperationalReceipt | null;
  state: "prepared" | "saved" | "expired" | "cancelled";
}
function parseReview(
  metadata: OperationalMetadata,
  data: unknown,
): OperationalReview {
  const value = reviewSchema.parse(data);
  if (
    value.id !== metadata.id ||
    value.actor_id !== metadata.actor_id ||
    value.operation !== metadata.operation ||
    (value.state === "saved") !== (value.receipt !== null)
  )
    throw new Error("Operational review identity/receipt mismatch");
  return {
    id: value.id,
    actor_id: value.actor_id,
    operation: value.operation,
    expires_at: value.expires_at,
    state: value.state,
    request: validateOperationalRequest(value.operation, value.request),
    receipt:
      value.receipt === null
        ? null
        : verifyOperationalReceipt(
            metadata,
            validateOperationalRequest(value.operation, value.request),
            value.receipt,
          ),
  };
}
export async function prepareOperationalReview(
  metadata: OperationalMetadata,
  request: OperationalRequest,
) {
  return parseReview(
    metadata,
    await rpc("prepare_operational_review", {
      ...args(metadata),
      p_operation: metadata.operation,
      p_request: validateOperationalRequest(metadata.operation, request),
    }),
  );
}
export async function readOperationalReview(metadata: OperationalMetadata) {
  const data = await rpc("read_operational_review", args(metadata));
  return data === null ? null : parseReview(metadata, data);
}
export async function executeOperationalReview(metadata: OperationalMetadata) {
  return parseOperationalReceipt(
    metadata.operation,
    await rpc("execute_operational_review", args(metadata)),
  );
}
export async function cancelOperationalReview(metadata: OperationalMetadata) {
  const value = z
    .object({
      cancelled: z.boolean(),
      operation: operationalOperationSchema.nullable(),
      receipt: z.unknown().nullable(),
    })
    .strict()
    .parse(await rpc("cancel_operational_review", args(metadata)));
  if (value.cancelled) {
    if (
      value.receipt !== null ||
      (value.operation !== null && value.operation !== metadata.operation)
    )
      throw new Error("Operational cancellation identity mismatch");
    return null;
  }
  if (value.operation !== metadata.operation || value.receipt === null)
    throw new Error("Saved operational receipt required before releasing work");
  return parseOperationalReceipt(metadata.operation, value.receipt);
}

export async function readOperationalTask(id: string) {
  return operationalTaskSchema
    .nullable()
    .parse(await rpc("read_operational_task", { p_id: uuid.parse(id) }));
}

export async function readOperationalAppointment(id: string) {
  return operationalAppointmentSchema
    .nullable()
    .parse(await rpc("read_operational_appointment", { p_id: uuid.parse(id) }));
}
export async function operationalTaskHistory(
  id: string,
  before: number | null = null,
) {
  const value = z
    .object({
      items: z.array(operationalHistoryItemSchema).max(50),
      next: z.number().int().positive().nullable(),
    })
    .strict()
    .parse(
      await rpc("list_operational_task_history", {
        p_id: uuid.parse(id),
        p_before_version: z.number().int().positive().nullable().parse(before),
        p_limit: 50,
      }),
    );
  if (value.items.some((item) => item.revision.task_id !== id))
    throw new Error("Task history identity mismatch");
  return value;
}
