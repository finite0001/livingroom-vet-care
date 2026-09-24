import {
  parseManifest,
  type DocumentArtifact,
} from "../../../shared/document-link-client.ts";
export type DocumentFamily = "invoice" | "record_release";
export interface LinkIntent {
  p_request_id: string;
  p_family: DocumentFamily;
  p_source_id: string;
  p_client_id: string;
  p_conversation_id: string;
  p_recipient: string;
  p_source_hash: string;
  p_expires_at: string;
  p_message_template: string;
}
export interface LinkPreparation {
  grant: {
    id: string;
    family: DocumentFamily;
    source_id: string;
    client_id: string;
    actor_id: string;
    conversation_id: string;
    recipient: string;
    source_hash: string;
    message_template: string;
    expires_at: string;
    state: "preparing" | "captured" | "reviewed" | "revoked";
  };
  artifact_hash: string | null;
  message_hash: string | null;
  manifest: DocumentArtifact[] | null;
  report_html: string | null;
  materialized_message?: string;
  client_url?: string;
  receipt: {
    outbox_id: string;
    message_id: string;
    state: string;
    queued: boolean;
    delivered: boolean;
  } | null;
}
export function parsePreparation(
  value: unknown,
  family: DocumentFamily,
  source: string,
  client: string,
  actor: string,
): LinkPreparation | null {
  if (value === null) return null;
  const p = value as LinkPreparation;
  if (
    !p?.grant ||
    p.grant.family !== family ||
    p.grant.source_id !== source ||
    p.grant.client_id !== client ||
    p.grant.actor_id !== actor ||
    !p.grant.id ||
    !["preparing", "captured", "reviewed", "revoked"].includes(p.grant.state)
  )
    throw new Error(
      "Saved document link does not match this staff member and record.",
    );
  if (p.artifact_hash) {
    if (
      !/^[a-f0-9]{64}$/.test(p.artifact_hash) ||
      !/^[a-f0-9]{64}$/.test(p.message_hash ?? "")
    )
      throw new Error("Saved review hashes are invalid.");
    parseManifest(
      {
        grant_id: p.grant.id,
        expires_at: p.grant.expires_at,
        manifest: p.manifest,
      },
      p.grant.id,
    );
  }
  return p;
}
export function validateIntent(
  value: unknown,
  family: DocumentFamily,
  source: string,
  client: string,
): LinkIntent {
  const p = value as LinkIntent;
  if (
    !p ||
    Object.values(p).some((v) => typeof v !== "string") ||
    Object.keys(p).length !== 9 ||
    p.p_family !== family ||
    p.p_source_id !== source ||
    p.p_client_id !== client ||
    !p.p_request_id ||
    !p.p_conversation_id ||
    !p.p_recipient ||
    !/^[a-f0-9]{64}$/.test(p.p_source_hash) ||
    !Number.isFinite(Date.parse(p.p_expires_at)) ||
    p.p_message_template.split("{{document_link}}").length !== 2 ||
    /https?:\/\/|v1\.[A-Za-z0-9_-]{43}/i.test(p.p_message_template)
  )
    throw new Error(
      "Saved link intent cannot be verified. Reconcile its history before proceeding.",
    );
  return p;
}
export async function verifiedArtifact(
  raw: unknown,
  expected: DocumentArtifact,
): Promise<Blob> {
  const value = raw as DocumentArtifact & { content: string };
  if (
    !value ||
    value.filename !== expected.filename ||
    value.mime_type !== expected.mime_type ||
    value.file_size !== expected.file_size ||
    value.sha256 !== expected.sha256 ||
    typeof value.content !== "string"
  )
    throw new Error("Frozen file metadata changed.");
  const bytes = Uint8Array.from(atob(value.content), (c) => c.charCodeAt(0));
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
  if (bytes.length !== expected.file_size || hash !== expected.sha256)
    throw new Error("Frozen file integrity check failed.");
  return new Blob([bytes], { type: expected.mime_type });
}
