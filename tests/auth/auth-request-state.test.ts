import test from "node:test";
import assert from "node:assert/strict";
import { createAuthRequestState } from "../../src/hub/contexts/auth-request-state.ts";

test("verified same-user refresh preserves access while first load does not", () => {
  const requests = createAuthRequestState();
  const initial = requests.begin("staff-a");
  assert.equal(initial.preserveAccess, false);
  assert.equal(requests.resolve(initial, true), true);
  // TOKEN_REFRESHED, repeated SIGNED_IN and USER_UPDATED all use this same path.
  for (let count = 0; count < 3; count++) {
    const refresh = requests.begin("staff-a");
    assert.equal(refresh.preserveAccess, true);
    assert.equal(refresh.identityChanged, false);
    assert.equal(requests.resolve(refresh, true), true);
  }
});

test("account switch and sign-out invalidate outstanding authorization queries", () => {
  const requests = createAuthRequestState();
  const first = requests.begin("staff-a");
  requests.resolve(first, true);
  const oldRefresh = requests.begin("staff-a");
  const newAccount = requests.begin("staff-b");
  assert.equal(newAccount.identityChanged, true);
  assert.equal(newAccount.preserveAccess, false);
  assert.equal(requests.resolve(oldRefresh, true), false);
  requests.resolve(newAccount, true);
  const nextRefresh = requests.begin("staff-b");
  const signedOut = requests.begin(null);
  assert.equal(signedOut.preserveAccess, false);
  assert.equal(requests.resolve(nextRefresh, true), false);
  assert.equal(requests.begin("staff-b").preserveAccess, false);
});

test("failed revalidation drops verified access and stale failures cannot erase newer success", () => {
  const requests = createAuthRequestState();
  requests.resolve(requests.begin("staff-a"), true);
  const stale = requests.begin("staff-a");
  const current = requests.begin("staff-a");
  requests.resolve(current, true);
  assert.equal(requests.resolve(stale, false), false);
  const failure = requests.begin("staff-a");
  assert.equal(failure.preserveAccess, true);
  assert.equal(requests.resolve(failure, false), true);
  assert.equal(requests.begin("staff-a").preserveAccess, false);
});

test("cleanup or an explicit sign-out attempt prevents a pending query restoring access", () => {
  const requests = createAuthRequestState();
  const pending = requests.begin("staff-a");
  requests.invalidate();
  assert.equal(requests.isCurrent(pending), false);
  assert.equal(requests.resolve(pending, true), false);
  assert.equal(requests.begin("staff-a").preserveAccess, false);
});

test("a stale refresh callback cannot switch authorization back to the previous account", () => {
  const requests = createAuthRequestState();
  requests.resolve(requests.begin("staff-a"), true);
  const current = requests.begin("staff-b");
  requests.resolve(current, true);
  assert.equal(requests.refresh("staff-a"), null);
  assert.equal(requests.isCurrent(current), true);
  assert.equal(requests.refresh("staff-b")?.preserveAccess, true);
});
