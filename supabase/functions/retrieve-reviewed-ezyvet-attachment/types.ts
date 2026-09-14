import type { AttachmentMetadata } from "../ezyvet-import/attachment-metadata.ts";
export interface ChartRecord {
  id: string; action_id: string; approved_by: string; approved_at: string; pet_id: string; client_id: string; patient_version: number;
  animal_link_id: string; capture_id: string; capture_request_id: string; capture_hash: string; request_hash: string;
  record_hash: string; source_origin: string; source_site_uid: string; source_animal_id: string; source_attachment_id: string;
  source_file_id: string; snapshot_id: string; observed_head_version: number; stable_metadata_sha256: string; raw_record_sha256: string;
  metadata: AttachmentMetadata; content_sha256: string; mime_type: string; file_size: number; captured_at: string;
  entry_method: "staff_reviewed_ezyvet_api_attachment_v1"; source_current_at_review: boolean; previous_record_id: string | null;
  version: number; kind: "original" | "replacement"; review_reason: string;
}
export interface ChartOriginal {
  bucket_id: string; object_path: string; storage_object_id: string; content_sha256: string; mime_type: string; file_size: number;
}
export interface ChartOriginalContext { record: ChartRecord; original: ChartOriginal }
export interface ChartOriginalGateway {
  authenticate(bearer: string): Promise<{ id: string; activeDvm: boolean } | null>;
  context(recordId: string, petId: string, actor: string): Promise<unknown>;
  readOriginal(original: ChartOriginal): Promise<Response>;
}
export interface ChartOriginalDependencies { env(key: string): string | undefined; gateway: ChartOriginalGateway }
