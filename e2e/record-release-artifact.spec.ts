import { test, expect } from "@playwright/test";
import { buildSync } from "esbuild";
import { readFile } from "node:fs/promises";
import { releaseArtifact } from "../tests/record-releases/fixture";
import type { ReleaseArtifact } from "../src/hub/features/record-releases/print";
const bundle = buildSync({
  stdin: {
    contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {RecordReleaseArtifact} from './src/hub/features/record-releases/RecordReleaseArtifact'; createRoot(document.getElementById('root')).render(React.createElement(RecordReleaseArtifact,{artifact:window.__releaseArtifact}));`,
    resolveDir: process.cwd(),
    loader: "tsx",
  },
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  jsx: "automatic",
  tsconfig: "tsconfig.json",
  define: { "process.env.NODE_ENV": '"test"' },
}).outputFiles[0].text;
test("review component exposes a sandboxed artifact and downloads actual escaped HTML", async ({
  page,
}) => {
  await page.setContent('<div id="root"></div>');
  await page.evaluate((artifact) => {
    (
      window as Window & { __releaseArtifact: ReleaseArtifact }
    ).__releaseArtifact = artifact;
  }, releaseArtifact);
  await page.addScriptTag({ content: bundle });
  const frame = page.frameLocator(
    'iframe[title="Medical-record release artifact"]',
  );
  await expect(
    frame.getByRole("heading", { name: "REVIEW DRAFT — NOT CONFIRMED" }),
  ).toBeVisible();
  await expect(page.locator("iframe")).toHaveAttribute("sandbox", "");
  await expect(
    frame.getByText("Owner reports improvement.", { exact: true }),
  ).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Save review HTML", exact: true })
    .click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.html$/);
  const path = await download.path();
  expect(path).toBeTruthy();
  const html = await readFile(path!, "utf8");
  expect(html).toContain("original-report.pdf");
  expect(html).toContain("&lt;script&gt;");
  expect(html).not.toContain("PRIVATE-STORAGE-PATH");
  expect(html).not.toContain("<img");
});
test("invalidated package artifact visibly prohibits delivery", async ({
  page,
}) => {
  const artifact = structuredClone(releaseArtifact);
  artifact.confirmed = {
    id: "release",
    created_at: "2026-09-12T20:00:00Z",
    created_by: "staff",
    eligible: false,
    events: [],
    ineligibility_reason: "Original report voided",
  };
  await page.setContent('<div id="root"></div>');
  await page.evaluate((value) => {
    (
      window as Window & { __releaseArtifact: ReleaseArtifact }
    ).__releaseArtifact = value;
  }, artifact);
  await page.addScriptTag({ content: bundle });
  const frame = page.frameLocator("iframe");
  await expect(frame.getByRole("alert")).toContainText(
    "Not eligible for delivery",
  );
  await expect(frame.getByRole("alert")).toContainText(
    "Original report voided",
  );
  await expect(
    frame.getByText("Owner reports improvement.", { exact: true }),
  ).toBeVisible();
});
