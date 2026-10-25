export const reviewStatusCopy: Record<string, string> = {
  not_required: "Not required", awaiting_review: "Awaiting review", approved: "Approved", rejected: "Rejected",
  not_configured: "Deadline not configured", not_assigned: "Deadline not assigned", historical_policy_unavailable: "Historical policy unavailable",
  calendar_unavailable: "Calendar unavailable", not_due: "Not yet due", overdue: "Overdue", completed_on_time: "Completed on time",
  completed_late: "Completed late", completed_time_unassessable: "Completion timing unavailable", available: "Available",
  blocked: "Unavailable", terminal: "Already decided", none: "Eligible for review", own_record: "Original performer cannot review",
  no_current_policy: "No current review policy", disabled_current_policy: "Current review policy is disabled", no_read_eligibility: "Read permission unavailable",
  no_review_eligibility: "Review permission unavailable", unsupported_provenance: "Source evidence unavailable", evidence_limit_exceeded: "Evidence exceeds the review limit",
  terminal_outcome: "Recorded decision is final", kind_not_configured: "Event kind not configured", other_native_kind_selected: "Another event kind sets this deadline",
  no_policy_at_anchor: "No historical policy at the event time", policy_disabled_at_anchor: "Historical policy was disabled",
  missing_managed_dispense_family: "Original dispense evidence unavailable", family_site_unproven: "Original dispense site unproven",
  anchor_outside_calendar_range: "Event outside the calendar range", anchor_outside_coverage: "Event outside calendar coverage",
  no_later_staffed_day_in_coverage: "No later staffed day in calendar coverage", site_unproven: "Event site unproven",
};
