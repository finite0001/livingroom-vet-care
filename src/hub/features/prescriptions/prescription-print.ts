import {
  renderNativePrescription,
  type NativePrescriptionArtifact,
  type NativeDispenseArtifact,
  type NativePrescriptionPrintStatus,
} from '../../../../supabase/functions/_shared/native-prescription-renderer.ts';

export interface PrescriptionPrintTarget {
  patientId: string;
  authorizationId: string;
  /** null requests an order copy; a UUID requests that exact dispensing event. */
  dispenseId: string | null;
}
export interface PrescriptionPrintBundle {
  prescription: NativePrescriptionArtifact;
  status: NativePrescriptionPrintStatus;
  dispense: NativeDispenseArtifact | null;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid prescription print response. Refresh the patient record.');
  return value as Record<string, unknown>;
}
/** Call with a freshly authorized server response, never a cached editor draft.
 * This checks response/target identity; the server remains responsible for access,
 * snapshot hash verification and current authorization/dispense status. */
export function renderReviewedPrescriptionCopy(value: unknown, target: PrescriptionPrintTarget): string {
  if (!uuid.test(target.patientId) || !uuid.test(target.authorizationId) || (target.dispenseId !== null && !uuid.test(target.dispenseId))) {
    throw new Error('An exact patient, authorization and optional dispense reference are required.');
  }
  const bundle = record(value);
  const keys = Object.keys(bundle);
  if (keys.length !== 3 || !['prescription', 'status', 'dispense'].every(key => Object.prototype.hasOwnProperty.call(bundle, key))) {
    throw new Error('Invalid prescription print response. Refresh the patient record.');
  }
  const prescription = record(bundle.prescription);
  const patient = record(prescription.patient);
  if (patient.id !== target.patientId || prescription.authorization_id !== target.authorizationId) {
    throw new Error('Prescription print response belongs to another patient or authorization.');
  }
  if (target.dispenseId === null) {
    if (bundle.dispense !== null) throw new Error('An order copy cannot silently include a dispensing event.');
  } else {
    const dispense = record(bundle.dispense);
    if (dispense.id !== target.dispenseId) throw new Error('Prescription print response contains a different dispensing event.');
  }
  // The shared renderer validates every snapshot field and exact status/fill binding.
  return renderNativePrescription(
    bundle.prescription as NativePrescriptionArtifact,
    bundle.status as NativePrescriptionPrintStatus | null,
    bundle.dispense === null ? undefined : bundle.dispense as NativeDispenseArtifact,
  );
}
