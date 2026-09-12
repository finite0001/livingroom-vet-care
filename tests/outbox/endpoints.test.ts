import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as policy from "../../supabase/functions/_shared/delivery-policy.ts";
async function invoke(
  name: string,
  body: unknown,
  options: {
    authenticated?: boolean;
    mode?: string;
    authorization?: string;
    rpcCode?: string;
    prepared?: boolean;
  } = {},
) {
  const calls: unknown[] = [];
  let handler: ((req: Request) => Promise<Response>) | undefined;
  const env: Record<string, string> = {
    SUPABASE_URL: "https://synthetic.test",
    SUPABASE_ANON_KEY: "anon",
    SUPABASE_SERVICE_ROLE_KEY: "service-secret",
    APP_ENV: "staging",
    OUTBOUND_DELIVERY_MODE: options.mode ?? "test",
    OUTBOUND_TEST_EMAILS: "client@example.test",
  };
  const db = {
    auth: {
      getUser: async () => ({
        data: {
          user: options.authenticated === false ? null : { id: "staff-id" },
        },
        error: null,
      }),
    },
    rpc: async (name: string, args: unknown) => {
      calls.push({ name, args });
      return {
        data: { id: "outbox", message_id: "message", state: "pending" },
        error: options.rpcCode
          ? { code: options.rpcCode }
          : name === "enqueue_communication" && !options.prepared
            ? { code: "42501" }
            : null,
      };
    },
  };
  const source = readFileSync(
    new URL(`../../supabase/functions/${name}/index.ts`, import.meta.url),
    "utf8",
  ).replace(/^import[\s\S]*?;\n/gm, "");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.None,
    },
  }).outputText;
  runInNewContext(compiled, {
    ...policy,
    serve: (fn: typeof handler) => {
      handler = fn;
    },
    createClient: () => db,
    dispatchOne: async () => {
      calls.push("dispatch");
      return { processed: false };
    },
    Deno: { env: { get: (key: string) => env[key] } },
    Request,
    Response,
  });
  assert.ok(handler);
  const response = await handler(
    new Request("https://edge.test", {
      method: "POST",
      headers: { Authorization: options.authorization ?? "Bearer staff-token" },
      body: JSON.stringify(body),
    }),
  );
  return { status: response.status, body: await response.json(), calls };
}
const request = {
  request_id: "11111111-1111-4111-8111-111111111111",
  conversation_id: "22222222-2222-4222-8222-222222222222",
  channel: "EMAIL",
  to: "client@example.test",
  subject: "Visit",
  body: "Synthetic",
};
test("enqueue returns queued without claiming provider acceptance or delivery", async () => {
  const result = await invoke("enqueue-message", request, { prepared: true });
  assert.equal(result.status, 202);
  assert.equal(result.body.queued, true);
  assert.equal(result.body.accepted, false);
  assert.equal(result.body.delivered, false);
  assert.deepEqual(JSON.parse(JSON.stringify(result.calls)), [
    {
      name: "enqueue_communication",
      args: {
        p_actor_id: "staff-id",
        p_request_id: request.request_id,
        p_conversation_id: request.conversation_id,
        p_channel: "EMAIL",
        p_recipient: "client@example.test",
        p_subject: "Visit",
        p_body: "Synthetic",
        p_attachment_ids: [],
      },
    },
  ]);
});
test("enqueue rejects unsigned users, spoofed actor and disabled mode before any database writes", async () => {
  for (const [body, options] of [
    [request, { authenticated: false }],
    [{ ...request, p_actor_id: "spoof" }, {}],
    [request, { mode: "disabled" }],
  ] as const) {
    const result = await invoke("enqueue-message", body, options);
    assert.ok(result.status >= 400);
    assert.equal(result.calls.length, 0);
  }
});
test("reused request identifier conflict is explicit and does not claim success", async () => {
  const result = await invoke("enqueue-message", request, { rpcCode: "23505" });
  assert.equal(result.status, 409);
  assert.equal(result.body.success, undefined);
});
test("dispatcher requires exact service credential and denies staff credential", async () => {
  const denied = await invoke("dispatch-outbox", {});
  assert.equal(denied.status, 401);
  assert.equal(denied.calls.length, 0);
  const allowed = await invoke(
    "dispatch-outbox",
    {},
    { authorization: "Bearer service-secret" },
  );
  assert.equal(allowed.status, 200);
  assert.deepEqual(allowed.calls, ["dispatch"]);
});

test("unprepared legacy enqueue propagates database rejection without claiming queue success", async () => {
  const result = await invoke("enqueue-message", request, { prepared: false });
  assert.equal(result.status, 400);
  assert.equal(result.body.queue_rejected, true);
  assert.equal(result.body.queued, undefined);
  assert.equal(result.calls.length, 1);
});
