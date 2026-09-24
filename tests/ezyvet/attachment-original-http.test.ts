import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { gzipSync } from "node:zlib";
import { createAdapter } from "../../supabase/functions/ezyvet-import/adapter.ts";
const pdf = new TextEncoder().encode("%PDF-1.7\nNative synthetic evidence\n%%EOF");
test("original transport uses authenticated native HTTP, canonical ID metadata, exact bytes and fail-closed redirects/compression", async () => {
  const paths: string[] = [], failures: unknown[] = [];
  let revision = 0;
  const server = createServer(async (request, response) => {
    try {
      paths.push(request.url!);
      const url = new URL(request.url!, "http://synthetic.test");
      if (url.pathname === "/v1/oauth/access_token") {
        assert.equal(request.method, "POST"); let body = ""; for await (const chunk of request) body += chunk;
        assert.deepEqual(JSON.parse(body), { client_id: "synthetic", client_secret: "synthetic", site_uid: "synthetic", grant_type: "client_credentials", scope: "read-attachment" });
        response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ access_token: "synthetic-only", expires_in: 3600 })); return;
      }
      assert.equal(request.method, "GET"); assert.equal(request.headers.authorization, "Bearer synthetic-only");
      if (url.pathname === "/v1/attachment") {
        assert.deepEqual(Object.fromEntries(url.searchParams), { page: "1", limit: "10", id: "701", record_type: "Animal", record_id: "77" });
        response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ meta: { items_page: 1, items_page_size: 10, items_page_total: 1, items_total: 1 }, items: [{ attachment: { id: 701, file_id: 801, record_type: "Animal", record_id: 77, mime_type: "application/pdf", file_download_url: `https://never-follow.invalid/?token=${++revision}` } }] })); return;
      }
      assert.equal(request.headers["accept-encoding"], "identity");
      switch (url.pathname) {
        case "/v1/attachment/download/701": response.setHeader("Content-Type", "application/octet-stream"); response.setHeader("Content-Length", pdf.length); response.end(pdf); break;
        case "/v1/attachment/download/702": response.writeHead(302, { Location: "/must-not-follow" }); response.end(); break;
        case "/v1/attachment/download/703": response.setHeader("Content-Encoding", "gzip"); response.end(gzipSync(pdf)); break;
        case "/v1/attachment/download/704": response.writeHead(429, { "Retry-After": "1.5" }); response.end(); break;
        default: throw new Error("Unexpected synthetic source route");
      }
    } catch (error) { failures.push(error); response.destroy(); }
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening"); const address = server.address(); assert.ok(address && typeof address !== "string");
  const adapter = createAdapter({ baseUrl: "https://api.trial.ezyvet.com", siteUid: "synthetic", clientId: "synthetic", clientSecret: "synthetic", readResources: ["attachment"] }, { now: Date.now, sleep: async () => {}, fetch: async (input, init) => {
    const url = new URL(String(input)); assert.equal(url.origin, "https://api.trial.ezyvet.com"); assert.equal(init?.redirect, "error");
    const response = await fetch(`http://127.0.0.1:${address.port}${url.pathname}${url.search}`, init);
    // Keep native streams while modeling the configured public origin.
    return new Response(response.body, { status: response.status, headers: response.headers });
  } });
  try {
    const before = await adapter.attachmentMetadata("77", "701"); const file = await adapter.downloadAttachment("77", "701", "application/pdf"); const after = await adapter.attachmentMetadata("77", "701");
    assert.deepEqual(file.bytes, pdf); assert.equal(before.stable_metadata_sha256, after.stable_metadata_sha256); assert.notEqual(before.raw_record_sha256, after.raw_record_sha256); assert.equal(JSON.stringify(before).includes("never-follow"), false);
    await assert.rejects(adapter.downloadAttachment("77", "702", null), /UPSTREAM_UNAVAILABLE/);
    await assert.rejects(adapter.downloadAttachment("77", "703", null), /ATTACHMENT_INVALID_CONTENT/);
    await assert.rejects(adapter.downloadAttachment("77", "704", null), e => e instanceof Error && e.message === "RATE_LIMITED" && "retryAfter" in e && e.retryAfter === 2);
    assert.ok(!paths.includes("/must-not-follow")); assert.deepEqual(failures, []);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
