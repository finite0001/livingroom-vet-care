import { test, expect, type Page } from "@playwright/test";
const actor = "11111111-1111-4111-8111-111111111111",
  pet = "22222222-2222-4222-8222-222222222222",
  link = "33333333-3333-4333-8333-333333333333",
  client = "44444444-4444-4444-8444-444444444444",
  source = "55555555-5555-4555-8555-555555555555",
  old = "66666666-6666-4666-8666-666666666666";
const at = "2026-09-13T12:00:00.123456+00:00";
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
    recoverFail: false,
    wrong: false,
    disabled: false,
    scopeDenied: false,
    sources: false,
    oldPage: false,
    morePages: false,
  };
  function run(id: unknown, resource: unknown) {
    return {
      id,
      requested_by: actor,
      resource,
      source_origin: mapping.source_origin,
      source_site_uid: mapping.source_site_uid,
      status: "review_ready",
      next_page: 2,
      retry_after: null,
      last_error_code: null,
      created_at: at,
      updated_at: at,
      scope: "consult_scoped",
      consult_snapshot_id: source,
      consult_payload_hash: "a".repeat(64),
      consult_observed_head_version: 3,
      consult_external_id: "71",
      animal_link_id: link,
      animal_external_id: "22",
      pet_id: pet,
      client_id: client,
      lease_active: false,
    };
  }
  await page.route("**/*", (r) =>
    new URL(r.request().url()).origin === "http://127.0.0.1:8080"
      ? r.continue()
      : r.abort(),
  );
  await page.route("http://127.0.0.1:54321/**", async (r) => {
    const path = new URL(r.request().url()).pathname;
    const body =
      r.request().method() === "POST" ? r.request().postDataJSON() : {};
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
      return r.fulfill({ json: [mapping] });
    if (path.endsWith("list_ezyvet_vaccination_runs")) {
      state.calls.push({ path, ...body });
      return r.fulfill({
        json: {
          runs: state.runs,
          has_more: false,
          next_cursor: null,
        },
      });
    }
    if (
      path.endsWith("list_ezyvet_clinical_candidates") ||
      path.endsWith("list_ezyvet_vaccination_candidates")
    ) {
      const consult = path.endsWith("list_ezyvet_clinical_candidates");
      state.calls.push({ path, ...body });
      return r.fulfill({
        json: {
          animal_link_id: link,
          resource: consult ? body.p_resource : "vaccination",
          candidates:
            consult || state.sources
              ? [
                  {
                    id: source,
                    payload: consult
                      ? {
                          id: "71",
                          animal_id: "22",
                          description: "<script>outside consult</script>",
                        }
                      : {
                          id: "71",
                          consult_id: "71",
                          product_id: "<img src=x onerror=alert(1)>",
                          date_of_administration: null,
                          date_of_next_administration: "unverified-date",
                          qty: "unknown",
                          vet_id: "92",
                        },
                    payload_hash: "a".repeat(64),
                    external_id: "71",
                    resource: consult ? body.p_resource : "vaccination",
                    source_origin: mapping.source_origin,
                    source_site_uid: mapping.source_site_uid,
                    created_at: at,
                    head_version: 3,
                    observed_head_version: 3,
                    current_snapshot_id: source,
                    is_current: true,
                    is_current_snapshot: true,
                    current_head_scoped: true,
                    animal_link_id: link,
                    pet_id: pet,
                    client_id: client,
                    consult_snapshot_id: source,
                    consult_payload_hash: "a".repeat(64),
                    consult_observed_head_version: 3,
                    consult_external_id: "71",
                    consult_head_version: state.oldPage ? 4 : 3,
                    consult_current_snapshot_id: source,
                    consult_is_current: !state.oldPage,
                    eligible_for_review: !state.oldPage,
                  },
                ]
              : [],
          has_more: false,
          next_cursor: null,
        },
      });
    }
    if (path.endsWith("recover_ezyvet_vaccination_run")) {
      state.calls.push({ path, ...body });
      if (state.recoverFail) return r.abort();
      const row = state.runs.find((v) => v.id === body.p_id);
      return r.fulfill({
        json: row ? { ...row, ...(state.wrong ? { id: old } : {}) } : null,
      });
    }
    if (path === "/functions/v1/ezyvet-import") {
      state.calls.push({ path, ...body });
      if (state.disabled || state.scopeDenied)
        return r.fulfill({
          status: 503,
          json: {
            error: state.disabled ? "IMPORT_DISABLED" : "UPSTREAM_SCOPE_DENIED",
            retry_after_seconds: 5,
            retry_safe: true,
          },
        });
      if (!state.runs.some((v) => v.id === body.run_id))
        state.runs.push(run(body.run_id, body.resource));
      const saved = state.runs.find((v) => v.id === body.run_id)!;
      if (state.morePages) {
        saved.status = "running";
        saved.next_page = 2;
        state.morePages = false;
      } else {
        saved.status = "review_ready";
        saved.next_page = 3;
      }
      state.sources = true;
      if (state.lose) {
        state.lose = false;
        return r.abort();
      }
      return r.fulfill({
        json: {
          run_id: body.run_id,
          status: "review_ready",
          next_page: 2,
          review_only: true,
          staged_count: 1,
        },
      });
    }
    return r.fulfill({ json: [] });
  });
  return { state, run };
}
const panel = (page: Page) =>
  page.getByRole("region", { name: "Consult-scoped vaccination import" });
async function open(page: Page) {
  await page.goto("/hub/tools/ezyvet");
  await panel(page)
    .getByLabel("Find vaccination import patient")
    .fill("Juniper");
  await panel(page)
    .getByRole("button", {
      name: "Synthetic Juniper · Synthetic Family · synthetic-site",
      exact: true,
    })
    .click();
  await panel(page)
    .getByRole("button", { name: /Consult 71/ })
    .click();
}

test("consult scan recovers lost ACK and shows unmodified source fields", async ({
  page,
}) => {
  const { state } = await fixture(page);
  state.lose = true;
  await open(page);
  await panel(page)
    .getByRole("button", { name: "Start consult vaccination scan" })
    .click();
  await expect(
    panel(page).getByText(/Saved state: review_ready/),
  ).toBeVisible();
  const request = state.calls.find(
    (c) => c.path === "/functions/v1/ezyvet-import",
  )!;
  expect(request).toMatchObject({
    resource: "vaccination",
    animal_link_id: link,
    consult_snapshot_id: source,
    consult_payload_hash: "a".repeat(64),
    consult_observed_head_version: 3,
  });
  await panel(page)
    .getByRole("button", { name: /Read vaccination 71/ })
    .click();
  await expect(
    panel(page).getByText("Unknown / not supplied", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    panel(page).getByText("unverified-date", { exact: true }),
  ).toBeVisible();
  await expect(panel(page).locator("img")).toHaveCount(0);
  expect(
    state.calls.filter((c) => c.path === "/functions/v1/ezyvet-import"),
  ).toHaveLength(1);
});

test("run discovery restores exact consult intent after browser pointer loss", async ({
  page,
}) => {
  const { state, run } = await fixture(page);
  state.runs.push(run(old, "vaccination"));
  await open(page);
  await panel(page)
    .getByRole("button", { name: `Recover scan ${old.slice(0, 8)}` })
    .click();
  await expect(
    panel(page).getByText(/Saved state: review_ready/),
  ).toBeVisible();
  const request = state.calls.find((c) =>
    String(c.path).endsWith("recover_ezyvet_vaccination_run"),
  )!;
  expect(request).toMatchObject({
    p_id: old,
    p_consult_snapshot_id: source,
    p_consult_observed_head_version: 3,
  });
  expect(
    state.calls.filter((c) => c.path === "/functions/v1/ezyvet-import"),
  ).toHaveLength(0);
});

for (const error of ["disabled", "scopeDenied"] as const)
  test(`retains original intent after ${error}`, async ({ page }) => {
    const { state } = await fixture(page);
    state[error] = true;
    await open(page);
    await panel(page)
      .getByRole("button", { name: "Start consult vaccination scan" })
      .click();
    await expect(
      panel(page).getByText(
        error === "disabled"
          ? /Source access is not commissioned/
          : /provider denied this read scope/,
      ),
    ).toBeVisible();
    await panel(page)
      .getByRole("button", { name: "Fetch next page using this run" })
      .click();
    await expect
      .poll(
        () =>
          state.calls.filter((c) => c.path === "/functions/v1/ezyvet-import")
            .length,
      )
      .toBe(2);
    const requests = state.calls.filter(
      (c) => c.path === "/functions/v1/ezyvet-import",
    );
    expect(requests[0].run_id).toBe(requests[1].run_id);
  });

test("stale consult remains visible in historical vaccination evidence", async ({
  page,
}) => {
  const { state } = await fixture(page);
  state.sources = true;
  state.oldPage = true;
  await open(page);
  await panel(page)
    .getByRole("button", { name: /Read vaccination 71/ })
    .click();
  await expect(panel(page).getByText(/consult stale/)).toBeVisible();
  await expect(
    panel(page).getByRole("button", { name: /certificate|approve|treatment/i }),
  ).toHaveCount(0);
});

test("rejects a recovered run whose identity differs", async ({ page }) => {
  const { state } = await fixture(page);
  state.wrong = true;
  await open(page);
  await panel(page)
    .getByRole("button", { name: "Start consult vaccination scan" })
    .click();
  await expect(
    panel(page).getByText(/Recovered request differs/),
  ).toBeVisible();
  await expect(
    panel(page).getByRole("button", { name: "Prepare a separate mapped scan" }),
  ).toBeDisabled();
  await panel(page)
    .getByRole("button", { name: "Fetch next page using this run" })
    .click();
  await expect(
    panel(page).getByText(/Recovered request differs/),
  ).toBeVisible();
  expect(
    state.calls.filter((c) => c.path === "/functions/v1/ezyvet-import"),
  ).toHaveLength(1);
});

test("recovered provider cooldown prevents another page request", async ({
  page,
}) => {
  const { state, run } = await fixture(page);
  state.runs.push({
    ...run(old, "vaccination"),
    status: "running",
    retry_after: "2099-01-01T00:00:00Z",
  });
  await open(page);
  await panel(page)
    .getByRole("button", { name: `Recover scan ${old.slice(0, 8)}` })
    .click();
  await expect(
    panel(page).getByRole("button", { name: "Fetch next page using this run" }),
  ).toBeDisabled();
  expect(
    state.calls.filter((c) => c.path === "/functions/v1/ezyvet-import"),
  ).toHaveLength(0);
});

test("late consult response cannot replace another selected patient's view", async ({
  page,
}) => {
  await fixture(page);
  let release: () => void = () => {};
  const delayed = new Promise<void>((resolve) => {
    release = resolve;
  });
  const second = "77777777-7777-4777-8777-777777777777";
  await page.route("**/rest/v1/rpc/search_ezyvet_mapped_patients", (r) =>
    r.fulfill({
      json: [link, second].map((id, i) => ({
        link_id: id,
        pet_id: i ? old : pet,
        patient_name: i ? "Second patient" : "First patient",
        household_name: "Family",
        source_origin: "https://api.trial.ezyvet.com",
        source_site_uid: "synthetic-site",
        external_id: i ? "23" : "22",
        patient_version: 1,
      })),
    }),
  );
  await page.route(
    "**/rest/v1/rpc/list_ezyvet_clinical_candidates",
    async (r) => {
      const body = r.request().postDataJSON();
      if (body.p_animal_link_id === link) await delayed;
      await r.fulfill({
        json: {
          animal_link_id: body.p_animal_link_id,
          resource: "consult",
          candidates: [],
          has_more: false,
          next_cursor: null,
        },
      });
    },
  );
  await page.goto("/hub/tools/ezyvet");
  await panel(page)
    .getByLabel("Find vaccination import patient")
    .fill("patient");
  await panel(page)
    .getByRole("button", { name: /First patient/ })
    .click();
  await panel(page)
    .getByRole("button", { name: /Second patient/ })
    .click();
  release();
  await expect(
    panel(page).getByText("Selected patient: Second patient · Family"),
  ).toBeVisible();
  await expect(
    panel(page).getByText("Selected patient: First patient · Family"),
  ).toHaveCount(0);
  await expect(
    panel(page).getByRole("button", { name: "Start consult vaccination scan" }),
  ).toBeDisabled();
});

test("one page guard protects both selected import workspaces and preserves cancel or leave", async ({
  page,
}) => {
  const warnings: string[] = [];
  page.on("console", (message) => {
    if (/blocker/i.test(message.text())) warnings.push(message.text());
  });
  const { state } = await fixture(page);
  state.disabled = true;
  await page.route("**/rest/v1/rpc/recover_ezyvet_clinical_run", (r) =>
    r.fulfill({ json: null }),
  );
  await page.route("**/rest/v1/rpc/list_ezyvet_clinical_runs", (r) =>
    r.fulfill({ json: { runs: [], has_more: false, next_cursor: null } }),
  );
  await open(page);
  const clinical = page.getByRole("region", {
    name: "Patient-scoped clinical import",
  });
  await clinical.getByLabel("Find clinical import patient").fill("Juniper");
  await clinical
    .getByRole("button", {
      name: "Synthetic Juniper · Synthetic Family · synthetic-site",
      exact: true,
    })
    .click();
  await clinical
    .getByRole("button", { name: "Start mapped clinical scan" })
    .click();
  await expect(
    clinical.getByText(/Source access is not commissioned/),
  ).toBeVisible();
  // Vaccination is mounted and clean here; it must not override the clinical guard.
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Leave clinical import recovery?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Stay with this run" }).click();
  await panel(page)
    .getByRole("button", { name: "Start consult vaccination scan" })
    .click();
  await expect(
    panel(page).getByText(/Source access is not commissioned/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Leave import recovery?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Stay with this run" }).click();
  await expect(page).toHaveURL(/\/hub\/tools\/ezyvet$/);
  await expect(clinical.getByText(/Run reference:/)).toBeVisible();
  await expect(panel(page).getByText(/Run reference:/)).toBeVisible();
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await page.getByRole("button", { name: "Leave and retain recovery" }).click();
  await expect(page).not.toHaveURL(/\/hub\/tools\/ezyvet$/);
  const keys = await page.evaluate(() => Object.keys(sessionStorage));
  expect(keys.some((key) => key.startsWith("lrv-ezyvet-clinical-run:"))).toBe(
    true,
  );
  expect(
    keys.some((key) => key.startsWith("lrv-ezyvet-vaccination-run:")),
  ).toBe(true);
  expect(warnings).toEqual([]);
});
