import { expect, test, type Page } from "@playwright/test";
const fixture = "/tests/controlled-drugs/administration-fixture.html";
async function fillSite(page: Page) {
  await page.getByLabel("What needs to change?", { exact: true }).selectOption("site_register");
  await page.getByRole("button", { name: "Read current records and open form", exact: true }).click();
  await expect(page.getByLabel("Site name", { exact: true })).toHaveValue("");
  await page.getByLabel("Site name", { exact: true }).fill("Synthetic clinic");
  await page.getByLabel("Registration reference", { exact: true }).fill("Synthetic registration review");
  await page.getByRole("button", { name: "Add location", exact: true }).click();
  await page.getByLabel("Location name", { exact: true }).fill("Synthetic safe");
  await page.getByLabel("Location type", { exact: true }).selectOption("clinic");
}
async function prepare(page: Page) {
  await page.getByRole("button", { name: "Prepare site for review", exact: true }).click();
  await expect(page.getByRole("region", { name: "Prepared administrator change", exact: true })).toBeVisible();
}
async function save(page: Page) {
  await expect(page.getByRole("button", { name: "Continue to save", exact: true })).toBeDisabled();
  await page.getByLabel("I reviewed the complete prepared change", { exact: false }).check();
  await page.getByRole("button", { name: "Continue to save", exact: true }).click();
  await expect(page.getByLabel("Synthetic executions", { exact: true })).toHaveText("0");
  await page.getByRole("button", { name: "Save reviewed change", exact: true }).click();
}
test("site setup starts blank and saves only after complete review and a separate confirmation", async ({ page }) => {
  await page.goto(fixture); await fillSite(page); await prepare(page);
  await expect(page.getByRole("region", { name: "Prepared administrator change" })).toContainText("Synthetic clinic");
  await expect(page.getByLabel("Synthetic preparations")).toHaveText("1");
  await save(page); await expect(page.getByRole("region", { name: "Saved administrator receipt", exact: true })).toBeVisible();
  await expect(page.getByLabel("Synthetic executions")).toHaveText("1");
  await expect(page.getByRole("region", { name: "Administrator operation recovery", exact: true })).toHaveCount(0);
});
test("a saved change with a lost response is recovered without a second execution", async ({ page }) => {
  await page.goto(`${fixture}?lost-save`); await fillSite(page); await prepare(page); await save(page);
  await expect(page.getByRole("region", { name: "Administrator operation recovery", exact: true })).toBeVisible();
  await expect(page.getByLabel("Synthetic executions")).toHaveText("1");
  await expect(page.getByRole("button", { name: "Save reviewed change", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Read original result", exact: true }).click();
  await expect(page.getByRole("region", { name: "Saved administrator receipt", exact: true })).toBeVisible();
  await expect(page.getByLabel("Synthetic executions")).toHaveText("1");
  await expect(page.getByLabel("Synthetic reads")).toHaveText("1");
});
test("unsaved setup has a leave guard and the complete review fits phone and desktop", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 812 }); await page.goto(fixture); await fillSite(page);
  await page.getByRole("link", { name: "Leave setup", exact: true }).click(); await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.getByRole("button", { name: "Keep editing", exact: true }).click(); await expect(page.getByLabel("Site name")).toHaveValue("Synthetic clinic");
  await prepare(page);
  for (const width of [375, 1280]) { await page.setViewportSize({ width, height: 900 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.screenshot({ path: testInfo.outputPath(`administration-${width}.png`), fullPage: true }); }
});
test("a different tab holding the administrator lock preserves the unsent draft for explicit submission", async ({ page }) => {
  await page.goto(fixture); await fillSite(page);
  const key = "lrv:controlled-stock-administration:v1:00000000-0000-4000-8000-000000000001";
  await page.evaluate(async name => { await new Promise<void>(acquired => { void navigator.locks.request(name, { mode: "exclusive" }, async () => { await new Promise<void>(release => { Reflect.set(window, "__releaseSyntheticAdministrationLock", release); acquired(); }); }); }); }, key);
  await page.getByRole("button", { name: "Prepare site for review", exact: true }).click();
  await expect(page.getByText("The preparation was not sent. Your entries are preserved.", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Synthetic preparations")).toHaveText("0");
  await page.evaluate(async name => { const release: unknown = Reflect.get(window, "__releaseSyntheticAdministrationLock"); if (typeof release !== "function") throw new Error("Synthetic administrator lock missing"); release(); Reflect.deleteProperty(window, "__releaseSyntheticAdministrationLock"); await navigator.locks.request(name, { mode: "exclusive" }, () => {}); }, key);
  await expect(page.getByLabel("Site name", { exact: true })).toHaveValue("Synthetic clinic");
  await prepare(page); await expect(page.getByLabel("Synthetic preparations")).toHaveText("1");
});
test("opening stock requires independent observations and all twenty-two permission choices before reviewed activation", async ({ page }) => {
  await page.goto(`${fixture}?opening`);
  await page.getByLabel("What needs to change?", { exact: true }).selectOption("stock_opening");
  await page.getByLabel("Medication", { exact: true }).selectOption({ label: "Synthetic controlled medication · mL" });
  await page.getByLabel("Registered site", { exact: true }).selectOption({ label: "Synthetic existing site" });
  await page.getByRole("button", { name: "Read current records and open form", exact: true }).click();
  await expect(page.getByLabel("Observed quantity (mL)", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("When did you observe this position?", { exact: true })).toHaveValue("");
  await page.getByRole("checkbox", { name: "Synthetic existing site", exact: true }).check();
  await page.getByLabel("Permit clinic-retained returns?", { exact: true }).selectOption("no");
  const rules = page.locator("details"); await expect(rules).toHaveCount(22);
  for (const rule of await rules.all()) { await rule.locator("summary").click(); await rule.getByLabel("Enable this action?", { exact: true }).selectOption("no"); await rule.getByLabel("Physical witness requirement", { exact: true }).selectOption("none"); await rule.getByLabel("Require independent record review?", { exact: true }).selectOption("no"); await rule.locator("summary").click(); }
  await page.getByLabel("Policy review reference", { exact: true }).fill("Synthetic complete stock policy");
  await page.getByLabel("Container label", { exact: true }).fill("Synthetic observed vial");
  await page.getByLabel("Registered location", { exact: true }).selectOption({ label: "Synthetic existing site · Synthetic existing safe" });
  await page.getByLabel("Observed quantity (mL)", { exact: true }).fill("9");
  await page.getByLabel("When did you observe this position?", { exact: true }).fill("2026-10-26T08:00");
  await page.getByLabel("When was the complete opening finished?", { exact: true }).fill("2026-10-26T08:05");
  await page.getByLabel("Opening note and reference", { exact: true }).fill("Synthetic physical opening");
  await page.getByRole("checkbox", { name: "These are the complete positions and my actual physical observations.", exact: true }).check();
  await page.getByRole("button", { name: "Prepare opening for review", exact: true }).click();
  await expect(page.getByText(/An opening observation differs from the existing stock record/)).toBeVisible();
  await expect(page.getByLabel("Synthetic preparations")).toHaveText("0");
  await page.getByLabel("Observed quantity (mL)", { exact: true }).fill("10");
  await page.getByRole("button", { name: "Prepare opening for review", exact: true }).click();
  const review = page.getByRole("region", { name: "Prepared administrator change", exact: true });
  await expect(review).toContainText("Observed 10.000 mL"); await expect(review).toContainText("activates its controlled-stock log");
  await save(page); await expect(page.getByRole("region", { name: "Saved administrator receipt", exact: true })).toBeVisible();
  await expect(page.getByLabel("Synthetic preparations")).toHaveText("1"); await expect(page.getByLabel("Synthetic executions")).toHaveText("1");
});
for (const kind of ["administration", "eligibility", "routing"]) {
  test(`offboarded staff can be explicitly removed before disabling ${kind} configuration`, async ({ page }) => {
    await page.goto(`${fixture}?offboarding`);
    await page.getByLabel("What needs to change?", { exact: true }).selectOption(kind);
    await page.getByLabel("Medication", { exact: true }).selectOption({ label: "Synthetic controlled medication · mL" });
    if (kind === "eligibility") { await page.getByLabel("Access capability", { exact: true }).selectOption("read"); await page.getByLabel("Record kind", { exact: true }).selectOption("receive_inventory"); }
    if (kind !== "administration") await page.getByLabel("Registered site", { exact: true }).selectOption({ label: "Synthetic existing site" });
    await page.getByRole("button", { name: "Read current records and open form", exact: true }).click();
    await expect(page.getByRole("region", { name: "Unavailable retained staff assignment", exact: true })).toContainText("00000000-0000-4000-8000-000000000099");
    await page.getByLabel("Enable this configuration?", { exact: true }).selectOption("no");
    await page.getByLabel("Approval reference", { exact: true }).fill("Synthetic offboarding review");
    await page.getByRole("button", { name: "Prepare access for review", exact: true }).click();
    await expect(page.getByLabel("Synthetic preparations")).toHaveText("0");
    await page.getByRole("button", { name: "Remove unavailable member", exact: true }).click();
    await expect(page.getByRole("region", { name: "Unavailable retained staff assignment", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Prepare access for review", exact: true }).click();
    await expect(page.getByRole("region", { name: "Prepared administrator change", exact: true })).toContainText("Disabled");
    await save(page); await expect(page.getByRole("region", { name: "Saved administrator receipt", exact: true })).toBeVisible();
    await expect(page.getByLabel("Synthetic executions")).toHaveText("1");
  });
}
test("a retained role that is no longer eligible can be explicitly replaced without re-adding unavailable roles", async ({ page }) => {
  await page.goto(`${fixture}?offboarding&role`);
  await page.getByLabel("What needs to change?", { exact: true }).selectOption("administration");
  await page.getByLabel("Medication", { exact: true }).selectOption({ label: "Synthetic controlled medication · mL" });
  await page.getByRole("button", { name: "Read current records and open form", exact: true }).click();
  await page.getByRole("checkbox", { name: "Previous role: Veterinarian (no longer available)", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: "Previous role: Veterinarian (no longer available)", exact: true })).toHaveCount(0);
  await page.getByRole("checkbox", { name: "Administrator", exact: true }).check();
  await page.getByLabel("Approval reference", { exact: true }).fill("Synthetic current-role review");
  await page.getByRole("button", { name: "Prepare access for review", exact: true }).click();
  const review = page.getByRole("region", { name: "Prepared administrator change", exact: true });
  await expect(review).toContainText("Synthetic administrator · ADMIN");
  await expect(review).not.toContainText("DVM");
});
