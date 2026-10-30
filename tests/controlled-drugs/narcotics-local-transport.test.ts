import assert from "node:assert/strict";
import { test } from "node:test";
import { narcoticsAuthenticatedInputSchema } from "./narcotics-authenticated-input.ts";
import { createNarcoticsLocalTransport, narcoticsProofConnection } from "./narcotics-local-transport.ts";
const jwt = (role: string) => [Buffer.from("{}").toString("base64url"), Buffer.from(JSON.stringify({ role })).toString("base64url"), "disposable"].join(".");
const input = { origin: "http://127.0.0.1:64661" as const, anonKey: jwt("anon"), actorId: "10000000-0000-4000-8000-000000000001", scope: { product_id: "10000000-0000-4000-8000-000000000002", site_id: "10000000-0000-4000-8000-000000000003" } };
test("local proof input excludes external origins, secret keys and preloaded sessions", () => {
  assert(narcoticsAuthenticatedInputSchema.safeParse(input).success);
  for (const change of [{ origin: "https://abcdefghijklmnopqrst.supabase.co" }, { origin: "http://localhost:64661" }, { anonKey: jwt("service_role") }, { accessToken: jwt("authenticated") }, { login: { password: "not accepted here" } }])
    assert.equal(narcoticsAuthenticatedInputSchema.safeParse({ ...input, ...change }).success, false);
});
test("local adapter preserves exact authenticated request and actual response", async () => {
  const body = '{"p_request":{"decimal":"9007199254740993","reason":"café 🐾"}}', abort = new AbortController();
  const result = new Response('{"actual":"database response"}', { status: 200 }); let calls = 0;
  const transport = createNarcoticsLocalTransport(input, async (url, options) => {
    calls++; assert.equal(url, input.origin + "/rest/v1/rpc/finalize_controlled_count_v1");
    assert.equal(options?.body, body); assert.equal(options?.signal, abort.signal); assert.equal(options?.redirect, "error");
    const headers = new Headers(options?.headers); assert.equal(headers.get("authorization"), "Bearer unchanged.signed.session"); assert.equal(headers.get("apikey"), input.anonKey);
    return result;
  });
  assert.equal(await transport(narcoticsProofConnection.url + "/rest/v1/rpc/finalize_controlled_count_v1", { method: "POST", body, signal: abort.signal, redirect: "error", headers: { authorization: "Bearer unchanged.signed.session", apikey: narcoticsProofConnection.publishableKey } }), result);
  assert.equal(calls, 1);
});
test("local adapter refuses unlisted paths and methods before sending", async () => {
  let calls = 0; const transport = createNarcoticsLocalTransport(input, async () => { calls++; return new Response(); });
  for (const [url, method] of [["https://elsewhere.invalid/rest/v1/rpc/finalize_controlled_count_v1", "POST"], [narcoticsProofConnection.url + "/rest/v1/rpc/delete_everything", "POST"], [narcoticsProofConnection.url + "/rest/v1/rpc/finalize_controlled_count_v1?changed=1", "POST"], [narcoticsProofConnection.url + "/rest/v1/rpc/finalize_controlled_count_v1", "GET"]])
    await assert.rejects(() => transport(url, { method }));
  assert.equal(calls, 0);
});
