import { PrescriptionHistoryReview } from "./PrescriptionHistoryReview";
import type { ImportedPrescription } from "./prescription-review-state";
import { useCallback, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hub/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { ImportedPrescriptionEvidence } from "./ImportedPrescriptionEvidence";
import { listPatientImportedPrescriptions } from "./prescription-review-api";
import type { PrescriptionCursor } from "./prescription-review-state";
interface Props {
  petId: string;
  patientVersion: number;
  disabled: boolean;
  onDirtyChange: (dirty: boolean) => void;
}
export function PatientImportedPrescriptions(props: Props) {
  const { user, profile, hasRole } = useAuth();
  return user && profile?.is_active ? (
    <OutsidePrescriptions
      key={`${user.id}:${props.petId}:${hasRole("DVM")}`}
      actor={user.id}
      {...props}
      dvm={hasRole("DVM")}
    />
  ) : null;
}
interface InnerProps extends Props {
  actor: string;
  dvm: boolean;
}
function OutsidePrescriptions({
  actor,
  petId,
  patientVersion,
  disabled,
  onDirtyChange,
  dvm,
}: InnerProps) {
  const [cursor, setCursor] = useState<PrescriptionCursor | null>(null);
  const [correction, setCorrection] = useState<ImportedPrescription | null>(
      null,
    ),
    [reviewDirty, setReviewDirty] = useState(false);
  const reportDirty = useCallback(
    (value: boolean) => {
      setReviewDirty(value);
      onDirtyChange(value);
    },
    [onDirtyChange],
  );
  const history = useQuery({
    queryKey: ["patient-imported-prescriptions", actor, petId, cursor],
    queryFn: () => listPatientImportedPrescriptions(petId, cursor),
    retry: false,
  });
  if (
    !dvm &&
    !history.isLoading &&
    !history.isError &&
    cursor === null &&
    (history.data?.prescriptions.length ?? 0) === 0
  )
    return null;
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
        <div key={v.id} className="space-y-2">
          <ImportedPrescriptionEvidence prescription={v} />
          {dvm && v.current.is_latest && (
            <Button
              variant="outline"
              disabled={disabled || reviewDirty}
              onClick={() => setCorrection(v)}
            >
              Correct prescription {v.prescription_external_id} version{" "}
              {v.version}
            </Button>
          )}
        </div>
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
      {dvm && (
        <PrescriptionHistoryReview
          actor={actor}
          petId={petId}
          patientVersion={patientVersion}
          disabled={disabled}
          onDirtyChange={reportDirty}
          correction={correction}
          onResetCorrection={() => setCorrection(null)}
        />
      )}
    </section>
  );
}
