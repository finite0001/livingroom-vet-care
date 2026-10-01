import { z } from "zod";
import type { Database, Json } from "@/integrations/supabase/types";
import { supabase } from "@/integrations/supabase/client";
import type {
  CertificateEvent,
  CertificateSnapshot,
  IssuedCertificate,
} from "./print";
export interface CertificateRow extends IssuedCertificate {
  pet_id: string;
  kind: "vaccine_history" | "rabies";
  issued_by: string;
}
export interface CertificateBundle {
  certificate: CertificateRow;
  events: CertificateEvent[];
}
export interface PreviewArgs {
  p_pet_id: string;
  p_kind: "vaccine_history" | "rabies";
  p_rabies_treatment_id: string | null;
  p_details: CertificateSnapshot["details"];
}
export interface IssueArgs extends PreviewArgs {
  p_id: string;
  p_reviewed_snapshot: CertificateSnapshot;
  p_signature_name: string;
  p_attest_review: boolean;
  p_replaces_id: string | null;
  p_reason: string | null;
}
type Fns = Database["public"]["Functions"];
const kindSchema = z.enum(["vaccine_history", "rabies"]);
// Snapshots are echoed back as p_reviewed_snapshot and rendered verbatim, so
// objects pass through: only the envelope the UI relies on is asserted here.
const snapshotSchema = z
  .object({
    schema_version: z.number(),
    kind: kindSchema,
    patient: z.object({ id: z.string(), name: z.string() }).passthrough(),
    owner: z.object({}).passthrough(),
    issuer: z.object({}).passthrough(),
    vaccinations: z.array(z.object({}).passthrough()),
    details: z.object({}).passthrough(),
  })
  .passthrough();
const rowSchema = z
  .object({
    id: z.string(),
    pet_id: z.string(),
    kind: kindSchema,
    issued_by: z.string(),
    snapshot: snapshotSchema,
    signature_name: z.string(),
    issued_at: z.string(),
    attestation: z.string(),
    replaces_id: z.string().nullable(),
  })
  .passthrough();
const eventSchema = z
  .object({
    id: z.string(),
    kind: z.enum(["void", "superseded", "treatment_corrected"]),
    reason: z.string(),
    created_at: z.string(),
    replacement_id: z.string().nullable(),
  })
  .passthrough();
const bundleSchema = z.object({
  certificate: rowSchema,
  events: z.array(eventSchema),
});
const malformed = () =>
  new Error("Certificate response was malformed. Reload before continuing.");
function parse<T>(schema: z.ZodTypeAny, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw malformed();
  return parsed.data as T;
}
export const parseCertificateSnapshot = (value: unknown) =>
  parse<CertificateSnapshot>(snapshotSchema, value);
export const parseCertificateRow = (value: unknown) =>
  parse<CertificateRow>(rowSchema, value);
// Snapshot/details interfaces have no index signature, so they are not
// structurally assignable to Json; they are plain JSON values.
export const previewRpcArgs = (
  args: PreviewArgs,
): Fns["preview_vaccine_certificate"]["Args"] => ({
  ...args,
  p_details: args.p_details as unknown as Json,
});
export const issueRpcArgs = (
  args: IssueArgs,
): Fns["issue_vaccine_certificate"]["Args"] => ({
  ...args,
  p_details: args.p_details as unknown as Json,
  p_reviewed_snapshot: args.p_reviewed_snapshot as unknown as Json,
});
export const certificates = supabase;
export async function readCertificate(id: string): Promise<CertificateBundle> {
  const { data, error } = await certificates.rpc("read_vaccine_certificate", {
    p_id: id,
  });
  if (error) throw error;
  if (!data) throw new Error("Certificate not found.");
  return parse<CertificateBundle>(bundleSchema, data);
}
export const attestations = {
  rabies:
    "I reviewed this complete certificate and its due date, confirm this was a rabies vaccine administered by me or under my supervision by the named administrator trained in vaccine storage, handling, administration and adverse-event management, and explicitly sign this certificate.",
  vaccine_history:
    "I reviewed the patient identity, included vaccination history and the patient due-plan snapshot, including any plans awaiting review, and explicitly sign this certificate. The reviewed plan dates apply to this snapshot at issuance; no vaccine equivalence or due date was inferred. This is not a rabies certificate.",
} as const;
