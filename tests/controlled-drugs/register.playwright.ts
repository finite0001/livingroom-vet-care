import { defineConfig, devices } from "@playwright/test";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

export default defineConfig({
  testDir: "../../e2e", testMatch: "controlled-register.spec.ts", fullyParallel: false, retries: 0, reporter: "list",
  use: { ...devices["Desktop Chrome"], baseURL: "http://127.0.0.1:47694", screenshot: "only-on-failure", trace: "retain-on-failure" },
  webServer: { command: "node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 47694 --strictPort", url: "http://127.0.0.1:47694/tests/controlled-drugs/register-fixture.html", reuseExistingServer: false,
    cwd: fileURLToPath(new URL("../../", import.meta.url)), env: { PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ""}` } },
});
