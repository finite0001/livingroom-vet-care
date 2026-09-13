import type {
  ImportedPrescription,
  PrescriptionItemEvidence,
} from "./prescription-review-state";
interface RawProps {
  original: Record<string, unknown>;
  label: string;
}
const rawText = (value: unknown) =>
  value === null || value === undefined
    ? "Not supplied"
    : typeof value === "object"
      ? JSON.stringify(value)
      : String(value);
export function RawPrescriptionEvidence({ original, label }: RawProps) {
  return (
    <details>
      <summary>{label}</summary>
      <dl className="mt-2 grid gap-2 md:grid-cols-2">
        {Object.entries(original).map(([key, value]) => (
          <div key={key} className="min-w-0">
            <dt className="text-xs text-muted-foreground">
              Source {key.replace(/_/g, " ")}
            </dt>
            <dd className="whitespace-pre-wrap break-words text-sm">
              {rawText(value)}
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
interface ItemProps {
  item: PrescriptionItemEvidence;
}
export function ImportedPrescriptionItem({ item }: ItemProps) {
  return (
    <div className="space-y-2 rounded-md border p-3">
      <h4 className="font-medium">
        {item.product?.name ??
          `Outside medication item #${item.source.external_id}`}
      </h4>
      <dl className="grid gap-2 text-sm md:grid-cols-2">
        <div>
          <dt>Source instructions</dt>
          <dd className="whitespace-pre-wrap break-words">
            {rawText(item.source.original.instructions)}
          </dd>
        </div>
        <div>
          <dt>Source quantity / remaining</dt>
          <dd>
            {rawText(item.source.original.qty)} /{" "}
            {rawText(item.source.original.remaining)}
          </dd>
        </div>
        <div>
          <dt>Reviewed start date</dt>
          <dd>{item.reviewed.start_on ?? item.reviewed.start_date_status}</dd>
        </div>
        <div>
          <dt>Catalog reference</dt>
          <dd>
            {item.product
              ? `${item.product.name} · version ${item.product.version} · ${item.product.unit}`
              : "No local catalog match"}
          </dd>
        </div>
      </dl>
      {item.reviewed.note && (
        <p className="whitespace-pre-wrap break-words text-sm">
          Separate interpretation: {item.reviewed.note}
        </p>
      )}
      <RawPrescriptionEvidence
        original={item.source.original}
        label={`Original source item ${item.source.external_id}`}
      />
    </div>
  );
}
interface Props {
  prescription: ImportedPrescription;
}
export function ImportedPrescriptionEvidence({ prescription: v }: Props) {
  const c = v.context;
  const issues = c.reconciliation;
  return (
    <article
      aria-label={`Outside prescription ${v.prescription_external_id} version ${v.version}`}
      className="space-y-3 rounded-md border p-4"
    >
      <h3 className="font-semibold">
        Outside prescription #{v.prescription_external_id} · version {v.version}
      </h3>
      {!v.current.is_latest && (
        <p className="text-sm">Superseded review — retained for history.</p>
      )}
      {(!v.current.is_current || !v.current.identity_valid) && (
        <p role="note" className="text-sm text-clinical-alert">
          Source or patient context has changed since this review. The saved
          interpretation remains unchanged.
        </p>
      )}
      <dl className="grid gap-3 text-sm md:grid-cols-2">
        <div>
          <dt>Reviewed historical status</dt>
          <dd>{c.reviewed.status}</dd>
        </div>
        <div>
          <dt>Reviewed prescription date</dt>
          <dd>
            {c.reviewed.prescribed_on ?? c.reviewed.prescription_date_status}
          </dd>
        </div>
        <div>
          <dt>Outside prescriber interpretation</dt>
          <dd>{c.reviewed.outside_author ?? "Unknown"}</dd>
        </div>
        <div>
          <dt>Original prescriber reference</dt>
          <dd>{rawText(c.parent.original.prescribing_vet_user_id)}</dd>
        </div>
      </dl>
      <p className="whitespace-pre-wrap break-words text-sm">
        Review rationale: {v.reason}
      </p>
      {c.reviewed.completeness === "partial" && (
        <p
          role="note"
          className="whitespace-pre-wrap break-words rounded-md bg-muted p-3 text-sm"
        >
          Partial historical account: {c.reviewed.partial_reason}
        </p>
      )}
      {issues.status === "unresolved" && (
        <details>
          <summary>Unresolved source item accounting</summary>
          <dl className="space-y-2 text-sm">
            <div>
              <dt>Source list supplied / scan finished</dt>
              <dd>
                {issues.sourceListPresent ? "Yes" : "No"} /{" "}
                {issues.scanComplete ? "Yes" : "No"}
              </dd>
            </div>
            {[
              ["Missing references", issues.missingIds],
              ["Unexpected references", issues.unexpectedIds],
              ["Duplicate source references", issues.duplicateSourceIds],
              ["Duplicate observations", issues.duplicateObservedIds],
            ].map(([label, values]) => (
              <div key={String(label)}>
                <dt>{label}</dt>
                <dd>{(values as string[]).join(", ") || "None"}</dd>
              </div>
            ))}
            <div>
              <dt>Malformed references</dt>
              <dd className="whitespace-pre-wrap break-words">
                {[
                  ...issues.invalidSourceReferences,
                  ...issues.invalidObservedReferences,
                ].length
                  ? JSON.stringify([
                      ...issues.invalidSourceReferences,
                      ...issues.invalidObservedReferences,
                    ])
                  : "None"}
              </dd>
            </div>
          </dl>
        </details>
      )}
      {v.items.map((item) => (
        <ImportedPrescriptionItem key={item.source.snapshot_id} item={item} />
      ))}
      {v.items.length === 0 && (
        <p className="text-sm">
          No medication items were selected for this historical account.
        </p>
      )}
      {c.omitted_items.length > 0 && (
        <details>
          <summary>
            Observed items omitted from this account ({c.omitted_items.length})
          </summary>
          {c.omitted_items.map((item) => (
            <RawPrescriptionEvidence
              key={`${item.snapshot_id}:${item.page}`}
              original={item.original}
              label={`Omitted source item ${item.external_id}`}
            />
          ))}
        </details>
      )}
      <p className="break-words text-xs text-muted-foreground">
        Reviewed by {v.approved_by} · {v.approved_at}
      </p>
      <p className="break-words text-xs text-muted-foreground">
        Source: {v.source_origin} · site {v.source_site_uid} · animal{" "}
        {c.source.animal_id} · prescription revision{" "}
        {c.parent.observed_head_version}
      </p>
      <RawPrescriptionEvidence
        original={c.parent.original}
        label="Original ezyVet prescription values"
      />
      <details>
        <summary>Review correction history</summary>
        <ul className="space-y-2 text-sm">
          {v.correction_history.map((h) => (
            <li key={h.id}>
              Version {h.version} · {h.approved_by} · {h.approved_at}
              <p className="whitespace-pre-wrap break-words">{h.reason}</p>
            </li>
          ))}
        </ul>
      </details>
    </article>
  );
}
