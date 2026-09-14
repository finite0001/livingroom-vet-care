import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createAdapter, ImportError, type EzyVetConfig, type AttachmentParent } from "../../supabase/functions/ezyvet-import/adapter.ts";
import { maxAttachmentBytes, readAttachmentBytes } from "../../supabase/functions/ezyvet-import/attachment-bytes.ts";

const config: EzyVetConfig = { baseUrl: "https://api.trial.ezyvet.com", siteUid: "synthetic", clientId: "synthetic", clientSecret: "synthetic", readResources: ["attachment"] };
const parent: AttachmentParent = { parent_type: "Animal", parent_external_id: "77" };
const pdf = new TextEncoder().encode("%PDF-1.7\nSynthetic bytes only\n%%EOF");
const signal = () => new AbortController().signal;
const code = (expected: string) => (error: unknown) => error instanceof ImportError && error.code === expected;
function harness(responses: Array<Response | Error>, settings: EzyVetConfig = config) {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const adapter = createAdapter(settings, {
    now: () => Date.now(), sleep: async () => {},
    fetch: async (input, init) => {
      const url = String(input); requests.push({ url, init });
      if (url.endsWith("/v1/oauth/access_token")) {
        assert.equal(JSON.parse(String(init?.body)).scope, "read-attachment");
        return Response.json({ access_token: "synthetic-token", expires_in: 3600 });
      }
      const next = responses.shift();
      assert.ok(next, "Unexpected download request");
      if (next instanceof Error) throw next;
      return next;
    },
  });
  return { adapter, requests };
}

test("attachment download uses only the approved ID route and preserves exact original bytes", async () => {
  const { adapter, requests } = harness([new Response(pdf, { headers: { "content-type": "application/octet-stream", "content-length": String(pdf.length) } })]);
  const result = await adapter.downloadAttachment("701", parent, "application/pdf");
  assert.deepEqual(result.bytes, pdf);
  assert.equal(result.sha256, createHash("sha256").update(pdf).digest("hex"));
  assert.equal(result.size, pdf.length);
  assert.equal(result.mimeType, "application/pdf");
  assert.equal(requests.length, 2);
  assert.equal(requests[1].url, "https://api.trial.ezyvet.com/v1/attachment/download/701");
  assert.equal(requests[1].init?.method, "GET");
  assert.equal(requests[1].init?.redirect, "error");
  assert.deepEqual(requests[1].init?.headers, { Authorization: "Bearer synthetic-token", Accept: "application/octet-stream", "Accept-Encoding": "identity" });
  assert.ok(requests[1].init?.signal?.aborted, "Download controller closes when the complete operation ends");
});

test("invalid origin, scope, IDs, parent and MIME cause zero authentication or source requests", async () => {
  for (const [settings, id, selectedParent, mime] of [
    [{ ...config, baseUrl: "https://untrusted.example.test" }, "701", parent, null],
    [{ ...config, baseUrl: "https://api.trial.ezyvet.com@untrusted.example.test" }, "701", parent, null],
    [{ ...config, readResources: [] }, "701", parent, null],
    [config, "../701", parent, null], [config, "01", parent, null], [config, "9007199254740992", parent, null],
    [config, "701", { parent_type: "Contact", parent_external_id: "77" }, null],
    [config, "701", { parent_type: "Consult", parent_external_id: "-1" }, null],
    [config, "701", null, null], [config, "701", parent, "text/html"],
  ] as Array<[EzyVetConfig, string, AttachmentParent, string | null]>) {
    const { adapter, requests } = harness([], settings);
    await assert.rejects(adapter.downloadAttachment(id, selectedParent, mime), error => error instanceof ImportError);
    assert.equal(requests.length, 0);
  }
});

test("401 refreshes once, using the same authorized host and cached replacement token", async () => {
  const { adapter, requests } = harness([new Response(null, { status: 401 }), new Response(pdf), new Response(pdf)]);
  await adapter.downloadAttachment("701", { parent_type: "Consult", parent_external_id: "201" }, null);
  await adapter.downloadAttachment("702", parent, null);
  assert.equal(requests.filter(r => r.url.endsWith("access_token")).length, 2);
  assert.ok(requests.every(r => new URL(r.url).origin === config.baseUrl));
});

test("repeated authentication failure stops after one refresh", async () => {
  const { adapter, requests } = harness([new Response(null, { status: 401 }), new Response(null, { status: 401 })]);
  await assert.rejects(adapter.downloadAttachment("701", parent, null), code("UPSTREAM_AUTH_FAILED"));
  assert.equal(requests.length, 4);
});

test("rate limits carry bounded cooldown and do not retry a download in memory", async () => {
  for (const [header, seconds] of [["120", 120], ["99999", 3600], ["invalid", 60], ["-1", 1]] as const) {
    const { adapter, requests } = harness([new Response(null, { status: 429, headers: { "retry-after": header } })]);
    await assert.rejects(adapter.downloadAttachment("701", parent, null), e => code("RATE_LIMITED")(e) && (e as ImportError).retryAfter === seconds);
    assert.equal(requests.length, 2);
  }
});

for (const [status, expected] of [[403, "UPSTREAM_SCOPE_DENIED"], [500, "UPSTREAM_UNAVAILABLE"], [302, "ATTACHMENT_INVALID_CONTENT"], [206, "ATTACHMENT_INVALID_CONTENT"], [404, "ATTACHMENT_INVALID_CONTENT"]] as const) {
  test(`HTTP ${status} rejects without accepting a partial or alternate response`, async () => {
    const { adapter } = harness([new Response(pdf, { status })]);
    await assert.rejects(adapter.downloadAttachment("701", parent, null), code(expected));
  });
}

test("network errors are sanitized instead of exposing source URLs or credentials", async () => {
  const { adapter } = harness([new Error("secret https://untrusted.example.test/private")]);
  await assert.rejects(adapter.downloadAttachment("701", parent, null), e => e instanceof ImportError && e.message === "UPSTREAM_UNAVAILABLE");
});

for (const [name, bytes, mime] of [
  ["PDF", pdf, "application/pdf"],
  ["JPEG", Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 0xff, 0xd9]), "image/jpeg"],
  ["PNG", Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]), "image/png"],
] as const) {
  test(`${name} signature survives chunk boundaries with matching or generic MIME`, async () => {
    const body = new ReadableStream({ start(c) { c.enqueue(bytes.slice(0, 2)); c.enqueue(bytes.slice(2)); c.close(); } });
    const result = await readAttachmentBytes(new Response(body, { headers: { "content-type": "application/octet-stream" } }), mime, signal());
    assert.equal(result.mimeType, mime);
    assert.deepEqual(result.bytes, bytes);
  });
}

for (const [name, headers, expected] of [
  ["compressed", { "content-encoding": "gzip" }, "ATTACHMENT_INVALID_CONTENT"],
  ["partial range", { "content-range": "bytes 0-5/100" }, "ATTACHMENT_INVALID_CONTENT"],
  ["oversized declaration", { "content-length": String(maxAttachmentBytes + 1) }, "ATTACHMENT_TOO_LARGE"],
  ["invalid declaration", { "content-length": "2e2" }, "ATTACHMENT_INVALID_CONTENT"],
  ["short body", { "content-length": String(pdf.length + 1) }, "ATTACHMENT_INVALID_CONTENT"],
  ["long body", { "content-length": String(pdf.length - 1) }, "ATTACHMENT_INVALID_CONTENT"],
  ["wrong MIME", { "content-type": "image/png" }, "ATTACHMENT_INVALID_CONTENT"],
  ["HTML declaration", { "content-type": "text/html" }, "ATTACHMENT_UNSUPPORTED_TYPE"],
] as Array<[string, Record<string, string>, string]>) {
  test(`${name} rejects the original-file response`, async () => {
    await assert.rejects(readAttachmentBytes(new Response(pdf, { headers }), null, signal()), code(expected));
  });
}

test("streaming bounds reject undeclared oversized content and cancel the source", async () => {
  let canceled = false;
  const body = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(maxAttachmentBytes)); c.enqueue(new Uint8Array(1)); }, cancel() { canceled = true; } });
  await assert.rejects(readAttachmentBytes(new Response(body), null, signal()), code("ATTACHMENT_TOO_LARGE"));
  assert.equal(canceled, true);
});

test("body deadline cancels a stalled source, even if its cancellation promise never settles", async () => {
  let canceled = false;
  const controller = new AbortController();
  const body = new ReadableStream({ start(c) { c.enqueue(pdf.slice(0, 3)); }, cancel() { canceled = true; return new Promise(() => {}); } });
  const result = readAttachmentBytes(new Response(body), null, controller.signal);
  controller.abort();
  await assert.rejects(result, code("UPSTREAM_UNAVAILABLE"));
  assert.equal(canceled, true);
});

test("empty bodies, unrecognized signatures and metadata conflicts cannot become attachments", async () => {
  for (const [bytes, mime] of [[new Uint8Array(), null], [new TextEncoder().encode("<html>not a file</html>"), null], [pdf, "image/jpeg"]] as const) {
    await assert.rejects(readAttachmentBytes(new Response(bytes), mime, signal()), code("ATTACHMENT_INVALID_CONTENT"));
  }
});

test("exact maximum size preserves every byte and its digest", async () => {
  const bytes = new Uint8Array(maxAttachmentBytes); bytes.set(pdf);
  const result = await readAttachmentBytes(new Response(bytes, { headers: { "content-length": String(bytes.length), "content-type": "application/pdf; charset=binary" } }), "APPLICATION/PDF", signal());
  assert.equal(result.size, maxAttachmentBytes);
  assert.deepEqual(result.bytes, bytes);
  assert.equal(result.sha256, createHash("sha256").update(bytes).digest("hex"));
});

test("alternate response origin is rejected even if a transport ignores redirect:error", async () => {
  const response = new Response(pdf);
  Object.defineProperty(response, "url", { value: "https://untrusted.example.test/file" });
  const { adapter, requests } = harness([response]);
  await assert.rejects(adapter.downloadAttachment("701", parent, null), code("ATTACHMENT_INVALID_CONTENT"));
  assert.equal(requests.length, 2);
});

for (const stage of ["headers", "body"] as const) {
  test(`whole download deadline aborts stalled ${stage}`, async t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    let arrived!: () => void;
    const ready = new Promise<void>(resolve => { arrived = resolve; });
    let observedSignal: AbortSignal | undefined;
    const adapter = createAdapter(config, { now: () => Date.now(), sleep: async () => {}, fetch: async (input, init) => {
      if (String(input).endsWith("access_token")) return Response.json({ access_token: "synthetic", expires_in: 3600 });
      observedSignal = init?.signal as AbortSignal;
      arrived();
      if (stage === "headers") return await new Promise<Response>((_, reject) => observedSignal!.addEventListener("abort", () => reject(new Error("Aborted synthetic fetch"))));
      return new Response(new ReadableStream({ start(c) { c.enqueue(pdf.slice(0, 2)); } }));
    } });
    const operation = adapter.downloadAttachment("701", parent, null);
    await ready;
    t.mock.timers.tick(20_000);
    await assert.rejects(operation, code("UPSTREAM_UNAVAILABLE"));
    assert.equal(observedSignal?.aborted, true);
  });
}
