import { z } from "zod";
import {
  CALL_LIMITS, CALL_PROVIDER_SCHEMA, CALL_SOURCE_CONTRACT, callCaptureReadSchema,
  callDispatchSchema, callPageFingerprintInput, callProjectionLine, callProviderIdSchema, callProviderPageSchema,
  callSha256, callSourceDocumentSchema,
} from "./clinical-call-model.ts";

interface CallAuth { actorId: string; read(id: string): Promise<unknown> }
export interface ClinicalCallDependencies {
  enabled: boolean; credentials: string | undefined;
  authenticate(token: string): Promise<CallAuth | null>;
  dispatch(id: string): Promise<unknown>;
  finish(id: string, document: unknown): Promise<unknown>;
  fail(id: string, code: string): Promise<void>;
  providerFetch?: typeof fetch;
  now?: () => number;
}
export class ClinicalCallCaptureError extends Error {
  code: string;
  constructor(code: string) { super(code); this.code = code; }
}
async function boundedBody(response: Response, max: number) {
  if (!response.body) throw new ClinicalCallCaptureError("provider_body_invalid");
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      if (size > max) throw new ClinicalCallCaptureError("provider_budget_exceeded");
      chunks.push(next.value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const bytes = new Uint8Array(size); let cursor = 0;
  for (const chunk of chunks) { bytes.set(chunk, cursor); cursor += chunk.length; }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
/** Two observed equal enumerations, not an atomic provider snapshot or ongoing-currentness claim. */
export async function captureClinicalCallTranscript(
  callId: string, credentials: string, providerFetch: typeof fetch = fetch,
  now: () => number = Date.now,
) {
  callProviderIdSchema.parse(callId);
  const started = now(), pages: z.infer<typeof callSourceDocumentSchema>["pages"] = [];
  let reference = "", firstData: z.infer<typeof callProviderPageSchema>["data"] | null = null;
  for (const pass of [1, 2] as const) {
    let offset = 0, total: number | null = null, metadata = "", previousStart = -1;
    const segments: z.infer<typeof callProviderPageSchema>["data"]["segments"] = [];
    for (let pageIndex = 0; ; pageIndex++) {
      const remaining = CALL_LIMITS.capture_ms - (now() - started);
      if (pageIndex >= CALL_LIMITS.pages_per_pass || pages.length >= CALL_LIMITS.requests || remaining <= 0) throw new ClinicalCallCaptureError("provider_budget_exceeded");
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.min(remaining, CALL_LIMITS.page_ms));
      try {
        const url = `https://api.cloudtalk.io/v1/ai/calls/${callId}/transcription?limit=${CALL_LIMITS.page_size}&offset=${offset}`;
        const response = await providerFetch(url, {
          method: "GET", redirect: "error", signal: controller.signal,
          headers: { Authorization: `Basic ${credentials}`, Accept: "application/json" },
        });
        if (!response.ok || response.redirected || !/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "")) throw new ClinicalCallCaptureError("provider_response_invalid");
        const raw = await boundedBody(response, CALL_LIMITS.response_bytes);
        const page = callProviderPageSchema.parse(JSON.parse(raw));
        if (page.data.callId !== Number(callId) || page.pagination.offset !== offset || total !== null && total !== page.pagination.total) throw new ClinicalCallCaptureError("provider_pagination_changed");
        const pageMetadata = JSON.stringify({ callId: page.data.callId, language: page.data.language, callers: page.data.callers });
        if (metadata && metadata !== pageMetadata) throw new ClinicalCallCaptureError("provider_source_changed");
        metadata = pageMetadata; total = page.pagination.total;
        const count = page.data.segments.length;
        if (count !== Math.min(CALL_LIMITS.page_size, total - offset) || count < 1) throw new ClinicalCallCaptureError("provider_pagination_incomplete");
        for (const segment of page.data.segments) {
          // Preserve overlapping/equal timestamps (different speakers may overlap), but never reorder evidence.
          if (segment.start < previousStart) throw new ClinicalCallCaptureError("provider_segment_order_invalid");
          previousStart = segment.start; segments.push(segment);
        }
        const projection = segments.map((segment, index) => callProjectionLine(segment, index + 1)).join("");
        if (projection.length > CALL_LIMITS.characters || new TextEncoder().encode(projection).length > CALL_LIMITS.bytes) throw new ClinicalCallCaptureError("provider_budget_exceeded");
        pages.push({ pass, offset, limit: CALL_LIMITS.page_size, total, count, sha256: await callSha256(callPageFingerprintInput(page)), retrieved_at: new Date(now()).toISOString(), normalized_json: callPageFingerprintInput(page) });
        offset += count;
        if (offset === total) {
          const complete = { ...page.data, segments }, normalized = JSON.stringify(complete);
          if (pass === 1) { firstData = complete; reference = normalized; }
          else if (reference !== normalized) throw new ClinicalCallCaptureError("provider_source_changed");
          break;
        }
      } finally { clearTimeout(timer); }
    }
  }
  if (!firstData || now() - started > CALL_LIMITS.capture_ms) throw new ClinicalCallCaptureError("provider_budget_exceeded");
  let projection = "";
  const segments = [];
  for (const [index, segment] of firstData.segments.entries()) {
    const line = callProjectionLine(segment, index + 1), from = projection.length;
    projection += line;
    segments.push({ ordinal: index + 1, ...segment, text_sha256: await callSha256(segment.text), projection_from: from, projection_to: projection.length });
  }
  const document = callSourceDocumentSchema.parse({
    contract_version: CALL_SOURCE_CONTRACT, provider_schema_version: CALL_PROVIDER_SCHEMA,
    completeness: "observed_two_pass", call_id: callId, language: firstData.language,
    callers: firstData.callers, segments, projection, pages,
    captured_from: new Date(started).toISOString(), captured_until: new Date(now()).toISOString(),
  });
  if (new TextEncoder().encode(JSON.stringify(document)).length > 2000000) throw new ClinicalCallCaptureError("provider_budget_exceeded");
  return document;
}
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization,apikey,x-client-info,content-type", "Access-Control-Allow-Methods": "POST,OPTIONS" };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "private, no-store" } });
export function createClinicalCallHandler(deps: ClinicalCallDependencies) {
  return async (request: Request) => {
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    if (request.method !== "POST") return json({ error: { code: "invalid_request" } }, 405);
    const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/i)?.[1];
    if (!token) return json({ error: { code: "authentication_required" } }, 401);
    let id: string | undefined, dispatched = false;
    try {
      const raw = await boundedBody(new Response(request.body), 2048);
      if (raw.length > 2048) return json({ error: { code: "invalid_request" } }, 422);
      id = z.object({ capture_id: z.string().uuid() }).strict().parse(JSON.parse(raw)).capture_id;
      const auth = await deps.authenticate(token);
      if (!auth) return json({ error: { code: "authentication_required" } }, 401);
      const current = callCaptureReadSchema.parse(await auth.read(id));
      if (current.action.actor_id !== auth.actorId) return json({ error: { code: "forbidden" } }, 403);
      if (current.action.state !== "pending") return json(current);
      if (!deps.enabled) return json({ error: { code: "capture_disabled" } }, 503);
      if (!deps.credentials) return json({ error: { code: "provider_unconfigured" } }, 503);
      const admitted = await deps.dispatch(id);
      if (admitted === null) return json(callCaptureReadSchema.parse(await auth.read(id)));
      const dispatch = callDispatchSchema.parse(admitted);
      if (dispatch.action.id !== id || dispatch.action.actor_id !== auth.actorId || dispatch.action.state !== "capturing") throw new ClinicalCallCaptureError("dispatch_invalid");
      dispatched = true;
      const document = await captureClinicalCallTranscript(dispatch.provider_call_id, deps.credentials, deps.providerFetch, deps.now);
      // Persistence retry uses identical bytes; never fetch the provider again after an uncertain save.
      try { await deps.finish(id, document); }
      catch { await deps.finish(id, document); }
      return json(callCaptureReadSchema.parse(await auth.read(id)));
    } catch (error) {
      if (id && dispatched) {
        const code = error instanceof ClinicalCallCaptureError ? error.code : "capture_unconfirmed";
        await deps.fail(id, code).catch(() => {});
      }
      const code = error instanceof ClinicalCallCaptureError ? error.code : "capture_unavailable";
      return json({ error: { code }, ...(id ? { capture_id: id } : {}) }, 409);
    }
  };
}
