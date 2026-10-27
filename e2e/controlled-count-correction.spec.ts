import { expect, test } from "@playwright/test";
const fixture = "/tests/controlled-drugs/count-correction-fixture.html";
test("correction approval requires reading all source evidence and an explicit later action", async ({ page }) => {
  await page.goto(fixture); await page.getByRole("button", { name: "Load stock reviews", exact: true }).click();
  await expect(page.getByText(/Other sites also have open investigations/)).toBeVisible();
  await page.getByRole("button", { name: "Open correction", exact: true }).click();
  await expect(page.getByText("12.000 mL", { exact: true })).toBeVisible();
  const approve = page.getByRole("button", { name: "Approve this correction", exact: true }); await expect(approve).toBeDisabled();
  await page.getByRole("button", { name: "Read source count 1", exact: true }).click();
  await page.getByRole("button", { name: "I reviewed this source count", exact: true }).click(); await expect(approve).toBeDisabled();
  await page.getByRole("checkbox", { name: "I reviewed every source count, the proposed change, and the confirmation wording." }).check();
  await expect(page.getByLabel("Synthetic mutations")).toHaveText("0"); await approve.click();
  await expect(page.getByText("Correction approved. Reload the case list for the next step.")).toBeVisible(); await expect(page.getByLabel("Synthetic mutations")).toHaveText("1");
});
test("an uncertain approval stays recoverable and cannot be sent twice", async ({ page }) => {
  await page.goto(fixture + "?unknown=1"); await page.getByRole("button", { name: "Load stock reviews", exact: true }).click(); await page.getByRole("button", { name: "Open correction", exact: true }).click();
  await page.getByRole("button", { name: "Read source count 1", exact: true }).click(); await page.getByRole("button", { name: "I reviewed this source count", exact: true }).click();
  await page.getByRole("checkbox", { name: "I reviewed every source count, the proposed change, and the confirmation wording." }).check(); await page.getByRole("button", { name: "Approve this correction", exact: true }).click();
  await expect(page.getByRole("region", { name: "Pending correction recovery" })).toBeVisible(); await expect(page.getByRole("button", { name: "Approve this correction", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Check original action", exact: true }).click(); await expect(page.getByText(/No saved receipt yet/)).toBeVisible();
  await expect(page.getByLabel("Synthetic mutations")).toHaveText("1"); await page.getByRole("button", { name: "Close pending attempt", exact: true }).click();
  await expect(page.getByText("The original attempt is closed without a save.")).toBeVisible();
});
test("a fresh correction has blank physical changes and guards unsubmitted reasons", async ({ page }) => {
  await page.goto(fixture); await page.getByRole("button", { name: "Load stock reviews", exact: true }).click(); await page.getByRole("button", { name: "Check eligibility for a new correction", exact: true }).click();
  await expect(page.getByLabel(/Signed quantity change/)).toHaveValue(""); await expect(page.getByLabel("Reason for this correction", { exact: true })).toHaveValue("");
  await page.getByLabel("Reason for this correction", { exact: true }).fill("Unsubmitted synthetic reason"); await page.getByRole("link", { name: "Leave synthetic correction" }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible(); await expect(page.getByLabel("Synthetic mutations")).toHaveText("0");
});
test("closing a variance uses a confirmed correction and a separately reviewed fresh agreeing count", async ({ page }) => {
  await page.goto(fixture + "?stage=confirmed"); await page.getByRole("button", { name: "Load stock reviews", exact: true }).click(); await page.getByRole("button", { name: "Open correction", exact: true }).click();
  await page.getByRole("button", { name: "Review resolution evidence", exact: true }).click();
  await expect(page.getByRole("button", { name: "Read source count", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Discard this review draft", exact: true })).toBeVisible();
  const resolve = page.getByRole("button", { name: "Request verified investigation resolution", exact: true }); await expect(resolve).toBeDisabled();
  await page.getByLabel("New agreeing count", { exact: true }).selectOption({ index: 1 }); await expect(resolve).toBeDisabled();
  await page.getByRole("button", { name: "Read selected fresh count", exact: true }).click();
  await page.getByRole("checkbox", { name: /I reviewed the source count’s available information/ }).check();
  await expect(page.getByLabel("Synthetic mutations")).toHaveText("0"); await resolve.click();
  await expect(page.getByText("Investigation resolved. Reload the case list for the next step.")).toBeVisible(); await expect(page.getByLabel("Synthetic mutations")).toHaveText("1");
});
for (const width of [375, 1280]) test(`correction proposal remains readable at ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 900 }); await page.goto(fixture);
  await page.getByRole("button", { name: "Load stock reviews", exact: true }).click(); await page.getByRole("button", { name: "Open correction", exact: true }).click();
  const proposal = page.getByRole("region", { name: "Proposed stock correction", exact: true }); await expect(proposal).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await proposal.screenshot({ path: testInfo.outputPath(`proposal-${width}.png`) });
});

test("resolution explicitly pages past one hundred newer cancelled counts", async ({ page }) => {
  await page.goto(fixture + "?stage=confirmed&paged=1"); await page.getByRole("button", { name: "Load stock reviews", exact: true }).click(); await page.getByRole("button", { name: "Open correction", exact: true }).click();
  await page.getByRole("button", { name: "Review resolution evidence", exact: true }).click();
  await expect(page.getByLabel("New agreeing count", { exact: true }).locator("option")).toHaveCount(1);
  await page.getByRole("button", { name: "Earlier count candidates", exact: true }).click();
  await expect(page.getByLabel("New agreeing count", { exact: true }).locator("option")).toHaveCount(2);
  await page.getByLabel("New agreeing count", { exact: true }).selectOption({ index: 1 }); await page.getByRole("button", { name: "Read selected fresh count", exact: true }).click();
  await page.getByRole("checkbox", { name: /I reviewed the source count’s available information/ }).check(); await page.getByRole("button", { name: "Request verified investigation resolution", exact: true }).click();
  await expect(page.getByText("Investigation resolved. Reload the case list for the next step.")).toBeVisible(); await expect(page.getByLabel("Synthetic mutations")).toHaveText("1");
});
