import { test, expect, type Page } from "@playwright/test";
import {
  fixture,
  backend,
  actor,
  client,
  invoice,
  conversation,
} from "./invoice-email-fixture";
async function prepare(page: Page) {
  const email = page.getByRole("region", {
    name: "Invoice email",
    exact: true,
  });
  await email
    .getByLabel("Invoice email conversation")
    .selectOption(conversation);
  await email
    .getByRole("button", { name: "Prepare exact invoice email", exact: true })
    .click();
  await expect(
    email
      .frameLocator("iframe")
      .getByRole("heading", { name: "Synthetic frozen invoice" }),
  ).toBeVisible();
  return email;
}
test("issued invoice freezes recipient and actual attachment before reviewed queue, never claims delivered", async ({
  page,
  baseURL,
}) => {
  const state = await fixture(page, baseURL);
  const email = await prepare(page);
  await expect(email.getByLabel("Invoice email message")).toBeDisabled();
  await expect(
    email.getByRole("button", { name: "Queue reviewed invoice email" }),
  ).toBeDisabled();
  await email.getByRole("checkbox").check();
  await email
    .getByRole("button", { name: "Queue reviewed invoice email" })
    .click();
  await expect(email.getByRole("status")).toContainText(
    "Delivery is not confirmed",
  );
  expect(state.queues).toHaveLength(1);
  expect(state.prepares[0].p_recipient).toBe("household@example.test");
});
test("lost captured prepare and queue responses recover same request after reload", async ({
  page,
  baseURL,
}) => {
  const state = await fixture(page, baseURL);
  state.losePrepare = true;
  await prepare(page);
  const id = state.prepares[0].p_request_id;
  page.on("dialog", (dialog) => dialog.accept());
  await page.reload();
  await page
    .getByRole("button", { name: /issued.*125.00/ })
    .first()
    .click();
  const email = page.getByRole("region", {
    name: "Invoice email",
    exact: true,
  });
  await expect(email.frameLocator("iframe").getByRole("heading")).toHaveText(
    "Synthetic frozen invoice",
  );
  state.loseQueue = true;
  await email.getByRole("checkbox").check();
  await email
    .getByRole("button", { name: "Queue reviewed invoice email" })
    .click();
  await expect(email.getByRole("status")).toContainText(
    "Delivery is not confirmed",
  );
  expect(state.queues[0].p_request_id).toBe(id);
  await email
    .getByRole("button", { name: "Compose a separate new invoice email" })
    .click();
  await email
    .getByLabel("Invoice email subject")
    .fill("Second explicitly requested copy");
  await expect(
    email.getByRole("button", {
      name: "Recover saved invoice email and receipt",
    }),
  ).toBeDisabled();
  await page.evaluate(() =>
    window.dispatchEvent(new Event("visibilitychange")),
  );
  await expect(email.getByLabel("Invoice email subject")).toHaveValue(
    "Second explicitly requested copy",
  );
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.getByRole("button", { name: "Stay and reconcile" }).click();
  await expect(email.getByLabel("Invoice email subject")).toHaveValue(
    "Second explicitly requested copy",
  );
  await email
    .getByRole("button", { name: "Discard invoice email draft" })
    .click();
  await email
    .getByRole("button", { name: "Recover saved invoice email and receipt" })
    .click();
  await expect(email.getByRole("status")).toContainText("Saved queue receipt");
});
test("lost request before capture survives reload with original UUID and locked values", async ({
  page,
  baseURL,
}) => {
  const state = await fixture(page, baseURL);
  state.loseBeforeSave = true;
  const email = page.getByRole("region", {
    name: "Invoice email",
    exact: true,
  });
  await email
    .getByLabel("Invoice email conversation")
    .selectOption(conversation);
  await email
    .getByRole("button", { name: "Prepare exact invoice email", exact: true })
    .click();
  await expect(email.getByRole("alert")).toContainText("not confirmed");
  const original = state.prepares[0];
  page.on("dialog", (dialog) => dialog.accept());
  await page.reload();
  await page
    .getByRole("button", { name: /issued.*125.00/ })
    .first()
    .click();
  await expect(
    email.getByRole("button", { name: "Retry same invoice email preparation" }),
  ).toBeEnabled();
  await email
    .getByRole("button", { name: "Retry same invoice email preparation" })
    .click();
  await expect(email.frameLocator("iframe").getByRole("heading")).toBeVisible();
  expect(state.prepares[1]).toEqual(original);
});
test("definitive uncaptured rejection restores editable draft and permits new request", async ({
  page,
  baseURL,
}) => {
  const state = await fixture(page, baseURL);
  state.reject = true;
  const email = page.getByRole("region", {
    name: "Invoice email",
    exact: true,
  });
  await email
    .getByLabel("Invoice email conversation")
    .selectOption(conversation);
  await email
    .getByRole("button", { name: "Prepare exact invoice email", exact: true })
    .click();
  await expect(email.getByRole("alert")).toContainText(
    "rejected before saving",
  );
  await expect(email.getByLabel("Invoice email subject")).toBeEnabled();
  state.reject = false;
  await email.getByLabel("Invoice email subject").fill("Corrected subject");
  await email
    .getByRole("button", { name: "Prepare exact invoice email", exact: true })
    .click();
  await expect(email.frameLocator("iframe").getByRole("heading")).toBeVisible();
  expect(state.prepares[1].p_request_id).not.toBe(
    state.prepares[0].p_request_id,
  );
});
test("credit changes invalidate prepared copy and require abandon before a fresh snapshot", async ({
  page,
  baseURL,
}) => {
  const state = await fixture(page, baseURL);
  const email = await prepare(page);
  state.hash = "d".repeat(64);
  await email.getByRole("checkbox").check();
  await email
    .getByRole("button", { name: "Queue reviewed invoice email" })
    .click();
  await expect(email.getByRole("alert").first()).toContainText("changed");
  expect(state.queues).toHaveLength(0);
  await email
    .getByRole("button", { name: "Abandon this unqueued invoice email" })
    .click();
  await expect(email.getByLabel("Invoice email subject")).toBeEnabled();
  await email
    .getByRole("button", { name: "Prepare exact invoice email", exact: true })
    .click();
  await expect(email.frameLocator("iframe").getByRole("heading")).toBeVisible();
  expect(state.prepares[1].p_invoice_hash).toBe(state.hash);
});
test("fresh household can create conversation and mobile draft blocks invoice and SPA switches", async ({
  page,
  baseURL,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fixture(page, baseURL, true);
  const email = page.getByRole("region", {
    name: "Invoice email",
    exact: true,
  });
  await email
    .getByRole("button", { name: "Create or use active invoice conversation" })
    .click();
  await email.getByLabel("Invoice email message").fill("Keep this draft");
  await expect(
    page.getByRole("button", { name: /issued.*125.00/ }).nth(1),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.getByRole("button", { name: "Stay and reconcile" }).click();
  await expect(email.getByLabel("Invoice email message")).toHaveValue(
    "Keep this draft",
  );
  await email
    .getByRole("button", { name: "Discard invoice email draft" })
    .click();
  await expect(
    page.getByRole("button", { name: /issued.*125.00/ }).nth(1),
  ).toBeEnabled();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("failed current eligibility read cannot prepare or queue an invoice", async ({
  page,
  baseURL,
}) => {
  const state = await fixture(page, baseURL);
  state.previewFail = true;
  const email = page.getByRole("region", {
    name: "Invoice email",
    exact: true,
  });
  await email
    .getByLabel("Invoice email conversation")
    .selectOption(conversation);
  await email
    .getByRole("button", { name: "Prepare exact invoice email", exact: true })
    .click();
  await expect(
    email.getByText("Current invoice or household recipient is unavailable.", {
      exact: false,
    }),
  ).toBeVisible();
  expect(state.prepares).toHaveLength(0);
});

test("external void keeps prepared request mounted and historical queue receipt recoverable", async ({
  page,
  baseURL,
}) => {
  const state = await fixture(page, baseURL);
  const email = await prepare(page);
  state.invoiceStatus = "void";
  await page.evaluate(() =>
    window.dispatchEvent(new Event("visibilitychange")),
  );
  await expect(
    email.getByText("This invoice is not issued.", { exact: false }),
  ).toBeVisible();
  await expect(email.frameLocator("iframe").getByRole("heading")).toHaveText(
    "Synthetic frozen invoice",
  );
  await expect(
    page.getByRole("button", { name: /void.*125.00/ }).first(),
  ).toBeDisabled();
  await email
    .getByRole("button", { name: "Abandon this unqueued invoice email" })
    .click();
  await expect(
    email.getByRole("button", {
      name: "Prepare exact invoice email",
      exact: true,
    }),
  ).toBeDisabled();
  state.saved = {
    request: {
      id: "99999999-9999-4999-8999-999999999999",
      invoice_id: invoice,
      actor_id: actor,
      client_id: client,
      conversation_id: conversation,
      recipient: "household@example.test",
      subject: "Prior invoice",
      body: "Prior copy",
      invoice_hash: "a".repeat(64),
      state: "queued",
    },
    payload_hash: "b".repeat(64),
    manifest: [
      {
        filename: "invoice.html",
        mime_type: "text/html",
        file_size: 123,
        sha256: "c".repeat(64),
      },
    ],
    report_html: "<h1>Previous invoice</h1>",
    purged_at: null,
    receipt: {
      outbox_id: "99999999-9999-4999-8999-999999999999",
      message_id: "88888888-8888-4888-8888-888888888888",
      state: "queued",
      queued: true,
      delivered: false,
    },
  };
  await email
    .getByRole("button", { name: "Recover saved invoice email and receipt" })
    .click();
  await expect(
    email.getByRole("status").filter({ hasText: "Saved queue receipt" }),
  ).toContainText("Delivery is not confirmed");
  await expect(
    email.getByRole("button", { name: "Compose a separate new invoice email" }),
  ).toBeDisabled();
});
for (const failure of [false, true])
  test(`pending text removed on ${failure ? "failed staff verification" : "signout"}`, async ({
    page,
    baseURL,
  }) => {
    const state = await fixture(page, baseURL);
    await prepare(page);
    expect(
      await page.evaluate(
        () =>
          Object.keys(sessionStorage).filter((k) =>
            k.startsWith("invoice-email-intent:"),
          ).length,
      ),
    ).toBe(1);
    if (failure) {
      state.failAuth = true;
      page.on("dialog", (dialog) => dialog.accept());
      await page.reload();
      await expect(
        page
          .getByText("Your staff access could not be verified.", {
            exact: false,
          })
          .first(),
      ).toBeVisible();
    } else {
      await page.getByRole("button", { name: "Sign Out", exact: true }).click();
      await expect(page).toHaveURL(/login/);
    }
    expect(
      await page.evaluate(
        () =>
          Object.keys(sessionStorage).filter((k) =>
            k.startsWith("invoice-email-intent:"),
          ).length,
      ),
    ).toBe(0);
  });

test("failed invoice refresh preserves captured copy and dirty guard until successful retry", async ({
  page,
  baseURL,
}) => {
  const state = await fixture(page, baseURL);
  const email = await prepare(page);
  state.invoiceFail = true;
  await page.evaluate(() =>
    window.dispatchEvent(new Event("visibilitychange")),
  );
  await expect(
    page.getByText("Current invoice details could not be refreshed.", {
      exact: false,
    }),
  ).toBeVisible({ timeout: 15000 });
  await expect(email.frameLocator("iframe").getByRole("heading")).toHaveText(
    "Synthetic frozen invoice",
  );
  await email.getByRole("checkbox").check();
  await expect(
    email.getByRole("button", { name: "Queue reviewed invoice email" }),
  ).toBeDisabled();
  state.invoiceFail = false;
  await page
    .getByRole("button", { name: "Retry current invoice details" })
    .click();
  await expect(
    page.getByText("Current invoice details could not be refreshed.", {
      exact: false,
    }),
  ).toHaveCount(0);
  await expect(
    email.getByRole("button", { name: "Queue reviewed invoice email" }),
  ).toBeEnabled();
});
