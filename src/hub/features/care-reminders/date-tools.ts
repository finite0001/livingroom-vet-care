export function addCareDays(anchor: string, days: number): string {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(anchor) ||
    !Number.isInteger(days) ||
    days < 1 ||
    days > 36500
  )
    throw new Error(
      "Review a valid anchor date and whole interval from 1 to 36,500 days.",
    );
  const date = new Date(`${anchor}T12:00:00Z`);
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== anchor
  )
    throw new Error("Invalid anchor date.");
  date.setUTCDate(date.getUTCDate() + days);
  if (date.getUTCFullYear() > 9999)
    throw new Error("Due date exceeds the supported date range.");
  return date.toISOString().slice(0, 10);
}
export function denverCalendarDay(instant: Date | string = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Denver",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(instant));
  const part = (name: string) => parts.find((p) => p.type === name)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
