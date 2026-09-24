import type { AttachmentMetadata } from "../ezyvet-import/attachment-metadata.ts";
import type { AttachmentBytes } from "../ezyvet-import/attachment-bytes.ts";
import type { AdapterDependencies } from "../ezyvet-import/adapter.ts";
export interface CaptureReceipt {
  id: string; request_id: string; entry_method: "ezyvet_api_attachment_original_v1";
  content_sha256: string; mime_type: string; file_size: number; capture_hash: string; captured_at: string;
}
export interface CaptureRequest {
  id: string; requested_by: string; animal_link_id: string; pet_id: string; client_id: string;
  run_id: string; page: number; ordinal: number; snapshot_id: string; observed_head_version: number;
  external_id: string; file_id: string; stable_metadata_sha256: string; raw_record_sha256: string;
  metadata: AttachmentMetadata;
  parent_context: {
    animal_link_id: string; pet_id: string; client_id: string; animal_external_id: string;
    source_origin: string; source_site_uid: string; parent_type: "Animal"; parent_external_id: string;
    parent_snapshot_id: string; parent_payload_hash: string; parent_observed_head_version: number;
  };
  request_hash: string; status: "prepared" | "reserved" | "ready" | "blocked" | "discarding" | "abandoned";
  source_current: boolean; lease_active: boolean; retry_after: string | null; last_error_code: string | null;
  retryable: boolean; created_at: string; updated_at: string; capture: CaptureReceipt | null;
}
export interface CaptureIntent {
  id: string; bucket_id: string; object_path: string; content_sha256: string; mime_type: string;
  file_size: number; before_raw_sha256: string; after_raw_sha256: string;
}
export interface CaptureContext {
  request: CaptureRequest; lease_id: string | null; lease_until: string | null; intent: CaptureIntent | null;
}
export interface CaptureGateway {
  authenticate(bearer: string): Promise<{ id: string; activeAdmin: boolean } | null>;
  context(id: string, actor: string): Promise<CaptureContext>;
  claim(id: string, actor: string): Promise<CaptureContext>;
  reserve(id: string, actor: string, leaseId: string, file: AttachmentBytes, beforeRaw: string, afterRaw: string): Promise<CaptureContext>;
  complete(id: string, actor: string, leaseId: string, intent: CaptureIntent, file: AttachmentBytes): Promise<CaptureContext>;
  fail(id: string, actor: string, leaseId: string, code: string, seconds: number, terminal: boolean): Promise<unknown>;
  beginDiscard(id: string, actor: string): Promise<CaptureContext>;
  completeDiscard(id: string, actor: string): Promise<CaptureContext>;
  /** Null means verified absence, never a permission or transport error. */
  readObject(intent: CaptureIntent): Promise<Response | null>;
  uploadObject(intent: CaptureIntent, bytes: Uint8Array, bearer: string): Promise<void>;
  deleteObject(intent: CaptureIntent, bearer: string): Promise<void>;
}
export interface CaptureDependencies extends AdapterDependencies {
  env(key: string): string | undefined; gateway: CaptureGateway;
}
