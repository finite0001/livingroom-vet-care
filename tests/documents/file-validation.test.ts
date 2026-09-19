import test from "node:test";
import assert from "node:assert/strict";
import {
  matchesDocumentSignature,
  validateDocumentFile,
  MAX_DOCUMENT_BYTES,
} from "../../src/hub/features/documents/file-validation.ts";

test("document signatures reject renamed HTML and truncated images", () => {
  assert.equal(
    matchesDocumentSignature(
      new TextEncoder().encode("<html>"),
      "application/pdf",
    ),
    false,
  );
  assert.equal(
    matchesDocumentSignature(new Uint8Array([137, 80, 78]), "image/png"),
    false,
  );
  assert.equal(
    matchesDocumentSignature(new Uint8Array([255, 216, 255]), "image/jpeg"),
    true,
  );
  assert.equal(
    matchesDocumentSignature(
      new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
      "image/png",
    ),
    true,
  );
});
test("document validation accepts a PDF and rejects empty or oversized files", async () => {
  await validateDocumentFile(
    new File(["%PDF-1.7\n"], "record.pdf", { type: "application/pdf" }),
  );
  await assert.rejects(
    validateDocumentFile(
      new File([], "empty.pdf", { type: "application/pdf" }),
    ),
    /nonempty/,
  );
  await assert.rejects(
    validateDocumentFile(
      new File([new Uint8Array(MAX_DOCUMENT_BYTES + 1)], "large.pdf", {
        type: "application/pdf",
      }),
    ),
    /20 MiB/,
  );
  await assert.rejects(
    validateDocumentFile(
      new File(["<html>"], "fake.pdf", { type: "application/pdf" }),
    ),
    /contents match/,
  );
});
