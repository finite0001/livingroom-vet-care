import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

const backend = "http://127.0.0.1:54321";
const user = { id: "11111111-1111-4111-8111-111111111111", aud: "authenticated", role: "authenticated", email: "synthetic-staff@example.test", app_metadata: { provider: "email", providers: ["email"] }, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" };
const household = { id: "22222222-2222-4222-8222-222222222222", first_name: "Jane", last_name: "Example", full_name: "Jane Example", primary_email: "jane@example.test", primary_phone: "+13035550100", preferred_channel: "EMAIL", mailing_address: "PO Box 10", housecall_address: "10 Pine Street", version: 1, created_at: "2026-01-01T00:00:00Z", ezyvet_id: null };

async function mockBackend(page: Page) {
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const payload = Buffer.from(JSON.stringify({ sub: user.id, exp: expires, role: "authenticated", aud: "authenticated" })).toString("base64url");
  const session = { access_token: `eyJhbGciOiJIUzI1NiJ9.${payload}.synthetic-signature`, refresh_token: "synthetic-refresh", token_type: "bearer", expires_in: 3600, expires_at: expires, user };
  await page.addInitScript(value => localStorage.setItem("sb-127-auth-token", JSON.stringify(value)), session);
  await page.route("**/*", route => new URL(route.request().url()).origin === "http://127.0.0.1:8080" ? route.continue() : route.abort());
  await page.route(`${backend}/**`, async route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/auth/v1/token") return route.fulfill({ json: session });
    if (url.pathname === "/auth/v1/user") return route.fulfill({ json: user });
    if (url.pathname === "/rest/v1/profiles") return route.fulfill({ json: [{ id: user.id, first_name: "Synthetic", last_name: "Staff", full_name: "Synthetic Staff", role: "STAFF", is_active: true }] });
    if (url.pathname === "/rest/v1/user_roles") return route.fulfill({ json: [{ role: "STAFF" }] });
    if (url.pathname === "/rest/v1/rpc/search_clients") {
      const body = route.request().postDataJSON();
      return route.fulfill({ json: body.p_search === "jane" ? [household] : [] });
    }
    if (url.pathname === "/rest/v1/clients") return route.fulfill({ json: household });
    if (url.pathname === "/rest/v1/pets") return route.fulfill({ json: [] });
    if (url.pathname === "/rest/v1/rpc/inbox_unread_totals") return route.fulfill({ json: { unread: 0 } });
    return route.fulfill({ json: [] });
  });
}

test("⌘K search finds a household and navigates to it", async ({ page }) => {
  await mockBackend(page);
  await page.goto("/hub");
  await page.getByRole("button", { name: "Search clients and patients", exact: true }).click();
  const input = page.getByPlaceholder("Search clients and patients…");
  await input.fill("jane");
  await expect(page.getByText("Jane Example", { exact: true })).toBeVisible();
  await page.getByText("Jane Example", { exact: true }).click();
  await expect(page).toHaveURL(/\/hub\/client\/22222222-2222-4222-8222-222222222222$/);
});

test("⌘K opens with the keyboard and reports no matches", async ({ page }) => {
  await mockBackend(page);
  await page.goto("/hub");
  await expect(page.getByRole("button", { name: "Search clients and patients", exact: true })).toBeVisible();
  await page.keyboard.press("Control+k");
  await expect(page.getByPlaceholder("Search clients and patients…")).toBeVisible();
  await page.getByPlaceholder("Search clients and patients…").fill("zzz");
  await expect(page.getByText("No matching clients or patients.", { exact: true })).toBeVisible();
});
