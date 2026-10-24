import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
export default defineConfig({
  testDir: "../../e2e", testMatch: /controlled-record-review-(?:workflow|dialog)\.spec\.ts/, fullyParallel: false, retries: 0, reporter: "list",
  use: { ...devices["Desktop Chrome"], baseURL: "http://127.0.0.1:47685", screenshot: "only-on-failure", trace: "retain-on-failure" },
  webServer: { command: "node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 47685 --strictPort",
    url: "http://127.0.0.1:47685/tests/controlled-drugs/record-review-workflow-fixture.html", reuseExistingServer: false,
    cwd: fileURLToPath(new URL("../../", import.meta.url)), env: { PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ""}` } },
});
