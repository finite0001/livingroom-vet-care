export const practiceTimezone = "America/Denver";
export function denverLocal(instant: string | Date): string {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: practiceTimezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(instant));
  const part = (kind: string) => parts.find((p) => p.type === kind)?.value;
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

/** Big 12-hour clock label ("9:30 AM") in the practice timezone. */
export function formatDenverTime(instant: string | Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: practiceTimezone,
    hour: "numeric",
    minute: "2-digit",
  }).formatToParts(new Date(instant));
  const part = (kind: string) =>
    parts.find((p) => p.type === kind)?.value ?? "";
  return `${part("hour")}:${part("minute")} ${part("dayPeriod")}`;
}

/** Human day label for a YYYY-MM-DD practice day ("Wednesday, September 23"). */
export function formatDenverDayLabel(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date(Date.UTC(year, month - 1, date)));
}
/** Reject skipped and repeated wall-clock times rather than silently shifting an appointment. */
export function denverInstant(local: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local))
    throw new Error("Choose a valid date and time.");
  const wall = Date.parse(`${local}:00Z`);
  const candidates = [6, 7]
    .map((offset) => new Date(wall + offset * 3600000))
    .filter(
      (date) => Number.isFinite(date.getTime()) && denverLocal(date) === local,
    );
  if (candidates.length !== 1)
    throw new Error(
      candidates.length
        ? "This time occurs twice when daylight saving ends. Choose a time outside the repeated hour."
        : "This local time does not exist. Choose another time.",
    );
  return candidates[0].toISOString();
}
export function shiftDay(day: string, offset: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}
export function reminderOffsets(value: string): number[] {
  if (!value.trim()) return [];
  const values = value.split(",").map((item) => Number(item.trim()));
  if (
    values.length > 5 ||
    values.some((n) => !Number.isInteger(n) || n < 1 || n > 720) ||
    new Set(values).size !== values.length
  )
    throw new Error("Use up to five different whole hours, between 1 and 720.");
  return values;
}
