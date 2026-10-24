import { test, expect } from "@playwright/test";

test("record review queue presents independent states and bounded empty-page continuation", async ({ page, baseURL }, testInfo) => {
  const errors: string[] = [], external: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.origin === baseURL) return route.continue();
    external.push(url.origin); return route.abort();
  });
  await page.goto("/tests/controlled-drugs/record-review-fixture.html");
  await expect(page.getByText(/More events remain to examine/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue to next page" })).toBeVisible();
  await page.getByRole("button", { name: "Continue to next page" }).click();
  await expect(page.getByText("Rejected", { exact: true })).toBeVisible();
  await expect(page.getByText("Completion timing unavailable", { exact: true })).toBeVisible();
  await expect(page.getByText("No historical policy at the event time", { exact: true })).toBeVisible();
  await expect(page.getByText("Record 9007199254740994", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Continue/ })).toHaveCount(0);
  for (const width of [375, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    for (const button of await page.getByRole("button").all()) expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: testInfo.outputPath(`queue-${width}.png`), fullPage: true });
  }
  await page.getByRole("button", { name: "Open record 9007199254740994" }).focus();
  await page.keyboard.press("Enter"); await expect(page.getByRole("status")).toHaveText("Synthetic record opened");
  await page.getByRole("button", { name: "Refresh from first page" }).click();
  await expect(page.getByRole("button", { name: "Continue to next page" })).toBeVisible();
  expect(errors).toEqual([]);
  // The fixture imports no backend client. Font requests, if any, are blocked.
  expect(external.filter(origin => !origin.includes("fonts."))).toEqual([]);
});

test("real browser Web Locks reserve one recovery pointer across two tabs", async ({ context, baseURL }) => {
  const first = await context.newPage(), second = await context.newPage();
  await context.route("**/*", route => new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort());
  await Promise.all([first.goto("/tests/controlled-drugs/record-review-fixture.html"), second.goto("/tests/controlled-drugs/record-review-fixture.html")]);
  const reserve = (page: typeof first, operation: string) => page.evaluate(async operationId => {
    // Vite serves this exact source module; no mocked browser locking/storage API.
    const source = "/src/hub/features/controlled-drugs/record-review/recovery-pointer.ts";
    const { browserReviewPointerStore } = await import(/* @vite-ignore */ source);
    return browserReviewPointerStore().reserve({ version: 3, actor_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", operation_id: operationId, transport_digest: "a".repeat(64) });
  }, operation);
  const result = await Promise.all([reserve(first, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"), reserve(second, "cccccccc-cccc-4ccc-8ccc-cccccccccccc")] );
  expect(result.filter(item => item.reserved)).toHaveLength(1);
  expect(result[0].pointer).toEqual(result[1].pointer);
  await second.reload();
  expect(await second.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith("lrv:record-review:v3:")))).toHaveLength(1);
});
