import { test } from "node:test";
import assert from "node:assert/strict";
import { commitPrescriptionOperation, discardPrescriptionReview, emptyPrescriptionOperation, prescriptionOperationConfirmed, prescriptionOperationFailed, prescriptionOperationLocked, prescriptionRecoveryAbsent, prescriptionRecoveryFailed, recoverPrescriptionOperation, reviewPrescriptionOperation } from "../../src/hub/features/prescriptions/prescription-state.ts";
const initial = () => emptyPrescriptionOperation("staff-1", "patient-1");
const operation = () => ({ id: "operation-1", kind: "dispense", payload: { authorization: "signed-1", preview_hash: "reviewed", quantity: "2.500", allocations: [{ lot_id: "lot-1", quantity: "2.500" }] } });
const reply = { actor: "staff-1", patientId: "patient-1", operationId: "operation-1" };
const submitted = () => commitPrescriptionOperation(reviewPrescriptionOperation(initial(), operation()));
test("review deeply copies and freezes lot allocations and exact quantity without rounding", () => {
  const input = operation();
  const state = reviewPrescriptionOperation(initial(), input);
  input.payload.allocations[0].quantity = "500";
  assert.deepEqual(state.operation, operation());
  assert.ok(Object.isFrozen(state.operation));
  assert.ok(Object.isFrozen(state.operation?.payload.allocations));
  assert.throws(() => reviewPrescriptionOperation(initial(), { ...operation(), payload: { bad: undefined } }));
  assert.throws(() => reviewPrescriptionOperation(initial(), { ...operation(), payload: { bad: NaN } }));
});
test("lost dispense reply requires recovery; absent recovery permits exact original retry", () => {
  let state = prescriptionOperationFailed(submitted(), reply, new Error("Network lost"));
  assert.equal(state.phase, "uncertain");
  assert.ok(prescriptionOperationLocked(state));
  assert.equal(commitPrescriptionOperation(state), state);
  assert.equal(reviewPrescriptionOperation(state, { ...operation(), id: "replacement" }), state);
  assert.equal(discardPrescriptionReview(state), state);
  state = recoverPrescriptionOperation(state);
  assert.equal(commitPrescriptionOperation(state), state);
  state = prescriptionRecoveryAbsent(state, reply);
  assert.equal(state.phase, "retryable");
  assert.ok(prescriptionOperationLocked(state));
  assert.equal(reviewPrescriptionOperation(state, { ...operation(), id: "replacement" }), state);
  state = commitPrescriptionOperation(state);
  assert.deepEqual(state.operation, operation());
  assert.equal(prescriptionOperationConfirmed(state, reply).phase, "confirmed");
});
test("rejection after prior uncertainty cannot erase an original request still in flight", () => {
  let state = prescriptionOperationFailed(submitted(), reply, new Error("Lost response"));
  state = prescriptionRecoveryAbsent(recoverPrescriptionOperation(state), reply);
  state = prescriptionOperationFailed(commitPrescriptionOperation(state), reply, { code: "40001" });
  assert.equal(state.phase, "uncertain");
  assert.deepEqual(state.operation, operation());
  state = recoverPrescriptionOperation(state);
  assert.equal(prescriptionOperationConfirmed(state, reply).phase, "confirmed");
});
test("confirmed first database rejection permits revised review; unknown failures stay locked", () => {
  for (const code of ["23514", "40001", "42501"]) assert.deepEqual(prescriptionOperationFailed(submitted(), reply, { code }), initial());
  for (const failure of [null, { code: "23505" }, { code: "503" }, new Error("Receipt validation failed")]) assert.equal(prescriptionOperationFailed(submitted(), reply, failure).phase, "uncertain");
});
test("wrong actor, patient and operation responses cannot confirm or unlock private intent", () => {
  for (const wrong of [{ ...reply, actor: "staff-2" }, { ...reply, patientId: "patient-2" }, { ...reply, operationId: "other" }]) {
    const state = submitted();
    assert.equal(prescriptionOperationConfirmed(state, wrong), state);
    assert.equal(prescriptionOperationFailed(state, wrong, { code: "40001" }), state);
    const recovery = recoverPrescriptionOperation(prescriptionOperationFailed(state, reply, null));
    assert.equal(prescriptionRecoveryAbsent(recovery, wrong), recovery);
    assert.equal(prescriptionRecoveryFailed(recovery, wrong), recovery);
    assert.equal(prescriptionOperationConfirmed(recovery, wrong), recovery);
  }
  const newActor = emptyPrescriptionOperation("staff-2", "patient-1");
  assert.equal(prescriptionOperationConfirmed(newActor, reply), newActor);
});
test("recovery failures preserve request; confirmed receipt clears private payload", () => {
  let state = recoverPrescriptionOperation(prescriptionOperationFailed(submitted(), reply, null));
  state = prescriptionRecoveryFailed(state, reply);
  assert.equal(state.phase, "uncertain");
  assert.deepEqual(state.operation, operation());
  state = prescriptionOperationConfirmed(recoverPrescriptionOperation(state), reply);
  assert.equal(state.operation, null);
  assert.equal(prescriptionOperationLocked(state), false);
  assert.deepEqual(discardPrescriptionReview(state), initial());
});
test("review is explicit and can be discarded before sending without a pending operation", () => {
  assert.equal(commitPrescriptionOperation(initial()).phase, "editing");
  const reviewed = reviewPrescriptionOperation(initial(), operation());
  assert.equal(reviewed.phase, "review");
  assert.deepEqual(discardPrescriptionReview(reviewed), initial());
  assert.equal(recoverPrescriptionOperation(reviewed), reviewed);
  assert.equal(prescriptionOperationConfirmed(reviewed, reply), reviewed);
});
