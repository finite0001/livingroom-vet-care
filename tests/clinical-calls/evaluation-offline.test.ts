import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CALL_EVALUATION_CASES } from "./evaluation-corpus.ts";
import { adjudicateCallReview, buildFrozenCallBundle, createCallReviewPacket, exactSha256, syntheticEnvelope, verifyFrozenCallBundle, renderCallReviewMarkdown, callEvaluationFence } from "./evaluation-offline.ts";

const bundle = await buildFrozenCallBundle();
function imports() {
  return { contract: "lrv-call-fidelity-raw-v1", bundle_sha256: bundle.bundle_sha256,
    cases: bundle.cases.map((c) => ({ case_id: c.id, request_sha256: c.request_sha256, outcome: { kind: "http", status: 200,
      request_id: "req_fictional_" + c.id, raw_body_base64: Buffer.from(JSON.stringify(syntheticEnvelope(c.semantic_negative_control.payload))).toString("base64") } })) };
}
function setBody(raw: ReturnType<typeof imports>, index: number, text: string) { raw.cases[index].outcome.raw_body_base64 = Buffer.from(text).toString("base64"); }
async function completedForm(raw = imports()) {
  const { packet, form } = await createCallReviewPacket(bundle, raw);
  return { packet, form: { ...form, reviewer: "Fictional engineering test reviewer (not clinical approval)", reviewed_at: "2026-12-01T12:00:00Z",
    decisions: form.decisions.map((d) => ({ ...d, verdict: "fail", rationale: "Synthetic negative control intentionally fails its clinical meaning.",
      evidence_refs: packet.questions.find((q) => q.id === d.question_id)!.evidence_refs.slice(0, 1) })) } };
}
test("all ten fictional requests use production capture/request/vocabulary contracts without network", async () => {
  const original = globalThis.fetch; let forbiddenFetches = 0;
  globalThis.fetch = async () => { forbiddenFetches++; throw Error("No network authorized."); };
  try {
    const repeated = await buildFrozenCallBundle();
    assert.deepEqual(repeated, bundle);
    assert.equal(forbiddenFetches, 0);
    assert.equal(bundle.provider_requests, 0);
    assert.equal(bundle.cases.length, 10);
    assert.deepEqual(bundle.cases.map((c) => c.id), CALL_EVALUATION_CASES.map((c) => c.id));
    for (const item of bundle.cases) {
      const request = JSON.parse(item.request_json), input = JSON.parse(request.input);
      assert.equal(item.request_sha256, exactSha256(item.request_json));
      assert.equal(request.model, "gpt-6-luna"); assert.equal(request.store, false);
      assert.equal(input.source_reference.manifest_sha256, item.context.source.sha256);
      assert.equal(input.template.sha256, item.context.template.sha256);
      assert.ok(item.veterinary_context.version.startsWith("lrv-vet-en-"));
      assert.ok(item.inventory.required.length && item.inventory.forbidden.length);
      assert.ok(item.inventory.required.every((f) => f.segments.length > 0));
      assert.equal(new Set([...item.inventory.required, ...item.inventory.forbidden].map((f) => f.id)).size, item.inventory.required.length + item.inventory.forbidden.length);
    }
    assert.equal(JSON.parse(JSON.parse(bundle.cases.find((c) => c.id === "H")!.request_json).input).original_call.started_at, null);
  } finally { globalThis.fetch = original; }
});
test("bundle rejects digest, inventory, request, context and source-code tampering even with rehashed envelope", async () => {
  await assert.rejects(verifyFrozenCallBundle({ ...bundle, bundle_sha256: "0".repeat(64) }));
  for (const change of [
    (b: typeof bundle) => { b.cases[0].inventory.required[0].meaning = "invented"; },
    (b: typeof bundle) => { b.cases[0].request_json += " "; },
    (b: typeof bundle) => { b.cases[0].context.patient.name = "Milo"; },
    (b: typeof bundle) => { b.source_sha256[Object.keys(b.source_sha256)[0]] = "f".repeat(64); },
  ]) {
    const changed = structuredClone(bundle); change(changed);
    await assert.rejects(verifyFrozenCallBundle(changed));
    const { bundle_sha256: _hash, ...body } = changed; changed.bundle_sha256 = exactSha256(JSON.stringify(body));
    await assert.rejects(verifyFrozenCallBundle(changed));
  }
});
test("exactly one result per case is mandatory, bound to bundle and request", async () => {
  const missing = imports(); missing.cases.pop(); await assert.rejects(createCallReviewPacket(bundle, missing));
  const duplicate = imports(); duplicate.cases[1] = duplicate.cases[0]; await assert.rejects(createCallReviewPacket(bundle, duplicate));
  const unknown = imports(); unknown.cases[0].case_id = "Z"; await assert.rejects(createCallReviewPacket(bundle, unknown));
  const wrongRequest = imports(); wrongRequest.cases[0].request_sha256 = "0".repeat(64); await assert.rejects(createCallReviewPacket(bundle, wrongRequest));
  const wrongBundle = imports(); wrongBundle.bundle_sha256 = "0".repeat(64); await assert.rejects(createCallReviewPacket(bundle, wrongBundle));
});
test("raw response bytes and refusals, invalid JSON, transport and HTTP failures survive packet construction", async () => {
  const raw = imports();
  setBody(raw, 0, "  { broken\n");
  setBody(raw, 1, JSON.stringify({ output: [{ type: "message", content: [{ type: "refusal", refusal: "No" }] }] }));
  raw.cases[2].outcome.status = 429;
  const transport = { ...raw, cases: raw.cases.map((c, n) => n === 3 ? { ...c, outcome: { kind: "transport_error", error: "Synthetic connection failure; no retry." } } : c) };
  const { packet } = await createCallReviewPacket(bundle, transport);
  assert.deepEqual(packet.cases.slice(0, 4).map((c) => c.structural_status), ["fail", "fail", "fail", "fail"]);
  assert.deepEqual(packet.cases.map((c) => c.raw_outcome), transport.cases.map((c) => c.outcome));
  assert.equal(packet.cases[0].raw_body_sha256, exactSha256("  { broken\n"));
  assert.equal(packet.cases[3].raw_body_sha256, null);
  assert.equal(packet.automatic_semantic_pass, false);
});
test("structurally valid semantic negative controls get pending per-claim and per-support clinical questions", async () => {
  const { packet, form } = await createCallReviewPacket(bundle, imports());
  assert.ok(packet.cases.every((c) => c.structural_status === "pass"));
  assert.ok(bundle.cases.every((c) => c.semantic_negative_control.semantic_expected === "fail"));
  assert.ok(form.decisions.every((d) => d.verdict === "pending" && d.rationale === ""));
  assert.equal(packet.questions.filter((q) => q.kind === "claim").length, 60);
  assert.equal(packet.questions.filter((q) => q.kind === "support").length, bundle.cases.reduce((n, c) => n + c.semantic_negative_control.payload.fields[0].claims[0].supports.length, 0));
  assert.equal(packet.cases[9].claims[0].supports.length, 3);
  assert.equal(packet.cases[0].parsed_result?.provider_model, "fictional-returned-alias");
  await assert.rejects(adjudicateCallReview(bundle, imports(), form));
});
test("tampered claim quote, duplicate support and wrong support digest become retained structural failures", async () => {
  for (const mutate of [
    (p: typeof bundle.cases[0]["semantic_negative_control"]["payload"]) => { p.fields[0].claims[0].supports[0].quote = "invented"; },
    (p: typeof bundle.cases[0]["semantic_negative_control"]["payload"]) => { p.fields[0].claims[0].supports.push(p.fields[0].claims[0].supports[0]); },
    (p: typeof bundle.cases[0]["semantic_negative_control"]["payload"]) => { p.fields[0].claims[0].supports[0].segment_sha256 = "0".repeat(64); },
  ]) {
    const raw = imports(), payload = structuredClone(bundle.cases[0].semantic_negative_control.payload); mutate(payload);
    setBody(raw, 0, JSON.stringify(syntheticEnvelope(payload)));
    const { packet } = await createCallReviewPacket(bundle, raw);
    assert.equal(packet.cases[0].structural_status, "fail"); assert.equal(packet.cases[0].raw_outcome.kind, "http");
  }
});
test("adjudication requires every distinct question, rationale, reviewer and permitted evidence", async () => {
  const { form } = await completedForm();
  for (const mutate of [
    (f: typeof form) => { f.decisions.pop(); },
    (f: typeof form) => { f.decisions[1] = f.decisions[0]; },
    (f: typeof form) => { f.decisions[0].rationale = " "; },
    (f: typeof form) => { f.reviewer = ""; },
    (f: typeof form) => { f.packet_sha256 = "0".repeat(64); },
    (f: typeof form) => { f.decisions[0].evidence_refs = ["J/claim/invented/1"]; },
    (f: typeof form) => { f.decisions[0].verdict = "pass"; f.decisions[0].evidence_refs = []; },
    (f: typeof form) => { f.decisions[0].evidence_refs.push(f.decisions[0].evidence_refs[0]); },
  ]) { const changed = structuredClone(form); mutate(changed); await assert.rejects(adjudicateCallReview(bundle, imports(), changed)); }
  const receipt = await adjudicateCallReview(bundle, imports(), form);
  assert.equal(receipt.fidelity_pass, false); assert.ok(receipt.failed_questions.length > 0);
});
test("different raw bytes invalidate completed adjudication even if parsed payload is unchanged", async () => {
  const { form } = await completedForm(), raw = imports(); setBody(raw, 0, Buffer.from(raw.cases[0].outcome.raw_body_base64, "base64").toString("utf8") + "\n");
  await assert.rejects(adjudicateCallReview(bundle, raw, form), /packet differs/);
});
test("structural failure can never pass through all-pass human decisions", async () => {
  const raw = imports(); setBody(raw, 0, "not JSON");
  const { packet, form } = await completedForm(raw);
  for (const decision of form.decisions) {
    const question = packet.questions.find((q) => q.id === decision.question_id)!;
    // The failed case has no valid claims/flags for its mandatory meanings.
    if (!question.evidence_refs.length && question.kind === "required") continue;
    decision.verdict = "pass";
  }
  const receipt = await adjudicateCallReview(bundle, raw, form);
  assert.equal(receipt.fidelity_pass, false); assert.deepEqual(receipt.structural_failures, ["A"]);
});

test("invalid UTF8 raw bytes remain exact and fail parsing; noncanonical base64 is rejected", async () => {
  const raw = imports(), bytes = Buffer.from([0xff, 0xfe, 0x00, 0x60, 0x60, 0x60]);
  raw.cases[0].outcome.raw_body_base64 = bytes.toString("base64");
  const { packet } = await createCallReviewPacket(bundle, raw);
  assert.equal(packet.cases[0].raw_body_utf8, null);
  assert.equal(packet.cases[0].raw_body_sha256, createHash("sha256").update(bytes).digest("hex"));
  assert.equal(packet.cases[0].structural_status, "fail");
  assert.deepEqual(packet.cases[0].raw_outcome, raw.cases[0].outcome);
  raw.cases[0].outcome.raw_body_base64 = "not base64!";
  await assert.rejects(createCallReviewPacket(bundle, raw));
});
test("readable review preserves stable IDs and hostile text cannot close the generated fence", async () => {
  const hostile = "```\n# FORGED APPROVAL\n``````\n<script>alert(1)</script>";
  const fenced = callEvaluationFence(hostile), lines = fenced.split("\n"), delimiter = lines[0];
  assert.equal(delimiter, "`".repeat(7));
  assert.equal(lines.at(-1), delimiter);
  assert.equal(lines.filter((line) => line === delimiter).length, 2);
  const raw = imports(); setBody(raw, 0, hostile);
  const { packet } = await createCallReviewPacket(bundle, raw), markdown = renderCallReviewMarkdown(packet);
  assert.ok(markdown.includes("Complete retained transcript segments"));
  assert.ok(markdown.includes("A/required/luna_vomit"));
  assert.ok(markdown.includes("J/claim/history/1/support/3"));
  assert.ok(markdown.includes("FORGED APPROVAL"));
  assert.equal(packet.cases[0].structural_status, "fail");
});

test("other-patient claims remain private and are absent from selected SOAP", async () => {
  const raw = imports(), payload = structuredClone(bundle.cases[0].semantic_negative_control.payload);
  payload.fields[0].claims.push({ text: "Milo had diarrhea last year.", patient_scope: "other_patient", supports: payload.fields[0].claims[0].supports });
  setBody(raw, 0, JSON.stringify(syntheticEnvelope(payload)));
  const { packet } = await createCallReviewPacket(bundle, raw);
  assert.equal(packet.cases[0].claims.length, 2);
  assert.equal(packet.cases[0].claims[1].id, "A/claim/history/2");
  assert.ok(!packet.cases[0].selected_patient_soap?.subjective.includes("Milo"));
  assert.ok(packet.questions.some((q) => q.id === "A/claim/history/2/patient_scope"));
});
test("CLI export is private, pending and refuses overwriting any existing evidence directory", () => {
  const owned = mkdtempSync(join(tmpdir(), "lrv-call-offline-test-")), destination = join(owned, "export");
  try {
    const cli = new URL("./evaluation-cli.ts", import.meta.url).pathname;
    execFileSync(process.execPath, ["--experimental-strip-types", cli, "export", destination], { stdio: "pipe" });
    const exact = readFileSync(join(destination, "bundle.json"), "utf8");
    assert.equal(JSON.parse(exact).bundle_sha256, bundle.bundle_sha256);
    assert.ok(JSON.parse(readFileSync(join(destination, "raw-import-template.json"), "utf8")).cases.every((c: { outcome: unknown }) => c.outcome === null));
    assert.equal(statSync(destination).mode & 0o777, 0o700);
    assert.equal(statSync(join(destination, "bundle.json")).mode & 0o777, 0o600);
    const duplicate = spawnSync(process.execPath, ["--experimental-strip-types", cli, "export", destination], { stdio: "pipe" });
    assert.notEqual(duplicate.status, 0);
    assert.equal(readFileSync(join(destination, "bundle.json"), "utf8"), exact);
  } finally { rmSync(owned, { recursive: true, force: true }); }
});

test("original response byte budget rejects whitespace and multibyte bodies before parse without dropping raw evidence", async () => {
  for (const body of [" ".repeat(512001) + JSON.stringify(syntheticEnvelope(bundle.cases[0].semantic_negative_control.payload)),
    JSON.stringify({ ...syntheticEnvelope(bundle.cases[0].semantic_negative_control.payload), ignored: "猫".repeat(180000) })]) {
    const raw = imports(); setBody(raw, 0, body);
    const { packet } = await createCallReviewPacket(bundle, raw);
    assert.equal(packet.cases[0].structural_status, "fail");
    assert.equal(packet.cases[0].raw_body_sha256, exactSha256(body));
    assert.equal(packet.cases[0].raw_body_utf8, body);
  }
});

test("large permitted text with many separated backtick runs cannot exceed the JS argument limit", () => {
  const text = "` ".repeat(150000);
  const fenced = callEvaluationFence(text);
  assert.equal(fenced, "```\n" + text + "\n```");
});
