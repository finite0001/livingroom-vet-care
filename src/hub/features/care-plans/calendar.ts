import { z } from "zod";

export const calendarDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a complete date").refine((value) => {
  const date = new Date(value + "T12:00:00Z");
  return Number(value.slice(0, 4)) > 0 && Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}, "Enter a valid calendar date");
export const intervalUnitSchema = z.enum(["days", "weeks", "months", "years"]);
export const monthEndSchema = z.enum(["clamp", "preserve_end"]);
export const anchorModeSchema = z.enum(["completed_care", "fixed_schedule"]);
export const recurrenceSchema = z.object({
  interval_amount: z.number().int().positive(),
  interval_unit: intervalUnitSchema,
  anchor_mode: anchorModeSchema,
  month_end: monthEndSchema,
}).superRefine((value, ctx) => {
  const maxima = { days: 36500, weeks: 5200, months: 1200, years: 100 };
  if (value.interval_amount > maxima[value.interval_unit]) ctx.addIssue({ code: "custom", path: ["interval_amount"], message: "Choose an interval of at most 100 years" });
});
export interface Recurrence extends z.infer<typeof recurrenceSchema> {}

export function calendarDue(anchor: string, recurrence: Recurrence, cycle = 1): string {
  calendarDateSchema.parse(anchor);
  const r = recurrenceSchema.parse(recurrence);
  z.number().int().min(1).max(1000000).parse(cycle);
  const original = new Date(anchor + "T12:00:00Z");
  let next: Date;
  if (r.interval_unit === "days" || r.interval_unit === "weeks") {
    next = new Date(original);
    next.setUTCDate(next.getUTCDate() + r.interval_amount * cycle * (r.interval_unit === "weeks" ? 7 : 1));
  } else {
    const months = r.interval_amount * cycle * (r.interval_unit === "years" ? 12 : 1);
    const target = new Date(original);
    target.setUTCDate(1);
    target.setUTCMonth(target.getUTCMonth() + months);
    const end = new Date(target);
    end.setUTCMonth(end.getUTCMonth() + 1);
    end.setUTCDate(0);
    const originalEnd = new Date(original);
    originalEnd.setUTCMonth(originalEnd.getUTCMonth() + 1, 0);
    target.setUTCDate(r.month_end === "preserve_end" && originalEnd.getUTCDate() === original.getUTCDate()
      ? end.getUTCDate() : Math.min(original.getUTCDate(), end.getUTCDate()));
    next = target;
  }
  if (!Number.isFinite(next.valueOf()) || next.getUTCFullYear() > 9999 || next.getUTCFullYear() < 1) throw new Error("Due date exceeds the supported range");
  return next.toISOString().slice(0, 10);
}

export const sendTimeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM");
export const endTimeSchema = z.union([sendTimeSchema, z.literal("24:00")]);
export function timeMinutes(value: string, end = false): number {
  (end ? endTimeSchema : sendTimeSchema).parse(value);
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}
export function minutesTime(value: number): string {
  z.number().int().min(0).max(1440).parse(value);
  return String(Math.floor(value / 60)).padStart(2, "0") + ":" + String(value % 60).padStart(2, "0");
}
