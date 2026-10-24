import { z } from "zod";
import { ExactJsonNumber, protocolInteger } from "./exact-json.ts";
import { reviewDigestSchema, reviewUuidSchema } from "./request.ts";

export const reviewEventKindSchema = z.enum([
  "receive_inventory", "adjust_inventory", "record_patient_treatment", "record_anesthesia_drug_administration",
  "record_native_dispense", "record_native_pickup", "record_native_dispense_return:intake", "record_native_dispense_return:dispose",
  "record_native_dispense_return:restock", "record_native_dispense_return_v2:intake", "record_native_dispense_return_v2:dispose",
  "record_native_dispense_return_v2:restock", "record_native_dispense_return_v2:retract_intake", "record_native_dispense_return_v2:retract_disposal",
  "record_native_dispense_return_v2:retract_restock", "record_native_return_discrepancy:report", "record_native_return_discrepancy:note",
  "record_native_return_discrepancy:resolve_corrected", "record_native_return_discrepancy:resolve_confirmed_original",
  "append_native_dispense_correction:clinical_annotation", "append_native_dispense_correction:operational_annotation", "append_native_dispense_correction:pickup_amendment",
]);
const sequence = z.string().regex(/^(0|[1-9][0-9]*)$/).max(19).refine(value => BigInt(value) <= 9223372036854775807n);
const positiveSequence = sequence.refine(value => value !== "0");
const instant = z.string().datetime({ offset: true }).refine(value => Number.isFinite(Date.parse(value)));
const wireInt = (min: number, max: number) => z.preprocess(value => value instanceof ExactJsonNumber ? protocolInteger(value, min, max) : value, z.number().int().min(min).max(max));
const scope = { actor_id: reviewUuidSchema, product_id: reviewUuidSchema, site_id: reviewUuidSchema.nullable(), event_kind: reviewEventKindSchema.nullable(), view: z.enum(["site", "exceptions"]) };
const scopeSchema = z.object(scope);
interface ReviewQueueScope extends z.infer<typeof scopeSchema> {}
const cursorSchema = z.object({ version: wireInt(3, 3), ...scope, after_sequence: sequence, high_water: sequence,
  read_eligibility_id: reviewUuidSchema, read_authorization_hash: reviewDigestSchema,
}).strict().refine(value => BigInt(value.after_sequence) <= BigInt(value.high_water));
export const reviewQueueRequestSchema = z.object({ ...scope, page_size: z.number().int().min(1).max(100), cursor: cursorSchema.nullable() }).strict()
  .superRefine((value, ctx) => {
    if (value.view === "site" ? value.site_id === null || value.event_kind === null : value.site_id !== null || value.event_kind !== null)
      ctx.addIssue({ code: "custom", message: "Queue view requires its exact site/kind scope" });
    if (value.cursor && !sameScope(value, value.cursor)) ctx.addIssue({ code: "custom", message: "Queue cursor belongs to another scope" });
  });
export interface ReviewQueueRequest extends z.infer<typeof reviewQueueRequestSchema> {}
export const reviewSummarySchema = z.object({
  event_id: reviewUuidSchema, event_sequence: positiveSequence, event_kind: reviewEventKindSchema,
  site_basis: z.enum(["event_transitions", "managed_dispense", "managed_pickup", "managed_return", "opening_custody_site", "unproven"]), site_id: reviewUuidSchema.nullable(),
  observed_at: instant.nullable(), recorded_at: instant,
  review_state: z.enum(["not_required", "awaiting_review", "approved", "rejected"]),
  deadline_state: z.enum(["not_required", "not_configured", "not_assigned", "historical_policy_unavailable", "calendar_unavailable", "not_due", "overdue", "completed_on_time", "completed_late", "completed_time_unassessable"]),
  deadline_basis: z.enum(["not_required", "configured", "not_configured", "not_assigned", "historical_policy_unavailable", "calendar_unavailable"]), due_at: instant.nullable(),
  unavailable_reason: z.enum(["kind_not_configured", "other_native_kind_selected", "no_policy_at_anchor", "policy_disabled_at_anchor", "missing_managed_dispense_family", "family_site_unproven", "anchor_outside_calendar_range", "anchor_outside_coverage", "no_later_staffed_day_in_coverage", "site_unproven"]).nullable(),
  signing_state: z.enum(["available", "blocked", "terminal"]),
  signing_reason: z.enum(["none", "not_required", "own_record", "no_current_policy", "disabled_current_policy", "no_read_eligibility", "no_review_eligibility", "unsupported_provenance", "evidence_limit_exceeded", "terminal_outcome"]),
}).strict().superRefine((value, ctx) => {
  if ((value.site_basis === "unproven") !== (value.site_id === null)) ctx.addIssue({ code: "custom", message: "Queue site evidence differs" });
  if (value.review_state === "not_required" && !(value.deadline_state === "not_required" && value.deadline_basis === "not_required" &&
    value.due_at === null && value.unavailable_reason === null && value.signing_state === "blocked" && value.signing_reason === "not_required"))
    ctx.addIssue({ code: "custom", message: "Not-required record cannot imply an obligation" });
  if (value.review_state !== "not_required") {
    const terminal = value.review_state === "approved" || value.review_state === "rejected";
    const timingMatches = terminal
      ? value.due_at === null ? value.deadline_state === "completed_time_unassessable" : ["completed_on_time", "completed_late"].includes(value.deadline_state)
      : value.due_at === null ? value.deadline_state === value.deadline_basis : ["not_due", "overdue"].includes(value.deadline_state);
    if ((value.signing_state === "terminal") !== terminal || (value.signing_reason === "terminal_outcome") !== terminal ||
      value.deadline_state.startsWith("completed_") !== terminal || value.deadline_basis === "not_required" || value.deadline_state === "not_required" ||
      (value.signing_state === "available") !== (value.signing_reason === "none") ||
      (value.deadline_basis === "configured") !== (value.due_at !== null) || (value.due_at !== null && value.unavailable_reason !== null) ||
      !timingMatches || value.signing_reason === "not_required" || (value.due_at === null && value.unavailable_reason === null) ||
      (value.site_basis === "unproven" && value.signing_state === "available"))
      ctx.addIssue({ code: "custom", message: "Queue review, deadline and signing evidence disagree" });
  }
});
export interface ReviewSummary extends z.infer<typeof reviewSummarySchema> {}
const pageSchema = z.object({ version: wireInt(3, 3), state: z.literal("page"), data: z.object({
  items: z.array(reviewSummarySchema).max(100), next_cursor: cursorSchema.nullable(), high_water: sequence,
  examined: wireInt(0, 100), coverage: z.literal("bounded_page"),
}).strict() }).strict();
export interface ReviewQueuePage extends z.infer<typeof pageSchema> {}
function sameScope(a: ReviewQueueScope, b: ReviewQueueScope) {
  return a.actor_id === b.actor_id && a.product_id === b.product_id && a.site_id === b.site_id && a.event_kind === b.event_kind && a.view === b.view;
}

/** Empty items with a continuation remains a valid, explicitly navigable page. */
export function verifyReviewQueuePage(input: unknown, response: unknown): ReviewQueuePage {
  const request = reviewQueueRequestSchema.parse(input), page = pageSchema.parse(response), data = page.data;
  const previous = request.cursor?.after_sequence ?? "0";
  const remaining = BigInt(data.high_water) - BigInt(previous);
  if (data.items.length > request.page_size || data.examined < data.items.length ||
    remaining < 0n || BigInt(data.examined) > remaining || (remaining > 0n && data.examined === 0) ||
    (request.cursor && data.high_water !== request.cursor.high_water)) throw new Error("Queue page bounds changed; restart the queue");
  const ids = new Set<string>(); let last = BigInt(previous);
  for (const item of data.items) {
    if (ids.has(item.event_id) || BigInt(item.event_sequence) <= last || BigInt(item.event_sequence) > BigInt(data.high_water) ||
      (request.view === "site" ? item.site_id !== request.site_id || item.event_kind !== request.event_kind : item.site_id !== null))
      throw new Error("Queue page does not match its exact scope and position");
    ids.add(item.event_id); last = BigInt(item.event_sequence);
  }
  const next = data.next_cursor;
  if (next && (!sameScope(request, next) || next.high_water !== data.high_water || BigInt(next.after_sequence) <= BigInt(previous) ||
    BigInt(next.after_sequence) >= BigInt(data.high_water) || BigInt(next.after_sequence) < last ||
    BigInt(data.examined) > BigInt(next.after_sequence) - BigInt(previous) ||
    (data.items.length < request.page_size && data.examined < 100) || data.examined === 0 || (request.cursor && (next.read_eligibility_id !== request.cursor.read_eligibility_id ||
      next.read_authorization_hash !== request.cursor.read_authorization_hash)))) throw new Error("Queue continuation changed; restart the queue");
  if (data.items.length === request.page_size &&
    (next ? BigInt(next.after_sequence) !== last : last !== BigInt(data.high_water)))
    throw new Error("Queue did not stop at its filled page; restart the queue");
  const endpoint = BigInt(next?.after_sequence ?? data.high_water);
  if (endpoint > last && data.examined <= data.items.length)
    throw new Error("Queue omitted its examined endpoint; restart the queue");
  return page;
}
