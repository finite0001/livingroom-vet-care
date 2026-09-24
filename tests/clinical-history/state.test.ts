import { approvedClinicalHistory } from "./fixtures.ts";
import test from "node:test";
import assert from "node:assert/strict";
import {
  parseHistoryRequest,
  extractionPayload,
  equalHistoryPayload,
} from "../../src/hub/features/imports/history-state.ts";
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const payload = {
  sources: [{ id: id(4), version_hash: "a".repeat(64) }],
  patient_version: 1,
  action: "create",
  problem_id: null,
  problem_version: null,
  fields: {
    title: "Reviewed reaction",
    notes: "",
    onset_date: null,
    status: "active",
    importance: "high",
  },
  duplicate_decision: "distinct_finding",
  reason: "Reviewed source and current chart",
};
const envelope = () => ({
  request: {
    id: id(1),
    actor_id: id(2),
    pet_id: id(3),
    kind: "problem_extraction",
    status: "prepared",
    request_hash: "b".repeat(64),
    payload,
    created_at: "2026-09-13T12:00:00.123456+00:00",
    resolved_at: null,
    review_context: {
      history_source: null,
      histories: [{ ...approvedClinicalHistory(), id: id(4), pet_id: id(3) }],
      problem: null,
      extraction: null,
    },
  },
  receipt: null,
});
test("prepared recovery binds exact actor, patient, kind and request", () => {
  assert.equal(
    parseHistoryRequest(envelope(), id(2), id(3), "problem_extraction", id(1))
      ?.request.created_at,
    "2026-09-13T12:00:00.123456+00:00",
  );
  assert.throws(() =>
    parseHistoryRequest(envelope(), id(5), id(3), "problem_extraction", id(1)),
  );
  assert.throws(() =>
    parseHistoryRequest(envelope(), id(2), id(5), "problem_extraction", id(1)),
  );
  assert.throws(() =>
    parseHistoryRequest(envelope(), id(2), id(3), "history_approval", id(1)),
  );
  assert.throws(() =>
    parseHistoryRequest(envelope(), id(2), id(3), "problem_extraction", id(5)),
  );
  assert.equal(
    parseHistoryRequest(null, id(2), id(3), "problem_extraction", id(1)),
    null,
  );
});
test("extraction rejects duplicate sources and ambiguous create/link decisions", () => {
  assert.throws(() =>
    extractionPayload.parse({
      ...payload,
      sources: [...payload.sources, ...payload.sources],
    }),
  );
  assert.throws(() => extractionPayload.parse({ ...payload, action: "link" }));
  assert.throws(() =>
    extractionPayload.parse({ ...payload, problem_id: id(5) }),
  );
  assert.equal(equalHistoryPayload({ b: 2, a: 1 }, { a: 1, b: 2 }), true);
  assert.equal(
    equalHistoryPayload(payload, {
      ...payload,
      fields: { ...payload.fields, importance: "routine" },
    }),
    false,
  );
});
test("null recovery and durable abandonment never become approval", () => {
  const value = {
    ...envelope(),
    request: {
      ...envelope().request,
      status: "abandoned",
      payload: null,
      request_hash: null,
      resolved_at: "2026-09-13T13:00:00Z",
      review_context: null,
    },
  };
  assert.equal(
    parseHistoryRequest(value, id(2), id(3), "problem_extraction", id(1))
      ?.request.status,
    "abandoned",
  );
  assert.throws(() =>
    parseHistoryRequest(
      { ...envelope(), request: { ...envelope().request, status: "approved" } },
      id(2),
      id(3),
      "problem_extraction",
      id(1),
    ),
  );
});

test("frozen reviewed narratives must match exact selected versions", () => {
  const value = envelope();
  value.request.review_context.histories[0].id = id(9);
  assert.throws(
    () => parseHistoryRequest(value, id(2), id(3), "problem_extraction", id(1)),
    /Frozen extraction/,
  );
});

test("short review reasons fail before preparing a durable request", () => {
  assert.throws(() =>
    extractionPayload.parse({ ...payload, reason: "  ok  " }),
  );
  assert.equal(
    extractionPayload.parse({ ...payload, reason: "  Valid  " }).reason,
    "Valid",
  );
});
