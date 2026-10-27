import { holdCountActorLock, releaseCountActorLock } from "./helpers/controlled-count-lock";
import { expect, test, type Page } from "@playwright/test";
const fixture = "/tests/controlled-drugs/count-workspace-fixture.html";
async function open(page: Page) {
  await page.getByRole("button", { name: "Load counts", exact: true }).click();
  await page.getByRole("button", { name: "Open count", exact: true }).click();
}
async function fill(page: Page) {
  await page.getByLabel("When did you observe the stock?").fill("2026-10-26T12:30:15");
  await page.getByLabel("Was this container present?").selectOption("present");
  await page.getByLabel("Available stock · lot SYNTHETIC · quantity (mL)").fill("123.125");
  await page.getByLabel("I personally observed").check();
}
test("workspace preserves entries through parent renders and records one explicit save", async ({ page }) => {
  await page.goto(fixture); await open(page); await fill(page);
  await expect(page.getByLabel("When did you observe the stock?")).toHaveValue("2026-10-26T12:30:15");
  await expect(page.getByLabel("Was this container present?")).toHaveValue("present");
  await page.getByRole("button", { name: "Record my observation" }).click();
  await expect(page.getByLabel("Synthetic mutation calls")).toHaveText("1");
  await expect(page.getByText("Observation recorded", { exact: true })).toHaveCount(1);
  await expect(page.getByRole("region", { name: "Pending count save" })).toHaveCount(0);
});
test("an uncertain save survives reload and cannot resend until explicitly closed", async ({ page }) => {
  await page.goto(`${fixture}?unknown`); await open(page); await fill(page);
  await page.getByRole("button", { name: "Record my observation" }).click();
  await expect(page.getByRole("region", { name: "Pending count save" })).toBeVisible();
  const retained = await page.evaluate(() => Object.entries(localStorage).find(([key]) => key.startsWith("lrv:controlled-count-operation:"))?.[1]);
  expect(retained).toBeTruthy(); expect(retained).not.toContain("123.125");
  await page.reload(); await expect(page.getByRole("region", { name: "Pending count save" })).toBeVisible();
  await page.getByRole("button", { name: "Check original save" }).click();
  await expect(page.getByText("No saved receipt yet.", { exact: false })).toBeVisible();
  await expect(page.getByRole("region", { name: "Pending count save" })).toBeVisible();
  await page.getByRole("button", { name: "Close pending attempt" }).click();
  await expect(page.getByRole("region", { name: "Pending count save" })).toHaveCount(0);
  await expect(page.getByLabel("Synthetic mutation calls")).toHaveText("0");
});
test("new staff login immediately removes prior actor data and unrecorded entries", async ({ page }) => {
  await page.goto(fixture); await open(page); await fill(page);
  await page.getByRole("button", { name: "Switch synthetic staff login" }).click();
  await expect(page.getByRole("region", { name: "Recorded stock count" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Load counts", exact: true })).toBeVisible();
  await open(page); await expect(page.getByLabel("Available stock · lot SYNTHETIC · quantity (mL)")).toHaveValue("");
});
test("in-page navigation asks before discarding a count and mobile controls fit", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 }); await page.goto(fixture); await open(page); await fill(page);
  await page.getByRole("button", { name: "Back to count list" }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.getByRole("button", { name: "Keep editing" }).click();
  await expect(page.getByLabel("Available stock · lot SYNTHETIC · quantity (mL)")).toHaveValue("123.125");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test("a cancellation reason is guarded as an unsaved draft", async ({ page }) => {
  await page.goto(fixture); await open(page);
  await page.getByLabel("Reason for cancelling this count").fill("Synthetic cancellation explanation");
  await page.getByRole("button", { name: "Back to count list" }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.getByRole("button", { name: "Keep editing" }).click();
  await expect(page.getByLabel("Reason for cancelling this count")).toHaveValue("Synthetic cancellation explanation");
  await expect(page.getByRole("button", { name: "Cancel count with reason" })).toBeEnabled();
});
test("recovering another tab's pending save preserves this tab's unfinished observation", async ({ page, context }) => {
  await page.goto(fixture); await open(page); await fill(page);
  const other = await context.newPage(); await other.goto(`${fixture}?unknown`); await open(other); await fill(other);
  await other.getByRole("button", { name: "Record my observation" }).click();
  await expect(page.getByRole("region", { name: "Pending count save" })).toBeVisible();
  await expect(page.getByLabel("Available stock · lot SYNTHETIC · quantity (mL)")).toBeDisabled();
  await page.getByRole("button", { name: "Close pending attempt" }).click();
  await expect(page.getByRole("region", { name: "Pending count save" })).toHaveCount(0);
  await expect(page.getByLabel("Available stock · lot SYNTHETIC · quantity (mL)")).toHaveValue("123.125");
  await expect(page.getByLabel("Available stock · lot SYNTHETIC · quantity (mL)")).toBeEnabled();
  await other.close();
});
test("a changed boundary can close stale without inventing either missing observation", async ({ page }) => {
  await page.goto(`${fixture}?stale`); await open(page);
  await expect(page.getByLabel("I reviewed both recorded observations.")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Close stale count and repeat" })).toBeEnabled();
  await page.getByRole("button", { name: "Close stale count and repeat" }).click();
  await expect(page.getByText("Count needs to be repeated", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Synthetic mutation calls")).toHaveText("1");
  await expect(page.getByText("Observation still needed", { exact: true })).toHaveCount(2);
});
test("an observation blocked before send keeps its draft and allows a later explicit submit", async ({ page }) => {
  await page.goto(fixture); await open(page); await fill(page); await holdCountActorLock(page);
  await page.getByRole("button", { name: "Record my observation", exact: true }).click();
  await expect(page.getByText(/Your observation was not sent. Your entries are preserved/)).toBeVisible(); await expect(page.getByLabel("Synthetic mutation calls")).toHaveText("0");
  await releaseCountActorLock(page);
  await expect(page.getByLabel("Available stock · lot SYNTHETIC · quantity (mL)")).toHaveValue("123.125");
  await page.getByRole("button", { name: "Record my observation", exact: true }).click();
  await expect(page.getByLabel("Synthetic mutation calls")).toHaveText("1"); await expect(page.getByText("Observation recorded", { exact: true })).toBeVisible();
});
