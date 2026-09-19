import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createContactHandler,
  emailBucket,
  sha256,
} from "../../supabase/functions/public-contact/handler.ts";
import type {
  IntakeBackend,
  ContactPayload,
} from "../../supabase/functions/public-contact/handler.ts";
const id = "11111111-1111-4111-8111-111111111111",
  cap = "a".repeat(64);
const fields = {
  name: "Visitor",
  email: "visitor@example.test",
  phone: null,
  subject: "Question",
  message: "A private request",
};
const config = {
  secret: "synthetic-secret",
  emailHashSecret: "a".repeat(32),
  allowedOrigins: ["https://thelivingroom.vet"],
  allowedHostnames: ["thelivingroom.vet"],
};
function fixture() {
  let writes = 0,
    fetches = 0,
    budget = true;
  const rows = new Map<string, { hash: string; payload: ContactPayload }>();
  let proof: Record<string, unknown> = {
    success: true,
    hostname: "thelivingroom.vet",
    action: "contact_intake",
    cdata: id,
    challenge_ts: new Date().toISOString(),
  };
  const backend: IntakeBackend = {
    async consumeBudget() {
      return budget;
    },
    async receipt(request, hash) {
      return { received: rows.get(request)?.hash === hash };
    },
    async accept(request, hash, _email, payload) {
      const old = rows.get(request);
      if (
        old &&
        (old.hash !== hash ||
          JSON.stringify(old.payload) !== JSON.stringify(payload))
      )
        throw new Error("Conflict");
      if (!old) {
        writes++;
        rows.set(request, { hash, payload });
      }
      return { received: true };
    },
  };
  const fetcher: typeof fetch = async (_url, options) => {
    fetches++;
    const value = JSON.parse(String(options?.body));
    assert.equal(value.remoteip, undefined);
    assert.match(
      value.idempotency_key,
      /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-8[a-f0-9]{3}-[a-f0-9]{12}$/,
    );
    assert.equal(options?.redirect, "error");
    return Response.json(proof);
  };
  return {
    handler: createContactHandler(config, backend, fetcher),
    setProof: (p: Record<string, unknown>) => {
      proof = { ...proof, ...p };
    },
    setBudget: () => {
      budget = false;
    },
    writes: () => writes,
    fetches: () => fetches,
    backend,
  };
}
const request = (value: Record<string, unknown> = {}) =>
  new Request("https://edge.example.test", {
    method: "POST",
    headers: {
      origin: "https://thelivingroom.vet",
      "Content-Type": "application/json",
      "X-Forwarded-For": "forged",
    },
    body: JSON.stringify({
      request_id: id,
      capability: cap,
      action: "submit",
      payload: fields,
      token: "synthetic",
      ...value,
    }),
  });
test("verified challenge inserts once; exact retry and receipt recover without identity claims", async () => {
  const f = fixture();
  assert.equal((await f.handler(request())).status, 200);
  assert.equal((await f.handler(request())).status, 200);
  assert.equal(f.writes(), 1);
  const receipt = await f.handler(request({ action: "receipt" }));
  assert.deepEqual(await receipt.json(), { received: true });
  assert.equal(f.fetches(), 2);
  assert.equal(
    (await f.handler(request({ payload: { ...fields, message: "Different" } })))
      .status,
    503,
  );
  assert.equal(f.writes(), 1);
});
test("invalid hostname/action/cdata/freshness or failed challenge never writes", async () => {
  for (const proof of [
    { success: false },
    { hostname: "evil.test" },
    { action: "different" },
    { cdata: crypto.randomUUID() },
    { challenge_ts: "2020-01-01T00:00:00Z" },
    { challenge_ts: "bad" },
  ]) {
    const f = fixture();
    f.setProof(proof);
    assert.equal((await f.handler(request())).status, 403);
    assert.equal(f.writes(), 0);
  }
});
test("global budget denies before verification, missing config fails closed", async () => {
  const f = fixture();
  f.setBudget();
  assert.equal((await f.handler(request())).status, 429);
  assert.equal(f.fetches(), 0);
  const h = createContactHandler({ ...config, secret: "" }, f.backend, () => {
    throw new Error("No provider call");
  });
  assert.equal((await h(request())).status, 503);
});
test("oversized and malformed fields rejected; forbidden origin not accepted", async () => {
  const f = fixture();
  assert.equal(
    (
      await f.handler(
        request({ payload: { ...fields, message: "x".repeat(2001) } }),
      )
    ).status,
    400,
  );
  assert.equal(
    (await f.handler(request({ token: "x".repeat(20000) }))).status,
    400,
  );
  assert.equal(
    (
      await f.handler(
        new Request("https://edge.test", {
          method: "POST",
          headers: { origin: "https://evil.test" },
        }),
      )
    ).status,
    403,
  );
  assert.equal(f.fetches(), 0);
});
test("capability receipt hides other request; hashes keep raw contact out of budgets", async () => {
  const f = fixture();
  await f.handler(request());
  const response = await f.handler(
    request({ action: "receipt", capability: "b".repeat(64) }),
  );
  assert.deepEqual(await response.json(), { received: false });
  assert.equal(
    await emailBucket("VISITOR@example.test", "x".repeat(32)),
    await emailBucket("visitor@example.test", "x".repeat(32)),
  );
  assert.match(await sha256(cap), /^[a-f0-9]{64}$/);
});
test("network ambiguity fails closed without blind provider retry", async () => {
  const f = fixture();
  let calls = 0;
  const h = createContactHandler(config, f.backend, async () => {
    calls++;
    throw new Error("ambiguous");
  });
  assert.equal((await h(request())).status, 503);
  assert.equal(calls, 1);
  assert.equal(f.writes(), 0);
});
