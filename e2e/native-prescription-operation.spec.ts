import { test, expect, type Page } from "@playwright/test";
async function mount(page: Page) {
  await page.route("**/prescription-hook-harness", route => route.fulfill({ contentType: "text/html", body: '<html><body><div id="root"></div></body></html>' }));
  await page.goto("/prescription-hook-harness");
  await page.evaluate(async () => {
    const refresh = (await import(/* @vite-ignore */ "/@react-refresh")).default;
    refresh.injectIntoGlobalHook(window);
    const globals = window as unknown as Record<string, unknown>;
    globals.$RefreshReg$ = () => {}; globals.$RefreshSig$ = () => (value: unknown) => value; globals.__vite_plugin_react_preamble_installed__ = true;
    const harness = await import(/* @vite-ignore */ "/tests/prescriptions/operation-hook-harness.tsx"); harness.mount(); });
}
async function start(page: Page) { await page.getByRole("button", { name: "Review", exact: true }).click(); await page.getByRole("button", { name: "Commit", exact: true }).click(); await expect(page.getByTestId("phase")).toHaveText("committing"); }
async function callCount(page: Page) { return page.evaluate(async () => (await import(/* @vite-ignore */ "/tests/prescriptions/operation-hook-harness.tsx")).evidence.calls.length); }
for (const target of ["actor", "patient"]) test(`pending old ${target} request cannot block or unlock new context`, async ({ page }) => {
  await mount(page); await start(page);
  await page.getByRole("button", { name: `Switch ${target}` }).click();
  await expect(page.getByTestId("phase")).toHaveText("editing");
  await start(page); expect(await callCount(page)).toBe(2);
  await page.evaluate(async () => (await import(/* @vite-ignore */ "/tests/prescriptions/operation-hook-harness.tsx")).evidence.calls[0].resolve("old-receipt"));
  await expect(page.getByTestId("phase")).toHaveText("committing");
  await page.getByRole("button", { name: "Commit", exact: true }).click();
  expect(await callCount(page)).toBe(2);
  await page.evaluate(async () => (await import(/* @vite-ignore */ "/tests/prescriptions/operation-hook-harness.tsx")).evidence.calls[1].resolve("new-receipt"));
  await expect(page.getByTestId("phase")).toHaveText("confirmed");
  expect(await page.evaluate(async () => (await import(/* @vite-ignore */ "/tests/prescriptions/operation-hook-harness.tsx")).evidence.confirmed)).toEqual(["new-receipt"]);
});
test("actor A-B-A does not accept first A's late failure or expose old private error", async ({ page }) => {
  await mount(page); await start(page);
  await page.evaluate(async () => (await import(/* @vite-ignore */ "/tests/prescriptions/operation-hook-harness.tsx")).evidence.calls[0].reject(new Error("lost")));
  await expect(page.getByTestId("phase")).toHaveText("uncertain");
  await page.getByRole("button", { name: "Recover", exact: true }).click();
  await expect(page.getByTestId("phase")).toHaveText("recovering");
  await page.getByRole("button", { name: "Switch actor" }).click();
  await page.getByRole("button", { name: "Switch actor" }).click();
  await expect(page.getByTestId("phase")).toHaveText("editing");
  await expect(page.getByTestId("error")).toHaveText("");
  await start(page); expect(await callCount(page)).toBe(3);
  await page.evaluate(async () => (await import(/* @vite-ignore */ "/tests/prescriptions/operation-hook-harness.tsx")).evidence.calls[1].reject(new Error("old recovery")));
  await expect(page.getByTestId("phase")).toHaveText("committing");
  await expect(page.getByTestId("error")).toHaveText("");
  await page.getByRole("button", { name: "Commit", exact: true }).click();
  expect(await callCount(page)).toBe(3);
  const renders = await page.evaluate(async () => (await import(/* @vite-ignore */ "/tests/prescriptions/operation-hook-harness.tsx")).evidence.renders);
  expect(renders.every(row => row.actor === row.stateActor && row.patientId === row.statePatient)).toBe(true);
  expect(renders.filter(row => row.actor === "actor-b").every(row => row.operation === null && row.error === "" && row.notice === "")).toBe(true);
});
