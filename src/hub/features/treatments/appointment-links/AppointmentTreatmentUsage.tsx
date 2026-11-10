import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { useAuth } from "@/hub/contexts/auth-context";
import { stockContextRpc } from "../../inventory/restocking/api";
import { errorMessage, practiceTimestamp } from "../../inventory/stock-policy";
const usageSchema = z.array(
  z.object({
    id: z.string().guid(),
    pet_id: z.string().guid(),
    product_name: z.string(),
    administered_at: z.string().datetime({ offset: true }),
    quantity: z.number(),
    dose: z.string(),
    corrected: z.boolean(),
  }),
);
interface AppointmentTreatmentUsageProps {
  petId: string;
  appointmentId: string;
}
export function AppointmentTreatmentUsage({
  petId,
  appointmentId,
}: AppointmentTreatmentUsageProps) {
  const { session } = useAuth();
  const query = useQuery({
    queryKey: [
      "treatment-appointment",
      session?.user.id,
      "usage",
      petId,
      appointmentId,
    ],
    enabled: !!session,
    queryFn: async () => {
      const rows = usageSchema.parse(
        await stockContextRpc("read_appointment_treatment_usage", {
          p_pet_id: petId,
          p_appointment_id: appointmentId,
        }),
      );
      if (rows.some((r) => r.pet_id !== petId))
        throw new Error("Appointment usage patient differs.");
      return rows;
    },
  });
  return (
    <section
      aria-label="Appointment treatment usage"
      className="mt-3 space-y-1 text-sm"
    >
      <h3 className="font-medium">Recorded treatments</h3>
      {query.isPending && <p role="status">Loading visit usage…</p>}
      {query.error && (
        <p role="alert" className="text-destructive">
          {errorMessage(query.error)}{" "}
          <button className="underline" onClick={() => void query.refetch()}>
            Retry
          </button>
        </p>
      )}
      {query.data?.length === 0 && (
        <p className="text-muted-foreground">
          No treatments linked to this visit.
        </p>
      )}
      {query.data?.map((r) => (
        <p key={r.id}>
          <Link
            className="underline"
            to={`/hub/whogot/source/administered/${r.id}?patient=${petId}`}
          >
            {r.product_name}
          </Link>{" "}
          · {r.dose || `${r.quantity} stock units`} ·{" "}
          {practiceTimestamp(r.administered_at)}
          {r.corrected && " · corrected; review source"}
        </p>
      ))}
    </section>
  );
}
