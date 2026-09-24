import { denverLocal } from "./time.ts";

export const practiceBaseAddress = "2619 Spruce Street, Boulder, CO";

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
