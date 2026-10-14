import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import {
  identityCancellationSchema, identityHistorySchema, identityOperationSchema, identityPageSchema,
  identityReceiptSchema, identityReviewSchema, identifierMatchesSchema, parseIdentityRequest,
  type IdentityActionMetadata, type IdentityOperation,
} from "./package-model.ts";

type IdentityRpcName = "prepare_inventory_identity_review" | "execute_inventory_identity_review" | "read_inventory_identity_review" |
  "cancel_inventory_identity_review" | "list_inventory_identities" | "read_inventory_identity" | "lookup_inventory_identifier";
interface IdentityRpcResult { data: unknown; error: unknown }
interface IdentityRpcClient {
  rpc(name: IdentityRpcName, args: Record<string, unknown>): PromiseLike<IdentityRpcResult>;
}
const rpcClient = supabase as unknown as IdentityRpcClient;
async function requireCurrentActor(actor: string): Promise<void> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (!data.session || data.session.user.id !== actor) throw new Error("Sign in with the original inventory reviewer before checking saved work");
}
async function call<T>(actor: string, name: IdentityRpcName, args: Record<string, unknown>, schema: z.ZodType<T>): Promise<T> {
  await requireCurrentActor(actor);
  const { data, error } = await rpcClient.rpc(name, args);
  if (error) throw error;
  await requireCurrentActor(actor);
  const result = schema.safeParse(data);
  if (!result.success) throw new Error("Unrecognized inventory evidence. Check the original saved request before trying again");
  return result.data;
}
const actionArgs = (metadata: IdentityActionMetadata) => ({ p_actor_id: metadata.actor_id, p_action_id: metadata.id });
export const inventoryIdentityApi = {
  prepare(metadata: IdentityActionMetadata, input: unknown) {
    const request = parseIdentityRequest(metadata.operation, input);
    return call(metadata.actor_id, "prepare_inventory_identity_review", { ...actionArgs(metadata), p_operation: metadata.operation, p_request: request }, identityReviewSchema);
  },
  execute(metadata: IdentityActionMetadata) {
    return call(metadata.actor_id, "execute_inventory_identity_review", actionArgs(metadata), identityReceiptSchema);
  },
  recover(metadata: IdentityActionMetadata) {
    return call(metadata.actor_id, "read_inventory_identity_review", actionArgs(metadata), identityReviewSchema.nullable());
  },
  cancel(metadata: IdentityActionMetadata) {
    return call(metadata.actor_id, "cancel_inventory_identity_review", actionArgs(metadata), identityCancellationSchema);
  },
  list(actor: string, kind: IdentityOperation, search = "", after: string | null = null) {
    identityOperationSchema.parse(kind);
    z.string().max(200).parse(search);
    return call(actor, "list_inventory_identities", { p_kind: kind, p_search: search, p_after: after, p_limit: 50 }, identityPageSchema);
  },
  history(actor: string, id: string, before: number | null = null) {
    z.string().uuid().parse(id);
    return call(actor, "read_inventory_identity", { p_id: id, p_before_version: before, p_limit: 20 }, identityHistorySchema.nullable());
  },
  lookup(actor: string, kind: "supplier_sku" | "supplier_barcode" | "gtin", value: string, namespaceId: string | null = null) {
    z.enum(["supplier_sku", "supplier_barcode", "gtin"]).parse(kind);
    return call(actor, "lookup_inventory_identifier", { p_kind: kind, p_value: value, p_namespace_id: namespaceId, p_limit: 50 }, identifierMatchesSchema);
  },
};
