import { test } from "node:test";
import assert from "node:assert/strict";
import { localAuthenticatedReviewInputSchema } from "./local-authenticated-review-input.ts";
import { actor, event, operation, other, policy, session } from "./record-review-lifecycle-fixture.ts";
// Parser-only unsigned examples. They are never submitted to a server and do
// not establish JWT authenticity; the actual local Auth server does that.
const jwt = (claims: object) => Buffer.from("{}").toString("base64url") + "." + Buffer.from(JSON.stringify(claims)).toString("base64url") + ".parser_test_only";
function input() {
  return { origin: "http://127.0.0.1:64661", anonKey: jwt({ role: "anon" }), session: { actorId: actor, sessionId: session, generation: 1,
    accessToken: jwt({ sub: actor, session_id: session, role: "authenticated", email: "lrv-closed-0123456789abcdef-1@example.invalid" }) },
    selection: { actor_id: actor, event_id: event, policy_id: policy, read_eligibility_id: operation, review_eligibility_id: other } };
}
test("local browser input restricts origin and accidental real/service identities", () => {
  assert.equal(localAuthenticatedReviewInputSchema.safeParse(input()).success, true);
  const changes = [value => { value.origin = "https://real.supabase.co"; }, value => { value.origin = "http://localhost:64661"; },
    value => { value.anonKey = jwt({ role: "service_role" }); }, value => { value.selection.actor_id = other; },
    value => { value.session.generation = 2; }, value => { value.session.extra = "unknown"; },
    value => { value.session.accessToken = jwt({ sub: actor, session_id: session, role: "authenticated", email: "staff@example.com" }); },
    value => { value.session.accessToken = jwt({ sub: other, session_id: session, role: "authenticated", email: "lrv-closed-0123456789abcdef-1@example.invalid" }); },
    value => { value.session.accessToken = jwt({ sub: actor, session_id: other, role: "authenticated", email: "lrv-closed-0123456789abcdef-1@example.invalid" }); }];
  for (const change of changes) { const value = input(); change(value); assert.equal(localAuthenticatedReviewInputSchema.safeParse(value).success, false); }
});
