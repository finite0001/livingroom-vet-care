import { denverLocal } from "./time.ts";

export const practiceBaseAddress = "2619 Spruce Street, Boulder, CO";
const minuteMs = 60_000;
const plannedStartMinute = 9 * 60;
const plannedEndMinute = 17 * 60;
const plannedOperatingWeekdays = new Set([1, 2, 3, 4, 5, 6]);

export interface RouteAppointment {
  id: string;
  assigned_dvm_id: string | null;
  scheduled_at: string;
  status: string;
  visit_type: string;
  address_snapshot: string;
  duration_minutes: number;
  travel_before_minutes: number;
  travel_after_minutes: number;
  profiles?: { full_name: string | null } | null;
  pets?: { name: string | null } | null;
  clients?: { full_name: string | null } | null;
}

export function isPlannedVisit(row: RouteAppointment): boolean {
  return row.status === "SCHEDULED" || row.status === "CONFIRMED";
}

/**
 * Address worth showing on a card: hides empty values and the clinic's own
 * base address (clinic visits repeat it on every row, which reads as noise).
 */
export function visitAddress(address: string | null | undefined): string | null {
  const value = (address ?? "").trim();
  if (!value || value === practiceBaseAddress) return null;
  return value;
}

export function dayRouteAppointments(rows: readonly RouteAppointment[], day: string, staffId: string): RouteAppointment[] {
  if (!staffId) return [];
  return rows.filter(row => isPlannedVisit(row) && row.assigned_dvm_id === staffId &&
    denverLocal(row.scheduled_at).slice(0, 10) === day)
    .sort((a, b) => Date.parse(a.scheduled_at) - Date.parse(b.scheduled_at) || a.id.localeCompare(b.id));
}

export function drivingDirections(origin: string, destination: string): string | null {
  if (!origin.trim() || !destination.trim()) return null;
  const url = new URL("https://www.google.com/maps/dir/");
  url.search = new URLSearchParams({ api: "1", origin, destination, travelmode: "driving" }).toString();
  return url.href.length <= 2048 ? url.href : null;
}

export interface RouteLeg {
  origin: string;
  destination: string;
  appointment: RouteAppointment | null;
  url: string | null;
}

export interface RouteTiming {
  appointment: RouteAppointment;
  busyStart: string;
  visitStart: string;
  visitEnd: string;
  busyEnd: string;
  busyStartLabel: string;
  visitStartLabel: string;
  visitEndLabel: string;
  busyEndLabel: string;
  gapAfterMinutes: number | null;
  plannedHoursIssue: string | null;
}

export function routeLegs(appointments: readonly RouteAppointment[]): RouteLeg[] {
  if (!appointments.length) return [];
  const stops = [...appointments.map(appointment => ({ appointment, address: appointment.address_snapshot })),
    { appointment: null, address: practiceBaseAddress }];
  return stops.map((stop, index) => {
    const origin = index === 0 ? practiceBaseAddress : stops[index - 1].address;
    return { origin, destination: stop.address, appointment: stop.appointment,
      url: drivingDirections(origin, stop.address) };
  });
}

export function routeTimings(appointments: readonly RouteAppointment[]): RouteTiming[] {
  return appointments.map((appointment, index) => {
    const visitStartMs = Date.parse(appointment.scheduled_at);
    const visitEndMs = visitStartMs + appointment.duration_minutes * minuteMs;
    const busyStartMs = visitStartMs - appointment.travel_before_minutes * minuteMs;
    const busyEndMs = visitEndMs + appointment.travel_after_minutes * minuteMs;
    const next = appointments[index + 1];
    const nextBusyStartMs = next
      ? Date.parse(next.scheduled_at) - next.travel_before_minutes * minuteMs
      : null;
    return {
      appointment,
      busyStart: new Date(busyStartMs).toISOString(),
      visitStart: new Date(visitStartMs).toISOString(),
      visitEnd: new Date(visitEndMs).toISOString(),
      busyEnd: new Date(busyEndMs).toISOString(),
      busyStartLabel: denverLocal(new Date(busyStartMs)).slice(11),
      visitStartLabel: denverLocal(new Date(visitStartMs)).slice(11),
      visitEndLabel: denverLocal(new Date(visitEndMs)).slice(11),
      busyEndLabel: denverLocal(new Date(busyEndMs)).slice(11),
      gapAfterMinutes: nextBusyStartMs === null ? null : Math.round((nextBusyStartMs - busyEndMs) / minuteMs),
      plannedHoursIssue: plannedHoursIssue(appointment, visitEndMs),
    };
  });
}

export function formatRouteGap(minutes: number): string {
  if (minutes < 0) return `Busy windows overlap by ${Math.abs(minutes)} minute(s); review the schedule before departure.`;
  if (minutes === 0) return "No unscheduled gap before the next stop.";
  return `${minutes} minute(s) open before the next busy window.`;
}

function plannedHoursIssue(appointment: RouteAppointment, visitEndMs: number): string | null {
  const startLocal = denverLocal(appointment.scheduled_at);
  const endLocal = denverLocal(new Date(visitEndMs));
  const startDay = startLocal.slice(0, 10);
  const endDay = endLocal.slice(0, 10);
  if (!plannedOperatingWeekdays.has(weekdayForLocalDay(startDay)))
    return "Outside planned Monday–Saturday operating days; confirm this is an approved schedule exception.";
  const startMinute = localMinute(startLocal);
  const endMinute = localMinute(endLocal);
  if (startDay !== endDay || startMinute < plannedStartMinute || endMinute > plannedEndMinute)
    return "Outside planned 9 am–5 pm Mountain Time; confirm this is an approved schedule exception.";
  return null;
}

function weekdayForLocalDay(day: string): number {
  return new Date(`${day}T12:00:00Z`).getUTCDay();
}

function localMinute(local: string): number {
  return Number(local.slice(11, 13)) * 60 + Number(local.slice(14, 16));
}
