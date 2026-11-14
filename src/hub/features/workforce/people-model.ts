import { z } from "zod";
const uuid = z.string().uuid(),
  day = z.iso.date(),
  instant = z.iso.datetime({ offset: true });
const clean = (max: number) => z.string().trim().min(1).max(max);
export const payRateSchema = z.object({
  id: uuid,
  staff_id: uuid,
  effective_on: day,
  amount_cents: z.number().int(),
  basis: z.enum(["HOURLY", "ANNUAL_SALARY"]),
  reason: z.string(),
});
export const bonusSchema = z.object({
  id: uuid,
  staff_id: uuid,
  period_id: uuid,
  amount_cents: z.number().int(),
  reason: z.string(),
});
export const payrollSchema = z.object({
  period: z.object({
    id: uuid,
    starts_on: day,
    ends_on: day,
    state: z.literal("CLOSED"),
  }),
  staff: z.array(z.object({ id: uuid, name: z.string() })),
  time: z.array(
    z.object({
      staff_id: uuid,
      day,
      hours: z.number(),
      regular_hours: z.number(),
      overtime_hours: z.number(),
      rate: payRateSchema.nullable(),
    }),
  ),
  leave: z.array(
    z.object({
      staff_id: uuid,
      kind: z.string(),
      hours: z.number(),
      starts_on: day,
      ends_on: day,
    }),
  ),
  bonuses: z.array(bonusSchema),
  generated_at: instant,
});
export interface Payroll extends z.infer<typeof payrollSchema> {}
export const peopleSchema = z.object({
  can_pay: z.boolean(),
  staff: z.array(z.object({ id: uuid, name: z.string() })),
  rates: z.array(payRateSchema),
  bonuses: z.array(bonusSchema),
  benefits: z.array(
    z.object({
      id: uuid,
      staff_id: uuid,
      title: z.string(),
      provider: z.string(),
      form_version: z.string(),
      form_url: z.url().startsWith("https://"),
      due_on: day,
      object_path: z.string(),
      completed_at: instant.nullable(),
    }),
  ),
  periods: z.array(
    z.object({
      id: uuid,
      starts_on: day,
      ends_on: day,
      state: z.enum(["OPEN", "CLOSED"]),
      exported: z.boolean(),
    }),
  ),
  cycles: z.array(
    z.object({
      id: uuid,
      target_id: uuid,
      title: z.string(),
      ends_at: instant,
      closed: z.boolean(),
      min_responses: z.number(),
      submitted: z.boolean(),
      eligible: z.boolean(),
    }),
  ),
  results: z.array(
    z.object({
      cycle_id: uuid,
      count: z.number(),
      average: z.number().nullable(),
      comments: z.array(z.string()),
    }),
  ),
});
export const peopleCommandSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("rate"),
    data: z.object({
      staff_id: uuid,
      effective_on: day,
      amount_cents: z.number().int().positive().max(2147483647),
      basis: z.enum(["HOURLY", "ANNUAL_SALARY"]),
      reason: clean(1000),
    }),
  }),
  z.object({
    action: z.literal("bonus"),
    data: z.object({
      staff_id: uuid,
      period_id: uuid,
      amount_cents: z.number().int().positive().max(2147483647),
      reason: clean(1000),
    }),
  }),
  z.object({ action: z.literal("payroll"), data: z.object({}) }),
  z.object({
    action: z.literal("benefit"),
    data: z.object({
      staff_id: uuid,
      title: clean(200),
      provider: clean(150),
      form_version: clean(150),
      form_url: z.url().startsWith("https://").max(2000),
      due_on: day,
    }),
  }),
  z.object({ action: z.literal("complete_benefit"), data: z.object({}) }),
  z.object({
    action: z.literal("review_cycle"),
    data: z.object({
      target_id: uuid,
      title: clean(200),
      ends_at: instant,
      min_responses: z.number().int().min(3).max(100),
      reviewers: z.array(uuid).min(3).max(100),
    }),
  }),
  z.object({
    action: z.literal("submit_review"),
    data: z.object({
      score: z.number().int().min(1).max(5),
      comment: z.string().max(2000),
    }),
  }),
  z.object({ action: z.literal("close_review"), data: z.object({}) }),
]);
/** Escape both CSV delimiters and spreadsheet formula prefixes in user-authored text. */
export function csvCell(value: string | number | null): string {
  if (typeof value === "number") return String(value);
  const text = value ?? "";
  return `"${(/^[\s]*[-=+@]/.test(text) ? "'" + text : text).replace(/"/g, '""')}"`;
}
export function payrollCsv(payroll: Payroll): string {
  const names = new Map(payroll.staff.map((s) => [s.id, s.name]));
  const rows: (string | number | null)[][] = [
    [
      "Type",
      "Employee ID",
      "Employee",
      "Date / period",
      "Regular hours",
      "Overtime hours",
      "Leave hours",
      "Rate USD",
      "Rate basis",
      "Bonus USD",
      "Note",
    ],
  ];
  for (const line of payroll.time)
    rows.push([
      "TIME",
      line.staff_id,
      names.get(line.staff_id) ?? "Staff",
      line.day,
      line.regular_hours,
      line.overtime_hours,
      null,
      line.rate ? line.rate.amount_cents / 100 : null,
      line.rate?.basis ?? null,
      null,
      "Hours only; payroll provider calculates wages, deductions and taxes",
    ]);
  for (const line of payroll.leave)
    rows.push([
      line.kind,
      line.staff_id,
      names.get(line.staff_id) ?? "Staff",
      `${line.starts_on}/${line.ends_on}`,
      null,
      null,
      line.hours,
      null,
      null,
      null,
      "Apply approved paid-leave eligibility in payroll provider",
    ]);
  for (const bonus of payroll.bonuses)
    rows.push([
      "BONUS",
      bonus.staff_id,
      names.get(bonus.staff_id) ?? "Staff",
      payroll.period.id,
      null,
      null,
      null,
      null,
      null,
      bonus.amount_cents / 100,
      bonus.reason,
    ]);
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}

export function dollarsToCents(value: string | boolean): number {
  const parsed = z
    .string()
    .regex(
      /^\d+(\.\d{1,2})?$/,
      "Use a USD amount with at most two decimal places",
    )
    .parse(value);
  const [whole, fraction = ""] = parsed.split(".");
  return z
    .number()
    .int()
    .positive()
    .max(2147483647)
    .parse(Number(whole) * 100 + Number(fraction.padEnd(2, "0")));
}
