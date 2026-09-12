import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hub/contexts/AuthContext";
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
import { denverInstant, denverLocal, reminderOffsets, shiftDay } from "./time";
import type { Tables } from "@/integrations/supabase/types";

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
const baseAddress = "2619 Spruce Street, Boulder, CO";
export default function SchedulePage() {
  usePageTitle("Schedule");
  const [day, setDay] = useState(() => denverLocal(new Date()).slice(0, 10));
  const [week, setWeek] = useState(false);
  const [editing, setEditing] = useState<Appointment | null | undefined>();
  const count = week ? 7 : 1;
  const query = useQuery({
    queryKey: ["schedule", day, count],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("appointments")
        .select(
          "*,pets(name),clients(full_name),profiles!appointments_assigned_dvm_id_fkey(full_name)",
        )
        .gte("scheduled_at", denverInstant(`${day}T00:00`))
        .lt("scheduled_at", denverInstant(`${shiftDay(day, count)}T00:00`))
        .order("scheduled_at");
      if (error) throw error;
      return data;
    },
  });
  return (
    <main className="space-y-5 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Schedule</h1>
          <p className="text-sm text-muted-foreground">
            Clinic and housecalls · All times America/Denver
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
      </div>
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
            week ? "grid gap-3 md:grid-cols-2 xl:grid-cols-3" : "space-y-3"
          }
        >
          {Array.from({ length: count }, (_, index) => {
            const date = shiftDay(day, index);
            const entries = query.data.filter((row) =>
              denverLocal(row.scheduled_at).startsWith(date),
            );
            return (
              <section key={date} className="rounded-lg border p-4">
                <h2 className="mb-3 font-semibold">{date}</h2>
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
                        {denverLocal(row.scheduled_at).slice(11)} ·{" "}
                        {row.pets?.name ?? "Patient unavailable"}
                      </p>
                      <p className="text-sm">
                        {row.clients?.full_name} · {row.appointment_type}
                      </p>
                      <p className="text-sm">
                        {row.profiles?.full_name ?? "Unassigned"}
                      </p>
                      <p className="text-sm">
                        {statusLabels[row.status]} · {row.duration_minutes}{" "}
                        minutes · {row.visit_type}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {row.address_snapshot}
                      </p>
                    </button>
                  ))}
                </div>
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
  const alerts = useQuery({
    queryKey: ["booking-alerts", petId],
    enabled: Boolean(petId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("patient_problems")
        .select("id,title,status")
        .eq("pet_id", petId)
        .eq("importance", "high");
      if (error) throw error;
      return data;
    },
  });
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
              {petId &&
                lookups.data.pets
                  .find((pet) => pet.id === petId)
                  ?.allergies?.trim() && (
                  <div
                    role="note"
                    aria-label="Recorded patient allergies"
                    className="rounded-md border border-destructive bg-destructive/10 p-3 text-clinical-alert"
                  >
                    <p className="font-semibold">Recorded patient allergies</p>
                    <p>
                      {
                        lookups.data.pets.find((pet) => pet.id === petId)
                          ?.allergies
                      }
                    </p>
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
                  Boolean(alerts.data?.length) && (
                    <div
                      role="note"
                      className="rounded-md border border-destructive bg-destructive/10 p-3 text-clinical-alert"
                    >
                      <p className="font-semibold">Important patient history</p>
                      {alerts.data?.map((alert) => (
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
                        {staff.full_name}
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
