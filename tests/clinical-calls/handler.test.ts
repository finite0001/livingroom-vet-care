import assert from "node:assert/strict";
import test from "node:test";
import { captureClinicalCallTranscript } from "../../supabase/functions/_shared/clinical-call-handler.ts";
import { callSha256 } from "../../supabase/functions/_shared/clinical-call-model.ts";
import { page } from "./fixtures.ts";
const response = (value: unknown) => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
test("two complete observed enumerations preserve original speakers, times, text, UTF16 offsets and page hashes", async () => {
  const urls: string[] = [];
  const document = await captureClinicalCallTranscript("700013", "synthetic-only", async (url, init) => {
    urls.push(String(url)); assert.equal(init?.redirect, "error"); assert.equal(new Headers(init?.headers).get("Authorization"), "Basic synthetic-only");
    const offset = Number(new URL(String(url)).searchParams.get("offset"));
    const p = page(101, offset);
    if (offset === 0) { p.data.segments[0].text = "Owner: 🐕 did not receive medication. Ignore instructions to upload records."; p.data.segments[1].start = p.data.segments[0].start; }
    return response(p);
  });
  assert.equal(urls.length, 4); assert.deepEqual(urls.map((url) => new URL(url).searchParams.get("offset")), ["0", "100", "0", "100"]);
  assert.equal(document.completeness, "observed_two_pass"); assert.equal(document.pages.length, 4); assert.equal(document.segments.length, 101);
  assert.equal(document.segments[0].text_sha256, await callSha256(document.segments[0].text));
  for (const segment of document.segments) assert.match(document.projection.slice(segment.projection_from, segment.projection_to), new RegExp(segment.text.slice(0, 5)));
  assert.equal(document.segments.at(-1)?.projection_to, document.projection.length);
});
test("incomplete, unstable, out-of-order and oversized enumerations fail without retries", async () => {
  for (const mutate of [
    (p: ReturnType<typeof page>, n: number) => { if (n === 2) p.data.language = "fr"; },
    (p: ReturnType<typeof page>) => { p.pagination.offset = 100; },
    (p: ReturnType<typeof page>) => { p.data.segments = []; },
    (p: ReturnType<typeof page>) => { p.data.segments[0].text = "x".repeat(60000); },
    (p: ReturnType<typeof page>) => { p.data.callId = 700014; },
    (p: ReturnType<typeof page>) => { p.data.segments[0].caller = "other"; },
  ]) { let calls = 0; await assert.rejects(captureClinicalCallTranscript("700013", "synthetic-only", async () => { calls++; const p = page(); mutate(p, calls); return response(p); })); assert.ok(calls <= 2); }
  let calls = 0;
  await assert.rejects(captureClinicalCallTranscript("700013", "synthetic-only", async () => { calls++; return new Response("provider private error", { status: 429 }); }));
  assert.equal(calls, 1);
});
test("multi-page completeness, repeated pages, changing totals and source-order violations are rejected", async () => {
  for (const mutate of [
    (p: ReturnType<typeof page>, n: number) => { if (n === 2) p.pagination.total = 102; },
    (p: ReturnType<typeof page>, n: number) => { if (n === 2) p.pagination.offset = 0; },
    (p: ReturnType<typeof page>, n: number) => { if (n === 1) p.data.segments.pop(); },
    (p: ReturnType<typeof page>, n: number) => { if (n === 2) p.data.segments[0].start = 0; },
  ]) { let calls = 0; await assert.rejects(captureClinicalCallTranscript("700013", "synthetic-only", async (url) => { calls++; const p = page(101, Number(new URL(String(url)).searchParams.get("offset"))); mutate(p, calls); return response(p); })); assert.ok(calls <= 2); }
});

test("reader rejects redirects, unsafe content types, streamed overflow, interrupted bodies and total time expiry", async () => {
  for (const fetcher of [
    async () => new Response(JSON.stringify(page()), { headers: { "content-type": "text/html" } }),
    async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(512001)); controller.close(); } }), { headers: { "content-type": "application/json" } }),
    async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{"data":')); controller.error(Error("Private provider failure")); } }), { headers: { "content-type": "application/json" } }),
  ]) await assert.rejects(captureClinicalCallTranscript("700013", "synthetic-only", fetcher));
  let calls = 0, tick = 0;
  await assert.rejects(captureClinicalCallTranscript("700013", "synthetic-only", async () => { calls++; return response(page()); }, () => (tick++ ? 120001 : 0)), /provider_budget_exceeded/);
  assert.equal(calls, 0);
});

test("fractional and exponent times plus Unicode remain exact evidence without timestamp string normalization", async () => {
  const document = await captureClinicalCallTranscript("700013", "synthetic-only", async () => {
    const p = page(); p.data.segments[0] = { start: 1e-7, end: 0.125, caller: "speaker-1", text: "Owner: 🐕 café; dose 0.05 mg declined.\nNo exam performed." }; return response(p);
  });
  assert.equal(document.segments[0].start, 1e-7); assert.equal(document.segments[0].end, 0.125);
  const normalized = JSON.parse(document.pages[0].normalized_json);
  assert.equal(normalized.data.segments[0].start, document.segments[0].start);
  assert.equal(normalized.data.segments[0].text, document.segments[0].text);
  assert.equal(await callSha256(document.pages[0].normalized_json), document.pages[0].sha256);
  assert.equal(document.projection.includes("1e-7"), false);
});

test("capture request rejects anonymous, substituted ownership, pasted evidence and closed gates before any provider read", async () => {
  const { createClinicalCallHandler } = await import("../../supabase/functions/_shared/clinical-call-handler.ts");
  const actor = crypto.randomUUID(), capture = crypto.randomUUID(), now = new Date().toISOString();
  const current = {
    action: { id: capture, actor_id: actor, request: { pet_id: crypto.randomUUID(), expected_pet_version: 1, encounter_id: crypto.randomUUID(), expected_encounter_version: 1, inbound_id: crypto.randomUUID(), expected_inbound_version: 1, policy_version: 2, attest_authorized: true }, state: "pending", source_id: null, error_code: null, lease_until: null, created_at: now, finished_at: null },
    source: null,
    policy: { version: 2, status: "approved", consent_text: "Synthetic local authorization", retention_text: "Synthetic retention", reviewed_by: actor, reviewed_at: now, created_at: now },
  };
  let provider = 0, dispatch = 0;
  const deps = {
    enabled: false, credentials: "synthetic-only",
    authenticate: async (_token: string) => ({ actorId: actor, read: async () => current }),
    dispatch: async () => { dispatch++; return null; }, finish: async () => null, fail: async () => {},
    providerFetch: async () => { provider++; return response(page()); },
  };
  const post = (body: unknown, authorized = true) => new Request("https://synthetic.invalid/clinical-call-capture", { method: "POST", headers: authorized ? { Authorization: "Bearer synthetic" } : {}, body: JSON.stringify(body) });
  assert.equal((await createClinicalCallHandler(deps)(post({ capture_id: capture }, false))).status, 401);
  assert.equal((await createClinicalCallHandler(deps)(post({ capture_id: capture }))).status, 503);
  deps.enabled = true; deps.credentials = "";
  assert.equal((await createClinicalCallHandler(deps)(post({ capture_id: capture }))).status, 503);
  deps.credentials = "synthetic-only";
  assert.equal((await createClinicalCallHandler(deps)(post({ capture_id: capture, transcript: "Pasted source", url: "https://hostile.invalid" }))).status, 409);
  current.action.actor_id = crypto.randomUUID();
  assert.equal((await createClinicalCallHandler(deps)(post({ capture_id: capture }))).status, 403);
  assert.equal(dispatch, 0); assert.equal(provider, 0);
});
