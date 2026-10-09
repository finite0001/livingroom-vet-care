import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
export const photoStateSchema = z.object({
  pet_id: z.string().uuid(),
  version: z.number().int().min(0),
  document_id: z.string().uuid().nullable(),
  document: z.object({
    id: z.string().uuid(),
    pet_id: z.string().uuid(),
    file_path: z.string(),
    mime_type: z.enum(["image/png", "image/jpeg"]),
  }).nullable(),
});
export const pendingPhotoSchema = z.object({
  id: z.string().uuid(),
  actionId: z.string().uuid(),
  petId: z.string().uuid(),
  actorId: z.string().uuid(),
  expectedVersion: z.number().int().min(0),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  size: z.number().int().min(1).max(5242880),
  mime: z.enum(["image/png", "image/jpeg"]),
  kind: z.enum(["upload", "remove"]),
});
export interface PendingPhoto {
  id: string;
  actionId: string;
  petId: string;
  actorId: string;
  expectedVersion: number;
  sha256: string;
  size: number;
  mime: "image/png" | "image/jpeg";
  kind: "upload" | "remove";
}
export interface PhotoRpc {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: unknown }>;
}
// Runtime-validated adapter for additive RPCs; Lovable owns generated Database types.
const db = supabase as unknown as PhotoRpc;
async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await db.rpc(name, args);
  if (error) throw error;
  return data;
}
export async function readPhoto(petId: string) {
  const value = photoStateSchema.parse(
    await rpc("read_patient_photo", { p_pet_id: petId }),
  );
  if (
    value.pet_id !== petId ||
    value.document &&
      (value.document.pet_id !== petId ||
        value.document.id !== value.document_id)
  ) throw new Error("Photo patient differs");
  return value;
}
export async function reservePhoto(p: PendingPhoto) {
  const result = z.object({
    document: z.object({
      id: z.string().uuid(),
      pet_id: z.string().uuid(),
      created_by: z.string().uuid(),
      file_path: z.string(),
      status: z.enum(["uploading", "ready"]),
    }),
    expected_version: z.number().int(),
    expected_sha256: z.string(),
  })
    .parse(
      await rpc("prepare_patient_photo", {
        p_id: p.id,
        p_pet_id: p.petId,
        p_expected_version: p.expectedVersion,
        p_sha256: p.sha256,
        p_file_size: p.size,
        p_mime_type: p.mime,
      }),
    );
  const d = result.document;
  if (
    d.id !== p.id || d.pet_id !== p.petId || d.created_by !== p.actorId ||
    d.file_path !== `${p.actorId}/${p.petId}/${p.id}/original` ||
    result.expected_version !== p.expectedVersion ||
    result.expected_sha256 !== p.sha256
  ) throw new Error("Photo reservation differs");
  return d;
}
export async function choosePhoto(p: PendingPhoto) {
  const result = z.object({
    id: z.string().uuid(),
    pet_id: z.string().uuid(),
    document_id: z.string().uuid().nullable(),
    version: z.number().int().min(1),
  })
    .parse(
      await rpc("set_patient_photo", {
        p_id: p.actionId,
        p_pet_id: p.petId,
        p_document_id: p.kind === "remove" ? null : p.id,
        p_expected_version: p.expectedVersion,
      }),
    );
  if (
    result.id !== p.actionId || result.pet_id !== p.petId ||
    result.document_id !== (p.kind === "remove" ? null : p.id) ||
    result.version !== p.expectedVersion + 1
  ) {
    throw new Error("Photo save could not be confirmed");
  }
  return result;
}
