import { z } from "zod";

/**
 * Display policy for the per-patient vaccine status summary.
 *
 * Precedence (enforced server-side by patient_vaccine_status_summary):
 *  1. a CURRENT reviewed patient due plan supplies the due date;
 *  2. otherwise the latest uncorrected administration's recorded next due date,
 *     labelled with its source (practice, historical entry, reviewed outside record);
 *  3. otherwise there is no due date. Proposed plans never supply a date.
 *
 * The "due soon" window is display-only. The built-in default below is a
 * placeholder pending clinical review by Dr. Edler; administrators may set the
 * practice value (app_settings.vaccine_due_soon_days, 1–365 days).
 */
export const DUE_SOON_SETTING_KEY = "vaccine_due_soon_days";
export const DEFAULT_DUE_SOON_DAYS = 30;
export const DUE_SOON_DEFAULT_REVIEW_NOTE =
  "Display default pending clinical review — not a clinical rule.";

const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => isCalendarDate(value), "Use a real calendar date");
const recordSource = z.enum([
  "practice_administration",
  "historical_record",
  "outside_record",
]);
export const vaccineStatusGroupSchema = z.object({
  group_key: z.string().min(1),
  group_name: z.string().min(1),
  group_source: z.enum(["due_template", "catalog_profile", "product"]),
  last_given_on: calendarDate.nullable(),
  last_given_source: z
    .union([recordSource, z.literal("due_plan_anchor")])
    .nullable(),
  last_record_id: z.string().uuid().nullable(),
  last_product_name: z.string().nullable(),
  due_on: calendarDate.nullable(),
  due_source: z.union([recordSource, z.literal("reviewed_due_plan")]).nullable(),
  record_count: z.number().int().nonnegative(),
  plan: z
    .object({
      id: z.string().uuid(),
      version: z.number().int().positive(),
      status: z.enum(["current", "proposed"]),
      current_due_on: calendarDate,
      last_administered_on: calendarDate,
    })
    .nullable(),
  flags: z.array(
    z.enum(["plan_awaiting_review", "administration_after_plan_anchor"]),
  ),
});
export const vaccineStatusSummarySchema = z.object({
  pet_id: z.string().uuid(),
  as_of: calendarDate,
  groups: z.array(vaccineStatusGroupSchema).max(500),
});
export type VaccineStatusGroup = z.infer<typeof vaccineStatusGroupSchema>;
export type VaccineStatusSummary = z.infer<typeof vaccineStatusSummarySchema>;
export type VaccineDueState = "overdue" | "due_soon" | "current" | "no_due_date";

export function parseVaccineStatusSummary(
  value: unknown,
  petId: string,
): VaccineStatusSummary {
  const summary = vaccineStatusSummarySchema.parse(value);
  if (summary.pet_id !== petId)
    throw new Error("Vaccine status belongs to a different patient.");
  return summary;
}

export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

/** Whole calendar days from `from` to `to` (both YYYY-MM-DD). */
export function daysBetween(from: string, to: string): number {
  if (!isCalendarDate(from) || !isCalendarDate(to))
    throw new Error("Use real calendar dates.");
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      86_400_000,
  );
}

export function addDays(date: string, days: number): string {
  if (!isCalendarDate(date) || !Number.isInteger(days))
    throw new Error("Use a real calendar date and whole days.");
  const next = new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000);
  return next.toISOString().slice(0, 10);
}

/** Parses the stored practice setting; anything invalid falls back to the display default. */
export function dueSoonWindow(stored: string | null | undefined): {
  days: number;
  configured: boolean;
} {
  if (stored && /^[1-9]\d{0,2}$/.test(stored) && Number(stored) <= 365)
    return { days: Number(stored), configured: true };
  return { days: DEFAULT_DUE_SOON_DAYS, configured: false };
}

export function validateDueSoonDays(value: string): string {
  const trimmed = value.trim();
  if (!/^[1-9]\d{0,2}$/.test(trimmed) || Number(trimmed) > 365)
    throw new Error("Enter a whole number of days from 1 to 365.");
  return trimmed;
}

/** Due today counts as due soon; the day after the due date is overdue. */
export function vaccineDueState(
  dueOn: string | null,
  today: string,
  windowDays: number,
): VaccineDueState {
  if (!dueOn) return "no_due_date";
  const remaining = daysBetween(today, dueOn);
  if (remaining < 0) return "overdue";
  if (remaining <= windowDays) return "due_soon";
  return "current";
}

const stateRank: Record<VaccineDueState, number> = {
  overdue: 0,
  due_soon: 1,
  no_due_date: 2,
  current: 3,
};
export interface VaccineStatusRow extends VaccineStatusGroup {
  state: VaccineDueState;
  days_until_due: number | null;
}
/** Most urgent first; ties by due date, then name. */
export function vaccineStatusRows(
  summary: VaccineStatusSummary,
  windowDays: number,
): VaccineStatusRow[] {
  return summary.groups
    .map((group) => ({
      ...group,
      state: vaccineDueState(group.due_on, summary.as_of, windowDays),
      days_until_due: group.due_on
        ? daysBetween(summary.as_of, group.due_on)
        : null,
    }))
    .sort(
      (a, b) =>
        stateRank[a.state] - stateRank[b.state] ||
        (a.due_on ?? "9999-12-31").localeCompare(b.due_on ?? "9999-12-31") ||
        a.group_name.localeCompare(b.group_name) ||
        a.group_key.localeCompare(b.group_key),
    );
}

export const dueStateLabel: Record<VaccineDueState, string> = {
  overdue: "Overdue",
  due_soon: "Due soon",
  current: "Current",
  no_due_date: "No due date",
};

export const sourceLabel: Record<
  NonNullable<VaccineStatusGroup["due_source"] | VaccineStatusGroup["last_given_source"]>,
  string
> = {
  reviewed_due_plan: "Reviewed due plan",
  practice_administration: "Recorded at administration",
  historical_record: "Historical record entry",
  outside_record: "Reviewed outside record (ezyVet)",
  due_plan_anchor: "Due plan anchor",
};

export const flagLabel: Record<VaccineStatusGroup["flags"][number], string> = {
  plan_awaiting_review:
    "Due plan awaiting review — date shown is from the latest record, not a reviewed plan.",
  administration_after_plan_anchor:
    "A newer administration was recorded after the plan anchor — review the due plan.",
};

export function dueDescription(row: VaccineStatusRow): string {
  if (row.days_until_due === null) return "No due date recorded";
  if (row.days_until_due === 0) return "Due today";
  if (row.days_until_due < 0)
    return `${-row.days_until_due} day${row.days_until_due === -1 ? "" : "s"} overdue`;
  return `In ${row.days_until_due} day${row.days_until_due === 1 ? "" : "s"}`;
}

/**
 * Suggests a next due date from a catalog default interval. The caller must
 * show it to the clinician as an editable suggestion; it is never saved
 * without an explicit action.
 */
export function suggestedDueDate(
  administeredLocal: string,
  intervalDays: number | null | undefined,
): string | null {
  if (!intervalDays || !Number.isInteger(intervalDays) || intervalDays < 1)
    return null;
  const date = administeredLocal.slice(0, 10);
  if (!isCalendarDate(date)) return null;
  return addDays(date, intervalDays);
}

export interface VaccineProfileInput {
  group_key: string;
  species: string;
  vaccine_type: string;
  labeled_duration: string;
  default_booster_interval_days: string;
  review_note: string;
}
export const labeledDurations = [
  "1 year",
  "3 years",
  "other licensed duration",
] as const;
/** Mirrors save_catalog_vaccine_profile validation so staff see errors before submitting. */
export function vaccineProfileArgs(input: VaccineProfileInput) {
  const group = input.group_key.trim().toLowerCase();
  if (group && !/^[a-z0-9][a-z0-9_-]{0,79}$/.test(group))
    throw new Error(
      "Vaccine group key uses lowercase letters, digits, hyphen or underscore.",
    );
  const species = [
    ...new Set(
      input.species
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    ),
  ].sort();
  if (species.length > 10 || species.some((s) => s.length > 80))
    throw new Error("List up to 10 species labels of 1-80 characters.");
  const type = input.vaccine_type.trim();
  if (type.length > 200) throw new Error("Vaccine type is too long.");
  const duration = input.labeled_duration.trim();
  if (duration && !(labeledDurations as readonly string[]).includes(duration))
    throw new Error("Labeled duration must match the product label choices.");
  const intervalText = input.default_booster_interval_days.trim();
  let interval: number | null = null;
  if (intervalText) {
    if (!/^\d+$/.test(intervalText)) throw new Error("Booster interval must be whole days.");
    interval = Number(intervalText);
    if (interval < 1 || interval > 36500)
      throw new Error("Booster interval must be between 1 and 36500 days.");
  }
  const note = input.review_note.trim();
  if (!note || note.length > 2000)
    throw new Error("Record the label source or reviewer for this metadata.");
  return {
    p_group_key: group || null,
    p_species: species,
    p_vaccine_type: type || null,
    p_labeled_duration: duration || null,
    p_default_booster_interval_days: interval,
    p_review_note: note,
  };
}
