import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { PrescriptionItemMapping } from "./prescription-item-api";
export interface AttachmentMapping extends Required<PrescriptionItemMapping> {}
const uuid = z.string().uuid();
const date = z.string().refine((v) => Number.isFinite(Date.parse(v)));
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const sourceId = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/)
  .refine((v) => Number.isSafeInteger(Number(v)));
const scalar = z.union([
  z.string().max(1024),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);
const metadataSchema = z
  .object({
    id: sourceId,
    file_id: sourceId,
    record_type: z.literal("Animal"),
    record_id: sourceId,
    active: scalar.optional(),
    primary_image: scalar.optional(),
    created_at: z
      .union([z.string().max(1024), z.number().finite(), z.null()])
      .optional(),
    modified_at: z
      .union([z.string().max(1024), z.number().finite(), z.null()])
      .optional(),
    mime_type: z.string().max(1024).nullable().optional(),
    name: z.string().max(1024).nullable().optional(),
    notes: z.string().max(16384).nullable().optional(),
  })
  .strict();
const parentSchema = z
  .object({
    animal_link_id: uuid,
    pet_id: uuid,
    client_id: uuid,
    animal_external_id: sourceId,
    source_origin: z.string().url(),
    source_site_uid: z.string(),
    parent_type: z.literal("Animal"),
    parent_external_id: sourceId,
    parent_snapshot_id: uuid,
    parent_payload_hash: hash,
    parent_observed_head_version: z.number().int().positive(),
  })
  .strict();
const runSchema = z
  .object({
    id: uuid,
    requested_by: uuid,
    resource: z.literal("attachment"),
    source_origin: z.string().url(),
    source_site_uid: z.string(),
    status: z.enum(["running", "review_ready", "page_limit_reached"]),
    next_page: z.number().int().positive(),
    retry_after: date.nullable(),
    last_error_code: z
      .string()
      .regex(/^[A-Z0-9_]+$/)
      .nullable(),
    created_at: date,
    updated_at: date,
    lease_active: z.boolean(),
    scope: z.literal("animal_attachment_metadata"),
    parent_context: parentSchema,
    observed_count: z.number().int().nonnegative(),
    staged_count: z.number().int().nonnegative(),
    capture_available: z.literal(false),
  })
  .strict();
export type AttachmentRun = z.infer<typeof runSchema>;
const runCursorSchema = z.object({ before_at: date, before_id: uuid }).strict();
export type AttachmentRunCursor = z.infer<typeof runCursorSchema>;
const observationCursorSchema = z
  .object({
    after_page: z.number().int().positive(),
    after_ordinal: z.number().int().positive(),
  })
  .strict();
export type AttachmentObservationCursor = z.infer<
  typeof observationCursorSchema
>;
const observationSchema = z
  .object({
    run_id: uuid,
    page: z.number().int().positive(),
    ordinal: z.number().int().positive(),
    external_id: sourceId,
    file_id: sourceId,
    metadata: metadataSchema,
    raw_record_sha256: hash,
    stable_metadata_sha256: hash,
    snapshot_id: uuid,
    observed_head_version: z.number().int().positive(),
    is_current: z.boolean(),
    created_at: date,
    file_sha256: z.null(),
  })
  .strict();
export type AttachmentObservation = z.infer<typeof observationSchema>;
interface Database {
  public: {
    Tables: Record<never, never>;
    Views: Record<never, never>;
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
    Functions: {
      [key: string]: { Args: Record<string, unknown>; Returns: unknown };
    };
  };
}
const client = supabase as unknown as SupabaseClient<Database>;
async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await client.rpc(name, args);
  if (error)
    throw new Error(
      "Attachment data unavailable. Recheck the original run before continuing.",
    );
  return data;
}
function validateRun(
  value: unknown,
  actor: string,
  mapping: AttachmentMapping,
) {
  const r = runSchema.parse(value),
    p = r.parent_context;
  if (
    r.requested_by !== actor ||
    r.source_origin !== mapping.source_origin ||
    r.source_site_uid !== mapping.source_site_uid ||
    p.source_origin !== mapping.source_origin ||
    p.source_site_uid !== mapping.source_site_uid ||
    p.animal_link_id !== mapping.link_id ||
    p.pet_id !== mapping.pet_id ||
    p.animal_external_id !== mapping.external_id ||
    p.parent_external_id !== mapping.external_id ||
    r.staged_count > r.observed_count
  )
    throw new Error(
      "Attachment run identity differs. Original request retained.",
    );
  return r;
}
export async function recoverAttachmentRun(
  id: string,
  actor: string,
  mapping: AttachmentMapping,
) {
  const value = await rpc("recover_ezyvet_attachment_run", {
    p_id: uuid.parse(id),
    p_animal_link_id: mapping.link_id,
  });
  if (value === null) return null;
  const run = validateRun(value, actor, mapping);
  if (run.id !== id)
    throw new Error("Recovered request differs. Original request retained.");
  return run;
}
export async function listAttachmentRuns(
  actor: string,
  mapping: AttachmentMapping,
  cursor: AttachmentRunCursor | null,
) {
  const page = z
    .object({
      runs: z.array(z.unknown()).max(20),
      has_more: z.boolean(),
      next_cursor: runCursorSchema.nullable(),
    })
    .strict()
    .parse(
      await rpc("list_ezyvet_attachment_runs", {
        p_animal_link_id: mapping.link_id,
        p_before_at: cursor?.before_at ?? null,
        p_before_id: cursor?.before_id ?? null,
        p_limit: 20,
      }),
    );
  if (page.has_more !== !!page.next_cursor)
    throw new Error("Run pagination unavailable.");
  return {
    ...page,
    runs: page.runs.map((r) => validateRun(r, actor, mapping)),
  };
}
export async function listAttachmentObservations(
  run: AttachmentRun,
  mapping: AttachmentMapping,
  cursor: AttachmentObservationCursor | null,
) {
  const page = z
    .object({
      observations: z.array(observationSchema).max(20),
      has_more: z.boolean(),
      next_cursor: observationCursorSchema.nullable(),
    })
    .strict()
    .parse(
      await rpc("list_ezyvet_attachment_observations", {
        p_run_id: run.id,
        p_animal_link_id: mapping.link_id,
        p_after_page: cursor?.after_page ?? null,
        p_after_ordinal: cursor?.after_ordinal ?? null,
        p_limit: 20,
      }),
    );
  let previous = cursor;
  for (const o of page.observations) {
    if (
      o.run_id !== run.id ||
      o.metadata.record_id !== mapping.external_id ||
      o.metadata.id !== o.external_id ||
      o.metadata.file_id !== o.file_id ||
      (previous &&
        (o.page < previous.after_page ||
          (o.page === previous.after_page &&
            o.ordinal <= previous.after_ordinal)))
    )
      throw new Error("Observation identity or ordering differs.");
    previous = { after_page: o.page, after_ordinal: o.ordinal };
  }
  if (
    page.has_more !== !!page.next_cursor ||
    (page.next_cursor &&
      (!page.observations.length ||
        page.next_cursor.after_page !== previous?.after_page ||
        page.next_cursor.after_ordinal !== previous?.after_ordinal))
  )
    throw new Error("Observation pagination unavailable.");
  return page;
}
export async function stageAttachmentPage(
  id: string,
  mapping: AttachmentMapping,
) {
  const { data, error } = await supabase.functions.invoke("ezyvet-import", {
    body: {
      run_id: uuid.parse(id),
      resource: "attachment",
      animal_link_id: uuid.parse(mapping.link_id),
    },
  });
  if (error)
    throw new Error(
      "Page response unconfirmed. Recheck this original run before continuing; source access may require administrator setup.",
    );
  const result = z
    .object({
      run_id: uuid,
      status: z.enum(["running", "review_ready", "page_limit_reached"]),
      next_page: z.number().int().positive(),
      complete: z.boolean(),
    })
    .parse(data);
  if (result.run_id !== id)
    throw new Error(
      "Page response unconfirmed. Recheck this original run before continuing.",
    );
}
