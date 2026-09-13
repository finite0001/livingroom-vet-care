import assert from "node:assert/strict";
import { test } from "node:test";
import { AttachmentMetadataError, attachmentMetadataContract, parseAttachmentMetadataPage } from "../../supabase/functions/ezyvet-import/attachment-metadata.ts";

const record = () => ({ id: "41", file_id: "80", record_type: "Animal", record_id: "12", active: "1", created_at: "1690000000", modified_at: "1690000001", mime_type: "application/pdf", name: "Résumé 🐈.pdf", primary_image: "0", notes: "Outside original; no interpretation", file_download_url: "https://synthetic.invalid/file?token=DO_NOT_EXPOSE" });
const page = (records: unknown[] = [record()]) => ({ meta: { items_page: "1", items_page_total: "1", items_page_size: "10", items_total: String(records.length) }, items: records.map(attachment => ({ attachment })), messages: [] });
const parse = (body: unknown) => parseAttachmentMetadataPage(body, { animalId: "12", page: 1 });
async function rejects(body: unknown) {
  await assert.rejects(parse(body), error => {
    assert.ok(error instanceof AttachmentMetadataError);
    assert.match(error.message, /^[A-Z_]+$/);
    assert.ok(!JSON.stringify(error).includes("DO_NOT_EXPOSE"));
    return true;
  });
}
test("attachment metadata contract is bounded and preserves documented source scalars", async () => {
  const result = await parse(page());
  assert.equal(attachmentMetadataContract.pageLimit, 10);
  assert.equal(result.contract_version, "ezyvet_animal_attachment_metadata_v1");
  assert.equal(result.complete, true);
  assert.deepEqual(result.parent, { record_type: "Animal", record_id: "12" });
  const { file_download_url: _url, ...expected } = record();
  assert.deepEqual(result.observations[0].metadata, expected);
  assert.equal(result.observations[0].file_sha256, null);
  for (const hash of [result.page_sha256, result.observations[0].raw_record_sha256, result.observations[0].stable_metadata_sha256]) assert.match(hash, /^[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(result).includes("DO_NOT_EXPOSE"));
  assert.ok(!JSON.stringify(result).includes("file_download_url"));
});
test("URL-only rotation changes raw evidence but not stable metadata", async () => {
  const a = await parse(page());
  const b = await parse(page([{ ...record(), file_download_url: "https://synthetic.invalid/new?token=ROTATED" }]));
  assert.equal(a.observations[0].stable_metadata_sha256, b.observations[0].stable_metadata_sha256);
  assert.notEqual(a.observations[0].raw_record_sha256, b.observations[0].raw_record_sha256);
  assert.notEqual(a.page_sha256, b.page_sha256);
});
test("source changes and reversions produce stable reproducible fingerprints", async () => {
  const a = await parse(page());
  for (const changed of [{ modified_at: "1690000002" }, { file_id: "81" }, { notes: "Corrected source note" }, { active: "0" }]) {
    const b = await parse(page([{ ...record(), ...changed }]));
    assert.notEqual(a.observations[0].stable_metadata_sha256, b.observations[0].stable_metadata_sha256);
  }
  assert.deepEqual(a, await parse(page()));
});
test("key order does not change hashes; numeric identities canonicalize only projection", async () => {
  const a = await parse(page());
  const reordered = Object.fromEntries(Object.entries(record()).reverse());
  assert.deepEqual(a, await parse(page([reordered])));
  const numeric = await parse(page([{ ...record(), id: 41, file_id: 80, record_id: 12 }]));
  assert.equal(a.observations[0].stable_metadata_sha256, numeric.observations[0].stable_metadata_sha256);
  assert.notEqual(a.observations[0].raw_record_sha256, numeric.observations[0].raw_record_sha256);
});
test("unknown nested data and credential keys stay out of projections", async () => {
  const a = await parse(page());
  const b = await parse(page([{ ...record(), unknown: { access_token: "DO_NOT_EXPOSE", child: [{ url: "https://synthetic.invalid/secret" }] }, authorization: "DO_NOT_EXPOSE" }]));
  assert.equal(a.observations[0].stable_metadata_sha256, b.observations[0].stable_metadata_sha256);
  assert.notEqual(a.observations[0].raw_record_sha256, b.observations[0].raw_record_sha256);
  assert.ok(!JSON.stringify(b).includes("DO_NOT_EXPOSE"));
  assert.ok(!JSON.stringify(b).includes("unknown"));
});
test("missing and explicit null source fields remain distinguishable", async () => {
  const minimal = { id: "41", file_id: "80", record_type: "Animal", record_id: "12" };
  const a = await parse(page([minimal]));
  const b = await parse(page([{ ...minimal, notes: null, active: null, modified_at: null }]));
  assert.equal(Object.hasOwn(a.observations[0].metadata, "notes"), false);
  assert.equal(b.observations[0].metadata.notes, null);
  assert.notEqual(a.observations[0].stable_metadata_sha256, b.observations[0].stable_metadata_sha256);
});
test("unsupported, missing and mismatched parents reject the entire page", async () => {
  for (const change of [{ record_type: "Consult" }, { record_type: "Contact" }, { record_type: "animal" }, { record_type: null }, { record_id: "13" }, { record_id: null }]) await rejects(page([record(), { ...record(), ...change }]));
  const missing = { ...record() } as Record<string, unknown>;
  delete missing.record_id;
  await rejects(page([missing]));
});
test("required identities reject unsafe, noncanonical and oversized values", async () => {
  for (const key of ["id", "file_id", "record_id"]) for (const value of [null, "", "01", "1e1", "-1", -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "9".repeat(80), "DO_NOT_EXPOSE", true]) await rejects(page([{ ...record(), [key]: value }]));
});
test("invalid page envelopes and provider messages fail without exposing payloads", async () => {
  for (const value of [null, [], {}, { ...page(), items: {} }, { ...page(), meta: null }, { ...page(), items: [{ attachment: [] }] }, { ...page(), messages: [{ token: "DO_NOT_EXPOSE" }] }]) await rejects(value);
});
test("page evidence must agree with expected page, limit, count and total pages", async () => {
  for (const changed of [{ items_page: "2" }, { items_page_total: "2" }, { items_page_size: "11" }, { items_total: "0" }, { items_total: "11" }, { items_page_total: "01" }]) await rejects({ ...page(), meta: { ...page().meta, ...changed } });
  await rejects(page(Array.from({ length: 11 }, record)));
});
test("empty first-page conventions and complete last page are explicit", async () => {
  for (const total of ["0", "1"]) assert.equal((await parse({ ...page([]), meta: { ...page([]).meta, items_page_total: total } })).complete, true);
  const first = { ...page(Array.from({ length: 10 }, record)), meta: { items_page: 1, items_page_total: 2, items_page_size: 10, items_total: 11 } };
  assert.equal((await parse(first)).complete, false);
  const last = { ...page(), meta: { items_page: 2, items_page_total: 2, items_page_size: 10, items_total: 11 } };
  assert.equal((await parseAttachmentMetadataPage(last, { animalId: 12, page: 2 })).complete, true);
});
test("duplicate observations retain membership and order, not silent deduplication", async () => {
  const result = await parse(page([record(), { ...record(), notes: "later observation" }, record()]));
  assert.equal(result.observations.length, 3);
  assert.deepEqual(result.observations[0], result.observations[2]);
  assert.notEqual(result.observations[0].stable_metadata_sha256, result.observations[1].stable_metadata_sha256);
});
test("metadata and discarded content obey byte, depth and structural bounds", async () => {
  await rejects(page([{ ...record(), notes: "🐈".repeat(5000) }]));
  await rejects(page([{ ...record(), name: "x".repeat(1025) }]));
  await rejects(page([{ ...record(), nested: { a: "x".repeat(20000), b: "x".repeat(20000) } }]));
  let deep: unknown = "DO_NOT_EXPOSE";
  for (let i = 0; i < 20; i++) deep = { deep };
  await rejects(page([{ ...record(), deep }]));
  await rejects(page(Array.from({ length: 10 }, () => ({ ...record(), extra: "x".repeat(28000) }))));
});
test("non-JSON scalars, nested clinical fields, and invalid Unicode are rejected", async () => {
  for (const changed of [{ notes: { token: "DO_NOT_EXPOSE" } }, { notes: 4 }, { name: true }, { modified_at: false }, { active: [] }, { file_download_url: {} }, { notes: "\ud800" }, { extra: Infinity }, { extra: undefined }, { extra: new Date() }]) await rejects(page([{ ...record(), ...changed }]));
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  await rejects(page([{ ...record(), cyclic }]));
});
test("invalid caller context and accessor payloads are rejected without evaluation", async () => {
  for (const expected of [{ animalId: "12", page: 0 }, { animalId: "12", page: 1, limit: 11 }, { animalId: "13", page: 1 }]) await assert.rejects(parseAttachmentMetadataPage(page(), expected), AttachmentMetadataError);
  const raw = record();
  Object.defineProperty(raw, "notes", { enumerable: true, get() { throw new Error("DO_NOT_EXPOSE"); } });
  await rejects(page([raw]));
});
test("hidden keys and sparse arrays cannot bypass canonical evidence", async () => {
  const raw = record();
  Object.defineProperty(raw, "notes", { enumerable: false, get() { throw new Error("DO_NOT_EXPOSE"); } });
  await rejects(page([raw]));
  await rejects(page([{ ...record(), unknown: new Array(2) }]));
});
test("smaller advertised effective size supports intermediate and final partial pages", async () => {
  const first = { ...page([record(), record()]), meta: { items_page: 1, items_page_total: 2, items_page_size: 2, items_total: 3 } };
  assert.equal((await parse(first)).complete, false);
  const last = { ...page(), meta: { items_page: 2, items_page_total: 2, items_page_size: 2, items_total: 3 } };
  assert.equal((await parseAttachmentMetadataPage(last, { animalId: 12, page: 2 })).complete, true);
  await rejects({ ...first, meta: { ...first.meta, items_page_size: 3 } });
  await rejects({ ...first, meta: { ...first.meta, items_page_size: 0 } });
});
