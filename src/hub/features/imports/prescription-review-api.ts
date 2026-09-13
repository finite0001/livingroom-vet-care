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
