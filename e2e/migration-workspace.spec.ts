import { test, expect, type Page } from "@playwright/test";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const actor = id(1), runId = id(2), scopeId = id(3), bindingId = id(4), child = id(5), snapshot = id(6), mapping = id(7), pet = id(8), client = id(9), otherScope = id(10);
const at = "2026-09-14T12:00:00Z", origin = "https://api.trial.ezyvet.com", site = "Synthetic migration source";
async function fixture(page: Page, admin = true, history = false) {
  const resource = history ? "history" : "attachment", parentEvidence = history ? "mapping_identity_only" : "exact_parent_version";
  const user = { id: actor, aud: "authenticated", role: "authenticated", email: "synthetic@example.test", app_metadata: { provider: "email", providers: ["email"] }, user_metadata: {}, created_at: at };
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const session = { access_token: `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ sub: actor, exp, role: "authenticated", aud: "authenticated" })).toString("base64url")}.synthetic`, refresh_token: "synthetic", token_type: "bearer", expires_in: 3600, expires_at: exp, user };
  await page.addInitScript(s => localStorage.setItem("sb-127-auth-token", JSON.stringify(s)), session);
  const inputs = [{ id: scopeId, mapping_id: mapping, resource, parent_type: "animal", parent_snapshot_id: snapshot, parent_head_version: 1, disposition: "required", reason: "Saved original-file scope" },
    { id: otherScope, mapping_id: mapping, resource: history ? "consult" : "history", parent_type: "animal", parent_snapshot_id: snapshot, parent_head_version: 1, disposition: "excluded", reason: "Awaiting clinician scope review" }];
  const summary = { id: runId, source_origin: origin, source_site_uid: site, intent_hash: "a".repeat(64), created_at: at };
  const manifest = { run: { ...summary, actor_id: actor, intent: { version: 1, source_origin: origin, source_site_uid: site, scopes: inputs } },
    scopes: inputs.map(s => ({ ...s, migration_run_id: runId, mapping_snapshot_id: snapshot, mapping_head_version: 1, client_id: client, pet_id: pet, parent_external_id: "77", parent_payload_hash: "a".repeat(64) })), scope_manifest_version: 1, scope_manifest_hash: "b".repeat(64) };
  const binding = { id: bindingId, scope_id: scopeId, child_run_id: child, actor_id: actor, replaces_id: null, reason: "Saved source attempt", context_hash: "c".repeat(64), created_at: at,
    child_context: { version: 1, run_id: child, owner: actor, source_origin: origin, source_site_uid: site, resource, parent_evidence: parentEvidence, context: {} } };
  const savedPlans = new Map<string, typeof manifest>(), savedBindings = new Map<string, typeof binding>();
  const state = { resumeRunning: false, resumeLease: false, resumeRetry: null as string | null, resumePage: 4, failResume: false, resumeBodies: [] as Record<string, unknown>[], holdResume: false, releaseResume: null as (() => void) | null, holdPlan: false, releasePlan: null as (() => void) | null, losePlanReply: false, omitPlanSave: false, rejectPlan: false, loseBindingReply: false, failMapping: false, failParent: false, requests: [] as { name: string; body: Record<string, unknown> }[], empty: false, failCaptures: false, failHistory: false, failItems: false, failProgress: false, failRuns: false, stale: false, holdItems: false, releaseItems: null as (() => void) | null, calls: [] as string[] };
  await page.route("**/*", route => new URL(route.request().url()).origin === "http://127.0.0.1:8080" ? route.continue() : route.abort());
  await page.route("http://127.0.0.1:54321/**", async route => {
    const path = new URL(route.request().url()).pathname, body = route.request().method() === "POST" ? route.request().postDataJSON() : {};
    if (path === "/auth/v1/user") return route.fulfill({ json: user });
    if (path === "/auth/v1/token") return route.fulfill({ json: session });
    if (path === "/auth/v1/logout") return route.fulfill({ json: {} });
    if (path === "/rest/v1/profiles") return route.fulfill({ json: [{ id: actor, first_name: "Synthetic", last_name: "Admin", full_name: "Synthetic Admin", is_active: true, role: admin ? "ADMIN" : "STAFF" }] });
    if (path === "/rest/v1/user_roles") return route.fulfill({ json: [{ role: admin ? "ADMIN" : "STAFF" }] });
    if (path === "/rest/v1/ezyvet_record_links") return state.failMapping ? route.fulfill({ status: 403, json: { message: "Unavailable" } }) : route.fulfill({ json: [{ id: mapping, resource: "animal", client_id: client, pet_id: pet, external_id: "77", snapshot_id: snapshot, head_version: 1, source_origin: origin, source_site_uid: site }] });
    if (path === "/rest/v1/clients") return route.fulfill({ json: [{ id: client, full_name: "Synthetic household" }] });
    if (path === "/rest/v1/pets") return route.fulfill({ json: [{ id: pet, name: "Synthetic patient", client_id: client }] });
    if (path === "/rest/v1/ezyvet_import_snapshots") return state.failParent ? route.fulfill({ status: 503, json: { message: "Unavailable" } }) : route.fulfill({ json: [{ id: new URL(route.request().url()).searchParams.get("resource") === "eq.consult" ? id(70) : snapshot, external_id: "77" }] });
    if (path === "/rest/v1/ezyvet_identity_heads") return route.fulfill({ json: [{ snapshot_id: new URL(route.request().url()).searchParams.get("resource") === "eq.consult" ? id(70) : snapshot, external_id: "77", version: 1 }] });
    if (path === "/rest/v1/ezyvet_import_runs") return route.fulfill({ json: [{ id: id(50), requested_by: actor, source_origin: origin, source_site_uid: site, resource: "attachment", status: "running", created_at: at }] });
    if (path === "/functions/v1/ezyvet-import") {
      state.resumeBodies.push(body);
      if (state.holdResume) await new Promise<void>(resolve => { state.releaseResume = resolve; });
      state.resumePage++;
      return state.failResume ? route.fulfill({ status: 503, json: { error: "Synthetic lost reply" } }) : route.fulfill({ json: { run_id: child, status: "running", next_page: state.resumePage, review_only: true, complete: false } });
    }
    const rpc = path.split("/").at(-1)!;
    if (path.includes("/rpc/")) state.calls.push(rpc);
    const unavailable = () => route.fulfill({ status: 503, json: { message: "Synthetic unavailable" } });
    if (rpc === "recover_ezyvet_attachment_run") return route.fulfill({ json: { id: child, requested_by: actor, source_origin: origin, source_site_uid: site, resource: "attachment", status: state.resumeRunning ? "running" : "review_ready", next_page: state.resumePage, retry_after: state.resumeRetry, lease_active: state.resumeLease, parent_context: { animal_link_id: mapping, pet_id: pet, client_id: client, parent_snapshot_id: snapshot, parent_payload_hash: "a".repeat(64), parent_observed_head_version: 1 } } });
    if (rpc === "list_ezyvet_attachment_runs") return route.fulfill({ json: { runs: [{ id: id(50), requested_by: actor, source_origin: origin, source_site_uid: site, resource: "attachment", status: "running", created_at: at, parent_context: { animal_link_id: mapping, pet_id: pet, client_id: client, parent_snapshot_id: snapshot, parent_observed_head_version: 1 } }], has_more: false, next_cursor: null } });
    if (rpc === "prepare_ezyvet_migration_run") {
      state.requests.push({ name: rpc, body });
      if (state.rejectPlan) return route.fulfill({ status: 409, json: { code: "40001", message: "Parent changed" } });
      const scopes = body.p_scopes;
      const saved = { run: { ...summary, id: body.p_id, actor_id: actor, intent: { version: 1, source_origin: body.p_source_origin, source_site_uid: body.p_source_site_uid, scopes } }, scopes: scopes.map(s => ({ ...s, migration_run_id: body.p_id, mapping_snapshot_id: snapshot, mapping_head_version: 1, client_id: client, pet_id: pet, parent_external_id: "77", parent_payload_hash: "a".repeat(64) })), scope_manifest_version: 1, scope_manifest_hash: "b".repeat(64) };
      if (!state.omitPlanSave) savedPlans.set(body.p_id, saved);
      if (state.holdPlan) await new Promise<void>(resolve => { state.releasePlan = resolve; });
      return state.losePlanReply ? unavailable() : route.fulfill({ json: saved });
    }
    if (rpc === "bind_ezyvet_migration_child") {
      state.requests.push({ name: rpc, body });
      const saved = { ...binding, id: body.p_id, scope_id: body.p_scope_id, child_run_id: body.p_child_run_id, reason: body.p_reason, replaces_id: body.p_replaces_id, child_context: { ...binding.child_context, run_id: body.p_child_run_id } };
      savedBindings.set(body.p_id, saved);
      return state.loseBindingReply ? unavailable() : route.fulfill({ json: saved });
    }
    if (rpc === "list_ezyvet_migration_runs") return state.failRuns ? unavailable() : route.fulfill({ json: { runs: state.empty ? [] : [...savedPlans.values()].map(m => ({ id: m.run.id, source_origin: m.run.source_origin, source_site_uid: m.run.source_site_uid, intent_hash: m.run.intent_hash, created_at: m.run.created_at })).concat([summary]), has_more: false } });
    if (rpc === "read_ezyvet_migration_run") return route.fulfill({ json: body.p_id === runId ? manifest : savedPlans.get(body.p_id) ?? null });
    if (rpc === "list_ezyvet_migration_bindings") return route.fulfill({ json: { bindings: body.p_scope_id === scopeId ? (body.p_limit === 1 ? [...savedBindings.values()].concat([binding]).slice(0,1) : [...savedBindings.values()].concat([binding])) : [], has_more: body.p_limit === 1 && savedBindings.size > 0 } });
    if (rpc === "read_ezyvet_migration_binding") return route.fulfill({ json: body.p_id === bindingId ? binding : savedBindings.get(body.p_id) ?? null });
    if (rpc === "read_ezyvet_migration_binding_progress") return state.failProgress ? unavailable() : route.fulfill({ json: {
      version: 2, binding_id: bindingId, scope_id: scopeId, migration_run_id: runId, child_run_id: child, resource, context_hash: binding.context_hash,
      superseded: false, parent_evidence: parentEvidence, parent_current: !state.stale, household_current: true,
      scan: { status: state.resumeRunning ? "running" : "review_ready", next_page: state.resumePage, pages_observed: 3, traversal_ended: !state.resumeRunning, page_limit_reached: false, retry_after: null, latest_error_code: null, provider_total: null, complete_coverage_verified: false },
      observations: { occurrences: history ? 1 : 21, distinct_source_identities: 1, distinct_snapshot_versions: 1, occurrence_fidelity: history ? "deduplicated_page_snapshot" : "page_ordinal", exact_current_occurrences: state.stale ? 0 : history ? 1 : 21, currentness_available: true },
      clinical_review: { reconciled: false, approved_local_outcomes: null }, attempt_history_available: true,
      attempt_history: { origin: "run_created", started_at: at, complete_since_run_creation: true, claims: 3, failed_pages: 0, staged_pages: 3 }, observed_at: at } });
    if (rpc === "list_ezyvet_migration_history_evidence") return state.failHistory ? unavailable() : route.fulfill({ json: {
      version: 1, binding_id: bindingId, scope_id: scopeId, child_run_id: child, actor_id: actor, page: body.p_page, snapshot_id: body.p_snapshot_id, evidence_hash: body.p_evidence_hash,
      visibility: "approved_patient_history", has_more: false, next_before_version: null, discrepancies_assessed: false, complete_coverage_verified: false, observed_at: at,
      approvals: [{ id: id(50), version: 2, version_hash: "d".repeat(64), approved_at: at, relationship: "different_source_version", source_current: false, superseded: false, consult_status: "unresolved", extraction_receipts: 2, locally_edited_receipts: 1 },
        { id: id(51), version: 1, version_hash: "e".repeat(64), approved_at: at, relationship: "exact_source_version", source_current: false, superseded: true, consult_status: "not_referenced", extraction_receipts: 1, locally_edited_receipts: 1 }] } });
    if (rpc === "list_ezyvet_migration_capture_evidence") return state.failCaptures ? unavailable() : route.fulfill({ json: {
      version: 1, binding_id: bindingId, scope_id: scopeId, child_run_id: child, actor_id: actor, page: body.p_page, ordinal: body.p_ordinal, snapshot_id: body.p_snapshot_id, evidence_hash: body.p_evidence_hash,
      ownership: "current_actor_only", has_more: false, next_cursor: null, original_bytes_reverified: false, complete_coverage_verified: false, observed_at: at,
      captures: [{ request_id: id(30), created_at: at, status: "ready", relationship: "exact_occurrence", source_current: !state.stale, retry_after: null, latest_error_code: null,
        capture: { id: id(31), capture_hash: "d".repeat(64), content_sha256: "e".repeat(64), mime_type: "application/pdf", file_size: 12, captured_at: at },
        approved_versions: 1, canceled_unconfirmed_decisions: 1, latest_approval: { id: id(32), version: 1, record_hash: "f".repeat(64), created_at: at, superseded: false } }] } });
    if (rpc === "list_ezyvet_migration_items") {
      if (state.holdItems) await new Promise<void>(resolve => { state.releaseItems = resolve; });
      if (state.failItems) return unavailable();
      const start = body.p_after_page ? 20 : 0, count = history ? 1 : Math.min(start ? 1 : 20, body.p_limit ?? 20);
      const items = Array.from({ length: count }, (_, index) => ({ page: Math.floor((start + index) / 10) + 1, ordinal: history ? 0 : (start + index) % 10 + 1, snapshot_id: snapshot,
        observed_head_version: 1, external_id: "701", payload_hash: "a".repeat(64), file_id: history ? null : "42", raw_record_sha256: history ? null : "b".repeat(64), stable_metadata_sha256: history ? null : "c".repeat(64), evidence_hash: (start + index + 1).toString(16).padStart(64, "0"),
        current_snapshot_id: snapshot, current_head_version: state.stale ? 3 : 1, payload_current: true, exact_source_current: !state.stale }));
      return route.fulfill({ json: { version: 1, binding_id: bindingId, scope_id: scopeId, migration_run_id: runId, child_run_id: child, resource, context_hash: binding.context_hash,
        superseded: false, mapping_matches_manifest: true, mapping_source_current: !state.stale, parent_current: !state.stale, household_current: true, occurrence_fidelity: history ? "deduplicated_page_snapshot" : "page_ordinal", review_reconciled: false, complete_coverage_verified: false,
        observed_at: at, items, has_more: !history && !start, next_cursor: history || start ? null : { page: items.at(-1)!.page, ordinal: items.at(-1)!.ordinal, snapshot_id: snapshot } } });
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

async function draftPlan(page: Page) {
  const builder = page.getByRole("region", { name: "New migration scope" });
  await builder.getByRole("button", { name: "Plan a migration", exact: true }).click();
  await builder.getByRole("button", { name: /Synthetic patient · Synthetic household/ }).click();
  await builder.getByLabel("Migration resource", { exact: true }).selectOption("attachment");
  await builder.getByRole("button", { name: "Source parent #77 · version 1", exact: true }).click();
  await builder.getByLabel("Scope reason", { exact: true }).fill("Review original files for this patient");
  await builder.getByRole("button", { name: "Add resource to scope" }).click();
  await builder.getByLabel("I reviewed the listed patients, source parents and coverage decisions.").check();
  return builder;
}
for (const width of [390, 1440]) test(`scope creation recovers a lost reply at ${width}px without duplicating a request`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 }); const state = await fixture(page); state.losePlanReply = true;
  const builder = await draftPlan(page);
  await builder.getByRole("button", { name: "Save migration scope", exact: true }).click();
  await expect(builder.getByText(/Save could not be confirmed/)).toBeVisible();
  await expect(builder.getByLabel("Migration resource", { exact: true })).toBeDisabled();
  await expect(builder.getByRole("button", { name: "Retry same plan" })).toBeDisabled();
  await builder.getByRole("button", { name: "Check plan save status" }).click();
  await expect(page.getByRole("region", { name: "Saved migration scope" }).getByText("Review original files for this patient", { exact: true })).toBeVisible();
  expect(state.requests).toHaveLength(1);
  expect(state.requests[0].body.p_scopes).toMatchObject([{ resource: "attachment", parent_type: "animal", parent_head_version: 1 }]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: `/tmp/lrv-migration-created-${width}.png` });
});
test("absent plan receipt allows only an identical retry", async ({ page }) => {
  const state = await fixture(page); state.losePlanReply = true; state.omitPlanSave = true;
  const builder = await draftPlan(page);
  await builder.getByRole("button", { name: "Save migration scope", exact: true }).click();
  await builder.getByRole("button", { name: "Check plan save status" }).click();
  await expect(builder.getByRole("button", { name: "Retry same plan" })).toBeEnabled();
  state.losePlanReply = false; state.omitPlanSave = false;
  await builder.getByRole("button", { name: "Retry same plan" }).click();
  await expect(page.getByRole("region", { name: "Saved migration scope" })).toBeVisible();
  expect(state.requests[0].body).toEqual(state.requests[1].body);
});
test("scope draft protects navigation and confirmed rejection unlocks corrections", async ({ page }) => {
  const state = await fixture(page); state.rejectPlan = true;
  const builder = await draftPlan(page);
  await page.getByRole("button", { name: "Clients", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.getByRole("button", { name: "Stay with this run" }).click();
  await builder.getByRole("button", { name: "Save migration scope", exact: true }).click();
  await expect(builder.getByText(/database rejected this scope/)).toBeVisible();
  await expect(builder.getByLabel("Migration resource", { exact: true })).toBeEnabled();
  await expect(builder.getByLabel("I reviewed the listed patients, source parents and coverage decisions.")).not.toBeChecked();
});
test("binding recovery retains exact predecessor and protects scope switching", async ({ page }) => {
  const state = await fixture(page); state.loseBindingReply = true;
  const workspace = await openEvidence(page);
  const form = page.getByRole("region", { name: "Bind source run" });
  await form.getByRole("button", { name: "Bind an existing source run" }).click();
  await form.getByRole("button", { name: /Run 00000000/ }).click();
  await form.getByLabel("Binding reason", { exact: true }).fill("Reviewed replacement source run");
  await form.getByLabel("I reviewed this patient, household, source parent and any preceding binding.").check();
  await expect(workspace.getByRole("button", { name: /Inspect history scope/ })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Plan a migration", exact: true })).toBeDisabled();
  await form.getByRole("button", { name: "Save source binding", exact: true }).click();
  await expect(form.getByText(/Binding could not be confirmed/)).toBeVisible();
  await form.getByRole("button", { name: "Check binding save status" }).click();
  await expect(workspace.getByText("Reviewed replacement source run", { exact: true })).toBeVisible();
  expect(state.requests).toHaveLength(1);
  expect(state.requests[0].body).toMatchObject({ p_scope_id: scopeId, p_child_run_id: id(50), p_replaces_id: bindingId });
  expect(state.calls.some(n => n.startsWith("claim_") || n.startsWith("stage_"))).toBe(false);
});
test("mapping lookup failure is explicit and can recover", async ({ page }) => {
  const state = await fixture(page); state.failMapping = true;
  const builder = page.getByRole("region", { name: "New migration scope" });
  await builder.getByRole("button", { name: "Plan a migration", exact: true }).click();
  await expect(builder.getByText(/Approved mappings could not be loaded/)).toBeVisible();
  await expect(builder.getByText("No approved mappings on this page.")).toHaveCount(0);
  state.failMapping = false;
  await builder.getByRole("button", { name: "Retry mappings" }).click();
  await expect(builder.getByRole("button", { name: /Synthetic patient · Synthetic household/ })).toBeVisible();
});
test("a pending plan reply cannot restore private workspace after sign-out", async ({ page }) => {
  const state = await fixture(page); state.holdPlan = true;
  const builder = await draftPlan(page);
  await builder.getByRole("button", { name: "Save migration scope", exact: true }).click();
  await expect.poll(() => state.releasePlan !== null).toBe(true);
  await page.getByRole("button", { name: /Sign out/i }).click(); state.releasePlan!();
  await expect(page).toHaveURL(/\/hub\/login/);
  await expect(page.getByRole("region", { name: "Migration reconciliation" })).toHaveCount(0);
});
test("unsupported consultation attachments remain explicit and cannot be required", async ({ page }) => {
  await fixture(page);
  const builder = await draftPlan(page);
  await builder.getByLabel("Attachment source parent", { exact: true }).selectOption("consult");
  await builder.getByRole("button", { name: "Source parent #77 · version 1", exact: true }).click();
  await builder.getByLabel("Scope reason", { exact: true }).fill("Consultation attachment contract unavailable");
  await expect(builder.getByRole("button", { name: "Add resource to scope" })).toBeDisabled();
  await builder.getByLabel("Coverage decision", { exact: true }).selectOption("unsupported");
  await builder.getByRole("button", { name: "Add resource to scope" }).click();
  await expect(builder.getByText("Consultation attachment contract unavailable", { exact: true })).toBeVisible();
});
test("one saved scope includes two patients and an explicit exclusion", async ({ page }) => {
  const state = await fixture(page);
  await page.route("**/rest/v1/ezyvet_record_links?**", route => route.fulfill({ json: [
    { id: mapping, resource: "animal", client_id: client, pet_id: pet, external_id: "77", snapshot_id: snapshot, head_version: 1, source_origin: origin, source_site_uid: site },
    { id: id(61), resource: "animal", client_id: client, pet_id: id(62), external_id: "88", snapshot_id: id(63), head_version: 1, source_origin: origin, source_site_uid: site },
  ] }));
  await page.route("**/rest/v1/pets?**", route => route.fulfill({ json: [{ id: pet, name: "Synthetic patient", client_id: client }, { id: id(62), name: "Second patient", client_id: client }] }));
  await page.route("**/rest/v1/ezyvet_import_snapshots?**", route => {
    const second = new URL(route.request().url()).searchParams.get("external_id") === "eq.88";
    return route.fulfill({ json: [{ id: second ? id(63) : snapshot, external_id: second ? "88" : "77" }] });
  });
  await page.route("**/rest/v1/ezyvet_identity_heads?**", route => route.fulfill({ json: [{ snapshot_id: snapshot, external_id: "77", version: 1 }, { snapshot_id: id(63), external_id: "88", version: 1 }] }));
  const builder = await draftPlan(page);
  await builder.getByRole("button", { name: /Second patient · Synthetic household/ }).click();
  await builder.getByLabel("Migration resource", { exact: true }).selectOption("history");
  await builder.getByRole("button", { name: "Source parent #88 · version 1" }).click();
  await builder.getByLabel("Coverage decision", { exact: true }).selectOption("excluded");
  await builder.getByLabel("Scope reason", { exact: true }).fill("Second patient history awaits clinical scope approval");
  await builder.getByRole("button", { name: "Add resource to scope" }).click();
  await builder.getByLabel("I reviewed the listed patients, source parents and coverage decisions.").check();
  await builder.getByRole("button", { name: "Save migration scope", exact: true }).click();
  await expect(page.getByRole("region", { name: "Saved migration scope" }).getByText("Second patient history awaits clinical scope approval", { exact: true })).toBeVisible();
  expect(state.requests[0].body.p_scopes).toMatchObject([{ mapping_id: mapping, resource: "attachment", disposition: "required" }, { mapping_id: id(61), resource: "history", disposition: "excluded" }]);
});
async function recoverResume(page: Page) {
  await openEvidence(page);
  const form = page.getByRole("region", { name: "Resume saved migration run" });
  await form.getByRole("button", { name: "Recover run before resume", exact: true }).click();
  await expect(form.getByText(/Saved run recovered/)).toBeVisible();
  return form;
}
test("explicit migration resume uses the exact saved run once and requires recovery", async ({ page }) => {
  const state = await fixture(page); state.resumeRunning = true; state.failResume = true;
  const form = await recoverResume(page);
  await form.getByLabel("I reviewed this saved source run and want to request one more page.").check();
  await form.getByRole("button", { name: "Resume one page", exact: true }).click();
  await expect(form.getByText(/Resume was not confirmed/)).toBeVisible();
  await expect(form.getByRole("button", { name: "Resume one page", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Plan a migration", exact: true })).toBeDisabled();
  await form.getByRole("button", { name: "Recover run before resume", exact: true }).click();
  await expect(form.getByText(/next page 5/)).toBeVisible();
  await expect(form.getByRole("button", { name: "Resume one page", exact: true })).toBeDisabled();
  expect(state.resumeBodies).toEqual([{ run_id: child, resource: "attachment", animal_link_id: mapping }]);
});
test("completed runs and active cooldowns remain recoverable without sending requests", async ({ page }) => {
  const state = await fixture(page), form = await recoverResume(page);
  await expect(form.getByText(/Traversal has ended/)).toBeVisible();
  await expect(form.getByRole("button", { name: "Resume one page", exact: true })).toBeDisabled();
  state.resumeRunning = true; state.resumeRetry = "2099-01-01T00:00:00Z";
  await form.getByRole("button", { name: "Recover run before resume", exact: true }).click();
  await expect(form.getByText(/cooling down/)).toBeVisible();
  expect(state.resumeBodies).toHaveLength(0);
});
test("source drift after resume review is caught before importer invocation", async ({ page }) => {
  const state = await fixture(page); state.resumeRunning = true;
  const form = await recoverResume(page);
  await form.getByLabel("I reviewed this saved source run and want to request one more page.").check();
  state.stale = true;
  await form.getByRole("button", { name: "Resume one page", exact: true }).click();
  await expect(form.getByText(/Resume was not confirmed or the run changed/)).toBeVisible();
  expect(state.resumeBodies).toHaveLength(0);
});
test("late resume reply cannot restore private workspace after signout", async ({ page }) => {
  const state = await fixture(page); state.resumeRunning = true; state.holdResume = true;
  const form = await recoverResume(page);
  await form.getByLabel("I reviewed this saved source run and want to request one more page.").check();
  await form.getByRole("button", { name: "Resume one page", exact: true }).click();
  await expect.poll(() => !!state.releaseResume).toBe(true);
  await page.getByRole("button", { name: /Sign out/i }).click(); state.releaseResume!();
  await expect(page).toHaveURL(/\/hub\/login/);
  await expect(page.getByRole("region", { name: "Migration reconciliation" })).toHaveCount(0);
  expect(state.resumeBodies).toHaveLength(1);
});
for (const width of [390, 1440]) test(`saved resume controls at ${width}px require explicit action and recovery`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  const state = await fixture(page); state.resumeRunning = true;
  const form = await recoverResume(page);
  await form.getByLabel("I reviewed this saved source run and want to request one more page.").check();
  await form.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: `/tmp/lrv-migration-resume-${width}.png` });
  await form.getByRole("button", { name: "Resume one page", exact: true }).click();
  await expect(form.getByText(/One importer request returned/)).toBeVisible();
  await expect(form.getByRole("button", { name: "Resume one page", exact: true })).toBeDisabled();
  expect(state.resumeBodies).toHaveLength(1);
  await form.getByRole("button", { name: "Recover run before resume", exact: true }).click();
  await expect(form.getByText(/next page 5/)).toBeVisible();
  await expect(form.getByLabel("I reviewed this saved source run and want to request one more page.")).not.toBeChecked();
});

for (const width of [390, 1440]) test(`history evidence preserves corrections and local edits at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1100 }); const state = await fixture(page, true, true);
  const workspace = page.getByRole("region", { name: "Migration reconciliation" });
  await workspace.getByRole("button", { name: "Browse saved migrations" }).click();
  await workspace.getByRole("button", { name: /Open migration/ }).click();
  await workspace.getByRole("button", { name: /Inspect history scope/ }).first().click();
  await workspace.getByRole("button", { name: /Inspect attempt/ }).click();
  state.failHistory = true;
  await workspace.getByRole("button", { name: /Evidence references for source/ }).click();
  const panel = workspace.getByRole("region", { name: "History review evidence" });
  await expect(panel.getByRole("alert")).toContainText("could not be loaded");
  await expect(panel.getByText(/No approved history/)).toHaveCount(0);
  state.failHistory = false;
  await panel.getByRole("button", { name: "Refresh history evidence" }).click();
  await expect(panel.getByText(/Version 1 · Replaced by a later approval/)).toBeVisible();
  await expect(panel.getByText("Matches this observed source version.")).toBeVisible();
  await expect(panel.getByText("Reviews a different version of the same source record.")).toBeVisible();
  await expect(panel.getByText("Local finding extraction receipts: 2. Edited since extraction: 1.")).toBeVisible();
  await expect(panel.getByText(/unresolved consult reference/)).toBeVisible();
  await expect(panel.getByRole("button", { name: "Next history evidence" })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await panel.screenshot({ path: `docs/evidence/migration-history-${width === 390 ? "mobile" : "desktop"}-20260914.png` });
});
