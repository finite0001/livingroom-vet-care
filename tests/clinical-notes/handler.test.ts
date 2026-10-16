import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import {
  clinicalNoteRequest,
  createClinicalNoteHandler,
} from "../../supabase/functions/_shared/clinical-note-handler.ts";
import { audioDigest } from "../../supabase/functions/_shared/clinical-audio-model.ts";
import { veterinaryContextReceipt } from "../../supabase/functions/_shared/clinical-veterinary-context.ts";
function fixture() {
  const actor = randomUUID(),
    id = randomUUID(),
    attempt = randomUUID(),
    templateId = randomUUID(),
    now = new Date().toISOString();
  const source = "Owner reports no vomiting. Eyes not examined.";
  const template = {
    id: templateId,
    version: 1,
    definition: {
      name: "Synthetic note",
      detail: "standard",
      fields: [{
        id: "history",
        label: "History",
        destination: "subjective",
        instructions: "Preserve attribution.",
        required: true,
      }],
    },
    sha256: "a".repeat(64),
    status: "approved",
  };
  const job = {
    id,
    actor_id: actor,
    pet_id: randomUUID(),
    encounter_id: randomUUID(),
    expected_version: 1,
    policy_version: 2,
    template_id: templateId,
    template_version: 1,
    template_hash: template.sha256,
    source_kind: "typed",
    source_text: source,
    source_sha256: "",
    audio_job_id: null as string | null,
    source_audio_policy_version: null as number | null,
    source_note: "Synthetic fixture",
    proposal_id: null as string | null,
    created_at: now,
    attempts: [],
  };
  const policy = {
    version: 2,
    status: "approved",
    consent_text: "Synthetic fixture only",
    soap_model: "gpt-6-luna",
    reviewed_by: actor,
    reviewed_at: now,
    created_at: now,
  };
  const intent = {
    job_id: id,
    attempt_id: attempt,
    retry_of: null as string | null,
    reason: "",
    ack_cost: false,
  };
  let calls = 0, finishes = 0, claims = 0, dispatches = 0;
  const controls = {
    dispatch: true,
    lostSave: false,
    failSave: false,
    behavior: "success",
    authenticated: true,
    enabled: true,
    audioEnabled: true,
    corruptSource: false,
    claimMismatch: false,
    dispatchFailure: false,
  };
  const receipts: Record<string, unknown>[] = [],
    failures: {
      uncertain: boolean;
      code: string;
      details?: Record<string, unknown>;
    }[] = [];
  const deps = {
    enabled: true,
    audioEnabled: true,
    apiKey: "synthetic-not-a-key",
    authenticate: async () =>
      controls.authenticated
        ? {
          actorId: actor,
          read: async () => ({ job, policy, template }),
          claim: async () => {
            claims++;
            return {
              id: controls.claimMismatch ? randomUUID() : attempt,
              job_id: id,
              actor_id: actor,
              model: policy.soap_model,
              state: "claimed",
              intent: {
                reason: intent.reason,
                ack_cost: intent.ack_cost,
                retry_of: intent.retry_of,
                job_id: id,
              },
              lease_until: new Date(Date.now() + 90000).toISOString(),
              result_hash: null,
              error_code: null,
              failure_details: null,
              provider_request_id: null,
              created_at: now,
              finished_at: null,
            };
          },
        }
        : null,
    dispatch: async () => {
      dispatches++;
      if (controls.dispatchFailure) throw Error("Lost dispatch ACK");
      return controls.dispatch;
    },
    finish: async (_id: string, result: Record<string, unknown>) => {
      finishes++;
      receipts.push(result);
      job.proposal_id = attempt;
      if (controls.failSave || controls.lostSave && finishes === 1) {
        throw Error("Lost persistence ACK");
      }
      return job;
    },
    fail: async (
      _id: string,
      uncertain: boolean,
      code: string,
      details?: Record<string, unknown>,
    ) => {
      failures.push({ uncertain, code, details });
    },
    providerFetch: (async (url, options) => {
      calls++;
      assert.equal(String(url), "https://api.openai.com/v1/responses");
      assert.equal(
        new Headers(options?.headers).get("X-Client-Request-Id"),
        attempt,
      );
      const body = JSON.parse(String(options?.body));
      assert.equal(JSON.parse(body.input).source_text, source);
      assert.equal(body.store, false);
      assert.equal("tools" in body, false);
      if (controls.behavior === "timeout") {
        throw Error("Synthetic network loss");
      }
      if (controls.behavior === "body_lost") {
        return new Response(
          new ReadableStream({
            start(c) {
              c.error(Error("Interrupted body"));
            },
          }),
          { status: 200 },
        );
      }
      if (controls.behavior === "reject") {
        return Response.json({
          error: {
            code: "rate_limit_exceeded",
            message: "must never persist this source",
          },
        }, {
          status: 429,
          headers: { "retry-after": "30", "x-request-id": "rejected-fixture" },
        });
      }
      if (controls.behavior === "server_error") {
        return new Response("upstream error", { status: 503 });
      }
      if (controls.behavior === "bad") {
        return Response.json({ status: "incomplete" });
      }
      return Response.json({
        id: "synthetic-response",
        model: "gpt-6-luna-fixture",
        status: "completed",
        error: null,
        incomplete_details: null,
        output: [{
          type: "message",
          role: "assistant",
          status: "completed",
          content: [{
            type: "output_text",
            text: JSON.stringify({
              fields: [{
                field_id: "history",
                status: "supported",
                claims: [{
                  text: "Owner reports no vomiting.",
                  quote: "Owner reports no vomiting.",
                }],
                uncertainty: "",
              }],
              review_flags: [],
            }),
          }],
        }],
      }, { headers: { "x-request-id": "synthetic-request" } });
    }) as typeof fetch,
  };
  return {
    job,
    policy,
    template,
    intent,
    controls,
    stats: () => ({ calls, finishes, claims, dispatches, receipts, failures }),
    request: async (body = "{}", headers: Record<string, string> = {}) => {
      job.source_sha256 = controls.corruptSource
        ? "b".repeat(64)
        : await audioDigest(new TextEncoder().encode(source));
      return createClinicalNoteHandler({
        ...deps,
        enabled: controls.enabled,
        audioEnabled: controls.audioEnabled,
      })(
        new Request("http://localhost/notes", {
          method: "POST",
          headers: {
            Authorization: "Bearer synthetic",
            "x-note-intent": encodeURIComponent(JSON.stringify(intent)),
            "Content-Type": "application/json",
            ...headers,
          },
          body,
        }),
      );
    },
  };
}
test("Draft note policy and template block paid work before admission", async () => {
  const f = fixture();
  f.policy.status = "draft";
  f.policy.reviewed_by = null as unknown as string;
  f.policy.reviewed_at = null as unknown as string;
  assert.equal((await f.request()).status, 403);
  assert.equal(f.stats().calls, 0);
  assert.equal(f.stats().claims, 0);
  const t = fixture();
  t.template.status = "draft";
  assert.equal((await t.request()).status, 403);
  assert.equal(t.stats().calls, 0);
});
test("Disabled note processing and invalid auth do not reach providers", async () => {
  const f = fixture();
  f.controls.enabled = false;
  assert.equal((await f.request()).status, 503);
  f.controls.enabled = true;
  f.controls.authenticated = false;
  assert.equal((await f.request()).status, 401);
  assert.equal(f.stats().calls, 0);
});
test("Audio transcript adapter preserves the audio processing kill switch and cannot alter pinned source body", async () => {
  const f = fixture();
  f.job.source_kind = "audio_transcript";
  f.job.audio_job_id = randomUUID();
  f.job.source_audio_policy_version = 2;
  f.controls.audioEnabled = false;
  assert.equal((await f.request()).status, 503);
  assert.equal(f.stats().claims, 0);
  f.controls.audioEnabled = true;
  assert.equal((await f.request('{"source_text":"replacement"}')).status, 422);
  assert.equal(f.stats().calls, 0);
  assert.equal((await f.request()).status, 200);
  assert.equal(f.stats().calls, 1);
});
test("Source digest/actor/template identity and admitted attempt are validated before paid dispatch", async () => {
  const f = fixture();
  f.controls.corruptSource = true;
  assert.equal((await f.request()).status, 403);
  assert.equal(f.stats().calls, 0);
  const t = fixture();
  t.template.sha256 = "c".repeat(64);
  assert.equal((await t.request()).status, 403);
  assert.equal(t.stats().claims, 0);
  const a = fixture();
  a.controls.claimMismatch = true;
  assert.equal((await a.request()).status, 409);
  assert.equal(a.stats().dispatches, 0);
});
test("Duplicate dispatch and uncertain dispatch acknowledgements never send a provider request", async () => {
  const f = fixture();
  f.controls.dispatch = false;
  assert.equal((await f.request()).status, 200);
  assert.equal(f.stats().calls, 0);
  const d = fixture();
  d.controls.dispatchFailure = true;
  assert.equal((await d.request()).status, 409);
  assert.equal(d.stats().calls, 0);
});
test("Lost committed result acknowledgement repeats the exact persisted result, not provider work", async () => {
  const f = fixture();
  f.controls.lostSave = true;
  assert.equal((await f.request()).status, 200);
  assert.equal(f.stats().calls, 1);
  assert.equal(f.stats().finishes, 2);
  assert.deepEqual(f.stats().receipts[0], f.stats().receipts[1]);
  assert.equal(f.stats().receipts[0].prompt_version, "lrv-note-fields-v1");
  assert.equal(f.stats().receipts[0].source_sha256, f.job.source_sha256);
  assert.equal(f.stats().receipts[0].template_sha256, f.template.sha256);
  const expected = await veterinaryContextReceipt(
    clinicalNoteRequest("gpt-6-luna", {
      job: f.job,
      policy: f.policy,
      template: f.template,
    }),
  );
  assert.deepEqual(f.stats().receipts[0].language_context, expected);
});
test("Two failed persistence confirmations retain an uncertain original attempt without a new paid call", async () => {
  const f = fixture();
  f.controls.failSave = true;
  assert.equal((await f.request()).status, 503);
  assert.equal(f.stats().calls, 1);
  assert.equal(f.stats().finishes, 2);
  assert.equal(f.stats().failures[0].code, "result_save_unconfirmed");
});
test("Timeout/interrupted200body/503 stay uncertain, with no automatic paid retries", async () => {
  for (const behavior of ["timeout", "body_lost", "server_error"]) {
    const f = fixture();
    f.controls.behavior = behavior;
    assert.equal((await f.request()).status, 503);
    assert.equal(f.stats().calls, 1);
    assert.equal(f.stats().finishes, 0);
    assert.equal(f.stats().failures[0].uncertain, true);
  }
});
test("Known429 uses sanitized diagnostics and retry cooldown; incomplete output is unusable, never charted", async () => {
  const f = fixture();
  f.controls.behavior = "reject";
  assert.equal((await f.request()).status, 422);
  assert.deepEqual(f.stats().failures[0], {
    uncertain: false,
    code: "provider_rejected",
    details: {
      http_status: 429,
      request_id: "rejected-fixture",
      provider_code: "rate_limit_exceeded",
      retry_after_seconds: 30,
    },
  });
  assert.equal(f.stats().finishes, 0);
  assert.equal(
    JSON.stringify(f.stats().failures).includes("must never persist"),
    false,
  );
  const bad = fixture();
  bad.controls.behavior = "bad";
  assert.equal((await bad.request()).status, 422);
  assert.equal(bad.stats().failures[0].uncertain, false);
  assert.equal(bad.stats().finishes, 0);
});
