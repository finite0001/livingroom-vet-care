import { holdCountActorLock, releaseCountActorLock } from "./helpers/controlled-count-lock";
import { expect, test, type Page } from "@playwright/test";
const fixture = "/tests/controlled-drugs/count-policy-fixture.html";
async function load(page: Page) { await page.getByRole("button", { name: "Read current settings", exact: true }).click(); }
async function fill(page: Page) {
  for (const label of ["Record independent physical counts", "Finalize and cancel counts", "Read count records", "Investigate and correct discrepancies"])
    await page.getByLabel(label, { exact: true }).selectOption("true");
  await page.getByLabel("Observation method", { exact: true }).selectOption("manual_count");
  for (const label of ["Record observations", "Finalize or cancel counts", "Read count records", "Prepare a stock correction", "Approve a correction", "Execute an approved correction", "Confirm corrected stock", "Resolve an investigation"])
    await page.getByRole("group", { name: label, exact: true }).getByRole("checkbox", { name: "Administrator", exact: true }).check();
  for (const pattern of [/Maximum observation age/, /Correction preparation validity/, /Correction approval validity/, /Correction confirmation validity/]) await page.getByLabel(pattern).fill("100");
  await page.getByLabel("What staff confirm when recording a count", { exact: true }).fill("Synthetic count confirmation");
  await page.getByLabel("What staff confirm for a stock correction", { exact: true }).fill("Synthetic correction confirmation");
  await page.getByLabel("Count confirmation wording version", { exact: true }).fill("synthetic-v1");
  await page.getByLabel("Correction confirmation wording version", { exact: true }).fill("synthetic-v1");
  await page.getByLabel("I reviewed all permissions").check();
}
test("first setup starts blank and cannot publish unchosen settings", async ({ page }) => {
  await page.goto(fixture); await load(page);
  await expect(page.getByLabel("Record independent physical counts", { exact: true })).toHaveValue("");
  await expect(page.getByLabel(/Maximum observation age/)).toHaveValue("");
  await expect(page.getByRole("button", { name: "Publish reviewed settings" })).toBeDisabled();
  await expect(page.getByLabel("Synthetic publications")).toHaveText("0");
});
test("explicit settings publish once through the raw receipt client and remain readable", async ({ page }) => {
  await page.goto(fixture); await load(page); await fill(page);
  await page.getByRole("button", { name: "Publish reviewed settings" }).click();
  await expect(page.getByText("Published policy version 1", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Synthetic publications")).toHaveText("1");
  await load(page); await expect(page.getByLabel(/Maximum observation age/)).toHaveValue("100");
  await expect(page.getByLabel("I reviewed all permissions")).not.toBeChecked();
});
test("lost publication stays recoverable after reload and closes without a resend", async ({ page }) => {
  await page.goto(`${fixture}?unknown`); await load(page); await fill(page);
  await page.getByRole("button", { name: "Publish reviewed settings" }).click();
  await expect(page.getByRole("region", { name: "Pending configuration recovery" })).toBeVisible();
  await page.reload(); await expect(page.getByRole("region", { name: "Pending configuration recovery" })).toBeVisible();
  await page.getByRole("button", { name: "Close pending attempt" }).click();
  await expect(page.getByRole("region", { name: "Pending configuration recovery" })).toHaveCount(0);
  await expect(page.getByLabel("Synthetic publications")).toHaveText("0");
});
test("administrator drafts use the route leave guard and fit a phone viewport", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 }); await page.goto(fixture); await load(page);
  await page.getByLabel("What staff confirm when recording a count", { exact: true }).fill("Synthetic unfinished wording");
  await page.getByRole("link", { name: "Leave settings" }).click(); await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.getByRole("button", { name: "Keep editing" }).click();
  await expect(page.getByLabel("What staff confirm when recording a count", { exact: true })).toHaveValue("Synthetic unfinished wording");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("a publication blocked before send preserves its draft and unlocks for deliberate submit", async ({ page }) => {
  await page.goto(fixture); await load(page); await fill(page); await holdCountActorLock(page);
  await page.getByRole("button", { name: "Publish reviewed settings", exact: true }).click();
  await expect(page.getByText(/This publication was not sent. Your settings are preserved/)).toBeVisible();
  await expect(page.getByLabel("Synthetic publications")).toHaveText("0");
  await releaseCountActorLock(page);
  await expect(page.getByLabel("What staff confirm when recording a count", { exact: true })).toHaveValue("Synthetic count confirmation");
  await page.getByRole("button", { name: "Publish reviewed settings", exact: true }).click();
  await expect(page.getByText("Published policy version 1", { exact: true })).toBeVisible(); await expect(page.getByLabel("Synthetic publications")).toHaveText("1");
});
