import assert from "node:assert/strict";
import { test } from "node:test";
import { createReviewStaffSessions } from "../../src/hub/features/controlled-drugs/record-review/staff-session.ts";

const actor = "10000000-0000-4000-8000-000000000001", sessionId = "10000000-0000-4000-8000-000000000002";
const other = "10000000-0000-4000-8000-000000000003";
// Grammar fixtures only. Real RPCs verify actual tokens and current privileges.
function sdk(sub = actor, session = sessionId, exp = 10, role = "authenticated") {
  return { access_token: "e30." + Buffer.from(JSON.stringify({ sub, session_id: session, exp, role })).toString("base64url") + ".c3ludGFjdGlj",
    user: { id: sub, user_metadata: { role: "ADMIN" } } };
}
test("review source needs current staff verification and keeps credentials out of snapshots", async t => {
  const broker = createReviewStaffSessions({ now: () => 0 }); t.after(broker.clear);
  const identity = broker.offer(sdk()); assert.ok(identity);
  assert.equal(broker.source.getSnapshot(), null); assert.equal(await broker.source.current(), null);
  assert.equal(broker.allow(identity, true), true);
  assert.deepEqual(Object.keys(broker.source.getSnapshot()!).sort(), ["actorId", "generation", "sessionId"]);
  assert.ok(Object.isFrozen(broker.source.getSnapshot()));
  assert.equal((await broker.source.current())!.accessToken, sdk().access_token);
});
test("a new session immediately hides old evidence and rejects a late old staff result", async t => {
  const broker = createReviewStaffSessions({ now: () => 0 }); t.after(broker.clear);
  const old = broker.offer(sdk()); broker.allow(old, true);
  let invalidated = false; const off = broker.source.subscribe(() => { invalidated ||= broker.source.getSnapshot() === null; }); t.after(off);
  const next = broker.offer(sdk(actor, other));
  assert.equal(invalidated, true); assert.equal(broker.source.isCurrent(old!), false);
  assert.equal(broker.allow(old, true), false); assert.equal(await broker.source.current(), null);
  assert.equal(broker.allow(next, true), true); assert.equal(broker.source.getSnapshot()!.sessionId, other);
});
test("refresh and explicit access revalidation require a new matching profile check", t => {
  const broker = createReviewStaffSessions({ now: () => 0 }); t.after(broker.clear);
  const old = broker.offer(sdk()); broker.allow(old, true);
  const refreshed = broker.offer(sdk(actor, sessionId, 20));
  assert.equal(broker.source.isCurrent(old!), false); assert.equal(broker.source.getSnapshot(), null);
  broker.allow(refreshed, true);
  const checked = broker.revalidate(); assert.equal(broker.source.getSnapshot(), null);
  assert.equal(broker.allow(refreshed, true), false); assert.equal(broker.allow(checked, true), true);
});
test("logout invalidation is immediate and cannot be undone by an old response", async t => {
  const broker = createReviewStaffSessions({ now: () => 0 }); t.after(broker.clear);
  const old = broker.offer(sdk()); broker.allow(old, true); broker.clear();
  assert.equal(broker.allow(old, true), false); assert.equal(broker.revalidate(), null);
  assert.equal(await broker.source.current(), null); assert.equal(broker.source.getSnapshot(), null);
});
test("logout intent blocks late SDK refresh/sign-in events until explicit successful sign-in", t => {
  const broker = createReviewStaffSessions({ now: () => 0 }); t.after(broker.clear);
  const old = broker.offer(sdk()); broker.allow(old, true); broker.suspend();
  assert.equal(broker.offer(sdk(actor, other, 20)), null);
  assert.equal(broker.allow(old, true), false); assert.equal(broker.revalidate(), null);
  assert.equal(broker.source.getSnapshot(), null);
  const signedIn = broker.resume(sdk(actor, other, 20));
  assert.equal(broker.source.getSnapshot(), null); assert.equal(broker.allow(signedIn, true), true);
});
test("expired identity stays hidden even before the timer runs and after a clock reversal", async t => {
  let now = 0; const broker = createReviewStaffSessions({ now: () => now }); t.after(broker.clear);
  const identity = broker.offer(sdk()); broker.allow(identity, true); now = 10000;
  assert.equal(broker.source.getSnapshot(), null); now = 0;
  assert.equal(broker.source.isCurrent(identity!), false); assert.equal(await broker.source.current(), null);
});
test("malformed, privileged or mismatched SDK tokens clear the previous identity", t => {
  const broker = createReviewStaffSessions({ now: () => 0 }); t.after(broker.clear);
  for (const input of [null, {}, sdk(actor, sessionId, 10, "service_role"), sdk(actor, sessionId, 0),
    { ...sdk(), user: { id: other } }, { ...sdk(), access_token: "PRIVATE_MALFORMED_TOKEN" }]) {
    broker.allow(broker.offer(sdk()), true);
    assert.equal(broker.offer(input), null); assert.equal(broker.source.getSnapshot(), null);
  }
});
test("observer exceptions cannot prevent other consumers from receiving invalidation", t => {
  const broker = createReviewStaffSessions({ now: () => 0 }); t.after(broker.clear);
  const off = broker.source.subscribe(() => { throw undefined; }); t.after(off);
  let seen = 0; const off2 = broker.source.subscribe(() => { seen++; }); t.after(off2);
  const identity = broker.offer(sdk()); broker.allow(identity, true); broker.clear();
  assert.equal(seen, 3); assert.equal(broker.source.getSnapshot(), null);
});
test("an identical SDK focus event preserves identity without reviving denied access", t => {
  const broker = createReviewStaffSessions({ now: () => 0 }); t.after(broker.clear);
  const identity = broker.offer(sdk()); broker.allow(identity, true);
  assert.equal(broker.offer(sdk()), identity); assert.equal(broker.source.isCurrent(identity!), true);
  broker.allow(identity, false);
  const denied = broker.offer(sdk());
  assert.notEqual(denied!.generation, identity!.generation); assert.equal(broker.source.getSnapshot(), null);
  assert.equal(broker.allow(identity, true), false);
  broker.allow(denied, true); assert.equal(broker.source.isCurrent(identity!), false);
});
test("invalid clocks refuse identity and timer construction without exposing errors", t => {
  const broker = createReviewStaffSessions({ now: () => { throw new Error("PRIVATE_CLOCK_ERROR"); } }); t.after(broker.clear);
  assert.equal(broker.offer(sdk()), null); assert.equal(broker.source.getSnapshot(), null);
});
