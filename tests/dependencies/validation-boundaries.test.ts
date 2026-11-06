import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { estimatePublicationSnapshotSchema } from "../../supabase/functions/_shared/estimate-publication-document.ts";
import { reconciliationRequestSchema } from "../../supabase/functions/_shared/operational-reconciliation-contract.ts";
import { uuid as clinicalUuid } from "../../src/hub/features/clinical/dictation/model.ts";
import { renderInputSchema } from "../../services/diagnostic-renderer/sandbox.ts";

test("bounded collections refuse excess input before validating any element", () => {
  let visits = 0;
  const element = z.unknown().superRefine(() => { visits++; });
  for (const [schema, input] of [
    [z.array(element).max(2), [1, 2, 3]],
    [z.set(element).max(2), new Set([1, 2, 3])],
    [z.map(element, element).max(2), new Map([[1, 1], [2, 2], [3, 3]])],
  ] as const) {
    const result = schema.safeParse(input);
    assert.equal(result.success, false);
    if (!result.success) assert.deepEqual(result.error.issues.map(issue => issue.code), ["too_big"]);
  }
  assert.equal(visits, 0, "element validation must not grow with an oversized collection");
  assert.equal(z.array(element).max(2).safeParse([1, 2]).success, true);
  assert.equal(visits, 2);
});

test("actual publication line ceiling rejects without reading oversized line contents", () => {
  let accessed = false;
  const lines = Array(101).fill(null);
  Object.defineProperty(lines, 0, { get() { accessed = true; throw Error("line visited"); } });
  const result = estimatePublicationSnapshotSchema.shape.lines.safeParse(lines);
  assert.equal(result.success, false);
  assert.equal(accessed, false);
  if (!result.success) assert.equal(result.error.issues[0].code, "too_big");
});

test("database UUID boundaries retain non-RFC bit patterns and their original normalization rules", () => {
  const id = "01234567-89ab-f123-0123-0123456789ab";
  const publicationId = estimatePublicationSnapshotSchema.shape.target.shape.estimate_id;
  for (const schema of [clinicalUuid, publicationId, renderInputSchema.shape.job_id]) {
    assert.equal(schema.parse(id), id);
    for (const malformed of [id.replace(/-/g, ""), `{${id}}`, `${id} `, id.slice(1), id.replace(/b$/, "g")]) {
      assert.equal(schema.safeParse(malformed).success, false, malformed);
    }
  }
  // These existing boundaries have deliberately different case policies.
  assert.equal(clinicalUuid.parse(id.toUpperCase()), id.toUpperCase());
  assert.equal(publicationId.safeParse(id.toUpperCase()).success, false);
  assert.equal(reconciliationRequestSchema.parse({ run_id: id.toUpperCase() }).run_id, id);
});
