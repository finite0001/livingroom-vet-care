import { test, expect } from "@playwright/test";
import type { Page, Request } from "@playwright/test";
import { createHash } from "node:crypto";

const grant = "12345678-1234-4234-8234-123456789012";
const token = "v1." + "a".repeat(43);
const endpoint = "http://127.0.0.1:54321/functions/v1/retrieve-document-link";
const report = Buffer.from('<!doctype html><h1>Reviewed practice report</h1><script>parent.document.title="unsafe"</script><img src="https://example.test/leak">');
const original = Buffer.from("%PDF-1.4\nSynthetic original lab report\n%%EOF");
const manifest = {
  grant_id: grant, expires_at: "2099-01-02T15:00:00.000Z",
  manifest: [report, original].map((bytes, index) => ({
    index, filename: index === 0 ? "report.html" : "lab.pdf",
    mime_type: index === 0 ? "text/html" : "application/pdf",
    file_size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"),
  })),
};
async function fixture(page: Page) {
  const state = { calls: [] as Request[], denied: false, corrupted: false, wrongMime: false, wrongManifest: false, requests: [] as string[], externalAttempts: [] as string[] };
  page.on("request", request => state.requests.push(request.url()));
  await page.route("**/*", route => {
    if (new URL(route.request().url()).origin === "http://127.0.0.1:8080") return route.continue();
    state.externalAttempts.push(route.request().url());
    return route.abort();
  });
  await page.route(endpoint, async route => {
    state.calls.push(route.request());
    const body = route.request().postDataJSON();
    if (state.denied) return route.fulfill({ status: 404, json: { error: "Document link unavailable" } });
    if (body.artifact_index === null) return route.fulfill({ json: { ...manifest, grant_id: state.wrongManifest ? "another-grant" : grant } });
    return route.fulfill({ contentType: state.wrongMime ? "application/octet-stream" : manifest.manifest[body.artifact_index].mime_type,
      body: state.corrupted ? Buffer.from("corrupt") : body.artifact_index === 0 ? report : original });
  });
  return state;
}

test("capability stays out of URL/storage and staff app; opening is explicit", async ({ page }) => {
  const state = await fixture(page);
  await page.goto(`/shared/${grant}#${token}`);
  await expect(page.getByRole("heading", { name: "Your documents" })).toBeVisible();
  expect(page.url()).toBe(`http://127.0.0.1:8080/shared/${grant}`);
  expect(state.calls).toHaveLength(0);
  await page.getByRole("button", { name: "Open documents", exact: true }).click();
  await expect(page.getByText("lab.pdf", { exact: true })).toBeVisible();
  expect(state.calls[0].postDataJSON()).toEqual({ grant_id: grant, token, artifact_index: null });
  expect(state.calls[0].headers().authorization).toBeUndefined();
  expect(state.calls[0].headers().referer).toBeUndefined();
  expect(await page.evaluate(() => [JSON.stringify(localStorage), JSON.stringify(sessionStorage)])).toEqual(["{}", "{}"]);
  expect(state.requests.some(url => /fonts\.google|\/auth\/|App\.tsx|AuthContext/.test(url))).toBe(false);
  expect(state.requests.some(url => url.includes(token))).toBe(false);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Open the original link from your message" })).toBeVisible();
  expect(state.calls).toHaveLength(1);
});

test("report sandbox blocks scripts and external loads; original download preserves bytes", async ({ page }) => {
  const state = await fixture(page);
  await page.goto(`/shared/${grant}#${token}`);
  await page.getByRole("button", { name: "Open documents", exact: true }).click();
  await page.getByRole("button", { name: "View report" }).click();
  await expect(page.frameLocator("iframe").getByRole("heading", { name: "Reviewed practice report" })).toBeVisible();
  expect(await page.title()).toBe("Your documents · The Living Room Vet");
  expect(await page.locator("iframe").getAttribute("sandbox")).toBe("");
  expect(state.externalAttempts.some(url => url.includes("example.test/leak"))).toBe(false);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download lab.pdf" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("lab.pdf");
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(chunk);
  expect(Buffer.concat(chunks)).toEqual(original);
  expect(state.calls.map(call => call.postDataJSON().artifact_index)).toEqual([null, 0, 1]);
  await page.getByRole("button", { name: "Close documents" }).click();
  await expect(page.getByRole("heading", { name: "Open the original link from your message" })).toBeVisible();
  await expect(page.locator("iframe")).toHaveCount(0);
  await expect(page.getByText("lab.pdf", { exact: true })).toHaveCount(0);
});

for (const failure of ["denied", "corrupted", "wrongMime"] as const) {
  test(`${failure} retrieval clears documents and never downloads`, async ({ page }) => {
    const state = await fixture(page);
    let downloads = 0;
    page.on("download", () => downloads++);
    await page.goto(`/shared/${grant}#${token}`);
    await page.getByRole("button", { name: "Open documents", exact: true }).click();
    await expect(page.getByText("lab.pdf", { exact: true })).toBeVisible();
    state[failure] = true;
    await page.getByRole("button", { name: "Download lab.pdf" }).click();
    await expect(page.getByRole("alert")).toContainText("The documents are unavailable");
    await expect(page.getByText("lab.pdf", { exact: true })).toHaveCount(0);
    expect(downloads).toBe(0);
  });
}

test("wrong grant manifest is rejected; missing token makes no request", async ({ page }) => {
  const state = await fixture(page);
  state.wrongManifest = true;
  await page.goto(`/shared/${grant}#${token}`);
  await page.getByRole("button", { name: "Open documents", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("The documents are unavailable");
  await page.goto(`/shared/${grant}`);
  await expect(page.getByRole("heading", { name: "Open the original link from your message" })).toBeVisible();
  expect(state.calls).toHaveLength(1);
});
