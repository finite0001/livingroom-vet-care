import type {
  DiagnosticValues,
  FinalizedPanel,
} from "../../src/hub/features/diagnostics/model.ts";
export const uuid = (n: number) =>
  `b3100000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export function values(): DiagnosticValues {
  return {
    panel_name: "Synthetic chemistry",
    category: "laboratory",
    collected_on: "2026-10-01",
    reported_on: "2026-10-02",
    specimen: "Serum",
    method: "Synthetic device A",
    source: "Manual in-house",
    interpretation: "Documentary interpretation",
    observations: [
      {
        id: uuid(1),
        analyte_key: "synthetic-alt",
        label: "ALT",
        kind: "numeric",
        value_number: 0,
        value_text: null,
        unit: "U/L",
        reference_low: 1,
        reference_high: 100,
        reference_text: "Entered from synthetic source",
        source_flag: "Recorded flag",
      },
      {
        id: uuid(2),
        analyte_key: "synthetic-screen",
        label: "Screen",
        kind: "qualitative",
        value_number: null,
        value_text: "Not detected",
        unit: null,
        reference_low: null,
        reference_high: null,
        reference_text: "As reported",
        source_flag: "",
      },
    ],
    lab_order_id: null,
    lab_order_version: null,
    encounter_id: null,
    encounter_version: null,
    document_id: null,
    document_version: null,
  };
}
export function finalized(n = 10): FinalizedPanel {
  return {
    id: uuid(n),
    panel_id: uuid(n + 100),
    pet_id: uuid(900),
    number: 1,
    predecessor_id: null,
    snapshot: values(),
    source_context: {},
    source_hash: "a".repeat(64),
    correction_reason: "",
    review_note: "Synthetic review",
    entered_by: uuid(800),
    reviewed_by: uuid(801),
    reviewed_at: "2026-10-03T18:00:00Z",
    reviewer_name: "Synthetic veterinarian",
    entered_by_name: "Synthetic technician",
  };
}
