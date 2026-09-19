import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createFulfillmentCorrectionsApi,
  correctionRequestSchema,
} from "../../src/hub/features/prescriptions/fulfillment-corrections-api.ts";
const id = (n: number) =>
  `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const h = "a".repeat(64),
  actor = id(1),
  target = { authorization_id: id(2), pet_id: id(3), dispense_id: id(4) };
const head = { event_id: null, version: 0, record_hash: null };
const time = "2026-09-16T12:00:00.123456Z";
function fixture() {
  const request = {
    ...target,
    kind: "operational_annotation" as const,
    expected_context_hash: h,
    expected_head: head,
    reason: "Correct record",
    note: "Client-shareable facts",
    amends_event_id: null,
    pickup_amendment: null,
    attest_review: true as const,
  };
  const op = { id: id(5), kind: "append_correction", payload: request };
  const event = {
    version: 1,
    id: op.id,
    target,
    authorization_hash: h,
    dispense_document_hash: h,
    sequence: 1,
    prior_event_id: null,
    prior_record_hash: null,
    actor: { id: actor, name: "Synthetic staff", authority: "active_staff" },
    kind: request.kind,
    reason: request.reason,
    note: request.note,
    amends_event_id: null,
    pickup_amendment: null,
    reviewed_context_hash: h,
    created_at: time,
    record_hash: h,
  };
  const receipt = {
    version: 1,
    id: op.id,
    actor_id: actor,
    request,
    request_hash: h,
    result: event,
    created_at: time,
  };
  const context = {
    version: 1,
    target,
    authorization_hash: h,
    dispense_document_hash: h,
    dispense_artifact_hash: h,
    dispensed_at: time,
    original_pickup: null,
    head,
    latest_pickup_amendment: null,
  };
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  let reply: unknown = receipt;
  const api = createFulfillmentCorrectionsApi(
    {
      rpc: async (name, args) => {
        calls.push({ name, args });
        return { data: reply, error: null };
      },
    },
    actor,
    target,
  );
  return {
    request,
    op,
    event,
    receipt,
    context,
    api,
    calls,
    set: (value: unknown) => {
      reply = value;
    },
  };
}
test("append and recovery preserve exact request and microsecond receipt", async () => {
  const f = fixture();
  assert.deepEqual(await f.api.execute(f.op), f.receipt);
  assert.deepEqual(await f.api.recover(f.op), f.receipt);
  assert.deepEqual(f.calls[0].args, { p_id: f.op.id, p_request: f.request });
  assert.deepEqual(f.calls[1].args, { p_id: f.op.id });
});
test("matching UUID does not permit substituted actor, target, request or predecessor", async () => {
  for (const mutate of [
    (r: ReturnType<typeof fixture>["receipt"]) => {
      r.actor_id = id(9);
    },
    (r: ReturnType<typeof fixture>["receipt"]) => {
      r.result.target.dispense_id = id(9);
    },
    (r: ReturnType<typeof fixture>["receipt"]) => {
      r.request.note = "Substituted";
    },
    (r: ReturnType<typeof fixture>["receipt"]) => {
      r.result.sequence = 2;
    },
  ]) {
    const f = fixture(),
      bad = structuredClone(f.receipt);
    mutate(bad);
    f.set(bad);
    await assert.rejects(f.api.recover(f.op));
  }
});
test("clinical authority and pickup meaning are closed requirements", () => {
  const f = fixture();
  assert.throws(() =>
    correctionRequestSchema.parse({
      ...f.request,
      pickup_amendment: {
        original_pickup_id: id(8),
        disposition: "recorded_in_error",
        handoff: null,
      },
    }),
  );
  assert.throws(() =>
    correctionRequestSchema.parse({
      ...f.request,
      kind: "pickup_amendment",
      pickup_amendment: {
        original_pickup_id: id(8),
        disposition: "corrected_handoff",
        handoff: null,
      },
    }),
  );
  assert.throws(() =>
    correctionRequestSchema.parse({
      ...f.request,
      internal_secret: "unexpected",
    }),
  );
});
test("same-id clinical event cannot claim staff authority", async () => {
  const f = fixture();
  const request = { ...f.request, kind: "clinical_annotation" };
  f.set({
    ...f.receipt,
    request,
    result: { ...f.event, kind: "clinical_annotation" },
  });
  await assert.rejects(f.api.execute({ ...f.op, payload: request }));
});
test("text limits count Unicode codepoints and forbid control characters", () => {
  const f = fixture();
  assert.doesNotThrow(() =>
    correctionRequestSchema.parse({ ...f.request, reason: "😀".repeat(2000) }),
  );
  assert.throws(() =>
    correctionRequestSchema.parse({ ...f.request, reason: "😀".repeat(2001) }),
  );
  assert.throws(() =>
    correctionRequestSchema.parse({ ...f.request, note: "bad\rnote" }),
  );
});
test("preview rejects target substitution and impossible pickup context", async () => {
  const f = fixture();
  f.set({
    version: 1,
    actor_id: actor,
    context: { ...f.context, target: { ...target, pet_id: id(9) } },
    context_hash: h,
    observed_at: time,
  });
  await assert.rejects(f.api.preview());
  f.set({
    version: 1,
    actor_id: actor,
    context: {
      ...f.context,
      latest_pickup_amendment: {
        event_id: id(8),
        version: 1,
        value: {
          original_pickup_id: id(9),
          disposition: "recorded_in_error",
          handoff: null,
        },
      },
    },
    context_hash: h,
    observed_at: time,
  });
  await assert.rejects(f.api.preview());
});
test("bounded history rejects omitted root, broken chain and misleading cursor", async () => {
  const f = fixture();
  const page = {
    version: 1,
    target,
    head: { event_id: f.event.id, version: 1, record_hash: h },
    events: [f.event],
    next_before_version: null,
  };
  f.set(page);
  assert.deepEqual(await f.api.history(), page);
  f.set({ ...page, events: [] });
  await assert.rejects(f.api.history());
  f.set({ ...page, next_before_version: 1 });
  await assert.rejects(f.api.history());
});
test("recovery absent is distinct from a fabricated receipt and RPC errors retain code", async () => {
  const f = fixture();
  f.set(null);
  assert.equal(await f.api.recover(f.op), null);
  const api = createFulfillmentCorrectionsApi(
    {
      rpc: async () => ({
        data: null,
        error: { code: "40001", message: "stale" },
      }),
    },
    actor,
    target,
  );
  await assert.rejects(
    api.execute(f.op),
    (e) => (e as { code: string }).code === "40001",
  );
});
test("receipt chronology preserves microseconds rather than truncating them", async () => {
  const f = fixture();
  f.set({ ...f.receipt, created_at: "2026-09-16T12:00:00.123457Z" });
  await assert.rejects(f.api.execute(f.op));
});
test("reviewed immutable document hash cannot be substituted in saved correction", async () => {
  const f = fixture();
  f.set({
    version: 1,
    actor_id: actor,
    context: f.context,
    context_hash: h,
    observed_at: time,
  });
  await f.api.preview();
  f.set({
    ...f.receipt,
    result: { ...f.event, dispense_document_hash: "b".repeat(64) },
  });
  await assert.rejects(f.api.execute(f.op));
});
test("request identity and amendment references require canonical lowercase UUIDs without normalization", () => {
  const f = fixture(),
    upper = "A0000000-0000-4000-8000-000000000001";
  for (const key of [
    "authorization_id",
    "pet_id",
    "dispense_id",
    "amends_event_id",
  ])
    assert.throws(() =>
      correctionRequestSchema.parse({ ...f.request, [key]: upper }),
    );
  assert.throws(() =>
    correctionRequestSchema.parse({
      ...f.request,
      expected_head: { version: 1, event_id: upper, record_hash: h },
    }),
  );
  assert.throws(() =>
    correctionRequestSchema.parse({
      ...f.request,
      kind: "pickup_amendment",
      pickup_amendment: {
        original_pickup_id: upper,
        disposition: "recorded_in_error",
        handoff: null,
      },
    }),
  );
});
