import { chartArtifact } from "./charts-fixture.ts";
import type { ReleaseArtifact } from "../../src/hub/features/record-releases/print.ts";
const fields = {
  version: 2,
  title: "Vaccine reaction",
  notes: "Clinical diagnosis notes <script>alert(1)</script>",
  onset_date: "2026-01-01",
  status: "resolved",
  importance: "high",
  updated_by: "clinician",
  updated_at: "2026-09-12T18:00:00Z",
};
export const historyArtifact: ReleaseArtifact = structuredClone(chartArtifact);
Object.assign(historyArtifact.preview.snapshot, {
  schema_version: 3,
  problems: [
    {
      id: "problem",
      created_by: "clinician",
      created_at: "2026-01-01T18:00:00Z",
      current: fields,
      history: [
        {
          recorded_at: "2026-09-12T18:00:00Z",
          recorded_by: "clinician",
          action: "UPDATE",
          before: {
            ...fields,
            version: 1,
            status: "active",
            notes: "Original reaction history",
          },
          after: fields,
        },
      ],
    },
  ],
  patient_summaries: [
    {
      id: "22222222-2222-4222-8222-222222222222",
      version: 2,
      allergies: "Penicillin reaction",
      legacy_weight_lbs: 25,
      provenance:
        "Existing patient profile; verification and legacy measurement date unknown",
    },
  ],
  weights: [
    {
      id: "weight",
      weight: 12.3,
      unit: "kg",
      measured_at: "2026-09-01",
      recorded_by: "clinician",
      created_at: "2026-09-01T18:00:00Z",
    },
  ],
  treatments: [
    {
      id: "treatment",
      kind: "medication",
      historical: true,
      product_name: "Prior medication",
      manufacturer: "External maker",
      lot_number: "Unknown",
      expires_on: null,
      quantity: 1,
      dose: "As transcribed",
      route: "Oral",
      site: "",
      veterinarian: "External veterinarian",
      veterinarian_license: "Unknown",
      administered_at: "2026-01-01T18:00:00Z",
      next_due_on: null,
      source: "External record provenance",
      created_by: "clinician",
      created_at: "2026-09-01T18:00:00Z",
      corrections: [
        {
          id: "correction",
          reason: "Dose uncertain, original retained",
          replacement_id: null,
          created_by: "clinician",
          created_at: "2026-09-02T18:00:00Z",
        },
      ],
    },
  ],
});
