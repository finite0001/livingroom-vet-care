import { z } from "zod";
import { denverInstant, denverLocal, shiftDay } from "../scheduling/time.ts";

const uuid = z.string().uuid();
const day = z.iso.date();
const instant = z.iso.datetime({ offset: true });
const text = (max: number) => z.string().trim().min(1).max(max);
const nullableNumber = z.number().finite().nullable();
export const settingsSchema = z.object({
  singleton: z.boolean(),
  version: z.number().int(),
  workweek_start: nullableNumber,
  weekly_hours: nullableNumber,
  daily_hours: nullableNumber,
  auto_close_hours: nullableNumber,
  late_grace_minutes: nullableNumber,
  payroll_provider: z.string().nullable(),
  updated_at: instant,
});
export const entrySchema = z.object({
  id: uuid,
  staff_id: uuid,
  clock_in_at: instant,
  clock_out_at: instant.nullable(),
  note: z.string().nullable(),
});
export const requestSchema = z.object({
  id: uuid,
  staff_id: uuid,
  kind: z.enum(["PTO", "SICK"]),
  starts_on: day,
  ends_on: day,
  hours: z.number(),
  reason: z.string(),
  status: z.enum(["PENDING", "APPROVED", "DENIED", "CANCELLED"]),
  version: z.number().int(),
});
export const periodSchema = z.object({
  id: uuid,
  starts_on: day,
  ends_on: day,
  state: z.enum(["OPEN", "CLOSED"]),
  time_changed: z.boolean().optional(),
  version: z.number().int(),
});
export const workforceSchema = z.object({
  can_manage: z.boolean(),
  job_active: z.boolean().nullable(),
  can_pay: z.boolean(),
  can_assign: z.boolean(),
  settings: settingsSchema,
  staff: z.array(z.object({ id: uuid, name: z.string() })),
  access: z.array(
    z.object({
      staff_id: uuid,
      time_manager: z.boolean(),
      pay_manager: z.boolean(),
    }),
  ),
  policies: z.array(
    z.object({
      kind: z.enum(["PTO", "SICK"]),
      monthly_hours: z.number(),
      cap_hours: nullableNumber,
      allow_negative: z.boolean(),
      effective_from: day,
      version: z.number(),
    }),
  ),
  balances: z.array(
    z.object({ staff_id: uuid, kind: z.string(), hours: z.number() }),
  ),
  requests: z.array(requestSchema),
  off: z.array(
    z.object({ id: uuid, staff_id: uuid, starts_on: day, ends_on: day }),
  ),
  shifts: z.array(
    z.object({
      id: uuid,
      staff_id: uuid,
      starts_at: instant,
      ends_at: instant,
      note: z.string(),
      cancelled: z.boolean(),
      version: z.number(),
    }),
  ),
  holidays: z.array(
    z.object({
      day,
      label: z.string(),
      closed: z.boolean(),
      paid_hours: z.number(),
    }),
  ),
  periods: z.array(periodSchema),
  entries: z.array(entrySchema),
  approvals: z.array(
    z.object({
      period_id: uuid,
      staff_id: uuid,
      fingerprint: z.string(),
      approved_at: instant.nullable(),
      submitted_at: instant,
    }),
  ),
  corrections: z.array(
    z.object({
      id: uuid,
      staff_id: uuid,
      entry_id: uuid.nullable(),
      starts_at: instant,
      ends_at: instant,
      reason: z.string(),
      status: z.enum(["PENDING", "APPROVED", "DENIED"]),
    }),
  ),
  flags: z.array(
    z.object({
      entry_id: uuid,
      estimated_at: instant,
      reviewed_at: instant.nullable(),
    }),
  ),
});
export interface Workforce extends z.infer<typeof workforceSchema> {}
export interface WorkEntry extends z.infer<typeof entrySchema> {}
export const commandSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("access"),
    data: z.object({ time_manager: z.boolean(), pay_manager: z.boolean() }),
  }),
  z.object({
    action: z.literal("settings"),
    data: z.object({
      version: z.number().int(),
      workweek_start: z.number().int().min(0).max(6).nullable(),
      weekly_hours: z.number().positive().max(168).nullable(),
      daily_hours: z.number().positive().max(24).nullable(),
      auto_close_hours: z.number().positive().max(48).nullable(),
      late_grace_minutes: z.number().int().min(0).max(120).nullable(),
      payroll_provider: z.string().max(150).nullable(),
    }),
  }),
  z.object({
    action: z.literal("policy"),
    data: z.object({
      kind: z.enum(["PTO", "SICK"]),
      monthly_hours: z.number().min(0).max(1000),
      cap_hours: z.number().min(0).max(10000).nullable(),
      allow_negative: z.boolean(),
      effective_from: day,
    }),
  }),
  z.object({
    action: z.literal("enroll"),
    data: z.object({
      staff_id: uuid,
      kind: z.enum(["PTO", "SICK"]),
      hours: z.number().min(-10000).max(10000),
      enrolled_on: day,
    }),
  }),
  z.object({
    action: z.literal("adjust_balance"),
    data: z.object({
      staff_id: uuid,
      kind: z.enum(["PTO", "SICK"]),
      hours: z
        .number()
        .min(-10000)
        .max(10000)
        .refine((n) => n !== 0),
      reason: text(1000),
    }),
  }),
  z.object({
    action: z.literal("request_leave"),
    data: z
      .object({
        kind: z.enum(["PTO", "SICK"]),
        starts_on: day,
        ends_on: day,
        hours: z.number().positive().max(1000),
        reason: z.string().max(2000),
      })
      .refine(
        (v) => v.ends_on >= v.starts_on,
        "End date must follow start date",
      ),
  }),
  z.object({
    action: z.literal("decide_leave"),
    data: z.object({
      version: z.number().int(),
      decision: z.enum(["APPROVED", "DENIED", "CANCELLED"]),
    }),
  }),
  z.object({
    action: z.literal("shift"),
    data: z
      .object({
        staff_id: uuid,
        starts_at: instant,
        ends_at: instant,
        note: z.string().max(1000),
      })
      .refine((v) => v.ends_at > v.starts_at, "End must follow start"),
  }),
  z.object({
    action: z.literal("cancel_shift"),
    data: z.object({ version: z.number().int() }),
  }),
  z.object({
    action: z.literal("holiday"),
    data: z.object({
      day,
      label: text(150),
      closed: z.boolean(),
      paid_hours: z.number().min(0).max(24),
    }),
  }),
  z.object({
    action: z.literal("period"),
    data: z
      .object({ starts_on: day, ends_on: day })
      .refine((v) => v.ends_on >= v.starts_on, "End must follow start"),
  }),
  z.object({ action: z.literal("submit_time"), data: z.object({}) }),
  z.object({
    action: z.literal("approve_time"),
    data: z.object({ staff_id: uuid }),
  }),
  z.object({ action: z.literal("close_period"), data: z.object({}) }),
  z.object({
    action: z.literal("correction"),
    data: z
      .object({
        entry_id: uuid.nullable(),
        starts_at: instant,
        ends_at: instant,
        reason: text(1000),
      })
      .refine((v) => v.ends_at > v.starts_at, "End must follow start"),
  }),
  z.object({
    action: z.literal("resolve_correction"),
    data: z.object({ decision: z.enum(["APPROVED", "DENIED"]) }),
  }),
  z.object({ action: z.literal("review_clock"), data: z.object({}) }),
]);
export interface AttendanceRow {
  staffId: string;
  shiftId: string;
  scheduled: string;
  actual: string | null;
  lateMinutes: number | null;
  excused: boolean;
}
export function attendance(data: Workforce, now: number): AttendanceRow[] {
  return data.shifts
    .filter((s) => !s.cancelled && Date.parse(s.starts_at) <= now)
    .map((s) => {
      const localDay = denverLocal(new Date(s.starts_at)).slice(0, 10);
      const excused =
        data.holidays.some((h) => h.day === localDay && h.closed) ||
        data.off.some(
          (o) =>
            o.staff_id === s.staff_id &&
            o.starts_on <= localDay &&
            o.ends_on >= localDay,
        );
      // A punch must belong to the scheduled interval (allow early starts up to four hours).
      const actual =
        data.entries
          .filter(
            (e) =>
              e.staff_id === s.staff_id &&
              Date.parse(e.clock_in_at) >=
                Date.parse(s.starts_at) - 4 * 3600000 &&
              Date.parse(e.clock_in_at) < Date.parse(s.ends_at) &&
              (e.clock_out_at === null ||
                Date.parse(e.clock_out_at) > Date.parse(s.starts_at)),
          )
          .sort((a, b) => a.clock_in_at.localeCompare(b.clock_in_at))[0]
          ?.clock_in_at ?? null;
      return {
        staffId: s.staff_id,
        shiftId: s.id,
        scheduled: s.starts_at,
        actual,
        excused,
        lateMinutes:
          excused || data.settings.late_grace_minutes === null
            ? null
            : actual
              ? Math.max(
                  0,
                  Math.floor(
                    (Date.parse(actual) - Date.parse(s.starts_at)) / 60000,
                  ) - data.settings.late_grace_minutes,
                )
              : null,
      };
    });
}
export interface TimeTotal {
  staffId: string;
  regular: number;
  overtime: number;
  open: boolean;
}
/** Split at clinic midnights; daily overtime is excluded before weekly overtime to avoid double counting. */
export function timeTotals(
  entries: WorkEntry[],
  settings: Workforce["settings"],
  from: string,
  until: string,
): TimeTotal[] {
  if (settings.workweek_start === null || settings.weekly_hours === null)
    throw new Error("Set workweek and overtime rules first.");
  const days = new Map<string, Map<string, number>>();
  const open = new Set<string>();
  const lower = Date.parse(denverInstant(`${from}T00:00`)),
    upper = Date.parse(denverInstant(`${shiftDay(until, 1)}T00:00`));
  for (const e of entries) {
    if (!e.clock_out_at) {
      open.add(e.staff_id);
      continue;
    }
    let start = Math.max(lower, Date.parse(e.clock_in_at));
    const end = Math.min(upper, Date.parse(e.clock_out_at));
    while (start < end) {
      const date = denverLocal(new Date(start)).slice(0, 10);
      const edge = Math.min(
        end,
        Date.parse(denverInstant(`${shiftDay(date, 1)}T00:00`)),
      );
      const staff = days.get(e.staff_id) ?? new Map<string, number>();
      staff.set(date, (staff.get(date) ?? 0) + (edge - start) / 3600000);
      days.set(e.staff_id, staff);
      start = edge;
    }
  }
  return [...new Set([...days.keys(), ...open])].map((staffId) => {
    let regular = 0,
      overtime = 0;
    const weeks = new Map<string, number>();
    for (const [date, hours] of days.get(staffId) ?? []) {
      const dailyOt =
        settings.daily_hours === null
          ? 0
          : Math.max(0, hours - settings.daily_hours);
      overtime += dailyOt;
      const weekday = new Date(`${date}T12:00Z`).getUTCDay();
      const week = shiftDay(
        date,
        -((weekday - settings.workweek_start! + 7) % 7),
      );
      weeks.set(week, (weeks.get(week) ?? 0) + hours - dailyOt);
    }
    for (const hours of weeks.values()) {
      regular += Math.min(hours, settings.weekly_hours!);
      overtime += Math.max(0, hours - settings.weekly_hours!);
    }
    return { staffId, regular, overtime, open: open.has(staffId) };
  });
}
