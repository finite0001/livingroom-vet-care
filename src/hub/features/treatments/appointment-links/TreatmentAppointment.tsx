import { useId, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hub/contexts/auth-context";
import { denverLocal } from "../../scheduling/time";
import { practiceTimestamp, errorMessage } from "../../inventory/stock-policy";
import { stockContextRpc } from "../../inventory/restocking/api";
import { useContextMutation } from "../../inventory/useContextMutation";
import { linkContextSchema, linkRequestSchema, eventSchema } from "./model";
interface TreatmentAppointmentProps {
  petId: string;
  treatmentId: string;
  administeredAt: string;
  defer?: boolean;
}
export function TreatmentAppointment({
  defer = false,
  ...props
}: TreatmentAppointmentProps) {
  const [open, setOpen] = useState(false);
  if (!defer) return <TreatmentAppointmentDetails {...props} />;
  return (
    <details
      className="mt-3"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="cursor-pointer text-sm font-medium">
        Appointment link
      </summary>
      {open && <TreatmentAppointmentDetails {...props} />}
    </details>
  );
}
function TreatmentAppointmentDetails({
  petId,
  treatmentId,
  administeredAt,
}: TreatmentAppointmentProps) {
  const { session } = useAuth();
  const [day, setDay] = useState(() =>
    denverLocal(new Date(administeredAt)).slice(0, 10),
  );
  const [validation, setValidation] = useState("");
  const id = useId();
  const query = useQuery({
    queryKey: [
      "treatment-appointment",
      session?.user.id,
      petId,
      treatmentId,
      day,
    ],
    enabled: !!session && /^\d{4}-\d{2}-\d{2}$/.test(day),
    queryFn: async () => {
      const context = linkContextSchema.parse(
        await stockContextRpc("read_treatment_appointment", {
          p_pet_id: petId,
          p_treatment_id: treatmentId,
          p_day: day,
        }),
      );
      if (
        context.pet_id !== petId ||
        context.treatment_id !== treatmentId ||
        context.history.some((e) => e.treatment_id !== treatmentId)
      )
        throw new Error("Appointment context differs. Reload this patient.");
      return context;
    },
  });
  const state = useContextMutation(
    `appointment:${treatmentId}`,
    async (name, args) => {
      const request = linkRequestSchema.parse(args);
      const response = eventSchema.parse(await stockContextRpc(name, request));
      if (
        response.id !== request.p_id ||
        response.treatment_id !== request.p_treatment_id ||
        response.appointment_id !== request.p_appointment_id ||
        response.version !== request.p_expected_version + 1
      )
        throw new Error(
          "Appointment response differs. Reload before continuing.",
        );
    },
  );
  const current = query.data?.current;
  const visit = current?.appointment_snapshot;
  return (
    <div className="mt-3 space-y-2 border-t pt-3">
      <h4 className="font-medium">Appointment</h4>
      {query.isPending && <p role="status">Loading appointment link…</p>}
      {query.error && (
        <p role="alert" className="text-destructive">
          {errorMessage(query.error)}{" "}
          <button className="underline" onClick={() => void query.refetch()}>
            Retry
          </button>
        </p>
      )}
      {query.data &&
        (visit ? (
          <>
            <p>
              {practiceTimestamp(visit.scheduled_at)} · {visit.appointment_type}
            </p>
            {current?.context_changed ? (
              <p role="alert" className="text-destructive">
                Appointment details changed since linking. Review the link
                below.
              </p>
            ) : (
              <Button asChild variant="outline" className="min-h-11">
                <Link
                  to={`/hub/schedule?date=${denverLocal(new Date(visit.scheduled_at)).slice(0, 10)}#appointment-${visit.id}`}
                >
                  Open appointment day
                </Link>
              </Button>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            No appointment linked.
          </p>
        ))}
      <details>
        <summary className="cursor-pointer text-sm font-medium">
          {visit
            ? "Change appointment link"
            : "Link a recorded treatment to a visit"}
        </summary>
        <form
          className="mt-3 space-y-2"
          onSubmit={async (e) => {
            e.preventDefault();
            setValidation("");
            if (state.uncertain) {
              await state.retry();
              return;
            }
            try {
              const form = new FormData(e.currentTarget);
              const choice = String(form.get("appointment") ?? "");
              if (!choice) {
                setValidation(
                  "Select an appointment or explicitly remove the existing link.",
                );
                return;
              }
              const selected = query.data?.appointments.find(
                (a) => a.id === choice,
              );
              if (choice !== "remove" && !selected) {
                setValidation(
                  "Reload the visit date and select an appointment.",
                );
                return;
              }
              await state.run({
                name: "set_treatment_appointment",
                args: linkRequestSchema.parse({
                  p_actor_id: session?.user.id,
                  p_id: crypto.randomUUID(),
                  p_pet_id: petId,
                  p_treatment_id: treatmentId,
                  p_appointment_id: selected?.id ?? null,
                  p_appointment_version: selected?.version ?? null,
                  p_expected_version: current?.version ?? 0,
                  p_reason: form.get("reason"),
                }),
              });
            } catch (error) {
              setValidation(errorMessage(error));
            }
          }}
        >
          <p className="text-sm text-muted-foreground">
            Choose this patient's visit. This links the saved treatment without
            changing stock or billing.
          </p>
          <fieldset
            disabled={state.busy || state.uncertain}
            className="space-y-2"
          >
            <Label htmlFor={`${id}-day`}>Visit date</Label>
            <Input
              id={`${id}-day`}
              type="date"
              required
              value={day}
              onChange={(e) => setDay(e.target.value)}
            />
            <Label htmlFor={`${id}-visit`}>Appointment on this date</Label>
            <select
              key={`${day}:${current?.version ?? 0}`}
              id={`${id}-visit`}
              name="appointment"
              defaultValue={
                query.data?.appointments.some(
                  (a) => a.id === current?.appointment_id,
                )
                  ? (current?.appointment_id ?? "")
                  : ""
              }
              className="min-h-11 w-full rounded-md border bg-background px-3"
              disabled={!query.isSuccess}
            >
              <option value="">Select appointment</option>
              {visit && <option value="remove">Remove appointment link</option>}
              {query.data?.appointments.map((a) => (
                <option key={a.id} value={a.id}>
                  {practiceTimestamp(a.scheduled_at)} · {a.appointment_type}
                </option>
              ))}
            </select>
            {query.isSuccess && !query.data.appointments.length && (
              <p className="text-sm">
                No eligible visits on this date. Choose another date.
              </p>
            )}
            <Label htmlFor={`${id}-reason`}>Link or change reason</Label>
            <Input
              id={`${id}-reason`}
              name="reason"
              required
              maxLength={2000}
            />
          </fieldset>
          {(validation || state.error) && (
            <p role="alert" className="text-destructive">
              {validation || state.error}
            </p>
          )}
          {state.saved && (
            <p role="status" className="text-sm text-muted-foreground">
              Appointment link saved.
            </p>
          )}
          <Button disabled={state.busy || !query.isSuccess}>
            {state.uncertain
              ? "Retry same appointment link"
              : "Save appointment link"}
          </Button>
        </form>
        {!!query.data?.history.length && (
          <div className="mt-3 space-y-1">
            <h5 className="text-sm font-medium">
              Recent link history (up to 20)
            </h5>
            {query.data.history.map((e) => (
              <p key={e.id} className="text-sm">
                {practiceTimestamp(e.created_at)} ·{" "}
                {e.appointment_snapshot
                  ? `Linked ${practiceTimestamp(e.appointment_snapshot.scheduled_at)}`
                  : "Link removed"}{" "}
                · {e.reason}
              </p>
            ))}
          </div>
        )}
      </details>
    </div>
  );
}
