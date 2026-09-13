export const clinicalId = (n: number) =>
  `c6000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const clinicalActor = clinicalId(1),
  clinicalPet = clinicalId(2),
  clinicalClient = clinicalId(3),
  clinicalMapping = clinicalId(4);
export const clinicalAt = "2026-09-13T12:00:00.123456+00:00";
export function approvedClinicalHistory() {
  return {
    id: clinicalId(5),
    version: 1,
    version_hash: "a".repeat(64),
    pet_id: clinicalPet,
    animal_link_id: clinicalMapping,
    source: {
      origin: "https://api.trial.ezyvet.com",
      site_uid: "synthetic-site",
      animal_id: "22",
      history_id: "71",
    },
    snapshot_id: clinicalId(6),
    payload_hash: "b".repeat(64),
    observed_head_version: 1,
    original: {
      comments: "Outside reaction narrative <img src=x onerror=alert(1)>",
      history_system: "Unmapped source section",
      chain: "Uninterpreted chain",
      timestamp: "unknown-date",
      vet_id: "outside-vet-8",
      active: "1",
      consult_id: "81",
    },
    approved_by: clinicalActor,
    approved_at: clinicalAt,
    consult: { status: "unresolved" },
    current: {
      snapshot_id: clinicalId(6),
      head_version: 1,
      scoped: true,
      is_current: true,
      source_active: "1",
    },
  };
}
export function existingClinicalProblem() {
  return {
    id: clinicalId(7),
    pet_id: clinicalPet,
    version: 1,
    title: "Existing locally authored reaction",
    notes: "Local notes must stay unchanged",
    onset_date: null,
    status: "active",
    importance: "high",
    created_by: clinicalActor,
    updated_by: clinicalActor,
    created_at: clinicalAt,
    updated_at: clinicalAt,
  };
}
