import { z } from "zod";
import { sourceLabels } from "../record-releases/selection.ts";
const uuid = z.string().uuid(),
  version = z.number().int().positive();
export const statuses = [
  "requested",
  "awaiting_response",
  "preparing",
  "received",
  "ready",
  "fulfilled",
  "blocked",
  "cancelled",
] as const;
export const selectionSchema = z
  .object(
    Object.fromEntries(
      Object.keys(sourceLabels).map((k) => [
        k,
        z
          .array(uuid)
          .max(10000)
          .refine((a) => new Set(a).size === a.length)
          .optional(),
      ]),
    ),
  )
  .strict();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const saveValuesSchema = z
  .object({
    pet_id: uuid,
    client_id: uuid,
    direction: z.enum(["incoming", "outgoing"]),
    subset: z.enum(["full", "vaccines", "labs", "custom"]),
    channel: z.enum(["EMAIL", "SMS"]).nullable(),
    recipient_kind: z.enum(["client", "third_party"]),
    recipient_name: z.string().max(160).nullable(),
    recipient_email: z.string().email().max(254).nullable(),
    requester_name: z.string().trim().min(1).max(160),
    request_note: z.string().max(2000),
    requested_on: date,
    due_on: date.nullable(),
    assigned_to: uuid.nullable(),
    ticket_id: uuid.nullable(),
    conversation_id: uuid.nullable(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.due_on && v.due_on < v.requested_on)
      ctx.addIssue({
        code: "custom",
        message: "Due date precedes request date",
      });
    if (v.direction === "outgoing" && !v.channel)
      ctx.addIssue({ code: "custom", message: "Delivery channel required" });
    if (
      v.recipient_kind === "third_party" &&
      (v.direction !== "outgoing" ||
        v.channel !== "EMAIL" ||
        !v.recipient_name?.trim() ||
        !v.recipient_email)
    )
      ctx.addIssue({
        code: "custom",
        message: "Named third-party email required",
      });
  });
export const requestSchema = z.object({
  id: uuid,
  client_id: uuid,
  pet_id: uuid,
  direction: z.enum(["incoming", "outgoing"]),
  subset: z.enum(["full", "vaccines", "labs", "custom"]),
  channel: z.enum(["EMAIL", "SMS"]).nullable(),
  recipient: z.string().nullable(),
  recipient_kind: z.enum(["client", "third_party"]),
  recipient_name: z.string().nullable(),
  requester_name: z.string(),
  request_note: z.string(),
  requested_on: date,
  due_on: date.nullable(),
  assigned_to: uuid.nullable(),
  ticket_id: uuid.nullable(),
  conversation_id: uuid.nullable(),
  status: z.enum(statuses),
  active_manifest_id: uuid.nullable(),
  version,
  created_by: uuid,
  updated_by: uuid,
  created_at: z.string(),
  updated_at: z.string(),
});
export type RecordRequest = z.infer<typeof requestSchema>;
export type SaveValues = z.infer<typeof saveValuesSchema>;
export const manifestSchema = z.object({
  id: uuid,
  request_id: uuid,
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  package_count: version,
  source_count: version,
  captured_at: z.string(),
  subset: z.string(),
  channel: z.enum(["EMAIL", "SMS"]),
  recipient: z.string(),
});
export const detailSchema = z.object({
  request: requestSchema,
  pet_name: z.string(),
  client_name: z.string(),
  manifest: manifestSchema.nullable(),
  receipt_count: z.number().int().nonnegative().default(0),
  disclosure_policy_accepted: z.boolean(),
  authorization: z
    .object({
      id: uuid,
      client_authority: z.string(),
      destination_verification: z.string(),
      expires_at: z.string(),
      revoked: z.boolean(),
      current: z.boolean(),
    })
    .nullable(),
});
export const cursorSchema = z
  .object({ updated_at: z.string(), id: uuid })
  .strict();
export const filterSchema = z
  .object({
    pet_id: uuid.optional(),
    client_id: uuid.optional(),
    ticket_id: uuid.optional(),
    status: z.enum(statuses).optional(),
    direction: z.enum(["incoming", "outgoing"]).optional(),
    assigned_to: uuid.optional(),
    overdue: z.boolean().optional(),
  })
  .strict();
export const pageSchema = z.object({
  items: z
    .array(
      requestSchema.extend({
        pet_name: z.string(),
        client_name: z.string(),
        assignee_name: z.string(),
      }),
    )
    .max(50),
  next: cursorSchema.nullable(),
});
export const choicesSchema = z.object({
  patients: z
    .array(
      z.object({
        id: uuid,
        name: z.string(),
        client_id: uuid,
        client_name: z.string(),
      }),
    )
    .max(51),
  staff: z.array(z.object({ id: uuid, name: z.string().nullable() })),
});
export const documentsSchema = z
  .array(
    z.object({
      id: uuid,
      version,
      file_name: z.string(),
      category: z.string(),
      created_at: z.string(),
    }),
  )
  .max(51);
export const deliverySchema = z.object({
  outbox_id: uuid,
  state: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});
export const packageSchema = z.object({
  id: uuid,
  ordinal: version,
  release_id: uuid,
  selection: selectionSchema,
  scope_expansion: z.boolean(),
  source_hash: z.string(),
  confirmed: z.boolean(),
  deliveries: z.array(deliverySchema),
});
export const packagesSchema = z.object({
  items: z.array(packageSchema).max(20),
  next: version.nullable(),
});
const note = z.string().trim().min(1).max(2000);
export const actionSchemas = {
  save: saveValuesSchema,
  manifest: z
    .object({
      manifest_id: uuid,
      selection: selectionSchema,
      review_note: note,
    })
    .strict(),
  confirm: z
    .object({
      package_id: uuid,
      manifest_hash: z.string().regex(/^[a-f0-9]{64}$/),
      attest_review: z.literal(true),
      attest_scope_expansion: z.boolean(),
    })
    .strict(),
  receive: z
    .object({
      documents: z
        .array(z.object({ id: uuid, version }).strict())
        .min(1)
        .max(100),
      review_note: note,
    })
    .strict(),
  transition: z
    .object({
      status: z.enum([
        "requested",
        "awaiting_response",
        "received",
        "preparing",
        "ready",
        "fulfilled",
        "blocked",
        "cancelled",
      ]),
      review_note: note,
    })
    .strict(),
  authorize: z
    .object({
      authorization_id: uuid,
      manifest_hash: z.string().regex(/^[a-f0-9]{64}$/),
      client_authority: note,
      destination_verification: note,
      evidence_document_id: uuid.nullable(),
      evidence_document_version: version.nullable(),
      expires_on: date,
      attest_client_authority: z.literal(true),
      attest_destination: z.literal(true),
      attest_source_scope: z.literal(true),
    })
    .strict(),
  revoke_authorization: z
    .object({ authorization_id: uuid, review_note: note })
    .strict(),
};
export interface RequestAction {
  kind: keyof typeof actionSchemas;
  entityId: string;
  expectedVersion: number | null;
  values: unknown;
}
export const receiptSchema = z.object({ request: requestSchema }).passthrough();
export const selectClass =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm";
export const statusLabel = (s: string) => s.replace(/_/g, " ");
