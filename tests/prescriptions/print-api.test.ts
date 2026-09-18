import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderReviewedPrescriptionCopy } from '../../src/hub/features/prescriptions/prescription-print.ts';
import { prescription, status, dispense } from './renderer-fixture.ts';
const target = { patientId: prescription.patient.id, authorizationId: prescription.authorization_id, dispenseId: null };
const order = { prescription, status, dispense: null };

test('the authorized print boundary accepts only the requested patient/order', () => {
  assert.ok(renderReviewedPrescriptionCopy(order, target).includes('Signed prescription order copy'));
  assert.throws(() => renderReviewedPrescriptionCopy(order, { ...target, patientId: dispense.id }), /another patient/);
  assert.throws(() => renderReviewedPrescriptionCopy(order, { ...target, authorizationId: dispense.id }), /another patient/);
  assert.throws(() => renderReviewedPrescriptionCopy(order, { ...target, patientId: '' }), /exact patient/);
});

test('order and fill copies cannot be silently interchanged', () => {
  const fill = { ...order, dispense };
  const fillTarget = { ...target, dispenseId: dispense.id };
  assert.ok(renderReviewedPrescriptionCopy(fill, fillTarget).includes('Recorded prescription dispense'));
  assert.throws(() => renderReviewedPrescriptionCopy(fill, target), /silently include/);
  assert.throws(() => renderReviewedPrescriptionCopy(order, fillTarget));
  assert.throws(() => renderReviewedPrescriptionCopy(fill, { ...fillTarget, dispenseId: prescription.patient.id }), /different dispensing event/);
});

test('malformed envelopes and missing status fail closed', () => {
  for (const value of [null, [], {}, { ...order, status: null }, { ...order, extra: 'unexpected' }, { prescription, status }, { ...order, prescription: [] }]) {
    assert.throws(() => renderReviewedPrescriptionCopy(value, target));
  }
});

test('valid outer identity never bypasses signed snapshot and status verification', () => {
  const wrongHash = { ...order, status: { ...status, authorization_hash: 'b'.repeat(64) } };
  assert.throws(() => renderReviewedPrescriptionCopy(wrongHash, target));
  assert.throws(() => renderReviewedPrescriptionCopy({ ...order, prescription: { ...prescription, medication: { ...prescription.medication, directions: '' } } }, target));
});
