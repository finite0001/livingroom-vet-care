import test from "node:test";
import assert from "node:assert/strict";
import { parseIncomingAttachments, verifyIncomingDownload } from "../../src/hub/features/communications/incoming-attachments.ts";
const id = "11111111-1111-4111-8111-111111111111";
const row = { inbound_id: id, inbound_version: 1, message_id: id, attachment_id: id, filename: "report.pdf", byte_length: 5, mime_type: "application/pdf", status: "pending", capture_id: null, sha256: null };
test("metadata remains pending until verified capture evidence exists", () => {
  assert.equal(parseIncomingAttachments([row], [id])[0].status, "pending");
  assert.throws(() => parseIncomingAttachments([{ ...row, status: "ready" }], [id]));
  assert.throws(() => parseIncomingAttachments([{ ...row, capture_id: id }], [id]));
});
test("rejects another message and repeated attachment identity", () => {
  assert.throws(() => parseIncomingAttachments([row], []));
  assert.throws(() => parseIncomingAttachments([row, row], [id]));
});
test("unsupported files remain visible without invented capture metadata", () => {
  const parsed = parseIncomingAttachments([{ ...row, status: "unsupported", attachment_id: null, filename: null, byte_length: null, mime_type: "application/zip" }], [id])[0];
  assert.equal(parsed.name, "Unnamed attachment"); assert.equal(parsed.captureId, null); assert.equal(parsed.size, null);
});
test("ready download requires exact bytes and current staff identity", async () => {
  const blob = new Blob(["%PDF-"], { type: "application/pdf" });
  const sha256 = Buffer.from(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())).toString("hex");
  const file = parseIncomingAttachments([{ ...row, status: "ready", capture_id: id, sha256 }], [id])[0];
  assert.equal(await verifyIncomingDownload(blob, file, id, () => id), blob);
  await assert.rejects(verifyIncomingDownload(new Blob(["wrong"], { type: blob.type }), file, id, () => id));
  await assert.rejects(verifyIncomingDownload(blob, file, id, () => null));
  let checks = 0;
  await assert.rejects(verifyIncomingDownload(blob, file, id, () => ++checks === 1 ? id : null));
});
