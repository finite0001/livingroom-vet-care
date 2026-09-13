import type { ProblemExtraction } from "./history-state";
export function ProblemImportEvidence({
  extractions,
}: {
  extractions: ProblemExtraction[];
}) {
  return (
    <div className="space-y-2">
      {extractions.map((e) => (
        <details key={e.id} className="mt-2 rounded border p-2">
          <summary>
            Reviewed ezyVet source evidence ·{" "}
            {e.action === "create"
              ? "locally authored finding"
              : "linked existing finding"}
          </summary>
          <p>
            Local review by {e.extracted_by} at {e.extracted_at}. Outside
            clinician references are not local signatures.
          </p>
          <p>
            {e.locally_edited
              ? "Local fields have changed since this review; original reviewed fields remain below."
              : "Local fields match the reviewed version."}
          </p>
          <p>
            {e.discrepancy.required
              ? "Source discrepancy requires review."
              : e.discrepancy.reviewed
                ? "A later source discrepancy review is recorded."
                : "Original source evidence retained."}
          </p>
          <dl>
            {Object.entries(e.problem_fields).map(([k, v]) => (
              <div key={k}>
                <dt className="font-medium">
                  Original reviewed {k.replace(/_/g, " ")}
                </dt>
                <dd className="whitespace-pre-wrap">
                  {v === null ? "Unknown" : String(v)}
                </dd>
              </div>
            ))}
          </dl>
          {e.sources.map((s) => (
            <p key={s.id} className="break-all text-sm">
              ezyVet history {s.source.history_id}, version {s.version} ·{" "}
              {s.source.origin} · site {s.source.site_uid} · source animal{" "}
              {s.source.animal_id}. Source import approved by {s.approved_by} at{" "}
              {s.approved_at}.
            </p>
          ))}
          {e.discrepancy.review_history.map((r) => (
            <p key={r.id}>
              Source discrepancy reviewed by {r.reviewed_by} at {r.reviewed_at};
              local fields unchanged.
            </p>
          ))}
        </details>
      ))}
    </div>
  );
}
