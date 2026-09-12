import { test, expect, type Page } from "@playwright/test";
const backend = "http://127.0.0.1:54321";
const staffId = "e5000000-0000-4000-8000-000000000001";
const pet = "e5000000-0000-4000-8000-000000000002";
const snapshot = "e5000000-0000-4000-8000-000000000003";
const mapping = "e5000000-0000-4000-8000-000000000004";
async function fixture(
  page: Page,
  mode: "prepare" | "approve" | "normal" = "normal",
) {
  const user = {
    id: staffId,
    aud: "authenticated",
    role: "authenticated",
    email: "synthetic@example.test",
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {},
    created_at: "2026-01-01T00:00:00Z",
  };
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const payload = Buffer.from(
    JSON.stringify({
      sub: staffId,
      exp: expires,
      role: "authenticated",
      aud: "authenticated",
    }),
  ).toString("base64url");
  const session = {
    access_token: `eyJhbGciOiJIUzI1NiJ9.${payload}.synthetic`,
    refresh_token: "synthetic",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: expires,
    user,
  };
  await page.addInitScript(
    (value) => localStorage.setItem("sb-127-auth-token", JSON.stringify(value)),
    session,
  );

  const state = {
    prepared: null as {
      request_id: string;
      actor_id: string;
      snapshot_id: string;
      status: string;
      payload: Record<string, unknown>;
    } | null,
    approval: null as {
      request_id: string;
      approved_by: string;
      weight_id: string;
    } | null,
    prepareCalls: 0,
    approveCalls: 0,
    corrected: false,
    reviews: [] as Array<{
      request_id: string;
      reason: string;
      created_at: string;
      reviewed_by: string;
    }>,
  };
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin ===
    new URL(String(test.info().project.use.baseURL)).origin
      ? route.continue()
      : route.abort(),
  );
  await page.route(`${backend}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    const body = route.request().postDataJSON();
    if (path === "/auth/v1/user") return route.fulfill({ json: user });
    if (path === "/auth/v1/token") return route.fulfill({ json: session });
    if (path === "/rest/v1/profiles")
      return route.fulfill({
        json: [
          {
            id: staffId,
            full_name: "Synthetic Reviewer",
            role: "ADMIN",
            is_active: true,
          },
        ],
      });
    if (path === "/rest/v1/user_roles")
      return route.fulfill({ json: [{ role: "ADMIN" }] });
    if (path.endsWith("/search_ezyvet_weight_patients"))
      return route.fulfill({
        json:
          body.p_search === "Jun"
            ? [
                {
                  link_id: mapping,
                  pet_id: pet,
                  patient_name: "Juniper",
                  household_name: "Synthetic Family",
                  source_origin: "https://api.trial.ezyvet.com",
                  source_site_uid: "synthetic",
                  external_id: "77",
                  patient_version: 1,
                },
              ]
            : [],
      });
    if (path.endsWith("/list_ezyvet_weight_candidates"))
      return route.fulfill({
        json: [
          {
            id: snapshot,
            created_at: "2026-01-01T00:00:00Z",
            external_id: "9",
            payload_hash: "hash",
            payload: {
              weight: "12.3",
              weight_unit: "unknown",
              timestamp: "unknown",
              active: true,
            },
            head_version: 1,
            current_snapshot_id: snapshot,
            approval_id: state.approval?.request_id ?? null,
            approved_snapshot_id: state.approval
              ? state.corrected
                ? "original-snapshot"
                : snapshot
              : null,
            weight_id: state.approval?.weight_id ?? null,
            patient_version: 1,
          },
        ],
      });
    if (path === "/rest/v1/ezyvet_weight_source_reviews")
      return route.fulfill({ json: state.reviews });
    if (path.endsWith("/review_ezyvet_weight_change")) {
      state.reviews.push({
        request_id: body.p_request_id,
        reason: body.p_reason,
        created_at: "2026-09-12T16:00:00Z",
        reviewed_by: staffId,
      });
      return route.fulfill({ json: state.reviews[0] });
    }
    if (path === "/rest/v1/ezyvet_weight_requests")
      return route.fulfill({ json: state.prepared });
    if (path === "/rest/v1/ezyvet_weight_approvals")
      return route.fulfill({ json: state.approval });
    if (path.endsWith("/prepare_ezyvet_weight_request")) {
      state.prepareCalls++;
      state.prepared = {
        request_id: body.p_request_id,
        actor_id: staffId,
        snapshot_id: snapshot,
        status: "prepared",
        payload: body.p_payload,
      };
      if (mode === "prepare" && state.prepareCalls === 1) return route.abort();
      return route.fulfill({ json: state.prepared });
    }
    if (path.endsWith("/approve_ezyvet_weight")) {
      state.approveCalls++;
      state.approval = {
        request_id: body.p_request_id,
        approved_by: staffId,
        weight_id: "e5000000-0000-4000-8000-000000000005",
      };
      state.prepared!.status = "completed";
      if (mode === "approve" && state.approveCalls === 1) return route.abort();
      return route.fulfill({ json: state.approval });
    }
    if (path.endsWith("/resolve_ezyvet_weight_request"))
      return route.fulfill({ json: { approved: !!state.approval } });
    if (path.includes("/rpc/")) return route.fulfill({ json: [] });
    if (path.startsWith("/rest/v1/")) return route.fulfill({ json: [] });
    return route.abort();
  });
  return state;
}
async function openWeight(page: Page) {
  await page.goto("/hub/tools/ezyvet");
  await page.getByLabel("Find mapped patient").fill("Jun");
  await page
    .getByRole("button", {
      name: "Juniper · Synthetic Family · synthetic",
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: /Source weight #9/ }).click();
}
async function review(page: Page) {
  await expect(page.getByLabel("Reviewed unit")).toHaveValue("");
  await expect(
    page.getByLabel("Measurement date", { exact: true }),
  ).toHaveValue("");
  await page.getByLabel("Reviewed unit").selectOption("kg");
  await page.getByLabel("Measurement date", { exact: true }).fill("2026-01-01");
  await page
    .getByLabel("Review reason", { exact: true })
    .fill("Verified original source chart");
  await page.getByRole("checkbox", { name: /I reviewed patient/ }).check();
  await page
    .getByRole("button", {
      name: "Approve reviewed historical weight",
      exact: true,
    })
    .click();
}
test("unknown source values require review and selected mapping survives search changes", async ({
  page,
}) => {
  const state = await fixture(page);
  await openWeight(page);
  await page.getByLabel("Find mapped patient").fill("Other");
  await expect(
    page.getByText("Selected patient: Juniper · Synthetic Family"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Approve reviewed historical weight",
      exact: true,
    }),
  ).toBeDisabled();
  await review(page);
  await expect.poll(() => state.approveCalls).toBe(1);
  expect(state.prepared!.payload.unit).toBe("kg");
});
test("lost preparation response recovers exact server snapshot after reload without automatic approval", async ({
  page,
}) => {
  const state = await fixture(page, "prepare");
  await openWeight(page);
  await review(page);
  await expect.poll(() => state.prepareCalls).toBe(1);
  expect(state.approveCalls).toBe(0);
  await openWeight(page);
  await expect(
    page.getByRole("button", { name: "Approve exact saved request" }),
  ).toBeVisible();
  await expect(
    page.getByText('"reason": "Verified original source chart"', {
      exact: false,
    }),
  ).toBeVisible();
  expect(state.approveCalls).toBe(0);
  const storage = await page.evaluate(() => JSON.stringify(sessionStorage));
  expect(storage).not.toContain("Verified original");
  expect(storage).not.toContain("12.3");
  await page
    .getByRole("button", { name: "Approve exact saved request" })
    .click();
  await expect.poll(() => state.approveCalls).toBe(1);
  expect(state.prepareCalls).toBe(1);
});
test("lost approval response reopens completed receipt and never creates another weight", async ({
  page,
}) => {
  const state = await fixture(page, "approve");
  await openWeight(page);
  await review(page);
  await expect.poll(() => state.approveCalls).toBe(1);
  await openWeight(page);
  await expect(
    page.getByText(/Approval already completed: weight/),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Acknowledge completed approval" })
    .click();
  await expect(
    page.getByText(/Approval already completed: weight/),
  ).toHaveCount(0);
  expect(state.approveCalls).toBe(1);
});

test("corrected source review persists without replacing the approved chart weight", async ({
  page,
}) => {
  const state = await fixture(page);
  state.approval = {
    request_id: "e5000000-0000-4000-8000-000000000008",
    approved_by: staffId,
    weight_id: "e5000000-0000-4000-8000-000000000005",
  };
  state.corrected = true;
  await openWeight(page);
  await expect(
    page.getByRole("button", {
      name: "Approve reviewed historical weight",
      exact: true,
    }),
  ).toHaveCount(0);
  await page
    .getByLabel("Source change review reason")
    .fill("Compared corrected source; retained original chart observation");
  await page
    .getByRole("button", { name: "Record source review, retain local weight" })
    .click();
  await expect.poll(() => state.reviews.length).toBe(1);
  await openWeight(page);
  await expect(
    page.getByText(/Source discrepancy reviewed: Compared corrected source/),
  ).toBeVisible();
  expect(state.approveCalls).toBe(0);
});
