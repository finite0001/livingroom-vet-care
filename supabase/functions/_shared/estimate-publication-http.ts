import { z } from "zod";
import { estimatePublicationSnapshotSchema, estimatePublicationArtifact, estimatePublicationFilename } from "./estimate-publication-document.ts";

export interface EstimatePublicationDatabase {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}
export interface EstimatePublicationDependencies {
  authenticate(token: string): Promise<{ actorId: string; db: EstimatePublicationDatabase } | null>;
  service: EstimatePublicationDatabase;
}
const uuid = z.string().uuid().refine(value => value === value.toLowerCase());
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const revision = z.number().int().min(1).max(2147483647);
const shape = estimatePublicationSnapshotSchema.innerType().shape;
const head = z.object({ event_id: uuid.nullable(), version: z.number().int().min(0).max(2147483647), record_hash: hash.nullable() }).strict()
  .refine(value => value.version === 0 ? value.event_id === null && value.record_hash === null : value.event_id !== null && value.record_hash !== null);
export const estimatePublicationPrepareRequestSchema = z.object({
  target: shape.target, draft_version: revision, expected_source_hash: hash,
  expected_publication_head: head, replaces_publication_id: uuid.nullable(),
}).strict();
const fields = z.object({ title: shape.title, notes: shape.notes, terms: shape.terms,
  accept_by: shape.acceptance.shape.accept_by, lines: z.array(shape.lines.element.shape.line).min(1).max(100) }).strict();
const draft = z.object({ id: uuid, client_id: uuid, pet_id: uuid, version: revision, fields,
  total_cents: shape.total_cents, created_by: uuid, created_at: shape.prepared_at,
  updated_by: uuid, updated_at: shape.prepared_at }).strict();
const contextSchema = z.object({ target: shape.target, draft, draft_record_hash: hash,
  publication_head: head, current_publication_id: uuid.nullable(), practice: shape.practice,
  client: shape.client, patient: shape.patient }).strict();
export const estimatePublicationArtifactSchema = z.object({
  filename: z.string().regex(/^estimate-[0-9a-f-]{36}-draft-[1-9]\d{0,9}-publication-[0-9a-f-]{36}\.html$/),
  mime_type: z.literal("text/html; charset=utf-8"), byte_length: z.number().int().min(1).max(2097152),
  sha256: hash, renderer_version: z.literal(1),
}).strict().superRefine((value, ctx) => {
  const match = /^estimate-(.*)-draft-(\d+)-publication-(.*)\.html$/.exec(value.filename);
  if (!match || !uuid.safeParse(match[1]).success || !revision.safeParse(Number(match[2])).success || !uuid.safeParse(match[3]).success)
    ctx.addIssue({ code: "custom", message: "Invalid artifact filename" });
});
const equal = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const aa = a as Record<string, unknown>, bb = b as Record<string, unknown>;
  return Object.keys(aa).length === Object.keys(bb).length && Object.keys(aa).every(key => Object.hasOwn(bb, key) && equal(aa[key], bb[key]));
};
export const estimatePublicationPreparationSchema = z.object({
  version: z.literal(1), id: uuid, actor_id: uuid, request: estimatePublicationPrepareRequestSchema,
  request_hash: hash, context: contextSchema, source_hash: hash,
  snapshot: estimatePublicationSnapshotSchema, content_hash: hash,
  artifact: estimatePublicationArtifactSchema.nullable(), created_at: shape.prepared_at,
}).strict().superRefine((value, ctx) => {
  const { request, context, snapshot } = value;
  const d = context.draft;
  if (value.id !== snapshot.preparation_id || value.created_at !== snapshot.prepared_at ||
      value.source_hash !== request.expected_source_hash || !equal(request.target, context.target) ||
      !equal(request.target, snapshot.target) || request.draft_version !== d.version || d.version !== snapshot.draft_version ||
      d.id !== request.target.estimate_id || d.client_id !== request.target.client_id || d.pet_id !== request.target.pet_id ||
      !equal(request.expected_publication_head, context.publication_head) || request.replaces_publication_id !== context.current_publication_id ||
      context.draft_record_hash !== snapshot.draft_record_hash || !equal(context.practice, snapshot.practice) ||
      !equal(context.client, snapshot.client) || !equal(context.patient, snapshot.patient) ||
      d.fields.title !== snapshot.title || d.fields.notes !== snapshot.notes || d.fields.terms !== snapshot.terms ||
      d.fields.accept_by !== snapshot.acceptance.accept_by || d.total_cents !== snapshot.total_cents ||
      !equal(d.fields.lines, snapshot.lines.map(value => value.line)) ||
      (value.artifact && value.artifact.filename !== estimatePublicationFilename(snapshot)))
    ctx.addIssue({ code: "custom", message: "Preparation evidence differs" });
});
const headers = {
  "Cache-Control": "no-store, private", Pragma: "no-cache", "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization,apikey,content-type,x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Expose-Headers": "content-disposition,content-type",
  "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
};
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { ...headers, "Content-Type": "application/json" } });
const unavailable = (status = 404) => json({ error: "Estimate publication unavailable" }, status);
async function body(req: Request) {
  const reader = req.body?.getReader();
  if (!reader) throw new Error("Missing body");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length;
      if (size > 16384) { await reader.cancel(); throw new Error("Body too large"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}
async function rpc(db: EstimatePublicationDatabase, name: string, args: Record<string, unknown>) {
  const { data, error } = await db.rpc(name, args); if (error) throw error; return data;
}
function encode(bytes: Uint8Array): string {
  let binary = ""; for (let i = 0; i < bytes.length; i += 16384) binary += String.fromCharCode(...bytes.subarray(i, i + 16384));
  return btoa(binary);
}
async function verifiedBytes(content: string, artifact: z.infer<typeof estimatePublicationArtifactSchema>) {
  if (content.length > 2796204 || content.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(content)) throw new Error("Invalid base64");
  const raw = atob(content), bytes = Uint8Array.from(raw, char => char.charCodeAt(0));
  if (encode(bytes) !== content || bytes.length !== artifact.byte_length) throw new Error("Artifact length differs");
  new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), byte => byte.toString(16).padStart(2, "0")).join("");
  if (digest !== artifact.sha256) throw new Error("Artifact digest differs");
  return bytes;
}
export function createEstimatePublicationHandler(deps: EstimatePublicationDependencies, mode: "prepare" | "recover" | "read") {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response(null, { headers });
    if (req.method !== "POST") return unavailable(405);
    const bearer = req.headers.get("Authorization");
    if (!bearer?.startsWith("Bearer ") || !bearer.slice(7).trim()) return unavailable(401);
    try {
      const auth = await deps.authenticate(bearer.slice(7)); if (!auth || !uuid.safeParse(auth.actorId).success) return unavailable(401);
      const input = await body(req);
      if (mode === "read") {
        const request = z.object({ preparation_id: uuid, client_id: uuid, expected_artifact_hash: hash }).strict().parse(input);
        const result = z.object({ artifact: estimatePublicationArtifactSchema, content_base64: z.string() }).strict().parse(await rpc(auth.db,
          "read_native_estimate_publication_artifact", { p_preparation_id: request.preparation_id, p_client_id: request.client_id, p_expected_artifact_hash: request.expected_artifact_hash }));
        if (result.artifact.sha256 !== request.expected_artifact_hash || !result.artifact.filename.endsWith(`-publication-${request.preparation_id}.html`)) throw new Error("Artifact identity differs");
        const bytes = await verifiedBytes(result.content_base64, result.artifact);
        return new Response(bytes, { headers: { ...headers, "Content-Type": result.artifact.mime_type,
          "Content-Disposition": `attachment; filename="${result.artifact.filename}"`, "Content-Length": String(bytes.length),
          "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; sandbox" } });
      }
      const request = mode === "prepare" ? z.object({ id: uuid, request: estimatePublicationPrepareRequestSchema }).strict().parse(input) : z.object({ id: uuid }).strict().parse(input);
      const original = await rpc(auth.db, mode === "prepare" ? "prepare_native_estimate_publication" : "recover_native_estimate_preparation",
        { p_id: request.id, ...("request" in request ? { p_request: request.request } : {}) });
      if (original === null && mode === "recover") return json({ version: 1, preparation: null });
      const validate = (value: unknown) => {
        const result = estimatePublicationPreparationSchema.parse(value);
        if (result.id !== request.id || result.actor_id !== auth.actorId || ("request" in request && !equal(result.request, request.request))) throw new Error("Preparation identity differs");
        return result;
      };
      const preparation = validate(original);
      if (preparation.artifact) return json({ version: 1, preparation });
      const capture = z.object({ preparation: estimatePublicationPreparationSchema, captured: z.boolean() }).strict().parse(await rpc(deps.service,
        "native_estimate_capture_context", { p_id: request.id, p_actor_id: auth.actorId }));
      const current = validate(capture.preparation);
      if (!equal({ ...current, artifact: null }, preparation) || capture.captured !== (current.artifact !== null)) throw new Error("Capture context differs");
      let artifact = current.artifact;
      if (!artifact) {
        const generated = await estimatePublicationArtifact(current.snapshot);
        artifact = estimatePublicationArtifactSchema.parse(await rpc(deps.service, "capture_native_estimate_publication_artifact", {
          p_id: request.id, p_actor_id: auth.actorId, p_content_hash: current.content_hash, p_renderer_version: 1,
          p_html_utf8_base64: encode(new TextEncoder().encode(generated.html)),
        }));
        if (!equal(artifact, generated.artifact)) throw new Error("Captured artifact differs");
      }
      const recovered = validate(await rpc(auth.db, "recover_native_estimate_preparation", { p_id: request.id }));
      if (!equal({ ...recovered, artifact: null }, preparation) || !equal(recovered.artifact, artifact)) throw new Error("Captured recovery differs");
      return json({ version: 1, preparation: recovered });
    } catch { return unavailable(); }
  };
}
