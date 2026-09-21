import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

const backend = "http://127.0.0.1:54321";
const user = { id: "11111111-1111-4111-8111-111111111111", aud: "authenticated", role: "authenticated", email: "synthetic-staff@example.test", app_metadata: { provider: "email", providers: ["email"] }, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" };
const household = { id: "22222222-2222-4222-8222-222222222222", full_name: "Jane Example" };
const pets = [
  { id: "33333333-3333-4333-8333-333333333333", name: "Juniper", species: "Dog", breed: "Mixed breed", sex: "female", client_id: household.id, archived_at: null, deceased_at: null, clients: household },
  { id: "33333333-3333-4333-8333-333333333334", name: "Maple", species: "Cat", breed: null, sex: "male", client_id: household.id, archived_at: "2026-01-02T00:00:00Z", deceased_at: null, clients: household },
];

async function mockBackend(page: Page) {
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const payload = Buffer.from(JSON.stringify({ sub: user.id, exp: expires, role: "authenticated", aud: "authenticated" })).toString("base64url");
  const session = { access_token: `eyJhbGciOiJIUzI1NiJ9.${payload}.synthetic-signature`, refresh_token: "synthetic-refresh", token_type: "bearer", expires_in: 3600, expires_at: expires, user };
  await page.addInitScript(value => localStorage.setItem("sb-127-auth-token", JSON.stringify(value)), session);
  await page.route("**/*", route => new URL(route.request().url()).origin === "http://127.0.0.1:8080" ? route.continue() : route.abort());
  await page.route(`${backend}/**`, async route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/auth/v1/token") return route.fulfill({ json: session });
    if (url.pathname === "/auth/v1/user") return route.fulfill({ json: user });
    if (url.pathname === "/rest/v1/profiles") return route.fulfill({ json: [{ id: user.id, first_name: "Synthetic", last_name: "Staff", full_name: "Synthetic Staff", role: "STAFF", is_active: true }] });
    if (url.pathname === "/rest/v1/user_roles") return route.fulfill({ json: [{ role: "STAFF" }] });
    if (url.pathname === "/rest/v1/pets") {
      let rows = pets;
      const name = url.searchParams.get("name");
      if (name?.startsWith("ilike.")) {
        const needle = name.slice("ilike.".length).replace(/%/g, "");
        rows = rows.filter((p) => p.name.toLowerCase().includes(needle.toLowerCase()));
      }
      const species = url.searchParams.get("species");
      if (species?.startsWith("eq.")) {
        const value = species.slice("eq.".length);
        rows = rows.filter((p) => p.species === value);
      }
      const archivedAt = url.searchParams.get("archived_at");
      const deceasedAt = url.searchParams.get("deceased_at");
      const orFilter = url.searchParams.get("or");
      if (orFilter?.includes("not.is.null")) {
        rows = rows.filter((p) => p.archived_at !== null || p.deceased_at !== null);
      } else if (archivedAt === "is.null" && deceasedAt === "is.null") {
        rows = rows.filter((p) => p.archived_at === null && p.deceased_at === null);
      }
      return route.fulfill({ json: rows });
    }
    return route.fulfill({ json: [] });
  });
}

test("patients list shows all patients and links to a record", async ({ page }) => {
  await mockBackend(page);
  await page.goto("/hub/patients");
  await expect(page.getByRole("heading", { name: "Patients", exact: true })).toBeVisible();
  await expect(page.getByText("Juniper", { exact: true })).toBeVisible();
  await expect(page.getByText("Maple", { exact: true })).toBeVisible();
  await page.getByText("Juniper", { exact: true }).click();
  await expect(page).toHaveURL(/\/hub\/patient\/33333333-3333-4333-8333-333333333333$/);
});

test("patients list filters by species and status", async ({ page }) => {
  await mockBackend(page);
  await page.goto("/hub/patients");
  await page.getByLabel("Species filter").selectOption("Cat");
  await expect(page.getByText("Maple", { exact: true })).toBeVisible();
  await expect(page.getByText("Juniper", { exact: true })).toHaveCount(0);
  await page.getByLabel("Species filter").selectOption("");
  await page.getByLabel("Patient status filter").selectOption("active");
  await expect(page.getByText("Juniper", { exact: true })).toBeVisible();
  await expect(page.getByText("Maple", { exact: true })).toHaveCount(0);
});
