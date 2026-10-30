import { expect, test } from "@playwright/test";

for (const width of [375, 1280]) {
  test(`synthetic recovery requires exact-file review and fresh confirmation at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/tests/controlled-drugs/recovery-fixture.html");
    await expect(page.getByText('<img src=x onerror="alert(1)"> Synthetic staff-reported missing event.', { exact: true })).toBeVisible();
    await expect(page.locator("img")).toHaveCount(0);
    const reviewed = page.getByLabel("I reviewed this original file and the staff-reported account.");
    await expect(reviewed).toBeDisabled();
    const download = page.waitForEvent("download"); await page.getByRole("button", { name: "Download verified original file" }).click();
    expect((await download).suggestedFilename()).toBe("synthetic-original.txt");
    await reviewed.check(); await page.getByLabel("Independent review note").fill("Synthetic independent review.");
    await expect(page.getByRole("button", { name: "Sign independent review" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Verify recovery and resume recording" })).toBeDisabled();
    await page.getByRole("button", { name: "Simulate a new recovery attempt" }).click();
    await expect(reviewed).not.toBeChecked(); await expect(reviewed).toBeDisabled();
    await expect(page.getByRole("button", { name: "Sign independent review" })).toBeDisabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
test("synthetic lost evidence response retains its original file and account", async ({ page }) => {
  await page.goto("/tests/controlled-drugs/recovery-fixture.html");
  await page.getByRole("button", { name: "Load medications and sites" }).click();
  await page.getByRole("button", { name: "Open medication" }).click();
  await page.getByLabel("Staff-reported account", { exact: true }).fill("Synthetic missing event account.");
  await page.getByLabel("Original supporting file (up to 2 MiB)").setInputFiles({ name: "synthetic.txt", mimeType: "text/plain", buffer: Buffer.from("Synthetic original file") });
  await page.getByRole("button", { name: "Record supporting evidence" }).click();
  await expect(page.locator('p[role="status"]')).toContainText("Synthetic response lost");
  await expect(page.getByLabel("Synthetic saves")).toHaveText("1");
  await expect(page.getByLabel("Staff-reported account", { exact: true })).toHaveValue("Synthetic missing event account.");
  expect(await page.getByLabel("Original supporting file (up to 2 MiB)").evaluate((input: HTMLInputElement) => input.files?.[0]?.name)).toBe("synthetic.txt");
});
test("synthetic backup references cannot be discarded by changing pages silently", async ({ page }) => {
  await page.goto("/tests/controlled-drugs/recovery-fixture.html?mode=original");
  await page.getByLabel("Backup preparation ID").fill("10000000-0000-4000-8000-000000000001");
  await page.getByRole("link", { name: "Leave presentation" }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.getByRole("button", { name: "Keep editing" }).click();
  await expect(page.getByLabel("Backup preparation ID")).toHaveValue("10000000-0000-4000-8000-000000000001");
});
