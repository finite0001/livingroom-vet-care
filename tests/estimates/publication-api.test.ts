import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createEstimatePublicationApi,
  createEstimatePublicationEdge,
  type PublicationPreparation,
  type PublicationOperation,
  type PublicationReceipt,
  type EstimatePublicationEdge,
  type EstimatePublication,
  type PublicationEvent,
} from "../../src/hub/features/estimates/publication-api.ts";
import {
  estimatePublicationArtifact,
  type EstimatePublicationSnapshot,
} from "../../supabase/functions/_shared/estimate-publication-document.ts";
const id = (n: number) =>
    `fa520000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  actor = id(1),
  target = { estimate_id: id(2), client_id: id(3), pet_id: id(4) },
  hash = "a".repeat(64),
  time = "2026-09-16T12:00:00.000001Z",
  later = "2026-09-16T12:01:00.000001Z",
  head = { event_id: null, version: 0, record_hash: null };
async function fixture() {
  const snapshot: EstimatePublicationSnapshot = {
    schema_version: 1,
    preparation_id: id(5),
    prepared_at: time,
    target,
    draft_version: 1,
    draft_record_hash: hash,
    practice: {
      version: 1,
      name: "The Living Room Veterinary Care",
      address: "2619 Spruce Street, Boulder, CO",
      domain: "thelivingroom.vet",
    },
    client: {
      id: target.client_id,
      version: 1,
      name: "Synthetic household",
      mailing_address: null,
    },
    patient: {
      id: target.pet_id,
      version: 1,
      name: "Juniper",
      species: "Dog",
      breed: null,
    },
    title: "Proposed care",
    notes: "",
    terms: "Discuss changes first.",
    lines: [
      {
        line: {
          id: id(6),
          product_id: id(7),
          product_version: 1,
          description: "Consultation",
          kind: "service",
          unit: "visit",
          quantity: "0.5",
          pricing: { kind: "allocated", amount_cents: "125" },
          pricing_reason: "Partial service agreement",
        },
        amount_cents: "125",
      },
    ],
    total_cents: "125",
    currency: "usd",
    acceptance: {
      accept_by: "2026-10-31",
      timezone: "America/Denver",
      expires_at: "2026-11-01T06:00:00Z",
      acknowledgment_version: 1,
      scope: "entire_exact_revision",
      price_validity: "accepted_quantities",
      not_clinical_consent: true,
      not_payment: true,
    },
  };
  const generated = await estimatePublicationArtifact(snapshot),
    fields = {
      title: snapshot.title,
      notes: snapshot.notes,
      terms: snapshot.terms,
      lines: snapshot.lines.map((l) => l.line),
      accept_by: snapshot.acceptance.accept_by,
    };
  const context = {
    target,
    draft: {
      id: target.estimate_id,
      client_id: target.client_id,
      pet_id: target.pet_id,
      version: 1,
      fields,
      total_cents: "125",
      created_by: actor,
      created_at: time,
      updated_by: actor,
      updated_at: time,
    },
    draft_record_hash: hash,
    publication_head: head,
    current_publication_id: null,
    practice: snapshot.practice,
    client: snapshot.client,
    patient: snapshot.patient,
  };
  const request = {
    target,
    draft_version: 1,
    expected_source_hash: hash,
    expected_publication_head: head,
    replaces_publication_id: null,
  };
  const p: PublicationPreparation = {
    version: 1,
    id: id(5),
    actor_id: actor,
    request,
    request_hash: hash,
    context,
    source_hash: hash,
    snapshot,
    content_hash: hash,
    artifact: generated.artifact,
    created_at: time,
  };
  const op: PublicationOperation = {
    id: id(8),
    kind: "record_estimate_publication",
    payload: {
      kind: "publish",
      request: {
        target,
        preparation_id: p.id,
        expected_draft_version: 1,
        expected_publication_head: head,
        expected_content_hash: hash,
        expected_artifact_hash: generated.artifact.sha256,
        replaces_publication_id: null,
        attest_document_review: true,
        attest_pricing_review: true,
        attest_terms_review: true,
      },
    },
  };
  const publication: EstimatePublication = {
    id: op.id,
    target,
    preparation_id: p.id,
    draft_version: 1,
    draft_record_hash: hash,
    content_hash: hash,
    artifact: generated.artifact,
    accept_by: snapshot.acceptance.accept_by,
    expires_at: snapshot.acceptance.expires_at,
    published_by: actor,
    published_at: later,
    replaces_publication_id: null,
  };
  const event: PublicationEvent = {
    id: op.id,
    target,
    version: 1,
    previous_hash: null,
    kind: "published",
    actor_id: actor,
    created_at: later,
    publication_id: op.id,
    publication,
    reason: null,
    record_hash: hash,
  };
  const receipt: PublicationReceipt = {
    version: 1,
    id: op.id,
    actor_id: actor,
    mutation: op.payload,
    request_hash: hash,
    result: event,
    created_at: later,
  };
  return { p, generated, op, publication, event, receipt };
}
function api(
  value: unknown,
  edgeValue: unknown = null,
  download?: () => Promise<Response>,
) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const edge: EstimatePublicationEdge = {
    json: async () => edgeValue,
    artifact:
      download ??
      (async () => {
        throw new Error("Unexpected download");
      }),
  };
  return {
    calls,
    api: createEstimatePublicationApi(
      {
        rpc: async (name, args) => {
          calls.push({ name, args });
          return { data: value, error: null };
        },
      },
      actor,
      target,
      edge,
    ),
  };
}
test("preview, captured preparation and recovery bind actor, target and reviewed context", async () => {
  const f = await fixture(),
    preview = {
      version: 1,
      actor_id: actor,
      context: f.p.context,
      source_hash: hash,
    },
    a = api(preview, { version: 1, preparation: f.p }).api;
  assert.deepEqual(await a.preview(1), preview);
  assert.deepEqual(await a.prepare({ id: f.p.id, request: f.p.request }), f.p);
  assert.deepEqual(await a.recoverPreparation(f.p.id, f.p.request), f.p);
  assert.equal(
    await api(null, { version: 1, preparation: null }).api.recoverPreparation(
      f.p.id,
      f.p.request,
    ),
    null,
  );
  const wrong = structuredClone(f.p);
  wrong.context.client.id = id(99);
  await assert.rejects(
    api(null, { version: 1, preparation: wrong }).api.prepare({
      id: f.p.id,
      request: f.p.request,
    }),
  );
  const foreign = structuredClone(f.p);
  foreign.actor_id = id(99);
  await assert.rejects(
    api(null, { version: 1, preparation: foreign }).api.recoverPreparation(
      f.p.id,
      f.p.request,
    ),
  );
});
test("prepare rejects uncaptured and substituted exact input even when envelope is otherwise valid", async () => {
  const f = await fixture();
  await assert.rejects(
    api(null, {
      version: 1,
      preparation: { ...f.p, artifact: null },
    }).api.prepare({ id: f.p.id, request: f.p.request }),
  );
  const request = { ...f.p.request, expected_source_hash: "b".repeat(64) };
  await assert.rejects(
    api(null, { version: 1, preparation: f.p }).api.recoverPreparation(
      f.p.id,
      request,
    ),
  );
});
test("publish and historical exact recovery validate linked event and preserve ID", async () => {
  const f = await fixture(),
    a = api(f.receipt);
  assert.deepEqual(await a.api.execute(f.op), f.receipt);
  assert.equal(a.calls[0].name, "publish_native_estimate");
  assert.deepEqual(a.calls[0].args, {
    p_id: f.op.id,
    p_request: f.op.payload.request,
  });
  assert.deepEqual(await a.api.recover(f.op), f.receipt);
  assert.equal(await api(null).api.recover(f.op), null);
  for (const mutate of [
    (r: PublicationReceipt) => {
      r.result.actor_id = id(99);
    },
    (r: PublicationReceipt) => {
      r.result.version = 2;
    },
    (r: PublicationReceipt) => {
      r.result.publication!.artifact.sha256 = "b".repeat(64);
    },
    (r: PublicationReceipt) => {
      r.result.target = { ...target, pet_id: id(99) };
    },
    (r: PublicationReceipt) => {
      Object.assign(r, { unexpected: true });
    },
  ]) {
    const r = structuredClone(f.receipt);
    mutate(r);
    await assert.rejects(api(r).api.execute(f.op));
  }
});
test("withdraw binds exact predecessor, reason, publication and actor", async () => {
  const f = await fixture();
  const op: PublicationOperation = {
    id: id(9),
    kind: "record_estimate_publication",
    payload: {
      kind: "withdraw",
      request: {
        target,
        publication_id: f.publication.id,
        expected_publication_head: {
          event_id: f.event.id,
          version: 1,
          record_hash: hash,
        },
        reason: "Scope changed",
        attest_review: true,
      },
    },
  };
  const r: PublicationReceipt = {
    version: 1,
    id: op.id,
    actor_id: actor,
    mutation: op.payload,
    request_hash: hash,
    created_at: later,
    result: {
      id: op.id,
      target,
      version: 2,
      previous_hash: hash,
      kind: "withdrawn",
      actor_id: actor,
      created_at: later,
      publication_id: f.publication.id,
      publication: null,
      reason: "Scope changed",
      record_hash: hash,
    },
  };
  const a = api(r);
  await a.api.execute(op);
  assert.equal(a.calls[0].name, "withdraw_native_estimate");
  r.result.reason = "Different reason";
  await assert.rejects(api(r).api.recover(op));
});
test("durable closure rejects malformed actor/mutation and resolves an existing receipt", async () => {
  const f = await fixture(),
    closed = {
      version: 1,
      status: "closed_unrecorded",
      closure: {
        version: 1,
        id: f.op.id,
        actor_id: actor,
        mutation: f.op.payload,
        request_hash: hash,
        closed_at: later,
        record_hash: hash,
      },
    };
  assert.deepEqual(await api(closed).api.close(f.op), closed);
  assert.deepEqual(
    await api({ version: 1, status: "recorded", receipt: f.receipt }).api.close(
      f.op,
    ),
    { version: 1, status: "recorded", receipt: f.receipt },
  );
  closed.closure.actor_id = id(99);
  await assert.rejects(api(closed).api.close(f.op));
  await assert.rejects(api(null).api.close(f.op));
});
test("current status and published historical snapshot reject conflicting identities", async () => {
  const f = await fixture(),
    h = { event_id: f.event.id, version: 1, record_hash: hash },
    read = {
      version: 1,
      actor_id: actor,
      target,
      head: h,
      current: f.publication,
      current_status: "open",
      latest_publication: f.publication,
    };
  await api(read).api.read();
  await assert.rejects(
    api({ ...read, current_status: "withdrawn" }).api.read(),
  );
  const detail = {
    version: 1,
    actor_id: actor,
    publication: f.publication,
    snapshot: f.p.snapshot,
    head: h,
    status: "open",
  };
  await api(detail).api.published(f.publication.id);
  const bad = structuredClone(detail);
  bad.snapshot.preparation_id = id(99);
  await assert.rejects(api(bad).api.published(f.publication.id));
});
test("history validates complete contiguous pages, head and cursor without guessing current state", async () => {
  const f = await fixture(),
    withdraw: PublicationEvent = {
      id: id(9),
      target,
      version: 2,
      previous_hash: hash,
      kind: "withdrawn",
      actor_id: actor,
      created_at: later,
      publication_id: f.publication.id,
      publication: null,
      reason: "Withdrawn",
      record_hash: "b".repeat(64),
    },
    h = {
      event_id: withdraw.id,
      version: 2,
      record_hash: withdraw.record_hash,
    },
    r = {
      version: 1,
      actor_id: actor,
      target,
      head: h,
      events: [withdraw],
      has_more: true,
      next_before_version: 2,
    };
  await api(r).api.history(null, 1);
  await api({
    ...r,
    events: [f.event],
    has_more: false,
    next_before_version: null,
  }).api.history(2, 1);
  await assert.rejects(api({ ...r, events: [f.event] }).api.history(null, 1));
  await assert.rejects(
    api({ ...r, next_before_version: 1 }).api.history(null, 1),
  );
  await api({
    ...r,
    events: [],
    has_more: false,
    next_before_version: null,
  }).api.history(1, 1);
});
test("download returns exact retained bytes and rejects digest, truncation, overrun and wrong filename", async () => {
  const f = await fixture(),
    response = (body: string) =>
      new Response(body, {
        headers: {
          "Content-Type": f.generated.artifact.mime_type,
          "Content-Disposition": `attachment; filename="${f.generated.artifact.filename}"`,
        },
      });
  const blob = await api(null, null, async () =>
    response(f.generated.html),
  ).api.download(f.p.id, f.generated.artifact);
  assert.equal(await blob.text(), f.generated.html);
  for (const body of ["wrong", f.generated.html + "x"])
    await assert.rejects(
      api(null, null, async () => response(body)).api.download(
        f.p.id,
        f.generated.artifact,
      ),
    );
  await assert.rejects(
    api(
      null,
      null,
      async () =>
        new Response(f.generated.html, {
          headers: { "Content-Type": "text/html" },
        }),
    ).api.download(f.p.id, f.generated.artifact),
  );
  await assert.rejects(
    api(null, null, async () => response(f.generated.html)).api.download(
      id(99),
      f.generated.artifact,
    ),
  );
});
test("Edge transport uses current bearer/public key and streams bounded strict responses", async () => {
  const calls: { url: string; options: RequestInit | undefined }[] = [];
  const fetcher: typeof fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return new Response('{"version":1,"preparation":null}', {
      headers: { "Content-Type": "application/json" },
    });
  };
  const edge = createEstimatePublicationEdge(
    "http://127.0.0.1:54321",
    async () => "current-staff-token",
    "public-key",
    fetcher,
  );
  assert.deepEqual(
    await edge.json("recover-estimate-publication-preparation", { id: id(5) }),
    { version: 1, preparation: null },
  );
  assert.equal(
    (calls[0].options!.headers as Record<string, string>).apikey,
    "public-key",
  );
  assert.equal(
    (calls[0].options!.headers as Record<string, string>).Authorization,
    "Bearer current-staff-token",
  );
  assert.equal(calls[0].options!.redirect, "error");
  const large = createEstimatePublicationEdge(
    "http://127.0.0.1:54321",
    async () => "token",
    "public",
    async () =>
      new Response("x".repeat(2097153), {
        headers: { "Content-Type": "application/json" },
      }),
  );
  await assert.rejects(
    large.json("recover-estimate-publication-preparation", { id: id(5) }),
  );
  const missing = createEstimatePublicationEdge(
    "http://127.0.0.1:54321",
    async () => null,
    "public",
    fetcher,
  );
  await assert.rejects(
    missing.json("recover-estimate-publication-preparation", { id: id(5) }),
  );
});

test("publication expiry must be the exact next Denver midnight, not merely after publication", async () => {
  const f = await fixture();
  const r = {
    version: 1,
    actor_id: actor,
    target,
    head: { event_id: f.event.id, version: 1, record_hash: hash },
    current: f.publication,
    current_status: "open",
    latest_publication: f.publication,
  };
  const bad = structuredClone(r);
  bad.current.expires_at = "2026-11-01T07:00:00Z";
  bad.latest_publication.expires_at = bad.current.expires_at;
  await assert.rejects(api(bad).api.read());
});
