export class AttachmentPageError extends Error {
  readonly requiresNewScan: boolean;
  constructor(message: string, requiresNewScan = false) { super(message); this.name = "AttachmentPageError"; this.requiresNewScan = requiresNewScan; }
}
export function attachmentPageError(code: unknown): AttachmentPageError {
  switch (code) {
    case "SOURCE_ATTACHMENT_PARENT_STALE":
    case "ATTACHMENT_RUN_REQUIRES_NEW_CONTEXT":
      return new AttachmentPageError("The patient or consultation source changed. Keep this scan as history and select fresh source context for a new scan.", true);
    case "SOURCE_ATTACHMENT_PARENT_MISMATCH":
    case "ATTACHMENT_CONTEXT_MISMATCH":
      return new AttachmentPageError("The returned source does not match this scan's patient or consultation. Keep this scan and review the source mapping before starting another scan.", true);
    case "IMPORT_DISABLED":
    case "RESOURCE_NOT_CONFIGURED":
    case "ATTACHMENT_INTAKE_UNAVAILABLE":
      return new AttachmentPageError("Attachment source access is not commissioned. An administrator must complete server setup before this scan can continue.");
    case "UPSTREAM_SCOPE_DENIED":
    case "UPSTREAM_AUTH_FAILED":
      return new AttachmentPageError("The provider did not authorize this attachment read. An administrator must check the source credentials and read permissions.");
    case "IMPORT_BUSY":
      return new AttachmentPageError("Another source request or provider cooldown is active. Recheck this saved scan before continuing.");
    default:
      return new AttachmentPageError("Page response unconfirmed. Recheck this saved scan before continuing.");
  }
}

export class AttachmentPreparationError extends Error {
  readonly canChooseFreshContext: boolean;
  constructor(code: unknown) {
    super(code === "40001" ? "The source changed before this scan could be prepared. Choose fresh source context." : "Scan preparation is unconfirmed. Retain this request and recover it before choosing another source.");
    this.name = "AttachmentPreparationError";
    this.canChooseFreshContext = code === "40001";
  }
}
