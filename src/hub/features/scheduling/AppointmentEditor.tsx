import { editorCompletionReceiptSchema } from "./next-visit-review-model";
import { useRef, useState } from "react";
import { Link } from "react-router-dom";
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
import type { Tables } from "@/integrations/supabase/types";
import { denverInstant, denverLocal, reminderOffsets } from "./time";
import { practiceBaseAddress } from "./housecall-route";
import { appointmentBinding, catalogList } from "./catalog-api";
import {
  matchesType,
  requiresTimeReview,
  type TypeDefinition,
  type ResourceDefinition,
  type BookingReceipt,
} from "./catalog-model";
import { useBookingAction } from "./use-reviewed-action";
import { NextVisitDraftGuard } from "./NextVisitDraftGuard";
import { appointmentCompletion } from "./next-visit-review-api";
import {
  useNextVisitReview,
  type ReviewReceipt,
} from "./use-next-visit-review";
import { nextVisitOutcomeRequest } from "./next-visit-api";
import type {
  NextVisitContext,
  NextVisitOutcomeValues,
} from "./next-visit-model";
type Appointment = Tables<"appointments">;
const baseAddress = practiceBaseAddress;
const statusLabels = {
  SCHEDULED: "Booked",
  CONFIRMED: "Confirmed",
  COMPLETED: "Completed",
  CANCELLED: "Canceled",
  NO_SHOW: "No show",
};
const selectClass =
  "flex min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm";
import { toast } from "sonner";
interface EditorProps {
  appointment: Appointment | null;
  initialDay: string;
  initialClientId?: string;
  initialPetId?: string;
  close: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  onCompleted?: (context: NextVisitContext) => void;
  followup?: NextVisitContext;
  onOutcome?: (context: NextVisitContext) => void;
}
export function AppointmentEditor({
  appointment,
  initialDay,
  initialClientId,
  initialPetId,
  close,
  onCompleted,
  onDirtyChange,
  followup,
  onOutcome,
}: EditorProps) {
  const { session } = useAuth();
  const cache = useQueryClient();
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [householdSearch, setHouseholdSearch] = useState("");
  const [clientId, setClientId] = useState(
    appointment?.client_id ??
      followup?.occurrence.client_id ??
      initialClientId ??
      "",
  );
  const [petId, setPetId] = useState(
    appointment?.pet_id ?? followup?.occurrence.pet_id ?? initialPetId ?? "",
  );
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
    appointment
      ? denverLocal(appointment.scheduled_at)
      : followup
        ? ""
        : `${initialDay}T09:00`,
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
          .select("id,name,species,client_id,archived_at,deceased_at,allergies")
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
  const [typeId, setTypeId] = useState(""),
    [resourceId, setResourceId] = useState(""),
    [reviewNote, setReviewNote] = useState("");
  const [notice, setNotice] = useState(""),
    [done, setDone] = useState(false);
  const managed = useBookingAction(session?.user.id ?? "");
  const catalog = useQuery({
    queryKey: ["appointment-catalog", "booking"],
    queryFn: async () => {
      const [types, resources] = await Promise.all([
        catalogList("type"),
        catalogList("resource"),
      ]);
      return { types, resources };
    },
  });
  const binding = useQuery({
    queryKey: [
      "appointment-catalog-binding",
      appointment?.id,
      appointment?.version,
    ],
    queryFn: () => appointmentBinding(appointment!.id),
    enabled: Boolean(appointment),
  });
  const [replacing, setReplacing] = useState(false);
  const selectedType = catalog.data?.types.find(
    (entry) => entry.published?.id === typeId,
  )?.published;
  const definition = selectedType?.definition as TypeDefinition | undefined;
  const frozen = Boolean(binding.data && !replacing);
  const staleResource = Boolean(
    resourceId &&
    !catalog.data?.resources.some(
      (entry) => entry.published?.id === resourceId,
    ),
  );
  function outcomeSaved(receipt: ReviewReceipt) {
    if (!("occurrence" in receipt)) return;
    setDone(true);
    void cache.invalidateQueries({ queryKey: ["schedule"] });
    void cache.invalidateQueries({ queryKey: ["next-visits"] });
    onOutcome?.(receipt);
    close();
  }
  const followupAction = useNextVisitReview(
    session?.user.id ?? "",
    "decide",
    outcomeSaved,
  );
  const completionAction = useNextVisitReview(
    session?.user.id ?? "",
    "editor",
    (receipt) => {
      const saved = editorCompletionReceiptSchema.parse(receipt);
      setDone(true);
      void cache.invalidateQueries({ queryKey: ["schedule"] });
      void cache.invalidateQueries({ queryKey: ["hub-today"] });
      void cache.invalidateQueries({ queryKey: ["next-visits"] });
      close();
      if (saved.context) onCompleted?.(saved.context);
      else
        toast.success(
          "Appointment saved. No new completion transition was recorded.",
        );
    },
  );
  const blocked =
    busy ||
    managed.busy ||
    managed.unconfirmed ||
    followupAction.busy ||
    followupAction.pending ||
    completionAction.busy ||
    completionAction.pending;
  const fields = JSON.stringify({
    clientId,
    petId,
    clinician,
    visitType,
    address,
    local,
    duration,
    before,
    after,
    reason,
    status,
    room,
    notes,
    offsets,
    typeId,
    resourceId,
    reviewNote,
    replacing,
  });
  const baseline = useRef(fields);
  const dirty = !done && (fields !== baseline.current || blocked);
  const guard = (
    <NextVisitDraftGuard
      dirty={dirty}
      onDirtyChange={onDirtyChange}
      description="This appointment has unsaved or unconfirmed changes. Keep it open to save or check the action."
    />
  );
  function dismiss() {
    if (busy || managed.busy || followupAction.busy || completionAction.busy)
      return;
    if (
      !dirty ||
      window.confirm(
        managed.unconfirmed ||
          followupAction.pending ||
          completionAction.pending
          ? followupAction.pending || completionAction.pending
            ? "Leave this unconfirmed review? Its exact server action remains available on Home and Schedule."
            : "This save is unconfirmed. Leave and lose its recovery action?"
          : "Discard this unsaved appointment?",
      )
    )
      close();
  }
  function clearChoice() {
    if (typeId) {
      setTypeId("");
      setResourceId("");
      setReason("");
      setRoom("");
      setReviewNote("");
      setNotice(
        "The patient or location changed. Your entered times are retained; choose and review a matching appointment type.",
      );
    }
  }
  function chooseType(id: string) {
    const selected = catalog.data?.types.find(
      (entry) => entry.published?.id === id,
    )?.published;
    setTypeId(id);
    setReplacing(Boolean(id));
    setResourceId("");
    setReviewNote("");
    setNotice("");
    if (!selected) {
      if (binding.data) {
        const saved = binding.data.fields;
        setClientId(saved.client_id);
        setPetId(saved.pet_id);
        setVisitType(saved.visit_type);
        setAddress(appointment?.address_snapshot ?? baseAddress);
        setReason(saved.appointment_type);
        setRoom(saved.resource_name ?? "");
        setDuration(String(saved.duration_minutes));
        setBefore(String(saved.travel_before_minutes));
        setAfter(String(saved.travel_after_minutes));
      } else {
        setReason("");
        setRoom("");
      }
      return;
    }
    const proposal = selected.definition as TypeDefinition;
    setReason(proposal.name);
    setRoom("");
    setDuration(
      proposal.duration_minutes === null
        ? ""
        : String(proposal.duration_minutes),
    );
    setBefore(String(proposal.travel_before_minutes));
    setAfter(String(proposal.travel_after_minutes));
  }
  async function completeManaged(result: unknown) {
    if (!result) return;
    setDone(true);
    void cache.invalidateQueries({ queryKey: ["schedule"] });
    void cache.invalidateQueries({ queryKey: ["hub-today"] });
    close();
    const saved = (result as BookingReceipt).appointment;
    if (saved.status === "COMPLETED") {
      try {
        const context = await appointmentCompletion(saved.id, saved.version);
        if (context) onCompleted?.(context);
        else
          toast.success(
            "Appointment saved. No new completion transition was recorded.",
          );
      } catch {
        toast.error(
          "Appointment saved; next-visit review could not load. Open its patient history or the pending queue.",
        );
      }
    }
  }
  const alerts = usePatientAlertReview(petId);
  function reviewedBooking(nextStatus: Appointment["status"]) {
    const common = {
      client_id: clientId,
      pet_id: petId,
      scheduled_at: denverInstant(local),
      duration_minutes: Number(duration),
      assigned_dvm_id: clinician,
      visit_type: visitType as "clinic" | "housecall",
      address_snapshot: visitType === "clinic" ? baseAddress : address,
      travel_before_minutes: Number(before),
      travel_after_minutes: Number(after),
      notes,
      reminder_offsets: reminderOffsets(offsets),
    };
    const booking: NonNullable<NextVisitOutcomeValues["booking"]> = selectedType
      ? {
          mode: "catalog",
          values: {
            ...common,
            type_version_id: selectedType.id,
            resource_version_id: resourceId || null,
            status: nextStatus,
            override_note: reviewNote.trim(),
          },
        }
      : {
          mode: "custom",
          values: {
            ...common,
            appointment_type: reason,
            resource_name: room || null,
          },
        };
    return booking;
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (
      lock.current ||
      blocked ||
      !session?.user.id ||
      staleResource ||
      ((typeId || replacing) && !selectedType)
    )
      return;
    if (followup) {
      try {
        const booking = reviewedBooking("SCHEDULED");
        await followupAction.save(
          nextVisitOutcomeRequest(followup.occurrence.id, followup.version, {
            action: "book",
            note: "Follow-up time reviewed by staff",
            followup_on: null,
            booking,
            appointment_id: null,
            appointment_version: null,
          }),
        );
      } catch {
        followupAction.setError(
          "Review the patient, time, staff, resource and review note before saving.",
        );
      }
      return;
    }
    if (status === "COMPLETED") {
      try {
        await completionAction.save({
          id: appointment?.id ?? null,
          expected_version: appointment?.version ?? null,
          booking: reviewedBooking("COMPLETED"),
        });
      } catch {
        completionAction.setError(
          "Review the completed appointment before saving.",
        );
      }
      return;
    }
    if (selectedType) {
      try {
        await completeManaged(
          await managed.save({
            id: appointment?.id ?? null,
            expectedVersion: appointment?.version ?? null,
            values: {
              type_version_id: selectedType.id,
              resource_version_id: resourceId || null,
              client_id: clientId,
              pet_id: petId,
              scheduled_at: denverInstant(local),
              duration_minutes: Number(duration),
              status,
              assigned_dvm_id: clinician,
              visit_type: visitType as "clinic" | "housecall",
              address_snapshot: visitType === "clinic" ? baseAddress : address,
              travel_before_minutes: Number(before),
              travel_after_minutes: Number(after),
              notes,
              reminder_offsets: reminderOffsets(offsets),
              override_note: reviewNote.trim(),
            },
          }),
        );
      } catch {
        managed.setError(
          "Review the patient, time, staff, resource and review note before saving.",
        );
      }
      return;
    }
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const { data, error } = await supabase.rpc("save_appointment", {
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
      await completeManaged({ appointment: data });
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
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) dismiss();
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl [&_button]:min-h-11 [&_input]:min-h-11 [&>button]:min-w-11 [&>button]:right-1 [&>button]:top-1">
          <DialogHeader className="pr-10">
            <DialogTitle>
              {followup
                ? "Schedule next visit"
                : appointment
                  ? "Edit appointment"
                  : "Book appointment"}
            </DialogTitle>
          </DialogHeader>
          <div>
            <Label htmlFor="booking-search">Find household by name</Label>
            <Input
              id="booking-search"
              disabled={blocked}
              value={householdSearch}
              onChange={(event) => setHouseholdSearch(event.target.value)}
            />
            <p className="text-sm text-muted-foreground">
              Showing up to 50 matches. Refine the name to find a household.
            </p>
          </div>
          {lookups.isPending ||
          catalog.isPending ||
          Boolean(appointment && binding.isPending) ? (
            <p role="status">Loading booking details…</p>
          ) : lookups.isError ||
            catalog.isError ||
            Boolean(appointment && binding.isError) ? (
            <div role="alert">
              Booking details unavailable.{" "}
              <Button
                onClick={() => {
                  void lookups.refetch();
                  void catalog.refetch();
                  if (appointment) void binding.refetch();
                }}
              >
                Retry
              </Button>
            </div>
          ) : (
            <form onSubmit={save} className="space-y-4">
              <fieldset disabled={blocked} className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <Label htmlFor="booking-client">Household</Label>
                    <select
                      id="booking-client"
                      required
                      className={selectClass}
                      value={clientId}
                      disabled={frozen || Boolean(followup)}
                      onChange={(event) => {
                        clearChoice();
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
                      disabled={frozen || Boolean(followup)}
                      onChange={(event) => {
                        clearChoice();
                        setPetId(event.target.value);
                      }}
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
                  alerts.data?.snapshot.legacy_allergies.text?.trim() && (
                    <div
                      role="note"
                      aria-label="Recorded patient allergies"
                      className="rounded-md border border-destructive bg-destructive/10 p-3 text-clinical-alert"
                    >
                      <p className="font-semibold">
                        Recorded patient allergies
                      </p>
                      <p>{alerts.data?.snapshot.legacy_allergies.text}</p>
                    </div>
                  )}
                {petId &&
                  (alerts.isPending ? (
                    <p role="status">Loading patient alerts…</p>
                  ) : alerts.isError ? (
                    <div role="alert">
                      Patient alerts unavailable.{" "}
                      <Button
                        type="button"
                        onClick={() => void alerts.refetch()}
                      >
                        Retry alerts
                      </Button>
                    </div>
                  ) : (
                    Boolean(
                      alerts.data?.snapshot.important_problems.length,
                    ) && (
                      <div
                        role="note"
                        className="rounded-md border border-destructive bg-destructive/10 p-3 text-clinical-alert"
                      >
                        <p className="font-semibold">
                          Important patient history
                        </p>
                        {alerts.data?.snapshot.important_problems.map(
                          (alert) => (
                            <p key={alert.id}>
                              {alert.title}
                              {alert.status === "resolved" ? " (resolved)" : ""}
                            </p>
                          ),
                        )}
                      </div>
                    )
                  ))}
                <div>
                  <Label htmlFor="booking-catalog-type">
                    Reviewed appointment type
                  </Label>
                  <select
                    id="booking-catalog-type"
                    className={selectClass}
                    value={typeId}
                    onChange={(event) => chooseType(event.target.value)}
                  >
                    <option value="">
                      {binding.data && !replacing
                        ? `Keep frozen type: ${binding.data.type.definition.name} (revision ${binding.data.type.version})`
                        : "Custom visit / select a reviewed type"}
                    </option>
                    {catalog
                      .data!.types.filter(
                        (entry) =>
                          entry.published &&
                          matchesType(
                            entry.published.definition as TypeDefinition,
                            lookups.data.pets.find((pet) => pet.id === petId)
                              ?.species ?? "",
                            visitType,
                          ),
                      )
                      .map((entry) => (
                        <option key={entry.id} value={entry.published!.id}>
                          {entry.published!.definition.name} · revision{" "}
                          {entry.published!.version}
                        </option>
                      ))}
                  </select>
                  <p className="text-sm text-muted-foreground">
                    {definition
                      ? `${definition.category} visit · ${definition.staffing === "dvm" ? "Veterinarian required" : "Active staff"}. Choosing a type proposes its reviewed times.`
                      : frozen
                        ? "Reviewed fields are preserved. Choose a current published type to review changes to them."
                        : "Only published types matching this patient’s species and location are shown. Custom visits require manual review."}
                  </p>
                  <Link
                    to="/hub/tools/appointment-catalog"
                    className="inline-flex min-h-11 items-center text-sm text-primary underline"
                  >
                    Review appointment catalog
                  </Link>
                </div>
                {binding.data && replacing && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => chooseType("")}
                  >
                    Restore original reviewed settings
                  </Button>
                )}
                {staleResource && (
                  <p role="alert">
                    The selected resource is no longer published. Clear it or
                    choose a current resource before saving.
                  </p>
                )}
                {notice && (
                  <p role="status" className="text-sm text-muted-foreground">
                    {notice}
                  </p>
                )}
                {typeId && !selectedType && (
                  <p role="alert">
                    The selected type is no longer published. Choose a current
                    type or explicitly keep the original booking.
                  </p>
                )}
                <div>
                  <Label htmlFor="booking-reason">Visit reason</Label>
                  <Input
                    id="booking-reason"
                    readOnly={frozen || Boolean(selectedType)}
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
                          {staff.full_name?.trim() ||
                            `Staff ${staff.id.slice(0, 8)}`}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <Label htmlFor="booking-status">Status</Label>
                    <select
                      id="booking-status"
                      disabled={Boolean(followup)}
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
                      readOnly={
                        frozen ||
                        Boolean(
                          definition &&
                          definition.duration_minutes !== null &&
                          !definition.allow_override,
                        )
                      }
                      type="number"
                      min={15}
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
                      disabled={frozen}
                      onChange={(event) => {
                        clearChoice();
                        setVisitType(event.target.value);
                        setAddress(
                          event.target.value === "clinic"
                            ? baseAddress
                            : (lookups.data.clients.find(
                                (c) => c.id === clientId,
                              )?.housecall_address ?? ""),
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
                    {selectedType ? (
                      <select
                        id="booking-room"
                        className={selectClass}
                        required={Boolean(definition?.resource_kind)}
                        value={resourceId}
                        onChange={(event) => {
                          setResourceId(event.target.value);
                          setRoom(
                            catalog.data!.resources.find(
                              (entry) =>
                                entry.published?.id === event.target.value,
                            )?.published?.definition.name ?? "",
                          );
                        }}
                      >
                        <option value="">
                          {definition?.resource_kind
                            ? "Select required resource"
                            : "No shared resource"}
                        </option>
                        {staleResource && (
                          <option value={resourceId}>
                            Selected resource unavailable — choose again
                          </option>
                        )}
                        {catalog
                          .data!.resources.filter((entry) => {
                            const resource = entry.published?.definition as
                              ResourceDefinition | undefined;
                            return (
                              resource &&
                              resource.visit_types.some(
                                (mode) => mode === visitType,
                              ) &&
                              (!definition?.resource_kind ||
                                resource.resource_kind ===
                                  definition.resource_kind)
                            );
                          })
                          .map((entry) => (
                            <option key={entry.id} value={entry.published!.id}>
                              {entry.published!.definition.name}
                            </option>
                          ))}
                      </select>
                    ) : (
                      <Input
                        id="booking-room"
                        readOnly={frozen}
                        value={room}
                        maxLength={150}
                        onChange={(event) => setRoom(event.target.value)}
                      />
                    )}
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
                      readOnly={
                        frozen ||
                        Boolean(definition && !definition.allow_override)
                      }
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
                      readOnly={
                        frozen ||
                        Boolean(definition && !definition.allow_override)
                      }
                      type="number"
                      min={0}
                      max={240}
                      required
                      value={after}
                      onChange={(event) => setAfter(event.target.value)}
                    />
                  </div>
                </div>
                {selectedType && (
                  <div>
                    <Label htmlFor="booking-review">
                      Booking time review note
                    </Label>
                    <Textarea
                      id="booking-review"
                      maxLength={2000}
                      required={Boolean(
                        definition &&
                        requiresTimeReview(
                          definition,
                          Number(duration),
                          Number(before),
                          Number(after),
                        ),
                      )}
                      value={reviewNote}
                      onChange={(event) => setReviewNote(event.target.value)}
                    />
                    <p className="text-sm text-muted-foreground">
                      Required for case-specific duration or permitted changes
                      to the reviewed times.
                    </p>
                  </div>
                )}
                {frozen && binding.data?.override_note && (
                  <p className="text-sm text-muted-foreground">
                    Saved time review: {binding.data.override_note}
                  </p>
                )}
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
                  <Button type="button" variant="outline" onClick={dismiss}>
                    Close
                  </Button>
                  <Button
                    type="submit"
                    disabled={
                      !petId ||
                      alerts.isPending ||
                      alerts.isError ||
                      Boolean((typeId || replacing) && !selectedType) ||
                      staleResource
                    }
                  >
                    {busy || managed.busy || followupAction.busy
                      ? "Saving…"
                      : followup
                        ? "Book and record next visit"
                        : "Save appointment"}
                  </Button>
                </div>
              </fieldset>
              {completionAction.error && (
                <p role="alert" className="text-destructive">
                  {completionAction.error}
                </p>
              )}
              {completionAction.pending && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    className="min-h-11"
                    disabled={completionAction.busy}
                    onClick={() => void completionAction.retry()}
                  >
                    Retry unchanged completion
                  </Button>
                  <Button
                    type="button"
                    className="min-h-11"
                    disabled={completionAction.busy}
                    onClick={() => void completionAction.checkSaved()}
                  >
                    Check saved completion
                  </Button>
                  <Button
                    type="button"
                    className="min-h-11"
                    variant="outline"
                    disabled={completionAction.busy}
                    onClick={() => void completionAction.release()}
                  >
                    Check and release review
                  </Button>
                </div>
              )}
              {followupAction.error && (
                <p role="alert" className="text-destructive">
                  {followupAction.error}
                </p>
              )}
              {followupAction.pending && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    className="min-h-11"
                    disabled={followupAction.busy}
                    onClick={() => void followupAction.retry()}
                  >
                    Retry unchanged follow-up
                  </Button>
                  <Button
                    type="button"
                    className="min-h-11"
                    disabled={followupAction.busy}
                    onClick={() => void followupAction.checkSaved()}
                  >
                    Check saved follow-up
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11"
                    disabled={followupAction.busy}
                    onClick={() => void followupAction.release()}
                  >
                    Check and release review
                  </Button>
                </div>
              )}
              {managed.error && (
                <p role="alert" className="text-destructive">
                  {managed.error}
                </p>
              )}
              {managed.error && !managed.unconfirmed && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={managed.busy}
                  onClick={() => void catalog.refetch()}
                >
                  Reload published catalog
                </Button>
              )}
              {managed.unconfirmed && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    disabled={managed.busy}
                    onClick={() => void managed.retry().then(completeManaged)}
                  >
                    Retry unchanged review
                  </Button>
                  <Button
                    type="button"
                    disabled={managed.busy}
                    onClick={() =>
                      void managed.checkSaved().then(completeManaged)
                    }
                  >
                    Check saved action
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={managed.busy}
                    onClick={dismiss}
                  >
                    Close
                  </Button>
                </div>
              )}
            </form>
          )}
        </DialogContent>
      </Dialog>
      {guard}
    </>
  );
}
