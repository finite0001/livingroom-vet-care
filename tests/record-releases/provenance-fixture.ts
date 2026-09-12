import { historyArtifact } from "./history-fixture.ts";
export function provenanceArtifact() {
  const a = structuredClone(historyArtifact);
  a.preview.snapshot.schema_version = 4;
  a.preview.snapshot.weights![0].weight = 11.34;
  a.preview.snapshot.weights![0].measured_at = "2026-09-01";
  a.preview.snapshot.weights![0].import_provenance = [
    {
      approval_id: "approval",
      source: "ezyVet",
      source_record_id: "123",
      action: "create",
      original: { weight: "25", unit: "lb", timestamp: "1788267600" },
      reviewed_values: { weight: 11.34, unit: "kg", measured_at: "2026-09-01" },
      review_reason: "Historical review <script>attack</script>",
      reviewer_id: "reviewer",
      reviewed_at: "2026-09-12T18:00:00Z",
      source_clinician: null,
      latest_source_version: 3,
      approved_source_version: 1,
      latest_source_reviewed: false,
      source_reviews: [
        {
          id: "review",
          source_version: 2,
          reviewer_id: "second reviewer",
          reviewed_at: "2026-09-12T19:00:00Z",
          reason: "Retain local measurement",
          source: {
            weight: "26",
            unit: "lb",
            timestamp: "1788267600",
            active: "true",
          },
        },
      ],
    },
  ];
  return a;
}
