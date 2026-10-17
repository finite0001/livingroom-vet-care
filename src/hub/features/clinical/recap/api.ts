import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import {
  recapPolicySchema,
  recapPolicyRequestSchema,
  recapPolicyReceiptSchema,
  recapReserveSchema,
  recapSelectionSchema,
  recapPreviewSchema,
  recapIntentSchema,
  recapJobSchema,
  recapJobReadSchema,
  recapHistorySchema,
  recapDiscoverySchema,
  recapCitationReadSchema,
  recapReceiptSchema,
  normalizeRecapRefusal,
  verifyJobRead,
  verifyReviewReceipt,
  verifyReviewRequest,
  verifyPolicyReceipt,
  type PendingRecap,
  type JobRead,
  recapTimestampSchema,
  recapDateSchema,
} from "./model";
interface RpcClient {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: unknown }>;
}
const uuid = z
  .string()
  .uuid()
  .refine((value) => value === value.toLowerCase());
export class RecapApiError extends Error {
  refusal: ReturnType<typeof normalizeRecapRefusal>;
  constructor(error: unknown) {
    super("Recap action could not be confirmed.");
    this.refusal = normalizeRecapRefusal(error);
  }
}
async function call(name: string, args: Record<string, unknown>) {
  const { data, error } = await (supabase as unknown as RpcClient).rpc(
    name,
    args,
  );
  if (error) throw new RecapApiError(error);
  return data;
}
export async function readRecapPolicy(actor: string) {
  const value = z
    .object({ actor_id: uuid, policy: recapPolicySchema })
    .strict()
    .parse(
      await call("read_clinical_recap_policy", {
        p_actor_id: uuid.parse(actor),
      }),
    );
  if (value.actor_id !== actor) throw new RecapApiError(null);
  return value;
}
export async function listRecapSources(
  actor: string,
  pet: string,
  from: string | null,
  to: string | null,
  after: unknown = null,
) {
  const value = recapDiscoverySchema.parse(
    await call("list_clinical_recap_sources", {
      p_actor_id: uuid.parse(actor),
      p_pet_id: uuid.parse(pet),
      p_visit_from: from === null ? null : recapDateSchema.parse(from),
      p_visit_to: to === null ? null : recapDateSchema.parse(to),
      p_after:
        after === null
          ? null
          : z
              .object({ visit_at: recapTimestampSchema, id: uuid })
              .strict()
              .parse(after),
    }),
  );
  if (value.actor_id !== actor || value.pet_id !== pet)
    throw new RecapApiError(null);
  return value;
}
export async function previewRecap(
  actor: string,
  pet: string,
  selection: unknown,
) {
  const input = recapSelectionSchema.parse(selection);
  const value = recapPreviewSchema.parse(
    await call("preview_clinical_recap", {
      p_actor_id: uuid.parse(actor),
      p_pet_id: uuid.parse(pet),
      p_selection: input,
    }),
  );
  if (
    value.actor_id !== actor ||
    value.pet_id !== pet ||
    value.source_set.patient.id !== pet ||
    JSON.stringify(value.source_set.selection) !== JSON.stringify(input)
  )
    throw new RecapApiError(null);
  return value;
}
export async function reserveRecap(
  actor: string,
  id: string,
  request: unknown,
) {
  const input = recapReserveSchema.parse(request);
  const value = verifyJobRead(
    await call("reserve_clinical_recap", {
      p_actor_id: uuid.parse(actor),
      p_id: uuid.parse(id),
      p_request: input,
    }),
    actor,
    input.pet_id,
    id,
  );
  if (
    value.job.actor_id !== actor ||
    value.job.policy_version !== input.policy_version ||
    value.job.previous_job_id !== input.previous_job_id ||
    value.job.source_note !== input.source_note ||
    value.manifest.source_set.patient.version !== input.expected_pet_version ||
    value.manifest.source_fingerprint !== input.expected_source_fingerprint ||
    JSON.stringify(value.manifest.source_set.selection) !==
      JSON.stringify(input.selection)
  )
    throw new RecapApiError(null);
  return value;
}
export async function readRecapJob(actor: string, pet: string, id: string) {
  return verifyJobRead(
    await call("read_clinical_recap_job", {
      p_actor_id: uuid.parse(actor),
      p_id: uuid.parse(id),
    }),
    actor,
    pet,
    id,
  );
}
export async function listRecaps(
  actor: string,
  pet: string,
  after: unknown = null,
) {
  const value = recapHistorySchema.parse(
    await call("list_clinical_recaps", {
      p_actor_id: uuid.parse(actor),
      p_pet_id: uuid.parse(pet),
      p_after:
        after === null
          ? null
          : z
              .object({ created_at: recapTimestampSchema, id: uuid })
              .strict()
              .parse(after),
    }),
  );
  if (
    value.actor_id !== actor ||
    value.pet_id !== pet ||
    value.items.some((item) => item.pet_id !== pet)
  )
    throw new RecapApiError(null);
  return value;
}
export async function cancelRecapReservation(
  actor: string,
  pet: string,
  id: string,
) {
  const value = z
    .union([
      z.object({ cancelled: z.literal(true), job: z.null() }).strict(),
      z.object({ cancelled: z.literal(false), job: recapJobSchema }).strict(),
    ])
    .parse(
      await call("cancel_clinical_recap_reservation", {
        p_actor_id: uuid.parse(actor),
        p_id: uuid.parse(id),
      }),
    );
  if (
    !value.cancelled &&
    (value.job.actor_id !== actor ||
      value.job.pet_id !== pet ||
      value.job.id !== id)
  )
    throw new RecapApiError(null);
  return value;
}
export async function cancelRecapAttempt(
  actor: string,
  pet: string,
  intentInput: unknown,
) {
  const intent = recapIntentSchema.parse(intentInput);
  const value = z
    .object({ cancelled: z.boolean(), job: recapJobSchema })
    .strict()
    .parse(
      await call("cancel_clinical_recap_attempt", {
        p_actor_id: uuid.parse(actor),
        p_id: intent.attempt_id,
        p_job_id: intent.job_id,
        p_retry_of: intent.retry_of,
        p_reason: intent.reason,
        p_ack_cost: intent.ack_cost,
      }),
    );
  if (
    value.job.actor_id !== actor ||
    value.job.pet_id !== pet ||
    value.job.id !== intent.job_id
  )
    throw new RecapApiError(null);
  return value;
}
export async function processRecap(actor: string, pet: string, input: unknown) {
  const intent = recapIntentSchema.parse(input);
  const { data, error } = await supabase.functions.invoke(
    "clinical-recap-process",
    {
      body: {},
      headers: { "x-recap-intent": encodeURIComponent(JSON.stringify(intent)) },
    },
  );
  if (error) {
    if (error.context instanceof Response) {
      try {
        const body = await error.context.clone().json();
        throw new RecapApiError(body.error);
      } catch (failure) {
        if (failure instanceof RecapApiError) throw failure;
      }
    }
    throw new RecapApiError(error);
  }
  const value = verifyJobRead(
    recapJobReadSchema.parse(data),
    actor,
    pet,
    intent.job_id,
  );
  if (value.job.actor_id !== actor) throw new RecapApiError(null);
  return value;
}
export async function readRecapCitation(
  actor: string,
  job: z.infer<typeof recapJobReadSchema>,
  ref: string,
) {
  const value = recapCitationReadSchema.parse(
    await call("read_clinical_recap_citation", {
      p_actor_id: uuid.parse(actor),
      p_job_id: uuid.parse(job.job.id),
      p_source_ref: ref,
    }),
  );
  const source = job.manifest.source_set.sources.find(
    (item) => item.ref === ref,
  );
  if (
    !source ||
    value.actor_id !== actor ||
    value.pet_id !== job.job.pet_id ||
    value.job_id !== job.job.id ||
    value.manifest_id !== job.manifest.id ||
    value.manifest_sha256 !== job.manifest.sha256 ||
    value.source_ref !== ref ||
    JSON.stringify(value.source) !== JSON.stringify(source)
  )
    throw new RecapApiError(null);
  return value;
}
export async function reviewRecap(
  actor: string,
  pending: PendingRecap,
  request: unknown,
  job: JobRead,
) {
  if (pending.kind !== "review" || pending.actor_id !== actor)
    throw new RecapApiError(null);
  const input = verifyReviewRequest(request, pending, job);
  const value = verifyReviewReceipt(
    await call("save_clinical_recap_review", {
      p_actor_id: uuid.parse(actor),
      p_id: pending.action_id,
      p_request: input,
    }),
    pending,
    job,
    input,
  );
  if (
    value.review.decision !== input.decision ||
    value.review.review_note !== input.review_note ||
    value.review.accepted_claims.length !== input.accepted_claims.length ||
    input.accepted_claims.some(
      (claim) =>
        value.review.accepted_claims.find(
          (item) => item.claim_id === claim.claim_id,
        )?.reviewed_text !== claim.text,
    )
  )
    throw new RecapApiError(null);
  return value;
}
export async function recoverRecapReview(
  actor: string,
  pending: PendingRecap,
  job?: JobRead,
  request?: unknown,
) {
  if (pending.kind !== "review" || pending.actor_id !== actor)
    throw new RecapApiError(null);
  const value = await call("recover_clinical_recap_review", {
    p_actor_id: uuid.parse(actor),
    p_id: pending.action_id,
    p_job_id: pending.job_id,
  });
  return value === null
    ? null
    : verifyReviewReceipt(
        value,
        pending,
        job ?? (await readRecapJob(actor, pending.pet_id, pending.job_id)),
        request,
      );
}
export async function cancelRecapReview(
  actor: string,
  pending: PendingRecap,
  request?: unknown,
) {
  if (pending.kind !== "review" || pending.actor_id !== actor)
    throw new RecapApiError(null);
  const value = z
    .union([
      z.object({ cancelled: z.literal(true), receipt: z.null() }).strict(),
      z
        .object({ cancelled: z.literal(false), receipt: recapReceiptSchema })
        .strict(),
    ])
    .parse(
      await call("cancel_clinical_recap_review", {
        p_actor_id: uuid.parse(actor),
        p_id: pending.action_id,
        p_job_id: pending.job_id,
      }),
    );
  if ("receipt" in value && value.receipt)
    verifyReviewReceipt(
      value.receipt,
      pending,
      await readRecapJob(actor, pending.pet_id, pending.job_id),
      request,
    );
  return value;
}
export async function saveRecapPolicy(
  actor: string,
  action: string,
  request: unknown,
) {
  const input = recapPolicyRequestSchema.parse(request);
  const value = await call("save_clinical_recap_policy", {
    p_actor_id: uuid.parse(actor),
    p_id: uuid.parse(action),
    p_request: input,
  });
  return verifyPolicyReceipt(
    value,
    {
      actor_id: actor,
      action_id: action,
      expected_version: input.expected_version,
    },
    input,
  );
}
export async function recoverRecapPolicy(
  actor: string,
  action: string,
  expected: number,
  request?: unknown,
) {
  const value = await call("recover_clinical_recap_policy", {
    p_actor_id: uuid.parse(actor),
    p_id: uuid.parse(action),
  });
  return value === null
    ? null
    : verifyPolicyReceipt(
        value,
        { actor_id: actor, action_id: action, expected_version: expected },
        request,
      );
}
export async function cancelRecapPolicy(
  actor: string,
  action: string,
  expected: number,
  request?: unknown,
) {
  const value = z
    .union([
      z.object({ cancelled: z.literal(true), receipt: z.null() }).strict(),
      z
        .object({
          cancelled: z.literal(false),
          receipt: recapPolicyReceiptSchema,
        })
        .strict(),
    ])
    .parse(
      await call("cancel_clinical_recap_policy", {
        p_actor_id: uuid.parse(actor),
        p_id: uuid.parse(action),
      }),
    );
  if ("receipt" in value && value.receipt)
    verifyPolicyReceipt(
      value.receipt,
      {
        actor_id: actor,
        action_id: action,
        expected_version: expected,
      },
      request,
    );
  return value;
}
