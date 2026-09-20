export const sourceLabels = {
  problem_ids: "Problem and diagnosis history",
  patient_summary_ids: "Allergy and legacy profile summary",
  weight_ids: "Dated weights",
  treatment_ids: "Medication and vaccine history",
  encounter_ids: "Signed SOAP and all addenda",
  certificate_ids: "Valid issued certificates",
  lab_order_ids: "Resulted laboratory records",
  lab_report_ids: "Verified laboratory report versions",
  native_prescription_ids: "Signed practice prescriptions",
  native_dispense_ids: "Recorded practice dispensing",
  imported_prescription_ids: "Clinician-reviewed outside prescriptions",
  imported_vaccination_ids: "Clinician-reviewed outside vaccinations",
  imported_history_ids: "Approved outside clinical narratives",
  external_record_ids: "Approved imported record originals",
  api_attachment_ids: "Reviewed outside record originals",
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
  limit = 100,
): string[] {
  const result = [...new Set([...existing, ...incoming])];
  if (result.length > limit)
    throw new Error(
      `Selecting these records would exceed ${limit} in this family. Use a separate package; no selections were changed.`,
    );
  return result;
}

export function releaseFamilyLimit(kind: SourceKind): number {
  return ["api_attachment_ids", "imported_vaccination_ids", "imported_prescription_ids", "native_prescription_ids", "native_dispense_ids"].includes(kind) ? 20 : 100;
}
