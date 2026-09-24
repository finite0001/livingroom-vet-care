import { test } from "node:test";
import assert from "node:assert/strict";
import { navItems, tabItems } from "../../src/hub/components/layout/nav-items.ts";

test("hub navigation exposes only the canonical scheduling workspace", () => {
  assert.equal(navItems.some(item => item.path === "/hub/schedule"), true);
  assert.equal(navItems.some(item => item.path === "/hub/appointments"), false);
  assert.equal(tabItems.filter(item => item.path === "/hub/schedule").length, 1);
});
