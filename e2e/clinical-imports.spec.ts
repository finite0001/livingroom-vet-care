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
      scope: "patient_scoped",
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
    if (path.endsWith("list_ezyvet_clinical_runs")) {
      state.calls.push({ path, ...body });
      return r.fulfill({
        json: {
          runs: state.runs.filter((v) => v.resource === body.p_resource),
          has_more: false,
          next_cursor: null,
        },
      });
    }
    if (path.endsWith("list_ezyvet_clinical_candidates")) {
      state.calls.push({ path, ...body });
      return r.fulfill({
        json: {
          animal_link_id: link,
          resource: body.p_resource,
          candidates: state.sources
            ? [
                {
                  id: body.p_before_id ? old : source,
                  payload: {
                    id: "71",
                    animal_id: "22",
                    consult_id: "81",
                    history_system: "unknown-section",
                    chain: "uninterpreted",
                    comments: "<img src=x onerror=alert(1)> source narrative",
                    timestamp: "unverified-date",
                    vet_id: "92",
                    active: "1",
                  },
                  payload_hash: "a".repeat(64),
                  external_id: body.p_before_id ? "70" : "71",
                  resource: body.p_resource,
                  source_origin: mapping.source_origin,
                  source_site_uid: mapping.source_site_uid,
                  created_at: at,
                  head_version: 3,
                  observed_head_version: 1,
                  current_snapshot_id: body.p_before_id ? old : source,
                  is_current: false,
                  is_current_snapshot: true,
                  current_head_scoped: false,
                  animal_link_id: link,
                  pet_id: pet,
                  client_id: client,
                },
              ]
            : [],
          has_more: state.sources && !body.p_before_id,
          next_cursor:
            state.sources && !body.p_before_id
              ? { before_at: at, before_id: source }
              : null,
        },
      });
    }
    if (path.endsWith("recover_ezyvet_clinical_run")) {
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
  page.getByRole("region", { name: "Patient-scoped clinical import" });
async function open(page: Page) {
  await page.goto("/hub/tools/ezyvet");
  await panel(page).getByLabel("Find clinical import patient").fill("Juniper");
  await panel(page)
    .getByRole("button", {
      name: "Synthetic Juniper · Synthetic Family · synthetic-site",
      exact: true,
    })
    .click();
}

test("mapped scan recovers a lost page response and displays opaque history with scoped freshness", async ({
  page,
}) => {
  const { state } = await fixture(page);
  state.lose = true;
  await open(page);
  await panel(page)
    .getByRole("button", { name: "Start mapped clinical scan", exact: true })
    .click();
  await expect(
    panel(page).getByText(
      /Scan complete\. Source observations await clinical review/,
    ),
  ).toBeVisible();
  expect(
    state.calls.filter((v) => v.path === "/functions/v1/ezyvet-import"),
  ).toHaveLength(1);
  await panel(page)
    .getByRole("button", {
      name: "Read history 71 · earlier observation",
      exact: true,
    })
    .click();
  await expect(
    panel(page).getByText("<img src=x onerror=alert(1)> source narrative", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(panel(page).locator("img")).toHaveCount(0);
  await expect(panel(page).getByText(/First stored/)).toBeVisible();
  await panel(page)
    .getByRole("button", { name: "Older observations", exact: true })
    .click();
  await expect(
    panel(page).getByRole("button", {
      name: "Read history 70 · earlier observation",
      exact: true,
    }),
  ).toBeVisible();
  expect(state.calls.find((v) => v.p_before_id === source)?.p_before_at).toBe(
    at,
  );
  await page.reload();
  await panel(page).getByLabel("Find clinical import patient").fill("Juniper");
  await panel(page)
    .getByRole("button", {
      name: "Synthetic Juniper · Synthetic Family · synthetic-site",
      exact: true,
    })
    .click();
  await expect(
    panel(page).getByText(/An earlier run is retained/),
  ).toBeVisible();
  await panel(page)
    .getByRole("button", { name: "Recheck saved clinical run", exact: true })
    .click();
  await expect(panel(page).getByText(/Scan complete\./)).toBeVisible();
  expect(
    state.calls.filter((v) => v.path === "/functions/v1/ezyvet-import"),
  ).toHaveLength(1);
});

test("uncertain run retains UUID on null recovery, guards navigation and retries exact request", async ({
  page,
}) => {
  const { state } = await fixture(page);
  state.disabled = true;
  await open(page);
  await panel(page)
    .getByRole("button", { name: "Start mapped clinical scan", exact: true })
    .click();
  await expect(
    panel(page).getByText(/Source access is not commissioned/),
  ).toBeVisible();
  await expect(
    panel(page).getByLabel("Clinical source resource"),
  ).toBeDisabled();
  const initial = state.calls.find(
    (v) => v.path === "/functions/v1/ezyvet-import",
  )!;
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Leave clinical import recovery?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Stay with this run" }).click();
  state.disabled = false;
  await panel(page)
    .getByRole("button", {
      name: "Fetch next page using this run",
      exact: true,
    })
    .click();
  await expect(panel(page).getByText(/Scan complete\./)).toBeVisible();
  expect(
    state.calls.filter((v) => v.path === "/functions/v1/ezyvet-import"),
  ).toEqual([initial, initial]);
});

test("server discovery recovers after pointer loss and legacy runs cannot bypass mapped scans", async ({
  page,
}) => {
  const { state, run } = await fixture(page);
  state.runs.push(run(source, "consult"), {
    ...run(old, "consult"),
    status: "running",
    scope: "legacy_unscoped",
    animal_link_id: null,
    animal_external_id: null,
    pet_id: null,
    client_id: null,
  });
  await open(page);
  await panel(page)
    .getByLabel("Clinical source resource")
    .selectOption("consult");
  await panel(page)
    .getByRole("button", {
      name: `Recover scan ${source.slice(0, 8)}`,
      exact: true,
    })
    .click();
  await expect(panel(page).getByText(/Scan complete\./)).toBeVisible();
  await panel(page)
    .getByRole("button", {
      name: `Recover scan ${old.slice(0, 8)}`,
      exact: true,
    })
    .click();
  await expect(
    panel(page).getByText(/Legacy unscoped evidence is read-only/),
  ).toBeVisible();
  await expect(
    panel(page).getByRole("button", {
      name: "Fetch next page using this run",
      exact: true,
    }),
  ).toBeDisabled();
  await panel(page)
    .getByRole("button", {
      name: "Prepare a separate mapped scan",
      exact: true,
    })
    .click();
  await panel(page)
    .getByRole("button", { name: "Start mapped clinical scan", exact: true })
    .click();
  await expect(panel(page).getByText(/Scan complete\./)).toBeVisible();
  const call = state.calls.find(
    (v) => v.path === "/functions/v1/ezyvet-import",
  )!;
  expect(call.run_id).not.toBe(old);
  expect(call.resource).toBe("consult");
  expect(call.animal_link_id).toBe(link);
  await page
    .getByLabel("Source resource", { exact: true })
    .selectOption("history");
  await expect(
    page.getByRole("button", { name: "Start staged import", exact: true }),
  ).toBeDisabled();
});

test("wrong recovered request keeps original intent and signout clears clinical pointers", async ({
  page,
}) => {
  const { state } = await fixture(page);
  state.wrong = true;
  await open(page);
  await panel(page)
    .getByRole("button", { name: "Start mapped clinical scan", exact: true })
    .click();
  await expect(
    panel(page).getByText(/Recovered request differs/),
  ).toBeVisible();
  await expect(
    panel(page).getByLabel("Clinical source resource"),
  ).toBeDisabled();
  await page.getByRole("button", { name: /Sign out/i }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        Object.keys(sessionStorage).filter((k) =>
          k.startsWith("lrv-ezyvet-clinical-run:"),
        ),
      ),
    )
    .toEqual([]);
});

test("nonadministrator cannot access clinical source ingestion", async ({
  page,
}) => {
  const { state } = await fixture(page, false);
  await page.goto("/hub/tools/ezyvet");
  await expect(panel(page)).toHaveCount(0);
  expect(state.calls).toHaveLength(0);
});

test("consult continuation keeps its scoped run and provider scope denial remains explicit", async ({
  page,
}) => {
  const { state } = await fixture(page);
  state.scopeDenied = true;
  await open(page);
  await panel(page)
    .getByLabel("Clinical source resource")
    .selectOption("consult");
  await panel(page)
    .getByRole("button", { name: "Start mapped clinical scan", exact: true })
    .click();
  await expect(
    panel(page).getByText(/provider denied this read scope/),
  ).toBeVisible();
  state.scopeDenied = false;
  state.morePages = true;
  await panel(page)
    .getByRole("button", {
      name: "Fetch next page using this run",
      exact: true,
    })
    .click();
  await expect(
    panel(page).getByText(/Saved state: running · next page 2/),
  ).toBeVisible();
  await panel(page)
    .getByRole("button", {
      name: "Fetch next page using this run",
      exact: true,
    })
    .click();
  await expect(panel(page).getByText(/Scan complete\./)).toBeVisible();
  const requests = state.calls.filter(
    (v) => v.path === "/functions/v1/ezyvet-import",
  );
  expect(requests).toHaveLength(3);
  expect(requests[1]).toEqual(requests[0]);
  expect(requests[2]).toEqual(requests[0]);
});
