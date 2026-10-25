import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createReviewWorkspace } from "../../src/hub/features/controlled-drugs/record-review/workspace.ts";
import { createReviewLifecycle } from "../../src/hub/features/controlled-drugs/record-review/lifecycle.ts";
import { decodeExactJson, ExactJsonNumber, type ExactJson } from "../../src/hub/features/controlled-drugs/record-review/exact-json.ts";
import { reviewRequiredPacketSchema } from "../../src/hub/features/controlled-drugs/record-review/prepared-packet.ts";
import { verifyProspectiveStockMovement } from "../../src/hub/features/controlled-drugs/record-review/prospective-stock-movement.ts";
import type { ReviewDetailEvidenceAdmission } from "../../src/hub/features/controlled-drugs/record-review/read-detail.ts";
import type { ReviewStaffSessionSource } from "../../src/hub/features/controlled-drugs/record-review/staff-session.ts";
import { sameReviewIdentity, type ReviewIdentity } from "../../src/hub/features/controlled-drugs/record-review/raw-rpc.ts";
import type { ReviewQueueRequest } from "../../src/hub/features/controlled-drugs/record-review/queue-model.ts";
import { memoryPointers, deferred, other, session, syntheticEvidence } from "./record-review-lifecycle-fixture.ts";

interface MutableObject { [key: string]: MutableJson }
type MutableJson = null | boolean | string | ExactJsonNumber | MutableJson[] | MutableObject;
const obj = (value: MutableJson) => value as MutableObject;
function clone(value: ExactJson): MutableJson {
  if (value === null || typeof value !== "object" || value instanceof ExactJsonNumber) return value;
  if (Array.isArray(value)) return value.map(clone);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
}
/** DTO-only conversion of the unchanged PG17.6 packet, not Auth/server proof. */
function reference() {
  const saved = obj(clone(decodeExactJson(readFileSync(new URL("./record-review-stock-movement-reference.json", import.meta.url)))));
  const packet = obj(obj(saved.data).packet), event = obj(packet.event), adapter = obj(packet.adapter);
  const auth = obj(packet.current_authorization), historical = obj(obj(packet.obligation).historical);
  const identity: ReviewIdentity = { actorId: String(obj(auth.read).actor_id), sessionId: session, generation: 1 };
  const summary: MutableObject = { event_id: event.id, event_sequence: String(event.sequence), event_kind: event.event_kind,
    site_basis: adapter.site_basis, site_id: adapter.site_id, observed_at: event.observed_at, recorded_at: event.recorded_at,
    review_state: "awaiting_review", deadline_state: historical.deadline_basis, deadline_basis: historical.deadline_basis,
    due_at: historical.due_at, unavailable_reason: historical.unavailable_reason, signing_state: "available", signing_reason: "none" };
  const detail: MutableObject = { version: new ExactJsonNumber("3"), state: "detail", data: { summary, packet, terminal_review: null,
    escalations: [], derived_escalation_reasons: [], policy_id: obj(auth.policy).id, read_eligibility_id: obj(auth.read).id,
    review_eligibility_id: obj(auth.review).id } };
  const page: MutableObject = { version: new ExactJsonNumber("3"), state: "page", data: { items: [summary], next_cursor: null,
    high_water: String(event.sequence), examined: new ExactJsonNumber("1"), coverage: "bounded_page" } };
  const request = { actor_id: identity.actorId, product_id: String(obj(packet.target).product_id), site_id: String(adapter.site_id),
    event_kind: String(event.event_kind), view: "site", page_size: 1, cursor: null } as ReviewQueueRequest;
  return { packet, summary, detail, page, request, identity, eventId: String(event.id) };
}
const stockAdmission: ReviewDetailEvidenceAdmission = { async validate(result, request) {
  if (result.state !== "detail") throw new Error("Stock fixture only");
  await verifyProspectiveStockMovement(reviewRequiredPacketSchema.parse(result.data.packet), request);
} };
function setup(options: { admission?: ReviewDetailEvidenceAdmission; reply?: () => Promise<ExactJson> } = {}) {
  const f = reference(), listeners = new Set<() => void>(), calls: string[] = [], mutations: string[] = [];
  let current: ReviewIdentity | null = f.identity;
  const sessions: ReviewStaffSessionSource = { getSnapshot: () => current, isCurrent: identity => sameReviewIdentity(current, identity),
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; }, async current() { return null; } };
  const storage = memoryPointers();
  const model = createReviewLifecycle({ pointers: storage.pointers, evidence: syntheticEvidence,
    rpc: { async call(method) { mutations.push(method); throw new Error("No implicit mutation permitted"); } } });
  const workspace = createReviewWorkspace({ sessions, model, evidence: options.admission ?? stockAdmission,
    reads: { async call(method) { calls.push(method); return method === "list_controlled_record_reviews_v3" ? f.page as ExactJson :
      options.reply ? options.reply() : f.detail as ExactJson; } } });
  function change(next: ReviewIdentity | null, notify = true) { current = next; if (notify) for (const listener of listeners) listener(); }
  return { ...f, workspace, model, calls, mutations, storage, change, listeners };
}

test("connecting and reloading a session never reads, prepares or signs automatically", async () => {
  const f = setup(); assert.equal(f.workspace.getSnapshot().identity, null);
  const off = f.workspace.connect(); assert.equal(f.workspace.getSnapshot().identity?.actorId, f.identity.actorId);
  assert.deepEqual(f.calls, []); assert.deepEqual(f.mutations, []); assert.equal(f.storage.values.size, 0);
  off(); assert.equal(f.workspace.getSnapshot().identity, null); assert.equal(f.model.getSnapshot().phase, "signed_out");
  f.workspace.connect(); assert.deepEqual(f.calls, []); assert.throws(() => f.workspace.connect()); f.workspace.disconnect();
});

test("only an opened current page row yields the exact five preparation IDs", async () => {
  const f = setup(); f.workspace.connect();
  assert.equal(await f.workspace.openRecord(f.eventId), false); assert.deepEqual(f.calls, []);
  assert.equal(await f.workspace.refresh(f.request), true);
  assert.equal(await f.workspace.openRecord(other), false); assert.equal(f.calls.length, 1);
  assert.equal(await f.workspace.openRecord(f.eventId), true);
  const d = f.workspace.getSnapshot().detail!;
  assert.deepEqual(Object.keys(d.selection!).sort(), ["actor_id", "event_id", "policy_id", "read_eligibility_id", "review_eligibility_id"]);
  assert.equal(d.selection?.event_id, f.eventId); assert.ok(Object.isFrozen(d.response.data));
  assert.deepEqual(f.mutations, []); assert.equal(f.storage.values.size, 0); f.workspace.disconnect();
});

test("logout clears model before any workspace observer can see another actor", async () => {
  const f = setup(); f.workspace.connect(); await f.workspace.refresh(f.request); await f.workspace.openRecord(f.eventId);
  const seen: string[] = [];
  f.model.subscribe(() => {
    seen.push(f.model.getSnapshot().phase);
    assert.equal(f.workspace.getSnapshot().detail, undefined);
    assert.equal(f.workspace.getSnapshot().identity, null);
  });
  f.change(null); assert.equal(f.workspace.getSnapshot().detail, undefined);
  assert.deepEqual(seen, ["signed_out"]); assert.deepEqual(f.mutations, []);
});

test("a session change during evidence admission discards the old result", async () => {
  const entered = deferred<void>(), release = deferred<void>();
  const f = setup({ admission: { async validate(result, request) {
    await stockAdmission.validate(result, request); entered.resolve(); await release.promise;
  } } });
  f.workspace.connect(); await f.workspace.refresh(f.request); const old = f.workspace.openRecord(f.eventId);
  await entered.promise; f.change({ ...f.identity, sessionId: other, generation: 2 }); release.resolve();
  assert.equal(await old, false); const state = f.workspace.getSnapshot();
  assert.equal(state.identity?.generation, 2); assert.equal(state.detail, undefined); assert.equal(state.queue.page, undefined);
  f.workspace.disconnect();
});

test("disconnect and reconnect cannot admit a response from the prior lifetime", async () => {
  const pending = deferred<ExactJson>(), f = setup({ reply: () => pending.promise });
  const off = f.workspace.connect(); await f.workspace.refresh(f.request); const old = f.workspace.openRecord(f.eventId);
  off(); f.workspace.connect(); off(); assert.ok(f.workspace.getSnapshot().identity);
  pending.resolve(f.detail as ExactJson); assert.equal(await old, false); assert.equal(f.workspace.getSnapshot().detail, undefined);
  f.workspace.disconnect(); assert.equal(f.listeners.size, 0);
});

test("a page refresh invalidates an in-flight detail without cancelling or signing", async () => {
  const pending = deferred<ExactJson>(), f = setup({ reply: () => pending.promise });
  f.workspace.connect(); await f.workspace.refresh(f.request); const old = f.workspace.openRecord(f.eventId);
  assert.equal(await f.workspace.refresh(f.request), true); pending.resolve(f.detail as ExactJson);
  assert.equal(await old, false); assert.equal(f.workspace.getSnapshot().detailPhase, "idle"); assert.deepEqual(f.mutations, []);
  f.workspace.disconnect();
});

test("changed detail summary or product cannot acquire a signing selection", async () => {
  for (const change of ["summary", "product"] as const) {
    let admitted = 0;
    const f = setup({ admission: { async validate(result, request) {
      await stockAdmission.validate(result, request); admitted++;
    } } }); f.workspace.connect();
    if (change === "product") f.request.product_id = other;
    if (change === "summary") obj(f.page.data).items = [{ ...f.summary, recorded_at: "2026-10-20T00:00:00.000000Z" }];
    await f.workspace.refresh(f.request);
    assert.equal(await f.workspace.openRecord(f.eventId), false); assert.equal(f.workspace.getSnapshot().detail, undefined);
    assert.equal(admitted, 1); // Internally valid detail still differs from the opened page.
    assert.equal(f.workspace.getSnapshot().detailPhase, "unavailable"); f.workspace.disconnect();
  }
});

test("private admission errors are replaced with safe copy and no fallback selection", async () => {
  const f = setup({ admission: { validate() { throw new Error("PRIVATE_RECORD_PAYLOAD"); } } });
  f.workspace.connect(); await f.workspace.refresh(f.request); assert.equal(await f.workspace.openRecord(f.eventId), false);
  assert.equal(f.workspace.getSnapshot().detail, undefined); assert.ok(!JSON.stringify(f.workspace.getSnapshot()).includes("PRIVATE"));
  assert.deepEqual(f.mutations, []); f.workspace.disconnect();
});

test("expired broker identity masks cached evidence even before its notification", async () => {
  const f = setup(); f.workspace.connect(); await f.workspace.refresh(f.request); await f.workspace.openRecord(f.eventId);
  let notices = 0; f.workspace.subscribe(() => { notices++; }); f.change(null, false);
  const mask = f.workspace.getSnapshot(); assert.equal(mask.identity, null); assert.equal(mask.detail, undefined);
  assert.equal(f.workspace.getSnapshot(), mask); assert.equal(notices, 0);
  assert.equal(await f.workspace.openRecord(f.eventId), false); assert.equal(f.model.getSnapshot().phase, "signed_out");
  f.workspace.disconnect();
});

test("reentrant identity changes and failed observers cannot revive old evidence", async () => {
  const f = setup(); f.workspace.connect(); await f.workspace.refresh(f.request); await f.workspace.openRecord(f.eventId);
  let switched = false;
  f.model.subscribe(() => {
    if (!switched && f.model.getSnapshot().phase === "signed_out") {
      switched = true; f.change({ ...f.identity, generation: 3 });
    }
  });
  f.workspace.subscribe(() => { throw new Error("Observer failure"); });
  f.change({ ...f.identity, generation: 2 });
  assert.equal(f.workspace.getSnapshot().identity?.generation, 3); assert.equal(f.workspace.getSnapshot().detail, undefined);
  assert.equal(f.workspace.getSnapshot().queue.phase, "idle"); f.workspace.disconnect();
});

test("an observer cannot rebase an old refresh or continuation onto a revalidated session", async () => {
  for (const navigation of ["refresh", "nextPage"] as const) {
    const f = setup();
    if (navigation === "nextPage") {
      const auth = obj(f.packet.current_authorization), read = obj(auth.read);
      obj(f.page.data).high_water = "2";
      obj(f.page.data).next_cursor = { version: new ExactJsonNumber("3"), actor_id: f.identity.actorId,
        product_id: f.request.product_id, site_id: f.request.site_id, event_kind: f.request.event_kind, view: "site",
        after_sequence: "1", high_water: "2", read_eligibility_id: read.id, read_authorization_hash: read.record_hash };
    }
    f.workspace.connect(); await f.workspace.refresh(f.request); await f.workspace.openRecord(f.eventId);
    let changed = false;
    f.workspace.subscribe(() => {
      if (!changed && f.workspace.getSnapshot().detailPhase === "idle") {
        changed = true; f.change({ ...f.identity, generation: 2 });
      }
    });
    assert.equal(await (navigation === "refresh" ? f.workspace.refresh(f.request) : f.workspace.nextPage()), false);
    assert.equal(changed, true); assert.equal(f.workspace.getSnapshot().identity?.generation, 2);
    assert.deepEqual(f.calls, ["list_controlled_record_reviews_v3", "get_controlled_record_review_event_v3"]);
    f.workspace.disconnect();
  }
});

test("parsing a caller getter cannot dispatch an old list after a newer detail intent", async () => {
  const pending = deferred<ExactJson>(), f = setup({ reply: () => pending.promise });
  f.workspace.connect(); await f.workspace.refresh(f.request);
  let newer: Promise<boolean> | undefined;
  const input = { ...f.request, get site_id() { newer = f.workspace.openRecord(f.eventId); return f.request.site_id; } };
  assert.equal(await f.workspace.refresh(input), false);
  assert.deepEqual(f.calls, ["list_controlled_record_reviews_v3", "get_controlled_record_review_event_v3"]);
  assert.equal(f.workspace.getSnapshot().detailPhase, "loading");
  pending.resolve(f.detail as ExactJson); assert.equal(await newer, true);
  assert.equal(f.workspace.getSnapshot().detailPhase, "ready"); f.workspace.disconnect();
});

test("changing the read scope preserves the original minimal owned recovery operation", async () => {
  const f = setup(), pointer = { version: 3 as const, actor_id: f.identity.actorId, operation_id: other, transport_digest: "a".repeat(64) };
  await f.storage.pointers.reserve(pointer); f.workspace.connect();
  assert.equal(f.model.getSnapshot().phase, "recoverable");
  assert.equal(await f.workspace.refresh({ ...f.request, product_id: other }), true);
  assert.deepEqual(f.model.getSnapshot().pointer, pointer); assert.deepEqual(f.storage.pointers.read(f.identity.actorId), pointer);
  assert.equal(f.workspace.getSnapshot().detail, undefined); assert.deepEqual(f.mutations, []);
  f.workspace.disconnect(); assert.deepEqual(f.storage.pointers.read(f.identity.actorId), pointer);
});

test("an older disconnect cannot erase ownership of a reentrant new connection", () => {
  const f = setup(), first = f.workspace.connect(); let reconnected = false;
  f.model.subscribe(() => {
    if (!reconnected && f.model.getSnapshot().phase === "signed_out") {
      reconnected = true; f.workspace.connect();
    }
  });
  first(); assert.equal(reconnected, true); assert.equal(f.listeners.size, 1);
  f.workspace.disconnect(); assert.equal(f.listeners.size, 0); assert.equal(f.workspace.getSnapshot().identity, null);
});
