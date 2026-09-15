import { useState } from "react";
import { Label } from "@/components/ui/label";
import { denverLocal } from "./time";
import { dayRouteAppointments, isPlannedVisit, practiceBaseAddress, routeLegs } from "./housecall-route";
import type { RouteAppointment } from "./housecall-route";

interface HousecallDayRouteProps {
  day: string;
  appointments: RouteAppointment[];
  refreshing: boolean;
}

export function HousecallDayRoute({ day, appointments, refreshing }: HousecallDayRouteProps) {
  const [staffId, setStaffId] = useState("");
  const housecalls = appointments.filter(row => isPlannedVisit(row) && row.visit_type === "housecall");
  if (!housecalls.length) return null;
  const staff = [...new Map(housecalls.filter(row => row.assigned_dvm_id).map(row => [row.assigned_dvm_id!,
    { id: row.assigned_dvm_id!, name: row.profiles?.full_name || "Staff name unavailable" }])).values()];
  const selected = staff.some(person => person.id === staffId) ? staffId : "";
  const stops = dayRouteAppointments(appointments, day, selected);
  const legs = routeLegs(stops);
  const missingAddress = stops.some(stop => !stop.address_snapshot.trim());
  const unassigned = housecalls.filter(row => !row.assigned_dvm_id).length;
  return (
    <details className="mt-4 rounded-md border bg-muted/30 p-3">
      <summary className="cursor-pointer font-medium">Plan housecall route</summary>
      <section aria-label={`Housecall route ${day}`} className="mt-3 space-y-3">
        {refreshing && <p role="status">Refreshing schedule… Directions are temporarily unavailable.</p>}
        <p className="text-sm">Start and finish: {practiceBaseAddress}</p>
        <p className="text-sm text-muted-foreground">
          Booked and confirmed visits in appointment order, including clinic
          stops. Travel times are not calculated; check directions and your
          scheduled travel buffers before departure.
        </p>
        {unassigned > 0 && <p role="status" className="text-sm">{unassigned} housecall(s) need an assigned staff member before routing.</p>}
        <Label htmlFor={`route-staff-${day}`}>Route staff for {day}</Label>
        <select id={`route-staff-${day}`} value={selected} disabled={refreshing}
          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          onChange={event => setStaffId(event.target.value)}>
          <option value="">Choose assigned staff</option>
          {staff.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}
        </select>
        {selected && <>
          <p className="text-sm">{stops.length} scheduled stop(s) · {day} · America/Denver</p>
          <p className="text-sm text-muted-foreground">Opening directions shares the two leg addresses with Google Maps. Patient names and clinical details are not included in the link.</p>
          {missingAddress && <p role="alert">Complete every visit address before opening this route.</p>}
          <ol className="space-y-3">
            {legs.map((leg, index) => <li key={leg.appointment?.id || "return"} className="space-y-1 border-t pt-3 text-sm">
              <p className="font-medium">{leg.appointment
                ? `${index + 1}. ${denverLocal(leg.appointment.scheduled_at).slice(11)} · ${leg.appointment.pets?.name || "Patient unavailable"} · ${leg.appointment.visit_type}`
                : "Return to clinic"}</p>
              {leg.appointment && <p>{leg.appointment.clients?.full_name} · {leg.appointment.duration_minutes} minutes · Travel buffers: {leg.appointment.travel_before_minutes} before / {leg.appointment.travel_after_minutes} after</p>}
              <p className="break-words">From: {leg.origin || "Address missing"}</p>
              <p className="break-words">To: {leg.destination || "Address missing"}</p>
              {!missingAddress && !refreshing && (leg.url
                ? <a className="inline-block py-2 text-primary underline" href={leg.url} target="_blank" rel="noopener noreferrer">
                  {leg.appointment ? `Directions to stop ${index + 1}` : "Directions back to clinic"}
                </a>
                : <p>These addresses exceed the directions-link limit. Enter the saved addresses in Maps manually.</p>)}
            </li>)}
          </ol>
        </>}
      </section>
    </details>
  );
}
