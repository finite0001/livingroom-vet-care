import assert from "node:assert/strict";
import { test } from "node:test";
import {
  saveValuesSchema,
  actionSchemas,
  filterSchema,
  selectionSchema,
} from "../../src/hub/features/records-requests/model.ts";
const id = "abc10000-0000-4000-8000-000000000001";
const values = {
  pet_id: id,
  client_id: id,
  direction: "outgoing",
  subset: "vaccines",
  channel: "EMAIL",
  recipient_kind: "client",
  recipient_name: null,
  recipient_email: null,
  requester_name: "Synthetic client",
  request_note: "",
  requested_on: "2026-10-10",
  due_on: null,
  assigned_to: null,
  ticket_id: null,
  conversation_id: null,
};
test("Client destination is resolved by the server, not accepted as a free recipient", () => {
  assert.equal(saveValuesSchema.parse(values).recipient_kind, "client");
  assert.equal(
    saveValuesSchema.safeParse({
      ...values,
      recipient: "unexpected@example.test",
    }).success,
    false,
  );
});
test("Named third-party sharing requires an email channel and complete destination", () => {
  const third = {
    ...values,
    recipient_kind: "third_party",
    recipient_name: "Other clinic",
    recipient_email: "clinic@example.test",
  };
  assert.equal(saveValuesSchema.safeParse(third).success, true);
  for (const patch of [
    { channel: "SMS" },
    { recipient_name: " " },
    { recipient_email: null },
    { direction: "incoming" },
  ])
    assert.equal(
      saveValuesSchema.safeParse({ ...third, ...patch }).success,
      false,
    );
});
test("Requested and due dates are chronological calendar dates", () =>
  assert.equal(
    saveValuesSchema.safeParse({ ...values, due_on: "2026-10-09" }).success,
    false,
  ));
test("Custom selection rejects unknown source families and duplicate IDs", () => {
  assert.equal(selectionSchema.safeParse({ weight_ids: [id] }).success, true);
  assert.equal(
    selectionSchema.safeParse({ weight_ids: [id, id] }).success,
    false,
  );
  assert.equal(
    selectionSchema.safeParse({ private_notes: [id] }).success,
    false,
  );
});
test("Recipient authorization requires three explicit attestations", () => {
  const v = {
    authorization_id: id,
    manifest_hash: "a".repeat(64),
    client_authority: "Reviewed client approval",
    destination_verification: "Independent clinic verification",
    evidence_document_id: null,
    evidence_document_version: null,
    expires_on: "2026-10-20",
    attest_client_authority: true,
    attest_destination: true,
    attest_source_scope: true,
  };
  assert.equal(actionSchemas.authorize.safeParse(v).success, true);
  for (const key of [
    "attest_client_authority",
    "attest_destination",
    "attest_source_scope",
  ])
    assert.equal(
      actionSchemas.authorize.safeParse({ ...v, [key]: false }).success,
      false,
    );
});
test("Status updates cannot fabricate a sent state", () =>
  assert.equal(
    actionSchemas.transition.safeParse({
      status: "sent",
      review_note: "A checkbox",
    }).success,
    false,
  ));
test("Queue filters reject arbitrary SQL-like or unknown predicates", () => {
  assert.equal(
    filterSchema.safeParse({ status: "ready", overdue: true }).success,
    true,
  );
  assert.equal(filterSchema.safeParse({ status: "sent" }).success, false);
  assert.equal(
    filterSchema.safeParse({ recipient: "clinic@example.test" }).success,
    false,
  );
});
