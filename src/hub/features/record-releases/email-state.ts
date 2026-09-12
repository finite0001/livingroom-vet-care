export interface EmailArgs {
  p_request_id: string;
  p_release_id: string;
  p_conversation_id: string;
  p_subject: string;
  p_body: string;
  p_release_hash: string;
}
export interface EmailPreparation {
  request: {
    id: string;
    release_id: string;
    actor_id: string;
    conversation_id: string;
    recipient: string;
    subject: string;
    body: string;
    release_hash: string;
    state: string;
  };
  payload_hash: string | null;
  manifest: Array<{
    filename: string;
    mime_type: string;
    file_size: number;
    sha256: string;
  }> | null;
  report_html: string | null;
  purged_at: string | null;
  receipt: {
    outbox_id: string;
    state: string;
    queued: boolean;
    delivered: boolean;
  } | null;
}
export function parseEmailPreparation(
  value: unknown,
  releaseId: string,
): EmailPreparation | null {
  if (value === null) return null;
  const bad = () => {
    throw new Error(
      "Saved email response was incomplete. Retry recovery; no new email was created.",
    );
  };
  if (!value || typeof value !== "object" || Array.isArray(value)) return bad();
  const p = value as Record<string, unknown>;
  if (!p.request || typeof p.request !== "object" || Array.isArray(p.request))
    return bad();
  const r = p.request as Record<string, unknown>;
  for (const k of [
    "id",
    "release_id",
    "actor_id",
    "conversation_id",
    "recipient",
    "subject",
    "body",
    "release_hash",
    "state",
  ])
    if (typeof r[k] !== "string") return bad();
  if (
    r.release_id !== releaseId ||
    !["preparing", "ready", "queued", "abandoned"].includes(r.state as string)
  )
    return bad();
  if (
    p.payload_hash !== null &&
    (typeof p.payload_hash !== "string" ||
      !/^[a-f0-9]{64}$/.test(p.payload_hash))
  )
    return bad();
  if (p.report_html !== null && typeof p.report_html !== "string") return bad();
  if (p.purged_at !== null && typeof p.purged_at !== "string") return bad();
  if (p.manifest !== null) {
    if (
      !Array.isArray(p.manifest) ||
      p.manifest.length < 1 ||
      p.manifest.length > 25
    )
      return bad();
    for (const item of p.manifest) {
      if (
        !item ||
        typeof item !== "object" ||
        typeof item.filename !== "string" ||
        typeof item.mime_type !== "string" ||
        !Number.isSafeInteger(item.file_size) ||
        item.file_size < 1 ||
        typeof item.sha256 !== "string" ||
        !/^[a-f0-9]{64}$/.test(item.sha256)
      )
        return bad();
    }
  }
  if (p.receipt !== null) {
    if (!p.receipt || typeof p.receipt !== "object" || Array.isArray(p.receipt))
      return bad();
    const receipt = p.receipt as Record<string, unknown>;
    if (
      typeof receipt.outbox_id !== "string" ||
      typeof receipt.state !== "string" ||
      receipt.queued !== true ||
      typeof receipt.delivered !== "boolean"
    )
      return bad();
  }
  if (p.payload_hash !== null && p.manifest === null) return bad();
  return value as EmailPreparation;
}
