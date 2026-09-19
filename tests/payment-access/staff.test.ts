import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  createStaffPaymentAccessHandler,
  safePaymentCollection,
} from "../../supabase/functions/_shared/payment-access-staff.ts";
import { paymentAccessConfig } from "../../supabase/functions/_shared/payment-access-capability.ts";
const id = (n: number) =>
  `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const origin = "https://thelivingroom.vet";
const grant = {
  id: id(1),
  actor_id: id(2),
  invoice_id: id(3),
  client_id: id(4),
  source_hash: "a".repeat(64),
  amount_cents: "12345",
  currency: "usd",
  created_at: "2026-09-13T03:00:00Z",
  expires_at: "2026-09-20T03:00:00Z",
  status_expires_at: "2026-10-20T03:00:00Z",
};
const args = {
  p_request_id: grant.id,
  p_invoice_id: grant.invoice_id,
  p_client_id: grant.client_id,
  p_source_hash: grant.source_hash,
  p_amount_cents: 12345,
  p_expires_at: grant.expires_at,
};
function envelope(captured = false) {
  const capability_context = JSON.stringify({
    domain: "lrv-payment-collection/v2",
    context_version: 2,
    grant,
    origin,
    key_version: "first",
  });
  return {
    grant: {
      ...grant,
      state: captured ? "captured" : "preparing",
      origin: captured ? origin : null,
      key_version: captured ? "first" : null,
    },
    capture: captured
      ? {
          grant_id: grant.id,
          origin,
          key_version: "first",
          context_version: 2,
          capability_context,
          context_hash: createHash("sha256")
            .update(capability_context)
            .digest("hex"),
        }
      : null,
    events: [],
    attempts: [],
    receipt: null,
  };
}
function fixture(initial: ReturnType<typeof envelope> | null = null) {
  let saved = initial,
    lost = false,
    fail = false,
    missing = false,
    lostPrepare = false,
    prepareCode: string | null = null;
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  let configs = 0;
  const db = {
    rpc: async (name: string, input: Record<string, unknown>) => {
      calls.push({ name, args: input });
      if (name === "recover_payment_collection")
        return { data: saved, error: null };
      if (name === "prepare_payment_collection") {
        if (prepareCode) return { data: null, error: { code: prepareCode } };
        if (Object.entries(args).some(([k, v]) => input[k] !== v))
          return { data: null, error: { code: "23505", message: "mismatch" } };
        saved ??= envelope();
        return { data: saved, error: lostPrepare ? new Error("lost prepare acknowledgement") : null };
      }
      throw new Error("unexpected actor RPC");
    },
  };
  const deps = {
    enabled: true,
    origin,
    authenticate: async () => ({ actorId: grant.actor_id, db }),
    config: () => {
      configs++;
      if (missing) throw new Error("removed keys");
      return paymentAccessConfig({
        origin,
        activeKeyVersion: "first",
        keys: JSON.stringify({ first: btoa("x".repeat(32)) }),
      });
    },
    service: {
      rpc: async (name: string, input: Record<string, unknown>) => {
        calls.push({ name, args: input });
        if (name === "payment_collection_capture_context")
          return { data: envelope(true), error: null };
        assert.equal(name, "capture_payment_collection");
        if (fail) return { data: null, error: new Error("uncertain") };
        saved = envelope(true);
        return {
          data: saved,
          error: lost ? new Error("lost acknowledgement") : null,
        };
      },
    },
  };
  const send = (
    mode: "prepare" | "recover" = "prepare",
    input: unknown = mode === "prepare"
      ? args
      : { p_invoice_id: grant.invoice_id, p_request_id: grant.id },
    headers: Record<string, string> = {},
  ) =>
    createStaffPaymentAccessHandler(
      deps,
      mode,
    )(
      new Request(origin, {
        method: "POST",
        headers: {
          Authorization: "Bearer fixture",
          Origin: origin,
          ...headers,
        },
        body: JSON.stringify(input),
      }),
    );
  return {
    send,
    deps,
    calls,
    get configs() {
      return configs;
    },
    set lostPrepare(v: boolean) {
      lostPrepare = v;
    },
    set prepareCode(v: string | null) {
      prepareCode = v;
    },
    set lost(v: boolean) {
      lost = v;
    },
    set fail(v: boolean) {
      fail = v;
    },
    set missing(v: boolean) {
      missing = v;
    },
  };
}
test("preparation uses actor binding, captures only hashes and returns no usable capability", async () => {
  const f = fixture();
  const r = await f.send();
  assert.equal(r.status, 200);
  const body = await r.text();
  assert.equal(JSON.parse(body).grant.state, "captured");
  assert.doesNotMatch(
    body,
    /p1\.|s1\.|collection_token|status_token|\/pay\/|checkout_url/,
  );
  assert.deepEqual(
    f.calls.find((c) => c.name === "prepare_payment_collection")?.args,
    args,
  );
  const capture = f.calls.find(
    (c) => c.name === "capture_payment_collection",
  )!.args;
  assert.deepEqual(
    Object.keys(capture).sort(),
    [
      "p_actor_id",
      "p_collection_token_hash",
      "p_key_version",
      "p_origin",
      "p_request_id",
      "p_status_token_hash",
    ].sort(),
  );
  assert.match(String(capture.p_collection_token_hash), /^[a-f0-9]{64}$/);
  assert.notEqual(capture.p_status_token_hash, capture.p_collection_token_hash);
  assert.equal(r.headers.get("cache-control"), "no-store, private");
});
test("captured recover and exact prepare work after all keys removed without config access", async () => {
  const f = fixture(envelope(true));
  f.missing = true;
  for (const mode of ["recover", "prepare"] as const)
    assert.equal((await f.send(mode)).status, 200);
  assert.equal(f.configs, 0);
  assert.equal(
    f.calls.some((c) => c.name.includes("capture")),
    false,
  );
});
test("new preparation fails closed before mutation with missing configuration", async () => {
  const f = fixture();
  f.missing = true;
  assert.equal((await f.send()).status, 503);
  assert.deepEqual(
    f.calls.map((c) => c.name),
    ["recover_payment_collection"],
  );
});
test("lost committed capture acknowledgement recovers original request and expiry", async () => {
  const f = fixture();
  f.lost = true;
  const r = await f.send();
  assert.equal(r.status, 200);
  const b = await r.json();
  assert.equal(b.grant.id, grant.id);
  assert.equal(b.grant.expires_at, grant.expires_at);
  assert.equal(
    f.calls.filter((c) => c.name === "capture_payment_collection").length,
    1,
  );
});
test("uncommitted capture preserves uncertain receipt and exact retry", async () => {
  const f = fixture();
  f.fail = true;
  const r = await f.send();
  assert.equal(r.status, 202);
  assert.deepEqual(await r.json(), {
    error: "Payment collection preparation unconfirmed",
    retry_requires_recovery: true,
    request_id: grant.id,
  });
  f.fail = false;
  assert.equal((await f.send()).status, 200);
});
test("different frozen arguments never turn prepare rejection into recovered success", async () => {
  for (const patch of [
    { p_amount_cents: 12346 },
    { p_source_hash: "b".repeat(64) },
    { p_expires_at: "2026-09-19T03:00:00Z" },
    { p_expires_at: "2026-09-20T03:00:00.000001Z" },
  ]) {
    const f = fixture(envelope(true));
    assert.equal((await f.send("prepare", { ...args, ...patch })).status, 409);
    assert.equal(f.configs, 0);
    assert.equal(
      f.calls.some((c) => c.name.includes("capture")),
      false,
    );
  }
});
test("strict inputs, origin and actor isolation reject before privileged capture", async () => {
  for (const patch of [
    { extra: true },
    { p_amount_cents: "12345" },
    { p_amount_cents: 49 },
    { p_expires_at: "invalid" },
  ]) {
    const f = fixture();
    assert.equal((await f.send("prepare", { ...args, ...patch })).status, 400);
    assert.equal(f.calls.length, 0);
  }
  const f = fixture(envelope(true));
  f.deps.authenticate = async () => ({
    actorId: id(9),
    db: { rpc: async () => ({ data: envelope(true), error: null }) },
  });
  assert.equal((await f.send("recover")).status, 404);
  assert.equal(
    (await fixture().send("prepare", args, { Origin: "https://other.example" }))
      .status,
    403,
  );
});
test("disabled staff flag fails closed and recovery accepts no extra arguments", async () => {
  const f = fixture();
  f.deps.enabled = false;
  assert.equal((await f.send()).status, 503);
  assert.equal(f.calls.length, 0);
  assert.equal(
    (
      await fixture().send("recover", {
        p_invoice_id: grant.invoice_id,
        token: "secret",
      })
    ).status,
    400,
  );
});
test("safe projection strips arbitrary secrets and rejects changed canonical context", async () => {
  const e = envelope(true);
  const result = await safePaymentCollection(
    {
      ...e,
      token: "p1.secret",
      capture: { ...e.capture, collection_token_hash: "secret" },
      events: [
        {
          id: id(8),
          grant_id: grant.id,
          actor_id: grant.actor_id,
          kind: "revoked",
          context_hash: null,
          created_at: grant.created_at,
          reason: "p1.secret",
        },
      ],
    },
    grant.actor_id,
    grant.invoice_id,
  );
  assert.doesNotMatch(JSON.stringify(result), /secret|token_hash|reason/);
  await assert.rejects(
    safePaymentCollection(
      {
        ...e,
        capture: {
          ...e.capture,
          capability_context: e.capture!.capability_context + " ",
        },
      },
      grant.actor_id,
      grant.invoice_id,
    ),
  );
  const ctx = JSON.stringify({
    ...JSON.parse(e.capture!.capability_context),
    token: "p1.secret",
  });
  await assert.rejects(
    safePaymentCollection(
      {
        ...e,
        capture: {
          ...e.capture,
          capability_context: ctx,
          context_hash: createHash("sha256").update(ctx).digest("hex"),
        },
      },
      grant.actor_id,
      grant.invoice_id,
    ),
  );
});

test("lost prepare acknowledgement stays uncertain until exact SQL retry succeeds", async () => {
  for (const initial of [null, envelope(true)]) {
    const f = fixture(initial);
    f.lostPrepare = true;
    const response = await f.send();
    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), {
      error: "Payment collection preparation unconfirmed",
      retry_requires_recovery: true,
      request_id: grant.id,
    });
    assert.equal(f.calls.some(call => call.name.includes("capture")), false);
    f.lostPrepare = false;
    assert.equal((await f.send()).status, 200);
    const preparations = f.calls.filter(call => call.name === "prepare_payment_collection");
    assert.equal(preparations.length, 2);
    assert.deepEqual(preparations[0].args, preparations[1].args);
  }
});
test("definite SQL preparation failures are conflicts without capture recovery override", async () => {
  for (const code of ["23505", "23514", "22023", "40001"]) {
    const f = fixture(envelope(true));
    f.prepareCode = code;
    assert.equal((await f.send()).status, 409);
    assert.equal(f.calls.filter(call => call.name === "recover_payment_collection").length, 1);
    assert.equal(f.calls.some(call => call.name.includes("capture")), false);
  }
});
