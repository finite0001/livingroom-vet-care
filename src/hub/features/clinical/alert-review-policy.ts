export interface PatientAlertReview {
  source_hash: string;
  snapshot: {
    schema_version: 1;
    pet_id: string;
    patient_version: number;
    important_problems: Array<{
      id: string;
      version: number;
      title: string;
      notes: string;
      status: string;
      importance: "high";
      onset_date: string | null;
      updated_at: string;
    }>;
    legacy_allergies: { text: string | null; provenance: string };
  };
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function text(value: unknown): value is string {
  return typeof value === "string";
}
function version(value: unknown): boolean {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}
export function decodePatientAlertReview(
  value: unknown,
  petId: string,
): PatientAlertReview {
  const error = new Error(
    "Patient alert review is incomplete. Reload the current alerts before continuing.",
  );
  if (
    !object(value) ||
    !text(value.source_hash) ||
    !/^[a-f0-9]{64}$/.test(value.source_hash) ||
    !object(value.snapshot)
  )
    throw error;
  const s = value.snapshot;
  if (
    s.schema_version !== 1 ||
    s.pet_id !== petId ||
    !version(s.patient_version) ||
    !Array.isArray(s.important_problems) ||
    !object(s.legacy_allergies)
  )
    throw error;
  if (
    !(s.legacy_allergies.text === null || text(s.legacy_allergies.text)) ||
    !text(s.legacy_allergies.provenance) ||
    !s.legacy_allergies.provenance.trim()
  )
    throw error;
  for (const p of s.important_problems)
    if (
      !object(p) ||
      !text(p.id) ||
      !p.id ||
      !version(p.version) ||
      !text(p.title) ||
      !text(p.notes) ||
      !["active", "resolved"].includes(String(p.status)) ||
      p.importance !== "high" ||
      !(p.onset_date === null || text(p.onset_date)) ||
      !text(p.updated_at)
    )
      throw error;
  return value as unknown as PatientAlertReview;
}
export function alertAcknowledgmentMatches(
  review: PatientAlertReview | undefined,
  acknowledgedHash: string | null,
): boolean {
  return Boolean(review && acknowledgedHash === review.source_hash);
}
