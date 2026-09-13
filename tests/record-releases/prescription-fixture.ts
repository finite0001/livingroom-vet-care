import { readFileSync } from "node:fs";
import { vaccinationArtifact } from "./vaccination-fixture.ts";
import type { ReleaseImportedPrescription } from "../../supabase/functions/_shared/record-release-imported-prescriptions.ts";
export function prescriptionArtifact() {
  const a = vaccinationArtifact(), s = a.preview.snapshot;
  const v: ReleaseImportedPrescription = JSON.parse(
    readFileSync(
      new URL("../prescription-review/receipt.fixture.json", import.meta.url),
      "utf8",
    ),
  );
  v.pet_id = v.context.patient_id = s.patient.id;
  v.client_id = v.context.client_id = s.recipient.client_id;
  s.schema_version = 8;
  s.imported_prescriptions = [v];
  s.selection!.imported_prescription_ids = [v.id];
  return a;
}
