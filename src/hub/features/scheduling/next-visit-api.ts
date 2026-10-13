import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import {
  nextVisitContextSchema,
  nextVisitQueueSchema,
  nextVisitCursorSchema,
  futureVisitPageSchema,
  dueCareCursorSchema,
  nextVisitDueCareSchema,
  nextVisitOutcomeValuesSchema,
  nextVisitCompletionReceiptSchema,
  type NextVisitOutcomeValues,
} from "./next-visit-model";
interface NextVisitRpc {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: unknown }>;
}
const db = supabase as unknown as NextVisitRpc;
const uuid = z.string().uuid(),
  version = z.number().int().nonnegative();
async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await db.rpc(name, args);
  if (error) throw error;
  return data;
}
export function nextVisitCompletionRequest(
  id: string,
  expectedVersion: number,
) {
  return {
    id: uuid.parse(id),
    expected_version: version.min(1).parse(expectedVersion),
  };
}
export function nextVisitOutcomeRequest(
  occurrenceId: string,
  expectedVersion: number,
  values: NextVisitOutcomeValues,
) {
  return {
    occurrence_id: uuid.parse(occurrenceId),
    expected_version: version.parse(expectedVersion),
    values: nextVisitOutcomeValuesSchema.parse(values),
  };
}
export async function completeVisit(
  actorId: string,
  actionId: string,
  request: ReturnType<typeof nextVisitCompletionRequest>,
) {
  const checked = nextVisitCompletionRequest(
    request.id,
    request.expected_version,
  );
  return nextVisitCompletionReceiptSchema.parse(
    await rpc("complete_appointment", {
      p_actor_id: uuid.parse(actorId),
      p_action_id: uuid.parse(actionId),
      p_id: checked.id,
      p_expected_version: checked.expected_version,
    }),
  );
}
export async function saveNextVisitOutcome(
  actorId: string,
  actionId: string,
  request: ReturnType<typeof nextVisitOutcomeRequest>,
) {
  const checked = nextVisitOutcomeRequest(
    request.occurrence_id,
    request.expected_version,
    request.values,
  );
  return nextVisitContextSchema.parse(
    await rpc("save_next_visit_outcome", {
      p_actor_id: uuid.parse(actorId),
      p_action_id: uuid.parse(actionId),
      p_occurrence_id: checked.occurrence_id,
      p_expected_version: checked.expected_version,
      p_values: checked.values,
    }),
  );
}
export async function recoverNextVisitAction(
  actorId: string,
  actionId: string,
  operation: "complete" | "decide",
  request:
    | ReturnType<typeof nextVisitCompletionRequest>
    | ReturnType<typeof nextVisitOutcomeRequest>,
) {
  const checked =
    operation === "complete"
      ? nextVisitCompletionRequest(
          (request as ReturnType<typeof nextVisitCompletionRequest>).id,
          request.expected_version,
        )
      : nextVisitOutcomeRequest(
          (request as ReturnType<typeof nextVisitOutcomeRequest>).occurrence_id,
          request.expected_version,
          (request as ReturnType<typeof nextVisitOutcomeRequest>).values,
        );
  const data = await rpc("recover_next_visit_action", {
    p_actor_id: uuid.parse(actorId),
    p_action_id: uuid.parse(actionId),
    p_operation: z.enum(["complete", "decide"]).parse(operation),
    p_request: checked,
  });
  return operation === "complete"
    ? nextVisitCompletionReceiptSchema.nullable().parse(data)
    : nextVisitContextSchema.nullable().parse(data);
}
export async function nextVisitContext(occurrenceId: string) {
  return nextVisitContextSchema.parse(
    await rpc("read_next_visit_context", {
      p_occurrence_id: uuid.parse(occurrenceId),
    }),
  );
}
export async function pendingNextVisits(
  after: z.infer<typeof nextVisitCursorSchema> | null = null,
) {
  const cursor = nextVisitCursorSchema.nullable().parse(after);
  return nextVisitQueueSchema.parse(
    await rpc("list_pending_next_visits", {
      p_after_at: cursor?.at ?? null,
      p_after_id: cursor?.id ?? null,
      p_limit: 50,
    }),
  );
}
export async function nextVisitFutureAppointments(
  occurrenceId: string,
  asOf: string | null = null,
  after: z.infer<typeof nextVisitCursorSchema> | null = null,
) {
  const cursor = nextVisitCursorSchema.nullable().parse(after);
  const fixedAsOf = z
    .string()
    .datetime({ offset: true })
    .nullable()
    .parse(asOf);
  if (cursor && !fixedAsOf)
    throw new Error("Future pagination needs its original as-of time");
  const result = futureVisitPageSchema.parse(
    await rpc("list_next_visit_future_appointments", {
      p_occurrence_id: uuid.parse(occurrenceId),
      p_as_of: fixedAsOf,
      p_after_at: cursor?.at ?? null,
      p_after_id: cursor?.id ?? null,
      p_limit: 50,
    }),
  );
  if (fixedAsOf && Date.parse(result.as_of) !== Date.parse(fixedAsOf))
    throw new Error("Future page changed its as-of time");
  return result;
}
export async function nextVisitDueCare(
  occurrenceId: string,
  after: z.infer<typeof dueCareCursorSchema> | null = null,
) {
  return nextVisitDueCareSchema.parse(
    await rpc("list_next_visit_due_care", {
      p_occurrence_id: uuid.parse(occurrenceId),
      p_after: dueCareCursorSchema.nullable().parse(after),
      p_limit: 50,
    }),
  );
}
