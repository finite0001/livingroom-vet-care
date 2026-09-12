import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
async function fixture(page: Page) {
  await page.addInitScript(() => {
    window.turnstile = {
      render: (_host, options) => {
        (options.callback as (s: string) => void)("synthetic");
        return "widget";
      },
      remove: () => {},
    };
  });
  const state = {
    received: false,
    submitIds: [] as string[],
    receiptIds: [] as string[],
    lose: true,
  };
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin ===
    new URL(test.info().project.use.baseURL!).origin
      ? route.continue()
      : route.abort(),
  );
  await page.route(
    "http://127.0.0.1:54321/functions/v1/public-contact",
    async (route) => {
      const body = route.request().postDataJSON();
      if (body.action === "receipt") {
        state.receiptIds.push(body.request_id);
        return route.fulfill({ json: { received: state.received } });
      }
      state.submitIds.push(body.request_id);
      state.received = true;
      if (state.lose) return route.abort();
      return route.fulfill({ json: { received: true } });
    },
  );
  return state;
}
async function fill(page: Page) {
  await page.getByLabel("Name", { exact: false }).fill("Private Visitor");
  await page.getByLabel("Email", { exact: false }).fill("private@example.test");
  await page.getByLabel("Subject", { exact: false }).fill("Private subject");
  await page.getByLabel("Message", { exact: false }).fill("Private message");
}
test("lost accepted response recovers after reload with opaque receipt only", async ({
  page,
}) => {
  const s = await fixture(page);
  await page.goto("/contact");
  await fill(page);
  await page.getByRole("button", { name: "Send Message" }).click();
  await expect(
    page.getByRole("button", { name: "Check request receipt" }),
  ).toBeVisible();
  await expect(page.getByLabel("Name", { exact: false })).toBeDisabled();
  const stored = await page.evaluate(() =>
    sessionStorage.getItem("lrv-contact-request"),
  );
  expect(stored).not.toContain("Private");
  expect(stored).not.toContain("private@example");
  expect(JSON.parse(stored!).request_id).toBe(s.submitIds[0]);
  await page.reload();
  await expect(
    page.getByText(
      "Your earlier request was received. This is not a confirmed appointment.",
    ),
  ).toBeVisible();
  expect(s.submitIds).toHaveLength(1);
  expect(s.receiptIds).toContain(s.submitIds[0]);
  expect(
    await page.evaluate(() => sessionStorage.getItem("lrv-contact-request")),
  ).toBeNull();
});
test("retry of uncertain request retains original UUID and locked fields", async ({
  page,
}) => {
  const s = await fixture(page);
  await page.goto("/contact");
  await fill(page);
  await page.getByRole("button", { name: "Send Message" }).click();
  await expect(
    page.getByRole("button", { name: "Check request receipt" }),
  ).toBeVisible();
  s.lose = false;
  await page.getByRole("button", { name: "Send Message" }).click();
  await expect(
    page.getByText("Request received", { exact: true }).first(),
  ).toBeVisible();
  expect(s.submitIds).toHaveLength(2);
  expect(s.submitIds[0]).toBe(s.submitIds[1]);
});

test("missing verification keeps submission disabled", async ({ page }) => {
  const s = await fixture(page);
  await page.addInitScript(() => {
    window.turnstile = { render: () => "unavailable", remove: () => {} };
  });
  await page.goto("/contact");
  await fill(page);
  await expect(
    page.getByRole("button", { name: "Send Message" }),
  ).toBeDisabled();
  expect(s.submitIds).toHaveLength(0);
});
