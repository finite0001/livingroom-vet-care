import test from "node:test";
import assert from "node:assert/strict";
import {
  denverDay,
  filtersSchema,
  statusLabels,
  rowSchema,
  cursorSchema,
} from "../../src/hub/features/daily-communications/model.ts";
test("practice day follows Denver across UTC midnight and DST", () => {
  assert.equal(denverDay(new Date("2026-10-10T03:00:00Z")), "2026-10-09");
  assert.equal(denverDay(new Date("2026-03-08T06:59:59Z")), "2026-03-07");
  assert.equal(denverDay(new Date("2026-03-08T07:00:00Z")), "2026-03-08");
});
const f = {
  from: "2026-01-01",
  to: "2026-01-01",
  channel: "",
  status: "",
  search: "",
};
test("range validates real calendar dates and the server bound", () => {
  assert.ok(filtersSchema.safeParse(f).success);
  for (const change of [
    { from: "2026-02-30" },
    { to: "2025-12-31" },
    { to: "2027-01-02" },
    { channel: "VOICE" },
    { status: "sent" },
    { search: "a".repeat(201) },
  ])
    assert.equal(filtersSchema.safeParse({ ...f, ...change }).success, false);
  assert.ok(filtersSchema.safeParse({ ...f, to: "2027-01-01" }).success);
  assert.equal(
    filtersSchema.parse({ ...f, search: "  Susan  " }).search,
    "Susan",
  );
});
test("accepted labels cannot imply confirmed delivery", () => {
  assert.match(statusLabels.accepted, /delivery unconfirmed/);
  assert.equal(statusLabels.delivered, "Delivered");
  assert.match(statusLabels.uncertain, /uncertain/i);
});
const row = {
  source: "outbox",
  id: "15510000-0000-4000-8000-000000000001",
  activity_at: "2026-10-10T03:00:00Z",
  created_at: "2026-10-10T03:00:00Z",
  updated_at: "2026-10-10T03:00:00Z",
  channel: "EMAIL",
  status: "accepted",
  summary: "Staff message",
  client_id: null,
  client_name: null,
  pet_id: null,
  patient_name: null,
  conversation_id: null,
  recipient: "synthetic@example.test",
  attempt_count: 1,
  accepted_at: "2026-10-10T03:00:00Z",
  delivered_at: null,
  reason: null,
  source_href: "/hub/schedule",
};
test("read model refuses capability fields and external source URLs", () => {
  assert.ok(rowSchema.safeParse(row).success);
  assert.ok(rowSchema.safeParse({ ...row, source_href: null }).success);
  for (const change of [
    { provider_config: {} },
    { lease_token: "private" },
    { body: "protected link" },
    { source_href: "https://example.test" },
    { source_href: "/shared/private" },
    { attempt_count: -1 },
  ])
    assert.equal(rowSchema.safeParse({ ...row, ...change }).success, false);
});
test("cursor preserves timestamp, family and identity without additional data", () => {
  const c = { activity_at: row.activity_at, source: "outbox", id: row.id };
  assert.ok(cursorSchema.safeParse(c).success);
  assert.equal(
    cursorSchema.safeParse({ ...c, lease_token: "private" }).success,
    false,
  );
  assert.equal(
    cursorSchema.safeParse({ ...c, source: "other" }).success,
    false,
  );
});
