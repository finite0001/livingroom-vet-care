import { supabase } from "@/integrations/supabase/client";
import { importedPrescriptionSchema } from "./prescription-review-state";
import { z } from "zod";
import {
  parsePrescriptionReview,
  prescriptionReviewPayloadSchema,
} from "./prescription-review-operation-state";
import type { PrescriptionReviewPayload } from "./prescription-review-operation-state";
import { prescriptionCursorSchema } from "./prescription-review-state";
import { historyRpc } from "./history-api";
import { parsePatientPrescriptionPage } from "./prescription-review-state";
import type { PrescriptionCursor } from "./prescription-review-state";
export async function listPatientImportedPrescriptions(
  petId: string,
  cursor: PrescriptionCursor | null,
) {
  return parsePatientPrescriptionPage(
    await historyRpc("list_patient_imported_prescriptions", {
      p_pet_id: petId,
      p_before_at: cursor?.before_at ?? null,
      p_before_id: cursor?.before_id ?? null,
      p_limit: 20,
    }),
    petId,
  );
}

export async function recoverPrescriptionReview(
  id: string,
  actor: string,
  pet: string,
  payload?: PrescriptionReviewPayload | null,
) {
  return parsePrescriptionReview(
    await historyRpc("recover_ezyvet_prescription_review", {
      p_id: id,
      p_pet_id: pet,
    }),
    actor,
    pet,
    id,
    payload,
  );
}
export async function preparePrescriptionReview(
  id: string,
  actor: string,
  pet: string,
  payload: PrescriptionReviewPayload,
) {
  const proposed = prescriptionReviewPayloadSchema.parse(payload);
  await historyRpc("prepare_ezyvet_prescription_review", {
    p_id: id,
    p_pet_id: pet,
    p_payload: proposed,
  });
  return recoverPrescriptionReview(id, actor, pet, proposed);
}
export async function approvePrescriptionReview(
  id: string,
  actor: string,
  pet: string,
  hash: string,
  payload: PrescriptionReviewPayload,
) {
  await historyRpc("approve_ezyvet_prescription_review", {
    p_id: id,
    p_pet_id: pet,
    p_expected_hash: hash,
    p_confirmed: true,
  });
  const value = await recoverPrescriptionReview(id, actor, pet, payload);
  if (value && value.request.request_hash !== hash)
    throw new Error(
      "Reviewed prescription hash differs. Keep the original reference.",
    );
  return value;
}
export async function abandonPrescriptionReview(
  id: string,
  actor: string,
  pet: string,
  payload?: PrescriptionReviewPayload | null,
) {
  await historyRpc("abandon_ezyvet_prescription_review", {
    p_id: id,
    p_pet_id: pet,
    p_confirmed: true,
  });
  return recoverPrescriptionReview(id, actor, pet, payload);
}
export async function listPrescriptionReviewRequests(
  actor: string,
  pet: string,
  cursor: PrescriptionCursor | null,
) {
  const page = z
    .object({
      requests: z.array(z.unknown()).max(20),
      has_more: z.boolean(),
      next_cursor: prescriptionCursorSchema.nullable(),
    })
    .parse(
      await historyRpc("list_ezyvet_prescription_review_requests", {
        p_pet_id: pet,
        p_before_at: cursor?.before_at ?? null,
        p_before_id: cursor?.before_id ?? null,
        p_limit: 20,
      }),
    );
  if (page.has_more !== !!page.next_cursor)
    throw new Error("Prescription review pagination differs");
  return {
    ...page,
    requests: page.requests.map((request) => {
      const value = parsePrescriptionReview(request, actor, pet);
      if (!value) throw new Error("Prescription review unavailable");
      return value;
    }),
  };
}

const sourceContextSchema = importedPrescriptionSchema
  .innerType()
  .shape.context.omit({
    patient_version: true,
    reviewed: true,
    selected_items: true,
    omitted_items: true,
  })
  .extend({
    consult: z.object({
      status: z.enum(["resolved", "not_supplied", "unresolved", "not_checked"]),
      reference: z.unknown().optional(),
      snapshot_id: z.string().uuid().optional(),
      payload_hash: z.string().optional(),
      observed_head_version: z.number().int().positive().optional(),
    }),
  });
const previewSchema = z.object({
  run: z.object({
    id: z.string().uuid(),
    pet_id: z.string().uuid(),
    animal_link_id: z.string().uuid(),
    prescription_external_id: z.string(),
    source_origin: z.string().url(),
    source_site_uid: z.string(),
  }),
  patient_version: z.number().int().positive(),
  source_context: sourceContextSchema,
  eligible_for_review: z.boolean(),
  unavailable_reason: z
    .enum(["SOURCE_CONTEXT_CHANGED", "SOURCE_CONSULT_UNRESOLVED"])
    .nullable(),
});
export type PrescriptionReviewCandidate = z.infer<typeof previewSchema>;
export async function getPrescriptionReviewCandidate(
  pet: string,
  runId: string,
) {
  const v = previewSchema.parse(
    await historyRpc("get_ezyvet_prescription_review_candidate", {
      p_pet_id: pet,
      p_item_run_id: runId,
    }),
  );
  const c = v.source_context;
  if (
    v.run.id !== runId ||
    v.run.pet_id !== pet ||
    c.patient_id !== pet ||
    c.item_run.id !== runId ||
    c.animal_link_id !== v.run.animal_link_id ||
    c.parent.external_id !== v.run.prescription_external_id ||
    c.source.origin !== v.run.source_origin ||
    c.source.site_uid !== v.run.source_site_uid ||
    v.eligible_for_review !== (v.unavailable_reason === null) ||
    (v.eligible_for_review &&
      !["resolved", "not_supplied"].includes(c.consult.status)) ||
    c.items.some(
      (item) => String(item.original.prescription_id) !== c.parent.external_id,
    )
  )
    throw new Error("Prescription preview identity differs");
  return v;
}
export async function listPrescriptionReviewCandidates(
  pet: string,
  cursor: PrescriptionCursor | null,
) {
  const page = z
    .object({
      candidates: z
        .array(
          z.object({
            id: z.string().uuid(),
            created_at: z.string(),
            status: z.string(),
            animal_link_id: z.string().uuid(),
            prescription_external_id: z.string(),
            source: z.object({
              origin: z.string().url(),
              site_uid: z.string(),
            }),
            item_count: z.number().int().nonnegative(),
          }),
        )
        .max(20),
      has_more: z.boolean(),
      next_cursor: prescriptionCursorSchema.nullable(),
    })
    .parse(
      await historyRpc("list_ezyvet_prescription_review_candidates", {
        p_pet_id: pet,
        p_before_at: cursor?.before_at ?? null,
        p_before_id: cursor?.before_id ?? null,
        p_limit: 20,
      }),
    );
  if (
    page.has_more !== !!page.next_cursor ||
    new Set(page.candidates.map((v) => v.id)).size !== page.candidates.length
  )
    throw new Error("Prescription source pagination differs");
  return page;
}
export async function listReviewMedicationProducts(search: string) {
  const { data, error } = await supabase
    .from("catalog_products")
    .select("id,name,version,kind,unit")
    .eq("kind", "medication")
    .eq("active", true)
    .ilike("name", `%${search.replace(/[%_]/g, "")}%`)
    .order("name")
    .limit(50);
  if (error) throw error;
  return z
    .array(
      z.object({
        id: z.string().uuid(),
        name: z.string(),
        version: z.number().int().positive(),
        kind: z.literal("medication"),
        unit: z.string(),
      }),
    )
    .max(50)
    .parse(data);
}
