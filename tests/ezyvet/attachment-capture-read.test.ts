import test from "node:test";
import assert from "node:assert/strict";
import { createAdapter, ImportError, type StagedEntity } from "../../supabase/functions/ezyvet-import/adapter.ts";
import { readAttachmentForCapture } from "../../supabase/functions/ezyvet-import/attachment-capture-read.ts";

const parent = { parent_type: "Animal" as const, parent_external_id: "77" };
const metadata = { id: 701, record_type: "Animal", record_id: 77, file_id: "different-file-id", name: "Original", notes: "Source notes", mime_type: "application/pdf", file_download_url: "https://untrusted.example.test/file" };
const pdf = new TextEncoder().encode("%PDF-1.7\nSynthetic read consistency\n%%EOF");
function setup(pages: Array<Record<string, unknown>>, bodies?: Array<unknown>) {
  const urls: string[] = [];
  const adapter = createAdapter({ baseUrl: "https://api.trial.ezyvet.com", siteUid: "synthetic", clientId: "synthetic", clientSecret: "synthetic", readResources: ["attachment"] }, {
    now: () => Date.now(), sleep: async () => {}, fetch: async (input, init) => {
      const url = new URL(String(input)); urls.push(url.href);
      assert.equal(url.origin, "https://api.trial.ezyvet.com");
      assert.equal(init?.redirect, "error");
      if (url.pathname === "/v1/oauth/access_token") return Response.json({ access_token: "synthetic", expires_in: 3600 });
      if (url.pathname === "/v1/attachment/download/701") return new Response(pdf);
      assert.equal(url.pathname, "/v1/attachment");
      assert.deepEqual(Object.fromEntries(url.searchParams), { page: "1", limit: "10", id: "701", record_type: "Animal", record_id: "77" });
      const payload = pages.shift();
      return Response.json(bodies?.shift() ?? { items: payload ? [{ attachment: payload }] : [], meta: { items_page: 1, items_page_total: 1 } });
    },
  });
  return { adapter, urls };
}
const changed = (e: unknown) => e instanceof ImportError && e.code === "SOURCE_ATTACHMENT_METADATA_CHANGED";

test("capture read checks exact parent/ID metadata before and after original bytes", async () => {
  const reordered = Object.fromEntries(Object.entries(metadata).reverse());
  const { adapter, urls } = setup([reordered, { ...metadata }]);
  const result = await readAttachmentForCapture(adapter, "701", parent, metadata);
  assert.deepEqual(result.file.bytes, pdf);
  assert.deepEqual(result.before, metadata);
  assert.deepEqual(result.after, metadata);
  assert.deepEqual(urls.map(u => new URL(u).pathname), ["/v1/oauth/access_token", "/v1/attachment", "/v1/attachment/download/701", "/v1/attachment"]);
  assert.ok(urls.every(u => !u.includes("untrusted")));
});

for (const field of ["file_id", "name", "notes", "mime_type", "file_download_url"] as const) {
  test(`changed ${field} before transfer rejects without downloading bytes`, async () => {
    const { adapter, urls } = setup([{ ...metadata, [field]: "changed" }]);
    await assert.rejects(readAttachmentForCapture(adapter, "701", parent, metadata), changed);
    assert.equal(urls.filter(u => u.includes("/download/")).length, 0);
  });
}

test("metadata change after transfer withholds the original from capture", async () => {
  const { adapter, urls } = setup([metadata, { ...metadata, file_id: "new-file" }]);
  await assert.rejects(readAttachmentForCapture(adapter, "701", parent, metadata), changed);
  assert.equal(urls.filter(u => u.includes("/download/")).length, 1);
  assert.equal(urls.length, 4);
});

for (const [name, body] of [
  ["missing", { items: [], meta: { items_page: 1, items_page_total: 1 } }],
  ["wrong ID", { items: [{ attachment: { ...metadata, id: 702 } }], meta: { items_page: 1, items_page_total: 1 } }],
  ["wrong patient", { items: [{ attachment: { ...metadata, record_id: 88 } }], meta: { items_page: 1, items_page_total: 1 } }],
  ["incomplete", { items: [{ attachment: metadata }], meta: { items_page: 1, items_page_total: 2 } }],
] as const) {
  test(`${name} ID-filter result cannot authorize the file download`, async () => {
    const { adapter, urls } = setup([], [body]);
    await assert.rejects(readAttachmentForCapture(adapter, "701", parent, metadata), changed);
    assert.equal(urls.filter(u => u.includes("/download/")).length, 0);
  });
}

test("mismatched saved context and unsupported MIME reject before any read", async () => {
  for (const expected of [{ ...metadata, record_id: 88 }, { ...metadata, id: 702 }, { ...metadata, mime_type: "text/html" }]) {
    const { adapter, urls } = setup([]);
    await assert.rejects(readAttachmentForCapture(adapter, "701", parent, expected), e => e instanceof ImportError);
    assert.equal(urls.length, 0);
  }
});

test("failed file transfer does not produce a post-read or capture result", async () => {
  const calls: string[] = [];
  await assert.rejects(readAttachmentForCapture({
    attachmentMetadata: async () => { calls.push("metadata"); return { external_id: "701", payload: metadata }; },
    downloadAttachment: async () => { calls.push("download"); throw new ImportError("UPSTREAM_UNAVAILABLE"); },
  }, "701", parent, metadata), e => e instanceof ImportError && e.code === "UPSTREAM_UNAVAILABLE");
  assert.deepEqual(calls, ["metadata", "download"]);
});

test("fresh observation identity must still match when using another reader implementation", async () => {
  const observations: StagedEntity[] = [{ external_id: "702", payload: metadata }];
  await assert.rejects(readAttachmentForCapture({
    attachmentMetadata: async () => observations.shift()!,
    downloadAttachment: async () => { throw new Error("Must never download"); },
  }, "701", parent, metadata), changed);
});
