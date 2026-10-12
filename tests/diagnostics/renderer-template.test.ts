import assert from "node:assert/strict";
import test from "node:test";
import { uuid } from "./fixture.ts";
import { source, longSource } from "./renderer-fixture.ts";
import {
  diagnosticRenderInput,
  reportSourceSchema,
} from "../../services/diagnostic-renderer/template.ts";
import {
  renderInputSchema,
  readBounded,
  bindRenderedBytes,
  sha256,
} from "../../services/diagnostic-renderer/sandbox.ts";
import { Readable } from "node:stream";
test("Frozen report retains zero, qualitative results, original units and escaped identity", () => {
  const input = diagnosticRenderInput(source());
  assert.ok(input.html.includes("&lt;script&gt;BAD&lt;/script&gt;"));
  assert.ok(!input.html.includes("<script>"));
  assert.ok(input.html.includes("<td>0</td>"));
  assert.ok(input.html.includes("Not detected"));
  assert.ok(input.html.includes("U/L"));
  assert.match(input.html, /Source version 1/);
  assert.equal(renderInputSchema.parse(input).job_id, source().job.id);
});
test("Report refuses cross-patient, future, duplicate or substituted source history", () => {
  for (const kind of ["patient", "future", "duplicate", "source"]) {
    const s = source();
    if (kind === "patient") s.panels[0].pet_id = uuid(999);
    if (kind === "future") s.panels[0].reviewed_at = "2099-01-01T00:00:00Z";
    if (kind === "duplicate") s.panels.push(structuredClone(s.panels[0]));
    if (kind === "source") s.job.source_hash = "c".repeat(64);
    assert.throws(() => reportSourceSchema.parse(s));
  }
});
test("Exact frozen HTML mutation fails before VM creation", () => {
  const input = diagnosticRenderInput(source());
  assert.throws(() =>
    renderInputSchema.parse({ ...input, html: input.html + "changed" }),
  );
});
test("Runtime output bound rejects extra bytes before copying and rejects text transport", async () => {
  assert.deepEqual(
    await readBounded(Readable.from([Buffer.from("abc")]), 3),
    Buffer.from("abc"),
  );
  await assert.rejects(readBounded(Readable.from([Buffer.from("abcd")]), 3));
  await assert.rejects(readBounded(Readable.from(["abc"]), 3));
});

test("Long report keeps all 100 results, original incompatible units and explicit history limit", () => {
  const input = diagnosticRenderInput(longSource());
  assert.match(input.html, /SYNTHETIC finding 97/);
  assert.match(input.html, /Zoë, μg, café/);
  assert.match(
    input.html,
    /4 of 5 reviewed panels included; history is explicitly limited/,
  );
  assert.match(input.html, /ALT · U\/L/);
  assert.match(input.html, /ALT · mg\/L/);
  assert.match(input.html, /2026-09-11/);
  assert.match(input.html, /text-anchor="end"/);
});
test("Receipt rejects substitutions, unsafe sandbox claims and mismatched actual bytes", () => {
  const input = diagnosticRenderInput(source()),
    bytes = Buffer.from("synthetic-bound-byte-test");
  const receipt = {
    version: 1,
    job_id: input.job_id,
    source_hash: input.source_hash,
    snapshot_hash: input.snapshot_hash,
    html_sha256: input.html_sha256,
    validation: {
      sha256: sha256(bytes),
      byte_length: bytes.length,
      page_count: 1,
      object_count: 4,
      stream_count: 1,
      inflated_bytes: 10,
      admission: "chromium-classic-pdf1.4-v1",
      qpdf_clean: true,
    },
    node: "fixture",
    chromium: "fixture",
    browser_sandbox: "Seccomp-BPF sandbox Yes; PID namespaces Yes",
    uid: 12001,
    credentials_absent: true,
    sudo_denied: true,
    network: null,
    semantic_text_checks: input.expected_texts.length,
  };
  assert.equal(bindRenderedBytes(input, bytes, receipt).job_id, input.job_id);
  for (const patch of [
    { job_id: uuid(999) },
    { source_hash: "c".repeat(64) },
    { snapshot_hash: "c".repeat(64) },
    { html_sha256: "c".repeat(64) },
    { semantic_text_checks: 1 },
    { uid: 0 },
    { sudo_denied: false },
    { browser_sandbox: "Seccomp-BPF sandbox No; PID namespaces Yes" },
    { validation: { ...receipt.validation, page_count: 41 } },
    { validation: { ...receipt.validation, qpdf_clean: false } },
  ])
    assert.throws(() =>
      bindRenderedBytes(input, bytes, { ...receipt, ...patch }),
    );
  assert.throws(() =>
    bindRenderedBytes(input, Buffer.from("different bytes"), receipt),
  );
});
