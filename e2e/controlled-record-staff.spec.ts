import { expect, test } from "@playwright/test";
const fixture = "/tests/controlled-drugs/record-review-staff-fixture.html";
async function openReview(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Load review records", exact: true }).click();
  await page.getByRole("button", { name: /^Open record [0-9]+$/ }).click();
  await expect(page.getByLabel("Synthetic admission reads")).toHaveText("1");
  await page.getByRole("button", { name: "Open record review", exact: true }).click();
  await page.getByLabel("Review reason", { exact: true }).fill("Reviewed synthetic staff composition");
}
test("staff composition reconstructs evidence before explicit preparation and later signing", async ({ page }) => {
  await page.goto(fixture); await openReview(page);
  await expect(page.getByLabel("Synthetic review mutations")).toHaveText("0");
  await page.getByRole("button", { name: "Prepare record review", exact: true }).click();
  await page.getByRole("button", { name: "I have reviewed this preparation", exact: true }).click();
  await expect(page.getByLabel("Synthetic admission reads")).toHaveText("2");
  await expect(page.getByLabel("Synthetic review mutations")).toHaveText("1");
  await page.getByRole("button", { name: "Confirm and sign record review", exact: true }).click();
  await expect(page.getByLabel("Synthetic review mutations")).toHaveText("2");
  await expect(page.getByRole("button", { name: "Start another review", exact: true })).toBeVisible();
});
test("lost signing response recovers the same operation without another signature", async ({ page }) => {
  await page.goto(fixture + "?unknown=1"); await openReview(page);
  await page.getByRole("button", { name: "Prepare record review", exact: true }).click(); await page.getByRole("button", { name: "I have reviewed this preparation", exact: true }).click();
  await page.getByRole("button", { name: "Confirm and sign record review", exact: true }).click();
  await page.getByRole("button", { name: "Recover original review", exact: true }).click();
  await expect(page.getByRole("button", { name: "Start another review", exact: true })).toBeVisible(); await expect(page.getByLabel("Synthetic review mutations")).toHaveText("2");
});
test("a mismatched reconstruction cannot offer preparation", async ({ page }) => {
  await page.goto(fixture + "?mismatch=1"); await page.getByRole("button", { name: "Load review records", exact: true }).click(); await page.getByRole("button", { name: /^Open record [0-9]+$/ }).click();
  await expect(page.getByText(/detail could not be|could not be admitted|could not be opened/i)).toBeVisible();
  await page.getByRole("button", { name: "Open record review", exact: true }).click();
  await expect(page.getByRole("button", { name: "Prepare record review", exact: true })).toHaveCount(0); await expect(page.getByLabel("Synthetic review mutations")).toHaveText("0");
});
