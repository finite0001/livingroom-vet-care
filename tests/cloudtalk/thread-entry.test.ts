import assert from "node:assert/strict";
import { test } from "node:test";
import {
  callDirection,
  cloudtalkCallIds,
  cloudtalkEntryLabel,
  cloudtalkRef,
  formatCallDuration,
  summarizeCall,
  type ThreadCallDetails,
} from "../../src/hub/features/cloudtalk/thread-entry.ts";

const call = (overrides: Partial<ThreadCallDetails> = {}): ThreadCallDetails => ({
  call_uuid: "call-1",
  direction: "incoming",
  duration_seconds: 44,
  talking_seconds: 30,
  is_voicemail: false,
  recording_ready: false,
  transcript_ready: false,
  ai_summary: null,
  ...overrides,
});

test("CloudTalk references are recognised only for the cloudtalk provider", () => {
  assert.deepEqual(cloudtalkRef("cloudtalk", "message:ct-1"), { kind: "message", id: "ct-1" });
  assert.deepEqual(cloudtalkRef("cloudtalk", "call:0f5a-uuid"), { kind: "call", id: "0f5a-uuid" });
  assert.equal(cloudtalkRef("twilio", "message:ct-1"), null);
  assert.equal(cloudtalkRef("cloudtalk", "SM123"), null);
  assert.equal(cloudtalkRef("cloudtalk", null), null);
  assert.equal(cloudtalkRef(undefined, "call:x"), null);
  assert.equal(cloudtalkRef("cloudtalk", `call:${"x".repeat(201)}`), null);
});

test("call ids are collected once, sorted, from CloudTalk call entries only", () => {
  assert.deepEqual(cloudtalkCallIds([
    { provider: "cloudtalk", provider_message_id: "call:b" },
    { provider: "cloudtalk", provider_message_id: "message:m" },
    { provider: "cloudtalk", provider_message_id: "call:a" },
    { provider: "cloudtalk", provider_message_id: "call:b" },
    { provider: null, provider_message_id: null },
  ]), ["a", "b"]);
});

test("durations match the stored entry wording", () => {
  assert.equal(formatCallDuration(0), "0s");
  assert.equal(formatCallDuration(58), "58s");
  assert.equal(formatCallDuration(125), "2m 05s");
  assert.equal(formatCallDuration(3600), "60m 00s");
  assert.equal(formatCallDuration(null), null);
  assert.equal(formatCallDuration(-1), null);
  assert.equal(formatCallDuration(Number.NaN), null);
});

test("CloudTalk direction values map to thread direction", () => {
  assert.equal(callDirection("incoming"), "inbound");
  assert.equal(callDirection("OUTGOING"), "outbound");
  assert.equal(callDirection("inbound"), "inbound");
  assert.equal(callDirection("internal"), null);
  assert.equal(callDirection(null), null);
});

test("call outcomes: missed, not answered, voicemail, answered, unknown", () => {
  assert.deepEqual(summarizeCall(call({ talking_seconds: 0 })), { direction: "inbound", outcome: "missed", title: "Missed incoming call", durationText: null });
  assert.deepEqual(summarizeCall(call({ direction: "outgoing", talking_seconds: 0 })), { direction: "outbound", outcome: "not_answered", title: "Outgoing call, not answered", durationText: null });
  assert.deepEqual(summarizeCall(call({ is_voicemail: true, talking_seconds: 0, duration_seconds: 58 })), { direction: "inbound", outcome: "voicemail", title: "Voicemail", durationText: "58s" });
  assert.deepEqual(summarizeCall(call({ direction: "outgoing", talking_seconds: 125 })), { direction: "outbound", outcome: "answered", title: "Outgoing call", durationText: "2m 05s" });
  // Calls recorded before talking time was captured never claim to be missed.
  assert.deepEqual(summarizeCall(call({ talking_seconds: null, duration_seconds: 90 })), { direction: "inbound", outcome: "unknown", title: "Incoming call", durationText: "1m 30s" });
});

test("entry labels distinguish client texts, CloudTalk Phone sends and calls", () => {
  assert.equal(cloudtalkEntryLabel({ kind: "message", id: "1" }, "CLIENT"), "Text via CloudTalk");
  assert.equal(cloudtalkEntryLabel({ kind: "message", id: "1" }, "STAFF"), "Sent from CloudTalk Phone");
  assert.equal(cloudtalkEntryLabel({ kind: "call", id: "1" }, "CLIENT"), "CloudTalk call");
  assert.equal(cloudtalkEntryLabel(null, "CLIENT"), null);
});

test("admin retry results are trusted only when well formed", async () => {
  const { retryResult } = await import("../../src/hub/features/cloudtalk/thread-entry.ts");
  assert.deepEqual(retryResult([{ projected: 2, still_failing: 1 }]), { projected: 2, still_failing: 1 });
  assert.equal(retryResult([]), null);
  assert.equal(retryResult(null), null);
  assert.equal(retryResult([{ projected: "2", still_failing: 1 }]), null);
  assert.equal(retryResult({ projected: 2, still_failing: 1 }), null);
});
