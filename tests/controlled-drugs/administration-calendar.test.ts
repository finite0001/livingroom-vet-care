import assert from "node:assert/strict";
import test from "node:test";
import { decodeExactJson } from "../../src/hub/features/controlled-drugs/record-review/exact-json.ts";
import { calendarBodyFromProjection, calendarProjectionValues, parseCalendarProjection, type CalendarDayDraft } from "../../src/hub/features/controlled-drugs/administration/calendar-projection.ts";
const id = "00000000-0000-4000-8000-000000000001";
const decode = (value: unknown) => decodeExactJson(new TextEncoder().encode(JSON.stringify(value)));
function projection(days: readonly CalendarDayDraft[], localValues: unknown[]) {
  const values = calendarProjectionValues(days), request = { schema_version: 1, actor_id: id, product_id: id, site_id: id, zone: "America/Denver", local_values: values };
  const raw = { schema_version: 1, zone: "America/Denver", postgres_version: "17.6", local_values: localValues };
  return { request, raw, parsed: parseCalendarProjection(decode(raw), request) };
}
test("backend negative offsets preserve a 25-hour day and require an explicit repeated closing occurrence", () => {
  const days: readonly CalendarDayDraft[] = [{ date: "2026-11-01", staffed: "yes", closeLocal: "01:30", closeFold: "" }];
  const source = projection(days, [
    { local_timestamp: "2026-11-01T00:00:00", candidates: [{ utc: "2026-11-01T06:00:00.000000Z", offset_seconds: -21600 }] },
    { local_timestamp: "2026-11-01T01:30:00", candidates: [{ utc: "2026-11-01T07:30:00.000000Z", offset_seconds: -21600 }, { utc: "2026-11-01T08:30:00.000000Z", offset_seconds: -25200 }] },
    { local_timestamp: "2026-11-02T00:00:00", candidates: [{ utc: "2026-11-02T07:00:00.000000Z", offset_seconds: -25200 }] },
  ]);
  assert.throws(() => calendarBodyFromProjection("America/Denver", "2026-11-01", "2026-11-01", days, source.parsed), /occurrence/);
  const value = calendarBodyFromProjection("America/Denver", "2026-11-01", "2026-11-01", [{ ...days[0], closeFold: "1" }], source.parsed);
  assert.equal(value.days[0].close_utc, "2026-11-01T08:30:00.000000Z");
  assert.equal(Date.parse(value.days[0].end_utc!) - Date.parse(value.days[0].start_utc!), 25 * 3600000);
  const altered = structuredClone(source.raw) as { local_values: { candidates: { offset_seconds: number }[] }[] };
  altered.local_values[0].candidates[0].offset_seconds = 21600;
  assert.throws(() => parseCalendarProjection(decode(altered), source.request));
  assert.throws(() => calendarBodyFromProjection("America/Denver", "2026-11-01", "2026-11-01", [{ ...days[0], closeLocal: "02:00" }], source.parsed));
});
test("a backend-projected spring gap is refused without shifting the chosen time", () => {
  const days: readonly CalendarDayDraft[] = [{ date: "2026-03-08", staffed: "yes", closeLocal: "02:30", closeFold: "" }];
  const source = projection(days, [
    { local_timestamp: "2026-03-08T00:00:00", candidates: [{ utc: "2026-03-08T07:00:00.000000Z", offset_seconds: -25200 }] },
    { local_timestamp: "2026-03-08T02:30:00", candidates: [] },
    { local_timestamp: "2026-03-09T00:00:00", candidates: [{ utc: "2026-03-09T06:00:00.000000Z", offset_seconds: -21600 }] },
  ]);
  assert.throws(() => calendarBodyFromProjection("America/Denver", "2026-03-08", "2026-03-08", days, source.parsed), /does not exist/);
});
