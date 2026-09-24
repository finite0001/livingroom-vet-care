import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
const uuid = z.string().uuid();
const date = z
  .string()
  .refine((v) => Number.isFinite(Date.parse(v)), "Invalid timestamp");
export const resourceSchema = z.literal("prescriptionitem");
export type PrescriptionItemResource = z.infer<typeof resourceSchema>;
const mappingSchema = z.object({
  link_id: uuid,
  pet_id: uuid,
  patient_name: z.string(),
  household_name: z.string(),
  source_origin: z.string().url(),
  source_site_uid: z.string(),
  external_id: z.string(),
  patient_version: z.number().int().positive(),
});
export type PrescriptionItemMapping = z.infer<typeof mappingSchema>;
const runSchema = z.object({
  id: uuid,
  requested_by: uuid,
  resource: resourceSchema,
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
  scope: z.enum(["prescription_scoped", "legacy_unscoped"]),
  animal_link_id: uuid.nullable(),
  animal_external_id: z.string().nullable(),
  pet_id: uuid.nullable(),
  client_id: uuid.nullable(),
  lease_active: z.boolean(),
  prescription_snapshot_id: uuid.nullable(),
  prescription_payload_hash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
  prescription_observed_head_version: z.number().int().positive().nullable(),
  prescription_external_id: z.string().nullable(),
});
export type PrescriptionItemRun = z.infer<typeof runSchema>;
const cursorSchema = z.object({ before_at: date, before_id: uuid });
export type PrescriptionItemCursor = z.infer<typeof cursorSchema>;
export const candidateSchema = z.object({
  id: uuid,
  payload: z.record(z.unknown()),
  payload_hash: z.string().regex(/^[a-f0-9]{64}$/),
  external_id: z.string(),
  resource: resourceSchema,
  source_origin: z.string().url(),
  source_site_uid: z.string(),
  created_at: date,
  head_version: z.number().int().positive(),
  current_snapshot_id: uuid,
  is_current: z.boolean(),
  observed_head_version: z.number().int().positive(),
  current_head_scoped: z.boolean(),
  is_current_snapshot: z.boolean(),
  animal_link_id: uuid,
  pet_id: uuid,
  client_id: uuid,
  prescription_snapshot_id: uuid,
  prescription_payload_hash: z.string().regex(/^[a-f0-9]{64}$/),
  prescription_observed_head_version: z.number().int().positive(),
  prescription_external_id: z.string(),
  prescription_head_version: z.number().int().positive(),
  prescription_current_snapshot_id: uuid,
  prescription_is_current: z.boolean(),
  eligible_for_review: z.boolean(),
});
export type PrescriptionItemCandidate = z.infer<typeof candidateSchema>;
interface PrescriptionItemDatabase {
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
const client = supabase as unknown as SupabaseClient<PrescriptionItemDatabase>;
async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await client.rpc(name, args);
  if (error)
    throw new Error(
      "PrescriptionItem import data unavailable. Recheck the original run before continuing.",
    );
  return data;
}
export interface PrescriptionItemContext {
  prescription_snapshot_id: string;
  prescription_payload_hash: string;
  prescription_observed_head_version: number;
}
export const contextSchema = z.object({
  prescription_snapshot_id: uuid,
  prescription_payload_hash: z.string().regex(/^[a-f0-9]{64}$/),
  prescription_observed_head_version: z.number().int().positive(),
});
export function contextOf(c: unknown): PrescriptionItemContext {
  const v = contextSchema.parse(c);
  return {
    prescription_snapshot_id: v.prescription_snapshot_id!,
    prescription_payload_hash: v.prescription_payload_hash!,
    prescription_observed_head_version: v.prescription_observed_head_version!,
  };
}
function validateRun(
  value: unknown,
  actor: string,
  mapping: PrescriptionItemMapping,
  resource: PrescriptionItemResource,
) {
  const r = runSchema.parse(value);
  if (
    r.requested_by !== actor ||
    r.resource !== resource ||
    r.source_origin !== mapping.source_origin ||
    r.source_site_uid !== mapping.source_site_uid
  )
    throw new Error(
      "Recovered run identity differs. Original request retained.",
    );
  if (
    r.scope === "prescription_scoped"
      ? r.animal_link_id !== mapping.link_id ||
        r.pet_id !== mapping.pet_id ||
        r.animal_external_id !== mapping.external_id ||
        !r.client_id ||
        !r.prescription_snapshot_id ||
        !r.prescription_payload_hash ||
        !r.prescription_observed_head_version ||
        !r.prescription_external_id
      : r.animal_link_id !== null ||
        r.pet_id !== null ||
        r.client_id !== null ||
        r.animal_external_id !== null ||
        r.prescription_snapshot_id !== null ||
        r.prescription_payload_hash !== null ||
        r.prescription_observed_head_version !== null ||
        r.prescription_external_id !== null
  )
    throw new Error(
      "Recovered patient scope differs. Original request retained.",
    );
  return r;
}
export async function recoverPrescriptionItemRun(
  id: string,
  actor: string,
  mapping: PrescriptionItemMapping,
  context: PrescriptionItemContext,
) {
  context = contextOf(context);
  const resource = "prescriptionitem";
  const value = await rpc("recover_ezyvet_prescriptionitem_run", {
    p_id: id,
    p_animal_link_id: mapping.link_id,
    p_prescription_snapshot_id: context.prescription_snapshot_id,
    p_prescription_payload_hash: context.prescription_payload_hash,
    p_prescription_observed_head_version: context.prescription_observed_head_version,
  });
  if (value === null) return null;
  const r = validateRun(value, actor, mapping, resource);
  if (
    r.id !== id ||
    (r.scope === "prescription_scoped" &&
      (r.prescription_snapshot_id !== context.prescription_snapshot_id ||
        r.prescription_payload_hash !== context.prescription_payload_hash ||
        r.prescription_observed_head_version !==
          context.prescription_observed_head_version))
  )
    throw new Error("Recovered request differs. Original request retained.");
  return r;
}
const pageArgs = (
  mapping: PrescriptionItemMapping,
  cursor: PrescriptionItemCursor | null,
) => ({
  p_animal_link_id: mapping.link_id,
  p_before_at: cursor?.before_at ?? null,
  p_before_id: cursor?.before_id ?? null,
  p_limit: 20,
});
export async function listPrescriptionItemRuns(
  actor: string,
  mapping: PrescriptionItemMapping,
  resource: PrescriptionItemResource,
  cursor: PrescriptionItemCursor | null,
) {
  const p = z
    .object({
      runs: z.array(z.unknown()).max(20),
      has_more: z.boolean(),
      next_cursor: cursorSchema.nullable(),
    })
    .parse(
      await rpc("list_ezyvet_prescriptionitem_runs", pageArgs(mapping, cursor)),
    );
  if (p.has_more !== !!p.next_cursor)
    throw new Error("Run pagination unavailable");
  return {
    ...p,
    runs: p.runs.map((r) => validateRun(r, actor, mapping, resource)),
  };
}
export async function listPrescriptionItemCandidates(
  mapping: PrescriptionItemMapping,
  resource: PrescriptionItemResource,
  cursor: PrescriptionItemCursor | null,
) {
  const p = z
    .object({
      animal_link_id: uuid,
      resource: resourceSchema,
      candidates: z.array(candidateSchema).max(20),
      has_more: z.boolean(),
      next_cursor: cursorSchema.nullable(),
    })
    .parse(
      await rpc(
        "list_ezyvet_prescriptionitem_candidates",
        pageArgs(mapping, cursor),
      ),
    );
  if (
    p.animal_link_id !== mapping.link_id ||
    p.resource !== resource ||
    p.has_more !== !!p.next_cursor ||
    p.candidates.some(
      (c) =>
        c.animal_link_id !== mapping.link_id ||
        c.pet_id !== mapping.pet_id ||
        c.resource !== resource ||
        c.source_origin !== mapping.source_origin ||
        c.source_site_uid !== mapping.source_site_uid ||
        c.is_current_snapshot !== (c.id === c.current_snapshot_id) ||
        c.is_current !==
          (c.is_current_snapshot &&
            c.observed_head_version === c.head_version) ||
        c.current_head_scoped !== c.is_current ||
        c.prescription_is_current !==
          (c.prescription_snapshot_id === c.prescription_current_snapshot_id &&
            c.prescription_observed_head_version === c.prescription_head_version) ||
        c.eligible_for_review !== (c.is_current && c.prescription_is_current),
    )
  )
    throw new Error("Source scope or pagination differs");
  return p;
}
const errors: Record<string, string> = {
  SOURCE_PRESCRIPTION_STALE:
    "This prescription observation has changed. Recover the original run, then refresh prescription evidence before starting another scan.",
  IMPORT_DISABLED:
    "Source access is not commissioned. Server setup is required.",
  UPSTREAM_SCOPE_DENIED:
    "The provider denied this read scope. Verify issued source permissions before continuing.",
  RESOURCE_NOT_CONFIGURED:
    "This read scope is not configured. Ask the administrator to verify source access.",
  IMPORT_BUSY:
    "Another scan or provider cooldown is active. Recheck this run before retrying.",
  PATIENT_MAPPING_REQUIRED: "An approved patient mapping is required.",
  VACCINATION_RUN_REQUIRES_NEW_CONTEXT:
    "This legacy scan cannot continue. Start a separate mapped scan after the existing cooldown.",
};
export async function stagePrescriptionItemPage(
  id: string,
  mapping: PrescriptionItemMapping,
  context: PrescriptionItemContext,
) {
  const { data, error } = await supabase.functions.invoke("ezyvet-import", {
    body: {
      run_id: uuid.parse(id),
      resource: "prescriptionitem",
      animal_link_id: uuid.parse(mapping.link_id),
      ...contextOf(context),
    },
  });
  if (error) {
    let code = "";
    if ("context" in error && error.context instanceof Response) {
      try {
        const value = await error.context.json();
        code = typeof value.error === "string" ? value.error : "";
      } catch {
        /* Never display raw response. */
      }
    }
    throw new Error(
      errors[code] ??
        "Page response unconfirmed. Recover this original run before continuing.",
    );
  }
  if (!data || data.run_id !== id || data.review_only !== true)
    throw new Error(
      "Page response unconfirmed. Recover this original run before continuing.",
    );
}
