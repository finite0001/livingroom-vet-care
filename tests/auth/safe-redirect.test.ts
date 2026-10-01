import { test } from "node:test";
import assert from "node:assert/strict";
import { loginRedirectFrom, safeHubRedirect } from "../../src/hub/lib/safe-redirect.ts";

test("same-origin hub paths survive sign-in with their query and hash", () => {
  assert.equal(safeHubRedirect("/hub"), "/hub");
  assert.equal(safeHubRedirect("/hub/patient/p1?tab=medical&section=soap"), "/hub/patient/p1?tab=medical&section=soap");
  assert.equal(safeHubRedirect("/hub/schedule#today"), "/hub/schedule#today");
  assert.equal(safeHubRedirect("/hub?x=1"), "/hub?x=1");
});

test("anything outside the hub, off-origin or malformed falls back to /hub", () => {
  for (const value of [
    undefined, null, 42, {}, "", "hub", "/", "/about", "/hubx", "/hubbub/a",
    "//evil.test/hub", "https://evil.test/hub", "javascript:alert(1)",
    "/hub\\..\\evil", "/hub/\u0000", "/hub/../about", "/hub/./x",
    "/hub/login", "/hub/login?next=/hub", "/hub/reset-password",
    `/hub/${"a".repeat(3000)}`,
  ]) {
    assert.equal(safeHubRedirect(value), "/hub", String(value));
  }
});

test("login reads the intended URL from router location state", () => {
  assert.equal(loginRedirectFrom({ from: "/hub/tickets" }), "/hub/tickets");
  assert.equal(loginRedirectFrom({ from: "https://evil.test" }), "/hub");
  assert.equal(loginRedirectFrom(null), "/hub");
  assert.equal(loginRedirectFrom("/hub/tickets"), "/hub");
});
