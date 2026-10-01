import { test, expect, type Page } from "@playwright/test";

// Hub linkage: nav active state, mobile sign-out, sign-in return URL and
// cold-load `?tab=&section=` deep links.
test.describe.configure({ timeout: 120_000 });

const staff = "11111111-1111-4111-8111-111111111111";
const client = "33333333-3333-4333-8333-333333333333";
const luna = "22222222-2222-4222-8222-222222222222";
const backend = "http://127.0.0.1:54321";
const user = { id: staff, aud: "authenticated", role: "authenticated", email: "linkage@example.test", app_metadata: { provider: "email", providers: ["email"] }, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" };

function session() {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const token = Buffer.from(JSON.stringify({ sub: staff, exp, role: "authenticated", aud: "authenticated" })).toString("base64url");
  return { access_token: `eyJhbGciOiJIUzI1NiJ9.${token}.synthetic`, refresh_token: "synthetic", token_type: "bearer", expires_in: 3600, expires_at: exp, user };
}

interface Options { signedIn?: boolean; patientDelayMs?: number; role?: "STAFF" | "ADMIN" }

async function fixture(page: Page, { signedIn = true, patientDelayMs = 0, role = "STAFF" }: Options = {}) {
  const calls: string[] = [];
  const current = session();
  if (signedIn) await page.addInitScript((value) => localStorage.setItem("sb-127-auth-token", JSON.stringify(value)), current);
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin === new URL(test.info().project.use.baseURL as string).origin ? route.continue() : route.abort());
  await page.route(`${backend}/**`, async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    calls.push(path);
    if (path === "/auth/v1/token") return route.fulfill({ json: current });
    if (path === "/auth/v1/user") return route.fulfill({ json: user });
    if (path === "/auth/v1/logout") return route.fulfill({ status: 204, body: "" });
    if (path === "/rest/v1/profiles") return route.fulfill({ json: [{ ...user, full_name: "Linkage Staff", first_name: "Linkage", last_name: "Staff", role, is_active: true }] });
    if (path === "/rest/v1/user_roles") return route.fulfill({ json: [{ role }] });
    if (path === "/rest/v1/pets" && url.searchParams.get("id") === `eq.${luna}`) {
      // A slow record read: the section must still be scrolled to once it renders.
      if (patientDelayMs) await new Promise((resolve) => setTimeout(resolve, patientDelayMs));
      return route.fulfill({ json: { id: luna, client_id: client, name: "Luna", species: "Dog", breed: "Mixed", dob: "2020-01-01", birth_date_precision: "exact", color: "Brown", sex: "female", neuter_status: "spayed", allergies: null, microchip_id: null, weight_lbs: null, archived_at: null, deceased_at: null, version: 1 } });
    }
    if (path === "/rest/v1/clients") {
      const row = { id: client, full_name: "Ada Lovelace", first_name: "Ada", last_name: "Lovelace", primary_phone: null, primary_email: null, preferred_channel: "EMAIL", housecall_address: null, mailing_address: null, version: 1, ezyvet_id: null, created_at: "2026-01-01T00:00:00Z" };
      const single = (route.request().headers()["accept"] ?? "").includes("vnd.pgrst.object");
      return route.fulfill({ json: single ? row : [row] });
    }
    if (path.startsWith("/rest/v1/rpc/read_") || path.startsWith("/rest/v1/rpc/list_patient_timeline")) return route.fulfill({ status: 404, json: { code: "PGRST202", message: "Synthetic summary unavailable" } });
    if (path === "/rest/v1/rpc/inbox_unread_totals") return route.fulfill({ json: [{ unread_conversations: 0, unread_messages: 0 }] });
    return route.fulfill({ json: [] });
  });
  return calls;
}

test("desktop sidebar highlights the owning list on detail pages and whole segments only", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await fixture(page);
  const nav = page.getByRole("navigation", { name: "Hub navigation" });

  await page.goto(`/hub/patient/${luna}`);
  await expect(nav.getByRole("button", { name: "Patients", exact: true })).toHaveAttribute("aria-current", "page", { timeout: 30_000 });
  await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);

  await page.goto("/hub/timesheet");
  await expect(nav.getByRole("button", { name: "Timesheet", exact: true })).toHaveAttribute("aria-current", "page", { timeout: 30_000 });
  await expect(nav.getByRole("button", { name: "Time Clock", exact: true })).not.toHaveAttribute("aria-current", "page");
  await page.screenshot({ path: test.info().outputPath("desktop-timesheet.png") });
});

test("mobile More sheet offers sign-out", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const calls = await fixture(page);
  await page.goto("/hub");
  await page.getByRole("button", { name: "More", exact: true }).click({ timeout: 30_000 });
  const signOut = page.getByRole("button", { name: "Sign out", exact: true });
  await expect(signOut).toBeVisible();
  await page.waitForTimeout(600); // let the sheet finish sliding in for the evidence screenshot
  await page.screenshot({ path: test.info().outputPath("mobile-more-sheet.png") });
  await signOut.click();
  await expect(page).toHaveURL(/\/hub\/login$/);
  expect(calls).toContain("/auth/v1/logout");
});

test("signing in returns staff to the hub page they first asked for", async ({ page }) => {
  await fixture(page, { signedIn: false });
  await page.goto("/hub/tools/refills?view=open");
  await expect(page).toHaveURL(/\/hub\/login$/, { timeout: 30_000 });
  await page.getByLabel("Email").fill("linkage@example.test");
  await page.getByLabel("Password").fill("synthetic-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/hub\/tools\/refills\?view=open$/);
});

test("staff following an admin link are told why they landed on Home", async ({ page }) => {
  await fixture(page);
  await page.goto("/hub/admin/operations");
  await expect(page).toHaveURL(/\/hub$/, { timeout: 30_000 });
  await expect(page.getByText("That page is for administrators", { exact: true })).toBeVisible();
});

for (const width of [390, 1280]) {
  test(`cold-load section deep link scrolls once the record renders (${width}px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await fixture(page, { patientDelayMs: 1500 });
    await page.goto(`/hub/patient/${luna}?tab=medical&section=labs`);
    const target = page.locator("#p360-labs");
    await expect(target).toBeAttached({ timeout: 30_000 });
    await expect(target).toBeFocused();
    await expect(target).toBeInViewport();
    await page.screenshot({ path: test.info().outputPath(`deep-link-labs-${width}.png`) });

    // Leave for the household, then come back to the deep link: it re-seeks.
    await page.getByRole("link", { name: "Ada Lovelace", exact: true }).first().click();
    await expect(page).toHaveURL(new RegExp(`/hub/client/${client}$`));
    await expect(target).not.toBeAttached({ timeout: 30_000 });
    await page.goBack();
    await expect(page).toHaveURL(/tab=medical&section=labs$/);
    await expect(target).toBeInViewport();
  });
}
