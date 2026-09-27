import { defineConfig, devices } from "@playwright/test";

const noTurnstile = /public-intake-no-turnstile\.spec\.ts/;
const backend = {
  VITE_CONTACT_INTAKE_URL: "http://127.0.0.1:54321/functions/v1/public-contact",
  VITE_SUPABASE_URL: "http://127.0.0.1:54321",
  VITE_SUPABASE_PUBLISHABLE_KEY: "foundation-browser-tests-placeholder",
};

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:8080",
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
      use: { ...devices["Desktop Chrome"], baseURL: "http://127.0.0.1:8081" },
    },
  ],
  webServer: [
    {
      command: "npm run dev -- --host 127.0.0.1 --port 8080 --strictPort",
      url: "http://127.0.0.1:8080",
      reuseExistingServer: false,
      env: { ...backend, VITE_CONTACT_TURNSTILE_SITE_KEY: "synthetic-site-key" },
    },
    {
      command: "npm run dev -- --host 127.0.0.1 --port 8081 --strictPort",
      url: "http://127.0.0.1:8081",
      reuseExistingServer: false,
      env: { ...backend, VITE_CONTACT_TURNSTILE_SITE_KEY: "" },
    },
  ],
});
