import test from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { createMigrationSelectionApi } from "../../src/hub/features/imports/migration-selection-api.ts";
import type { MigrationMapping } from "../../src/hub/features/imports/migration-selection-api.ts";
import type { MigrationManifest } from "../../src/hub/features/imports/migration-run-api.ts";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const actor = id(1), clientId = id(2), pet = id(3), snapshot = id(4);
const mapping = { id: id(5), resource: "animal" as const, client_id: clientId, pet_id: pet, external_id: "77", snapshot_id: snapshot, head_version: 1, source_origin: "https://api.trial.ezyvet.com" as const, source_site_uid: "Synthetic" };
function fixture(overrides: Record<string, unknown> = {}) {
  const calls: URL[] = [];
  const values: Record<string, unknown> = { ezyvet_record_links: [mapping], clients: [{ id: clientId, full_name: "Test household" }], pets: [{ id: pet, name: "Test patient", client_id: clientId }], ezyvet_import_snapshots: [{ id: snapshot, external_id: "77" }, { id: id(8), external_id: "77" }], ezyvet_identity_heads: [{ snapshot_id: snapshot, external_id: "77", version: 2 }], ...overrides };
  const db = createClient("http://127.0.0.1:54321", "synthetic-only", { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: async (input) => {
    const url = new URL(String(input)); calls.push(url);
    return new Response(JSON.stringify(values[url.pathname.split("/").at(-1)!] ?? []), { headers: { "Content-Type": "application/json" } });
  } } });
  return { calls, api: createMigrationSelectionApi(db, actor) };
}
test("mapping selection resolves names and rejects changed household membership", async () => {
  const good = fixture();
  assert.deepEqual((await good.api.mappings()).rows, [{ ...mapping, household_name: "Test household", patient_name: "Test patient" }]);
  const drift = fixture({ pets: [{ id: pet, name: "Test patient", client_id: id(99) }] });
  await assert.rejects(() => drift.api.mappings(), /household changed/);
});
test("mapping pages retain sentinel and invalid pages never query", async () => {
  const f = fixture({ ezyvet_record_links: Array.from({ length: 21 }, (_, n) => ({ ...mapping, id: id(100 + n) })) });
  const page = await f.api.mappings(2);
  assert.equal(page.rows.length, 20); assert.equal(page.has_more, true);
  assert.equal(f.calls[0].searchParams.get("offset"), "40");
  assert.equal(f.calls[0].searchParams.get("limit"), "21");
  const before = f.calls.length; await assert.rejects(() => f.api.mappings(-1)); assert.equal(f.calls.length, before);
});
test("parent choices use exact source identity and current head, not historical snapshot order", async () => {
  const f = fixture(), m: MigrationMapping = { ...mapping, patient_name: "Test patient", household_name: "Test household" };
  assert.deepEqual((await f.api.parents(m, "attachment")).rows, [{ id: snapshot, external_id: "77", version: 2 }]);
  assert.equal(f.calls[0].searchParams.get("external_id"), "eq.77");
  assert.equal(f.calls[0].searchParams.get("source_site_uid"), "eq.Synthetic");
  await f.api.parents(m, "vaccination");
  assert.equal(f.calls[2].searchParams.get("payload->>animal_id"), "eq.77");
  assert.equal(f.calls[2].searchParams.get("resource"), "eq.consult");
});
test("run choices constrain owner and source and reject substituted responses", async () => {
  const manifest = { run: { source_origin: mapping.source_origin, source_site_uid: mapping.source_site_uid } } as MigrationManifest;
  const scope = { resource: "animal" } as MigrationManifest["scopes"][number];
  const row = { id: id(12), requested_by: actor, source_origin: mapping.source_origin, source_site_uid: mapping.source_site_uid, resource: "animal", status: "running", created_at: "2026-09-14T12:00:00Z" };
  const f = fixture({ ezyvet_import_runs: [row] });
  assert.deepEqual((await f.api.runs(manifest, scope)).rows, [row]);
  assert.equal(f.calls[0].searchParams.get("requested_by"), `eq.${actor}`);
  for (const changed of [{ requested_by: id(99) }, { source_site_uid: "Other site" }, { resource: "history" }, { lease_id: id(44) }]) {
    await assert.rejects(() => fixture({ ezyvet_import_runs: [{ ...row, ...changed }] }).api.runs(manifest, scope));
  }
});
test("attachment choices use owned discovery and exclude different source parents", async () => {
  const manifest = { run: { source_origin: mapping.source_origin, source_site_uid: mapping.source_site_uid } } as MigrationManifest;
  const scope = { resource: "attachment", mapping_id: mapping.id, pet_id: pet, client_id: clientId, parent_snapshot_id: snapshot, parent_head_version: 2 } as MigrationManifest["scopes"][number];
  const row = { id: id(12), requested_by: actor, source_origin: mapping.source_origin, source_site_uid: mapping.source_site_uid, resource: "attachment", status: "running", created_at: "2026-09-14T12:00:00Z", parent_context: { animal_link_id: mapping.id, pet_id: pet, client_id: clientId, parent_snapshot_id: snapshot, parent_observed_head_version: 2 } };
  const f = fixture({ list_ezyvet_attachment_runs: { runs: [row], has_more: false, next_cursor: null } });
  assert.equal((await f.api.runs(manifest, scope)).rows[0].id, row.id);
  assert.equal(f.calls[0].pathname, "/rest/v1/rpc/list_ezyvet_attachment_runs");
  assert.equal((await f.api.runs(manifest, { ...scope, parent_head_version: 3 })).rows.length, 0);
  const invalid = fixture({ list_ezyvet_attachment_runs: { runs: [{ ...row, parent_context: { ...row.parent_context, animal_link_id: id(99) } }], has_more: false, next_cursor: null } });
  await assert.rejects(() => invalid.api.runs(manifest, scope));
});
