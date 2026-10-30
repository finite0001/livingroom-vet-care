import { defineConfig, devices } from "@playwright/test";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

export default defineConfig({
  testDir: "../../e2e", testMatch: /controlled-(count-(statement|workspace|policy|correction)|record-staff|administration)\.spec\.ts|controlled-entry\.playwright\.ts/,
  fullyParallel: false, retries: 0, reporter: "list",
  use: { ...devices["Desktop Chrome"], baseURL: "http://127.0.0.1:47693", screenshot: "only-on-failure", trace: "retain-on-failure", timezoneId: "America/Los_Angeles" },
  webServer: {
    command: "node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 47693 --strictPort",
    url: "http://127.0.0.1:47693/tests/controlled-drugs/count-statement-fixture.html", reuseExistingServer: false,
    cwd: fileURLToPath(new URL("../../", import.meta.url)),
    env: { PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ""}` },
  },
});
