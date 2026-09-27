import { test } from "node:test";
import assert from "node:assert/strict";
import { createContactHandler } from "../../supabase/functions/public-contact/handler.ts";
import type {
  IntakeBackend,
  IntakeConfig,
  ContactPayload,
} from "../../supabase/functions/public-contact/handler.ts";
import { contactVerification } from "../../src/features/contact/contact-request.ts";
const id = "22222222-2222-4222-8222-222222222222",
  cap = "c".repeat(64);
const fields = {
  name: "Visitor",
  email: "visitor@example.test",
  phone: "720-555-0100",
  subject: "Question",
  message: "A request",
  sms_consent: true,
};
// No Turnstile secret or hostnames: the owner-approved no-challenge deployment.
const none: IntakeConfig = {
  verification: "none",
  secret: "",
  emailHashSecret: "e".repeat(32),
  allowedOrigins: ["https://thelivingroom.vet"],
  allowedHostnames: [],
};
function fixture(config: IntakeConfig = none) {
  const state = { budget: true, limited: false, budgetCalls: 0, fetches: 0 };
  const rows = new Map<string, { hash: string; payload: ContactPayload }>();
  const backend: IntakeBackend = {
    async consumeBudget() {
      state.budgetCalls++;
      return state.budget;
    },
    async receipt(request, hash) {
      return { received: rows.get(request)?.hash === hash };
    },
    async accept(request, hash, emailHash, payload) {
      assert.match(emailHash, /^[a-f0-9]{64}$/);
      if (state.limited) return { received: false, limited: true };
      const old = rows.get(request);
      if (old && (old.hash !== hash || JSON.stringify(old.payload) !== JSON.stringify(payload)))
        throw new Error("Conflict");
      rows.set(request, { hash, payload });
      return { received: true };
    },
  };
  const fetcher: typeof fetch = async () => {
    state.fetches++;
    throw new Error("No provider call in none mode");
  };
  return { handler: createContactHandler(config, backend, fetcher), state, rows };
}
const request = (value: Record<string, unknown> = {}, origin = "https://thelivingroom.vet") =>
  new Request("https://edge.example.test", {
    method: "POST",
    headers: { origin, "Content-Type": "application/json" },
    body: JSON.stringify({ request_id: id, capability: cap, action: "submit", payload: fields, ...value }),
  });
test("none mode accepts without a token, never calls the verifier, and keeps exact-retry receipts", async () => {
  const f = fixture();
  assert.equal((await f.handler(request())).status, 200);
  assert.equal((await f.handler(request())).status, 200);
  assert.equal(f.rows.size, 1);
  assert.deepEqual(f.rows.get(id)!.payload, fields);
  assert.deepEqual(await (await f.handler(request({ action: "receipt" }))).json(), { received: true });
  assert.equal((await f.handler(request({ payload: { ...fields, message: "Changed" } }))).status, 503);
  assert.equal(f.state.fetches, 0);
});
test("none mode ignores a well-formed token from an older page but rejects a malformed one", async () => {
  for (const token of ["stale-widget-token", ""]) {
    const f = fixture();
    assert.equal((await f.handler(request({ token }))).status, 200);
    assert.equal(f.state.fetches, 0);
  }
  for (const token of [123, null, { x: 1 }, "x".repeat(2049)]) {
    const f = fixture();
    assert.equal((await f.handler(request({ token }))).status, 400);
    assert.equal(f.rows.size, 0);
  }
});
test("none mode still enforces origin, method, content type, payload shape, consent phone and size", async () => {
  const f = fixture();
  assert.equal((await f.handler(request({}, "https://evil.test"))).status, 403);
  assert.equal((await f.handler(new Request("https://edge.test", { method: "GET", headers: { origin: "https://thelivingroom.vet" } }))).status, 405);
  assert.equal(
    (await f.handler(new Request("https://edge.test", { method: "POST", headers: { origin: "https://thelivingroom.vet", "Content-Type": "text/plain" }, body: "{}" }))).status,
    415,
  );
  for (const payload of [
    { ...fields, message: "x".repeat(2001) },
    { ...fields, sms_consent: "true" },
    { ...fields, phone: null },
    { ...fields, extra: "field" },
    { ...fields, email: "not-an-email" },
  ])
    assert.equal((await f.handler(request({ payload }))).status, 400);
  assert.equal((await f.handler(request({ request_id: "not-a-uuid" }))).status, 400);
  assert.equal((await f.handler(request({ padding: "x".repeat(17000) }))).status, 400);
  assert.equal(f.rows.size, 0);
  assert.equal(f.state.fetches, 0);
});
test("none mode keeps the global and claimed-email budgets", async () => {
  const f = fixture();
  f.state.budget = false;
  assert.equal((await f.handler(request())).status, 429);
  assert.equal((await f.handler(request({ action: "receipt" }))).status, 429);
  f.state.budget = true;
  f.state.limited = true;
  assert.equal((await f.handler(request())).status, 429);
  assert.equal(f.rows.size, 0);
});
test("none mode still needs the email hash secret and origins; unknown modes fail closed", async () => {
  for (const config of [
    { ...none, emailHashSecret: "short" },
    { ...none, allowedOrigins: [] },
    { ...none, verification: "off" },
    { ...none, verification: "NONE" },
    { ...none, verification: " none" },
    { ...none, verification: "" },
  ]) {
    const f = fixture(config);
    const response = await f.handler(request());
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "Intake is not configured" });
    assert.equal(f.state.budgetCalls, 0);
  }
});
test("unset mode is turnstile: token, secret and hostnames remain mandatory", async () => {
  const { verification: _unset, ...defaults } = none;
  assert.equal((await fixture(defaults).handler(request())).status, 503);
  assert.equal((await fixture({ ...defaults, secret: "s" }).handler(request())).status, 503);
  const f = fixture({ ...defaults, secret: "s", allowedHostnames: ["thelivingroom.vet"] });
  assert.equal((await f.handler(request())).status, 400);
  assert.equal((await f.handler(request({ token: "" }))).status, 400);
  assert.equal((await f.handler(request({ token: "t" }))).status, 503);
  assert.equal(f.state.fetches, 1);
  assert.equal(f.rows.size, 0);
  const explicit = fixture({ ...defaults, verification: "turnstile", secret: "s", allowedHostnames: ["thelivingroom.vet"] });
  assert.equal((await explicit.handler(request())).status, 400);
});
test("browser mode follows public configuration: site key => widget, URL only => none, neither => unavailable", () => {
  assert.equal(contactVerification("https://x.supabase.co/functions/v1/public-contact", "site-key"), "turnstile");
  assert.equal(contactVerification("https://x.supabase.co/functions/v1/public-contact", ""), "none");
  assert.equal(contactVerification("", ""), "unavailable");
  assert.equal(contactVerification("", "site-key"), "unavailable");
});
