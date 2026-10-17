import { recapFeedback } from "./feedback";
import { budgetLabels, sourceReasonLabels } from "./model";
export function RecapFeedback({ error }: { error: unknown }) {
  if (!error) return null;
  const { refusal, message } = recapFeedback(error);
  return (
    <div role="alert" className="min-w-0 space-y-1 text-sm text-destructive">
      <p>{message}</p>
      {refusal.source_reasons.map((reason) => (
        <p key={reason}>{sourceReasonLabels[reason]}</p>
      ))}
      {refusal.budget_violations.map((item) => (
        <p key={item.dimension}>
          {budgetLabels[item.dimension]}: {item.observed.toLocaleString()} /{" "}
          {item.limit.toLocaleString()}
        </p>
      ))}
      {refusal.retry_after_seconds !== null && (
        <p>
          Retry is subject to a cooldown of {refusal.retry_after_seconds}{" "}
          seconds.
        </p>
      )}
    </div>
  );
}
