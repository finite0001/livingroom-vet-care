import type { ImportedVaccination } from "./vaccination-review-state";
interface RawProps {
  original: Record<string, unknown>;
}
interface ReviewedProps {
  vaccination: ImportedVaccination;
}
export function RawVaccinationEvidence({ original }: RawProps) {
  return (
    <details>
      <summary>Original ezyVet vaccination values</summary>
      <dl className="mt-2 grid gap-2 md:grid-cols-2">
        {Object.entries(original).map(([key, value]) => (
          <div key={key} className="min-w-0">
            <dt className="text-xs text-muted-foreground">
              Source {key.replace(/_/g, " ")}
            </dt>
            <dd className="whitespace-pre-wrap break-words text-sm">
              {value === null
                ? "Not supplied"
                : typeof value === "object"
                  ? JSON.stringify(value)
                  : String(value)}
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
export function ImportedVaccinationEvidence({ vaccination: v }: ReviewedProps) {
  return (
    <article
      className="space-y-3 rounded-md border p-4"
      aria-label={`Outside vaccination ${v.source.vaccination_id} version ${v.version}`}
    >
      <h3 className="font-semibold">
        Outside vaccination #{v.source.vaccination_id} · version {v.version}
      </h3>
      {!v.current.is_latest && <p>Superseded review — retained for history.</p>}
      {(!v.current.is_current || !v.current.identity_valid) && (
        <p role="note" className="text-clinical-alert">
          Source or patient context has changed since this review. The saved
          interpretation remains unchanged.
        </p>
      )}
      <dl className="grid gap-3 text-sm md:grid-cols-2">
        <div>
          <dt>Reviewed status</dt>
          <dd>{v.reviewed.status.replace(/_/g, " ")}</dd>
        </div>
        <div>
          <dt>Reviewed administration date</dt>
          <dd>
            {v.reviewed.administered_on ??
              v.reviewed.administration_date_status}
          </dd>
        </div>
        <div>
          <dt>Reviewed source next date</dt>
          <dd>
            {v.reviewed.source_next_due_on ?? v.reviewed.next_date_status} ·
            historical evidence only
          </dd>
        </div>
        <div>
          <dt>Local product interpretation</dt>
          <dd>
            {v.product
              ? `${v.product.name} (catalog version ${v.product.version})`
              : "No local product selected"}
          </dd>
        </div>
        <div>
          <dt>Outside clinician attribution</dt>
          <dd>{v.reviewed.outside_author ?? "Unknown"}</dd>
        </div>
        <div>
          <dt>Dose, route, lot and manufacturer</dt>
          <dd>Not established by this review</dd>
        </div>
      </dl>
      <p className="whitespace-pre-wrap text-sm">
        Review rationale: {v.reason}
      </p>
      <p className="break-words text-xs text-muted-foreground">
        Reviewed by {v.approved_by} · {v.approved_at}
      </p>
      <p className="break-words text-xs text-muted-foreground">
        Source: {v.source.origin} · site {v.source.site_uid} · animal{" "}
        {v.source.animal_id} · vaccination revision {v.observed_head_version} ·
        consult {v.consult.external_id} revision{" "}
        {v.consult.observed_head_version}
      </p>
      <RawVaccinationEvidence original={v.original} />
      {v.correction_history.length > 0 && (
        <details>
          <summary>Review correction history</summary>
          <ul className="space-y-2">
            {v.correction_history.map((h) => (
              <li key={h.id}>
                Version {h.version} · {h.approved_by} · {h.approved_at}
                <p className="whitespace-pre-wrap">{h.reason}</p>
              </li>
            ))}
          </ul>
        </details>
      )}
    </article>
  );
}
