import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hub/contexts/auth-context";
import { usePatientAlertReview } from "../clinical/alert-review";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { usePageTitle } from "@/hooks/use-page-title";
import { denverInstant, denverLocal, formatDenverDayLabel, formatDenverTime, reminderOffsets, shiftDay } from "./time";
import type { Tables } from "@/integrations/supabase/types";
import { HousecallDayRoute } from "./HousecallDayRoute";
import { drivingDirections, practiceBaseAddress, visitAddress } from "./housecall-route";
import { useScheduleDay } from "./use-schedule-day";
import { useAppointmentStatus } from "./use-appointment-status";
import { StatusChip } from "@/hub/components/shared/StatusChip";
import { cn } from "@/lib/utils";

type Appointment = Tables<"appointments">;
const statusLabels = {
  SCHEDULED: "Booked",
  CONFIRMED: "Confirmed",
  COMPLETED: "Completed",
  CANCELLED: "Canceled",
  NO_SHOW: "No show",
};
const selectClass =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm";
const baseAddress = practiceBaseAddress;

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

function AppointmentCard({
  row,
  onEdit,
}: {
  row: Tables<"appointments"> & {
    pets: { name: string | null; species: string | null } | null;
    clients: { full_name: string | null } | null;
    profiles: { full_name: string | null } | null;
  };
  onEdit: () => void;
}) {
  const update = useAppointmentStatus();
  const busy = update.isPending;
  const address = visitAddress(row.address_snapshot);
  const directions = address
    ? drivingDirections(practiceBaseAddress, address)
    : null;
  const subdued = row.status === "COMPLETED" || row.status === "CANCELLED" || row.status === "NO_SHOW";
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
          {row.pets?.name ?? "Patient unavailable"}
          <span className="font-normal text-muted-foreground">
            {" "}
            — {row.appointment_type}
          </span>
        </p>
        <p className="truncate text-sm text-muted-foreground">
          {[row.clients?.full_name, staffName].filter(Boolean).join(" · ")}
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

export default function SchedulePage() {
  usePageTitle("Schedule");
  const [day, setDay] = useState(() => denverLocal(new Date()).slice(0, 10));
  const [week, setWeek] = useState(false);
  const [editing, setEditing] = useState<Appointment | null | undefined>();
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
        <Button variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}>Refresh schedule</Button>
      </div>
      {query.data && query.data.total !== query.data.appointments.length && (
        <p role="alert">The schedule may be incomplete. Route planning is unavailable until the full period loads. Try Day view or refresh.</p>
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
                <section key={date} className="rounded-2xl border bg-card p-4 shadow-card">
                  <h2 className="mb-3 font-semibold">{formatDenverDayLabel(date)}</h2>
                  {!entries.length && (
                    <p className="text-sm text-muted-foreground">
                      No appointments
                    </p>
                  )}
                  <div className="space-y-2">
                    {entries.map((row) => (
                      <button
                        className="w-full rounded-md border bg-card p-3 text-left hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                        key={row.id}
                        onClick={() => setEditing(row)}
                      >
                        <p className="font-semibold">
                          {formatDenverTime(row.scheduled_at)} ·{" "}
                          {row.pets?.name ?? "Patient unavailable"}
                        </p>
                        <p className="text-sm">
                          {row.clients?.full_name} · {row.appointment_type}
                        </p>
                        <p className="text-sm">
                          {row.profiles?.full_name?.trim() || (row.assigned_dvm_id ? `Staff ${row.assigned_dvm_id.slice(0, 8)}` : "Unassigned")}
                        </p>
                        <div className="mt-1 flex items-center gap-2">
                          <StatusChip status={row.status} />
                          <span className="text-sm text-muted-foreground">
                            {row.duration_minutes} min · {visitTypeLabel(row.visit_type)}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                  {query.data.total === query.data.appointments.length && (
                    <HousecallDayRoute day={date} appointments={entries} refreshing={query.isFetching} />
                  )}
                </section>
              );
            }
            const parts = ["Morning", "Afternoon", "Evening"]
              .map((label) => ({
                label,
                entries: entries.filter((row) => dayPart(row.scheduled_at) === label),
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
                        <span className="h-px flex-1 bg-border" aria-hidden="true" />
                      </div>
                      <div className="space-y-3">
                        {part.entries.map((row) => (
                          <AppointmentCard
                            key={row.id}
                            row={row}
                            onEdit={() => setEditing(row)}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                {query.data.total === query.data.appointments.length && (
                  <HousecallDayRoute day={date} appointments={entries} refreshing={query.isFetching} />
                )}
              </section>
            );
          })}
        </div>
      )}
      {editing !== undefined && (
        <AppointmentEditor
          appointment={editing}
          initialDay={day}
          close={() => setEditing(undefined)}
        />
      )}
    </main>
  );
}
interface EditorProps {
  appointment: Appointment | null;
  initialDay: string;
  close: () => void;
}
function AppointmentEditor({ appointment, initialDay, close }: EditorProps) {
  const { session } = useAuth();
  const cache = useQueryClient();
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [householdSearch, setHouseholdSearch] = useState("");
  const [clientId, setClientId] = useState(appointment?.client_id ?? "");
  const [petId, setPetId] = useState(appointment?.pet_id ?? "");
  const [clinician, setClinician] = useState(
    appointment?.assigned_dvm_id ?? "",
  );
  const [visitType, setVisitType] = useState(
    appointment?.visit_type ?? "clinic",
  );
  const [address, setAddress] = useState(
    appointment?.address_snapshot ?? baseAddress,
  );
  const [local, setLocal] = useState(
    appointment ? denverLocal(appointment.scheduled_at) : `${initialDay}T09:00`,
  );
  const [duration, setDuration] = useState(
    String(appointment?.duration_minutes ?? 30),
  );
  const [before, setBefore] = useState(
    String(appointment?.travel_before_minutes ?? 0),
  );
  const [after, setAfter] = useState(
    String(appointment?.travel_after_minutes ?? 0),
  );
  const [reason, setReason] = useState(appointment?.appointment_type ?? "");
  const [status, setStatus] = useState<Appointment["status"]>(
    appointment?.status ?? "SCHEDULED",
  );
  const [room, setRoom] = useState(appointment?.resource_name ?? "");
  const [notes, setNotes] = useState(appointment?.notes ?? "");
  const [offsets, setOffsets] = useState(
    (appointment?.reminder_offsets ?? [48, 24]).join(","),
  );
  const lookups = useQuery({
    queryKey: ["schedule-lookups", householdSearch, clientId],
    queryFn: async () => {
      const results = await Promise.all([
        supabase.rpc("search_clients", {
          p_search: householdSearch,
          p_limit: 50,
        }),
        supabase
          .from("pets")
          .select("id,name,client_id,archived_at,deceased_at,allergies")
          .eq("client_id", clientId || "00000000-0000-0000-0000-000000000000"),
        supabase.rpc("schedule_clinicians"),
        clientId
          ? supabase
              .from("clients")
              .select("id,full_name,housecall_address")
              .eq("id", clientId)
          : Promise.resolve({ data: [], error: null }),
      ]);
      for (const result of results) if (result.error) throw result.error;
      return {
        clients: [
          ...results[0].data!,
          ...results[3].data!.filter(
            (client) => !results[0].data!.some((row) => row.id === client.id),
          ),
        ],
        pets: results[1].data!,
        staff: results[2].data!,
      };
    },
  });
  const alerts = usePatientAlertReview(petId);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (lock.current || !session?.user.id) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const { error } = await supabase.rpc("save_appointment", {
        p_actor_id: session.user.id,
        p_id: appointment?.id ?? null,
        p_expected_version: appointment?.version ?? null,
        p_client_id: clientId,
        p_pet_id: petId,
        p_scheduled_at: denverInstant(local),
        p_duration_minutes: Number(duration),
        p_appointment_type: reason,
        p_status: status,
        p_assigned_dvm_id: clinician,
        p_visit_type: visitType,
        p_address_snapshot: visitType === "clinic" ? baseAddress : address,
        p_travel_before_minutes: Number(before),
        p_travel_after_minutes: Number(after),
        p_resource_name: room,
        p_notes: notes,
        p_reminder_offsets: reminderOffsets(offsets),
      });
      if (error) throw error;
      await cache.invalidateQueries({ queryKey: ["schedule"] });
      close();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : ((cause as { message?: string })?.message ??
              "Appointment could not be saved. Your changes are retained."),
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) close();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {appointment ? "Edit appointment" : "Book appointment"}
          </DialogTitle>
        </DialogHeader>
        <div>
          <Label htmlFor="booking-search">Find household by name</Label>
          <Input
            id="booking-search"
            disabled={busy}
            value={householdSearch}
            onChange={(event) => setHouseholdSearch(event.target.value)}
          />
          <p className="text-sm text-muted-foreground">
            Showing up to 50 matches. Refine the name to find a household.
          </p>
        </div>
        {lookups.isPending ? (
          <p role="status">Loading booking details…</p>
        ) : lookups.isError ? (
          <div role="alert">
            Booking details unavailable.{" "}
            <Button onClick={() => void lookups.refetch()}>Retry</Button>
          </div>
        ) : (
          <form onSubmit={save} className="space-y-4">
            <fieldset disabled={busy} className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <Label htmlFor="booking-client">Household</Label>
                  <select
                    id="booking-client"
                    required
                    className={selectClass}
                    value={clientId}
                    onChange={(event) => {
                      setClientId(event.target.value);
                      setPetId("");
                      if (visitType === "housecall")
                        setAddress(
                          lookups.data.clients.find(
                            (c) => c.id === event.target.value,
                          )?.housecall_address ?? "",
                        );
                    }}
                  >
                    <option value="">Select household</option>
                    {lookups.data.clients.map((client) => (
                      <option key={client.id} value={client.id}>
                        {client.full_name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label htmlFor="booking-pet">Patient</Label>
                  <select
                    id="booking-pet"
                    required
                    className={selectClass}
                    value={petId}
                    onChange={(event) => setPetId(event.target.value)}
                  >
                    <option value="">Select patient</option>
                    {lookups.data.pets
                      .filter(
                        (pet) =>
                          pet.client_id === clientId &&
                          ((!pet.archived_at && !pet.deceased_at) ||
                            pet.id === appointment?.pet_id),
                      )
                      .map((pet) => (
                        <option key={pet.id} value={pet.id}>
                          {pet.name}
                        </option>
                      ))}
                  </select>
                </div>
              </div>
              {petId && alerts.data?.snapshot.legacy_allergies.text?.trim() && (
                <div
                  role="note"
                  aria-label="Recorded patient allergies"
                  className="rounded-md border border-destructive bg-destructive/10 p-3 text-clinical-alert"
                >
                  <p className="font-semibold">Recorded patient allergies</p>
                  <p>{alerts.data?.snapshot.legacy_allergies.text}</p>
                </div>
              )}
              {petId &&
                (alerts.isPending ? (
                  <p role="status">Loading patient alerts…</p>
                ) : alerts.isError ? (
                  <div role="alert">
                    Patient alerts unavailable.{" "}
                    <Button type="button" onClick={() => void alerts.refetch()}>
                      Retry alerts
                    </Button>
                  </div>
                ) : (
                  Boolean(alerts.data?.snapshot.important_problems.length) && (
                    <div
                      role="note"
                      className="rounded-md border border-destructive bg-destructive/10 p-3 text-clinical-alert"
                    >
                      <p className="font-semibold">Important patient history</p>
                      {alerts.data?.snapshot.important_problems.map((alert) => (
                        <p key={alert.id}>
                          {alert.title}
                          {alert.status === "resolved" ? " (resolved)" : ""}
                        </p>
                      ))}
                    </div>
                  )
                ))}
              <div>
                <Label htmlFor="booking-reason">Visit reason</Label>
                <Input
                  id="booking-reason"
                  required
                  maxLength={150}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <Label htmlFor="booking-clinician">Assigned staff</Label>
                  <select
                    id="booking-clinician"
                    required
                    className={selectClass}
                    value={clinician}
                    onChange={(event) => setClinician(event.target.value)}
                  >
                    <option value="">Select assigned staff</option>
                    {appointment?.assigned_dvm_id &&
                      !lookups.data.staff.some(
                        (staff) => staff.id === appointment.assigned_dvm_id,
                      ) && (
                        <option value={appointment.assigned_dvm_id}>
                          Previously assigned staff (inactive)
                        </option>
                      )}
                    {lookups.data.staff.map((staff) => (
                      <option key={staff.id} value={staff.id}>
                        {staff.full_name?.trim() || `Staff ${staff.id.slice(0, 8)}`}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label htmlFor="booking-status">Status</Label>
                  <select
                    id="booking-status"
                    className={selectClass}
                    value={status}
                    onChange={(event) =>
                      setStatus(event.target.value as Appointment["status"])
                    }
                  >
                    {Object.entries(statusLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label htmlFor="booking-time">
                    Date and time (America/Denver)
                  </Label>
                  <Input
                    id="booking-time"
                    type="datetime-local"
                    required
                    value={local}
                    onChange={(event) => setLocal(event.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="booking-duration">Duration (minutes)</Label>
                  <Input
                    id="booking-duration"
                    type="number"
                    min={5}
                    max={480}
                    required
                    value={duration}
                    onChange={(event) => setDuration(event.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="booking-type">Location</Label>
                  <select
                    id="booking-type"
                    className={selectClass}
                    value={visitType}
                    onChange={(event) => {
                      setVisitType(event.target.value);
                      setAddress(
                        event.target.value === "clinic"
                          ? baseAddress
                          : (lookups.data.clients.find((c) => c.id === clientId)
                              ?.housecall_address ?? ""),
                      );
                    }}
                  >
                    <option value="clinic">Clinic</option>
                    <option value="housecall">Housecall</option>
                  </select>
                </div>
                <div>
                  <Label htmlFor="booking-room">
                    Shared room/resource (optional)
                  </Label>
                  <Input
                    id="booking-room"
                    value={room}
                    maxLength={150}
                    onChange={(event) => setRoom(event.target.value)}
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="booking-address">Visit address</Label>
                <Input
                  id="booking-address"
                  required
                  readOnly={visitType === "clinic"}
                  maxLength={1000}
                  value={address}
                  onChange={(event) => setAddress(event.target.value)}
                />
                {visitType === "housecall" && address && (
                  <a
                    className="text-sm text-primary underline"
                    href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open directions in Google Maps
                  </a>
                )}
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <Label htmlFor="booking-before">
                    Travel buffer before (minutes)
                  </Label>
                  <Input
                    id="booking-before"
                    type="number"
                    min={0}
                    max={240}
                    required
                    value={before}
                    onChange={(event) => setBefore(event.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="booking-after">
                    Travel buffer after (minutes)
                  </Label>
                  <Input
                    id="booking-after"
                    type="number"
                    min={0}
                    max={240}
                    required
                    value={after}
                    onChange={(event) => setAfter(event.target.value)}
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="booking-reminders">
                  Reminders (hours before, comma separated)
                </Label>
                <Input
                  id="booking-reminders"
                  value={offsets}
                  onChange={(event) => setOffsets(event.target.value)}
                />
                <p className="text-sm text-muted-foreground">
                  Default 48,24. Leave blank to disable. Delivery requires
                  messaging setup.
                </p>
              </div>
              <div>
                <Label htmlFor="booking-notes">
                  Access and appointment notes
                </Label>
                <Textarea
                  id="booking-notes"
                  maxLength={10000}
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                />
              </div>
              {error && (
                <p role="alert" className="text-destructive">
                  {error}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={close}>
                  Close
                </Button>
                <Button
                  type="submit"
                  disabled={!petId || alerts.isPending || alerts.isError}
                >
                  {busy ? "Saving…" : "Save appointment"}
                </Button>
              </div>
            </fieldset>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
