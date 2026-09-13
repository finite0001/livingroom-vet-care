export const sourceLabels = {
  problem_ids: "Problem and diagnosis history",
  patient_summary_ids: "Allergy and legacy profile summary",
  weight_ids: "Dated weights",
  treatment_ids: "Medication and vaccine history",
  encounter_ids: "Signed SOAP and all addenda",
  certificate_ids: "Valid issued certificates",
  lab_order_ids: "Resulted laboratory records",
  lab_report_ids: "Verified laboratory report versions",
  external_record_ids: "Approved imported record originals",
  document_ids: "Shareable original documents",
  dental_ids: "Signed dental charts",
  qol_ids: "Signed QOL observations",
  anesthesia_ids: "Signed anesthesia records",
  lesion_ids: "Complete body-map histories",
} as const;
export type SourceKind = keyof typeof sourceLabels;
/** Never silently truncate a clinician's explicit selection. */
export function mergeReleaseSelection(
  existing: readonly string[],
  incoming: readonly string[],
): string[] {
  const result = [...new Set([...existing, ...incoming])];
  if (result.length > 100)
    throw new Error(
      "Selecting these records would exceed 100 in this family. Use a separate package; no selections were changed.",
    );
  return result;
}
