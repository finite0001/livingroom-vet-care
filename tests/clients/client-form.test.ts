import assert from "node:assert/strict";
import test from "node:test";
import { emptyClientForm, normalizeClientForm, isPotentialDuplicate, hasCompleteClientContacts } from "../../src/hub/components/clients/client-form.ts";

const complete = { ...emptyClientForm, first_name: "Jane", last_name: "Doe", primary_phone: "+13035550100", primary_email: "jane@example.test" };

test("requires actual names and rejects invalid email", () => {
  assert.throws(() => normalizeClientForm({ ...emptyClientForm, first_name: "  ", last_name: "Vet" }), /required/);
  assert.throws(() => normalizeClientForm({ ...complete, primary_email: "bad@" }), /valid email/);
});

test("requires both real contact values without an override", () => {
  for (const value of ["", "  "]) {
    assert.throws(() => normalizeClientForm({ ...complete, primary_phone: value }), /Phone number is required/);
    assert.throws(() => normalizeClientForm({ ...complete, primary_email: value }), /Email address is required/);
  }
  for (const phone of ["unknown", "3035550100", "+03035550100", "+13035550100 ext 2", "+1", "+1234567890123456"]) {
    assert.throws(() => normalizeClientForm({ ...complete, primary_phone: phone }), /valid phone/);
  }
  for (const email of [".jane@example.test", "jane..doe@example.test", "jane@-example.test", "jane@example", "jane@example..test"]) {
    assert.throws(() => normalizeClientForm({ ...complete, primary_email: email }), /valid email/);
  }
  assert.equal(hasCompleteClientContacts({ primary_phone: null, primary_email: complete.primary_email }), false);
  assert.equal(hasCompleteClientContacts({ primary_phone: complete.primary_phone, primary_email: null }), false);
  assert.equal(hasCompleteClientContacts(complete), true);
});

test("normalizes contact values while keeping visit and mailing addresses separate", () => {
  const value = normalizeClientForm({ ...complete, first_name: " Jane ", last_name: " Doe ", primary_phone: " +1 (303) 555-0100 ", primary_email: " JANE@example.com ", mailing_address: " PO Box 12 ", housecall_address: " 12 Pine St\nUnit 2 " });
  assert.equal(value.first_name, "Jane");
  assert.equal(value.primary_email, "jane@example.com");
  assert.equal(value.primary_phone, "+13035550100");
  assert.equal(value.mailing_address, "PO Box 12");
  assert.equal(value.housecall_address, "12 Pine St\nUnit 2");
});

test("duplicate review matches exact contact values and ignores missing contact values", () => {
  const source = { first_name: "Jane", last_name: "Doe", primary_phone: "+1 (303) 555-0100", primary_email: null };
  assert.equal(isPotentialDuplicate(source, { ...source, first_name: "John", primary_phone: "+13035550100" }), true);
  assert.equal(isPotentialDuplicate({ ...source, primary_phone: null }, { first_name: "Jim", last_name: "Brown", primary_phone: null, primary_email: null }), false);
  assert.equal(isPotentialDuplicate(source, { ...source, first_name: " jane ", primary_phone: null }), true);
});
