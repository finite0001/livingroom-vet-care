import { test, expect, type Page } from "@playwright/test";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const actor = id(1), run = id(2), scope = id(3), snapshot = id(4), mapping = id(5), client = id(6);
const at = "2026-09-15T12:00:00Z", origin = "https://api.trial.ezyvet.com", site = "Synthetic decision source";
async function fixture(page: Page, observation = false) {
  const user = { id: actor, aud: "authenticated", role: "authenticated", email: "synthetic@example.test", app_metadata: { provider: "email", providers: ["email"] }, user_metadata: {}, created_at: at };
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const session = { access_token: `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ sub: actor, exp, role: "authenticated", aud: "authenticated" })).toString("base64url")}.synthetic`, refresh_token: "synthetic", token_type: "bearer", expires_in: 3600, expires_at: exp, user };
  await page.addInitScript(s => localStorage.setItem("sb-127-auth-token", JSON.stringify(s)), session);
  const input = { id: scope, mapping_id: mapping, resource: "contact", parent_type: "contact", parent_snapshot_id: snapshot, parent_head_version: 1, disposition: "required", reason: "Required source contact" };
  const summary = { id: run, source_origin: origin, source_site_uid: site, intent_hash: "a".repeat(64), created_at: at };
  const savedScope = { ...input, migration_run_id: run, mapping_snapshot_id: snapshot, mapping_head_version: 1, client_id: client, pet_id: null, parent_external_id: "77", parent_payload_hash: "a".repeat(64) };
  const manifest = { run: { ...summary, actor_id: actor, intent: { version: 1, source_origin: origin, source_site_uid: site, scopes: [input] } }, scopes: [savedScope], scope_manifest_version: 1, scope_manifest_hash: "b".repeat(64) };
  const { reason: _reason, parent_external_id: _external, parent_payload_hash: _payload, ...contextScope } = savedScope;
  const context = { version: 1, manifest_hash: "b".repeat(64), source_origin: origin, source_site_uid: site, scope: contextScope,
    binding: { selected_id: null, selected_context_hash: null, current_id: null, current_context_hash: null, child_run_id: null, superseded: false },
    mapping: { current_snapshot_id: snapshot, current_head_version: 1 }, parent: { current_snapshot_id: snapshot, current_head_version: 1 },
    local: { client_exists: true, client_version: 1, pet_exists: null, pet_version: null, household_current: true }, scan: null, observation: null };
  const binding = { id: id(10), scope_id: scope, child_run_id: id(11), actor_id: actor, replaces_id: null, reason: "Saved source attempt", context_hash: "1".repeat(64), created_at: at,
    child_context: { version: 1, run_id: id(11), owner: actor, source_origin: origin, source_site_uid: site, resource: "contact", parent_evidence: "selected_identity_filter", context: {} } };
  const item = { page: 1, ordinal: 0, snapshot_id: snapshot, observed_head_version: null, external_id: "77", payload_hash: "a".repeat(64), file_id: null, raw_record_sha256: null, stable_metadata_sha256: null, evidence_hash: "2".repeat(64), current_snapshot_id: snapshot, current_head_version: 1, payload_current: true, exact_source_current: null };
  const selectedContext = (t: { kind: string }) => observation ? { ...context, binding: { selected_id: binding.id, selected_context_hash: binding.context_hash, current_id: binding.id, current_context_hash: binding.context_hash, child_run_id: binding.child_run_id, superseded: false }, scan: { status: "running", next_page: 2, retry_after: null, error_code: null, attempt_sequence: 1 }, observation: t.kind === "observation" ? Object.fromEntries(Object.entries(item).filter(([key]) => !["payload_current", "exact_source_current"].includes(key))) : null } : context;
  const flags = { clinical_approval_performed: false, complete_coverage_verified: false };
  const state = { loseReply: false, omitSave: false, reject: false, failContext: false, failRecovery: false, holdSave: false, release: null as (() => void) | null, requests: [] as Record<string, unknown>[], receipts: [] as Record<string, unknown>[] };
  await page.route("**/*", route => new URL(route.request().url()).origin === "http://127.0.0.1:8080" ? route.continue() : route.abort());
  await page.route("http://127.0.0.1:54321/**", async route => {
    const path = new URL(route.request().url()).pathname, body = route.request().method() === "POST" ? route.request().postDataJSON() : {};
    if (path === "/auth/v1/user") return route.fulfill({ json: user });
    if (path === "/auth/v1/token") return route.fulfill({ json: session });
    if (path === "/auth/v1/logout") return route.fulfill({ json: {} });
    if (path === "/rest/v1/profiles") return route.fulfill({ json: [{ id: actor, first_name: "Synthetic", last_name: "Admin", full_name: "Synthetic Admin", is_active: true, role: "ADMIN" }] });
    if (path === "/rest/v1/user_roles") return route.fulfill({ json: [{ role: "ADMIN" }] });
    const rpc = path.split("/").at(-1);
    if (rpc === "list_ezyvet_migration_runs") return route.fulfill({ json: { runs: [summary], has_more: false } });
    if (rpc === "read_ezyvet_migration_run") return route.fulfill({ json: manifest });
    if (rpc === "list_ezyvet_migration_bindings") return route.fulfill({ json: { bindings: observation ? [binding] : [], has_more: false } });
    if (rpc === "read_ezyvet_migration_binding") return route.fulfill({ json: binding });
    if (rpc === "list_ezyvet_migration_items") return route.fulfill({ json: { version: 1, binding_id: binding.id, scope_id: scope, migration_run_id: run, child_run_id: binding.child_run_id, context_hash: binding.context_hash, resource: "contact", superseded: false, mapping_matches_manifest: true, mapping_source_current: true, parent_current: true, household_current: true, occurrence_fidelity: "deduplicated_page_snapshot", review_reconciled: false, complete_coverage_verified: false, observed_at: at, items: [item], has_more: false, next_cursor: null } });
    const unavailable = () => route.fulfill({ status: 503, json: { message: "Synthetic unavailable" } });
    if (rpc === "read_ezyvet_migration_resolution_context") return state.failContext ? unavailable() : route.fulfill({ json: { version: 1, actor_id: actor, scope_id: scope, target: body.p_target, target_key: "c".repeat(64), context: selectedContext(body.p_target), context_hash: "d".repeat(64), latest: state.receipts.at(-1) ?? null, ...flags, observed_at: at } });
    if (rpc === "save_ezyvet_migration_resolution") {
      state.requests.push(body);
      if (state.reject) return route.fulfill({ status: 409, json: { code: "40001", message: "Stale context" } });
      const receipt = { receipt_version: 1, id: body.p_id, actor_id: actor, migration_run_id: run, scope_id: scope, target_kind: body.p_target.kind, binding_id: body.p_target.binding_id, page: body.p_target.page, ordinal: body.p_target.ordinal, snapshot_id: body.p_target.snapshot_id, evidence_hash: body.p_target.evidence_hash,
        target_key: "c".repeat(64), action: body.p_action, reason: body.p_reason, request_hash: "e".repeat(64), reviewed_context: selectedContext(body.p_target), reviewed_context_hash: body.p_expected_context_hash,
        replaces_id: body.p_replaces_id, version: state.receipts.length + 1, record_hash: "f".repeat(64), created_at: new Date(Date.parse(at) + state.receipts.length * 1000).toISOString() };
      if (!state.omitSave) state.receipts.push(receipt);
      if (state.holdSave) await new Promise<void>(resolve => { state.release = resolve; });
      return state.loseReply ? unavailable() : route.fulfill({ json: receipt });
    }
    if (rpc === "read_ezyvet_migration_resolution") return state.failRecovery ? unavailable() : route.fulfill({ json: state.receipts.find(row => row.id === body.p_id) ?? null });
    if (rpc === "list_ezyvet_migration_resolutions") return route.fulfill({ json: { version: 1, actor_id: actor, scope_id: scope, target: body.p_target, target_key: "c".repeat(64), resolutions: state.receipts.slice().reverse().map((receipt, n) => ({ receipt, superseded: n > 0, context_current: true })), has_more: false, next_cursor: null, ...flags, observed_at: at } });
    return route.fulfill({ json: [] });
  });
  await page.goto("/hub/tools/ezyvet");
  await page.getByRole("button", { name: "Browse saved migrations" }).click();
  await page.getByRole("button", { name: /Open migration/ }).click();
  await page.getByRole("button", { name: /Inspect contacts scope/ }).click();
  return state;
}
async function prepare(page: Page) {
  const form = page.getByRole("region", { name: "Scope operational decision", exact: true });
  await form.getByRole("button", { name: "Refresh decision context" }).click();
  await expect(form.getByText("No source attempt is bound. Unfetched coverage remains unknown.")).toBeVisible();
  await form.getByLabel("Decision reason").fill("Scope intentionally omitted pending source review");
  await form.getByRole("checkbox").check();
  return form;
}
for (const width of [390, 1440]) {
  test(`scope without binding saves exclusion and reopens with exact predecessor at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const state = await fixture(page), form = await prepare(page);
    await expect(page.getByRole("button", { name: /Inspect contacts scope/ })).toBeDisabled();
    await form.getByRole("button", { name: "Save operational decision" }).click();
    await expect(form.getByText(/Decision saved\./)).toBeVisible();
    await expect(page.getByRole("button", { name: /Inspect contacts scope/ })).toBeEnabled();
    await form.getByRole("button", { name: "Show decision history" }).click();
    await expect(form.getByText("Excluded operationally · Version 1")).toBeVisible();
    await form.getByRole("button", { name: "Refresh decision context" }).click();
    await form.getByLabel("Operational action").selectOption("reopen");
    await form.getByLabel("Decision reason").fill("Ready for operational review");
    await form.getByRole("checkbox").check();
    await form.getByRole("button", { name: "Save operational decision" }).click();
    await expect.poll(() => state.receipts.length).toBe(2);
    expect(state.requests[1].p_replaces_id).toBe(state.receipts[0].id);
    expect(state.requests[1].p_action).toBe("reopen");
    await expect(form.getByText("Original disposition:")).toContainText("required");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
  test(`lost save recovers original receipt and keeps draft locked at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const state = await fixture(page); state.loseReply = true;
    const form = await prepare(page);
    await form.getByRole("button", { name: "Save operational decision" }).click();
    await expect(form.getByText(/save result is uncertain/)).toBeVisible();
    await expect(form.getByLabel("Decision reason")).toBeDisabled();
    await expect(page.getByRole("button", { name: "Refresh saved migrations" })).toBeDisabled();
    await form.getByRole("button", { name: "Recover saved decision" }).click();
    await expect(form.getByText(/Decision saved\./)).toBeVisible();
    expect(state.requests).toHaveLength(1);
  });
}
test("null recovery retries exact UUID and payload; recovery failure stays locked", async ({ page }) => {
  const state = await fixture(page); state.loseReply = true; state.omitSave = true;
  const form = await prepare(page);
  await form.getByRole("button", { name: "Save operational decision" }).click();
  await expect(form.getByText(/save result is uncertain/)).toBeVisible();
  state.failRecovery = true;
  await form.getByRole("button", { name: "Recover saved decision" }).click();
  await expect(form.getByText(/Recovery is unavailable/)).toBeVisible();
  await expect(form.getByLabel("Decision reason")).toBeDisabled();
  state.failRecovery = false;
  await form.getByRole("button", { name: "Recover saved decision" }).click();
  await expect(form.getByText(/No receipt was found yet/)).toBeVisible();
  state.loseReply = false; state.omitSave = false;
  await form.getByRole("button", { name: "Retry identical decision" }).click();
  await expect(form.getByText(/Decision saved\./)).toBeVisible();
  expect(state.requests[1]).toEqual(state.requests[0]);
});
test("failed context and stale rejection require fresh review; draft can be discarded", async ({ page }) => {
  const state = await fixture(page); state.failContext = true;
  const form = page.getByRole("region", { name: "Scope operational decision", exact: true });
  await form.getByRole("button", { name: "Refresh decision context" }).click();
  await expect(form.getByText(/context could not be loaded/)).toBeVisible();
  expect(state.requests).toHaveLength(0);
  state.failContext = false; await prepare(page); state.reject = true;
  await form.getByRole("button", { name: "Save operational decision" }).click();
  await expect(form.getByText(/decision was rejected/)).toBeVisible();
  await expect(form.getByRole("button", { name: "Save operational decision" })).toHaveCount(0);
  await form.getByRole("button", { name: "Discard unsaved decision" }).click();
  await expect(page.getByRole("button", { name: /Inspect contacts scope/ })).toBeEnabled();
});

test("sign-out while save is pending ignores the late receipt", async ({ page }) => {
  const state = await fixture(page); state.holdSave = true;
  const form = await prepare(page);
  await form.getByRole("button", { name: "Save operational decision" }).click();
  await expect.poll(() => !!state.release).toBe(true);
  await page.getByRole("button", { name: /Sign out/i }).click();
  state.release!();
  await expect(page).toHaveURL(/\/hub\/login/);
  await expect(page.getByText(/Decision saved\./)).toHaveCount(0);
});

for (const width of [390, 1440]) test(`exact observation uncertainty locks competing controls at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  const state = await fixture(page, true); state.loseReply = true;
  await page.getByRole("button", { name: /Inspect attempt/ }).click();
  await page.getByRole("button", { name: /Evidence references for source/ }).click();
  const form = page.getByRole("region", { name: "Observation operational decision", exact: true });
  await form.getByRole("button", { name: "Refresh decision context" }).click();
  await expect(form.getByText(/exact version fidelity is unknown/)).toBeVisible();
  await form.getByLabel("Decision reason").fill("Omit only this occurrence pending source review");
  await form.getByRole("checkbox").check();
  await expect(page.getByRole("button", { name: /Evidence references for source/ })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Refresh source evidence" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Recover run before resume" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Next source item page" })).toBeDisabled();
  await expect(page.getByRole("region", { name: "Scope operational decision", exact: true }).getByRole("button", { name: "Refresh decision context" })).toBeDisabled();
  await form.getByRole("button", { name: "Save operational decision" }).click();
  await expect(form.getByText(/save result is uncertain/)).toBeVisible();
  expect(state.requests[0].p_target).toEqual({ kind: "observation", binding_id: id(10), page: 1, ordinal: 0, snapshot_id: snapshot, evidence_hash: "2".repeat(64) });
  await form.getByRole("button", { name: "Recover saved decision" }).click();
  await expect(form.getByText(/Decision saved\./)).toBeVisible();
  await expect(page.getByRole("button", { name: /Evidence references for source/ })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Refresh source evidence" })).toBeEnabled();
  expect(state.requests).toHaveLength(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
