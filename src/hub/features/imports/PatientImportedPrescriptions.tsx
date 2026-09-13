import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hub/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { ImportedPrescriptionEvidence } from "./ImportedPrescriptionEvidence";
import { listPatientImportedPrescriptions } from "./prescription-review-api";
import type { PrescriptionCursor } from "./prescription-review-state";
interface Props {
  petId: string;
}
export function PatientImportedPrescriptions({ petId }: Props) {
  const { user, profile } = useAuth();
  return user && profile?.is_active ? (
    <OutsidePrescriptions
      key={`${user.id}:${petId}`}
      actor={user.id}
      petId={petId}
    />
  ) : null;
}
interface InnerProps extends Props {
  actor: string;
}
function OutsidePrescriptions({ actor, petId }: InnerProps) {
  const [cursor, setCursor] = useState<PrescriptionCursor | null>(null);
  const history = useQuery({
    queryKey: ["patient-imported-prescriptions", actor, petId, cursor],
    queryFn: () => listPatientImportedPrescriptions(petId, cursor),
    retry: false,
  });
  return (
    <section
      aria-label="Outside prescription history"
      className="space-y-4 rounded-md border p-4"
    >
      <h2 className="text-lg font-semibold">Outside prescription history</h2>
      <p className="text-sm text-muted-foreground">
        Veterinarian-reviewed outside prescribing history. These records do not
        authorize local prescriptions, refills or dispensing.
      </p>
      {history.isLoading && (
        <p role="status">Loading outside prescription history…</p>
      )}
      {history.isError && (
        <p role="alert">
          Outside prescription history unavailable. Refresh to try again.
        </p>
      )}
      {history.data?.prescriptions.length === 0 && (
        <p>No reviewed outside prescriptions on this page.</p>
      )}
      {history.data?.prescriptions.map((v) => (
        <ImportedPrescriptionEvidence key={v.id} prescription={v} />
      ))}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={history.isFetching}
          onClick={() => void history.refetch()}
        >
          Refresh outside prescriptions
        </Button>
        <Button
          variant="outline"
          disabled={!cursor || history.isFetching}
          onClick={() => setCursor(null)}
        >
          Newest outside prescriptions
        </Button>
        <Button
          variant="outline"
          disabled={!history.data?.next_cursor || history.isFetching}
          onClick={() => setCursor(history.data!.next_cursor)}
        >
          Older outside prescriptions
        </Button>
      </div>
    </section>
  );
}
