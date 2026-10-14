import { test } from "node:test";
import assert from "node:assert/strict";
import {
  taskDefinitionSchema,
  taskRequestSchema,
  useRequestSchema,
  policyRequestSchema,
  validateOperationalRequest,
  rememberOperationalReview,
  storedOperationalReviews,
  forgetOperationalReview,
} from "../../src/hub/features/daily-tasks/task-model.ts";
const id = (n: number) =>
  `54000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const definition = {
  name: "Reviewed room turnover",
  category: "turnover",
  trigger: "after_use",
  selectors: { types: [], resources: [{ entry_id: id(1), version_id: id(2) }] },
  due: { offset_minutes: 15, local_time: null, dst_resolution: "reject" },
  eligible_roles: ["STAFF"],
  assignment: "unassigned",
  assignee_id: null,
  checklist: [{ id: id(3), label: "Approved SOP check", required: true }],
  sop_reference: "Reviewed SOP",
};
test("Surgical preparation requires explicit reviewed type identities", () => {
  assert.equal(taskDefinitionSchema.safeParse(definition).success, true);
  assert.equal(
    taskDefinitionSchema.safeParse({
      ...definition,
      category: "preparation",
      trigger: "before_visit",
    }).success,
    false,
  );
  assert.equal(
    taskDefinitionSchema.safeParse({
      ...definition,
      selectors: {
        ...definition.selectors,
        resources: [
          definition.selectors.resources[0],
          definition.selectors.resources[0],
        ],
      },
    }).success,
    false,
  );
  assert.equal(
    taskDefinitionSchema.safeParse({ ...definition, match_name: "surgery" })
      .success,
    false,
  );
});
test("Resource-day restocking has one local time and explicit daylight-saving rule", () => {
  const daily = {
    ...definition,
    category: "restock",
    trigger: "resource_day",
    due: { offset_minutes: 0, local_time: "18:00", dst_resolution: "later" },
  };
  assert.equal(taskDefinitionSchema.safeParse(daily).success, true);
  for (const due of [
    { ...daily.due, offset_minutes: 15 },
    { ...daily.due, local_time: "24:00" },
    { ...daily.due, dst_resolution: "guess" },
  ])
    assert.equal(
      taskDefinitionSchema.safeParse({ ...daily, due }).success,
      false,
    );
});
test("Assignment and checklist evidence reject duplicate or contradictory identities", () => {
  assert.equal(
    taskDefinitionSchema.safeParse({ ...definition, assignment: "named" })
      .success,
    false,
  );
  assert.equal(
    taskDefinitionSchema.safeParse({
      ...definition,
      checklist: [definition.checklist[0], definition.checklist[0]],
    }).success,
    false,
  );
  assert.equal(
    taskDefinitionSchema.safeParse({
      ...definition,
      eligible_roles: ["STAFF", "STAFF"],
    }).success,
    false,
  );
  assert.equal(
    taskDefinitionSchema.safeParse({
      ...definition,
      sop_reference: "unsafe\u0001text",
    }).success,
    false,
  );
});
test("Actual use cannot be manufactured from an unordered interval or a start with a previous revision", () => {
  const use = {
    id: id(4),
    expected_version: null,
    action: "start",
    appointment_id: id(5),
    appointment_version: 1,
    resource_version_id: id(2),
    started_at: "2026-10-13T16:00:00Z",
    ended_at: null,
    reason: "Actual staff assertion",
    allow_overlap: false,
  };
  assert.equal(useRequestSchema.safeParse(use).success, true);
  assert.equal(
    useRequestSchema.safeParse({ ...use, expected_version: 1 }).success,
    false,
  );
  assert.equal(
    useRequestSchema.safeParse({
      ...use,
      action: "end",
      expected_version: 1,
      ended_at: "2026-10-13T15:00:00Z",
    }).success,
    false,
  );
  assert.equal(
    useRequestSchema.safeParse({ ...use, action: "end", expected_version: 1 })
      .success,
    false,
  );
});
test("Task resolution/replacement must use explicit reviewer values", () => {
  const task = {
    id: id(6),
    expected_version: 1,
    context_hash: "0".repeat(32),
    action: "complete",
    assignee_id: null,
    checked_ids: [id(3)],
    note: "Actual required item attestation",
    due_at: null,
    template_version_id: null,
  };
  assert.equal(taskRequestSchema.safeParse(task).success, true);
  for (const patch of [
    { checked_ids: [id(3), id(3)] },
    { action: "resolve", checked_ids: [] },
    { action: "replace", checked_ids: [] },
    { context_hash: "" },
    { due_at: "2026-10-13T16:00:00Z" },
  ])
    assert.equal(
      taskRequestSchema.safeParse({ ...task, ...patch }).success,
      false,
    );
});
test("Generation does not accept an implicit or unbounded activation period", () => {
  const disabled = {
    expected_version: null,
    enabled: false,
    effective_from: null,
    effective_until: null,
    review_note: "Explicit generation review",
    attest_review: true,
  };
  assert.equal(policyRequestSchema.safeParse(disabled).success, true);
  assert.equal(
    policyRequestSchema.safeParse({ ...disabled, enabled: true }).success,
    false,
  );
  assert.equal(
    policyRequestSchema.safeParse({
      ...disabled,
      enabled: true,
      effective_from: "2026-01-01T00:00:00Z",
      effective_until: "2028-01-01T00:00:00Z",
    }).success,
    false,
  );
  assert.throws(() => validateOperationalRequest("template", disabled));
});
test("Recovery storage contains only strict pointers for the current actor", () => {
  const values = new Map<string, string>(),
    storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    };
  const metadata = { id: id(7), actor_id: id(8), operation: "task" as const };
  rememberOperationalReview(storage, metadata);
  assert.deepEqual(storedOperationalReviews(storage, id(8)), [metadata]);
  assert.deepEqual(storedOperationalReviews(storage, id(9)), []);
  assert.throws(() =>
    rememberOperationalReview(storage, {
      ...metadata,
      request: definition,
    } as typeof metadata),
  );
  assert.deepEqual(Object.keys(JSON.parse([...values.values()][0])[0]).sort(), [
    "actor_id",
    "id",
    "operation",
  ]);
  forgetOperationalReview(storage, metadata);
  assert.deepEqual(storedOperationalReviews(storage, id(8)), []);
});

test("Recovery pointer capacity cannot overwrite outstanding work", () => {
  const actor = id(999),
    records = Array.from({ length: 128 }, (_, n) => ({
      id: id(n + 1),
      actor_id: actor,
      operation: "task" as const,
    }));
  let value = JSON.stringify(records);
  const storage = {
    getItem: () => value,
    setItem: (_key: string, next: string) => {
      value = next;
    },
  };
  assert.throws(() =>
    rememberOperationalReview(storage, {
      id: id(129),
      actor_id: actor,
      operation: "task",
    }),
  );
  assert.deepEqual(storedOperationalReviews(storage, actor), records);
});
