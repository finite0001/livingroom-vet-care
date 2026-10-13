import assert from "node:assert/strict";
import { test } from "node:test";
import { diagnosticReleaseScopeSchema } from "../../src/hub/features/diagnostics/pdf-jobs/release-scope-model.ts";
const id = (n: number) =>
  `b3400000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const hash = "a".repeat(64),
  date = "2026-10-12T01:00:00Z";
const source = () => ({
  binding_version: 1,
  job_id: id(1),
  pet_id: id(2),
  panel_id: id(3),
  mode: "current",
  version: 1,
  label: "Chemistry",
  reviewed_at: date,
  source_hash: hash,
  snapshot_hash: hash,
  manifest_sha256: hash,
  sha256: hash,
  byte_length: 30000,
  embedded_versions: [
    {
      id: id(1),
      panel_id: id(3),
      version: 1,
      label: "Chemistry",
      reviewed_at: date,
      source_hash: hash,
    },
    {
      id: id(4),
      panel_id: id(5),
      version: 2,
      label: "CBC",
      reviewed_at: date,
      source_hash: hash,
    },
  ],
  total_panels: 2,
  export_available: false,
  scope_expansion_required: true,
});
test("scope requires exact source in embedded census", () => {
  assert.ok(diagnosticReleaseScopeSchema.safeParse(source()).success);
  for (const field of ["id", "panel_id", "source_hash", "version"] as const) {
    const s = source();
    (s.embedded_versions[0] as Record<string, unknown>)[field] =
      field === "source_hash"
        ? "b".repeat(64)
        : field === "version"
          ? 2
          : id(9);
    assert.equal(diagnosticReleaseScopeSchema.safeParse(s).success, false);
  }
});
test("scope rejects hidden additional history and duplicate panels", () => {
  const s = source();
  s.scope_expansion_required = false;
  assert.equal(diagnosticReleaseScopeSchema.safeParse(s).success, false);
  s.scope_expansion_required = true;
  s.total_panels = 1;
  assert.equal(diagnosticReleaseScopeSchema.safeParse(s).success, false);
  s.total_panels = 2;
  s.embedded_versions[1].panel_id = id(3);
  assert.equal(diagnosticReleaseScopeSchema.safeParse(s).success, false);
});
test("scope projection never carries private object access or export permission", () => {
  for (const k of ["object_path", "bucket", "object_id", "object_version"])
    assert.equal(
      diagnosticReleaseScopeSchema.safeParse({ ...source(), [k]: "private" })
        .success,
      false,
    );
  assert.equal(
    diagnosticReleaseScopeSchema.safeParse({
      ...source(),
      export_available: true,
    }).success,
    false,
  );
});
test("scope rejects nonexplicit version mode and unbounded binary metadata", () => {
  assert.equal(
    diagnosticReleaseScopeSchema.safeParse({ ...source(), mode: "latest" })
      .success,
    false,
  );
  assert.equal(
    diagnosticReleaseScopeSchema.safeParse({
      ...source(),
      byte_length: 3145729,
    }).success,
    false,
  );
});
