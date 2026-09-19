export interface DocumentArtifact {
  index: number;
  filename: string;
  mime_type: "text/html" | "application/pdf" | "image/jpeg" | "image/png";
  file_size: number;
  sha256: string;
}

export interface DocumentManifest {
  grant_id: string;
  expires_at: string;
  manifest: DocumentArtifact[];
}

const unavailable = () => new Error("Document link unavailable");
const maxBytes = 32 * 1024 * 1024;
const mimeTypes = new Set(["text/html", "application/pdf", "image/jpeg", "image/png"]);

export function validCapability(grantId: string, token: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(grantId)
    && /^v1\.[A-Za-z0-9_-]{43}$/.test(token);
}

export function parseManifest(value: unknown, grantId: string): DocumentManifest {
  if (!value || typeof value !== "object") throw unavailable();
  const result = value as DocumentManifest;
  if (result.grant_id !== grantId || typeof result.expires_at !== "string"
    || !Number.isFinite(Date.parse(result.expires_at))
    || !Array.isArray(result.manifest) || !result.manifest.length || result.manifest.length > 25) throw unavailable();
  let total = 0;
  for (const [index, artifact] of result.manifest.entries()) {
    if (!artifact || artifact.index !== index || typeof artifact.filename !== "string"
      || artifact.filename.length < 1 || artifact.filename.length > 255
      || [...artifact.filename].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 || char === "/" || char === "\\")
      || !mimeTypes.has(artifact.mime_type)
      || (index === 0 ? artifact.mime_type !== "text/html" : artifact.mime_type === "text/html")
      || !Number.isSafeInteger(artifact.file_size) || artifact.file_size < 1
      || typeof artifact.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(artifact.sha256)) throw unavailable();
    total += artifact.file_size;
    if (total > maxBytes) throw unavailable();
  }
  return result;
}

async function limitedBytes(response: Response, limit: number): Promise<Uint8Array<ArrayBuffer>> {
  if (!response.body) throw unavailable();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw unavailable();
      chunks.push(value);
    }
  } catch {
    await reader.cancel().catch(() => {});
    throw unavailable();
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

async function request(grantId: string, token: string, artifactIndex: number | null, signal: AbortSignal) {
  if (!validCapability(grantId, token)) throw unavailable();
  const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/retrieve-document-link`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ grant_id: grantId, token, artifact_index: artifactIndex }),
    cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer", redirect: "error", signal,
  });
  if (!response.ok) throw unavailable();
  return response;
}

export async function fetchManifest(grantId: string, token: string, signal: AbortSignal): Promise<DocumentManifest> {
  const response = await request(grantId, token, null, signal);
  const bytes = await limitedBytes(response, 32 * 1024);
  return parseManifest(JSON.parse(new TextDecoder().decode(bytes)), grantId);
}

export async function fetchArtifact(grantId: string, token: string, artifact: DocumentArtifact, signal: AbortSignal): Promise<Blob> {
  const response = await request(grantId, token, artifact.index, signal);
  if (response.headers.get("content-type")?.split(";")[0].trim() !== artifact.mime_type) throw unavailable();
  const bytes = await limitedBytes(response, artifact.file_size);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  if (bytes.byteLength !== artifact.file_size || hash !== artifact.sha256) throw unavailable();
  return new Blob([bytes], { type: artifact.mime_type });
}

// srcDoc does not inherit the response's CSP. Apply a deny-by-default policy again.
export function sandboxedReport(html: string): string {
  return '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; base-uri \'none\'; form-action \'none\'"><meta name="referrer" content="no-referrer">' + html;
}
