import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.E2E_PORT ?? 8080);
const noTurnstilePort = Number(process.env.E2E_NO_TURNSTILE_PORT ?? 8081);
for (const value of [port, noTurnstilePort]) {
  if (!Number.isInteger(value) || value < 1024 || value > 65535) throw new Error("E2E ports must be integers from 1024 to 65535");
}
if (port === noTurnstilePort) throw new Error("E2E servers require distinct ports");
const baseURL = `http://127.0.0.1:${port}`;
const noTurnstileURL = `http://127.0.0.1:${noTurnstilePort}`;
const noTurnstile = /public-intake-no-turnstile\.spec\.ts/;
const backend = {
  VITE_CONTACT_INTAKE_URL: "http://127.0.0.1:54321/functions/v1/public-contact",
  VITE_SUPABASE_URL: "http://127.0.0.1:54321",
  VITE_SUPABASE_PUBLISHABLE_KEY: "foundation-browser-tests-placeholder",
};

export default defineConfig({
  testDir: "./e2e",
  testMatch: ["**/*.@(spec|test).?(c|m)[jt]s?(x)", "**/*.playwright.ts"],
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", testIgnore: noTurnstile, use: { ...devices["Desktop Chrome"] } },
    // Public config is compiled in, so the owner-approved no-challenge contact
    // mode (intake URL without a Turnstile site key) needs its own dev server.
    {
      name: "chromium-no-turnstile",
      testMatch: noTurnstile,
      use: { ...devices["Desktop Chrome"], baseURL: noTurnstileURL },
    },
  ],
  webServer: [
    {
      command: `npm run dev -- --config vite.legacy-e2e.config.ts --host 127.0.0.1 --port ${port} --strictPort`,
      url: baseURL,
      reuseExistingServer: false,
      env: { ...backend, VITE_CONTACT_TURNSTILE_SITE_KEY: "synthetic-site-key" },
    },
    {
      command: `npm run dev -- --config vite.legacy-e2e.config.ts --host 127.0.0.1 --port ${noTurnstilePort} --strictPort`,
      url: noTurnstileURL,
      reuseExistingServer: false,
      env: { ...backend, VITE_CONTACT_TURNSTILE_SITE_KEY: "" },
    },
  ],
});
