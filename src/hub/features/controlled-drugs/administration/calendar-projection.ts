import { z } from "zod";
import { ExactJsonNumber, protocolInteger, type ExactJson } from "../record-review/exact-json.ts";
import { administrationUuid, freezeAdministration } from "./primitives.ts";
import { calendarBoundaryInstantSchema, calendarClockSchema, calendarDateSchema, calendarZoneSchema, reviewCalendarBodySchema, type ReviewCalendarBody } from "./review-configuration-definition.ts";
const localTimestamp = z.string().regex(/^\d{4}-\d\d-\d\dT([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/).refine(value =>
  Number.isFinite(Date.parse(value + "Z")) && new Date(value + "Z").toISOString().slice(0, 19) === value && value >= "2026-01-01T00:00:00" && value <= "2101-01-01T00:00:00");
export const calendarProjectionRequestSchema = z.object({ schema_version: z.literal(1), actor_id: administrationUuid, product_id: administrationUuid, site_id: administrationUuid,
  zone: calendarZoneSchema, local_values: z.array(localTimestamp).min(1).max(63).refine(values => values.every((value, index) => index === 0 || values[index - 1] < value)) }).strict();
export interface CalendarProjectionRequest extends z.infer<typeof calendarProjectionRequestSchema> {}
function signedOffset(value: unknown): number {
  if (!(value instanceof ExactJsonNumber) || !/^(0|-?[1-9][0-9]{0,4})$/.test(value.token)) throw new Error("Invalid calendar offset token");
  const integer = BigInt(value.token); if (integer < -50400n || integer > 50400n) throw new Error("Calendar offset exceeds its source bound");
  return Number(integer); // A bounded offset in seconds, never a clinical value.
}
const candidate = z.object({ utc: calendarBoundaryInstantSchema.refine(value => value.endsWith(".000000Z")), offset_seconds: z.preprocess(signedOffset, z.number().int().min(-50400).max(50400)) }).strict();
const replySchema = z.object({ schema_version: z.preprocess(value => protocolInteger(value, 1, 1), z.literal(1)), zone: calendarZoneSchema, postgres_version: z.string().min(1).max(200),
  local_values: z.array(z.object({ local_timestamp: localTimestamp, candidates: z.array(candidate).max(2) }).strict()).min(1).max(63) }).strict();
export interface CalendarProjection extends z.infer<typeof replySchema> {}
export function parseCalendarProjection(raw: ExactJson, input: unknown): Readonly<CalendarProjection> {
  const request = calendarProjectionRequestSchema.parse(input), reply = replySchema.parse(raw);
  if (reply.zone !== request.zone || reply.local_values.length !== request.local_values.length) throw new Error("Calendar projection belongs to another request");
  reply.local_values.forEach((item, index) => {
    if (item.local_timestamp !== request.local_values[index] || item.candidates.some((value, at) => at > 0 && item.candidates[at - 1].utc! >= value.utc! ||
      Date.parse(value.utc!) !== Date.parse(item.local_timestamp! + "Z") - value.offset_seconds! * 1000)) throw new Error("Calendar candidate differs from the exact requested local time");
  });
  return freezeAdministration(reply);
}
export interface CalendarDayDraft { readonly date: string; readonly staffed: "" | "yes" | "no"; readonly closeLocal: string; readonly closeFold: "" | "0" | "1" }
/** Date labels advance in the nominal calendar; actual UTC day lengths come
 * exclusively from the publishing backend's timezone projection. */
export function calendarDateLabels(first: string, last: string): readonly string[] {
  const start = calendarDateSchema.parse(first), end = calendarDateSchema.parse(last), days = (Date.parse(end + "T00:00:00Z") - Date.parse(start + "T00:00:00Z")) / 86400000;
  if (!Number.isInteger(days) || days < 0 || days > 30) throw new Error("Choose one through thirty-one consecutive calendar dates.");
  return Object.freeze(Array.from({ length: days + 1 }, (_, index) => new Date(Date.parse(start + "T00:00:00Z") + index * 86400000).toISOString().slice(0, 10)));
}
function nextDate(date: string) { return new Date(Date.parse(date + "T00:00:00Z") + 86400000).toISOString().slice(0, 10); }
export function calendarClockInput(value: string): string { return calendarClockSchema.parse(value.length === 5 ? value + ":00" : value); }
export function calendarProjectionValues(days: readonly CalendarDayDraft[]): readonly string[] {
  if (!days.length || days.length > 31) throw new Error("Choose the calendar dates first.");
  const values = new Set<string>();
  for (const day of days) {
    calendarDateSchema.parse(day.date); if (day.staffed !== "yes" && day.staffed !== "no") throw new Error("Choose whether every day is staffed.");
    values.add(day.date + "T00:00:00"); values.add(nextDate(day.date) + "T00:00:00");
    if (day.staffed === "yes") values.add(day.date + "T" + calendarClockInput(day.closeLocal));
  }
  if (values.size > 63) throw new Error("Calendar projection exceeds its source bound.");
  return Object.freeze([...values].sort());
}
export function calendarBodyFromProjection(zone: string, first: string, last: string, drafts: readonly CalendarDayDraft[], projection: CalendarProjection): ReviewCalendarBody {
  const labels = calendarDateLabels(first, last), expected = calendarProjectionValues(drafts);
  if (projection.zone !== zone || labels.length !== drafts.length || labels.some((label, index) => label !== drafts[index].date) ||
    expected.length !== projection.local_values.length || expected.some((value, index) => value !== projection.local_values[index].local_timestamp)) throw new Error("Read a fresh calendar projection for the exact current choices.");
  const candidates = (value: string) => projection.local_values.find(item => item.local_timestamp === value)?.candidates ?? [];
  const days = drafts.map(day => {
    const start = candidates(day.date + "T00:00:00"), end = candidates(nextDate(day.date) + "T00:00:00");
    if (start.length !== 1 || end.length !== 1) throw new Error("A calendar midnight could not be uniquely resolved by the backend.");
    if (day.staffed === "no") return { date: day.date, staffed: false, start_utc: start[0].utc, end_utc: end[0].utc, close_local: null, close_fold: null, close_utc: null };
    const closeLocal = calendarClockInput(day.closeLocal), closes = candidates(day.date + "T" + closeLocal);
    if (!closes.length) throw new Error("A selected closing time does not exist in this time zone. Choose another time.");
    if (closes.length === 2 && day.closeFold !== "0" && day.closeFold !== "1") throw new Error("Choose the intended occurrence of each repeated closing time.");
    const fold = closes.length === 1 ? 0 : day.closeFold === "0" ? 0 : 1;
    return { date: day.date, staffed: true, start_utc: start[0].utc, end_utc: end[0].utc, close_local: closeLocal, close_fold: fold, close_utc: closes[fold].utc };
  });
  return freezeAdministration(reviewCalendarBodySchema.parse({ zone, first_date: first, last_date: last, days }));
}
