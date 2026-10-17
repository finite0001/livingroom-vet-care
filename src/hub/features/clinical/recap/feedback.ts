import { normalizeRecapRefusal } from "./model";
import { RecapApiError } from "./api";
const messages: Record<string, string> = {
  invalid_request:
    "Review the selected sources and required fields before continuing.",
  authentication_required: "Sign in again before continuing.",
  forbidden: "This action is not available to your current staff account.",
  not_found: "The requested recap or source is unavailable.",
  operation_unavailable:
    "The recap action could not be confirmed. Recover its original state before retrying.",
  policy_unapproved:
    "Practice approval is pending. Recap processing remains off.",
  policy_changed:
    "The recap policy changed. Review the current policy before a new action.",
  source_changed:
    "Selected sources changed. Your local edits are retained; preview a fresh selection before a new capture.",
  source_unavailable:
    "Selected sources are currently unavailable. Retained evidence is historical.",
  empty_selection:
    "Choose at least one eligible signed encounter or a nonempty native problem group.",
  budget_exceeded:
    "This selection exceeds the recap limits. Reduce the selection and preview again; no content was clipped.",
  identity_conflict:
    "The recap identity or pinned source differs. Recover the original saved job.",
  intent_conflict:
    "This action identifier already belongs to a different request. Recover or cancel its original action.",
  action_cancelled:
    "The original action was durably canceled. It cannot be submitted later.",
  review_conflict:
    "Another review or source change prevents this decision. Your local edits are retained.",
  attempt_active:
    "The original processing attempt is still active. Recover it before another attempt.",
  retry_not_allowed:
    "A new attempt is not available yet. Review the original attempt and any cooldown.",
  processing_disabled:
    "Recap processing is not activated on this backend. The saved source remains available; cancel any undispatched attempt before editing.",
  rate_limited:
    "The recap processing limit has been reached. No automatic retry will run.",
  provider_rejected:
    "The provider did not complete a usable recap. Review the attempt before an explicitly authorized retry.",
  provider_unavailable:
    "The provider is currently unavailable. Recover the attempt before retrying.",
  provider_uncertain:
    "The provider outcome is uncertain and may have incurred a charge. Recover the original attempt first.",
  invalid_provider_output:
    "The generated result did not satisfy the source and output checks. It was not accepted as a recap.",
};
export function recapFeedback(error: unknown) {
  const refusal =
    error instanceof RecapApiError
      ? error.refusal
      : normalizeRecapRefusal(error);
  return {
    refusal,
    message: messages[refusal.code] ?? messages.operation_unavailable,
  };
}
