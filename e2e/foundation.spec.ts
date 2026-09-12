import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

const backend = "http://127.0.0.1:54321";
const user = {
  id: "11111111-1111-4111-8111-111111111111", aud: "authenticated", role: "authenticated",
  email: "synthetic-staff@example.test", app_metadata: { provider: "email", providers: ["email"] },
  user_metadata: {}, created_at: "2026-01-01T00:00:00Z",
};
const profile = { id: user.id, first_name: "Synthetic", last_name: "Staff", full_name: "Synthetic Staff", role: "STAFF", is_active: true };
function session() {
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const payload = Buffer.from(JSON.stringify({ sub: user.id, exp: expires, role: "authenticated", aud: "authenticated" })).toString("base64url");
  return { access_token: `eyJhbGciOiJIUzI1NiJ9.${payload}.synthetic-signature`, refresh_token: "synthetic-refresh", token_type: "bearer", expires_in: 3600, expires_at: expires, user };
}

async function seedSession(page: Page) {
  await page.addInitScript((value) => localStorage.setItem("sb-127-auth-token", JSON.stringify(value)), session());
}

async function mockStaffBackend(page: Page, options: { failProfile?: boolean; revalidationGate?: Promise<void> } = {}) {
  let profileReads = 0;
  await page.route(`${backend}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/auth/v1/token") return route.fulfill({ json: session() });
    if (url.pathname === "/auth/v1/user") return route.fulfill({ json: user });
    if (url.pathname === "/rest/v1/profiles") {
      if (url.searchParams.get("select") === "email_signature") return route.fulfill({ json: { email_signature: "Original signature" } });
      profileReads++;
      if (profileReads > 1 && options.revalidationGate) await options.revalidationGate;
      if (options.failProfile) return route.fulfill({ status: 403, json: { message: "Synthetic profile denial", code: "42501" } });
      return route.fulfill({ json: [profile] });
    }
    if (url.pathname === "/rest/v1/user_roles") return route.fulfill({ json: [{ role: "STAFF" }] });
    return route.fulfill({ json: [] });
  });
  return () => profileReads;
}

test.beforeEach(async ({ page }) => {
  // No live APIs, embedded maps, analytics or externally hosted assets are contacted.
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return url.origin === new URL(test.info().project.use.baseURL!).origin ? route.continue() : route.abort();
  });
});

test("password setup is a public route and invalid links offer recovery", async ({ page }, testInfo) => {
  await page.goto("/hub/reset-password#error=access_denied&error_code=otp_expired&error_description=Expired");
  await expect(page.getByRole("heading", { name: "Set your password" })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("expired or is invalid");
  await expect(page.getByRole("button", { name: "Save password" })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("expired-reset-link.png"), fullPage: true });
  await page.getByRole("link", { name: "Back to sign in" }).click();
  await expect(page).toHaveURL(/\/hub\/login$/);
  await page.getByRole("button", { name: "Forgot password?" }).click();
  await expect(page.getByRole("heading", { name: "Reset your password" })).toBeVisible();
});

test("contact CTA reaches a working form with accurate launch and domain information", async ({ page }, testInfo) => {
  await page.addInitScript(() => { window.turnstile = {render: (_host, options) => { (options.callback as (token:string)=>void)("synthetic-token"); return "widget"; },remove: () => {}}; });
  await page.goto("/");
  const domain = await page.evaluate(async (moduleUrl) => (await import(moduleUrl)).practice.domain, "/src/config/practice.ts");
  expect(domain).toBe("thelivingroom.vet");
  await page.getByRole("link", { name: "Request a Visit", exact: true }).first().click();
  await expect(page).toHaveURL(/\/contact#contact-form$/);
  await expect(page.getByRole("heading", { name: "Request a Visit or Ask a Question" })).toBeInViewport();
  await expect(page.getByText(/Housecalls: targeting late october 2026/).first()).toBeVisible();
  await expect(page.getByText(/Clinic: targeting early 2027/).first()).toBeVisible();
  await expect(page.getByText("2619 Spruce Street, Boulder, CO", { exact: true }).first()).toBeVisible();
  await expect(page.locator('a[href^="tel:"], a[href^="mailto:"]')).toHaveCount(0);
  await page.getByRole("button", { name: "Send Message" }).click();
  await expect(page.getByText("Name is required", { exact: true })).toBeVisible();
  await page.getByLabel("Name", { exact: false }).fill("Synthetic Browser Check");
  await page.getByLabel("Email", { exact: false }).fill("browser-check@example.test");
  await page.getByLabel("Subject", { exact: false }).fill("Housecall opening");
  await page.getByLabel("Message", { exact: false }).fill("Synthetic request intercepted by the browser test.");
  let requests = 0;
  await page.route(`${backend}/functions/v1/public-contact`, (route) => {
    requests++;
    expect(route.request().method()).toBe("POST");
    return route.fulfill({ status: 200, json: {received:true} });
  });
  await page.getByRole("button", { name: "Send Message" }).click();
  await expect(page.getByText("Request received", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/This is not a confirmed appointment/).first()).toBeVisible();
  expect(requests).toBe(1);
  await page.screenshot({ path: testInfo.outputPath("contact-request.png"), fullPage: true });
});

test("failed staff lookup denies protected routes even with an auth session", async ({ page }) => {
  await seedSession(page);
  await mockStaffBackend(page, { failProfile: true });
  await page.goto("/hub/settings");
  await expect(page.getByRole("heading", { name: "Staff access unavailable" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save signature" })).toHaveCount(0);
});

test("token refresh preserves an unsaved draft while authorization revalidates", async ({ page }, testInfo) => {
  await seedSession(page);
  let release!: () => void;
  const revalidationGate = new Promise<void>((resolve) => { release = resolve; });
  const profileReads = await mockStaffBackend(page, { revalidationGate });
  await page.goto("/hub/settings");
  const signature = page.locator("textarea");
  await expect(signature).toHaveValue("Original signature");
  await signature.fill("Unsaved staff draft must survive token refresh");
  // Exercise the real auth client and event listener, with its HTTP response mocked.
  await page.evaluate(async (moduleUrl) => {
    const { supabase } = await import(moduleUrl);
    const { error } = await supabase.auth.refreshSession();
    if (error) throw error;
  }, "/src/integrations/supabase/client.ts");
  await expect.poll(profileReads).toBeGreaterThan(1);
  await expect(signature).toHaveValue("Unsaved staff draft must survive token refresh");
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  release();
  await expect(signature).toHaveValue("Unsaved staff draft must survive token refresh");
  await page.screenshot({ path: testInfo.outputPath("draft-after-refresh.png"), fullPage: true });
});
