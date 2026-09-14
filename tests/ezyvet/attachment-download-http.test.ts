import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { gzipSync } from "node:zlib";
import { readAttachmentForCapture } from "../../supabase/functions/ezyvet-import/attachment-capture-read.ts";
import { createAdapter, ImportError } from "../../supabase/functions/ezyvet-import/adapter.ts";

// Actual loopback sockets with synthetic credentials; the public API origin is never contacted.
test("attachment download over native HTTP preserves originals and refuses redirects/compression", async () => {
  const pdf = new TextEncoder().encode("%PDF-1.7\nSynthetic HTTP evidence\n%%EOF");
  const metadata = { id: 701, record_type: "Animal", record_id: 77, file_id: "source-file", mime_type: "application/pdf" };
  let metadataReads = 0;
  const paths: string[] = [];
  const errors: Error[] = [];
  const server = createServer(async (request, response) => {
    try {
      paths.push(request.url!);
      if (request.url === "/v1/oauth/access_token") {
        assert.equal(request.method, "POST");
        let body = ""; for await (const chunk of request) body += String(chunk);
        assert.equal(JSON.parse(body).scope, "read-attachment");
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({ access_token: "synthetic-local-token", expires_in: 3600 }));
        return;
      }
      assert.equal(request.method, "GET");
      assert.equal(request.headers.authorization, "Bearer synthetic-local-token");
      const sourceUrl = new URL(request.url!, "http://local.example.test");
      if (sourceUrl.pathname === "/v1/attachment") {
        assert.deepEqual(Object.fromEntries(sourceUrl.searchParams), { page: "1", limit: "10", id: "701", record_type: "Animal", record_id: "77" });
        metadataReads++;
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({ items: [{ attachment: metadataReads === 4 ? { ...metadata, file_id: "changed-after-download" } : metadata }], meta: { items_page: 1, items_page_total: 1 } }));
        return;
      }
      assert.equal(request.headers["accept-encoding"], "identity");
      switch (request.url) {
        case "/v1/attachment/download/701":
          response.setHeader("Content-Type", "application/octet-stream");
          response.setHeader("Content-Length", pdf.length);
          response.end(pdf);
          break;
        case "/v1/attachment/download/702":
          response.setHeader("Content-Type", "application/pdf");
          response.write(pdf.slice(0, 3)); response.end(pdf.slice(3));
          break;
        case "/v1/attachment/download/703":
          response.writeHead(302, { Location: "/must-not-be-followed" }); response.end();
          break;
        case "/v1/attachment/download/704":
          response.setHeader("Content-Encoding", "gzip"); response.end(gzipSync(pdf));
          break;
        default: throw new Error("Unexpected local source request");
      }
    } catch (error) {
      errors.push(error as Error); response.destroy();
    }
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const localOrigin = `http://127.0.0.1:${address.port}`;
  const adapter = createAdapter({ baseUrl: "https://api.trial.ezyvet.com", siteUid: "synthetic", clientId: "synthetic", clientSecret: "synthetic", readResources: ["attachment"] }, {
    now: () => Date.now(), sleep: async () => {}, fetch: async (input, init) => {
      const url = new URL(String(input)); assert.equal(url.origin, "https://api.trial.ezyvet.com");
      assert.equal(init?.redirect, "error");
      const response = await fetch(localOrigin + url.pathname + url.search, init);
      // Preserve the native response stream/headers, while modeling the configured origin.
      return new Response(response.body, { status: response.status, headers: response.headers });
    },
  });
  try {
    const parent = { parent_type: "Animal" as const, parent_external_id: "77" };
    const knownLength = await adapter.downloadAttachment("701", parent, "application/pdf");
    const chunked = await adapter.downloadAttachment("702", parent, null);
    assert.deepEqual(knownLength.bytes, pdf);
    assert.deepEqual(chunked.bytes, pdf);
    assert.equal(knownLength.sha256, chunked.sha256);
    await assert.rejects(adapter.downloadAttachment("703", parent, null), e => e instanceof ImportError && e.code === "UPSTREAM_UNAVAILABLE");
    await assert.rejects(adapter.downloadAttachment("704", parent, null), e => e instanceof ImportError && e.code === "ATTACHMENT_INVALID_CONTENT");
    const capture = await readAttachmentForCapture(adapter, "701", parent, metadata);
    assert.deepEqual(capture.file.bytes, pdf);
    assert.deepEqual(capture.before, metadata);
    assert.deepEqual(capture.after, metadata);
    await assert.rejects(readAttachmentForCapture(adapter, "701", parent, metadata), e => e instanceof ImportError && e.code === "SOURCE_ATTACHMENT_METADATA_CHANGED");
    const observationPath = "/v1/attachment?page=1&limit=10&id=701&record_type=Animal&record_id=77";
    assert.deepEqual(paths, ["/v1/oauth/access_token", ...[701, 702, 703, 704].map(id => `/v1/attachment/download/${id}`),
      observationPath, "/v1/attachment/download/701", observationPath, observationPath, "/v1/attachment/download/701", observationPath]);
    assert.equal(metadataReads, 4);
    assert.deepEqual(errors, []);
  } finally {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
