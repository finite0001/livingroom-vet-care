import { test, expect } from "@playwright/test";

for (const width of [375, 1280]) test(`workspace draft and session isolation at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  const outbound: string[] = [];
  await page.route("**/*", async route => {
    const address = new URL(route.request().url());
    if (address.hostname !== "127.0.0.1" && address.hostname !== "localhost") { outbound.push(address.origin); await route.abort(); }
    else await route.continue();
  });
  await page.goto("/tests/controlled-drugs/record-review-workspace-fixture.html");
  const counts = () => page.evaluate(() => window.__LRV_WORKSPACE_COUNTS__());
  await expect(page.getByRole("button", { name: "Load review records" })).toBeVisible();
  expect(await counts()).toEqual({ list: 0, detail: 0, mutation: 0 });
  await page.getByRole("button", { name: "Load review records" }).click();
  await page.getByRole("button", { name: /^Open record [0-9]+$/ }).click();
  await expect(page.getByRole("region", { name: "Opened record details" })).toBeVisible();
  await page.getByRole("button", { name: "Open record review", exact: true }).click();
  const reason = page.getByLabel("Review reason", { exact: true });
  await reason.fill("Unsubmitted private review reason");
  expect(await counts()).toEqual({ list: 1, detail: 1, mutation: 0 });
  const close = page.getByRole("dialog", { name: "Record review workspace", exact: true }).getByRole("button", { name: "Close", exact: true });
  await close.click();
  await expect(page.getByRole("alertdialog", { name: "Leave unsubmitted review edits?" })).toBeVisible();
  await page.getByRole("button", { name: "Stay with review", exact: true }).click();
  await expect(reason).toHaveValue("Unsubmitted private review reason");
  expect(await counts()).toEqual({ list: 1, detail: 1, mutation: 0 });
  await close.click();
  await page.getByRole("button", { name: "Discard edits and leave", exact: true }).click();
  await expect(reason).toHaveCount(0);
  await page.getByRole("button", { name: "Refresh from first page" }).click();
  await expect(page.getByRole("region", { name: "Opened record details" })).toHaveCount(0);
  expect(await counts()).toEqual({ list: 2, detail: 1, mutation: 0 });
  await page.getByRole("button", { name: /^Open record [0-9]+$/ }).click();
  await page.getByRole("button", { name: "Open record review", exact: true }).click();
  await expect(reason).toHaveValue(""); await reason.fill("Another unsubmitted private reason");
  await page.evaluate(() => window.__LRV_WORKSPACE_END_SESSION__());
  await expect(page.getByText("Sign in with an active staff account to review records.", { exact: true })).toBeVisible();
  await expect(reason).toHaveCount(0); await expect(page.getByRole("button", { name: /^Open record [0-9]+$/ })).toHaveCount(0);
  expect(await counts()).toEqual({ list: 2, detail: 2, mutation: 0 });
  expect(outbound).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("a filter prop change immediately masks old rows, evidence and preparation IDs", async ({ page }) => {
  await page.goto("/tests/controlled-drugs/record-review-workspace-fixture.html");
  await page.getByRole("button", { name: "Load review records", exact: true }).click();
  await page.getByRole("button", { name: /^Open record [0-9]+$/ }).click();
  await expect(page.getByRole("region", { name: "Opened record details" })).toBeVisible();
  await page.evaluate(() => window.__LRV_WORKSPACE_CHANGE_SCOPE__());
  await expect(page.getByText("Filters changed. Load records for the selected product and site.", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Opened record details" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Open record [0-9]+$/ })).toHaveCount(0);
  expect(await page.evaluate(() => window.__LRV_WORKSPACE_COUNTS__())).toEqual({ list: 1, detail: 1, mutation: 0 });
  await page.getByRole("button", { name: "Open record review", exact: true }).click();
  await expect(page.getByRole("button", { name: "Prepare record review", exact: true })).toHaveCount(0);
  await expect(page.getByText("Open a record to prepare its review.", { exact: true })).toBeVisible();
});
