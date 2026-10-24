import assert from "node:assert/strict";
import { test } from "node:test";
import { localAuthenticatedReviewReadInputSchema } from "./local-authenticated-review-read-input.ts";

const actor = "10000000-0000-4000-8000-000000000001", session = "10000000-0000-4000-8000-000000000002";
const event = "10000000-0000-4000-8000-000000000003";
// Unsigned syntactic test values only. The local API, not this filter, verifies
// actual JWT authenticity during the independently admitted browser experiment.
const token = (claims: object) => "e30." + Buffer.from(JSON.stringify(claims)).toString("base64url") + ".c3ludGFjdGlj";
function input() {
  return { origin: "http://127.0.0.1:64661", anonKey: token({ role: "anon" }),
    session: { actorId: actor, sessionId: session, generation: 1,
      accessToken: token({ sub: actor, session_id: session, role: "authenticated", email: "lrv-closed-0123456789abcdef-1@example.invalid" }) },
    scope: { product_id: actor, site_id: session, event_kind: "adjust_inventory" }, expectedEventId: event };
}
test("browser-read input admits scope without any preparation selection IDs", () => {
  const parsed = localAuthenticatedReviewReadInputSchema.parse(input());
  assert.deepEqual(Object.keys(parsed).sort(), ["anonKey", "expectedEventId", "origin", "scope", "session"]);
  for (const key of ["selection", "policy_id", "read_eligibility_id", "review_eligibility_id"]) {
    assert.equal(localAuthenticatedReviewReadInputSchema.safeParse({ ...input(), [key]: actor }).success, false);
    assert.equal(localAuthenticatedReviewReadInputSchema.safeParse({ ...input(), scope: { ...input().scope, [key]: actor } }).success, false);
  }
});
test("browser-read input rejects hosted origins, broader kinds and mismatched identities", () => {
  for (const change of [
    { origin: "https://abcdefghijklmnopqrst.supabase.co" }, { anonKey: token({ role: "service_role" }) },
    { scope: { ...input().scope, event_kind: "record_native_dispense" } },
    { session: { ...input().session, actorId: event } }, { session: { ...input().session, sessionId: event } },
    { session: { ...input().session, generation: 2 } },
  ]) assert.equal(localAuthenticatedReviewReadInputSchema.safeParse({ ...input(), ...change }).success, false);
});
test("browser-read input rejects ordinary staff addresses and non-reviewer local identities", () => {
  for (const email of ["staff@example.com", "lrv-closed-0123456789abcdef-0@example.invalid"]) {
    const value = input(); value.session.accessToken = token({ sub: actor, session_id: session, role: "authenticated", email });
    assert.equal(localAuthenticatedReviewReadInputSchema.safeParse(value).success, false);
  }
});
