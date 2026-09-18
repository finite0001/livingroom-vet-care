import { test, expect, type Page } from "@playwright/test";
import {
  publicationFixture,
  id,
  actor,
  client,
} from "../tests/estimates/publication-browser-fixture";
const confirmed = "The exact publication operation is confirmed in history.";
async function prepare(page: Page) {
  await page
    .getByRole("button", { name: "Prepare saved draft 1 for review" })
    .click();
  await expect(page.locator("iframe")).toBeVisible();
  await expect(
    page
      .frameLocator("iframe")
      .getByRole("heading", { name: "Housecall care proposal", exact: true }),
  ).toBeVisible();
}
async function attest(page: Page) {
  await page
    .getByRole("checkbox", { name: /I reviewed the exact document/ })
    .check();
  await page.getByRole("checkbox", { name: /I reviewed quantities/ }).check();
  await page.getByRole("checkbox", { name: /I reviewed the terms/ }).check();
}
async function publish(page: Page, replacement = false) {
  await attest(page);
  await page
    .getByRole("button", {
      name: replacement
        ? "Publish replacement document"
        : "Publish reviewed document",
      exact: true,
    })
    .click();
}
test("household entry reviews exact sandboxed artifact and requires all three attestations", async ({
  page,
}) => {
  const w = await publicationFixture(page);
  await prepare(page);
  const iframe = page.locator("iframe");
  await expect(iframe).toHaveAttribute("sandbox", "");
  await expect(iframe).toHaveAttribute("referrerpolicy", "no-referrer");
  await expect(
    page.getByRole("button", {
      name: "Publish reviewed document",
      exact: true,
    }),
  ).toBeDisabled();
  await page
    .getByRole("checkbox", { name: /I reviewed the exact document/ })
    .check();
  await page.getByRole("checkbox", { name: /I reviewed quantities/ }).check();
  await expect(
    page.getByRole("button", {
      name: "Publish reviewed document",
      exact: true,
    }),
  ).toBeDisabled();
  await page.getByRole("checkbox", { name: /I reviewed the terms/ }).check();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download exact HTML" }).click();
  const download = await downloadPromise;
  const p = [...w.preparations.values()][0];
  expect(download.suggestedFilename()).toBe(p.artifact!.filename);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  expect(Buffer.concat(chunks).toString("utf8")).toBe(w.htmls.get(p.id));
  await page
    .getByRole("button", { name: "Publish reviewed document", exact: true })
    .click();
  await expect(page.getByText(confirmed)).toBeVisible();
  expect(w.state.mutations).toHaveLength(1);
  expect(w.events[0].publication!.artifact.sha256).toBe(p.artifact!.sha256);
  await expect(
    page.getByText("Published draft 1", { exact: true }),
  ).toBeVisible();
});
test("explicit replacement and withdrawal preserve readable historical documents on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const w = await publicationFixture(page);
  await prepare(page);
  await publish(page);
  await expect(page.getByText(confirmed)).toBeVisible();
  const original = w.events[0].publication!;
  await prepare(page);
  await expect(
    page.getByText("Publishing will replace publication", { exact: false }),
  ).toBeVisible();
  await publish(page, true);
  await expect(
    page.getByText("Published draft 1 as a replacement", { exact: true }),
  ).toBeVisible();
  expect(w.events[1].publication!.replaces_publication_id).toBe(original.id);
  await page
    .getByLabel("Withdrawal reason", { exact: true })
    .fill("Client requested a different plan.");
  await page
    .getByRole("checkbox", { name: /I reviewed the current publication/ })
    .check();
  await page
    .getByRole("button", { name: "Withdraw current publication", exact: true })
    .click();
  await expect(
    page.getByText("Withdrew publication", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Client requested a different plan.", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "View stored document" })
    .last()
    .click();
  await expect(
    page
      .frameLocator("iframe")
      .getByRole("heading", { name: "Housecall care proposal", exact: true }),
  ).toBeVisible();
  await expect.poll(() => w.state.downloads.at(-1)).toBe(original.preparation_id);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
  expect(w.events).toHaveLength(3);
});
test("lost preparation capture reply reloads and recovers one retained document", async ({
  page,
}) => {
  const w = await publicationFixture(page);
  w.state.losePrepare = true;
  await page
    .getByRole("button", { name: "Prepare saved draft 1 for review" })
    .click();
  await expect(
    page.getByRole("button", { name: "Recover prepared document" }),
  ).toBeEnabled();
  expect(w.state.prepares).toHaveLength(1);
  await w.mount();
  await page.getByRole("button", { name: "Recover prepared document" }).click();
  await expect(page.locator("iframe")).toBeVisible();
  await publish(page);
  await expect(page.getByText(confirmed)).toBeVisible();
  expect(w.state.prepares).toHaveLength(1);
  expect(w.preparations.size).toBe(1);
  expect(w.events).toHaveLength(1);
});
test("lost publication reply reloads and recovers original operation without duplicate publication", async ({
  page,
}) => {
  const w = await publicationFixture(page);
  await prepare(page);
  w.state.loseMutation = true;
  await publish(page);
  await expect(
    page.getByRole("button", { name: "Recover original request" }),
  ).toBeEnabled();
  const original = w.state.mutations[0];
  await w.mount();
  await page.getByRole("button", { name: "Recover original request" }).click();
  await expect(page.getByText(confirmed)).toBeVisible();
  expect(w.state.mutations).toEqual([original]);
  expect(w.events).toHaveLength(1);
});
test("lost terminal closure reply retains same original identity across reload", async ({
  page,
}) => {
  const w = await publicationFixture(page);
  await prepare(page);
  w.state.neverMutation = true;
  await publish(page);
  await expect(
    page.getByRole("button", { name: "Resolve or close original request" }),
  ).toBeEnabled();
  w.state.loseClose = true;
  await page
    .getByRole("button", { name: "Resolve or close original request" })
    .click();
  await expect(
    page.getByRole("button", { name: "Resolve or close original request" }),
  ).toBeEnabled();
  await w.mount();
  w.state.loseClose = false;
  await page
    .getByRole("button", { name: "Resolve or close original request" })
    .click();
  await expect(
    page.getByText(
      "The original request is permanently closed without recording an operation.",
      { exact: false },
    ),
  ).toBeVisible();
  expect(w.state.closes).toHaveLength(2);
  expect(w.state.closes[0]).toEqual(w.state.closes[1]);
  expect(w.state.closes[0]).toEqual(w.state.mutations[0]);
  expect(w.events).toHaveLength(0);
});
test("late publication response cannot confirm or clear another household workspace", async ({
  page,
}) => {
  const w = await publicationFixture(page);
  await prepare(page);
  w.state.holdMutation = true;
  await publish(page);
  await expect.poll(() => w.state.mutations.length).toBe(1);
  const original = w.state.mutations[0];
  await w.switchHousehold(id(22));
  await expect(
    page.getByRole("button", {
      name: "Other household proposal · revision 1 · $12.50",
    }),
  ).toBeVisible();
  w.state.releaseMutation();
  await expect(page.getByText(confirmed)).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Estimate publication", exact: true }),
  ).toHaveCount(0);
  const retained = await page.evaluate(
    (opId) =>
      Object.values(sessionStorage).some((value) => value.includes(opId)),
    original.id,
  );
  expect(retained).toBe(true);
  expect(w.state.mutations).toHaveLength(1);
});
test("actor change retains the original actor request despite a late successful response", async ({
  page,
}) => {
  const w = await publicationFixture(page);
  await prepare(page);
  w.state.holdMutation = true;
  await publish(page);
  await expect.poll(() => w.state.mutations.length).toBe(1);
  const original = w.state.mutations[0];
  await w.switchActor(id(99));
  await expect
    .poll(async () =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem("sb-127-auth-token")!).user.id,
      ),
    )
    .toBe(id(99));
  w.state.releaseMutation();
  await expect(page.getByText(confirmed)).toHaveCount(0);
  const retained = await page.evaluate(
    ({ opId, actor }) =>
      Object.entries(sessionStorage).some(
        ([key, value]) => key.includes(actor) && value.includes(opId),
      ),
    { opId: original.id, actor },
  );
  expect(retained).toBe(true);
  expect(w.events[0].actor_id).toBe(actor);
  expect(w.state.mutations).toHaveLength(1);
});
