import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { actionSchema, cancellationSchema, historySchema, pageSchema, uuid, version, verifyDetail, verifyReceipt, type ImagingAction } from "./model";
interface RpcClient { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> }
async function requireActor(actor: string) {
  uuid.parse(actor);
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (data.session?.user.id !== actor) throw new Error("Sign in with the original imaging operator to check saved work.");
}
async function call(actor: string, name: string, args: Record<string, unknown>) {
  await requireActor(actor);
  const { data, error } = await (supabase as unknown as RpcClient).rpc(name, args);
  if (error) throw error;
  await requireActor(actor);
  return data;
}
function identity(actor: string, pet: string) { return { p_actor_id: uuid.parse(actor), p_pet_id: uuid.parse(pet) }; }
export async function listStudies(actor: string, pet: string, after: string | null = null) {
  const parsed = pageSchema.safeParse(await call(actor, "list_imaging_studies", { ...identity(actor, pet), p_after: uuid.nullable().parse(after) }));
  if (!parsed.success) throw new Error("Imaging list could not be verified.");
  const value = parsed.data;
  value.items.forEach(item => verifyDetail(item, pet));
  if (new Set(value.items.map(item => item.study.id)).size !== value.items.length || value.items.some((item, i) => (after !== null && item.study.id <= after) || (i > 0 && item.study.id <= value.items[i - 1].study.id)) || (value.next !== null && value.next !== value.items[value.items.length - 1]?.study.id)) throw new Error("Imaging list cursor differs from its records.");
  return value;
}
export async function readStudy(actor: string, pet: string, id: string) {
  const value = await call(actor, "read_imaging_study", { ...identity(actor, pet), p_id: uuid.parse(id) });
  return value === null ? null : verifyDetail(value, pet, id);
}
function args(input: ImagingAction) {
  const action = actionSchema.parse(input);
  return { ...identity(action.actor_id, action.pet_id), p_action_id: action.action_id, p_id: action.id, p_expected_version: action.expected_version, p_kind: action.kind, p_values: action.values, p_reason: action.reason };
}
export async function saveStudy(action: ImagingAction) { return verifyReceipt(await call(action.actor_id, "save_imaging_study", args(action)), action); }
export async function recoverAction(action: ImagingAction) {
  const value = await call(action.actor_id, "recover_imaging_action", args(action));
  return value === null ? null : verifyReceipt(value, action);
}
export async function cancelAction(action: ImagingAction) {
  const parsed = cancellationSchema.safeParse(await call(action.actor_id, "cancel_imaging_action", args(action)));
  if (!parsed.success) throw new Error("Cancellation could not be verified. Retain the original imaging request.");
  return { cancelled: parsed.data.cancelled, receipt: parsed.data.receipt === null ? null : verifyReceipt(parsed.data.receipt, action) };
}
export async function listHistory(actor: string, pet: string, id: string, before: number | null = null) {
  const parsed = historySchema.safeParse(await call(actor, "list_imaging_history", { ...identity(actor, pet), p_id: uuid.parse(id), p_before: version.nullable().parse(before) }));
  if (!parsed.success) throw new Error("Imaging history could not be verified.");
  const value = parsed.data;
  if (value.items.some((item, index) => item.pet_id !== pet || item.study_id !== id || (before !== null && item.version >= before) || (index > 0 && item.version >= value.items[index - 1].version)) || (value.next !== null && value.next !== value.items[value.items.length - 1]?.version)) throw new Error("Imaging history identity or cursor differs.");
  return value;
}
const encounterSchema = z.object({ id: uuid, pet_id: uuid, version, visit_at: z.string(), status: z.enum(["draft", "signed"]) }).strict();
const documentSchema = z.object({ id: uuid, pet_id: uuid, version, file_name: z.string(), file_path: z.string(), mime_type: z.literal("application/pdf"), status: z.literal("ready"), encounter_id: uuid.nullable() }).strict();
export interface ImagingDocument extends Required<z.infer<typeof documentSchema>> {}
export interface ImagingEncounter extends Required<z.infer<typeof encounterSchema>> {}
export async function readSources(actor: string, pet: string) {
  await requireActor(actor); uuid.parse(pet);
  const [encounters, documents] = await Promise.all([
    supabase.from("clinical_encounters").select("id,pet_id,version,visit_at,status").eq("pet_id", pet).order("visit_at", { ascending: false }).limit(201),
    supabase.from("patient_documents").select("id,pet_id,version,file_name,file_path,mime_type,status,encounter_id").eq("pet_id", pet).eq("status", "ready").eq("mime_type", "application/pdf").order("created_at", { ascending: false }).limit(201),
  ]);
  if (encounters.error) throw encounters.error;
  if (documents.error) throw documents.error;
  if (encounters.data.length > 200 || documents.data.length > 200) throw new Error("Patient sources exceed this selector’s capacity. Ask for a scoped source search before linking.");
  // This project disables strictNullChecks, which makes Zod's inferred object keys optional to TypeScript.
  // Parsing still requires every selected field at runtime; expose that validated boundary explicitly.
  const rows = { encounters: z.array(encounterSchema).parse(encounters.data) as ImagingEncounter[], documents: z.array(documentSchema).parse(documents.data) as ImagingDocument[] };
  if (rows.encounters.some(row => row.pet_id !== pet) || rows.documents.some(row => row.pet_id !== pet)) throw new Error("Imaging source patient differs.");
  await requireActor(actor);
  return rows;
}
export async function reportDownload(actor: string, pet: string, id: string) {
  const detail = await readStudy(actor, pet, id);
  if (!detail || detail.study.status !== "recorded" || detail.report_available !== true) throw new Error("Current study report is unavailable. Reload the study.");
  const values = detail.study.values;
  const { data, error } = await supabase.from("patient_documents").select("id,pet_id,version,file_name,file_path,mime_type,status,encounter_id").eq("id", values.document_id!).eq("pet_id", pet).eq("version", values.document_version!).single();
  if (error) throw error;
  const parsed = documentSchema.safeParse(data);
  if (!parsed.success || parsed.data.pet_id !== pet || parsed.data.id !== values.document_id || parsed.data.version !== values.document_version) throw new Error("The selected PDF changed. Reload the current study.");
  const document = parsed.data;
  const result = await supabase.storage.from("patient-documents").createSignedUrl(document.file_path, 60, { download: document.file_name });
  if (result.error) throw result.error;
  await requireActor(actor);
  return { url: result.data.signedUrl, name: document.file_name };
}
