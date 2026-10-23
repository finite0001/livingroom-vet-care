import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

// Own port and server: never borrow another worktree's app or Auth state.
export default defineConfig({
  testDir: "../../e2e", testMatch: /controlled-record-review\.spec\.ts/,
  fullyParallel: false, retries: 0, reporter: "list",
  use: { ...devices["Desktop Chrome"], baseURL: "http://127.0.0.1:47684", screenshot: "only-on-failure", trace: "retain-on-failure" },
  webServer: {
    command: "node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 47684 --strictPort",
    url: "http://127.0.0.1:47684/tests/controlled-drugs/record-review-fixture.html",
    reuseExistingServer: false,
    cwd: fileURLToPath(new URL("../../", import.meta.url)),
    env: { PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ""}` },
  },
});
