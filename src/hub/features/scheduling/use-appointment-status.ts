import { refreshScheduleFacts } from "./refresh-schedule-facts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hub/contexts/auth-context";
import type { Tables } from "@/integrations/supabase/types";
import { useNextVisitReview } from "./use-next-visit-review";
import { nextVisitCompletionRequest } from "./next-visit-api";
import type { NextVisitContext } from "./next-visit-model";
import { statusLabel } from "@/hub/components/shared/StatusChip";

type Appointment = Tables<"appointments">;
export type AppointmentStatus = Appointment["status"];

interface StatusChange {
  appointment: Appointment;
  status: AppointmentStatus;
}

function failureMessage(error: unknown): string {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? (error as { code?: string }).code
      : null;
  if (code === "PT409")
    return "This appointment changed. Refresh and review before trying again.";
  return (
    (error as { message?: string })?.message ??
    "Couldn't update the visit. Refresh to check the saved state before retrying."
  );
}

/**
 * Direct status updates ("Check in", "Complete") without opening the booking
 * dialog. Staff cannot write the appointments table directly (writes are
 * revoked), so this reuses the same save_appointment RPC the dialog uses,
 * passing the unchanged row back with only the status swapped.
 */
interface StatusOptions {
  onCompleted?: (context: NextVisitContext) => void;
}
export function useAppointmentStatus({ onCompleted }: StatusOptions = {}) {
  const { session } = useAuth();
  const cache = useQueryClient();
  const review = useNextVisitReview(
    session?.user.id ?? "",
    "complete",
    (receipt) => {
      if ("context" in receipt) onCompleted?.(receipt.context);
    },
  );
  const mutation = useMutation({
    mutationFn: async ({ appointment, status }: StatusChange) => {
      const actor = session?.user.id;
      if (!actor) throw new Error("Sign in before updating the schedule.");
      if (status === "COMPLETED") {
        const saved = await review.save(
          nextVisitCompletionRequest(appointment.id, appointment.version),
        );
        if (!saved)
          throw new Error(
            "Completion is unconfirmed or needs review. Check the recovery panel before submitting new work.",
          );
        return saved;
      }
      if (!appointment.pet_id || !appointment.assigned_dvm_id)
        throw new Error("This visit is missing its patient or assigned staff.");
      const { error } = await supabase.rpc("save_appointment", {
        p_actor_id: actor,
        p_id: appointment.id,
        p_expected_version: appointment.version,
        p_client_id: appointment.client_id,
        p_pet_id: appointment.pet_id,
        p_scheduled_at: appointment.scheduled_at,
        p_duration_minutes: appointment.duration_minutes,
        p_appointment_type: appointment.appointment_type,
        p_status: status,
        p_assigned_dvm_id: appointment.assigned_dvm_id,
        p_visit_type: appointment.visit_type,
        p_address_snapshot: appointment.address_snapshot,
        p_travel_before_minutes: appointment.travel_before_minutes,
        p_travel_after_minutes: appointment.travel_after_minutes,
        p_resource_name: appointment.resource_name,
        p_notes: appointment.notes,
        p_reminder_offsets: appointment.reminder_offsets,
      });
      if (error) throw error;
    },
    onSuccess: (_data, { appointment, status }) => {
      refreshScheduleFacts(
        cache,
        session?.user.id ?? "",
        appointment.pet_id,
        appointment.client_id,
      );
      toast.success(`${statusLabel(status)} saved`);
    },
    onError: (error) => toast.error(failureMessage(error)),
  });
  return {
    ...mutation,
    isPending: mutation.isPending || review.busy,
    reviewPending: review.pending,
    reviewError: review.error,
  };
}
