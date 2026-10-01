import { z } from "zod";
import type { Database, Json } from "@/integrations/supabase/types";
import { supabase } from "@/integrations/supabase/client";
import type {
  ReleaseSelection as SharedReleaseSelection,
  ReleasePreview,
  ReleaseRow,
  ReleaseBundle,
} from "./print";
import { sourceLabels, type SourceKind } from "./selection";
export { sourceLabels, type SourceKind };
export interface ReleaseSelection extends SharedReleaseSelection {
  native_prescription_ids?: string[];
  native_dispense_ids?: string[];
  imported_prescription_ids?: string[];
  lab_report_ids?: string[];
  external_record_ids?: string[];
}
export interface ReleaseCandidate {
  id: string;
  version: number;
  recorded_at: string;
  label: string;
  importance?: string;
  version_hash?: string;
  record_hash?: string;
  capture_hash?: string;
  completeness?: "complete" | "partial";
  partial_disclosure?: string | null;
  required_document_id?: string | null;
  required_document_version?: number;
  kind?: "original" | "corrected" | "replacement";
  historical?: boolean;
  source_label?: string;
  acknowledgment_count?: number;
  required_lab_report_ids?: string[];
  required_external_record_ids?: string[];
  file_size?: number;
  mime_type?: string;
}
export interface ReleaseCandidates {
  pet_id: string;
  client_id: string;
  client_name: string;
  email: string | null;
  phone: string | null;
  policy_accepted: boolean;
  policy_v4_accepted?: boolean;
  policy_v8_accepted: boolean;
  policy_v9_accepted: boolean;
  policy_v13_accepted: boolean;
  native_prescription_ids: ReleaseCandidate[];
  native_dispense_ids: ReleaseCandidate[];
  api_attachment_ids: ReleaseCandidate[];
  has_more: Record<import("./selection").SourceKind, boolean>;
  imported_history_ids: ReleaseCandidate[];
  imported_vaccination_ids: ReleaseCandidate[];
  imported_prescription_ids: ReleaseCandidate[];
  lab_report_ids: ReleaseCandidate[];
  external_record_ids: ReleaseCandidate[];
  problem_ids: ReleaseCandidate[];
  patient_summary_ids: ReleaseCandidate[];
  weight_ids: ReleaseCandidate[];
  treatment_ids: ReleaseCandidate[];
  encounter_ids: ReleaseCandidate[];
  certificate_ids: ReleaseCandidate[];
  lab_order_ids: ReleaseCandidate[];
  document_ids: ReleaseCandidate[];
  dental_ids: ReleaseCandidate[];
  qol_ids: ReleaseCandidate[];
  anesthesia_ids: ReleaseCandidate[];
  lesion_ids: ReleaseCandidate[];
}
export interface ReleasePreviewArgs {
  p_pet_id: string;
  p_client_id: string;
  p_channel: "EMAIL" | "SMS";
  p_recipient: string;
  p_selection: ReleaseSelection;
}
export interface ReleaseConfirmArgs extends ReleasePreviewArgs {
  p_id: string;
  p_reviewed_snapshot: ReleasePreview["snapshot"];
  p_reviewed_hash: string;
  p_attest_review: boolean;
}
type Fns = Database["public"]["Functions"];
const kinds = Object.keys(sourceLabels) as SourceKind[];
const ids = z.array(z.string());
// Objects pass through unchanged: snapshots and selections are echoed back to
// the database and hash-compared, so unknown keys must never be stripped.
const selectionSchema = z.record(z.string(), ids);
const snapshotSchema = z
  .object({
    schema_version: z.number(),
    patient: z.object({ id: z.string() }).passthrough(),
    recipient: z
      .object({ client_id: z.string(), channel: z.string(), address: z.string() })
      .passthrough(),
  })
  .passthrough();
const candidateSchema = z
  .object({ id: z.string(), label: z.string() })
  .passthrough();
const candidatesSchema = z
  .object({
    pet_id: z.string(),
    client_id: z.string(),
    client_name: z.string(),
    email: z.string().nullish(),
    phone: z.string().nullish(),
    policy_accepted: z.boolean(),
    policy_v13_accepted: z.boolean(),
    has_more: z.record(z.string(), z.boolean()),
    ...Object.fromEntries(kinds.map((kind) => [kind, z.array(candidateSchema)])),
  })
  .passthrough();
const selectAllSchema = z
  .object({
    selection: selectionSchema,
    excluded_unavailable_originals: z.number().nullish(),
    excluded_labs_without_shareable_original: z.number().nullish(),
    scope: z.string(),
  })
  .passthrough();
const previewSchema = z
  .object({ snapshot: snapshotSchema, source_hash: z.string() })
  .passthrough();
// Stored releases span every snapshot schema version, so only the envelope is checked.
const rowSchema = z
  .object({
    snapshot: z.object({}).passthrough(),
    source_hash: z.string(),
    id: z.string(),
    pet_id: z.string(),
    client_id: z.string(),
    channel: z.enum(["EMAIL", "SMS"]),
    recipient: z.string(),
    selection: z.object({}).passthrough(),
    created_by: z.string(),
    created_at: z.string(),
  })
  .passthrough();
const eventSchema = z
  .object({
    id: z.string(),
    release_id: z.string(),
    kind: z.enum(["withdrawn", "source_changed"]),
    reason: z.string(),
    created_by: z.string().nullable(),
    created_at: z.string(),
  })
  .passthrough();
const bundleSchema = z
  .object({
    release: rowSchema,
    events: z.array(eventSchema),
    eligible: z.boolean(),
    ineligibility_reason: z.string().nullable(),
  })
  .passthrough();
/** Shallow structural parse of a jsonb RPC result; null when malformed so callers keep their own error copy. */
function shape<T>(schema: z.ZodTypeAny, value: unknown): T | null {
  const parsed = schema.safeParse(value);
  return parsed.success ? (parsed.data as T) : null;
}
export const parseReleaseCandidates = (value: unknown) =>
  shape<ReleaseCandidates>(candidatesSchema, value);
export const parseSelectAllSources = (value: unknown) =>
  shape<{
    selection: ReleaseSelection;
    excluded_unavailable_originals: number;
    excluded_labs_without_shareable_original: number;
    scope: string;
  }>(selectAllSchema, value);
export const parseReleasePreview = (value: unknown) =>
  shape<ReleasePreview>(previewSchema, value);
export const parseReleaseRow = (value: unknown) =>
  shape<ReleaseRow>(rowSchema, value);
// The hand-written snapshot/selection interfaces have no index signature, so
// they are not structurally assignable to Json; they are plain JSON values.
export const previewRpcArgs = (
  args: ReleasePreviewArgs,
): Fns["preview_record_release_v13"]["Args"] => ({
  ...args,
  p_selection: args.p_selection as unknown as Json,
});
export const confirmRpcArgs = (
  args: ReleaseConfirmArgs,
): Fns["confirm_record_release"]["Args"] => ({
  ...args,
  p_selection: args.p_selection as unknown as Json,
  p_reviewed_snapshot: args.p_reviewed_snapshot as unknown as Json,
});
export const releases = supabase;
export async function readRelease(id: string): Promise<ReleaseBundle> {
  const { data, error } = await releases.rpc("read_record_release", {
    p_id: id,
  });
  if (error) throw error;
  if (!data) throw new Error("Release package not found.");
  const bundle = shape<ReleaseBundle>(bundleSchema, data);
  if (!bundle) throw new Error("Release package response was malformed.");
  return bundle;
}
