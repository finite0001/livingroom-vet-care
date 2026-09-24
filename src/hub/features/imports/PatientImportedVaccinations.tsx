import { useCallback, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hub/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { ImportedVaccinationEvidence } from "./ImportedVaccinationEvidence";
import { VaccinationHistoryReview } from "./VaccinationHistoryReview";
import { listPatientImportedVaccinations } from "./vaccination-review-api";
import type {
  ImportedVaccination,
  ReviewCursor,
} from "./vaccination-review-state";
interface Props {
  petId: string;
  patientVersion: number;
  disabled: boolean;
  onDirtyChange: (dirty: boolean) => void;
}
export function PatientImportedVaccinations(props: Props) {
  const { user, profile, hasRole } = useAuth();
  return user && profile?.is_active ? (
    <OutsideVaccinations
      key={`${user.id}:${props.petId}:${hasRole("DVM")}`}
      {...props}
      actor={user.id}
      dvm={hasRole("DVM")}
    />
  ) : null;
}
interface InnerProps extends Props {
  actor: string;
  dvm: boolean;
}
function OutsideVaccinations({
  actor,
  petId,
  patientVersion,
  disabled,
  onDirtyChange,
  dvm,
}: InnerProps) {
  const [cursor, setCursor] = useState<ReviewCursor | null>(null),
    [correction, setCorrection] = useState<ImportedVaccination | null>(null),
    [reviewDirty, setReviewDirty] = useState(false);
  const history = useQuery({
    queryKey: ["patient-imported-vaccinations", actor, petId, cursor],
    queryFn: () => listPatientImportedVaccinations(petId, cursor),
    retry: false,
  });
  const reportDirty = useCallback(
    (value: boolean) => {
      setReviewDirty(value);
      onDirtyChange(value);
    },
    [onDirtyChange],
  );
  if (
    !dvm &&
    !history.isLoading &&
    !history.isError &&
    cursor === null &&
    (history.data?.vaccinations.length ?? 0) === 0
  )
    return null;
  return (
    <section
      aria-label="Outside vaccination history"
      className="space-y-4 rounded-md border p-4"
    >
      <h2 className="text-lg font-semibold">Outside vaccination history</h2>
      <p className="text-sm">
        Veterinarian-reviewed ezyVet evidence, with the original source and
        review attribution preserved. These entries document outside care.
      </p>
      {history.isLoading && (
        <p role="status">Loading outside vaccination history…</p>
      )}
      {history.isError && (
        <p role="alert">Outside vaccination history unavailable.</p>
      )}
      {history.data?.vaccinations.length === 0 && (
        <p>No reviewed outside vaccinations on this page.</p>
      )}
      {history.data?.vaccinations.map((v) => (
        <div key={v.id} className="space-y-2">
          <ImportedVaccinationEvidence vaccination={v} />
          {dvm && v.current.is_latest && (
            <Button
              variant="outline"
              disabled={disabled || reviewDirty}
              onClick={() => setCorrection(v)}
            >
              Correct vaccination {v.source.vaccination_id} version {v.version}
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
          Refresh outside vaccination history
        </Button>
        <Button
          variant="outline"
          disabled={!cursor || history.isFetching}
          onClick={() => setCursor(null)}
        >
          Newest outside vaccinations
        </Button>
        <Button
          variant="outline"
          disabled={!history.data?.next_cursor || history.isFetching}
          onClick={() => setCursor(history.data!.next_cursor)}
        >
          Older outside vaccinations
        </Button>
      </div>
      {dvm && (
        <VaccinationHistoryReview
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
