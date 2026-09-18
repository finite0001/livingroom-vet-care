import test from "node:test";
import assert from "node:assert/strict";
import { createEstimatePublicationHandler, type EstimatePublicationDependencies } from "../../supabase/functions/_shared/estimate-publication-http.ts";
import { estimatePublicationArtifact, type EstimatePublicationSnapshot } from "../../supabase/functions/_shared/estimate-publication-document.ts";
const id = (value: number) => `fa520000-0000-4000-8000-${String(value).padStart(12, "0")}`;
function snapshot(): EstimatePublicationSnapshot {
  return {
    schema_version: 1, preparation_id: id(1), prepared_at: "2026-09-16T12:00:00.000001Z",
    target: { estimate_id: id(2), client_id: id(3), pet_id: id(4) }, draft_version: 2, draft_record_hash: "a".repeat(64),
    practice: { version: 1, name: "The Living Room Veterinary Care", address: "2619 Spruce Street, Boulder, CO", domain: "thelivingroom.vet" },
    client: { id: id(3), version: 2, name: "Synthetic client", mailing_address: null },
    patient: { id: id(4), version: 3, name: "Synthetic patient", species: "Dog", breed: null },
    title: "Proposed care", notes: "", terms: "Synthetic terms", currency: "usd", total_cents: "188",
    lines: [{ line: { id: id(5), product_id: id(6), product_version: 1, description: "Service", kind: "service", unit: "visit",
      quantity: "1.5", pricing: { kind: "unit", unit_price_cents: "125" }, pricing_reason: null }, amount_cents: "188" }],
    acceptance: { accept_by: "2026-10-31", timezone: "America/Denver", expires_at: "2026-11-01T06:00:00Z",
      acknowledgment_version: 1, scope: "entire_exact_revision", price_validity: "accepted_quantities", not_clinical_consent: true, not_payment: true },
  };
}

const actor = id(90);
const emptyHead = { event_id: null, version: 0, record_hash: null };
async function fixture(captured = false) {
  const s = snapshot();
  const generated = await estimatePublicationArtifact(s);
  const target = s.target;
  const request = { target, draft_version: s.draft_version, expected_source_hash: "b".repeat(64), expected_publication_head: emptyHead, replaces_publication_id: null };
  const preparation = { version: 1, id: s.preparation_id, actor_id: actor, request, request_hash: "c".repeat(64),
    context: { target, draft: { id: target.estimate_id, client_id: target.client_id, pet_id: target.pet_id, version: s.draft_version,
      fields: { title: s.title, notes: s.notes, terms: s.terms, accept_by: s.acceptance.accept_by, lines: s.lines.map(value => value.line) },
      total_cents: s.total_cents, created_by: actor, updated_by: actor, created_at: s.prepared_at, updated_at: s.prepared_at },
      draft_record_hash: s.draft_record_hash, publication_head: emptyHead, current_publication_id: null, practice: s.practice, client: s.client, patient: s.patient },
    source_hash: request.expected_source_hash, snapshot: s, content_hash: "d".repeat(64), artifact: captured ? generated.artifact : null, created_at: s.prepared_at };
  return { preparation, generated };
}
function post(body: unknown, token = "staff") {
  return new Request("https://synthetic.invalid/estimate", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
interface Call { scope: string; name: string; args: Record<string, unknown> }
function harness(resolve: (call: Call) => unknown | Promise<unknown>) {
  const calls: Call[] = [];
  const db = (scope: string) => ({ rpc: async (name: string, args: Record<string, unknown>) => {
    const call = { scope, name, args }; calls.push(call); return { data: await resolve(call), error: null };
  } });
  const deps: EstimatePublicationDependencies = { service: db("service"), authenticate: async token => token === "staff" ? { actorId: actor, db: db("staff") } : null };
  return { calls, deps };
}

test("prepare derives service actor, captures exact rendered bytes once and recovers immutable preparation", async () => {
  const { preparation, generated } = await fixture();
  const captured = { ...preparation, artifact: generated.artifact };
  const { deps, calls } = harness(call => {
    if (call.name === "prepare_native_estimate_publication") return preparation;
    if (call.name === "native_estimate_capture_context") return { preparation, captured: false };
    if (call.name === "capture_native_estimate_publication_artifact") {
      assert.equal(call.scope, "service"); assert.equal(call.args.p_actor_id, actor);
      assert.equal(call.args.p_content_hash, preparation.content_hash);
      assert.equal(call.args.p_renderer_version, 1);
      assert.equal(Buffer.from(String(call.args.p_html_utf8_base64), "base64").toString("utf8"), generated.html);
      return generated.artifact;
    }
    assert.equal(call.name, "recover_native_estimate_preparation"); return captured;
  });
  const response = await createEstimatePublicationHandler(deps, "prepare")(post({ id: preparation.id, request: preparation.request }));
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { version: 1, preparation: captured });
  assert.deepEqual(calls.map(call => call.scope), ["staff", "service", "service", "staff"]);
});

test("already captured recovery never calls service or renders; missing recovery is null", async () => {
  const { preparation } = await fixture(true);
  for (const result of [preparation, null]) {
    const { deps, calls } = harness(() => result);
    const response = await createEstimatePublicationHandler(deps, "recover")(post({ id: preparation.id }));
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), { version: 1, preparation: result });
    assert.equal(calls.length, 1); assert.equal(calls[0].scope, "staff");
  }
});

test("capture committed between recovery and service context is retained without recapture", async () => {
  const { preparation, generated } = await fixture(); const captured = { ...preparation, artifact: generated.artifact };
  let reads = 0;
  const { deps, calls } = harness(call => call.name === "native_estimate_capture_context" ? { preparation: captured, captured: true } : ++reads === 1 ? preparation : captured);
  const response = await createEstimatePublicationHandler(deps, "recover")(post({ id: preparation.id }));
  assert.equal(response.status, 200); assert.equal(calls.length, 3);
  assert.ok(!calls.some(call => call.name === "capture_native_estimate_publication_artifact"));
});

test("closed request validation refuses browser HTML/actor and oversized or malformed UTF8 bodies before RPC", async () => {
  const { preparation } = await fixture(); const { deps, calls } = harness(() => { throw new Error("No RPC expected"); });
  const handler = createEstimatePublicationHandler(deps, "prepare");
  for (const extra of [{ actor_id: actor }, { html: "<html>" }, { service_role_key: "synthetic" }]) {
    assert.equal((await handler(post({ id: preparation.id, request: preparation.request, ...extra }))).status, 404);
  }
  assert.equal((await handler(post({ id: preparation.id, request: { ...preparation.request, practice: {} } }))).status, 404);
  assert.equal((await handler(post("x".repeat(16385)))).status, 404);
  assert.equal((await handler(new Request("https://synthetic.invalid", { method: "POST", headers: { Authorization: "Bearer staff" }, body: new Uint8Array([0xff]) }))).status, 404);
  assert.equal(calls.length, 0);
  assert.equal((await handler(post({}, "invalid"))).status, 401);
  assert.equal((await handler(new Request("https://synthetic.invalid"))).status, 405);
});

test("preparation scope, expanded responses and changed capture/recovery evidence fail closed", async () => {
  const { preparation, generated } = await fixture();
  const mutations = [
    (p: typeof preparation) => { p.actor_id = id(91); },
    (p: typeof preparation) => { p.id = id(92); },
    (p: typeof preparation) => { p.context.draft.fields.title = "Changed"; },
    (p: typeof preparation) => { p.snapshot.target.client_id = id(93); },
    (p: typeof preparation) => { Object.assign(p, { unexpected: true }); },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(preparation); mutate(changed);
    const { deps, calls } = harness(() => changed);
    assert.equal((await createEstimatePublicationHandler(deps, "recover")(post({ id: preparation.id }))).status, 404);
    assert.equal(calls.length, 1);
  }
  for (const corrupt of ["context", "artifact", "recovery"]) {
    const { deps } = harness(call => {
      if (call.name === "prepare_native_estimate_publication") return preparation;
      if (call.name === "native_estimate_capture_context") return { preparation: corrupt === "context" ? { ...preparation, content_hash: "e".repeat(64) } : preparation, captured: false };
      if (call.name === "capture_native_estimate_publication_artifact") return corrupt === "artifact" ? { ...generated.artifact, sha256: "f".repeat(64) } : generated.artifact;
      return { ...preparation, artifact: generated.artifact, ...(corrupt === "recovery" ? { content_hash: "e".repeat(64) } : {}) };
    });
    assert.equal((await createEstimatePublicationHandler(deps, "prepare")(post({ id: preparation.id, request: preparation.request }))).status, 404);
  }
});

test("artifact read uses staff-scoped stored bytes and validates digest, length, filename, type and UTF8", async () => {
  const { preparation, generated } = await fixture(true);
  const request = { preparation_id: preparation.id, client_id: preparation.request.target.client_id, expected_artifact_hash: generated.artifact.sha256 };
  const original = { artifact: generated.artifact, content_base64: Buffer.from(generated.html).toString("base64") };
  const { deps, calls } = harness(call => {
    assert.equal(call.name, "read_native_estimate_publication_artifact"); assert.equal(call.scope, "staff");
    assert.deepEqual(call.args, { p_preparation_id: request.preparation_id, p_client_id: request.client_id, p_expected_artifact_hash: request.expected_artifact_hash });
    return original;
  });
  const response = await createEstimatePublicationHandler(deps, "read")(post(request));
  assert.equal(response.status, 200); assert.equal(await response.text(), generated.html); assert.equal(calls.length, 1);
  assert.equal(response.headers.get("Content-Type"), generated.artifact.mime_type);
  assert.equal(response.headers.get("Cache-Control"), "no-store, private");
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  assert.match(response.headers.get("Content-Disposition")!, /^attachment;/);
  for (const changed of [
    { ...original, content_base64: Buffer.from("wrong").toString("base64") },
    { ...original, content_base64: original.content_base64 + "\n" },
    { ...original, artifact: { ...original.artifact, byte_length: original.artifact.byte_length + 1 } },
    { ...original, artifact: { ...original.artifact, sha256: "e".repeat(64) } },
    { ...original, artifact: { ...original.artifact, filename: original.artifact.filename.replace(preparation.id, id(99)) } },
    { ...original, artifact: { ...original.artifact, mime_type: "text/plain" } },
    { ...original, extra: true },
  ]) {
    const bad = harness(() => changed);
    assert.equal((await createEstimatePublicationHandler(bad.deps, "read")(post(request))).status, 404);
  }
  const invalidUtf8 = { artifact: { ...generated.artifact, byte_length: 1 }, content_base64: "/w==" };
  const bad = harness(() => invalidUtf8);
  assert.equal((await createEstimatePublicationHandler(bad.deps, "read")(post(request))).status, 404);
});

test("recovery safely completes missing capture and a lost response retries the same stored artifact", async () => {
  const { preparation, generated } = await fixture();
  let stored = false, loseReply = true;
  const { deps, calls } = harness(call => {
    if (call.name === "recover_native_estimate_preparation") return { ...preparation, artifact: stored ? generated.artifact : null };
    if (call.name === "native_estimate_capture_context") return { preparation, captured: false };
    assert.equal(call.name, "capture_native_estimate_publication_artifact");
    stored = true;
    if (loseReply) { loseReply = false; throw new Error("Synthetic transport failure after commit"); }
    return generated.artifact;
  });
  const handler = createEstimatePublicationHandler(deps, "recover");
  const first = await handler(post({ id: preparation.id })); assert.equal(first.status, 404);
  const second = await handler(post({ id: preparation.id })); assert.equal(second.status, 200);
  assert.deepEqual((await second.json()).preparation.artifact, generated.artifact);
  assert.equal(calls.filter(call => call.name === "capture_native_estimate_publication_artifact").length, 1);
  const completing = harness(call => {
    if (call.name === "recover_native_estimate_preparation") return { ...preparation, artifact: stored ? generated.artifact : null };
    if (call.name === "native_estimate_capture_context") return { preparation, captured: false };
    stored = true; return generated.artifact;
  });
  stored = false;
  assert.equal((await createEstimatePublicationHandler(completing.deps, "recover")(post({ id: preparation.id }))).status, 200);
});

test("database and authentication errors never leak source or provider details", async () => {
  const { preparation } = await fixture();
  const secret = "synthetic-private-diagnostic";
  const deps: EstimatePublicationDependencies = {
    authenticate: async () => ({ actorId: actor, db: { rpc: async () => ({ data: null, error: { message: secret, code: "42501" } }) } }),
    service: { rpc: async () => { throw new Error("No service call expected"); } },
  };
  const response = await createEstimatePublicationHandler(deps, "recover")(post({ id: preparation.id }));
  assert.equal(response.status, 404); assert.doesNotMatch(await response.text(), new RegExp(secret));
  deps.authenticate = async () => { throw new Error(secret); };
  const failedAuth = await createEstimatePublicationHandler(deps, "recover")(post({ id: preparation.id }));
  assert.equal(failedAuth.status, 404); assert.doesNotMatch(await failedAuth.text(), new RegExp(secret));
});

test("large retained UTF8 artifact is verified without recursive base64 matching or byte rewriting", async () => {
  const { preparation, generated } = await fixture(true);
  const html = "🐾".repeat(400000);
  const bytes = new TextEncoder().encode(html);
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), value => value.toString(16).padStart(2, "0")).join("");
  const artifact = { ...generated.artifact, byte_length: bytes.length, sha256: digest };
  const { deps } = harness(() => ({ artifact, content_base64: Buffer.from(bytes).toString("base64") }));
  const response = await createEstimatePublicationHandler(deps, "read")(post({ preparation_id: preparation.id, client_id: preparation.request.target.client_id, expected_artifact_hash: digest }));
  assert.equal(response.status, 200); assert.equal(await response.text(), html);
});
