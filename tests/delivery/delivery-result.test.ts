import test from "node:test";
import assert from "node:assert/strict";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { deliveryErrorNote, isDeliveryAccepted } from "../../src/hub/lib/delivery-result.ts";

test("only confirmed provider acceptance clears a draft", () => {
  assert.equal(isDeliveryAccepted({ accepted: true, success: true }), true);
  for (const value of [null, undefined, {}, { accepted: false }, { accepted: true, success: false }, { accepted: true, acceptance_unknown: true }]) assert.equal(isDeliveryAccepted(value), false);
});

test("HTTP audit failures and transport uncertainty warn before retrying", async () => {
  const acceptedError = new FunctionsHttpError(new Response(JSON.stringify({ accepted: true, error: "Audit save failed" }), { status: 500 }));
  assert.match(await deliveryErrorNote(acceptedError), /provider may have accepted.*Check provider activity before retrying/);
  const unknownError = new FunctionsHttpError(new Response(JSON.stringify({ acceptance_unknown: true, note: "Outcome unknown" }), { status: 500 }));
  assert.match(await deliveryErrorNote(unknownError), /draft has been kept/);
  assert.match(await deliveryErrorNote(new Error("network")), /Check provider activity before retrying/);
});

test("structured policy errors explain why the draft was not sent", async () => {
  const error = new FunctionsHttpError(new Response(JSON.stringify({ accepted: false, error: "Outbound delivery is disabled." }), { status: 503 }));
  assert.equal(await deliveryErrorNote(error), "Outbound delivery is disabled.");
  const nonJson = new FunctionsHttpError(new Response("not JSON", { status: 500 }));
  assert.match(await deliveryErrorNote(nonJson), /Unable to confirm/);
});
