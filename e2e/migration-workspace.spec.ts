import { test, expect, type Page } from "@playwright/test";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const actor = id(1), runId = id(2), scopeId = id(3), bindingId = id(4), child = id(5), snapshot = id(6), mapping = id(7), pet = id(8), client = id(9), otherScope = id(10);
const at = "2026-09-14T12:00:00Z", origin = "https://api.trial.ezyvet.com", site = "Synthetic migration source";
async function fixture(page: Page, admin = true) {
  const user = { id: actor, aud: "authenticated", role: "authenticated", email: "synthetic@example.test", app_metadata: { provider: "email", providers: ["email"] }, user_metadata: {}, created_at: at };
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const session = { access_token: `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ sub: actor, exp, role: "authenticated", aud: "authenticated" })).toString("base64url")}.synthetic`, refresh_token: "synthetic", token_type: "bearer", expires_in: 3600, expires_at: exp, user };
  await page.addInitScript(s => localStorage.setItem("sb-127-auth-token", JSON.stringify(s)), session);
  const inputs = [{ id: scopeId, mapping_id: mapping, resource: "attachment", parent_type: "animal", parent_snapshot_id: snapshot, parent_head_version: 1, disposition: "required", reason: "Saved original-file scope" },
    { id: otherScope, mapping_id: mapping, resource: "history", parent_type: "animal", parent_snapshot_id: snapshot, parent_head_version: 1, disposition: "excluded", reason: "Awaiting clinician scope review" }];
  const summary = { id: runId, source_origin: origin, source_site_uid: site, intent_hash: "a".repeat(64), created_at: at };
  const manifest = { run: { ...summary, actor_id: actor, intent: { version: 1, source_origin: origin, source_site_uid: site, scopes: inputs } },
    scopes: inputs.map(s => ({ ...s, migration_run_id: runId, mapping_snapshot_id: snapshot, mapping_head_version: 1, client_id: client, pet_id: pet, parent_external_id: "77", parent_payload_hash: "a".repeat(64) })), scope_manifest_version: 1, scope_manifest_hash: "b".repeat(64) };
  const binding = { id: bindingId, scope_id: scopeId, child_run_id: child, actor_id: actor, replaces_id: null, reason: "Saved source attempt", context_hash: "c".repeat(64), created_at: at,
    child_context: { version: 1, run_id: child, owner: actor, source_origin: origin, source_site_uid: site, resource: "attachment", parent_evidence: "exact_parent_version", context: {} } };
  const state = { empty: false, failCaptures: false, failItems: false, failProgress: false, failRuns: false, stale: false, holdItems: false, releaseItems: null as (() => void) | null, calls: [] as string[] };
  await page.route("**/*", route => new URL(route.request().url()).origin === "http://127.0.0.1:8080" ? route.continue() : route.abort());
  await page.route("http://127.0.0.1:54321/**", async route => {
    const path = new URL(route.request().url()).pathname, body = route.request().method() === "POST" ? route.request().postDataJSON() : {};
    if (path === "/auth/v1/user") return route.fulfill({ json: user });
    if (path === "/auth/v1/token") return route.fulfill({ json: session });
    if (path === "/auth/v1/logout") return route.fulfill({ json: {} });
    if (path === "/rest/v1/profiles") return route.fulfill({ json: [{ id: actor, first_name: "Synthetic", last_name: "Admin", full_name: "Synthetic Admin", is_active: true, role: admin ? "ADMIN" : "STAFF" }] });
    if (path === "/rest/v1/user_roles") return route.fulfill({ json: [{ role: admin ? "ADMIN" : "STAFF" }] });
    const rpc = path.split("/").at(-1)!;
    if (path.includes("/rpc/")) state.calls.push(rpc);
    const unavailable = () => route.fulfill({ status: 503, json: { message: "Synthetic unavailable" } });
    if (rpc === "list_ezyvet_migration_runs") return state.failRuns ? unavailable() : route.fulfill({ json: { runs: state.empty ? [] : [summary], has_more: false } });
    if (rpc === "read_ezyvet_migration_run") return route.fulfill({ json: manifest });
    if (rpc === "list_ezyvet_migration_bindings") return route.fulfill({ json: { bindings: body.p_scope_id === scopeId ? [binding] : [], has_more: false } });
    if (rpc === "read_ezyvet_migration_binding") return route.fulfill({ json: binding });
    if (rpc === "read_ezyvet_migration_binding_progress") return state.failProgress ? unavailable() : route.fulfill({ json: {
      version: 2, binding_id: bindingId, scope_id: scopeId, migration_run_id: runId, child_run_id: child, resource: "attachment", context_hash: binding.context_hash,
      superseded: false, parent_evidence: "exact_parent_version", parent_current: !state.stale, household_current: true,
      scan: { status: "review_ready", next_page: 4, pages_observed: 3, traversal_ended: true, page_limit_reached: false, retry_after: null, latest_error_code: null, provider_total: null, complete_coverage_verified: false },
      observations: { occurrences: 21, distinct_source_identities: 1, distinct_snapshot_versions: 1, occurrence_fidelity: "page_ordinal", exact_current_occurrences: state.stale ? 0 : 21, currentness_available: true },
      clinical_review: { reconciled: false, approved_local_outcomes: null }, attempt_history_available: true,
      attempt_history: { origin: "run_created", started_at: at, complete_since_run_creation: true, claims: 3, failed_pages: 0, staged_pages: 3 }, observed_at: at } });
    if (rpc === "list_ezyvet_migration_capture_evidence") return state.failCaptures ? unavailable() : route.fulfill({ json: {
      version: 1, binding_id: bindingId, scope_id: scopeId, child_run_id: child, actor_id: actor, page: body.p_page, ordinal: body.p_ordinal, snapshot_id: body.p_snapshot_id, evidence_hash: body.p_evidence_hash,
      ownership: "current_actor_only", has_more: false, next_cursor: null, original_bytes_reverified: false, complete_coverage_verified: false, observed_at: at,
      captures: [{ request_id: id(30), created_at: at, status: "ready", relationship: "exact_occurrence", source_current: !state.stale, retry_after: null, latest_error_code: null,
        capture: { id: id(31), capture_hash: "d".repeat(64), content_sha256: "e".repeat(64), mime_type: "application/pdf", file_size: 12, captured_at: at },
        approved_versions: 1, canceled_unconfirmed_decisions: 1, latest_approval: { id: id(32), version: 1, record_hash: "f".repeat(64), created_at: at, superseded: false } }] } });
    if (rpc === "list_ezyvet_migration_items") {
      if (state.holdItems) await new Promise<void>(resolve => { state.releaseItems = resolve; });
      if (state.failItems) return unavailable();
      const start = body.p_after_page ? 20 : 0, count = start ? 1 : 20;
      const items = Array.from({ length: count }, (_, index) => ({ page: Math.floor((start + index) / 10) + 1, ordinal: (start + index) % 10 + 1, snapshot_id: snapshot,
        observed_head_version: 1, external_id: "701", payload_hash: "a".repeat(64), file_id: "42", raw_record_sha256: "b".repeat(64), stable_metadata_sha256: "c".repeat(64), evidence_hash: (start + index + 1).toString(16).padStart(64, "0"),
        current_snapshot_id: snapshot, current_head_version: state.stale ? 3 : 1, payload_current: true, exact_source_current: !state.stale }));
      return route.fulfill({ json: { version: 1, binding_id: bindingId, scope_id: scopeId, migration_run_id: runId, child_run_id: child, resource: "attachment", context_hash: binding.context_hash,
        superseded: false, mapping_matches_manifest: true, mapping_source_current: !state.stale, parent_current: !state.stale, household_current: true, occurrence_fidelity: "page_ordinal", review_reconciled: false, complete_coverage_verified: false,
        observed_at: at, items, has_more: !start, next_cursor: start ? null : { page: 2, ordinal: 10, snapshot_id: snapshot } } });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto("/hub/tools/ezyvet");
  return state;
}
async function openEvidence(page: Page) {
  const workspace = page.getByRole("region", { name: "Migration reconciliation" });
  await workspace.getByRole("button", { name: "Browse saved migrations" }).click();
  await workspace.getByRole("button", { name: /Open migration/ }).click();
  await workspace.getByRole("button", { name: /Inspect attachments scope/ }).click();
  await workspace.getByRole("button", { name: /Inspect attempt/ }).click();
  return workspace;
}
for (const width of [390, 1440]) test(`saved migration evidence at ${width}px preserves source distinctions`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 }); const state = await fixture(page);
  const workspace = await openEvidence(page);
  await expect(workspace.getByText("Observed occurrences", { exact: true })).toBeVisible();
  await expect(workspace.getByRole("link", { name: "Open saved patient" }).first()).toHaveAttribute("href", `/hub/patient/${pet}`);
  await expect(workspace.getByRole("link", { name: "Open saved household" }).first()).toHaveAttribute("href", `/hub/client/${client}`);
  await expect(workspace.getByText("Traversal ended; source coverage has not been accepted.")).toBeVisible();
  await expect(workspace.getByText("Observed version is current", { exact: true })).toHaveCount(20);
  await workspace.getByRole("button", { name: "Next source item page" }).click();
  await expect(workspace.getByText("Page 3 · Occurrence 1", { exact: true })).toBeVisible();
  await workspace.getByRole("button", { name: /Evidence references for source 701/ }).click();
  await expect(workspace.getByText("Occurrence evidence hash", { exact: true })).toBeVisible();
  await expect(workspace.getByText("Original captured", { exact: true })).toBeVisible();
  await expect(workspace.getByText("Recorded approval versions: 1", { exact: true })).toBeVisible();
  await expect(workspace.getByText("Canceled unconfirmed decisions: 1", { exact: true })).toBeVisible();
  state.stale = true;
  await workspace.getByRole("button", { name: "Refresh source evidence" }).click();
  await expect(workspace.getByText("The saved patient or contact mapping requires review.")).toBeVisible();
  await expect(workspace.getByText("Source version changed", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await workspace.getByRole("region", { name: "Owned capture evidence" }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `/tmp/lrv-migration-workspace-${width}.png` });
  expect(state.calls.filter(name => name.includes("migration")).every(name => name.startsWith("list_") || name.startsWith("read_"))).toBe(true);
});
test("unavailable counts stay distinct from empty source evidence and recover on retry", async ({ page }) => {
  const state = await fixture(page); state.failProgress = true; state.failItems = true;
  const workspace = await openEvidence(page);
  await expect(workspace.getByText("Run progress is unavailable; counts are not shown.")).toBeVisible();
  await expect(workspace.getByText("Source items could not be loaded.")).toBeVisible();
  await expect(workspace.getByText("Observed occurrences", { exact: true })).toHaveCount(0);
  state.failProgress = false; state.failItems = false;
  await workspace.getByRole("button", { name: "Refresh source evidence" }).click();
  await expect(workspace.getByText("Observed occurrences", { exact: true })).toBeVisible();
});
test("changing scope ignores a late item response", async ({ page }) => {
  const state = await fixture(page); state.holdItems = true;
  const workspace = await openEvidence(page);
  await expect(workspace.getByText("Loading source items…")).toBeVisible();
  await expect.poll(() => state.releaseItems !== null).toBe(true);
  await workspace.getByRole("button", { name: /Inspect history scope/ }).click();
  state.releaseItems!();
  await expect(workspace.getByText("No source run is bound on this page.", { exact: false })).toBeVisible();
  await expect(workspace.getByRole("region", { name: "Migration source evidence" })).toHaveCount(0);
});
test("signing out removes pending migration evidence", async ({ page }) => {
  const state = await fixture(page); state.holdItems = true;
  await openEvidence(page); await expect.poll(() => state.releaseItems !== null).toBe(true);
  await page.getByRole("button", { name: /Sign out/i }).click(); state.releaseItems!();
  await expect(page).toHaveURL(/\/hub\/login/);
  await expect(page.getByText("Migration reconciliation", { exact: true })).toHaveCount(0);
});
test("empty saved history is explicit and non-administrators cannot open the workspace", async ({ page }) => {
  const state = await fixture(page); state.empty = true;
  await page.getByRole("button", { name: "Browse saved migrations" }).click();
  await expect(page.getByText("No saved migrations on this page.", { exact: false })).toBeVisible();
  await page.unrouteAll({ behavior: "wait" }); await fixture(page, false);
  await expect(page.getByText("Migration reconciliation", { exact: true })).toHaveCount(0);
});

test("failed capture lookup never masquerades as missing originals", async ({ page }) => {
  const state = await fixture(page); state.failCaptures = true;
  const workspace = await openEvidence(page);
  await workspace.getByRole("button", { name: /Evidence references for source 701/ }).first().click();
  await expect(workspace.getByText("Capture evidence could not be loaded.")).toBeVisible();
  await expect(workspace.getByText("No owned capture requests match this source version.")).toHaveCount(0);
  state.failCaptures = false;
  await workspace.getByRole("button", { name: "Refresh capture evidence" }).click();
  await expect(workspace.getByText("Original captured", { exact: true })).toBeVisible();
});
