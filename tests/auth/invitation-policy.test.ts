import test from "node:test";
import assert from "node:assert/strict";
import { canInvite, invitationRedirect, parseInvitation } from "../../supabase/functions/invite-staff/policy.ts";

test("only active administrators may invite, even with another staff role", () => {
  assert.equal(canInvite({ is_active: true }, [{ role: "ADMIN" }]), true);
  assert.equal(canInvite({ is_active: false }, [{ role: "ADMIN" }]), false);
  assert.equal(canInvite(null, [{ role: "ADMIN" }]), false);
  assert.equal(canInvite({ is_active: true }, [{ role: "DVM" }]), false);
  assert.equal(canInvite({ is_active: true }, []), false);
});

test("invitation validation excludes privilege and redirect injection", () => {
  const valid = { email: " Vet@Example.com ", first_name: " Ada ", last_name: "Vet" };
  assert.deepEqual(parseInvitation(valid), { email: "vet@example.com", first_name: "Ada", last_name: "Vet" });
  for (const extra of [{ role: "ADMIN" }, { redirectTo: "https://attacker.example" }, { user_id: "another-user" }]) {
    assert.throws(() => parseInvitation({ ...valid, ...extra }));
  }
  for (const invalid of [null, [], { ...valid, email: "bad" }, { ...valid, email: "a@b.com\nBcc:x@y.com" }, { ...valid, first_name: " " }, { ...valid, last_name: "x".repeat(101) }]) assert.throws(() => parseInvitation(invalid));
});

test("invitation redirects come only from a configured HTTPS origin", () => {
  assert.equal(invitationRedirect("https://practice.example"), "https://practice.example/hub/reset-password");
  assert.equal(invitationRedirect("http://localhost:8080"), "http://localhost:8080/hub/reset-password");
  for (const invalid of [undefined, "http://practice.example", "https://user:password@practice.example", "https://practice.example?next=evil", "https://practice.example/path", "javascript:alert(1)"]) assert.throws(() => invitationRedirect(invalid));
});

test("a supplied mismatched Origin is rejected, not merely hidden by CORS", async () => {
  const { isInvitationOriginAllowed } = await import("../../supabase/functions/invite-staff/policy.ts");
  const redirect = "https://practice.example/hub/reset-password";
  assert.equal(isInvitationOriginAllowed("https://practice.example", redirect), true);
  assert.equal(isInvitationOriginAllowed(null, redirect), true);
  for (const origin of ["https://attacker.example", "https://practice.example.evil", "http://practice.example", "null", ""]) assert.equal(isInvitationOriginAllowed(origin, redirect), false);
});
