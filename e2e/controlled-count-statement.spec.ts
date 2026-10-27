import { expect, test, type Page } from "@playwright/test";

async function fill(page: Page) {
  await page.getByLabel("When did you observe the stock?").fill("2026-10-26T12:30:15");
  await page.getByLabel("Was this container present?").selectOption("present");
  await page.getByLabel("Available stock · lot SYNTHETIC · quantity (mL)").fill("123.125");
  await page.getByLabel("I personally observed").check();
}
test("blank quantities and unchecked container cannot become an automatic observation", async ({ page }) => {
  await page.goto("/tests/controlled-drugs/count-statement-fixture.html");
  await expect(page.getByRole("button", { name: "Record my observation" })).toBeDisabled();
  await expect(page.getByLabel("Available stock · lot SYNTHETIC · quantity (mL)")).toHaveValue("");
  await expect(page.getByLabel("Was this container present?")).toHaveValue("");
  await expect(page.getByLabel("Synthetic save calls")).toHaveText("0");
  await expect(page.getByRole("region", { name: "Count comparison" })).toHaveCount(0);
});
test("explicit observation submits once and locks its retained request", async ({ page }) => {
  await page.goto("/tests/controlled-drugs/count-statement-fixture.html"); await fill(page);
  await page.getByRole("button", { name: "Record my observation" }).dblclick();
  await expect(page.getByLabel("Synthetic save calls")).toHaveText("1");
  await expect(page.getByLabel("Synthetic saved request")).toContainText('"quantity":"123.125"');
  await expect(page.getByLabel("Synthetic saved request")).toContainText('"observed_at":"2026-10-26T19:30:15.000000Z"');
  await expect(page.getByLabel("Available stock · lot SYNTHETIC · quantity (mL)")).toBeDisabled();
});
test("unknown save keeps the same operation locked for recovery", async ({ page }) => {
  await page.goto("/tests/controlled-drugs/count-statement-fixture.html?unknown"); await fill(page);
  await page.getByRole("button", { name: "Record my observation" }).click();
  await expect(page.getByRole("alert")).toContainText("Check recovery");
  await expect(page.getByRole("button", { name: "Record my observation" })).toBeDisabled();
  await expect(page.getByLabel("Synthetic save calls")).toHaveText("1");
});
test("changing observer removes the previous observer's unsaved draft", async ({ page }) => {
  await page.goto("/tests/controlled-drugs/count-statement-fixture.html"); await fill(page);
  await page.getByRole("button", { name: "Switch observer" }).click();
  await expect(page.getByLabel("Available stock · lot SYNTHETIC · quantity (mL)")).toHaveValue("");
  await expect(page.getByLabel("When did you observe the stock?")).toHaveValue("");
  await expect(page.getByLabel("I personally observed")).not.toBeChecked();
  await expect(page.getByLabel("Synthetic save calls")).toHaveText("0");
});
test("nonexistent daylight-saving local time is refused without a save", async ({ page }) => {
  await page.goto("/tests/controlled-drugs/count-statement-fixture.html"); await fill(page);
  // Playwright's fill itself uses local Date parsing and rejects this gap.
  // Deliver the valid HTML local-time token through the native input event.
  await page.getByLabel("When did you observe the stock?").evaluate(input => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "2026-03-08T02:30");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.getByRole("button", { name: "Record my observation" }).click();
  await expect(page.getByRole("alert")).toContainText("does not exist");
  await expect(page.getByLabel("Synthetic save calls")).toHaveText("0");
});
test("mobile entry keeps controls inside the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/tests/controlled-drugs/count-statement-fixture.html");
  await page.getByRole("button", { name: "Add a finding" }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByLabel("Location", { exact: true }).selectOption({ label: "Medication safe" });
  await page.getByLabel("What did you observe?").fill("Synthetic unexpected label");
  await fill(page); await page.getByRole("button", { name: "Record my observation" }).click();
  await expect(page.getByLabel("Synthetic saved request")).toContainText("Synthetic unexpected label");
});
test("both submitted observations reveal exact differences without changing stock", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/tests/controlled-drugs/count-statement-fixture.html?comparison");
  const comparison = page.getByRole("region", { name: "Count comparison" });
  await expect(comparison).toContainText("12.000 mL");
  await expect(comparison.getByText("11.125 mL · differs", { exact: true })).toHaveCount(2);
  await expect(comparison).toContainText("Recording a count does not change stock balances");
  await expect(page.getByLabel("Synthetic save calls")).toHaveText("0");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test("fall-back time requires an explicit occurrence and preserves the second instant", async ({ page }) => {
  await page.goto("/tests/controlled-drugs/count-statement-fixture.html"); await fill(page);
  await page.getByLabel("When did you observe the stock?").fill("2026-11-01T01:30");
  await expect(page.getByLabel("Which occurrence of this time?")).toHaveValue("");
  await page.getByRole("button", { name: "Record my observation" }).click();
  await expect(page.getByLabel("Synthetic save calls")).toHaveText("0");
  await page.getByLabel("Which occurrence of this time?").selectOption("-08:00");
  await page.getByRole("button", { name: "Record my observation" }).click();
  await expect(page.getByLabel("Synthetic saved request")).toContainText('"observed_at":"2026-11-01T09:30:00.000000Z"');
});
