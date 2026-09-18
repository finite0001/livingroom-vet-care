import type { NativePrescriptionArtifact, NativeDispenseArtifact, NativePrescriptionPrintStatus } from '../../supabase/functions/_shared/native-prescription-renderer.ts';
export const prescription: NativePrescriptionArtifact = {
  schema_version: 1,
  authorization_id: '00000000-0000-4000-8000-000000000001', authorization_hash: 'a'.repeat(64),
  signed_at: '2026-09-16T10:00:00Z', signature_name: 'Dr Synthetic',
  patient: { id: '00000000-0000-4000-8000-000000000002', name: 'Synthetic patient', species: 'dog' },
  household: { id: '00000000-0000-4000-8000-000000000003', name: 'Synthetic household', address: 'Test address' },
  prescriber: { user_id: '00000000-0000-4000-8000-000000000004', name: 'Dr Synthetic', license_number: 'TEST-ONLY', license_state: 'CO', practice_name: 'Synthetic practice', practice_address: 'Test location', practice_phone: null },
  medication: { name: 'Synthetic medication', strength: 'Test strength', form: 'Test form', directions: 'Synthetic directions only.\nNot a clinical recommendation.', route: 'Test route' },
  quantity_per_fill: '30', unit: 'test units', refills_authorized: 2,
  fulfillment_mode: 'practice_stock', starts_on: '2026-09-16', expires_on: '2026-10-16',
};
export const status: NativePrescriptionPrintStatus = {
  authorization_id: prescription.authorization_id, authorization_hash: prescription.authorization_hash,
  checked_at: '2026-09-16T11:00:00Z', state: 'active', reason: null, replacement_id: null,
};
export const dispense: NativeDispenseArtifact = {
  id: '00000000-0000-4000-8000-000000000005', authorization_id: prescription.authorization_id,
  authorization_hash: prescription.authorization_hash, fill_index: 0, quantity: '10', unit: prescription.unit,
  dispensed_at: '2026-09-16T10:30:00Z', recorded_by: { user_id: prescription.prescriber.user_id, name: 'Synthetic dispenser' },
  invoice_id: '00000000-0000-4000-8000-000000000006',
  lots: [{ id: '00000000-0000-4000-8000-000000000007', number: 'TEST-LOT', expires_on: '2027-01-01', quantity: '10' }],
};
