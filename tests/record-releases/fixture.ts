import type { ReleaseArtifact } from "../../src/hub/features/record-releases/print.ts";
export const releaseArtifact: ReleaseArtifact = {
  preview: {
    source_hash: "a".repeat(64),
    snapshot: {
      schema_version: 1,
      patient: {
        id: "pet",
        version: 1,
        name: "Juniper <script>alert(1)</script>",
        species: "Dog",
        breed: "Mixed",
        dob: null,
        birth_date_precision: "unknown",
        microchip_id: null,
      },
      recipient: {
        client_id: "household",
        client_version: 1,
        name: "Owner & Family",
        channel: "EMAIL",
        address: "owner@example.test",
      },
      encounters: [
        {
          id: "encounter",
          version: 2,
          visit_at: "2026-09-12T18:00:00Z",
          visit_type: "clinic",
          subjective: "Owner reports improvement.",
          objective: "Recorded findings.",
          assessment: "Reviewed assessment.",
          plan: "Reviewed plan.",
          signed_by: "staff",
          signed_at: "2026-09-12T19:00:00Z",
          addenda: [
            {
              id: "addendum",
              content: "Correction: <img src=x onerror=alert(1)>",
              created_by: "staff",
              created_at: "2026-09-12T20:00:00Z",
            },
          ],
        },
      ],
      certificates: [],
      lab_results: [
        {
          id: "lab",
          version: 2,
          test_name: "CBC",
          accession: "LAB-1",
          collected_date: "2026-09-12",
          result_date: "2026-09-12",
          result_document_id: "document",
        },
      ],
      attachments: [
        {
          id: "document",
          version: 2,
          file_name: "original-report.pdf",
          file_path: "PRIVATE-STORAGE-PATH/original",
          bucket: "patient-documents",
          mime_type: "application/pdf",
          file_size: 100,
          document_date: "2026-09-12",
          category: "lab_result",
        },
      ],
    },
  },
};
