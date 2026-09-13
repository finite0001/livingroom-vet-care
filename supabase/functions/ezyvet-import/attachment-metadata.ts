/** Pure, Animal-scoped metadata parsing. Deliberately disconnected from dispatch. */
export const attachmentMetadataContract = {
  version: "ezyvet_animal_attachment_metadata_v1",
  path: "/v1/attachment",
  scope: "read-attachment",
  pageLimit: 10,
  maxPageBytes: 262144,
  maxRecordBytes: 32768,
} as const;

export class AttachmentMetadataError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.name = "AttachmentMetadataError";
    this.code = code;
  }
}
interface JsonObject { [key: string]: JsonValue }
type JsonValue = null | boolean | string | number | JsonValue[] | JsonObject;
type SourceScalar = string | number | boolean | null;
export interface AttachmentMetadata {
  id: string;
  file_id: string;
  record_type: "Animal";
  record_id: string;
  active?: SourceScalar;
  created_at?: string | number | null;
  modified_at?: string | number | null;
  mime_type?: string | null;
  name?: string | null;
  primary_image?: SourceScalar;
  notes?: string | null;
}
export interface AttachmentObservation {
  external_id: string;
  file_id: string;
  metadata: AttachmentMetadata;
  raw_record_sha256: string;
  stable_metadata_sha256: string;
  file_sha256: null;
}
export interface AttachmentMetadataPage {
  contract_version: typeof attachmentMetadataContract.version;
  parent: { record_type: "Animal"; record_id: string };
  page: number;
  complete: boolean;
  pagination: { items_page: number; items_page_total: number; items_page_size: number; items_total: number };
  observations: AttachmentObservation[];
  page_sha256: string;
}
export interface AttachmentPageExpectation {
  animalId: string | number;
  page: number;
  limit?: number;
}
const fail = (code = "INVALID_ATTACHMENT_SHAPE"): never => { throw new AttachmentMetadataError(code); };
const encoder = new TextEncoder();
function object(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function validString(value: string): boolean {
  // Reject lone surrogates: UTF-8 replacement would otherwise collapse distinct inputs.
  return !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
}
/** Canonical JSON values only; no coercion, toJSON hooks or unknown object types. */
function canonical(value: unknown, depth = 0, budget = { nodes: 0 }): string {
  if (++budget.nodes > 10000 || depth > 12) return fail();
  if (value === null || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "string") {
    if (value.length > 32768 || !validString(value)) return fail();
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return fail();
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (value.length > 1000 || Object.getOwnPropertySymbols(value).length || Object.getOwnPropertyNames(value).length !== value.length + 1) return fail();
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
      if (!descriptor || !("value" in descriptor)) return fail();
      parts.push(canonical(descriptor.value, depth + 1, budget));
    }
    return `[${parts.join(",")}]`;
  }
  if (!object(value) || Object.getOwnPropertySymbols(value).length) return fail();
  const keys = Object.keys(value).sort();
  if (keys.length > 100 || Object.getOwnPropertyNames(value).length !== keys.length) return fail();
  return `{${keys.map((key) => {
    if (key.length > 256 || !validString(key)) return fail();
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) return fail();
    return `${JSON.stringify(key)}:${canonical(descriptor.value, depth + 1, budget)}`;
  }).join(",")}}`;
}
async function digest(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", encoder.encode(text));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function integer(value: unknown): number {
  if (typeof value === "string" && /^(0|[1-9][0-9]{0,15})$/.test(value)) value = Number(value);
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return fail("INVALID_ATTACHMENT_ID_OR_CURSOR");
  return value;
}
function id(value: unknown): string { return String(integer(value)); }
function boundedCanonical(value: unknown, maxBytes: number): string {
  const text = canonical(value);
  if (encoder.encode(text).byteLength > maxBytes) return fail("ATTACHMENT_METADATA_TOO_LARGE");
  return text;
}
function project(raw: Record<string, unknown>, expectedAnimal: string): AttachmentMetadata {
  if (raw.record_type !== "Animal" || id(raw.record_id) !== expectedAnimal) return fail("ATTACHMENT_PARENT_MISMATCH");
  const metadata: AttachmentMetadata = { id: id(raw.id), file_id: id(raw.file_id), record_type: "Animal", record_id: expectedAnimal };
  for (const key of ["active", "created_at", "modified_at", "mime_type", "name", "primary_image", "notes"] as const) {
    if (!Object.hasOwn(raw, key)) continue;
    const value = raw[key];
    const textField = key === "mime_type" || key === "name" || key === "notes";
    const flag = key === "active" || key === "primary_image";
    if (value !== null && typeof value !== "string" && !(typeof value === "number" && !textField) && !(typeof value === "boolean" && flag)) return fail();
    if (typeof value === "string" && encoder.encode(value).length > (key === "notes" ? 16384 : 1024)) return fail("ATTACHMENT_METADATA_TOO_LARGE");
    // Explicit allowlist, with original scalar representation and absent/null distinction.
    Object.assign(metadata, { [key]: value });
  }
  if (Object.hasOwn(raw, "file_download_url") && raw.file_download_url !== null && typeof raw.file_download_url !== "string") return fail();
  return metadata;
}
export async function parseAttachmentMetadataPage(body: unknown, expected: AttachmentPageExpectation): Promise<AttachmentMetadataPage> {
  // Validate JSON and bound the complete envelope, including discarded provider fields.
  boundedCanonical(body, attachmentMetadataContract.maxPageBytes);
  const animalId = id(expected.animalId);
  const page = integer(expected.page);
  const limit = integer(expected.limit ?? attachmentMetadataContract.pageLimit);
  if (page < 1 || limit < 1 || limit > attachmentMetadataContract.pageLimit) return fail("INVALID_ATTACHMENT_REQUEST");
  if (!object(body) || !Array.isArray(body.items) || !object(body.meta) || (Object.hasOwn(body, "messages") && (!Array.isArray(body.messages) || body.messages.length !== 0))) return fail();
  if (body.items.length > limit) return fail("ATTACHMENT_PAGE_TOO_LARGE");
  const pagination = {
    items_page: integer(body.meta.items_page), items_page_total: integer(body.meta.items_page_total),
    items_page_size: integer(body.meta.items_page_size), items_total: integer(body.meta.items_total),
  };
  const effectiveSize = pagination.items_page_size;
  const totalPages = effectiveSize > 0 ? Math.ceil(pagination.items_total / effectiveSize) : 0;
  const empty = pagination.items_total === 0 && page === 1 && body.items.length === 0;
  if (pagination.items_page !== page || effectiveSize < 1 || effectiveSize > limit ||
      (!empty && (pagination.items_page_total !== totalPages || page > totalPages)) ||
      (empty && ![0, 1].includes(pagination.items_page_total)) ||
      body.items.length !== (empty ? 0 : Math.min(effectiveSize, pagination.items_total - (page - 1) * effectiveSize))) return fail("INVALID_ATTACHMENT_PAGINATION");
  const observations: AttachmentObservation[] = [];
  for (const wrapper of body.items) {
    if (!object(wrapper) || !object(wrapper.attachment)) return fail();
    const raw = wrapper.attachment;
    const rawText = boundedCanonical(raw, attachmentMetadataContract.maxRecordBytes);
    const metadata = project(raw, animalId);
    observations.push({ external_id: metadata.id, file_id: metadata.file_id, metadata,
      raw_record_sha256: await digest(rawText), stable_metadata_sha256: await digest(canonical(metadata)), file_sha256: null });
  }
  const result = { contract_version: attachmentMetadataContract.version, parent: { record_type: "Animal" as const, record_id: animalId },
    page, complete: empty || page === totalPages, pagination, observations };
  return { ...result, page_sha256: await digest(canonical(result)) };
}
