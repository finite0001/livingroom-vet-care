import assert from "node:assert/strict";
import { test } from "node:test";
import {
  readReconciliationRun,
  reconciliationRequestSchema,
  reconciliationRunSchema,
  type ReconciliationRun,
} from "../../supabase/functions/_shared/operational-reconciliation-contract.ts";
import {
  createOperationalReconciliationHandler,
  type ReconciliationDatabase,
  type ReconciliationEnvironment,
} from "../../supabase/functions/_shared/operational-reconciliation-handler.ts";

const runId = "74000000-0000-4000-8000-000000000001";
const nextId = "74000000-0000-4000-8000-000000000002";
const key = "sb_secret_owned_synthetic_test";
const env: ReconciliationEnvironment = {
  SUPABASE_SECRET_KEYS: JSON.stringify({ owned: key }),
  SUPABASE_SERVICE_ROLE_KEY: "synthetic-legacy-key",
  OPERATIONAL_RECONCILIATION_ENABLED: "true",
  APP_ENV: "staging",
};
function run(overrides: Partial<ReconciliationRun> = {}): ReconciliationRun {
  return {
    run_id: runId, requested_limit: 5, policy_version: 1,
    window_from: "2026-10-14T00:00:00Z", window_until: "2026-10-15T00:00:00Z",
    fan_out_limit: 64, budget_ms: 5000, sweep_id: nextId,
    sweep_started_at: "2026-10-14T01:00:00.000001Z", checkpoint_version: 0,
    before: { lane: "appointment", after_id: null }, started_at: "2026-10-14T01:00:00.000002Z",
    outcome: "completed", finished_at: "2026-10-14T01:00:01Z",
    counts: { examined: 2, generated: 1, revised: 2, unresolved: 1 },
    checkpoint: { version: 1, lane: "use", after_id: null },
    sweep_complete: false, failure_code: null, ...overrides,
  };
}
const started = () => run({ outcome: "started", finished_at: null, counts: null, checkpoint: null, sweep_complete: null });
function request(body = JSON.stringify({ run_id: runId }), headers: Record<string, string> = {}) {
  return new Request("https://owned.example.test/reconcile", { method: "POST", headers: { apikey: key, ...headers }, body });
}
interface Call { name: string; args: Record<string, unknown>; }
function fixture(
  responses: Array<{ data: unknown; error: unknown } | Error>,
  configuration = env,
) {
  const calls: Call[] = [];
  let clients = 0;
  const handler = createOperationalReconciliationHandler(configuration, (credential) => {
    clients++;
    assert.equal(credential, key);
    const database: ReconciliationDatabase = {
      rpc: async (name, args) => {
        calls.push({ name, args });
        const response = responses.shift();
        assert.ok(response, "Unexpected database invocation");
        if (response instanceof Error) throw response;
        return response;
      },
    };
    return database;
  });
  return { handler, calls, clients: () => clients };
}
const ok = (data: unknown) => ({ data, error: null });

test("disabled handler creates no database client or run", async () => {
  const f = fixture([], { ...env, OPERATIONAL_RECONCILIATION_ENABLED: "false" });
  assert.deepEqual(await (await f.handler(request())).json(), { disabled: true, reconciled: false });
  assert.equal(f.clients(), 0);
});
test("missing environment opt-in also creates no client", async () => {
  const f = fixture([], { ...env, OPERATIONAL_RECONCILIATION_ENABLED: undefined });
  assert.equal((await f.handler(request())).status, 200);
  assert.equal(f.clients(), 0);
});
test("unknown environment fails before database creation", async () => {
  const f = fixture([], { ...env, APP_ENV: "development" });
  assert.equal((await f.handler(request())).status, 503);
  assert.equal(f.clients(), 0);
});
test("non-POST cannot inspect or execute a run", async () => {
  const f = fixture([]);
  assert.equal((await f.handler(new Request("https://owned.example.test/reconcile"))).status, 405);
  assert.equal(f.clients(), 0);
});
test("explicit bad API key cannot fall back to a valid bearer", async () => {
  const f = fixture([]);
  assert.equal((await f.handler(request("{}", { apikey: "sb_secret_wrong", Authorization: "Bearer synthetic-legacy-key" }))).status, 401);
  assert.equal(f.clients(), 0);
});
test("anonymous requests cannot discover whether the worker is enabled", async () => {
  const f = fixture([], { ...env, OPERATIONAL_RECONCILIATION_ENABLED: "false" });
  assert.equal((await f.handler(new Request("https://owned.example.test/reconcile", { method: "POST", body: "{}" }))).status, 401);
  assert.equal(f.clients(), 0);
});

for (const body of ["null", "[]", "{", '{"limit":"5"}', '{"limit":1.5}', '{"limit":0}', '{"limit":26}', '{"run_id":"not-a-uuid"}', '{"patient_id":"private"}']) {
  test(`invalid request ${body} makes no database call`, async () => {
    const f = fixture([]);
    assert.equal((await f.handler(request(body))).status, 400);
    assert.equal(f.clients(), 0);
  });
}
test("body limit measures UTF-8 bytes rather than characters", async () => {
  const f = fixture([]);
  assert.equal((await f.handler(request(JSON.stringify({ ignored: "é".repeat(600) })))).status, 413);
  assert.equal(f.clients(), 0);
});
test("malformed UTF-8 fails closed", async () => {
  const f = fixture([]);
  const response = await f.handler(new Request("https://owned.example.test/reconcile", { method: "POST", headers: { apikey: key }, body: new Uint8Array([0xff]) }));
  assert.equal(response.status, 400);
  assert.equal(f.clients(), 0);
});
test("database pause stops after start without executing", async () => {
  const f = fixture([ok({ disabled: true })]);
  const response = await f.handler(request());
  assert.deepEqual(await response.json(), { disabled: true, reconciled: false });
  assert.deepEqual(f.calls.map((c) => c.name), ["start_operational_reconciliation_run"]);
});
test("completed UUID replay does not execute materialization again", async () => {
  const f = fixture([ok(run())]);
  const response = await f.handler(request());
  assert.equal(response.status, 200);
  assert.equal((await response.json()).reconciled, true);
  assert.equal(f.calls.length, 1);
});
test("ordinary execution binds the same run and limit at both boundaries", async () => {
  const f = fixture([ok(started()), ok(run())]);
  const response = await f.handler(request());
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal((await response.json()).outcome, "completed");
  assert.deepEqual(f.calls, [
    { name: "start_operational_reconciliation_run", args: { p_run_id: runId, p_limit: 5 } },
    { name: "execute_operational_reconciliation_run", args: { p_run_id: runId, p_limit: 5 } },
  ]);
});
test("lost start acknowledgment recovers without starting execution", async () => {
  const f = fixture([new Error("start ACK lost"), ok(started())]);
  const response = await f.handler(request());
  const body = await response.json();
  assert.equal(response.status, 202);
  assert.equal(body.outcome, "started");
  assert.equal(body.counts, null);
  assert.equal(body.reconciled, false);
  assert.deepEqual(f.calls.map((c) => c.name), ["start_operational_reconciliation_run", "recover_operational_reconciliation_run"]);
});
test("lost committed execution acknowledgment reads the original result", async () => {
  const f = fixture([ok(started()), new Error("execute ACK lost"), ok(run())]);
  const response = await f.handler(request());
  assert.equal((await response.json()).outcome, "completed");
  assert.deepEqual(f.calls.map((c) => c.name), ["start_operational_reconciliation_run", "execute_operational_reconciliation_run", "recover_operational_reconciliation_run"]);
  assert.deepEqual(f.calls[2].args, f.calls[1].args);
});
test("missing recovery remains unknown without invented zero counts", async () => {
  const f = fixture([new Error("private failure"), ok(null)]);
  const response = await f.handler(request());
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { run_id: runId, requested_limit: 5, outcome: "unknown", reconciled: false });
});
test("recovery error never leaks provider or credential details", async () => {
  const f = fixture([new Error(key), { data: null, error: new Error("private patient details") }]);
  const response = await f.handler(request());
  const text = await response.text();
  assert.ok(!text.includes(key) && !text.includes("private patient"));
  assert.equal(response.status, 202);
});
test("wrong run identity from recovery stays unknown", async () => {
  const f = fixture([new Error("lost"), ok(run({ run_id: nextId }))]);
  assert.equal((await (await f.handler(request())).json()).outcome, "unknown");
});
test("wrong captured request limit cannot masquerade as recovered result", async () => {
  const f = fixture([new Error("lost"), ok(run({ requested_limit: 4 }))]);
  assert.equal((await (await f.handler(request())).json()).outcome, "unknown");
});
test("changed captured policy or cursor cannot masquerade as execution or recovery", async () => {
  const altered = run({ policy_version: 2 });
  const f = fixture([ok(started()), ok(altered), ok(altered)]);
  assert.equal((await (await f.handler(request())).json()).outcome, "unknown");
  assert.equal(f.calls.filter((call) => call.name === "execute_operational_reconciliation_run").length, 1);
});
test("failed and paused receipts retain null counts and no checkpoint", async () => {
  for (const outcome of ["failed", "paused"] as const) {
    const stopped = run({ outcome, counts: null, checkpoint: null, sweep_complete: null, failure_code: outcome === "failed" ? "batch_transaction_rolled_back" : "policy_changed" });
    const f = fixture([ok(stopped)]);
    const body = await (await f.handler(request())).json();
    assert.equal(body.reconciled, false);
    assert.equal(body.counts, null);
    assert.equal(body.checkpoint, null);
    assert.equal(f.calls.length, 1);
  }
});

interface Counterexample { name: string; value: unknown; }
const valid = run();
const examples: Counterexample[] = [
  { name: "uncommitted counts", value: { ...started(), counts: valid.counts } },
  { name: "missing committed checkpoint", value: { ...valid, checkpoint: null } },
  { name: "unresolved exceeds examined", value: { ...valid, counts: { ...valid.counts, unresolved: 3 } } },
  { name: "source cap exceeded", value: { ...valid, counts: { ...valid.counts, examined: 6 } } },
  { name: "fan-out cap exceeded", value: { ...valid, counts: { examined: 1, generated: 64, revised: 1, unresolved: 0 } } },
  { name: "skipped checkpoint", value: { ...valid, checkpoint: { ...valid.checkpoint, version: 2 } } },
  { name: "false completed sweep", value: { ...valid, sweep_complete: true } },
  { name: "backwards source lane", value: { ...valid, before: { lane: "use", after_id: null }, checkpoint: { version: 1, lane: "appointment", after_id: null } } },
  { name: "unchanged continuation", value: { ...valid, before: { lane: "use", after_id: nextId }, checkpoint: { version: 1, lane: "use", after_id: nextId } } },
  { name: "missing first continuation", value: { ...valid, checkpoint: { version: 1, lane: "appointment", after_id: null } } },
  { name: "empty unfinished batch", value: { ...valid, counts: { examined: 0, generated: 0, revised: 0, unresolved: 0 } } },
  { name: "finish before start by one microsecond", value: { ...valid, finished_at: "2026-10-14T01:00:00.000001Z" } },
  { name: "sweep after start by one microsecond", value: { ...valid, sweep_started_at: "2026-10-14T01:00:00.000003Z" } },
  { name: "unbounded appointment window", value: { ...valid, window_until: "2026-12-01T00:00:00Z" } },
  { name: "hidden patient payload", value: { ...valid, patient_name: "Private" } },
];
for (const example of examples) {
  test(`receipt rejects ${example.name}`, () => assert.equal(reconciliationRunSchema.safeParse(example.value).success, false));
}
test("completed empty sweep has a committed checkpoint and explicit end", () => {
  const empty = run({ counts: { examined: 0, generated: 0, revised: 0, unresolved: 0 }, checkpoint: { version: 1, lane: "complete", after_id: null }, sweep_complete: true });
  assert.ok(readReconciliationRun(empty, runId, 5));
});
test("equivalent offset timestamps retain microsecond ordering", () => {
  const equivalent = run({ finished_at: "2026-10-13T19:00:00.000003-06:00" });
  assert.ok(readReconciliationRun(equivalent, runId, 5));
});
test("request UUID normalization preserves PostgreSQL identity", () => {
  assert.equal(reconciliationRequestSchema.parse({ run_id: "74ABCDEF-0000-4000-8000-000000000001" }).run_id, "74abcdef-0000-4000-8000-000000000001");
});
test("malformed receipt timestamp returns invalid rather than throwing during BigInt comparison", () => {
  assert.equal(reconciliationRunSchema.safeParse(run({ window_from: "not-a-time" })).success, false);
  assert.equal(readReconciliationRun(run({ started_at: "not-a-time" }), runId, 5), null);
});
