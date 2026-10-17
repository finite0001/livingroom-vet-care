import { z } from "zod";
import { calendarDateSchema } from "../care-plans/calendar.ts";

export const uuid = z.string().uuid();
export const version = z.number().int().min(1).max(999999999);
const documentaryText = (maximum: number) => z.string().max(maximum).refine(value => Array.from(value).every(character => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127), "Use a single paragraph without control characters");
const exact = (maximum: number) => documentaryText(maximum).refine(value => value.trim() === value && value.trim().length > 0, "Enter exact text without surrounding spaces");
export const viewerUrlSchema = z.string().max(2048).regex(
  /^https:\/\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.vetrocket\.net\/view\.html\?link=[A-Za-z0-9_-]{8,1800}$/,
  "Use a VetRocket study share link: https://your-clinic.vetrocket.net/view.html?link=…",
).refine(value => {
  try { const url = new URL(value); return url.hostname.split(".")[0].length <= 63 && url.href === value; } catch { return false; }
}, "Use an exact VetRocket study share link");
export const modalities = ["DX", "CR", "US", "CT", "MR", "IO", "ES", "OT"] as const;
export const valuesSchema = z.object({
  account_label: exact(160), vendor_patient_id: exact(160), external_study_id: exact(160), accession: documentaryText(160),
  study_date: calendarDateSchema, modality: z.enum(modalities), description: exact(160), body_region: documentaryText(160),
  viewer_url: viewerUrlSchema,
  encounter_id: uuid.nullable(), encounter_version: version.nullable(), document_id: uuid.nullable(), document_version: version.nullable(),
  identity_verified: z.literal(true), review_note: exact(2000),
}).strict().superRefine((value, context) => {
  for (const source of ["encounter", "document"] as const) if ((value[`${source}_id`] === null) !== (value[`${source}_version`] === null))
    context.addIssue({ code: "custom", path: [`${source}_id`], message: "Select an exact current source and its version together" });
});
export interface ImagingValues extends z.infer<typeof valuesSchema> {}
export const studySchema = z.object({
  id: uuid, pet_id: uuid, version, values: valuesSchema, status: z.enum(["recorded", "void"]),
  created_by: uuid, updated_by: uuid, created_at: z.string().datetime({ offset: true }), updated_at: z.string().datetime({ offset: true }),
}).strict();
export interface ImagingStudy extends z.infer<typeof studySchema> {}
export const detailSchema = z.object({ study: studySchema, report_available: z.boolean().nullable() }).strict().superRefine((value, context) => {
  if ((value.study.values.document_id === null) !== (value.report_available === null)) context.addIssue({ code: "custom", message: "Report availability must match its saved source" });
});
export interface ImagingDetail extends z.infer<typeof detailSchema> {}
export const cancellationSchema = z.object({ cancelled: z.boolean(), receipt: detailSchema.nullable() }).strict().superRefine((value, context) => {
  if (value.cancelled !== (value.receipt === null)) context.addIssue({ code: "custom", message: "Cancellation must confirm a terminal cancellation or the original committed receipt" });
});
export const revisionSchema = z.object({
  study_id: uuid, pet_id: uuid, version, snapshot: studySchema, reason: z.string().max(1000), actor_id: uuid, session_id: uuid, created_at: z.string().datetime({ offset: true }),
}).strict().superRefine((value, context) => {
  if (value.study_id !== value.snapshot.id || value.pet_id !== value.snapshot.pet_id || value.version !== value.snapshot.version || value.actor_id !== value.snapshot.updated_by)
    context.addIssue({ code: "custom", message: "Imaging revision identity differs from its snapshot" });
});
export interface ImagingRevision extends z.infer<typeof revisionSchema> {}
export const pageSchema = z.object({ items: z.array(detailSchema).max(20), next: uuid.nullable() }).strict();
export const historySchema = z.object({ items: z.array(revisionSchema).max(20), next: version.nullable() }).strict();
export const actionSchema = z.object({
  actor_id: uuid, action_id: uuid, id: uuid, pet_id: uuid, expected_version: version.nullable(), kind: z.enum(["record", "correct", "void"]), values: valuesSchema.nullable(), reason: z.string().max(1000),
}).strict().superRefine((value, context) => {
  if (value.kind === "record" ? value.expected_version !== null || value.values === null || value.reason !== "" : value.expected_version === null || !value.reason.trim() || value.reason.trim() !== value.reason || (value.kind === "void" ? value.values !== null : value.values === null))
    context.addIssue({ code: "custom", message: "Record, correction and void each require their exact reviewed fields" });
});
export interface ImagingAction extends z.infer<typeof actionSchema> {}
export interface ImagingForm extends Omit<ImagingValues, "identity_verified"> { identity_verified: boolean }
export function emptyValues(): ImagingForm {
  return { account_label: "", vendor_patient_id: "", external_study_id: "", accession: "", study_date: "", modality: "DX", description: "", body_region: "", viewer_url: "", encounter_id: null, encounter_version: null, document_id: null, document_version: null, identity_verified: false, review_note: "" };
}
export function sameValues(a: ImagingValues, b: ImagingValues): boolean {
  return Object.keys(a).every(key => a[key as keyof ImagingValues] === b[key as keyof ImagingValues]);
}
export function verifyDetail(input: unknown, pet: string, id?: string): ImagingDetail {
  const parsed = detailSchema.safeParse(input);
  if (!parsed.success || parsed.data.study.pet_id !== pet || (id && parsed.data.study.id !== id)) throw new Error("Imaging response does not match the expected patient or study. Check saved work before continuing.");
  return parsed.data;
}
export function verifyReceipt(input: unknown, action: ImagingAction): ImagingDetail {
  const value = verifyDetail(input, action.pet_id, action.id), study = value.study;
  if (study.updated_by !== action.actor_id || study.version !== (action.expected_version ?? 0) + 1 || study.status !== (action.kind === "void" ? "void" : "recorded") || (action.values !== null && !sameValues(study.values, action.values)) || (action.kind === "record" && study.created_by !== action.actor_id))
    throw new Error("Imaging receipt differs from the original request. Check saved work before continuing.");
  return value;
}
export const pendingSchema = z.object({ action: actionSchema, state: z.enum(["uncertain", "not_saved"]) }).strict();
export interface PendingImaging extends z.infer<typeof pendingSchema> {}
export function parsePending(text: string, actor: string, pet: string): PendingImaging {
  const parsed = pendingSchema.safeParse(JSON.parse(text));
  if (!parsed.success || parsed.data.action.actor_id !== actor || parsed.data.action.pet_id !== pet) throw new Error("Saved imaging request belongs to a different patient or operator.");
  // A refreshed page must recheck the server even when an earlier lookup found no receipt.
  return { action: parsed.data.action, state: "uncertain" };
}

interface SelectedSource { id: string; pet_id: string; version: number }
interface SelectedDocument extends SelectedSource { encounter_id: string | null }
export function validateSources(values: ImagingValues, pet: string, sources: { encounters: SelectedSource[]; documents: SelectedDocument[] }): void {
  if (values.encounter_id && !sources.encounters.some(row => row.id === values.encounter_id && row.pet_id === pet && row.version === values.encounter_version)) throw new Error("Reload and select the current encounter version.");
  if (values.document_id) {
    const document = sources.documents.find(row => row.id === values.document_id && row.pet_id === pet && row.version === values.document_version);
    if (!document || (document.encounter_id !== null && document.encounter_id !== values.encounter_id)) throw new Error("Select a current PDF for the same patient and encounter.");
  }
}
