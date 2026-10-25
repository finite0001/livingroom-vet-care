import assert from "node:assert/strict";
import { test } from "node:test";
import { localAuthenticatedClinicalInputSchema } from "./local-authenticated-clinical-input.ts";

const uuid = "10000000-0000-4000-8000-000000000001";
const token = (role: string) => "e30." + Buffer.from(JSON.stringify({ role })).toString("base64url") + ".c3ludGFjdGlj";
function input() {
  return { origin: "http://127.0.0.1:64661", anonKey: token("anon"), actorId: uuid,
    login: { email: "lrv-closed-0123456789abcdef-1@example.invalid", password: "s".repeat(40) },
    scope: { product_id: uuid, site_id: uuid, event_kind: "record_patient_treatment" }, expectedEventId: uuid };
}
// Syntactic fixtures only: only the actual local Auth server verifies credentials.
test("clinical proof input carries explicit login and finite queue scope", () => {
  const parsed = localAuthenticatedClinicalInputSchema.parse(input());
  assert.deepEqual(Object.keys(parsed).sort(), ["actorId", "anonKey", "expectedEventId", "login", "origin", "scope"]);
});
test("exactly the two clinical writers are supported", () => {
  for (const eventKind of ["record_patient_treatment", "record_anesthesia_drug_administration"]) {
    const parsed = localAuthenticatedClinicalInputSchema.parse({ ...input(), scope: { ...input().scope, event_kind: eventKind } });
    assert.equal(parsed.scope.event_kind, eventKind);
  }
  for (const eventKind of ["receive_inventory", "adjust_inventory", "record_native_dispense", "record_native_dispense_return:intake", "unknown"]) {
    assert.equal(localAuthenticatedClinicalInputSchema.safeParse({ ...input(), scope: { ...input().scope, event_kind: eventKind } }).success, false);
  }
});
test("preloaded authenticated sessions and signing selection IDs are refused", () => {
  for (const key of ["session", "accessToken", "selection", "policy_id", "read_eligibility_id", "review_eligibility_id"]) {
    assert.equal(localAuthenticatedClinicalInputSchema.safeParse({ ...input(), [key]: uuid }).success, false);
    assert.equal(localAuthenticatedClinicalInputSchema.safeParse({ ...input(), scope: { ...input().scope, [key]: uuid } }).success, false);
  }
});
test("only the fixed local endpoint and disposable reviewer credentials are admitted", () => {
  for (const change of [
    { origin: "https://abcdefghijklmnopqrst.supabase.co" }, { anonKey: token("service_role") },
    { login: { ...input().login, email: "staff@example.com" } },
    { login: { ...input().login, email: "lrv-closed-0123456789abcdef-0@example.invalid" } },
    { login: { ...input().login, password: "short" } }, { scope: { ...input().scope, event_kind: "record_native_dispense" } },
  ]) assert.equal(localAuthenticatedClinicalInputSchema.safeParse({ ...input(), ...change }).success, false);
});
