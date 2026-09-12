import assert from "node:assert/strict";
import test from "node:test";
import { emptyClientForm, normalizeClientForm, isPotentialDuplicate } from "../../src/hub/components/clients/client-form.ts";

test("requires actual names and rejects invalid email", () => {
  assert.throws(() => normalizeClientForm({ ...emptyClientForm, first_name: "  ", last_name: "Vet" }), /required/);
  assert.throws(() => normalizeClientForm({ ...emptyClientForm, first_name: "A", last_name: "B", primary_email: "bad@" }), /valid email/);
});

test("normalizes contact values while keeping visit and mailing addresses separate", () => {
  const value = normalizeClientForm({ ...emptyClientForm, first_name: " Jane ", last_name: " Doe ", primary_email: " JANE@example.com ", mailing_address: " PO Box 12 ", housecall_address: " 12 Pine St\nUnit 2 " });
  assert.equal(value.first_name, "Jane");
  assert.equal(value.primary_email, "jane@example.com");
  assert.equal(value.primary_phone, null);
  assert.equal(value.mailing_address, "PO Box 12");
  assert.equal(value.housecall_address, "12 Pine St\nUnit 2");
});

test("duplicate review matches exact contact values and ignores missing contact values", () => {
  const source = { first_name: "Jane", last_name: "Doe", primary_phone: "+1 (303) 555-0100", primary_email: null };
  assert.equal(isPotentialDuplicate(source, { ...source, first_name: "John", primary_phone: "+13035550100" }), true);
  assert.equal(isPotentialDuplicate({ ...source, primary_phone: null }, { first_name: "Jim", last_name: "Brown", primary_phone: null, primary_email: null }), false);
  assert.equal(isPotentialDuplicate(source, { ...source, first_name: " jane ", primary_phone: null }), true);
});
