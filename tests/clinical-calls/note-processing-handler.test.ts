import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import type { z } from "zod";
import {
  createClinicalCallNoteHandler,
  type ClinicalCallNoteDependencies,
} from "../../supabase/functions/_shared/clinical-call-note-handler.ts";
import { callNoteAttemptSchema } from "../../supabase/functions/_shared/clinical-call-note-processing-model.ts";
import { callNoteProcessingFixture, saveSyntheticCallResult } from "./note-processing-fixture.ts";

async function harness(text?: string) {
  const fixture = await callNoteProcessingFixture(text);
  const counts = { claims: 0, dispatches: 0, providers: 0, finishes: 0 };
  const failures: { uncertain: boolean; code: string; details: Record<string, unknown> }[] = [];
  const savedResults: Record<string, unknown>[] = [];
  const controls = { authenticated: true, readFailure: false, claimMismatch: false, dispatch: true, dispatchFailure: false,
    lostFinishAck: false, failFinish: false, failFailureSave: false, behavior: "success" };
  const makeAttempt = (id: string, request: Record<string, unknown>) => callNoteAttemptSchema.parse({
    id: controls.claimMismatch ? randomUUID() : id, job_id: fixture.read.job.id, actor_id: fixture.actor,
    model: "gpt-6-luna", state: "claimed", intent: request,
    lease_until: "2026-10-17T15:01:30.000Z", result_hash: null, error_code: null,
    failure_details: null, provider_request_id: null, created_at: fixture.now, finished_at: null,
  });
  const deps: ClinicalCallNoteDependencies = {
    enabled: true, callEnabled: true, apiKey: "synthetic-not-a-key",
    authenticate: async () => controls.authenticated ? {
      actorId: fixture.actor,
      read: async (id) => {
        assert.equal(id, fixture.intent.job_id);
        if (controls.readFailure) throw Error("Synthetic revoked authority");
        return fixture.read;
      },
      claim: async (id, request) => {
        counts.claims++;
        assert.equal(id, fixture.intent.attempt_id);
        assert.deepEqual(request, { job_id: fixture.intent.job_id, retry_of: fixture.intent.retry_of,
          reason: fixture.intent.reason, ack_cost: fixture.intent.ack_cost });
        const attempt = makeAttempt(id, request);
        fixture.read.attempts.push(attempt);
        return attempt;
      },
    } : null,
    dispatch: async (jobId, attemptId) => {
      counts.dispatches++;
      assert.equal(jobId, fixture.intent.job_id); assert.equal(attemptId, fixture.intent.attempt_id);
      if (controls.dispatchFailure) throw Error("Synthetic lost dispatch ACK");
      if (controls.dispatch) fixture.read.attempts[0].state = "sending";
      return controls.dispatch;
    },
    finish: async (jobId, attemptId, result) => {
      counts.finishes++;
      assert.equal(jobId, fixture.intent.job_id); assert.equal(attemptId, fixture.intent.attempt_id);
      savedResults.push(result);
      if (controls.failFinish) throw Error("Synthetic persistence unavailable");
      await saveSyntheticCallResult(fixture.read, attemptId, result);
      if (controls.lostFinishAck && counts.finishes === 1) throw Error("Synthetic committed save ACK loss");
      return fixture.read;
    },
    fail: async (jobId, attemptId, uncertain, code, details) => {
      assert.equal(jobId, fixture.intent.job_id); assert.equal(attemptId, fixture.intent.attempt_id);
      failures.push({ uncertain, code, details });
      if (controls.failFailureSave) throw Error("Synthetic failed failure ACK");
    },
    providerFetch: async (url, options) => {
      counts.providers++;
      assert.equal(String(url), "https://api.openai.com/v1/responses");
      assert.equal(options?.method, "POST");
      assert.equal(options?.redirect, "error");
      assert.equal(new Headers(options?.headers).get("X-Client-Request-Id"), fixture.intent.attempt_id);
      const request = JSON.parse(String(options?.body));
      assert.equal(request.store, false); assert.equal(request.background, false); assert.equal(request.stream, false);
      assert.equal("tools" in request, false);
      const input = JSON.parse(request.input);
      assert.equal(input.source_reference.id, fixture.read.source.id);
      assert.equal(input.segments[0].text, fixture.read.source.document.segments[0].text);
      assert.ok(options?.signal);
      if (controls.behavior === "timeout") throw Error("Synthetic network outcome unknown");
      if (controls.behavior === "body_lost") return new Response(new ReadableStream({ start(controller) {
        controller.enqueue(new TextEncoder().encode('{"id":')); controller.error(Error("Private source-bearing interruption"));
      } }));
      if (controls.behavior === "oversized") return new Response("x".repeat(512001));
      if (controls.behavior === "server_error" || controls.behavior === "rate_limit") {
        return new Response(JSON.stringify({ error: { code: "quota_exceeded", message: "PRIVATE SOURCE TEXT", secret: "PRIVATE" } }), {
          status: controls.behavior === "server_error" ? 503 : 429,
          headers: { "x-request-id": "req_private_outcome", "retry-after": "17" },
        });
      }
      if (controls.behavior === "invalid_json") return new Response("not JSON");
      if (controls.behavior === "incomplete") return new Response(JSON.stringify({ ...fixture.response(), status: "incomplete" }));
      if (controls.behavior === "bad_citation") {
        const payload = structuredClone(fixture.payload); payload.fields[0].claims[0].supports[0].quote = "Invented quote";
        return new Response(JSON.stringify(fixture.response(payload)));
      }
      if (controls.behavior === "revoked_after_provider") controls.readFailure = true;
      return new Response(JSON.stringify(fixture.response()), { headers: { "x-request-id": "req_synthetic_call" } });
    },
  };
  const post = (body: unknown = fixture.intent, authenticated = true) => new Request("https://synthetic.invalid/clinical-call-note-process", {
    method: "POST", headers: authenticated ? { Authorization: "Bearer synthetic", "Content-Type": "application/json" } : {},
    body: JSON.stringify(body),
  });
  const run = (body?: unknown, authenticated = true) => createClinicalCallNoteHandler(deps)(post(body, authenticated));
  const seedAttempt = (state: z.infer<typeof callNoteAttemptSchema>["state"]) => {
    const { attempt_id: _attempt, ...request } = fixture.intent;
    const attempt = makeAttempt(fixture.intent.attempt_id, request); attempt.state = state;
    fixture.read.attempts.push(attempt);
  };
  return { ...fixture, controls, deps, counts, failures, savedResults, run, seedAttempt };
}

test("anonymous, unavailable Auth, independent gates and absent key block call generation before admission", async () => {
  const fixture = await harness();
  assert.equal((await fixture.run(undefined, false)).status, 401);
  fixture.controls.authenticated = false;
  assert.equal((await fixture.run()).status, 401);
  fixture.controls.authenticated = true;
  for (const key of ["enabled", "callEnabled"] as const) {
    fixture.deps[key] = false;
    assert.equal((await fixture.run()).status, 503);
    fixture.deps[key] = true;
  }
  fixture.deps.apiKey = undefined;
  assert.equal((await fixture.run()).status, 503);
  assert.deepEqual(fixture.counts, { claims: 0, dispatches: 0, providers: 0, finishes: 0 });
  fixture.deps.authenticate = async () => { throw Error("Private Auth diagnostic"); };
  assert.equal((await fixture.run()).status, 503);
});

test("source authority, pinned identities and current policies block paid call work", async () => {
  for (const mutate of [
    (fixture: Awaited<ReturnType<typeof harness>>) => { fixture.controls.readFailure = true; },
    (fixture: Awaited<ReturnType<typeof harness>>) => { fixture.read.job.actor_id = randomUUID(); },
    (fixture: Awaited<ReturnType<typeof harness>>) => { fixture.read.job.source_sha256 = "c".repeat(64); },
    (fixture: Awaited<ReturnType<typeof harness>>) => { fixture.read.binding.call_source_sha256 = "d".repeat(64); },
    (fixture: Awaited<ReturnType<typeof harness>>) => { fixture.read.note_policy.version++; },
    (fixture: Awaited<ReturnType<typeof harness>>) => { fixture.read.capture_policy.version++; },
    (fixture: Awaited<ReturnType<typeof harness>>) => { fixture.read.call_generation_policy.version++; },
    (fixture: Awaited<ReturnType<typeof harness>>) => { fixture.read.template.status = "retired"; },
  ]) {
    const fixture = await harness(); mutate(fixture);
    assert.equal((await fixture.run()).status, 403);
    assert.equal(fixture.counts.claims, 0); assert.equal(fixture.counts.providers, 0);
  }
});

test("processing accepts only bounded original attempt intent and refuses pasted replacement evidence", async () => {
  const fixture = await harness();
  for (const body of [{}, { ...fixture.intent, transcript: "Replacement" }, { ...fixture.intent, source_id: fixture.read.source.id },
    { ...fixture.intent, reason: "x".repeat(1001) }, { ...fixture.intent, reason: "\u0001".repeat(8000) }]) {
    assert.equal((await fixture.run(body)).status, 422);
  }
  assert.equal(fixture.counts.claims, 0); assert.equal(fixture.counts.providers, 0);
});

test("oversized serialized provider request fails before admission and paid dispatch", async () => {
  const fixture = await harness("\u0001".repeat(58000) + "Owner declines treatment");
  assert.equal((await fixture.run()).status, 403);
  assert.deepEqual(fixture.counts, { claims: 0, dispatches: 0, providers: 0, finishes: 0 });
});

test("returned attempt mismatch, duplicate dispatch and lost dispatch ACK never send OpenAI work", async () => {
  for (const mode of ["claimMismatch", "dispatchFailure", "duplicate"] as const) {
    const fixture = await harness();
    if (mode === "duplicate") fixture.controls.dispatch = false;
    else fixture.controls[mode] = true;
    assert.equal((await fixture.run()).status, mode === "duplicate" ? 200 : 409);
    assert.equal(fixture.counts.providers, 0); assert.equal(fixture.counts.finishes, 0);
  }
});

test("completed and sending original attempts recover private history after policy or template eligibility changes", async () => {
  for (const state of ["completed", "sending", "failed", "uncertain", "superseded"] as const) {
    const fixture = await harness(); fixture.seedAttempt(state);
    if (state === "completed") await saveSyntheticCallResult(fixture.read, fixture.intent.attempt_id, await fixture.result());
    fixture.read.note_policy.status = "draft";
    fixture.read.note_policy.reviewed_at = null; fixture.read.note_policy.reviewed_by = null;
    fixture.read.call_generation_policy.status = "draft";
    fixture.read.call_generation_policy.reviewed_at = null; fixture.read.call_generation_policy.reviewed_by = null;
    fixture.read.template.status = "retired";
    const response = await fixture.run();
    assert.equal(response.status, 200);
    assert.equal((await response.json()).attempts[0].state, state);
    assert.deepEqual(fixture.counts, { claims: 0, dispatches: 0, providers: 0, finishes: 0 });
  }
});

test("historical duplicate attempt requires its exact original intent and claimed work still needs current approval", async () => {
  const fixture = await harness(); fixture.seedAttempt("sending");
  assert.equal((await fixture.run({ ...fixture.intent, reason: "Different work" })).status, 409);
  assert.deepEqual(fixture.counts, { claims: 0, dispatches: 0, providers: 0, finishes: 0 });
  fixture.read.attempts[0].state = "claimed"; fixture.read.template.status = "retired";
  assert.equal((await fixture.run()).status, 403);
  assert.deepEqual(fixture.counts, { claims: 0, dispatches: 0, providers: 0, finishes: 0 });
});

test("one call draft persists exact source and veterinary receipts, without a second provider request after lost save ACK", async () => {
  const fixture = await harness(); fixture.controls.lostFinishAck = true;
  const response = await fixture.run();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(fixture.counts, { claims: 1, dispatches: 1, providers: 1, finishes: 2 });
  assert.deepEqual(fixture.savedResults[0], fixture.savedResults[1]);
  assert.equal(fixture.read.generation?.manifest.request_id, "req_synthetic_call");
  assert.equal(fixture.read.generation?.manifest.source_id, fixture.read.source.id);
  assert.equal(fixture.read.generation?.manifest.veterinary_context.version.startsWith("lrv-vet-en-v"), true);
  assert.equal(fixture.read.review, null);
});

test("failed finish confirmation retains original uncertain attempt and repeats persistence only", async () => {
  const fixture = await harness(); fixture.controls.failFinish = true;
  const response = await fixture.run();
  assert.equal(response.status, 503);
  assert.equal(fixture.counts.providers, 1); assert.equal(fixture.counts.finishes, 2);
  assert.deepEqual(fixture.savedResults[0], fixture.savedResults[1]);
  assert.deepEqual(fixture.failures, [{ uncertain: true, code: "result_save_unconfirmed", details: {} }]);
  assert.equal(fixture.read.proposal, null);
});

test("timeout, interrupted response, oversized response and server failure stay uncertain without provider retries", async () => {
  for (const behavior of ["timeout", "body_lost", "oversized", "server_error"]) {
    const fixture = await harness(); fixture.controls.behavior = behavior; fixture.controls.failFailureSave = true;
    const response = await fixture.run();
    assert.equal(response.status, 503);
    assert.equal(fixture.counts.providers, 1); assert.equal(fixture.counts.finishes, 0);
    assert.equal(fixture.failures[0].uncertain, true);
    assert.equal((await response.text()).includes("PRIVATE"), false);
    assert.equal(fixture.read.proposal, null);
  }
});

test("known provider refusal keeps only bounded metadata and incomplete or invalid evidence cannot become a proposal", async () => {
  for (const behavior of ["rate_limit", "invalid_json", "incomplete", "bad_citation"]) {
    const fixture = await harness(); fixture.controls.behavior = behavior;
    const response = await fixture.run();
    assert.equal(response.status, 422);
    assert.equal(fixture.counts.providers, 1); assert.equal(fixture.counts.finishes, 0);
    assert.equal(fixture.failures[0].uncertain, false);
    if (behavior === "rate_limit") assert.deepEqual(fixture.failures[0].details, {
      http_status: 429, request_id: "req_private_outcome", retry_after_seconds: 17, provider_code: "quota_exceeded",
    });
    assert.equal(JSON.stringify(fixture.failures).includes("PRIVATE"), false);
    assert.equal(fixture.read.proposal, null);
  }
});

test("authority lost after provider completion never returns private history or retries paid generation", async () => {
  const fixture = await harness(); fixture.controls.behavior = "revoked_after_provider";
  const response = await fixture.run();
  assert.equal(response.status, 503);
  const body = await response.text();
  assert.equal(body.includes(fixture.read.source.document.segments[0].text), false);
  assert.equal(fixture.counts.providers, 1);
  assert.equal(fixture.counts.finishes, 2);
});
