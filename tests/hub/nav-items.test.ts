import { test } from "node:test";
import assert from "node:assert/strict";
import { adminItems, isNavItemActive, navItems, tabItems } from "../../src/hub/components/layout/nav-items.ts";

const item = (path: string) => {
  const found = navItems.find((entry) => entry.path === path);
  assert.ok(found, `nav item ${path} exists`);
  return found;
};
const activeFor = (pathname: string) => navItems.filter((entry) => isNavItemActive(entry, pathname)).map((entry) => entry.path);

test("hub navigation exposes only the canonical scheduling workspace", () => {
  assert.equal(navItems.some(item => item.path === "/hub/schedule"), true);
  assert.equal(navItems.some(item => item.path === "/hub/appointments"), false);
  assert.equal(tabItems.filter(item => item.path === "/hub/schedule").length, 1);
});

test("active state matches whole path segments, not string prefixes", () => {
  assert.deepEqual(activeFor("/hub/timesheet"), ["/hub/timesheet"]);
  assert.deepEqual(activeFor("/hub/time"), ["/hub/time"]);
  assert.equal(isNavItemActive(item("/hub/schedule"), "/hub/schedule"), true);
  assert.equal(isNavItemActive(item("/hub/schedule"), "/hub/schedule/anything"), true);
  assert.equal(isNavItemActive(item("/hub/schedule"), "/hub/scheduler"), false);
});

test("Home and the admin dashboard light only on their exact path", () => {
  assert.deepEqual(activeFor("/hub"), ["/hub"]);
  assert.deepEqual(activeFor("/hub/admin"), ["/hub/admin"]);
  assert.deepEqual(activeFor("/hub/admin/operations"), ["/hub/admin/operations"]);
  assert.deepEqual(activeFor("/hub/admin/staff"), ["/hub/admin/staff"]);
});

test("detail pages highlight the list they belong to", () => {
  assert.deepEqual(activeFor("/hub/client/c1"), ["/hub/clients"]);
  assert.deepEqual(activeFor("/hub/patient/p1"), ["/hub/patients"]);
  assert.deepEqual(activeFor("/hub/whogot"), ["/hub/patients"]);
  assert.deepEqual(activeFor("/hub/whogot/source/performed/p1"), ["/hub/patients"]);
  assert.deepEqual(activeFor("/hub/ticket/t1"), ["/hub/tickets"]);
  assert.deepEqual(activeFor("/hub/conversation/x"), ["/hub/chats"]);
  assert.deepEqual(activeFor("/hub/inbox/review"), ["/hub/chats"]);
  assert.deepEqual(activeFor("/hub/admin/outbox"), ["/hub/admin/operations"]);
  assert.deepEqual(activeFor("/hub/admin/outbox/o1"), ["/hub/admin/operations"]);
  // A list path is not a prefix of its detail path: /hub/clients ≠ /hub/client/…
  assert.deepEqual(activeFor("/hub/clientsx"), []);
});

test("activePrefixes without a trailing slash still respect segment boundaries", () => {
  const phone = { path: "/hub/call", activePrefixes: ["/hub/voicemails"] };
  assert.equal(isNavItemActive(phone, "/hub/voicemails"), true);
  assert.equal(isNavItemActive(phone, "/hub/voicemails/v1"), true);
  assert.equal(isNavItemActive(phone, "/hub/voicemailsx"), false);
});

test("the ezyVet import tool is reachable from the admin section", () => {
  assert.equal(adminItems.some((entry) => entry.path === "/hub/tools/ezyvet"), true);
  assert.deepEqual(activeFor("/hub/tools/ezyvet"), ["/hub/tools/ezyvet"]);
});

test("every nav item has a distinct icon", () => {
  const icons = navItems.map((entry) => entry.icon);
  assert.equal(new Set(icons).size, icons.length);
});
