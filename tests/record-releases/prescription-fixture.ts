import { vaccinationArtifact } from "./vaccination-fixture.ts";
import type { ReleaseImportedPrescription } from "../../supabase/functions/_shared/record-release-renderer.ts";
export function prescriptionArtifact() {
  const a = vaccinationArtifact(),
    s = a.preview.snapshot;
  s.schema_version = 8;
  const p: ReleaseImportedPrescription = {
    id: "3a8c69a3-aebe-47af-93a8-d8f3cfa7396b",
    items: [
      {
        source: {
          page: 1,
          original: {
            id: 501,
            qty: "outside units",
            remaining: "unknown",
            date_start: null,
            product_id: null,
            instructions: "<script>outside prose</script>",
            serial_number: "outside author",
            prescription_id: 101,
          },
          external_id: "501",
          snapshot_id: "c1df4433-4f17-4e52-83d2-bf9322a76cf6",
          payload_hash:
            "4abe419531fceecced1609aa0bcdc1897392f260e7fe6400b5f2f36b0ce3fd5e",
          observed_head_version: 1,
        },
        product: {
          id: "583559bc-27f4-4d2d-b736-997553c65dce",
          kind: "medication",
          name: "Synthetic medication",
          unit: "tablet",
          version: 1,
        },
        reviewed: {
          note: "No dose or refill inferred",
          start_on: null,
          start_date_status: "unknown",
        },
      },
    ],
    pet_id: "2f3ed1db-40a0-45e2-b035-5ea62bd367c9",
    reason: "Historical interpretation only",
    context: {
      items: [
        {
          page: 1,
          original: {
            id: 501,
            qty: "outside units",
            remaining: "unknown",
            date_start: null,
            product_id: null,
            instructions: "<script>outside prose</script>",
            serial_number: "outside author",
            prescription_id: 101,
          },
          external_id: "501",
          snapshot_id: "c1df4433-4f17-4e52-83d2-bf9322a76cf6",
          payload_hash:
            "4abe419531fceecced1609aa0bcdc1897392f260e7fe6400b5f2f36b0ce3fd5e",
          observed_head_version: 1,
        },
      ],
      parent: {
        original: {
          id: 101,
          animal_id: 77,
          instructions: "Source prescriptionation",
        },
        external_id: "101",
        snapshot_id: "ad1a0867-522c-483a-9335-f7758a3f2c78",
        payload_hash:
          "d8cbeab506f741a83f0a463345b4eb8310f5460d3e4357184c23f2673300585c",
        observed_head_version: 1,
      },
      source: {
        origin: "https://api.trial.ezyvet.com",
        site_uid: "prescriptionitem-test-site",
        animal_id: "77",
      },
      consult: {
        status: "not_supplied",
        reference: null,
      },
      item_run: {
        id: "ede9bb3a-333a-432f-8568-d86a7478e1d8",
        status: "review_ready",
        next_page: 2,
      },
      reviewed: {
        reason: "Historical interpretation only",
        status: "unknown",
        completeness: "partial",
        prescribed_on: null,
        outside_author: null,
        partial_reason: "Parent source list not supplied",
        prescription_date_status: "uninterpreted",
      },
      client_id: "163091aa-1e68-4853-9709-a94cd3d47d12",
      patient_id: "2f3ed1db-40a0-45e2-b035-5ea62bd367c9",
      omitted_items: [],
      animal_link_id: "36394889-b3f3-46c2-a132-77eab3d9c493",
      reconciliation: {
        status: "unresolved",
        missingIds: [],
        expectedIds: [],
        observedIds: ["501"],
        scanComplete: true,
        unexpectedIds: ["501"],
        sourceListPresent: false,
        duplicateSourceIds: [],
        duplicateObservedIds: [],
        invalidSourceReferences: [
          {
            index: -1,
            value: null,
          },
        ],
        invalidObservedReferences: [],
      },
      selected_items: [
        {
          source: {
            page: 1,
            original: {
              id: 501,
              qty: "outside units",
              remaining: "unknown",
              date_start: null,
              product_id: null,
              instructions: "<script>outside prose</script>",
              serial_number: "outside author",
              prescription_id: 101,
            },
            external_id: "501",
            snapshot_id: "c1df4433-4f17-4e52-83d2-bf9322a76cf6",
            payload_hash:
              "4abe419531fceecced1609aa0bcdc1897392f260e7fe6400b5f2f36b0ce3fd5e",
            observed_head_version: 1,
          },
          product: {
            id: "583559bc-27f4-4d2d-b736-997553c65dce",
            kind: "medication",
            name: "Synthetic medication",
            unit: "tablet",
            version: 1,
          },
          reviewed: {
            note: "No dose or refill inferred",
            start_on: null,
            start_date_status: "unknown",
          },
        },
      ],
      patient_version: 1,
    },
    current: {
      is_latest: true,
      is_current: true,
      identity_valid: true,
    },
    version: 1,
    client_id: "163091aa-1e68-4853-9709-a94cd3d47d12",
    approved_at: "2026-09-13T21:39:01.157465+00:00",
    approved_by: "db560000-0000-4000-8000-000000000001",
    replaces_id: null,
    version_hash:
      "f11e24ebe5e6f4d68a775ef3aeabc4212d70c5eed13e5fa6eb994c4f08193e05",
    source_origin: "https://api.trial.ezyvet.com",
    animal_link_id: "36394889-b3f3-46c2-a132-77eab3d9c493",
    source_site_uid: "prescriptionitem-test-site",
    correction_history: [
      {
        id: "3a8c69a3-aebe-47af-93a8-d8f3cfa7396b",
        reason: "Historical interpretation only",
        version: 1,
        approved_at: "2026-09-13T21:39:01.157465+00:00",
        approved_by: "db560000-0000-4000-8000-000000000001",
        replaces_id: null,
        version_hash:
          "f11e24ebe5e6f4d68a775ef3aeabc4212d70c5eed13e5fa6eb994c4f08193e05",
      },
    ],
    prescription_external_id: "101",
    expected_predecessor_hash: null,
  };
  p.pet_id = p.context.patient_id = s.patient.id;
  p.client_id = p.context.client_id = s.recipient.client_id;
  s.imported_prescriptions = [p];
  s.selection!.imported_prescription_ids = [p.id];
  return a;
}
