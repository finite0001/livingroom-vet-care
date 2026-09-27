import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
// Runs only in the "chromium-no-turnstile" project: intake URL set, no site key.
async function fixture(page: Page) {
  const state = { bodies: [] as Record<string, unknown>[], scripts: [] as string[] };
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "challenges.cloudflare.com") state.scripts.push(url.href);
    return url.origin === new URL(test.info().project.use.baseURL!).origin
      ? route.continue()
      : route.abort();
  });
  await page.route("http://127.0.0.1:54321/functions/v1/public-contact", async (route) => {
    const body = route.request().postDataJSON();
    state.bodies.push(body);
    return route.fulfill({ json: { received: body.action === "submit" } });
  });
  return state;
}
test("no site key: form is enabled, shows no widget, and submits without a token", async ({ page }) => {
  const s = await fixture(page);
  await page.goto("/contact");
  await expect(page.getByText(/Verification is unavailable/)).toHaveCount(0);
  await expect(page.getByText(/not available yet/)).toHaveCount(0);
  await page.getByLabel("Name", { exact: false }).fill("Visitor");
  await page.getByLabel("Email", { exact: false }).fill("visitor@example.test");
  await page.getByLabel("Subject", { exact: false }).fill("Question");
  await page.getByRole("textbox", { name: /^Message/ }).fill("Hello");
  const send = page.getByRole("button", { name: "Send Message" });
  await expect(send).toBeEnabled();
  await send.click();
  await expect(page.getByText("Request received. This is not a confirmed appointment.", { exact: true })).toBeVisible();
  expect(s.bodies).toHaveLength(1);
  expect(s.bodies[0].action).toBe("submit");
  expect("token" in s.bodies[0]).toBe(false);
  expect(s.scripts).toHaveLength(0);
});
