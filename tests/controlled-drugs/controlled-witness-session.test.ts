import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createWitnessRequestScope } from "../../src/hub/features/controlled-drugs/witness/request-scope.ts";
import { createWitnessClient } from "../../src/hub/features/controlled-drugs/witness/client.ts";
import { witnessBasisLabels, witnessBlockedLabels } from "../../src/hub/features/controlled-drugs/witness/labels.ts";
import { sameReviewIdentity, type ReviewIdentity } from "../../src/hub/features/controlled-drugs/record-review/raw-rpc.ts";
import { witnessFixtureFromBytes } from "./controlled-witness-fixture.ts";

test("actual witness UI scope admits new login without letting stale completion clear its busy job", () => {
  const a = { actorId: "00000000-0000-4000-8000-000000000111", sessionId: "00000000-0000-4000-8000-000000000222", generation: 1 };
  const b = { ...a, generation: 2 }, c = { ...b, sessionId: "00000000-0000-4000-8000-000000000333" }, scope = createWitnessRequestScope();
  const first = scope.begin(a)!; assert.equal(scope.begin({ ...a }), null);
  const second = scope.begin(b)!; assert.notEqual(second, null); assert.equal(scope.finish(first), false); assert.equal(scope.begin(b), null);
  const third = scope.begin(c)!; assert.equal(scope.finish(second), false); assert.equal(scope.begin(c), null);
  assert.equal(scope.finish(third), true); assert.equal(scope.finish(third), false); assert.notEqual(scope.begin(c), null);
});

test("actual raw client plus UI scope reads new-session tasks while old request is pending and refuses stale source", async () => {
  const f = witnessFixtureFromBytes(readFileSync(new URL("./record-review-stock-movement-reference.json", import.meta.url)));
  let identity: ReviewIdentity = f.identity, release: () => void = () => {}, firstReached: () => void = () => {};
  const reached = new Promise<void>(resolve => { firstReached = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
  const source = { isCurrent: (expected: Readonly<ReviewIdentity>) => sameReviewIdentity(expected, identity), async current() { return { ...identity, accessToken: "synthetic.actual.token" }; } };
  let calls = 0;
  const fetcher: typeof fetch = async () => { calls++; if (calls === 1) { firstReached(); await held; } return new Response(f.encode({ schema_version: 1, items: [f.task], next_cursor: null, has_more: false }), { headers: { "Content-Type": "application/json" } }); };
  const client = createWitnessClient({ projectRef: "a".repeat(20), url: `https://${"a".repeat(20)}.supabase.co`, publishableKey: "sb_publishable_synthetic" }, source, fetcher), scope = createWitnessRequestScope();
  const oldIdentity = identity, oldJob = scope.begin(oldIdentity)!, request = (actor_id: string) => ({ schema_version: 1 as const, actor_id, cursor: null, page_size: 25 });
  const oldResult = client.list(request(identity.actorId), oldIdentity).then(() => false, () => true);
  await reached; identity = { ...identity, generation: identity.generation + 1 }; const newJob = scope.begin(identity)!;
  const latest = await client.list(request(identity.actorId), identity); assert.equal(latest.items.length, 1); assert.equal(scope.finish(newJob), true);
  release(); assert.equal(await oldResult, true); assert.equal(scope.finish(oldJob), false); assert.equal(calls, 2);
});

test("staff labels cover the closed basis and refusal domains without exposing protocol codes", () => {
  assert.equal(witnessBasisLabels.physical_record, "Physical observation");
  assert.equal(Object.keys(witnessBasisLabels).length, 4); assert.equal(Object.keys(witnessBlockedLabels).length, 5);
  for (const [key, label] of Object.entries(witnessBlockedLabels)) { assert.notEqual(label, key); assert(!label.includes("_")); }
});
