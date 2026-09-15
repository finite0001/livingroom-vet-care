import { readAttachmentBytes } from "../ezyvet-import/attachment-bytes.ts";
import type { ReleaseApiOriginal } from "./record-release-api-originals.ts";
export interface ReleaseApiOriginalContext {
  record_id: string; record_hash: string; capture_hash: string; content_sha256: string;
  mime_type: string; file_size: number; bucket_id: string; object_path: string; storage_object_id: string;
}
export type ApiOriginalFamily = "release_email" | "document_link";
export type ReadReleaseApiOriginal = (original: ReleaseApiOriginal, family: ApiOriginalFamily, id: string, actorId: string) => Promise<Uint8Array>;
interface Database { rpc(name: string, args: Record<string, unknown>): PromiseLike<{data: unknown; error: unknown}> }
const keys = ["record_id", "record_hash", "capture_hash", "content_sha256", "mime_type", "file_size", "bucket_id", "object_path", "storage_object_id"] as const;
function checked(value: unknown, original: ReleaseApiOriginal): ReleaseApiOriginalContext {
  const c = value as ReleaseApiOriginalContext, r = original.record;
  const uuid = (v: unknown) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
  if (!c || typeof c !== "object" || Array.isArray(c) || Object.keys(c).length !== keys.length || keys.some(k => !Object.hasOwn(c,k)) || c.record_id !== r.id || c.record_hash !== r.record_hash || c.capture_hash !== r.capture_hash || c.content_sha256 !== r.content_sha256 || c.mime_type !== r.mime_type || c.file_size !== r.file_size || c.bucket_id !== "ezyvet-attachment-originals" || !uuid(c.storage_object_id) || typeof c.object_path !== "string") throw new Error("Release original unavailable");
  const p = c.object_path.split("/");
  if (p.length !== 5 || p[0] !== r.approved_by || p[1] !== r.pet_id || p[2] !== r.capture_request_id || !uuid(p[3]) || p[4] !== "original") throw new Error("Release original unavailable");
  return c;
}
export function createReleaseApiOriginalReader(options: {service: Database; url: string; serviceKey: string; apiKey: string; fetch?: typeof fetch}): ReadReleaseApiOriginal {
  return async (original, family, id, actorId) => {
    const context = async () => {
      const {data,error} = await options.service.rpc("get_release_api_original_context", {p_family:family,p_id:id,p_actor_id:actorId,p_record_id:original.record.id});
      if (error) throw error;
      return checked(data, original);
    };
    const before = await context();
    const signal = AbortSignal.timeout(20000);
    const target = new URL(`/storage/v1/object/authenticated/${before.bucket_id}/${before.object_path.split("/").map(encodeURIComponent).join("/")}`, options.url);
    const response = await (options.fetch ?? fetch)(target, {headers:{Authorization:`Bearer ${options.serviceKey}`,apikey:options.apiKey,"Accept-Encoding":"identity"},redirect:"error",signal});
    const file = await readAttachmentBytes(response, before.mime_type, signal);
    if (file.sha256 !== before.content_sha256 || file.size !== before.file_size || file.mimeType !== before.mime_type) throw new Error("Release original bytes differ");
    const after = await context();
    if (keys.some(k => before[k] !== after[k])) throw new Error("Release original changed");
    return file.bytes;
  };
}
