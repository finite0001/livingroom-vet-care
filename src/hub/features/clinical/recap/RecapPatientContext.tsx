import { recapPatientDetails, type RecapPatient } from "./model";

interface RecapPatientContextProps {
  patient: RecapPatient;
  capturedAt?: string;
}

export function RecapPatientContext({
  patient,
  capturedAt,
}: RecapPatientContextProps) {
  return (
    <section
      aria-label={capturedAt ? "Frozen patient context" : "Selected patient context"}
      className="min-w-0 space-y-2 rounded-md border border-border p-3"
    >
      <h4 className="break-words font-medium">
        {patient.name} · {patient.species}
      </h4>
      <p className="break-words text-xs text-muted-foreground">
        {capturedAt
          ? `Patient details at capture: ${capturedAt}. Later patient edits do not replace this snapshot.`
          : "Patient details in this selected source preview."}
      </p>
      <dl className="grid min-w-0 gap-2 sm:grid-cols-2">
        {recapPatientDetails(patient).map(({ label, value }) => (
          <div key={label} className="min-w-0">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="break-words text-sm">{value}</dd>
          </div>
        ))}
      </dl>
      {(patient.archived_at || patient.deceased_at) && (
        <p className="text-sm">
          Historical patient record. This recap does not enable new care or
          communication.
        </p>
      )}
    </section>
  );
}
