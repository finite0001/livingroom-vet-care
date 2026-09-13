import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { historyRpc } from "./history-api";
import { candidateSchema } from "./vaccination-api";
import {
  importedVaccinationSchema,
  parseVaccinationReview,
  reviewCursorSchema,
  vaccinationReviewPayloadSchema,
} from "./vaccination-review-state";
import type {
  ReviewCursor,
  VaccinationReviewPayload,
} from "./vaccination-review-state";
const pageArgs = (pet: string, cursor: ReviewCursor | null) => ({
  p_pet_id: pet,
  p_before_at: cursor?.before_at ?? null,
  p_before_id: cursor?.before_id ?? null,
  p_limit: 20,
});
const pagination = z.object({
  has_more: z.boolean(),
  next_cursor: reviewCursorSchema.nullable(),
});
function checkPage(p: z.infer<typeof pagination>) {
  if (p.has_more !== !!p.next_cursor)
    throw new Error("Vaccination history pagination differs");
}
export async function listVaccinationReviewMappings(pet: string) {
  const rows = z
    .array(
      z.object({
        link_id: z.string().uuid(),
        pet_id: z.string().uuid(),
        source_origin: z.string().url(),
        source_site_uid: z.string(),
        external_id: z.string(),
        patient_version: z.number().int().positive(),
      }),
    )
    .max(50)
    .parse(
      await historyRpc("list_ezyvet_vaccination_review_mappings", {
        p_pet_id: pet,
      }),
    );
  if (rows.some((r) => r.pet_id !== pet))
    throw new Error("Source patient mapping differs");
  return rows;
}
export async function listVaccinationReviewCandidates(
  pet: string,
  mapping: string,
  cursor: ReviewCursor | null,
) {
  const p = pagination
    .extend({
      animal_link_id: z.string().uuid(),
      resource: z.literal("vaccination"),
      candidates: z.array(candidateSchema).max(20),
    })
    .parse(
      await historyRpc("list_ezyvet_vaccination_review_candidates", {
        ...pageArgs(pet, cursor),
        p_animal_link_id: mapping,
      }),
    );
  checkPage(p);
  if (
    p.animal_link_id !== mapping ||
    p.candidates.some(
      (c) =>
        c.pet_id !== pet ||
        c.animal_link_id !== mapping ||
        c.is_current !==
          (c.id === c.current_snapshot_id &&
            c.observed_head_version === c.head_version) ||
        c.consult_is_current !==
          (c.consult_snapshot_id === c.consult_current_snapshot_id &&
            c.consult_observed_head_version === c.consult_head_version) ||
        c.eligible_for_review !== (c.is_current && c.consult_is_current),
    )
  )
    throw new Error("Vaccination source scope differs");
  return p;
}
export async function listPatientImportedVaccinations(
  pet: string,
  cursor: ReviewCursor | null,
) {
  const p = pagination
    .extend({ vaccinations: z.array(importedVaccinationSchema).max(20) })
    .parse(
      await historyRpc(
        "list_patient_imported_vaccinations",
        pageArgs(pet, cursor),
      ),
    );
  checkPage(p);
  if (p.vaccinations.some((v) => v.pet_id !== pet))
    throw new Error("Outside vaccination patient differs");
  return p;
}
export async function listVaccinationReviewRequests(
  actor: string,
  pet: string,
  cursor: ReviewCursor | null,
) {
  const p = pagination
    .extend({ requests: z.array(z.unknown()).max(20) })
    .parse(
      await historyRpc(
        "list_ezyvet_vaccination_review_requests",
        pageArgs(pet, cursor),
      ),
    );
  checkPage(p);
  return {
    ...p,
    requests: p.requests.map((r) => {
      const value = parseVaccinationReview(r, actor, pet);
      if (!value) throw new Error("Review request unavailable");
      return value;
    }),
  };
}
export async function recoverVaccinationReview(
  id: string,
  actor: string,
  pet: string,
  payload?: VaccinationReviewPayload | null,
) {
  return parseVaccinationReview(
    await historyRpc("recover_ezyvet_vaccination_review", {
      p_id: id,
      p_pet_id: pet,
    }),
    actor,
    pet,
    id,
    payload,
  );
}
export async function prepareVaccinationReview(
  id: string,
  actor: string,
  pet: string,
  payload: VaccinationReviewPayload,
) {
  const proposed = vaccinationReviewPayloadSchema.parse(payload);
  await historyRpc("prepare_ezyvet_vaccination_review", {
    p_id: id,
    p_pet_id: pet,
    p_payload: proposed,
  });
  return recoverVaccinationReview(id, actor, pet, proposed);
}
export async function approveVaccinationReview(
  id: string,
  actor: string,
  pet: string,
  hash: string,
  payload: VaccinationReviewPayload,
) {
  await historyRpc("approve_ezyvet_vaccination_review", {
    p_id: id,
    p_pet_id: pet,
    p_expected_hash: hash,
    p_confirmed: true,
  });
  const value = await recoverVaccinationReview(id, actor, pet, payload);
  if (value && value.request.request_hash !== hash)
    throw new Error(
      "Reviewed request hash differs. Keep the original reference.",
    );
  return value;
}
export async function abandonVaccinationReview(
  id: string,
  actor: string,
  pet: string,
  payload?: VaccinationReviewPayload | null,
) {
  await historyRpc("abandon_ezyvet_vaccination_review", {
    p_id: id,
    p_pet_id: pet,
    p_confirmed: true,
  });
  return recoverVaccinationReview(id, actor, pet, payload);
}
export async function listReviewVaccineProducts(search: string) {
  const { data, error } = await supabase
    .from("catalog_products")
    .select("id,name,version,kind")
    .eq("kind", "vaccine")
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
        kind: z.literal("vaccine"),
      }),
    )
    .parse(data);
}
