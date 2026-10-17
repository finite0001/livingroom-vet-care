import {
  budgetLabels,
  budgetLimits,
  excerptParts,
  sourceReasonLabels,
  type RecapSource,
  type JobRead,
  type recapSourceSetSchema,
} from "./model";
import { z } from "zod";
import { formatDateTime } from "@/hub/features/patient-360/model";
import { RecapPatientContext } from "./RecapPatientContext";
interface SourceContentProps {
  source: RecapSource;
  fieldPath?: string;
  quote?: string;
}
export function SourceSummary({ source }: { source: RecapSource }) {
  const metadata = source.metadata;
  if (
    source.kind === "signed_encounter" &&
    "visit_at" in metadata &&
    "signed_at" in metadata
  )
    return (
      <span>
        Signed visit · {formatDateTime(metadata.visit_at)} · signed{" "}
        {formatDateTime(metadata.signed_at)} (Denver)
      </span>
    );
  if (source.kind === "addendum" && "created_at" in metadata)
    return (
      <span>
        Clinical addendum · authored {formatDateTime(metadata.created_at)}{" "}
        (Denver)
      </span>
    );
  return (
    <span>
      Native problem record
      {"updated_at" in metadata
        ? ` · updated ${formatDateTime(metadata.updated_at)} (Denver)`
        : ""}
    </span>
  );
}
export function SourceContent({
  source,
  fieldPath,
  quote,
}: SourceContentProps) {
  const citedField = fieldPath?.replace(/^fields\./, "");
  return (
    <article
      className="min-w-0 space-y-3 rounded-md border border-border p-3"
      aria-label={`Captured source ${source.ref}`}
    >
      <h5 className="break-words font-medium">
        <SourceSummary source={source} />
      </h5>
      {Object.entries(source.fields)
        .sort(
          ([left], [right]) =>
            Number(right === citedField) - Number(left === citedField),
        )
        .map(([key, value]) => (
          <section key={key} className="min-w-0">
            <h6 className="font-medium capitalize">{key.replace(/_/g, " ")}</h6>
            <p className="whitespace-pre-wrap break-words text-sm">
              {typeof value !== "string"
                ? "Not recorded"
                : fieldPath === `fields.${key}` && quote
                  ? excerptParts(value, quote).map((part, i) =>
                      part.highlighted ? (
                        <mark key={i} className="bg-warning/20 text-foreground">
                          {part.text}
                        </mark>
                      ) : (
                        part.text
                      ),
                    )
                  : value || "No text recorded."}
            </p>
          </section>
        ))}
      <details className="min-w-0 rounded-md border border-border p-3">
        <summary className="min-h-11 cursor-pointer font-medium text-sm">
          Source audit details
        </summary>
        <div className="min-w-0 space-y-2 text-xs text-muted-foreground">
          <p className="break-all">
            Source {source.ref} · {source.kind} · record {source.id} · patient{" "}
            {source.pet_id} · version{" "}
            {source.version === null
              ? "Not versioned (append-only)"
              : source.version}
          </p>
          <p className="break-all">SHA256 {source.sha256}</p>
          <dl className="grid min-w-0 gap-2 sm:grid-cols-2">
            {Object.entries(source.metadata).map(([key, value]) => (
              <div key={key} className="min-w-0">
                <dt>{key.replace(/_/g, " ")}</dt>
                <dd className="break-words">
                  {String(value ?? "Not recorded")}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </details>
    </article>
  );
}
export function RecapSourcePreview({
  sourceSet,
  capturedAt,
}: {
  sourceSet: z.infer<typeof recapSourceSetSchema>;
  capturedAt?: string;
}) {
  return (
    <section
      aria-label={
        capturedAt ? "Captured recap sources" : "Selected source preview"
      }
      className="min-w-0 space-y-3"
    >
      <h4 className="font-medium">
        {capturedAt
          ? "Frozen source manifest"
          : "Exact selected source preview"}
      </h4>
      <p className="break-words text-sm">
        {sourceSet.patient.name} · {sourceSet.patient.species}
        {capturedAt ? ` · captured ${formatDateTime(capturedAt)} (Denver)` : ""}
      </p>
      <RecapPatientContext patient={sourceSet.patient} capturedAt={capturedAt} />
      <dl className="grid min-w-0 gap-2 sm:grid-cols-2">
        {Object.entries(budgetLimits).map(([key, limit]) => (
          <div key={key} className="rounded-md border border-border p-2">
            <dt className="text-xs text-muted-foreground">
              {budgetLabels[key]}
            </dt>
            <dd className="text-sm">
              {sourceSet.budgets[key].toLocaleString()} /{" "}
              {limit.toLocaleString()}
            </dd>
          </div>
        ))}
      </dl>
      <p className="text-sm text-muted-foreground">
        Visit dates constrain encounter selection only. Every selected encounter
        includes all its addenda, including later entries. Native problem status
        is recorded as of capture; unknown onset remains unknown.
      </p>
      <p className="break-words text-sm">
        Outside-linked problem exclusions:{" "}
        {sourceSet.exclusions.outside_linked_problem_count === null
          ? "Problem group not selected"
          : sourceSet.exclusions.outside_linked_problem_count}
        . Omitted families:{" "}
        {sourceSet.exclusions.unsupported_families
          .map((value) => value.replace(/_/g, " "))
          .join(", ") || "None listed"}
        .
      </p>
      <p className="text-sm text-muted-foreground">
        Narrative medication or vaccine mentions do not establish complete
        medication reconciliation, administrations, due dates or current vaccine
        status.
      </p>
      {sourceSet.sources.map((source) => (
        <details
          key={source.ref}
          className="min-w-0 rounded-md border border-border p-3"
        >
          <summary className="min-h-11 cursor-pointer break-words text-sm font-medium">
            <SourceSummary source={source} />
          </summary>
          <SourceContent source={source} />
        </details>
      ))}
      <details className="min-w-0 rounded-md border border-border p-3">
        <summary className="min-h-11 cursor-pointer text-sm font-medium">
          Source audit details
        </summary>
        <p className="break-all text-xs text-muted-foreground">
          Patient {sourceSet.patient.id} · version {sourceSet.patient.version}
          {capturedAt ? ` · exact capture time ${capturedAt}` : ""}
        </p>
      </details>
    </section>
  );
}
export function RecapCurrentStatus({
  current,
}: {
  current: JobRead["current"];
}) {
  return (
    <div
      role="status"
      className="space-y-1 rounded-md border border-border p-3 text-sm"
    >
      <p className="font-medium">
        Selected source status: {current.source_status}
      </p>
      {current.reasons.map((reason) => (
        <p key={reason}>{sourceReasonLabels[reason]}</p>
      ))}
      {current.source_status !== "current" && (
        <p>
          This is retained historical evidence. Acceptance is unavailable;
          sources will not be silently replaced.
        </p>
      )}
    </div>
  );
}
