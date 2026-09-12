import { releaseArtifact } from "./fixture.ts";
export const chartArtifact = structuredClone(releaseArtifact);
chartArtifact.preview.snapshot.schema_version = 2;
const signed = {
  version: 2,
  signed_by: "staff",
  signed_at: "2026-09-12T20:00:00Z",
  addenda: [
    {
      id: "addendum",
      content: "Complete chart addendum <script>bad()</script>",
      created_at: "2026-09-12T21:00:00Z",
      created_by: "staff",
    },
  ],
};
chartArtifact.preview.snapshot.dental_charts = [
  {
    ...signed,
    id: "dental",
    visit_at: "2026-09-12T18:00:00Z",
    species_family: "dog",
    dentition: "adult",
    notes: "Dental notes",
    teeth: {
      "101": {
        presence: "present",
        findings: "Recorded finding",
        planned: "Recorded plan",
        performed: "Recorded procedure",
        measurements: [{ label: "Manual measurement", value_mm: 2 }],
      },
    },
  },
];
chartArtifact.preview.snapshot.qol_records = [
  {
    ...signed,
    id: "qol",
    template_version: "draft-2026-09-12",
    observed_at: "2026-09-12T18:00:00Z",
    observer: "Caregiver",
    appetite: "Eating normally",
    drinking: "Drinking",
    mobility: "Walking",
    comfort: "Comfort observed",
    social_engagement: "Interacting",
    good_days: "Caregiver report",
    notes: "Qualitative notes",
  },
];
chartArtifact.preview.snapshot.anesthesia_records = [
  {
    ...signed,
    id: "anesthesia",
    procedure_name: "Synthetic procedure",
    started_at: "2026-09-12T18:00:00Z",
    ended_at: "2026-09-12T19:00:00Z",
    team: "Recorded team",
    assessment: "Recorded assessment",
    plan: "Recorded plan",
    recovery_notes: "Recovery notes",
    source: "manual",
    included_original_document_id: null,
    observations: [
      {
        at: "2026-09-12T18:05:00Z",
        label: "Manual observation",
        value: 80,
        unit: "bpm",
        notes: "Documented observation",
      },
    ],
    events: [
      {
        at: "2026-09-12T18:10:00Z",
        kind: "procedure",
        description: "Documentary event",
      },
    ],
  },
];
chartArtifact.preview.snapshot.lesions = [
  {
    id: "lesion",
    version: 2,
    label: "Mass A",
    observations: [
      {
        id: "observation",
        observed_at: "2026-09-12T18:00:00Z",
        label: "Mass A",
        body_view: "left",
        x: 0.2,
        y: 0.4,
        length_mm: 12,
        width_mm: 10,
        depth_mm: null,
        notes: "Dated measurement",
        created_by: "staff",
        created_at: "2026-09-12T18:00:00Z",
        photo_document_id: null,
        corrections: [
          {
            id: "correction",
            reason: "Original measurement corrected",
            created_at: "2026-09-12T19:00:00Z",
            created_by: "staff",
          },
        ],
      },
    ],
  },
];
