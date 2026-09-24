import { test, expect, type Page } from "@playwright/test";

const backend = "http://127.0.0.1:54321";
const staff = "11111111-1111-4111-8111-111111111111";

interface FixtureOptions {
  /** REST paths (e.g. "/rest/v1/tickets") that must answer 403. */
  failing?: string[];
  /** Fail the on-duty staff list read (profiles without an id filter), not the signed-in profile read. */
  failOnDutyStaff?: boolean;
}

// React Query retries a failed read three times with a growing delay before it
// reports an error, so the error state appears roughly eight seconds in.
const retryBudget = { timeout: 20_000 };

async function fixture(page: Page, baseURL: string | undefined, options: FixtureOptions = {}) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const user = {
    id: staff,
    aud: "authenticated",
    role: "authenticated",
    email: "synthetic@example.test",
    app_metadata: {},
    user_metadata: {},
    created_at: "2026-01-01T00:00:00Z",
  };
  const session = {
    access_token: `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ sub: staff, exp, role: "authenticated", aud: "authenticated" })).toString("base64url")}.synthetic`,
    refresh_token: "synthetic",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: exp,
    user,
  };
  await page.addInitScript(
    (value) => localStorage.setItem("sb-127-auth-token", JSON.stringify(value)),
    session,
  );

  const failing = options.failing ?? [];
  const hits: Record<string, number> = {};

  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin === new URL(baseURL ?? "http://127.0.0.1:8080").origin
      ? route.continue()
      : route.abort(),
  );
  await page.route(`${backend}/**`, async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const method = route.request().method();
    hits[path] = (hits[path] ?? 0) + 1;

    if (path === "/auth/v1/token") return route.fulfill({ json: session });
    if (path === "/auth/v1/user") return route.fulfill({ json: user });
    if (path === "/auth/v1/logout") return route.fulfill({ status: 204, body: "" });
    if (options.failOnDutyStaff && path === "/rest/v1/profiles" && !url.searchParams.has("id"))
      return route.fulfill({
        status: 403,
        json: { code: "42501", message: "Synthetic read unavailable" },
      });
    if (path === "/rest/v1/profiles") {
      return route.fulfill({
        json: [
          {
            id: staff,
            first_name: "Synthetic",
            last_name: "Staff",
            full_name: "Synthetic Staff",
            role: "ADMIN",
            is_active: true,
          },
        ],
      });
    }
    if (path === "/rest/v1/user_roles") return route.fulfill({ json: [{ user_id: staff, role: "ADMIN" }] });
    if (failing.includes(path))
      return route.fulfill({
        status: 403,
        json: { code: "42501", message: "Synthetic read unavailable" },
      });
    if (method === "HEAD") return route.fulfill({ status: 200, body: "" });
    return route.fulfill({ json: [] });
  });

  return { hits };
}

test("an unknown hub URL stays inside the hub shell", async ({ page, baseURL }) => {
  await fixture(page, baseURL);
  await page.goto("/hub/this-page-does-not-exist");

  await expect(page.getByRole("heading", { name: "We could not find that page" })).toBeVisible();
  await expect(page.getByText("/hub/this-page-does-not-exist")).toBeVisible();
  // The staff navigation is still there: the session and the shell survived.
  await expect(page.getByRole("button", { name: "Tickets" })).toBeVisible();
  // The public marketing 404 must not be what staff land on.
  await expect(page.getByText("Page Not Found")).toHaveCount(0);
  await expect(page.getByRole("link", { name: /back to home/i })).toHaveCount(0);
});

test("the hub 404 offers the way back to the hub", async ({ page, baseURL }) => {
  await fixture(page, baseURL);
  await page.goto("/hub/nope");
  await page.getByRole("link", { name: "Back to the hub" }).click();
  await expect(page).toHaveURL(/\/hub$/);
});

test("a non-hub unknown URL still shows the public 404", async ({ page, baseURL }) => {
  await fixture(page, baseURL);
  await page.goto("/definitely-not-a-real-page");
  await expect(page.getByRole("heading", { name: "Page Not Found" })).toBeVisible();
});

test("the tickets page reports a failed read instead of an empty list", async ({ page, baseURL }) => {
  const state = await fixture(page, baseURL, { failing: ["/rest/v1/tickets"] });
  await page.goto("/hub/tickets");

  await expect(page.getByRole("alert").filter({ hasText: "Tickets could not be loaded." })).toBeVisible(retryBudget);
  await expect(page.getByText(/No tickets/)).toHaveCount(0);

  const before = state.hits["/rest/v1/tickets"] ?? 0;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect.poll(() => state.hits["/rest/v1/tickets"] ?? 0).toBeGreaterThan(before);
  await expect(page.getByRole("alert").filter({ hasText: "Tickets could not be loaded." })).toBeVisible(retryBudget);
});

test("the templates page reports a failed read instead of an empty list", async ({ page, baseURL }) => {
  await fixture(page, baseURL, { failing: ["/rest/v1/message_templates"] });
  await page.goto("/hub/tools/templates");

  await expect(page.getByRole("alert").filter({ hasText: "Message templates could not be loaded." })).toBeVisible(retryBudget);
  await expect(page.getByText("No templates yet")).toHaveCount(0);
});

test("the time clock reports a failed read for each of its three lists", async ({ page, baseURL }) => {
  await fixture(page, baseURL, { failing: ["/rest/v1/time_entries"], failOnDutyStaff: true });
  await page.goto("/hub/time");

  await expect(page.getByRole("alert").filter({ hasText: "Your time clock could not be loaded." })).toBeVisible(retryBudget);
  await expect(page.getByRole("alert").filter({ hasText: "Who is on duty could not be loaded." })).toBeVisible(retryBudget);
  await expect(page.getByRole("alert").filter({ hasText: "Your recent shifts could not be loaded." })).toBeVisible(retryBudget);
  // None of the three empty states may be shown when the read failed.
  await expect(page.getByText("Not clocked in")).toHaveCount(0);
  await expect(page.getByText("No staff clocked in.")).toHaveCount(0);
  await expect(page.getByText("No shifts in the last 30 days.")).toHaveCount(0);
});
