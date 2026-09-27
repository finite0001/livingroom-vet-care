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
  await page.getByRole("textbox", { name: /^Message/ }).fill("Private message");
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

test("blocked browser storage preserves the page and draft without sending", async ({ page }) => {
  const s = await fixture(page);
  await page.addInitScript(() => {
    Object.defineProperty(window, "sessionStorage", {
      get() { throw new DOMException("Storage blocked", "SecurityError"); },
    });
  });
  await page.goto("/contact");
  await fill(page);
  await page.getByRole("button", { name: "Send Message" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Nothing was sent" })).toBeVisible();
  await expect(page.getByLabel("Name", { exact: false })).toHaveValue("Private Visitor");
  await expect(page.getByLabel("Name", { exact: false })).toBeEnabled();
  expect(s.submitIds).toHaveLength(0);
  expect(s.receiptIds).toHaveLength(0);
});

test("failed receipt cleanup does not turn an accepted request into uncertainty", async ({ page }) => {
  const s = await fixture(page);
  s.lose = false;
  await page.addInitScript(() => {
    const remove = Storage.prototype.removeItem;
    Storage.prototype.removeItem = function (key) {
      if (key === "lrv-contact-request") throw new DOMException("Storage blocked", "SecurityError");
      return remove.call(this, key);
    };
  });
  await page.goto("/contact");
  await fill(page);
  await page.getByRole("button", { name: "Send Message" }).click();
  await expect(page.getByText("Request received. This is not a confirmed appointment.", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Name", { exact: false })).toHaveValue("");
  await page.reload();
  await expect(page.getByText("Your earlier request was received. This is not a confirmed appointment.", { exact: true })).toBeVisible();
  expect(s.submitIds).toHaveLength(1);
  expect(s.receiptIds).toContain(s.submitIds[0]);
});

test("storage failure on retry preserves uncertainty about the earlier request", async ({ page }) => {
  const s = await fixture(page);
  await page.goto("/contact");
  await fill(page);
  await page.getByRole("button", { name: "Send Message" }).click();
  await expect(page.getByRole("button", { name: "Check request receipt" })).toBeVisible();
  await page.evaluate(() => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "lrv-contact-request") throw new DOMException("Quota exceeded", "QuotaExceededError");
      return set.call(this, key, value);
    };
  });
  await page.getByRole("button", { name: "Send Message" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Your earlier request remains unconfirmed" })).toBeVisible();
  await expect(page.getByLabel("Name", { exact: false })).toBeDisabled();
  expect(s.submitIds).toHaveLength(1);
  await page.getByRole("button", { name: "Check request receipt" }).click();
  await expect(page.getByText("Request received. This is not a confirmed appointment.", { exact: true })).toBeVisible();
  expect(s.submitIds).toHaveLength(1);
});

test("text consent is optional, unchecked, needs a phone and is sent as a boolean", async ({ page }) => {
  const s = await fixture(page);
  s.lose = false;
  const payloads: Record<string, unknown>[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/functions/v1/public-contact") && request.postDataJSON()?.action === "submit")
      payloads.push(request.postDataJSON().payload);
  });
  await page.goto("/contact");
  const consent = page.getByRole("checkbox", { name: /I agree to receive text messages/ });
  await expect(consent).not.toBeChecked();
  const form = page.locator("#contact-form");
  await expect(form.getByRole("link", { name: "Privacy Policy", exact: true })).toHaveAttribute("href", "/privacy#text-messages");
  await expect(form.getByRole("link", { name: "Terms", exact: true })).toHaveAttribute("href", "/terms#text-message-program");
  await fill(page);
  await consent.click();
  await page.getByRole("button", { name: "Send Message" }).click();
  await expect(page.getByText("Enter a mobile number to receive texts", { exact: true })).toBeVisible();
  expect(s.submitIds).toHaveLength(0);
  await page.getByRole("textbox", { name: /^Phone/ }).fill("720-555-0100");
  await page.getByRole("button", { name: "Send Message" }).click();
  await expect(page.getByText("Request received. This is not a confirmed appointment.", { exact: true })).toBeVisible();
  expect(payloads[0]).toMatchObject({ phone: "720-555-0100", sms_consent: true });
  await expect(consent).not.toBeChecked();
  await fill(page);
  await page.getByRole("button", { name: "Send Message" }).click();
  await expect.poll(() => payloads.length).toBe(2);
  expect(payloads[1]).toMatchObject({ phone: null, sms_consent: false });
});

test("policy anchors from the consent disclosure land on the text message sections", async ({ page }) => {
  await fixture(page);
  for (const [path, heading] of [["/privacy#text-messages", "Text Messages"], ["/terms#text-message-program", "Text Message Program"]]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeInViewport();
  }
});
