import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appointmentDictationBlocked, appointmentDictationHref, appointmentDictationSchema } from '../../src/hub/features/clinical/appointment-dictation/model.ts';
const appointment = {
  actor_id: '50000000-0000-4000-8000-000000000001', pet_id: '50000000-0000-4000-8000-000000000002',
  appointment_id: '50000000-0000-4000-8000-000000000003', version: 1, patient_name: 'Synthetic dog', species: 'Dog',
  household_name: 'Synthetic household', scheduled_at: '2026-10-16T15:00:00+00:00', visit_type: 'clinic',
  location: 'Synthetic clinic', appointment_type: 'Wellness', status: 'CONFIRMED', assigned_dvm_id: null, assigned_dvm_name: null,
  eligible: true, context_changed: false, encounter_id: null, encounter_status: null,
};
test('Appointment action preserves both patient and appointment identity in the medical route', () => {
  const url = new URL(appointmentDictationHref(appointment.pet_id, appointment.appointment_id), 'https://example.test');
  assert.equal(url.pathname, '/hub/patient/' + appointment.pet_id);
  assert.deepEqual(Object.fromEntries(url.searchParams), { tab: 'medical', section: 'soap', dictation_appointment: appointment.appointment_id });
});
test('A valid unsigned appointment can proceed to explicit confirmation', () => {
  assert.equal(appointmentDictationBlocked(appointmentDictationSchema.parse(appointment)), null);
});
test('A changed appointment blocks even when the patient is still eligible', () => {
  assert.match(appointmentDictationBlocked(appointmentDictationSchema.parse({ ...appointment, context_changed: true }))!, /changed/);
});
test('Cancelled, inactive and unlinked completed appointments use server eligibility', () => {
  for (const status of ['CANCELLED', 'NO_SHOW', 'COMPLETED']) assert.match(appointmentDictationBlocked(appointmentDictationSchema.parse({ ...appointment, status, eligible: false }))!, /active patient/);
});
test('A signed encounter cannot offer recording', () => {
  assert.match(appointmentDictationBlocked(appointmentDictationSchema.parse({ ...appointment, encounter_id: appointment.actor_id, encounter_status: 'signed' }))!, /signed/);
});
test('Malformed appointment identity or version is rejected at the API boundary', () => {
  assert.equal(appointmentDictationSchema.safeParse({ ...appointment, appointment_id: 'not-a-uuid' }).success, false);
  assert.equal(appointmentDictationSchema.safeParse({ ...appointment, version: 0 }).success, false);
});
