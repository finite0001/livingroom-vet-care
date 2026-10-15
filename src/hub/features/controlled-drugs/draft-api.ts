import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import {
  draftCancellationSchema, draftHistorySchema, draftPageSchema,
  draftReceiptSchema, draftReviewSchema, parseDraftRequest,
  type DraftActionMetadata,
} from "./draft-model.ts";

type DraftRpcName = "prepare_controlled_draft_review" | "execute_controlled_draft_review" | "read_controlled_draft_review" |
  "cancel_controlled_draft_review" | "list_controlled_drafts" | "read_controlled_draft";
interface DraftRpcResult { data: unknown; error: unknown }
interface DraftRpcClient {
  rpc(name: DraftRpcName, args: Record<string, unknown>): PromiseLike<DraftRpcResult>;
}
const rpcClient = supabase as unknown as DraftRpcClient;
async function requireCurrentActor(actor: string): Promise<void> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (!data.session || data.session.user.id !== actor) throw new Error("Sign in with the original controlled draft reviewer before checking saved work");
}
async function call<T>(actor: string, name: DraftRpcName, args: Record<string, unknown>, schema: z.ZodType<T>): Promise<T> {
  await requireCurrentActor(actor);
  const { data, error } = await rpcClient.rpc(name, args);
  if (error) throw error;
  await requireCurrentActor(actor);
  const result = schema.safeParse(data);
  if (!result.success) throw new Error("Unrecognized draft evidence. Check the original saved request before trying again");
  return result.data;
}
const actionArgs = (metadata: DraftActionMetadata) => ({ p_actor_id: metadata.actor_id, p_action_id: metadata.id });
export const controlledDraftApi = {
  prepare(metadata: DraftActionMetadata, input: unknown) {
    const request = parseDraftRequest(metadata.operation, input);
    return call(metadata.actor_id, "prepare_controlled_draft_review", { ...actionArgs(metadata), p_operation: metadata.operation, p_request: request }, draftReviewSchema);
  },
  execute(metadata: DraftActionMetadata) {
    return call(metadata.actor_id, "execute_controlled_draft_review", actionArgs(metadata), draftReceiptSchema);
  },
  recover(metadata: DraftActionMetadata) {
    return call(metadata.actor_id, "read_controlled_draft_review", actionArgs(metadata), draftReviewSchema.nullable());
  },
  cancel(metadata: DraftActionMetadata) {
    return call(metadata.actor_id, "cancel_controlled_draft_review", actionArgs(metadata), draftCancellationSchema);
  },
  list(actor: string, search = "", after: string | null = null) {
    z.string().max(200).parse(search);
    return call(actor, "list_controlled_drafts", { p_search: search, p_after: after, p_limit: 50 }, draftPageSchema);
  },
  history(actor: string, id: string, before: number | null = null) {
    z.string().uuid().parse(id);
    return call(actor, "read_controlled_draft", { p_id: id, p_before_version: before, p_limit: 20 }, draftHistorySchema.nullable());
  },
};
