import { z } from "zod";
import { recordSchema } from "./attachment-review-history.ts";
import type { OriginalCapture } from "./attachment-capture-state.ts";
const uuid = z.string().uuid();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const decisionSchema = z
  .object({
    id: uuid,
    actor: uuid,
    pet: uuid,
    request: uuid,
    captureHash: hash,
    previous: uuid.nullable(),
    title: z
      .string()
      .min(1)
      .max(200)
      .refine((v) => v === v.trim()),
    reason: z
      .string()
      .min(1)
      .max(2000)
      .refine((v) => v === v.trim()),
  })
  .strict();
export interface AttachmentDecision extends z.infer<typeof decisionSchema> {}
export function parseAttachmentDecision(
  value: unknown,
  capture: OriginalCapture,
  actor: string,
) {
  const op = decisionSchema.parse(value);
  if (
    capture.status !== "ready" ||
    op.actor !== actor ||
    actor !== capture.requested_by ||
    op.pet !== capture.pet_id ||
    op.request !== capture.id ||
    op.captureHash !== capture.capture?.capture_hash ||
    op.previous === op.id
  )
    throw new Error("Decision scope differs");
  return op;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
const approved = recordSchema
  .extend({ source_context: z.record(z.unknown()) })
  .strict();
const cancellation = z
  .object({
    id: uuid,
    actor_id: uuid,
    request_id: uuid,
    pet_id: uuid,
    capture_hash: hash,
    created_at: z.string().datetime({ offset: true }),
  })
  .strict();
const outcomeSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("approved"),
      record: approved,
      cancellation: z.null(),
    })
    .strict(),
  z
    .object({ status: z.literal("canceled"), record: z.null(), cancellation })
    .strict(),
]);
export function parseAttachmentDecisionOutcome(
  value: unknown,
  op: AttachmentDecision,
  capture: OriginalCapture,
) {
  parseAttachmentDecision(op, capture, op.actor);
  if (value === null) return null;
  const outcome = outcomeSchema.parse(value);
  const row =
    outcome.status === "approved" ? outcome.record : outcome.cancellation;
  if (
    row.id !== op.id ||
    row.actor_id !== op.actor ||
    row.request_id !== op.request ||
    row.pet_id !== op.pet ||
    row.capture_hash !== op.captureHash
  )
    throw new Error("Decision outcome identity differs");
  if (outcome.status === "approved") {
    const r = outcome.record;
    const expected = {
      capture_contract: "canonical_api_original_v1",
      parent: capture.parent_context,
      run_id: capture.run_id,
      page: capture.page,
      ordinal: capture.ordinal,
      attachment_snapshot_id: capture.snapshot_id,
      attachment_observed_head_version: capture.observed_head_version,
      attachment_external_id: capture.external_id,
      file_id: capture.file_id,
      stable_metadata_sha256: capture.stable_metadata_sha256,
      raw_record_sha256: capture.raw_record_sha256,
      metadata: capture.metadata,
    };
    if (
      r.title !== op.title ||
      r.review_reason !== op.reason ||
      r.previous_record_id !== op.previous ||
      r.request_hash !== capture.request_hash ||
      r.animal_link_id !== capture.animal_link_id ||
      r.attachment_external_id !== capture.external_id ||
      r.source_origin !== capture.parent_context.source_origin ||
      r.source_site_uid !== capture.parent_context.source_site_uid ||
      (r.version === 1) !== (op.previous === null) ||
      canonical(r.source_context) !== canonical(expected)
    )
      throw new Error("Approved provenance differs");
  }
  return {
    ...outcome,
    version: outcome.status === "approved" ? outcome.record.version : null,
  };
}
