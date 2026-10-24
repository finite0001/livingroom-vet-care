import { test, expect } from "@playwright/test";
const url = "/tests/controlled-drugs/record-review-workflow-fixture.html";
test.beforeEach(async ({ context, baseURL }) => {
  await context.route("**/*", route => new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort());
});
test("synthetic staff workflow requires later keyboard confirmation, preserves exact evidence, and fits mobile/desktop", async ({ page }, testInfo) => {
  await page.goto(url); await expect(page.getByText(/Synthetic staff workflow/)).toBeVisible();
  await page.getByLabel("Review reason", { exact: true }).fill("Reviewed synthetic evidence 🐕");
  await page.getByRole("button", { name: "Prepare record review", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Record 9223372036854775807" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm and sign record review" })).toHaveCount(0);
  await expect(page.getByTestId("rpc-count")).toHaveText("1");
  await expect(page.getByText("Synthetic original performer", { exact: true })).toBeVisible();
  await expect(page.getByText("Synthetic medication", { exact: true })).toBeVisible();
  await expect(page.getByText("1.125", { exact: true })).toBeVisible();
  await expect(page.getByText("2026-10-22T09:00:00.000000Z", { exact: true }).first()).toBeVisible();
  await page.getByText("Original event", { exact: true }).click();
  await expect(page.locator("pre").filter({ hasText: "0.123456789012345678901234567890" })).toBeVisible();
  await page.getByText("Original record identity", { exact: true }).click();
  for (const width of [375, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    for (const button of await page.getByRole("button").all()) expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: testInfo.outputPath(`staff-review-${width}.png`), fullPage: true });
  }
  await page.getByRole("button", { name: "I have reviewed this preparation" }).focus(); await page.keyboard.press("Enter");
  await expect(page.getByTestId("rpc-count")).toHaveText("1");
  await expect(page.getByRole("button", { name: "Confirm and sign record review" }).locator("..")).toContainText("Independent record review; no claim of personal physical observation.");
  await page.getByRole("button", { name: "Confirm and sign record review" }).focus(); await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toHaveText("Record review saved.");
  await expect(page.getByTestId("rpc-count")).toHaveText("2");
  await expect(page.getByRole("button", { name: "Start another review" })).toBeVisible();
  expect(await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith("lrv:record-review:v3:")))).toEqual([]);
});
test("synthetic lost response/not_found retains exact pointer and does not create replacement or sign", async ({ page }) => {
  await page.goto(url); await page.getByRole("button", { name: "Lose next response" }).click();
  await page.getByLabel("Review reason", { exact: true }).fill("Synthetic lost response");
  await page.getByRole("button", { name: "Prepare record review", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Outcome unconfirmed");
  const pointer = await page.evaluate(() => Object.entries(localStorage).filter(([key]) => key.startsWith("lrv:record-review:v3:")));
  expect(pointer).toHaveLength(1); expect(Object.keys(JSON.parse(pointer[0][1])).sort()).toEqual(["actor_id", "operation_id", "transport_digest", "version"]);
  await page.getByRole("button", { name: "Return not found on recovery" }).click();
  await page.getByRole("button", { name: "Recover original review" }).click();
  await expect(page.getByRole("status")).toContainText("does not close the original operation");
  await expect(page.getByRole("button", { name: "Prepare record review", exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => Object.entries(localStorage).filter(([key]) => key.startsWith("lrv:record-review:v3:")))).toEqual(pointer);
  await page.getByRole("button", { name: "Cancel original preparation" }).click();
  await expect(page.getByRole("status")).toHaveText("Review preparation cancelled.");
  await expect(page.getByTestId("rpc-count")).toHaveText("3");
});
test("synthetic session invalidation removes clinical packet and draft, disallows confirm and recovers explicitly", async ({ page }) => {
  await page.goto(url); await page.getByLabel("Review reason", { exact: true }).fill("Synthetic private reason");
  await page.getByRole("button", { name: "Prepare record review", exact: true }).click();
  await page.getByRole("button", { name: "I have reviewed this preparation" }).click();
  await page.getByRole("button", { name: "Change synthetic session" }).click();
  await expect(page.getByText("Synthetic private reason", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Confirm and sign record review" })).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText("earlier review operation needs recovery");
  await expect(page.getByTestId("rpc-count")).toHaveText("1");
  await page.getByRole("button", { name: "Recover original review" }).click();
  await expect(page.getByRole("button", { name: "I have reviewed this preparation" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm and sign record review" })).toHaveCount(0);
});
test("unsubmitted draft text is cleared on synthetic session change", async ({ page }) => {
  await page.goto(url); await page.getByLabel("Review reason", { exact: true }).fill("Unsubmitted private synthetic reason");
  await page.getByRole("button", { name: "Change synthetic session" }).click();
  await expect(page.getByLabel("Review reason", { exact: true })).toHaveValue("");
  await expect(page.getByTestId("rpc-count")).toHaveText("0");
});
test("old session cleanup rejection cannot publish an alert into the new session", async ({ page }) => {
  await page.goto(url); await page.getByRole("button", { name: "Fail recovery cleanup" }).click();
  await page.getByLabel("Review reason", { exact: true }).fill("Synthetic cleanup generation test");
  await page.getByRole("button", { name: "Prepare record review", exact: true }).click();
  await page.getByRole("button", { name: "I have reviewed this preparation" }).click();
  await page.getByRole("button", { name: "Confirm and sign record review" }).click();
  await expect(page.getByRole("button", { name: "Finish recovery cleanup" })).toBeEnabled();
  await page.getByRole("button", { name: "Pause cleanup retry" }).click();
  await page.getByRole("button", { name: "Finish recovery cleanup" }).click();
  await expect(page.getByRole("button", { name: "Finish recovery cleanup" })).toBeDisabled();
  await page.getByRole("button", { name: "Change synthetic session" }).click();
  await page.getByRole("button", { name: "Reject paused cleanup" }).click();
  await expect(page.getByRole("status")).toContainText("earlier review operation needs recovery");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByTestId("rpc-count")).toHaveText("2");
});
test("two synthetic browser tabs share actual Web Locks and submit only the winning operation", async ({ context }) => {
  const a = await context.newPage(), b = await context.newPage();
  await Promise.all([a.goto(url), b.goto(url)]);
  await Promise.all([a.getByLabel("Review reason", { exact: true }).fill("Synthetic same selection"), b.getByLabel("Review reason", { exact: true }).fill("Synthetic same selection")]);
  await Promise.all([a.getByRole("button", { name: "Prepare record review", exact: true }).click(), b.getByRole("button", { name: "Prepare record review", exact: true }).click()]);
  await expect.poll(async () => Number(await a.getByTestId("rpc-count").textContent()) + Number(await b.getByTestId("rpc-count").textContent())).toBe(1);
  const text = await Promise.all([a.getByRole("status").textContent(), b.getByRole("status").textContent()]);
  expect(text.filter(value => value?.includes("Preparation ready"))).toHaveLength(1);
  expect(text.filter(value => value?.includes("needs recovery"))).toHaveLength(1);
});
