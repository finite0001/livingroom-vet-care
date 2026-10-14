import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { usePageTitle } from "@/hooks/use-page-title";
import {
  denverLocal,
  formatDenverDayLabel,
  formatDenverTime,
  shiftDay,
} from "./time";
import type { Tables } from "@/integrations/supabase/types";
import { HousecallDayRoute } from "./HousecallDayRoute";
import {
  drivingDirections,
  practiceBaseAddress,
  visitAddress,
} from "./housecall-route";
import { useScheduleDay } from "./use-schedule-day";
import { useAppointmentStatus } from "./use-appointment-status";
import { StatusChip } from "@/hub/components/shared/StatusChip";
import { cn } from "@/lib/utils";
import { householdHref, patientHref } from "@/hub/features/patient-360/model";
import { AppointmentEditor } from "./AppointmentEditor";
import { NextVisitWorkspace } from "./NextVisitWorkspace";
import type { NextVisitContext } from "./next-visit-model";
type Appointment = Tables<"appointments">;
function visitTypeLabel(visitType: string): string {
  return visitType === "housecall" ? "House call" : "Clinic";
}

/** Morning/Afternoon/Evening grouping for one-glance day reading. */
function dayPart(scheduledAt: string): string {
  const hour = Number(denverLocal(scheduledAt).slice(11, 13));
  if (hour < 12) return "Morning";
  if (hour < 17) return "Afternoon";
  return "Evening";
}

interface ScheduleAppointment extends Tables<"appointments"> {
  pets: { name: string | null; species: string | null } | null;
  clients: { full_name: string | null } | null;
  profiles: { full_name: string | null } | null;
}
interface AppointmentCardProps {
  row: ScheduleAppointment;
  onEdit: () => void;
  onCompleted: (context: NextVisitContext) => void;
}
function AppointmentCard({ row, onEdit, onCompleted }: AppointmentCardProps) {
  const update = useAppointmentStatus({ onCompleted });
  const busy = update.isPending;
  const address = visitAddress(row.address_snapshot);
  const directions = address
    ? drivingDirections(practiceBaseAddress, address)
    : null;
  const subdued =
    row.status === "COMPLETED" ||
    row.status === "CANCELLED" ||
    row.status === "NO_SHOW";
  const staffName =
    row.profiles?.full_name?.trim() ||
    (row.assigned_dvm_id ? `Staff ${row.assigned_dvm_id.slice(0, 8)}` : null);

  return (
    <div
      className={cn(
        "grid items-center gap-3 rounded-2xl border bg-card p-4 shadow-card md:grid-cols-[92px_1fr_auto] md:gap-5 md:px-5",
        row.status === "CONFIRMED" && "border-primary/50",
        subdued && "bg-muted/40 opacity-80",
      )}
    >
      <div className="tabular-nums">
        <p className="text-lg font-bold leading-none text-foreground">
          {formatDenverTime(row.scheduled_at)}
        </p>
        <p className="mt-1.5 text-xs text-muted-foreground">
          {row.duration_minutes} min · {visitTypeLabel(row.visit_type)}
        </p>
      </div>
      <div className="min-w-0">
        <p className="truncate font-semibold text-foreground">
          {row.pet_id ? (
            <Link
              className="underline-offset-2 hover:underline"
              to={patientHref(row.pet_id)}
            >
              {row.pets?.name ?? "Patient record"}
            </Link>
          ) : (
            "Patient unavailable"
          )}
          <span className="font-normal text-muted-foreground">
            {" "}
            — {row.appointment_type}
          </span>
        </p>
        <p className="truncate text-sm text-muted-foreground">
          {row.clients?.full_name && (
            <Link
              className="underline-offset-2 hover:text-foreground hover:underline"
              to={householdHref(row.client_id)}
            >
              {row.clients.full_name}
            </Link>
          )}
          {row.clients?.full_name && staffName ? " · " : ""}
          {staffName}
        </p>
        {address && (
          <p className="truncate text-sm text-muted-foreground">
            {address}
            {directions && (
              <>
                {" · "}
                <a
                  className="font-medium text-terracotta-dark underline-offset-2 hover:underline"
                  href={directions}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Get directions
                </a>
              </>
            )}
          </p>
        )}
        <div className="mt-2 flex items-center gap-2">
          <StatusChip status={row.status} />
          {row.status === "COMPLETED" && (
            <span className="text-xs text-muted-foreground">
              This visit is done
            </span>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 md:justify-end">
        {row.status === "SCHEDULED" && (
          <Button
            size="sm"
            variant="outline"
            className="guided-touch"
            disabled={busy}
            onClick={() =>
              update.mutate({ appointment: row, status: "CONFIRMED" })
            }
          >
            Check in
          </Button>
        )}
        {row.status === "CONFIRMED" && (
          <Button
            size="sm"
            className="guided-touch"
            disabled={busy}
            onClick={() =>
              update.mutate({ appointment: row, status: "COMPLETED" })
            }
          >
            Complete
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onEdit}>
          Edit
        </Button>
      </div>
    </div>
  );
}

const CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function SchedulePage() {
  usePageTitle("Schedule");
  // Deep links from the patient/household 360: ?date=YYYY-MM-DD opens that day;
  // ?book=1&client=<id>&pet=<id> opens the booking form prefilled.
  const [searchParams, setSearchParams] = useSearchParams();
  const linkedDay = searchParams.get("date");
  const [booking] = useState(() => {
    const client = searchParams.get("client");
    const pet = searchParams.get("pet");
    return searchParams.get("book") === "1"
      ? {
          clientId: client && UUID.test(client) ? client : "",
          petId: pet && UUID.test(pet) ? pet : "",
        }
      : null;
  });
  const [day, setDayState] = useState(() =>
    linkedDay && CALENDAR_DAY.test(linkedDay)
      ? linkedDay
      : denverLocal(new Date()).slice(0, 10),
  );
  // A later ?date link to this already-open page (e.g. from Operations) wins.
  const [seenLinkedDay, setSeenLinkedDay] = useState(linkedDay);
  if (linkedDay !== seenLinkedDay) {
    setSeenLinkedDay(linkedDay);
    if (linkedDay && CALENDAR_DAY.test(linkedDay)) setDayState(linkedDay);
  }
  // Keep ?date in the URL so reload, back-from-a-patient and shared links
  // reopen the same day. Replace, not push: paging days is not navigation.
  const setDay = (next: string) => {
    setDayState(next);
    setSearchParams(
      (previous) => {
        const params = new URLSearchParams(previous);
        params.set("date", next);
        return params;
      },
      { replace: true },
    );
  };
  const [nextVisit, setNextVisit] = useState<NextVisitContext | null>(null);
  const [week, setWeek] = useState(false);
  const [editing, setEditing] = useState<Appointment | null | undefined>(() =>
    booking ? null : undefined,
  );
  const count = week ? 7 : 1;
  const query = useScheduleDay(day, count);
  const today = denverLocal(new Date()).slice(0, 10);
  return (
    <main className="space-y-5 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl md:text-3xl">Schedule</h1>
          <p className="text-sm text-muted-foreground">
            Clinic and house calls · All times America/Denver
          </p>
          <p className="guided-only mt-1 text-sm font-medium text-terracotta-dark">
            Tap Check in when you arrive, Complete when you leave.
          </p>
        </div>
        <Button onClick={() => setEditing(null)}>Book appointment</Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          aria-label="Previous period"
          onClick={() => setDay(shiftDay(day, -count))}
        >
          Previous
        </Button>
        <Input
          className="w-auto"
          aria-label="Schedule date"
          type="date"
          value={day}
          onChange={(event) => {
            if (event.target.value) setDay(event.target.value);
          }}
        />
        <Button variant="outline" onClick={() => setDay(shiftDay(day, count))}>
          Next
        </Button>
        {day !== today && (
          <Button variant="outline" onClick={() => setDay(today)}>
            Today
          </Button>
        )}
        <Button
          variant={week ? "outline" : "default"}
          onClick={() => setWeek(false)}
        >
          Day
        </Button>
        <Button
          variant={week ? "default" : "outline"}
          onClick={() => setWeek(true)}
        >
          Week
        </Button>
        <Button
          variant="outline"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          Refresh schedule
        </Button>
      </div>
      {query.data && query.data.total !== query.data.appointments.length && (
        <p role="alert">
          The schedule may be incomplete. Route planning is unavailable until
          the full period loads. Try Day view or refresh.
        </p>
      )}
      {query.isPending ? (
        <p role="status">Loading schedule…</p>
      ) : query.isError ? (
        <div role="alert">
          Schedule unavailable.{" "}
          <Button onClick={() => void query.refetch()}>Retry</Button>
        </div>
      ) : (
        <div
          className={
            week ? "grid gap-3 md:grid-cols-2 xl:grid-cols-3" : "space-y-8"
          }
        >
          {Array.from({ length: count }, (_, index) => {
            const date = shiftDay(day, index);
            const entries = query.data.appointments.filter((row) =>
              denverLocal(row.scheduled_at).startsWith(date),
            );
            const housecalls = entries.filter(
              (row) => row.visit_type === "housecall",
            ).length;
            if (week) {
              return (
                <section
                  key={date}
                  className="rounded-2xl border bg-card p-4 shadow-card"
                >
                  <h2 className="mb-3 font-semibold">
                    {formatDenverDayLabel(date)}
                  </h2>
                  {!entries.length && (
                    <p className="text-sm text-muted-foreground">
                      No appointments
                    </p>
                  )}
                  <div className="space-y-2">
                    {entries.map((row) => (
                      // The whole card opens the editor; the pet and household
                      // names sit above that button as their own links.
                      <div
                        className="relative w-full rounded-md border bg-card p-3 text-left hover:bg-accent focus-within:ring-2 focus-within:ring-ring"
                        key={row.id}
                      >
                        <button
                          type="button"
                          className="absolute inset-0 rounded-md focus-visible:outline-none"
                          aria-label={`Edit ${formatDenverTime(row.scheduled_at)} ${row.pets?.name ?? "appointment"}`}
                          onClick={() => setEditing(row)}
                        />
                        <p className="pointer-events-none relative font-semibold">
                          {formatDenverTime(row.scheduled_at)} ·{" "}
                          {row.pet_id ? (
                            <Link
                              className="pointer-events-auto underline-offset-2 hover:underline"
                              to={patientHref(row.pet_id)}
                            >
                              {row.pets?.name ?? "Patient record"}
                            </Link>
                          ) : (
                            "Patient unavailable"
                          )}
                        </p>
                        <p className="pointer-events-none relative text-sm">
                          {row.clients?.full_name && (
                            <Link
                              className="pointer-events-auto underline-offset-2 hover:underline"
                              to={householdHref(row.client_id)}
                            >
                              {row.clients.full_name}
                            </Link>
                          )}{" "}
                          · {row.appointment_type}
                        </p>
                        <p className="pointer-events-none relative text-sm">
                          {row.profiles?.full_name?.trim() ||
                            (row.assigned_dvm_id
                              ? `Staff ${row.assigned_dvm_id.slice(0, 8)}`
                              : "Unassigned")}
                        </p>
                        <div className="pointer-events-none relative mt-1 flex items-center gap-2">
                          <StatusChip status={row.status} />
                          <span className="text-sm text-muted-foreground">
                            {row.duration_minutes} min ·{" "}
                            {visitTypeLabel(row.visit_type)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                  {query.data.total === query.data.appointments.length && (
                    <HousecallDayRoute
                      day={date}
                      appointments={entries}
                      refreshing={query.isFetching}
                    />
                  )}
                </section>
              );
            }
            const parts = ["Morning", "Afternoon", "Evening"]
              .map((label) => ({
                label,
                entries: entries.filter(
                  (row) => dayPart(row.scheduled_at) === label,
                ),
              }))
              .filter((part) => part.entries.length > 0);
            return (
              <section key={date} aria-label={formatDenverDayLabel(date)}>
                <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                  <h2 className="font-display text-2xl md:text-3xl">
                    {formatDenverDayLabel(date)}
                  </h2>
                  {date === today && (
                    <span className="rounded-full bg-primary/15 px-3 py-1 text-xs font-semibold text-terracotta-dark">
                      Today
                    </span>
                  )}
                  <p className="text-sm text-muted-foreground">
                    {entries.length
                      ? `${entries.length} ${entries.length === 1 ? "visit" : "visits"} · ${housecalls} house ${housecalls === 1 ? "call" : "calls"}`
                      : "Nothing scheduled"}
                  </p>
                </div>
                {!entries.length && (
                  <p className="mt-3 rounded-2xl border border-dashed bg-card p-6 text-sm text-muted-foreground shadow-card">
                    No appointments this day. Book one with the button above.
                  </p>
                )}
                <div className="mt-4 space-y-6">
                  {parts.map((part) => (
                    <div key={part.label} className="space-y-3">
                      <div className="flex items-center gap-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        <span>{part.label}</span>
                        <span
                          className="h-px flex-1 bg-border"
                          aria-hidden="true"
                        />
                      </div>
                      <div className="space-y-3">
                        {part.entries.map((row) => (
                          <AppointmentCard
                            key={row.id}
                            row={row}
                            onEdit={() => setEditing(row)}
                            onCompleted={setNextVisit}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                {query.data.total === query.data.appointments.length && (
                  <HousecallDayRoute
                    day={date}
                    appointments={entries}
                    refreshing={query.isFetching}
                  />
                )}
              </section>
            );
          })}
        </div>
      )}
      {editing !== undefined && (
        <AppointmentEditor
          onCompleted={setNextVisit}
          appointment={editing}
          initialDay={day}
          initialClientId={editing === null ? booking?.clientId : undefined}
          initialPetId={editing === null ? booking?.petId : undefined}
          close={() => {
            setEditing(undefined);
            if (searchParams.has("book")) {
              setSearchParams(
                (previous) => {
                  const next = new URLSearchParams(previous);
                  next.delete("book");
                  next.delete("client");
                  next.delete("pet");
                  return next;
                },
                { replace: true },
              );
            }
          }}
        />
      )}
      <NextVisitWorkspace context={nextVisit} onContext={setNextVisit} />
    </main>
  );
}
