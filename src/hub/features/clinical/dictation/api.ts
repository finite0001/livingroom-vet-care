import { supabase } from "@/integrations/supabase/client";
import {
  actionRequest,
  currentEncounterSchema,
  readSchema,
  uuid,
  verifyReceipt,
  type DictationAction,
} from "./model";
interface RpcClient {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: unknown }>;
}
async function call(name: string, args: Record<string, unknown>) {
  const { data, error } = await (supabase as unknown as RpcClient).rpc(
    name,
    args,
  );
  if (error) throw error;
  return data;
}
export async function readDictation(
  actor: string,
  pet: string,
  encounter: string,
) {
  const result = readSchema.parse(
    await call("read_clinical_dictation", {
      p_actor_id: uuid.parse(actor),
      p_pet_id: uuid.parse(pet),
      p_encounter_id: uuid.parse(encounter),
    }),
  );
  if (
    result.actor_id !== actor ||
    result.pet_id !== pet ||
    result.encounter_id !== encounter ||
    result.items.some(
      (item) =>
        item.pet_id !== pet ||
        item.encounter_id !== encounter ||
        (item.review && item.review.proposal_id !== item.id),
    )
  )
    throw new Error("Dictation patient or encounter differs.");
  return result;
}
function args(action: DictationAction) {
  return {
    p_actor_id: uuid.parse(action.actor),
    p_id: uuid.parse(action.id),
    p_kind: action.kind,
    p_request: actionRequest(action),
  };
}
export async function recoverDictationAction(action: DictationAction) {
  const value = await call("recover_clinical_dictation_action", args(action));
  return value === null ? null : verifyReceipt(value, action);
}
export async function saveDictationAction(action: DictationAction) {
  return verifyReceipt(
    await call("save_clinical_dictation_action", args(action)),
    action,
  );
}
export async function readLatestDictationEncounter(
  pet: string,
  encounter: string,
) {
  const { data, error } = await supabase
    .from("clinical_encounters")
    .select("*")
    .eq("id", uuid.parse(encounter))
    .eq("pet_id", uuid.parse(pet))
    .single();
  if (error) throw error;
  const row = currentEncounterSchema.parse(data);
  if (row.id !== encounter || row.pet_id !== pet)
    throw new Error("Latest encounter differs from dictation destination.");
  return row;
}
