import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calendarDate, patientAge, practiceToday, validatePatient, weightInKg } from '../../src/hub/features/patients/patient-details.ts';
import type { PatientFormValues } from '../../src/hub/features/patients/patient-details.ts';
const patient: PatientFormValues = { name: 'Juniper', species: 'Dog', breed: 'Mixed', dob: '2020-09-13', birthDatePrecision: 'exact', color: '', sex: 'female', neuterStatus: 'neutered', microchip: '00012345', deceasedAt: '', archived: false };
test('patient age uses calendar birthday boundaries and marks estimated ages', () => {
  assert.equal(patientAge(patient.dob, 'exact', '2026-09-12'), '5 years');
  assert.equal(patientAge(patient.dob, 'exact', '2026-09-13'), '6 years');
  assert.equal(patientAge('2026-08-13', 'estimated', '2026-09-12'), 'Approximately Under 1 month');
  assert.equal(patientAge(patient.dob, 'unknown'), 'Age unknown');
  assert.equal(patientAge('2027-01-01', 'exact', '2026-09-12'), 'Age unknown');
});
test('clinical calendar dates retain Denver day across UTC midnight', () => {
  assert.equal(practiceToday(new Date('2026-09-13T01:00:00Z')), '2026-09-12');
  assert.equal(practiceToday(new Date('2026-01-13T06:30:00Z')), '2026-01-12');
  assert.equal(calendarDate('2026-02-29'), false);
  assert.equal(calendarDate('2024-02-29'), true);
});
test('patient validation rejects impossible dates and preserves microchip identity', () => {
  assert.equal(validatePatient(patient, '2026-09-12'), null);
  assert.equal(patient.microchip, '00012345');
  assert.match(validatePatient({ ...patient, dob: '2026-02-30' }, '2026-09-12')!, /valid birthdate/);
  assert.match(validatePatient({ ...patient, deceasedAt: '2020-09-12' }, '2026-09-12')!, /not before birth/);
  assert.equal(validatePatient({ ...patient, dob: '', birthDatePrecision: 'unknown' }, '2026-09-12'), null);
});
test('weight conversion retains original measurement units and precision', () => {
  assert.ok(Math.abs(weightInKg(10, 'lb') - 4.5359237) < 1e-9);
  assert.equal(weightInKg(10, 'kg'), 10);
});
