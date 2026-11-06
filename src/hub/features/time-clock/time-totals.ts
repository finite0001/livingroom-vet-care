import { denverInstant, denverLocal } from "../scheduling/time.ts";

export interface ShiftInterval {
  clock_in_at: string;
  clock_out_at: string | null;
}

/** Count only elapsed work inside the reporting interval, including overnight shifts. */
export function shiftOverlapSeconds(entry: ShiftInterval, from: number, until: number): number {
  const start = Math.max(Date.parse(entry.clock_in_at), from);
  const end = Math.min(entry.clock_out_at ? Date.parse(entry.clock_out_at) : until, until);
  return Number.isFinite(start) && Number.isFinite(end)
    ? Math.max(0, Math.floor((end - start) / 1000))
    : 0;
}

export function timeClockTotals(entries: readonly ShiftInterval[], now: number) {
  const day = denverLocal(new Date(now)).slice(0, 10);
  const midnight = Date.parse(denverInstant(`${day}T00:00`));
  const weekStart = now - 7 * 86_400_000;
  return entries.reduce((total, entry) => ({
    today: total.today + shiftOverlapSeconds(entry, midnight, now),
    week: total.week + shiftOverlapSeconds(entry, weekStart, now),
  }), { today: 0, week: 0 });
}
