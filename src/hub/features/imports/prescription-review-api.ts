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
