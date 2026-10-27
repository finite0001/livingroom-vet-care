import { expect, test } from "@playwright/test";
const route = "/tests/controlled-drugs/controlled-witness-fixture.html";
test("new login loads tasks while an old-session list is delayed and ignores its later result", async ({ page }) => {
  await page.goto(route + "?delayed"); await expect(page.locator("#calls")).toContainText("list_managed_stock_witness_tasks_v1");
  await page.getByRole("button", { name: "Renew current login", exact: true }).click();
  await expect(page.getByRole("button", { name: "Read exact prepared action", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Read exact prepared action", exact: true }).click();
  await page.getByRole("button", { name: "Release old-session task response", exact: true }).click();
  await expect(page.getByRole("region", { name: "Exact prepared action for independent witness", exact: true })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  const calls = (await page.locator("#calls").textContent())!.split("\n"); expect(calls.filter(value => value === "list_managed_stock_witness_tasks_v1")).toHaveLength(2);
  expect(calls).not.toContain("attest_managed_stock_witness_v1");
});
test("independent witness reads complete source then explicitly attests once", async ({ page }) => {
  await page.goto(route); await page.getByRole("button", { name: "Read exact prepared action", exact: true }).click();
  await expect(page.getByRole("region", { name: "Exact prepared action for independent witness", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Complete witness stock allocations", exact: true })).toContainText("Change -1 tablet");
  const save = page.getByRole("button", { name: "Attest as independent witness", exact: true }); await expect(save).toBeDisabled();
  await page.getByRole("checkbox", { name: /I independently witnessed/ }).check(); await save.click();
  await expect(page.getByText(/Witness attestation recorded at/)).toBeVisible();
  const calls = (await page.locator("#calls").textContent())!.split("\n"); expect(calls.filter(value => value === "attest_managed_stock_witness_v1")).toHaveLength(1);
  expect(calls).not.toContain("execute_managed_stock_intent_v1");
});
test("lost save keeps ID-only recovery; new login reads the original saved result without resend", async ({ page }) => {
  await page.goto(route + "?lost"); await page.getByRole("button", { name: "Read exact prepared action", exact: true }).click();
  await page.getByRole("checkbox", { name: /I independently witnessed/ }).check(); await page.getByRole("button", { name: "Attest as independent witness", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("could not be confirmed");
  const pointers = await page.evaluate(() => Object.entries(localStorage).filter(([key]) => key.startsWith("lrv:controlled-stock-witness:")).map(([, value]) => JSON.parse(value)));
  expect(pointers).toHaveLength(1); expect(Object.keys(pointers[0])).toHaveLength(7); expect(JSON.stringify(pointers)).not.toContain("preparation_digest");
  await page.getByRole("button", { name: "Renew current login", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: /I independently witnessed/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Check saved result", exact: true }).click(); await expect(page.getByText(/Your original attestation is recorded/)).toBeVisible();
  expect((await page.locator("#calls").textContent())!.split("\n").filter(value => value === "attest_managed_stock_witness_v1")).toHaveLength(1);
});
test("fresh changed source refuses save and explicit closure retains tombstone semantics", async ({ page }) => {
  await page.goto(route + "?changed"); await page.getByRole("button", { name: "Read exact prepared action", exact: true }).click();
  await page.getByRole("checkbox", { name: /I independently witnessed/ }).check(); await page.getByRole("button", { name: "Attest as independent witness", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("could not be confirmed"); await expect(page.locator("#calls")).not.toContainText("attest_managed_stock_witness_v1");
  await page.getByRole("button", { name: "Close witness attempt", exact: true }).click(); await expect(page.getByText("This witness attempt is closed without an attestation.")).toBeVisible();
});
test("phone source review remains usable and recorder account cannot inherit witness detail", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto(route);
  await page.getByRole("button", { name: "Read exact prepared action", exact: true }).click();
  await page.getByRole("button", { name: "Use recorder account", exact: true }).click();
  await expect(page.getByRole("region", { name: "Exact prepared action for independent witness", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Attest as independent witness", exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
