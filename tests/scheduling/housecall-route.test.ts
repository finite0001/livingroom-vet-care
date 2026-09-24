import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dayRouteAppointments,
  drivingDirections,
  formatRouteGap,
  practiceBaseAddress,
  routeLegs,
  routeTimings,
} from "../../src/hub/features/scheduling/housecall-route.ts";
import type { RouteAppointment } from "../../src/hub/features/scheduling/housecall-route.ts";

function visit(id: string, overrides: Partial<RouteAppointment> = {}): RouteAppointment {
  return { id, assigned_dvm_id: "dvm", scheduled_at: "2026-10-28T15:00:00Z", status: "SCHEDULED",
    visit_type: "housecall", address_snapshot: "100 Saved Street, Boulder, CO", duration_minutes: 30,
    travel_before_minutes: 15, travel_after_minutes: 10, ...overrides };
}

test("one Denver day and assigned staff retain planned clinic stops in chronological order", () => {
  const rows = [visit("late", { scheduled_at: "2026-10-28T19:00:00Z", address_snapshot: "90 Saved Street" }),
    visit("clinic", { scheduled_at: "2026-10-28T17:00:00Z", visit_type: "clinic", address_snapshot: practiceBaseAddress }),
    visit("early", { address_snapshot: "10 Saved Street" }), visit("other-staff", { assigned_dvm_id: "other" }), visit("unassigned", { assigned_dvm_id: null }),
    visit("other-day", { scheduled_at: "2026-10-29T06:00:00Z" }),
    ...["COMPLETED", "CANCELLED", "NO_SHOW"].map(status => visit(status, { status }))];
  const before = structuredClone(rows);
  const stops = dayRouteAppointments(rows, "2026-10-28", "dvm");
  assert.deepEqual(stops.map(row => row.id), ["early", "clinic", "late"]);
  assert.deepEqual(rows, before);
  const legs = routeLegs(stops);
  assert.deepEqual(legs.map(leg => [leg.origin, leg.destination]), [
    [practiceBaseAddress, "10 Saved Street"], ["10 Saved Street", practiceBaseAddress],
    [practiceBaseAddress, "90 Saved Street"], ["90 Saved Street", practiceBaseAddress],
  ]);
  assert.equal(legs.at(-1)?.appointment, null);
});

test("same-time ties are stable and UTC next-day visits belong to their Denver day", () => {
  const rows = [visit("b", { scheduled_at: "2027-01-29T06:30:00Z", status: "CONFIRMED" }),
    visit("a", { scheduled_at: "2027-01-29T06:30:00Z" })];
  assert.deepEqual(dayRouteAppointments(rows, "2027-01-28", "dvm").map(row => row.id), ["a", "b"]);
  assert.deepEqual(dayRouteAppointments(rows, "2027-01-29", "dvm"), []);
  assert.deepEqual(dayRouteAppointments(rows, "2027-01-28", ""), []);
  assert.deepEqual(routeLegs([]), []);
});

test("directions preserve saved address text without letting it add URL parameters", () => {
  const address = "12 A&B Street #2 / North?origin=elsewhere, Boulder, CO";
  const url = new URL(drivingDirections(practiceBaseAddress, address)!);
  assert.equal(url.origin, "https://www.google.com");
  assert.equal(url.pathname, "/maps/dir/");
  assert.deepEqual([...url.searchParams.keys()], ["api", "origin", "destination", "travelmode"]);
  assert.equal(url.searchParams.get("origin"), practiceBaseAddress);
  assert.equal(url.searchParams.get("destination"), address);
  assert.equal(url.searchParams.get("travelmode"), "driving");
});

test("missing or overlong addresses never produce a partial or truncated directions URL", () => {
  assert.equal(drivingDirections(" ", "valid"), null);
  assert.equal(drivingDirections("valid", ""), null);
  assert.equal(drivingDirections(practiceBaseAddress, "é".repeat(1000)), null);
  const legs = routeLegs([visit("missing", { address_snapshot: "" }), visit("next")]);
  assert.equal(legs[0].url, null);
  assert.equal(legs[1].url, null);
  assert.equal(legs[1].origin, "");
});

test("route timing exposes travel-buffer busy windows and gaps without mutating stops", () => {
  const stops = [
    visit("first", {
      scheduled_at: "2026-10-28T15:00:00Z",
      duration_minutes: 30,
      travel_before_minutes: 15,
      travel_after_minutes: 10,
    }),
    visit("second", {
      scheduled_at: "2026-10-28T16:00:00Z",
      duration_minutes: 45,
      travel_before_minutes: 5,
      travel_after_minutes: 20,
    }),
  ];
  const before = structuredClone(stops);
  const timings = routeTimings(stops);
  assert.deepEqual(stops, before);
  assert.deepEqual(timings.map(timing => ({
    id: timing.appointment.id,
    busy: `${timing.busyStartLabel}-${timing.busyEndLabel}`,
    visit: `${timing.visitStartLabel}-${timing.visitEndLabel}`,
    gapAfterMinutes: timing.gapAfterMinutes,
    plannedHoursIssue: timing.plannedHoursIssue,
  })), [
    { id: "first", busy: "08:45-09:40", visit: "09:00-09:30", gapAfterMinutes: 15, plannedHoursIssue: null },
    { id: "second", busy: "09:55-11:05", visit: "10:00-10:45", gapAfterMinutes: null, plannedHoursIssue: null },
  ]);
});

test("route timing flags overlaps and planned-hours exceptions as staff review items", () => {
  const timings = routeTimings([
    visit("late", {
      scheduled_at: "2026-10-29T22:30:00Z",
      duration_minutes: 45,
      travel_before_minutes: 10,
      travel_after_minutes: 20,
    }),
    visit("overlap", {
      scheduled_at: "2026-10-29T23:20:00Z",
      duration_minutes: 30,
      travel_before_minutes: 15,
      travel_after_minutes: 10,
    }),
    visit("sunday", {
      scheduled_at: "2026-11-01T17:00:00Z",
      duration_minutes: 30,
    }),
  ]);
  assert.equal(timings[0].gapAfterMinutes, -30);
  assert.match(formatRouteGap(timings[0].gapAfterMinutes!), /overlap by 30 minute/);
  assert.match(timings[0].plannedHoursIssue ?? "", /9 am–5 pm/);
  assert.match(timings[2].plannedHoursIssue ?? "", /Monday–Saturday/);
  assert.equal(formatRouteGap(0), "No unscheduled gap before the next stop.");
  assert.equal(formatRouteGap(25), "25 minute(s) open before the next busy window.");
});
