// Apply only after signature/resource verification. Never alter signed input first.
export function redactDocumentCapabilities(value: string): string {
  return value
    .replace(/v1\.[A-Za-z0-9_-]{43}/g, "[private-document-access-redacted]")
    .replace(/(?:p1|s1)\.[A-Za-z0-9_-]{43}/g, "[private-payment-access-redacted]");
}
export function redactDocumentMetadata(value: unknown): unknown {
  if (typeof value === "string") return redactDocumentCapabilities(value);
  if (Array.isArray(value)) return value.map(redactDocumentMetadata);
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactDocumentMetadata(item)]));
  return value;
}
