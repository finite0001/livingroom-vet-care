import assert from "node:assert/strict";
import test from "node:test";
import { instant, providerResponse, recapFixture } from "./fixtures.ts";
import {
  type ClinicalRecapDependencies,
  createClinicalRecapHandler,
} from "../../supabase/functions/_shared/clinical-recap-handler.ts";
import {
  recapRefusal,
  recapRefusalSchema,
  recapResultSchema,
} from "../../supabase/functions/_shared/clinical-recap-model.ts";
function harness() {
  const f = recapFixture();
  const controls = {
    authenticated: true,
    dispatch: true,
    lostFinishAck: false,
    failFinish: false,
    readLostAfterFinish: false,
    outcome: "completed" as "completed" | "policy_changed" | "forbidden",
    behavior: "success",
    claimError: null as unknown,
    staleAtFinish: false,
  };
  const calls = { provider: 0, claim: 0, dispatch: 0, finish: 0, read: 0 };
  const saved: unknown[] = [],
    failed: {
      uncertain: boolean;
      code: string;
      details?: Record<string, unknown>;
    }[] = [];
  const deps: ClinicalRecapDependencies = {
    enabled: true,
    apiKey: "not-a-key-synthetic-only",
    authenticate: async () =>
      controls.authenticated
        ? {
          actorId: f.actor,
          read: async () => {
            calls.read++;
            if (controls.readLostAfterFinish && calls.finish) {
              throw Error("private read failure");
            }
            return f.context;
          },
          claim: async () => {
            calls.claim++;
            if (controls.claimError) throw controls.claimError;
            return f.attempt;
          },
        }
        : null,
    dispatch: async () => {
      calls.dispatch++;
      return controls.dispatch;
    },
    finish: async (_id, result) => {
      calls.finish++;
      saved.push(structuredClone(result));
      if (controls.failFinish) throw Error("lost persistence ACK");
      if (controls.outcome === "completed") {
        const parsed = recapResultSchema.parse(result),
          { payload, ...provider_manifest } = parsed;
        f.context.job.attempts = [
          {
            ...f.attempt,
            state: "completed",
            result_hash: "e".repeat(64),
            finished_at: instant,
          } as typeof f.context.job.attempts[number],
        ];
        f.context.job.output_id = f.attemptId;
        f.context.output = {
          id: f.attemptId,
          job_id: f.jobId,
          manifest_sha256: f.context.manifest.sha256,
          payload,
          payload_sha256: "d".repeat(64),
          provider_manifest,
          created_at: instant,
        };
        if (controls.staleAtFinish) {
          f.context.current = {
            source_status: "stale",
            reasons: ["addenda_changed"],
          };
        }
      }
      if (controls.lostFinishAck && calls.finish === 1) {
        throw Error("lost persistence ACK");
      }
      return {
        job_id: f.jobId,
        attempt_id: f.attemptId,
        retained: controls.outcome === "completed",
        outcome: controls.outcome,
      };
    },
    fail: async (_id, uncertain, code, details) => {
      failed.push({ uncertain, code, details });
    },
    providerFetch: async (_url, init) => {
      calls.provider++;
      assert.equal(
        new Headers(init?.headers).get("X-Client-Request-Id"),
        f.attemptId,
      );
      assert.equal((JSON.parse(String(init?.body))).model, "gpt-6-luna");
      if (controls.behavior === "network") {
        throw Error("secret source network error");
      }
      if (controls.behavior === "rate") {
        return new Response(
          JSON.stringify({
            error: { code: "insufficient_quota", message: "secret" },
          }),
          {
            status: 429,
            headers: { "retry-after": "30", "x-request-id": "req_safe" },
          },
        );
      }
      if (controls.behavior === "server") {
        return new Response("secret", { status: 503 });
      }
      if (controls.behavior === "invalid") {
        return new Response(
          JSON.stringify(
            providerResponse({
              ...f.payload,
              claims: [{
                ...f.payload.claims[0],
                citations: [{
                  source_ref: "src_0001",
                  field_path: "fields.subjective",
                  quote: "invented",
                }],
              }],
            }),
          ),
        );
      }
      return new Response(JSON.stringify(providerResponse(f.payload)), {
        headers: { "x-request-id": "req_synthetic" },
      });
    },
  };
  const request = (body: unknown = {}) =>
    new Request("https://synthetic.invalid/clinical-recap-process", {
      method: "POST",
      headers: {
        Authorization: "Bearer synthetic",
        "x-recap-intent": encodeURIComponent(JSON.stringify(f.intent)),
      },
      body: JSON.stringify(body),
    });
  const run = (body: unknown = {}) =>
    createClinicalRecapHandler(deps)(request(body));
  return { ...f, controls, calls, saved, failed, deps, request, run };
}
async function refusal(response: Response) {
  return recapRefusalSchema.parse((await response.json()).error);
}

test("generation is bounded to one paid request and returns immutable claim provenance", async () => {
  const h = harness(), response = await h.run();
  assert.equal(response.status, 200);
  const value = await response.json();
  assert.equal(value.output.id, h.attemptId);
  assert.equal(
    value.output.provider_manifest.manifest_sha256,
    h.context.manifest.sha256,
  );
  assert.equal(
    value.output.provider_manifest.language_context.request_sha256.length,
    64,
  );
  assert.equal(h.calls.provider, 1);
  assert.equal(h.calls.finish, 1);
  assert.deepEqual(h.failed, []);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
});
test("independent default OFF gate, auth, strict body, owner, policy and source checks prevent paid calls", async () => {
  for (
    const change of [
      (h: ReturnType<typeof harness>) => {
        h.deps.enabled = false;
      },
      (h: ReturnType<typeof harness>) => {
        h.controls.authenticated = false;
      },
      (h: ReturnType<typeof harness>) => {
        h.context.job.actor_id = h.pet;
      },
      (h: ReturnType<typeof harness>) => {
        h.context.policy.version++;
      },
      (h: ReturnType<typeof harness>) => {
        h.context.current = {
          source_status: "stale",
          reasons: ["addenda_changed"],
        };
      },
    ]
  ) {
    const h = harness();
    change(h);
    const response = await h.run();
    assert.notEqual(response.status, 200);
    await refusal(response);
    assert.equal(h.calls.provider, 0);
  }
  const h = harness();
  assert.equal((await h.run({ source_text: "secret" })).status, 422);
  assert.equal(h.calls.claim, 0);
});
test("cancelled admission and duplicate dispatch never call provider", async () => {
  const h = harness();
  h.controls.claimError = {
    code: "PT409",
    message: "private",
    details: JSON.stringify(recapRefusal("action_cancelled")),
  };
  assert.equal((await refusal(await h.run())).code, "action_cancelled");
  assert.equal(h.calls.provider, 0);
  const duplicate = harness();
  duplicate.controls.dispatch = false;
  assert.equal((await duplicate.run()).status, 200);
  assert.equal(duplicate.calls.provider, 0);
  assert.equal(duplicate.calls.finish, 0);
});
test("lost finish ACK repeats only identical result persistence", async () => {
  const h = harness();
  h.controls.lostFinishAck = true;
  assert.equal((await h.run()).status, 200);
  assert.equal(h.calls.provider, 1);
  assert.equal(h.calls.finish, 2);
  assert.deepEqual(h.saved[0], h.saved[1]);
  assert.equal(h.failed.length, 0);
});
test("policy/session loss keeps receipt sanitized and does not read source again", async () => {
  for (const outcome of ["policy_changed", "forbidden"] as const) {
    const h = harness();
    h.controls.outcome = outcome;
    const response = await h.run();
    assert.equal(response.status, outcome === "forbidden" ? 403 : 409);
    assert.equal((await refusal(response)).code, outcome);
    assert.equal(h.calls.read, 1);
    assert.equal(h.calls.provider, 1);
    assert.equal(h.failed.length, 0);
  }
});
test("stale source-only finish retains review output while confirmed completion read failure never overwrites attempt", async () => {
  const h = harness();
  h.controls.staleAtFinish = true;
  const response = await h.run();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).current.source_status, "stale");
  const lost = harness();
  lost.controls.readLostAfterFinish = true;
  assert.equal((await refusal(await lost.run())).code, "operation_unavailable");
  assert.equal(lost.calls.finish, 1);
  assert.equal(lost.calls.provider, 1);
  assert.equal(lost.failed.length, 0);
});
test("unknown provider or persistence outcomes stay uncertain without automatic provider retry", async () => {
  for (const behavior of ["network", "server"]) {
    const h = harness();
    h.controls.behavior = behavior;
    const response = await h.run();
    assert.equal(response.status, 504);
    assert.equal((await refusal(response)).code, "provider_uncertain");
    assert.equal(h.calls.provider, 1);
    assert.equal(h.failed[0].uncertain, true);
    assert.equal(h.calls.finish, 0);
  }
  const h = harness();
  h.controls.failFinish = true;
  assert.equal((await h.run()).status, 504);
  assert.equal(h.calls.provider, 1);
  assert.equal(h.calls.finish, 2);
  assert.equal(h.failed[0].code, "result_save_unconfirmed");
});
test("provider rejection retains only bounded metadata; invalid citations never finish", async () => {
  const h = harness();
  h.controls.behavior = "rate";
  const response = await h.run();
  assert.equal(response.status, 429);
  const error = await refusal(response);
  assert.equal(error.code, "rate_limited");
  assert.equal(error.retry_after_seconds, 30);
  assert.equal(JSON.stringify(h.failed).includes("secret"), false);
  assert.equal(h.failed[0].uncertain, false);
  const bad = harness();
  bad.controls.behavior = "invalid";
  assert.equal(
    (await refusal(await bad.run())).code,
    "invalid_provider_output",
  );
  assert.equal(bad.calls.finish, 0);
  assert.equal(bad.failed[0].uncertain, false);
});
