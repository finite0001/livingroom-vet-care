import type { ReviewContext, ImportedHistory } from "./history-state";
const literal = (v: unknown) =>
  v === undefined || v === null
    ? "Not supplied"
    : typeof v === "string"
      ? v
      : JSON.stringify(v);
interface Props {
  history: ImportedHistory | NonNullable<ReviewContext["history_source"]>;
  frozen?: boolean;
}
export function ImportedHistoryEvidence({ history, frozen = false }: Props) {
  return (
    <article className="space-y-2 rounded-md border p-3">
      <h4 className="font-semibold">
        ezyVet history {history.source.history_id}
      </h4>
      <p className="break-all text-sm">
        {history.source.origin} · site {history.source.site_uid} · source animal{" "}
        {history.source.animal_id}
      </p>
      {"approved_by" in history && (
        <p className="text-sm">
          Source import reviewed by {history.approved_by} at{" "}
          {history.approved_at}. This is not a source clinician signature.
        </p>
      )}
      {"current" in history && (
        <p className="text-sm">
          {frozen
            ? "Freshness when preparation was frozen"
            : "Current source state"}
          :{" "}
          {history.current.is_current
            ? "exact approved observation remains current"
            : "source changed or current scoped evidence is unavailable"}
          .
        </p>
      )}
      <dl className="space-y-2">
        {[
          ["Source narrative", history.original.comments],
          ["Original section (uninterpreted)", history.original.history_system],
          ["Original chain (uninterpreted)", history.original.chain],
          [
            "Original date/timestamp (uninterpreted)",
            history.original.timestamp,
          ],
          ["Source clinician reference (unverified)", history.original.vet_id],
          ["Original active value", history.original.active],
          ["Source consult reference", history.original.consult_id],
        ].map(([label, value]) => (
          <div key={String(label)}>
            <dt className="font-medium">{String(label)}</dt>
            <dd className="whitespace-pre-wrap break-words">
              {literal(value)}
            </dd>
          </div>
        ))}
      </dl>
      <p>
        Consult context:{" "}
        {history.consult.status === "verified"
          ? `verified patient-scoped reference ${history.consult.external_id}`
          : history.consult.status === "unresolved"
            ? "unresolved; no verified consult context is asserted"
            : "no consult context referenced by this approval"}
        .
      </p>
    </article>
  );
}
export function FrozenHistoryReview({ context }: { context: ReviewContext }) {
  return (
    <div className="space-y-3">
      <p>
        This is the exact source context saved for this request. Current source
        and patient eligibility will be checked again when approving.
      </p>
      {context.history_source && (
        <ImportedHistoryEvidence history={context.history_source} frozen />
      )}
      {context.histories.map((h) => (
        <ImportedHistoryEvidence key={h.id} history={h} frozen />
      ))}
    </div>
  );
}
