import { test, expect } from "@playwright/test";
const url = "/tests/controlled-drugs/record-review-dialog-fixture.html";
const pointers = () => Object.entries(localStorage).filter(([key]) => key.startsWith("lrv:record-review:v3:"));
test.beforeEach(async ({ context, baseURL }) => {
  await context.route("**/*", route => new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort());
});
test("synthetic dialog traps keyboard focus and returns it without requests", async ({ page }) => {
  await page.goto(url); await page.getByRole("button", { name: "Open record review" }).click();
  const dialog = page.getByRole("dialog", { name: "Record review workspace" });
  await expect(page.getByRole("heading", { name: "Record review workspace" })).toBeFocused();
  for (let n = 0; n < 24; n++) {
    await page.keyboard.press(n < 12 ? "Tab" : "Shift+Tab");
    expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open record review" })).toBeFocused();
  await expect(page.getByTestId("rpc-count")).toHaveText("0");
});
test("local edits warn and stay intact until explicitly discarded", async ({ page }) => {
  await page.goto(url); await page.getByRole("button", { name: "Open record review" }).click();
  await page.getByLabel("Review reason", { exact: true }).fill("Unsubmitted synthetic reason");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("alertdialog")).toContainText("No review request has been submitted.");
  await page.getByRole("button", { name: "Stay with review" }).click();
  await expect(page.getByLabel("Review reason", { exact: true })).toHaveValue("Unsubmitted synthetic reason");
  await expect(page.getByLabel("Review reason", { exact: true })).toBeFocused();
  await page.keyboard.press("Escape"); await page.getByRole("button", { name: "Discard edits and leave" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Open record review" }).click();
  await expect(page.getByLabel("Review reason", { exact: true })).toHaveValue("");
  await expect(page.getByTestId("rpc-count")).toHaveText("0");
  expect(await page.evaluate(pointers)).toEqual([]);
});
test("closing and navigating retain a durable operation without signing or cancellation", async ({ page }, testInfo) => {
  await page.goto(url); await page.getByRole("button", { name: "Open record review" }).click();
  await page.getByLabel("Review reason", { exact: true }).fill("Synthetic durable operation");
  await page.getByRole("button", { name: "Prepare record review", exact: true }).click();
  await expect(page.getByRole("button", { name: "I have reviewed this preparation" })).toBeVisible();
  const dialog = page.getByRole("dialog", { name: "Record review workspace" });
  for (const width of [375, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    for (const button of await dialog.getByRole("button").all()) expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: testInfo.outputPath(`review-dialog-${width}.png`), fullPage: true });
  }
  const original = await page.evaluate(pointers); expect(original).toHaveLength(1);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("alertdialog")).toContainText("Leaving does not sign or cancel it.");
  await page.getByRole("button", { name: "Leave and recover later" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByTestId("rpc-count")).toHaveText("1"); expect(await page.evaluate(pointers)).toEqual(original);
  await page.evaluate(() => (window as unknown as { syntheticReviewNavigate(): void }).syntheticReviewNavigate());
  await expect(page.getByRole("alertdialog")).toContainText("original recovery pointer stays saved");
  await page.getByRole("button", { name: "Stay with review" }).click(); await expect(page).toHaveURL(new RegExp("record-review-dialog-fixture.html$"));
  await page.evaluate(() => (window as unknown as { syntheticReviewNavigate(): void }).syntheticReviewNavigate());
  await page.getByRole("button", { name: "Leave and recover later" }).click();
  await expect(page.getByRole("heading", { name: "Away from synthetic review" })).toBeVisible();
  expect(await page.evaluate(pointers)).toEqual(original); await expect(page.getByTestId("rpc-count")).toHaveText("1");
  await page.getByRole("link", { name: "Return to review" }).click(); await page.getByRole("button", { name: "Open record review" }).click();
  await expect(page.getByRole("button", { name: "I have reviewed this preparation" })).toBeVisible();
  await expect(page.getByTestId("rpc-count")).toHaveText("1");
});
test("replacing a model at the same identity revision drops the old draft and warning", async ({ page }) => {
  await page.goto(url); await page.getByRole("button", { name: "Open record review" }).click();
  await page.getByRole("radio", { name: "Reject the record" }).check();
  await page.getByLabel("Review reason", { exact: true }).fill("Private draft from replaced model");
  await page.evaluate(() => (window as unknown as { syntheticReviewReplaceModel(): void }).syntheticReviewReplaceModel());
  await expect(page.getByLabel("Review reason", { exact: true })).toHaveValue("");
  await expect(page.getByRole("radio", { name: "Approve the record" })).toBeChecked();
  expect(await page.evaluate(() => { const event = new Event("beforeunload", { cancelable: true }); dispatchEvent(event); return event.defaultPrevented; })).toBe(false);
  await page.getByLabel("Review reason", { exact: true }).fill("Another old private draft");
  await page.keyboard.press("Escape"); await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.evaluate(() => (window as unknown as { syntheticReviewReplaceModel(): void }).syntheticReviewReplaceModel());
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(page.getByLabel("Review reason", { exact: true })).toHaveValue("");
  await expect(page.getByTestId("rpc-count")).toHaveText("0"); expect(await page.evaluate(pointers)).toEqual([]);
});
test("unload warning and session invalidation preserve the original pointer and remove the packet", async ({ page }) => {
  await page.goto(url); await page.getByRole("button", { name: "Open record review" }).click();
  await page.getByLabel("Review reason", { exact: true }).fill("Synthetic private reason");
  expect(await page.evaluate(() => { const event = new Event("beforeunload", { cancelable: true }); dispatchEvent(event); return event.defaultPrevented; })).toBe(true);
  await page.getByRole("button", { name: "Prepare record review", exact: true }).click();
  await expect(page.getByRole("button", { name: "I have reviewed this preparation" })).toBeVisible();
  const original = await page.evaluate(pointers);
  await page.evaluate(() => (window as unknown as { syntheticReviewChangeSession(): void }).syntheticReviewChangeSession());
  await expect(page.getByText("Synthetic private reason", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText("earlier review operation needs recovery");
  expect(await page.evaluate(pointers)).toEqual(original); await expect(page.getByTestId("rpc-count")).toHaveText("1");
});
