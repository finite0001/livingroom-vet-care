import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { decodeExactJson, ExactJsonNumber, type ExactJson } from "../../src/hub/features/controlled-drugs/record-review/exact-json.ts";
import { hashReviewClinicalAlertSnapshot } from "../../src/hub/features/controlled-drugs/record-review/component-hashes.ts";

interface EvidenceObject { [key: string]: ExactJson }
const object = (value: ExactJson) => value as EvidenceObject;
function reference(kind: "treatment" | "anesthesia") {
  const response = object(decodeExactJson(readFileSync(new URL(`./record-review-${kind}-reference.json`, import.meta.url))));
  const packet = object(object(response.data).packet), sources = packet.source_rows as EvidenceObject[];
  const alert = object(sources.find(source => source.relation === "public.treatment_alert_reviews")!.row);
  return { packet, snapshot: object(alert.snapshot), hash: alert.source_hash };
}

test("clinical alert hashes match exact PostgreSQL bytes from both genuine synthetic writers", async () => {
  for (const kind of ["treatment", "anesthesia"] as const) {
    const source = reference(kind);
    assert.equal(await hashReviewClinicalAlertSnapshot(source.snapshot), source.hash);
    assert.equal(await hashReviewClinicalAlertSnapshot({ ...source.snapshot, pet_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" }) === source.hash, false);
  }
});

test("a snapshot cannot replace its historical provenance or hide extra fields", async () => {
  const source = reference("treatment");
  for (const value of [
    { ...source.snapshot, legacy_allergies: { ...object(source.snapshot.legacy_allergies), provenance: "Personally verified allergy history" } },
    { ...source.snapshot, current_chart: {} },
    { ...source.snapshot, legacy_allergies: { ...object(source.snapshot.legacy_allergies), observed_by: "Someone else" } },
    source.packet,
  ]) await assert.rejects(async () => hashReviewClinicalAlertSnapshot(value));
});

test("snapshot hashing rejects accessors before any schema reads their values", async () => {
  const source = reference("treatment"); let reads = 0;
  const value = { ...source.snapshot };
  Object.defineProperty(value, "pet_id", { enumerable: true, get() { reads++; return source.snapshot.pet_id; } });
  await assert.rejects(async () => hashReviewClinicalAlertSnapshot(value));
  assert.equal(reads, 0);
});

test("historical high-importance problems preserve resolved status, Unicode and nullable dates", async () => {
  const source = reference("treatment"), one = new ExactJsonNumber("1");
  const problem = { id: "11111111-1111-4111-8111-111111111111", version: one, title: "Synthetic 🐾 alert", notes: "Synthetic retained note",
    status: "resolved", importance: "high", onset_date: "2024-02-29", updated_at: "2026-10-24T12:00:00.123456-06:00" };
  const snapshot = { ...source.snapshot, important_problems: [problem] };
  const hash = await hashReviewClinicalAlertSnapshot(snapshot);
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.notEqual(hash, await hashReviewClinicalAlertSnapshot({ ...snapshot, important_problems: [{ ...problem, onset_date: null }] }));
  // Model shape tests only: these populated variants are not server fixtures.
  for (const changed of [
    { ...problem, importance: "routine" }, { ...problem, status: "deleted" }, { ...problem, title: " " },
    { ...problem, version: new ExactJsonNumber("0") }, { ...problem, onset_date: "2023-02-29" },
    { ...problem, updated_at: "2026-10-24T12:00:00" }, { ...problem, notes: "a".repeat(10001) },
  ]) await assert.rejects(async () => hashReviewClinicalAlertSnapshot({ ...snapshot, important_problems: [changed] }));
  await assert.rejects(async () => hashReviewClinicalAlertSnapshot({ ...snapshot, important_problems: [problem, problem] }));
  await assert.rejects(async () => hashReviewClinicalAlertSnapshot({ ...snapshot,
    important_problems: [{ ...problem, id: "22222222-2222-4222-8222-222222222222" }, problem] }));
});
