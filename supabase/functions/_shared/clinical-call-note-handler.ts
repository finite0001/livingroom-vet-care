import { z } from "zod";
import {
  CALL_NOTE_PROVIDER_LIMITS,
  clinicalCallNoteRequest,
  parseClinicalCallNoteResponse,
} from "./clinical-call-note-provider.ts";
import {
  callNoteAttemptSchema,
  callNoteIntentSchema,
  callNoteProviderContext,
  callNoteResultSchema,
  validateCallNoteProcessingRead,
} from "./clinical-call-note-processing-model.ts";

interface CallNoteAuth {
  actorId: string;
  read(jobId: string): Promise<unknown>;
  claim(attemptId: string, request: Record<string, unknown>): Promise<unknown>;
}
export interface ClinicalCallNoteDependencies {
  enabled: boolean;
  callEnabled: boolean;
  apiKey: string | undefined;
  authenticate(token: string): Promise<CallNoteAuth | null>;
  dispatch(jobId: string, attemptId: string): Promise<boolean>;
  finish(jobId: string, attemptId: string, result: Record<string, unknown>): Promise<unknown>;
  fail(jobId: string, attemptId: string, uncertain: boolean, code: string, details: Record<string, unknown>): Promise<void>;
  providerFetch?: typeof fetch;
}

async function boundedBytes(body: ReadableStream<Uint8Array> | null, maximum: number) {
  if (!body) throw Error("Body required.");
  const reader = body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > maximum) {
        await reader.cancel();
        throw Error("Body limit exceeded.");
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}
class CallProviderFailure extends Error {
  readonly uncertain: boolean;
  readonly code: string;
  readonly details: Record<string, unknown>;
  constructor(uncertain: boolean, code: string, details: Record<string, unknown> = {}) {
    super(code);
    this.uncertain = uncertain;
    this.code = code;
    this.details = details;
  }
}
async function responseDigest(bytes: Uint8Array) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function providerJson(response: Response) {
  if (!response.ok) {
    const details: Record<string, unknown> = {
      http_status: response.status,
      request_id: (response.headers.get("x-request-id") ?? "").slice(0, 200),
    };
    const retry = response.headers.get("retry-after");
    if (retry) {
      const seconds = /^\d+$/.test(retry) ? Number(retry) : Math.ceil((Date.parse(retry) - Date.now()) / 1000);
      if (Number.isFinite(seconds)) details.retry_after_seconds = Math.min(86400, Math.max(0, seconds));
    }
    try {
      const bytes = await boundedBytes(response.body, 8192);
      details.provider_response_sha256 = await responseDigest(bytes);
      const raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      if (typeof raw?.error?.code === "string" && /^[a-z0-9_]{1,80}$/.test(raw.error.code)) {
        details.provider_code = raw.error.code;
      }
    } catch { /* Never persist provider error bodies or source-bearing messages. */ }
    throw new CallProviderFailure(response.status >= 500 || response.status === 408, "provider_rejected", details);
  }
  let bytes: Uint8Array;
  try { bytes = await boundedBytes(response.body, CALL_NOTE_PROVIDER_LIMITS.response_bytes); }
  catch { throw new CallProviderFailure(true, "provider_response_unconfirmed"); }
  const response_sha256 = await responseDigest(bytes);
  try { return { value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown, response_sha256 }; }
  catch { throw new CallProviderFailure(false, "invalid_provider_output", { provider_response_sha256: response_sha256 }); }
}

export function createClinicalCallNoteHandler(deps: ClinicalCallNoteDependencies) {
  const headers = {
    "Content-Type": "application/json",
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization,apikey,content-type,x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
  const reply = (status: number, code: string, error: string) =>
    new Response(JSON.stringify({ code, error }), { status, headers });
  return async (request: Request): Promise<Response> => {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (request.method !== "POST") return reply(405, "method_not_allowed", "Method not allowed.");
    const token = request.headers.get("Authorization")?.match(/^Bearer (\S+)$/)?.[1];
    if (!token) return reply(401, "authentication_required", "Staff sign-in required.");
    let auth: CallNoteAuth | null;
    try { auth = await deps.authenticate(token); }
    catch { return reply(503, "authentication_unconfirmed", "Staff access could not be confirmed."); }
    if (!auth) return reply(401, "authentication_required", "Staff sign-in required.");
    if (!deps.enabled || !deps.callEnabled || !deps.apiKey) {
      return reply(503, "processing_disabled", "OpenAI call-note processing is not commissioned.");
    }
    let intent: z.infer<typeof callNoteIntentSchema>;
    try {
      intent = callNoteIntentSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await boundedBytes(request.body, 8192))));
    } catch {
      return reply(422, "invalid_intent", "Exact original call-note attempt intent required; the retained source is already pinned.");
    }
    let read: Awaited<ReturnType<typeof validateCallNoteProcessingRead>>;
    try {
      read = await validateCallNoteProcessingRead(await auth.read(intent.job_id));
      if (read.job.id !== intent.job_id || read.job.actor_id !== auth.actorId) throw Error();
    } catch {
      return reply(403, "source_unavailable", "Exact current administrator-owned call source required.");
    }
    const existing = read.attempts.find((item) => item.id === intent.attempt_id);
    if (existing) {
      if (existing.actor_id !== auth.actorId || existing.intent.job_id !== intent.job_id
        || existing.intent.retry_of !== intent.retry_of || existing.intent.reason !== intent.reason
        || existing.intent.ack_cost !== intent.ack_cost) {
        return reply(409, "attempt_intent_conflict", "The original attempt belongs to different work. Recover its exact saved identity.");
      }
      if (existing.state !== "claimed") {
        // Recovery is a private historical read, not another admission or dispatch.
        return new Response(JSON.stringify(read), { status: 200, headers });
      }
    }
    let providerContext: ReturnType<typeof callNoteProviderContext>;
    let providerRequest: Awaited<ReturnType<typeof clinicalCallNoteRequest>>;
    try {
      providerContext = callNoteProviderContext(read);
      providerRequest = await clinicalCallNoteRequest(providerContext);
    } catch {
      return reply(403, "generation_ineligible", "Call processing policy, template or retained source is not eligible for generation.");
    }
    let attempt: z.infer<typeof callNoteAttemptSchema>;
    try {
      attempt = callNoteAttemptSchema.parse(await auth.claim(intent.attempt_id, {
        job_id: intent.job_id, retry_of: intent.retry_of, reason: intent.reason, ack_cost: intent.ack_cost,
      }));
      if (attempt.id !== intent.attempt_id || attempt.job_id !== intent.job_id
        || attempt.actor_id !== auth.actorId || attempt.model !== providerContext.model
        || attempt.intent.job_id !== intent.job_id || attempt.intent.retry_of !== intent.retry_of
        || attempt.intent.reason !== intent.reason || attempt.intent.ack_cost !== intent.ack_cost) throw Error();
    } catch {
      return reply(409, "admission_unconfirmed", "Attempt could not be admitted. Recover the original state before any explicit retry.");
    }
    const recover = async () => {
      const value = await validateCallNoteProcessingRead(await auth.read(intent.job_id));
      if (value.job.id !== intent.job_id || value.job.actor_id !== auth.actorId) throw Error();
      return new Response(JSON.stringify(value), { status: 200, headers });
    };
    let dispatched: boolean;
    try { dispatched = await deps.dispatch(intent.job_id, attempt.id); }
    catch {
      return reply(409, "dispatch_unconfirmed", "Dispatch was not confirmed. Recover the original attempt; do not create a duplicate.");
    }
    if (!dispatched) {
      try { return await recover(); }
      catch { return reply(503, "recovery_required", "Recover the original processing attempt before retrying."); }
    }
    let result: z.infer<typeof callNoteResultSchema>, received = false, completeResponseSha: string | null = null;
    try {
      const response = await (deps.providerFetch ?? fetch)("https://api.openai.com/v1/responses", {
        method: "POST",
        redirect: "error",
        headers: {
          Authorization: `Bearer ${deps.apiKey}`,
          "Content-Type": "application/json",
          "X-Client-Request-Id": attempt.id,
        },
        body: JSON.stringify(providerRequest),
        signal: AbortSignal.timeout(60000),
      });
      const requestId = response.headers.get("x-request-id") ?? "";
      if (requestId.length > 200) throw new CallProviderFailure(false, "invalid_provider_output");
      const observed = await providerJson(response);
      completeResponseSha = observed.response_sha256;
      received = true;
      result = callNoteResultSchema.parse({
        ...await parseClinicalCallNoteResponse(observed.value, providerContext, { response_sha256: observed.response_sha256 }),
        request_id: requestId,
      });
    } catch (error) {
      const uncertain = error instanceof CallProviderFailure ? error.uncertain : !received;
      const code = error instanceof CallProviderFailure ? error.code
        : uncertain ? "provider_outcome_unknown" : "invalid_provider_output";
      try {
        await deps.fail(intent.job_id, attempt.id, uncertain, code, error instanceof CallProviderFailure ? error.details : completeResponseSha ? { provider_response_sha256: completeResponseSha } : {});
      } catch { /* Retain the durable original sending state; never repeat provider work. */ }
      return reply(uncertain ? 503 : 422, code, uncertain
        ? "Provider outcome is unknown and may have been billed. Recover the original attempt before any explicit retry."
        : code === "provider_rejected"
        ? "OpenAI rejected processing. Ask the practice administrator to check provider access, model availability or quota. The chart has not changed."
        : "No usable call-note draft was returned. The saved chart has not changed.");
    }
    for (let confirmation = 0; confirmation < 2; confirmation++) {
      try {
        await deps.finish(intent.job_id, attempt.id, result);
        return await recover();
      } catch { /* Only the exact received result may be repeated; no second OpenAI request. */ }
    }
    try { await deps.fail(intent.job_id, attempt.id, true, "result_save_unconfirmed", {}); }
    catch { /* Current private history is the recovery authority. */ }
    return reply(503, "result_save_unconfirmed", "Provider returned a result, but saving could not be confirmed. Recover the original attempt before retrying.");
  };
}
