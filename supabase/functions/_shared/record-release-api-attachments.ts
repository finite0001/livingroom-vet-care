import type {
  ReleaseSnapshot,
  ReleaseAttachment,
} from "./record-release-renderer.ts";
export interface ReleaseApiAttachment {
  record: {
    id: string;
    actor_id: string;
    request_id: string;
    pet_id: string;
    animal_link_id: string;
    source_origin: string;
    source_site_uid: string;
    attachment_external_id: string;
    request_hash: string;
    capture_hash: string;
    record_hash: string;
    title: string;
    review_reason: string;
    previous_record_id: string | null;
    version: number;
    entry_method: "staff_reviewed_api_attachment_v2";
    created_at: string;
    source_context: {
      capture_contract: "canonical_api_original_v1";
      run_id: string;
      page: number;
      ordinal: number;
      file_id: string;
      stable_metadata_sha256: string;
      raw_record_sha256: string;
      attachment_snapshot_id: string;
      attachment_external_id: string;
      attachment_observed_head_version: number;
      parent: {
        animal_link_id: string;
        pet_id: string;
        client_id: string;
        animal_external_id: string;
        source_origin: string;
        source_site_uid: string;
        parent_type: "Animal";
        parent_external_id: string;
        parent_snapshot_id: string;
        parent_payload_hash: string;
        parent_observed_head_version: number;
      };
    };
  };
  capture: {
    request_id: string;
    actor_id: string;
    pet_id: string;
    intent_id: string;
    entry_method: "ezyvet_api_attachment_original_v1";
    capture_hash: string;
    storage_object_id: string;
    bucket_id: "ezyvet-attachment-originals";
    object_path: string;
    content_sha256: string;
    file_size: number;
    mime_type: "application/pdf" | "image/jpeg" | "image/png";
    captured_at: string;
  };
}
const uuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const hash = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const positive = (v: unknown) => Number.isSafeInteger(v) && Number(v) > 0;
const date = (v: unknown) =>
  typeof v === "string" && Number.isFinite(Date.parse(v));
const external = (v: unknown) =>
  typeof v === "string" &&
  /^(0|[1-9][0-9]{0,15})$/.test(v) &&
  Number.isSafeInteger(Number(v));
const text = (v: unknown, max: number) =>
  typeof v === "string" && v.length > 0 && v.length <= max;
const keys = (v: unknown, expected: string) =>
  !!v &&
  typeof v === "object" &&
  !Array.isArray(v) &&
  Object.keys(v).sort().join(",") === expected.split(" ").sort().join(",");
const fail = (): never => {
  throw new Error(
    "Incomplete schema9 API attachment provenance; obtain a fresh reviewed snapshot.",
  );
};
export function releaseApiAttachmentDocument(
  source: ReleaseApiAttachment,
): ReleaseAttachment {
  const { record: r, capture: c } = source;
  return {
    id: c.request_id,
    version: 1,
    file_name: `ezyvet-attachment-${r.attachment_external_id}${c.mime_type === "application/pdf" ? ".pdf" : c.mime_type === "image/jpeg" ? ".jpg" : ".png"}`,
    file_path: c.object_path,
    bucket: c.bucket_id,
    mime_type: c.mime_type,
    file_size: c.file_size,
    content_sha256: c.content_sha256,
    document_date: null,
    category: "api_attachment",
    api_attachment_ref: {
      record_id: r.id,
      record_hash: r.record_hash,
      capture_hash: c.capture_hash,
    },
  };
}
export function validateReleaseApiAttachments(s: ReleaseSnapshot): void {
  if (s.schema_version !== 9 && s.schema_version !== 10 && s.schema_version !== 11 && s.schema_version !== 12) {
    if (
      s.api_attachments !== undefined ||
      s.attachments.some(
        (d) =>
          d.bucket === "ezyvet-attachment-originals" ||
          d.api_attachment_ref !== undefined,
      )
    )
      fail();
    return;
  }
  if (
    !Array.isArray(s.api_attachments) ||
    s.api_attachments.length > 20 ||
    !Array.isArray(s.attachments) ||
    s.attachments.length > 24 ||
    !Array.isArray(s.selection?.api_attachment_ids)
  )
    fail();
  const selected = s.selection!.api_attachment_ids!,
    seen = new Set<string>(),
    originals = new Set<string>();
  if (new Set(s.attachments.map((d) => d.id)).size !== s.attachments.length)
    fail();
  if (
    selected.length !== s.api_attachments!.length ||
    selected.some((id) => !uuid(id)) ||
    new Set(selected).size !== selected.length
  )
    fail();
  for (const item of s.api_attachments!) {
    if (!keys(item, "record capture")) fail();
    const r = item.record,
      c = item.capture,
      context = r?.source_context,
      p = context?.parent;
    if (
      !keys(
        r,
        "id actor_id request_id pet_id animal_link_id source_origin source_site_uid attachment_external_id request_hash capture_hash source_context title review_reason previous_record_id version entry_method record_hash created_at",
      ) ||
      !keys(
        c,
        "request_id actor_id pet_id intent_id entry_method capture_hash storage_object_id bucket_id object_path content_sha256 file_size mime_type captured_at",
      ) ||
      !keys(
        context,
        "capture_contract run_id page ordinal file_id stable_metadata_sha256 raw_record_sha256 parent attachment_snapshot_id attachment_external_id attachment_observed_head_version",
      ) ||
      !keys(
        p,
        "animal_link_id pet_id client_id animal_external_id source_origin source_site_uid parent_type parent_external_id parent_snapshot_id parent_payload_hash parent_observed_head_version",
      )
    )
      fail();
    if (
      ![
        r.id,
        r.actor_id,
        r.request_id,
        r.pet_id,
        r.animal_link_id,
        c.storage_object_id,
        c.intent_id,
        context.run_id,
        context.attachment_snapshot_id,
        p.parent_snapshot_id,
      ].every(uuid) ||
      !selected.includes(r.id) ||
      seen.has(r.id) ||
      originals.has(c.request_id) ||
      r.pet_id !== s.patient.id ||
      p.pet_id !== r.pet_id ||
      p.client_id !== s.recipient.client_id ||
      p.animal_link_id !== r.animal_link_id ||
      r.actor_id !== c.actor_id ||
      r.pet_id !== c.pet_id ||
      r.request_id !== c.request_id ||
      r.capture_hash !== c.capture_hash ||
      r.entry_method !== "staff_reviewed_api_attachment_v2" ||
      context.capture_contract !== "canonical_api_original_v1" ||
      c.entry_method !== "ezyvet_api_attachment_original_v1" ||
      context.attachment_external_id !== r.attachment_external_id ||
      !external(r.attachment_external_id) ||
      !external(p.animal_external_id) ||
      !external(p.parent_external_id) ||
      p.parent_type !== "Animal" ||
      (p.parent_type === "Animal" &&
        p.parent_external_id !== p.animal_external_id) ||
      !text(r.source_origin, 500) ||
      !text(r.source_site_uid, 200) ||
      p.source_origin !== r.source_origin ||
      p.source_site_uid !== r.source_site_uid
    )
      fail();
    if (
      ![
        r.request_hash,
        r.capture_hash,
        r.record_hash,
        c.content_sha256,
        context.stable_metadata_sha256,
        context.raw_record_sha256,
        p.parent_payload_hash,
      ].every(hash) ||
      ![
        r.version,
        context.page,
        context.ordinal,
        context.attachment_observed_head_version,
        p.parent_observed_head_version,
        c.file_size,
      ].every(positive) ||
      context.page > 1000 ||
      !external(context.file_id) ||
      c.file_size > 20971520 ||
      !text(r.title, 200) ||
      !text(r.review_reason, 2000) ||
      !date(r.created_at) ||
      !date(c.captured_at) ||
      (r.version === 1
        ? r.previous_record_id !== null
        : !uuid(r.previous_record_id) || r.previous_record_id === r.id) ||
      c.bucket_id !== "ezyvet-attachment-originals" ||
      !["application/pdf", "image/jpeg", "image/png"].includes(c.mime_type)
    )
      fail();
    const parts =
      typeof c.object_path === "string" ? c.object_path.split("/") : [];
    if (
      parts.length !== 5 ||
      parts[0] !== c.actor_id ||
      parts[1] !== r.pet_id ||
      parts[2] !== r.request_id ||
      !uuid(parts[3]) ||
      parts[4] !== "original"
    )
      fail();
    seen.add(r.id);
    originals.add(c.request_id);
    const docs = s.attachments.filter((d) => d.id === c.request_id),
      expected = releaseApiAttachmentDocument(item),
      actual = docs[0];
    if (
      docs.length !== 1 ||
      !keys(actual, Object.keys(expected).join(" ")) ||
      Object.entries(expected).some(([key, value]) =>
        key === "api_attachment_ref"
          ? !keys(
              actual.api_attachment_ref,
              "record_id record_hash capture_hash",
            ) ||
            actual.api_attachment_ref!.record_id !== r.id ||
            actual.api_attachment_ref!.record_hash !== r.record_hash ||
            actual.api_attachment_ref!.capture_hash !== c.capture_hash
          : actual[key as keyof ReleaseAttachment] !== value,
      )
    )
      fail();
  }
  for (const d of s.attachments) {
    if (
      (d.bucket === "ezyvet-attachment-originals" ||
        d.api_attachment_ref !== undefined) &&
      !originals.has(d.id)
    )
      fail();
  }
}
const esc = (v: unknown) =>
  String(v ?? "Not recorded").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function renderReleaseApiAttachments(s: ReleaseSnapshot): string {
  validateReleaseApiAttachments(s);
  if ((s.schema_version !== 9 && s.schema_version !== 10 && s.schema_version !== 11 && s.schema_version !== 12) || !s.api_attachments!.length) return "";
  return `<article><h2>Selected ezyVet API originals</h2>${s.api_attachments!.map(({ record: r, capture: c }) => `<section><h3>${esc(r.title)}</h3><p>Staff-reviewed API attachment ${esc(r.attachment_external_id)} · Approval version ${r.version}</p><p>Source site ${esc(r.source_site_uid)} · ${esc(r.source_context.parent.parent_type)} ${esc(r.source_context.parent.parent_external_id)} · Observed revision ${r.source_context.attachment_observed_head_version}</p><p>${esc(r.review_reason)}</p><p>Staff reviewer ${esc(r.actor_id)} · ${esc(r.created_at)} · Approval ${esc(r.id)}</p><p>Previous approval ${esc(r.previous_record_id)} · Original attachment ${s.attachments.findIndex((d) => d.id === c.request_id) + 1} · SHA-256 ${esc(c.content_sha256)}</p></section>`).join("")}<aside>API source files retain their outside content. Staff source review is not an outside author’s signature or a clinical interpretation. Selected observations do not establish complete migration coverage.</aside></article>`;
}
