import { expect, test } from "@playwright/test";

for (const width of [375, 1280]) {
  test(`synthetic register report is readable and escaped at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/tests/controlled-drugs/register-fixture.html");
    await page.getByRole("button", { name: "Create and verify report" }).click();
    await expect(page.locator('p[role="status"]')).toHaveText("Saved and verified.");
    await expect(page.getByRole("heading", { name: /Schedule II/ })).toContainText('<img src=x onerror="alert(1)">');
    await expect(page.locator("img")).toHaveCount(0);
    await expect(page.getByRole("cell", { name: "1.250 mL", exact: true })).toBeVisible();
    await expect(page.getByRole("cell", { name: "1.375 mL", exact: true })).toBeVisible();
    await expect(page.getByText(/Not a physical observation/)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const downloaded = page.waitForEvent("download"); await page.getByRole("button", { name: "Download verified CSV" }).click();
    expect((await downloaded).suggestedFilename()).toMatch(/^narcotics-schedule-II-.*\.csv$/);
    await page.getByRole("button", { name: "Load saved reports" }).click();
    await page.getByRole("button", { name: /^Period / }).click();
    await expect(page.locator('p[role="status"]')).toHaveText("Saved and verified.");
    await page.getByRole("button", { name: "Clear synthetic presentation identity" }).click();
    await expect(page.getByRole("heading", { name: /Schedule II/ })).toHaveCount(0);
  });
}
test("synthetic lost save survives reload and requires terminal closure", async ({ page }) => {
  await page.goto("/tests/controlled-drugs/register-fixture.html?unknown");
  await page.getByRole("button", { name: "Create and verify report" }).click();
  await expect(page.getByRole("heading", { name: "An earlier save needs recovery" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create and verify report" })).toBeDisabled();
  await page.reload(); await page.getByRole("button", { name: "Check original result" }).click();
  await expect(page.locator('p[role="status"]')).toContainText("No saved result is visible yet");
  await expect(page.getByRole("button", { name: "Create and verify report" })).toBeDisabled();
  await page.getByRole("button", { name: "Permanently close original operation" }).click();
  await expect(page.getByRole("button", { name: "Create and verify report" })).toBeEnabled();
});
test("synthetic movement selection resets when another report opens", async ({ page }) => {
  await page.goto("/tests/controlled-drugs/register-fixture.html");
  await page.getByRole("button", { name: "Create and verify report" }).click();
  const movement = page.getByLabel("Related movement", { exact: true });
  await movement.selectOption({ index: 1 }); await expect(movement).not.toHaveValue("");
  await page.getByRole("button", { name: "Create and verify report" }).click();
  await expect(movement).toHaveValue("");
});
test("synthetic print contains source facts and hides the rest of the workspace", async ({ page }) => {
  await page.goto("/tests/controlled-drugs/register-fixture.html");
  await page.getByRole("button", { name: "Create and verify report" }).click();
  await page.emulateMedia({ media: "print" });
  await page.evaluate(() => {
    window.print = () => {
      const portal = document.querySelector("[data-narcotics-print-root]");
      sessionStorage.setItem("synthetic-print-result", JSON.stringify({ text: portal?.textContent, hidden: getComputedStyle(document.getElementById("root")!).display === "none" }));
      window.dispatchEvent(new Event("afterprint"));
    };
  });
  await page.getByRole("button", { name: "Print / save PDF" }).click();
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("synthetic-print-result"))).not.toBeNull();
  const result = await page.evaluate(() => JSON.parse(sessionStorage.getItem("synthetic-print-result")!));
  expect(result.hidden).toBe(true); expect(result.text).toContain("Custody at start"); expect(result.text).toContain("Location:");
  expect(result.text).toContain("Original registration and opening evidence"); expect(result.text).toContain("Not completed at export");
  await expect(page.locator("[data-narcotics-print-root]")).toHaveCount(0);
});
