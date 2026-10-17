import assert from "node:assert/strict";
import test from "node:test";
import { callCaptureIntentSchema, callProviderIdSchema, callProviderPageSchema } from "../../supabase/functions/_shared/clinical-call-model.ts";
import { page } from "./fixtures.ts";
test("documented REST caller/segment fields and exact safe provider identity are required", () => {
  assert.doesNotThrow(() => callProviderPageSchema.parse(page()));
  for (const id of ["0", "700013/else", "9007199254740992", "123456789012345678"]) assert.throws(() => callProviderIdSchema.parse(id));
  for (const mutate of [
    (p: ReturnType<typeof page>) => { p.data.callId = 9007199254740992; },
    (p: ReturnType<typeof page>) => { p.data.segments[0].caller = "unknown speaker"; },
    (p: ReturnType<typeof page>) => { p.data.segments[0].end = -1; },
    (p: ReturnType<typeof page>) => { p.data.callers.push(p.data.callers[0]); },
  ]) { const p = page(); mutate(p); assert.throws(() => callProviderPageSchema.parse(p)); }
  const incomplete = page() as unknown as { data: { segments: Record<string, unknown>[] } }; delete incomplete.data.segments[0].end;
  assert.throws(() => callProviderPageSchema.parse(incomplete));
});
test("capture intent cannot accept pasted transcript, provider URL or patient inference", () => {
  const intent = { pet_id: crypto.randomUUID(), expected_pet_version: 1, encounter_id: crypto.randomUUID(), expected_encounter_version: 1, inbound_id: crypto.randomUUID(), expected_inbound_version: 1, policy_version: 2, attest_authorized: true };
  assert.doesNotThrow(() => callCaptureIntentSchema.parse(intent));
  for (const extra of [{ transcript: "Pretend fetched" }, { provider_call_id: "700013" }, { url: "https://hostile.invalid" }]) assert.throws(() => callCaptureIntentSchema.parse({ ...intent, ...extra }));
});
