import { test, expect, type Page } from "@playwright/test";
const actor = "11111111-1111-4111-8111-111111111111",
  pet = "22222222-2222-4222-8222-222222222222",
  link = "33333333-3333-4333-8333-333333333333",
  client = "44444444-4444-4444-8444-444444444444",
  snapshot = "55555555-5555-4555-8555-555555555555",
  savedId = "66666666-6666-4666-8666-666666666666";
const at = "2026-09-13T12:00:00Z";
interface Row {
  [key: string]: unknown;
}
async function fixture(page: Page, admin = true) {
  const user = {
    id: actor,
    aud: "authenticated",
    role: "authenticated",
    email: "synthetic@example.test",
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {},
    created_at: at,
  };
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const session = {
    access_token: `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ sub: actor, exp, role: "authenticated", aud: "authenticated" })).toString("base64url")}.synthetic`,
    refresh_token: "synthetic",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: exp,
    user,
  };
  await page.addInitScript(
    (s) => localStorage.setItem("sb-127-auth-token", JSON.stringify(s)),
    session,
  );
  const mapping = {
    link_id: link,
    pet_id: pet,
    patient_name: "Synthetic Juniper",
    household_name: "Synthetic Family",
    source_origin: "https://api.trial.ezyvet.com",
    source_site_uid: "synthetic-site",
    external_id: "22",
    patient_version: 1,
  };
  const state = {
    runs: [] as Row[],
    calls: [] as Row[],
    lose: false,
    failRecovery: false,
    wrong: false,
    unsafe: false,
    more: false,
    running: false,
    secondMapping: false,
  };
  function run(id: unknown) {
    return {
      id,
      requested_by: actor,
      resource: "attachment",
      source_origin: mapping.source_origin,
      source_site_uid: mapping.source_site_uid,
      status: state.running ? "running" : "review_ready",
      next_page: 2,
      retry_after: null,
      last_error_code: null,
      created_at: at,
      updated_at: at,
      lease_active: false,
      scope: "animal_attachment_metadata",
      parent_context: {
        animal_link_id: link,
        pet_id: pet,
        client_id: client,
        animal_external_id: "22",
        source_origin: mapping.source_origin,
        source_site_uid: mapping.source_site_uid,
        parent_type: "Animal",
        parent_external_id: "22",
        parent_snapshot_id: snapshot,
        parent_payload_hash: "a".repeat(64),
        parent_observed_head_version: 1,
      },
      observed_count: 2,
      staged_count: 1,
      capture_available: false,
    };
  }
  await page.route("**/*", (r) =>
    new URL(r.request().url()).origin ===
    new URL(test.info().project.use.baseURL!).origin
      ? r.continue()
      : r.abort(),
  );
  await page.route("http://127.0.0.1:54321/**", async (r) => {
    const path = new URL(r.request().url()).pathname,
      body = r.request().method() === "POST" ? r.request().postDataJSON() : {};
    if (path === "/auth/v1/token") return r.fulfill({ json: session });
    if (path === "/auth/v1/user") return r.fulfill({ json: user });
    if (path === "/auth/v1/logout") return r.fulfill({ json: {} });
    if (path === "/rest/v1/profiles")
      return r.fulfill({
        json: [
          {
            id: actor,
            first_name: "Synthetic",
            last_name: "Admin",
            full_name: "Synthetic Admin",
            role: admin ? "ADMIN" : "STAFF",
            is_active: true,
          },
        ],
      });
    if (path === "/rest/v1/user_roles")
      return r.fulfill({ json: [{ role: admin ? "ADMIN" : "STAFF" }] });
    if (path.endsWith("search_ezyvet_mapped_patients"))
      return r.fulfill({
        json: state.secondMapping
          ? [
              {
                ...mapping,
                link_id: client,
                pet_id: snapshot,
                patient_name: "Synthetic Cedar",
                external_id: "99",
              },
            ]
          : [mapping],
      });
    if (path.endsWith("list_ezyvet_attachment_runs")) {
      state.calls.push({ path, ...body });
      return r.fulfill({
        json: {
          runs: state.runs,
          has_more: state.more && !body.p_before_id,
          next_cursor:
            state.more && !body.p_before_id
              ? { before_at: at, before_id: savedId }
              : null,
        },
      });
    }
    if (path.endsWith("recover_ezyvet_attachment_run")) {
      state.calls.push({ path, ...body });
      if (state.failRecovery)
        return r.fulfill({ status: 500, json: { message: "unavailable" } });
      const value = state.runs.find((v) => v.id === body.p_id);
      return r.fulfill({
        json: value
          ? { ...value, requested_by: state.wrong ? client : actor }
          : null,
      });
    }
    if (path.endsWith("list_ezyvet_attachment_observations")) {
      state.calls.push({ path, ...body });
      const ordinal = body.p_after_ordinal ? 2 : 1;
      return r.fulfill({
        json: {
          observations: [
            {
              run_id: body.p_run_id,
              page: 1,
              ordinal,
              external_id: "7",
              file_id: "8",
              metadata: {
                id: "7",
                file_id: "8",
                record_type: "Animal",
                record_id: "22",
                name: "<script>outside attachment</script>",
                ...(state.unsafe
                  ? { file_download_url: "https://private.example.test/secret" }
                  : {}),
              },
              raw_record_sha256: "a".repeat(64),
              stable_metadata_sha256: "b".repeat(64),
              snapshot_id: snapshot,
              observed_head_version: 1,
              is_current: ordinal === 1,
              created_at: at,
              file_sha256: null,
            },
          ],
          has_more: state.more && ordinal === 1,
          next_cursor:
            state.more && ordinal === 1
              ? { after_page: 1, after_ordinal: 1 }
              : null,
        },
      });
    }
    if (path === "/functions/v1/ezyvet-import") {
      state.calls.push({ path, ...body });
      state.runs = [run(body.run_id)];
      if (state.lose) return r.abort();
      return r.fulfill({
        json: {
          run_id: body.run_id,
          status: state.running ? "running" : "review_ready",
          next_page: 2,
          complete: !state.running,
        },
      });
    }
    if (path.endsWith("list_ezyvet_attachment_captures"))
      return r.fulfill({
        json: { captures: [], has_more: false, next_cursor: null },
      });
    if (path.endsWith("list_ezyvet_attachment_capture_mappings"))
      return r.fulfill({
        json: { mappings: [], has_more: false, next_cursor: null },
      });
    return r.fulfill({ json: [] });
  });
  return { state, run };
}
async function select(page: Page) {
  await page.goto("/hub/tools/ezyvet");
  const panel = page.getByRole("region", {
    name: "Attachment metadata import",
    exact: true,
  });
  await panel.getByLabel("Find attachment patient").fill("Juniper");
  await panel
    .getByRole("button", {
      name: "Synthetic Juniper · Synthetic Family · synthetic-site",
      exact: true,
    })
    .click();
  return panel;
}
test("metadata scan binds patient and renders escaped observations without file actions", async ({
  page,
}) => {
  const { state } = await fixture(page);
  const panel = await select(page);
  await panel
    .getByRole("button", { name: "Start attachment metadata scan" })
    .click();
  await expect(
    panel.getByText(/2 metadata observations · 1 distinct staged versions/),
  ).toBeVisible();
  await expect(
    panel.getByRole("heading", { name: "<script>outside attachment</script>" }),
  ).toBeVisible();
  expect(
    state.calls.find((c) => c.path === "/functions/v1/ezyvet-import"),
  ).toMatchObject({ resource: "attachment", animal_link_id: link });
  await expect(
    panel.getByRole("button", { name: /download|approve|release/i }),
  ).toHaveCount(0);
});
test("lost response recovers committed run without repeating provider read", async ({
  page,
}) => {
  const { state } = await fixture(page);
  state.lose = true;
  const panel = await select(page);
  await panel
    .getByRole("button", { name: "Start attachment metadata scan" })
    .click();
  await expect(panel.getByText(/Saved state: review_ready/)).toBeVisible();
  expect(
    state.calls.filter((c) => c.path === "/functions/v1/ezyvet-import"),
  ).toHaveLength(1);
});
test("uncertain recovery locks patient and retries original UUID after recovery", async ({
  page,
}) => {
  const { state } = await fixture(page);
  state.lose = true;
  state.failRecovery = true;
  const panel = await select(page);
  await panel
    .getByRole("button", { name: "Start attachment metadata scan" })
    .click();
  await expect(panel.getByLabel("Find attachment patient")).toBeDisabled();
  await panel
    .getByRole("button", { name: "Fetch next attachment page using this run" })
    .click();
  expect(
    state.calls.filter((c) => c.path === "/functions/v1/ezyvet-import"),
  ).toHaveLength(1);
  state.failRecovery = false;
  await panel
    .getByRole("button", { name: "Recheck saved attachment run" })
    .click();
  await expect(panel.getByText(/Saved state: review_ready/)).toBeVisible();
});
test("server history recovers after browser pointer loss and paginates observations", async ({
  page,
}) => {
  const { state, run } = await fixture(page);
  state.runs = [run(savedId)];
  state.more = true;
  const panel = await select(page);
  await panel
    .getByRole("button", { name: "Recover attachment scan 66666666" })
    .click();
  await panel
    .getByRole("button", { name: "Next attachment observations" })
    .click();
  await expect(
    panel.getByText(/Stale metadata or patient mapping/),
  ).toBeVisible();
  await panel.getByRole("button", { name: "Older attachment scans" }).click();
  expect(state.calls.some((c) => c.p_before_id === savedId)).toBeTruthy();
  expect(
    state.calls.filter((c) => c.path === "/functions/v1/ezyvet-import"),
  ).toHaveLength(0);
});
test("wrong actor recovery fails closed", async ({ page }) => {
  const { state, run } = await fixture(page);
  state.runs = [run(savedId)];
  state.wrong = true;
  const panel = await select(page);
  await panel
    .getByRole("button", { name: "Recover attachment scan 66666666" })
    .click();
  await expect(panel.getByRole("alert")).toContainText(
    "could not be confirmed",
  );
  await expect(panel.getByText(/Saved state:/)).toHaveCount(0);
});
test("unexpected URL field rejects observation envelope", async ({ page }) => {
  const { state } = await fixture(page);
  state.unsafe = true;
  const panel = await select(page);
  await panel
    .getByRole("button", { name: "Start attachment metadata scan" })
    .click();
  await expect(
    panel.getByText("Attachment observations unavailable."),
  ).toBeVisible();
  await expect(panel.getByText(/private.example/)).toHaveCount(0);
});
test("non administrators cannot access attachment import", async ({ page }) => {
  await fixture(page, false);
  await page.goto("/hub/tools/ezyvet");
  await expect(page).toHaveURL(/\/hub$/);
  await expect(
    page.getByRole("region", { name: "Attachment metadata import" }),
  ).toHaveCount(0);
});

test("saved browser pointer survives reload without another provider read", async ({
  page,
}) => {
  const { state } = await fixture(page);
  let panel = await select(page);
  await panel
    .getByRole("button", { name: "Start attachment metadata scan" })
    .click();
  await expect(panel.getByText(/Saved state: review_ready/)).toBeVisible();
  panel = await select(page);
  await expect(panel.getByLabel("Find attachment patient")).toBeDisabled();
  await panel
    .getByRole("button", { name: "Recheck saved attachment run" })
    .click();
  await expect(panel.getByText(/Saved state: review_ready/)).toBeVisible();
  expect(
    state.calls.filter((c) => c.path === "/functions/v1/ezyvet-import"),
  ).toHaveLength(1);
});
test("signout removes active metadata workflow", async ({ page }) => {
  await fixture(page);
  const panel = await select(page);
  await panel
    .getByRole("button", { name: "Start attachment metadata scan" })
    .click();
  await expect(panel.getByText(/Saved state: review_ready/)).toBeVisible();
  await page.getByRole("button", { name: "Sign Out", exact: true }).click();
  await expect(panel).toHaveCount(0);
});
test("uncertain run participates in navigation recovery warning", async ({
  page,
}) => {
  const { state } = await fixture(page);
  state.failRecovery = true;
  state.lose = true;
  const panel = await select(page);
  await panel
    .getByRole("button", { name: "Start attachment metadata scan" })
    .click();
  await expect(panel.getByLabel("Find attachment patient")).toBeDisabled();
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
});

test("late observations from previous mapping do not populate selected patient", async ({
  page,
}) => {
  const { state } = await fixture(page);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started!: () => void;
  const observed = new Promise<void>((resolve) => {
    started = resolve;
  });
  await page.route(
    "**/rest/v1/rpc/list_ezyvet_attachment_observations",
    async (route) => {
      started();
      await pending;
      await route.fallback();
    },
  );
  const panel = await select(page);
  await panel
    .getByRole("button", { name: "Start attachment metadata scan" })
    .click();
  await observed;
  await expect(panel.getByLabel("Find attachment patient")).toBeEnabled();
  state.secondMapping = true;
  await panel.getByLabel("Find attachment patient").fill("Cedar");
  await panel
    .getByRole("button", {
      name: "Synthetic Cedar · Synthetic Family · synthetic-site",
      exact: true,
    })
    .click();
  release();
  await expect(
    panel.getByText("Selected patient: Synthetic Cedar · Synthetic Family"),
  ).toBeVisible();
  await expect(
    panel.getByRole("region", { name: "Attachment observations", exact: true }),
  ).toHaveCount(0);
  await expect(panel.getByText(/Attachment run reference:/)).toHaveCount(0);
});
