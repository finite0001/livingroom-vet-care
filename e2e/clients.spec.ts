import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

const backend = "http://127.0.0.1:54321";
const user = { id: "11111111-1111-4111-8111-111111111111", aud: "authenticated", role: "authenticated", email: "synthetic-staff@example.test", app_metadata: { provider: "email", providers: ["email"] }, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" };
const initialClient = { id: "22222222-2222-4222-8222-222222222222", first_name: "Jane", last_name: "Example", full_name: "Jane Example", primary_email: "jane@example.test", primary_phone: "+13035550100", preferred_channel: "EMAIL", mailing_address: "PO Box 10", housecall_address: "10 Pine Street", version: 1, created_at: "2026-01-01T00:00:00Z", ezyvet_id: null };

interface BackendOptions { existing?: boolean; conflictOnce?: boolean; }

async function mockBackend(page: Page, options: BackendOptions = {}) {
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const payload = Buffer.from(JSON.stringify({ sub: user.id, exp: expires, role: "authenticated", aud: "authenticated" })).toString("base64url");
  const session = { access_token: `eyJhbGciOiJIUzI1NiJ9.${payload}.synthetic-signature`, refresh_token: "synthetic-refresh", token_type: "bearer", expires_in: 3600, expires_at: expires, user };
  await page.addInitScript(value => localStorage.setItem("sb-127-auth-token", JSON.stringify(value)), session);
  let client = { ...initialClient };
  let exists = !!options.existing;
  let conflict = !!options.conflictOnce;
  const saves: Record<string, unknown>[] = [];
  await page.route("**/*", route => new URL(route.request().url()).origin === "http://127.0.0.1:8080" ? route.continue() : route.abort());
  await page.route(`${backend}/**`, async route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/auth/v1/token") return route.fulfill({ json: session });
    if (url.pathname === "/auth/v1/user") return route.fulfill({ json: user });
    if (url.pathname === "/rest/v1/profiles") return route.fulfill({ json: [{ id: user.id, first_name: "Synthetic", last_name: "Staff", full_name: "Synthetic Staff", role: "STAFF", is_active: true }] });
    if (url.pathname === "/rest/v1/user_roles") return route.fulfill({ json: [{ role: "STAFF" }] });
    if (url.pathname === "/rest/v1/rpc/search_clients") return route.fulfill({ json: exists ? [client] : [] });
    if (url.pathname === "/rest/v1/clients") return route.fulfill({ json: client });
    if (url.pathname === "/rest/v1/rpc/save_client") {
      const body = route.request().postDataJSON();
      saves.push(body);
      if (conflict) {
        conflict = false;
        client = { ...client, version: 2, mailing_address: "Saved by another staff member" };
        return route.fulfill({ status: 409, json: { code: "40001", message: "Record changed or no longer exists; reload before saving" } });
      }
      client = { ...client, first_name: body.p_first_name, last_name: body.p_last_name, full_name: `${body.p_first_name} ${body.p_last_name}`, primary_phone: body.p_primary_phone, primary_email: body.p_primary_email, mailing_address: body.p_mailing_address, housecall_address: body.p_housecall_address, version: client.version + 1 };
      exists = true;
      return route.fulfill({ json: client });
    }
    return route.fulfill({ json: [] });
  });
  return { saves };
}

async function fillNewClient(page: Page) {
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByLabel("First name", { exact: false }).fill("Jane");
  await page.getByLabel("Last name", { exact: false }).fill("Example");
  await page.getByLabel("Email", { exact: true }).fill("jane@example.test");
  await page.getByLabel("Mailing address", { exact: true }).fill("PO Box 10");
  await page.getByLabel("Housecall address", { exact: true }).fill("10 Pine Street");
}

test("household creation and editing preserve separate mailing and housecall addresses", async ({ page }) => {
  const backendState = await mockBackend(page);
  await page.goto("/hub/clients");
  await fillNewClient(page);
  await page.getByRole("button", { name: "Create Client", exact: true }).click();
  await expect(page.getByRole("heading", { name: "New Client", exact: true })).toHaveCount(0);
  expect(backendState.saves).toHaveLength(1);
  expect(backendState.saves[0]).toMatchObject({ p_actor_id: user.id, p_client_id: null, p_mailing_address: "PO Box 10", p_housecall_address: "10 Pine Street" });
  await page.goto(`/hub/client/${initialClient.id}`);
  await page.getByRole("button", { name: "Edit client", exact: true }).click();
  await expect(page.getByLabel("Mailing address", { exact: true })).toHaveValue("PO Box 10");
  await page.getByLabel("Housecall address", { exact: true }).fill("12 Pine Street");
  await page.getByRole("button", { name: "Save client", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("12 Pine Street", { exact: true })).toBeVisible();
  expect(backendState.saves[1]).toMatchObject({ p_expected_version: 2, p_mailing_address: "PO Box 10", p_housecall_address: "12 Pine Street" });
});

test("duplicate warning permits review or explicit separate-household creation", async ({ page }) => {
  const backendState = await mockBackend(page, { existing: true });
  await page.goto("/hub/clients");
  await fillNewClient(page);
  await page.getByRole("button", { name: "Create Client", exact: true }).click();
  await expect(page.getByText(/Possible existing clients/)).toBeVisible();
  expect(backendState.saves).toHaveLength(0);
  await page.getByRole("link", { name: "Jane Example", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/hub/client/${initialClient.id}$`));
  expect(backendState.saves).toHaveLength(0);
  await page.goto("/hub/clients");
  await fillNewClient(page);
  await page.getByRole("button", { name: "Create Client", exact: true }).click();
  await page.getByRole("button", { name: "Create separate client", exact: true }).click();
  await expect(page.getByRole("heading", { name: "New Client", exact: true })).toHaveCount(0);
  expect(backendState.saves).toHaveLength(1);
  expect(backendState.saves[0].p_client_id).toBeNull();
});

test("concurrent client edit retains draft and reloads only on explicit request", async ({ page }) => {
  const backendState = await mockBackend(page, { existing: true, conflictOnce: true });
  await page.goto(`/hub/client/${initialClient.id}`);
  await page.getByRole("button", { name: "Edit client", exact: true }).click();
  await page.getByLabel("Mailing address", { exact: true }).fill("My unsaved change");
  await page.getByRole("button", { name: "Save client", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Record changed");
  await expect(page.getByLabel("Mailing address", { exact: true })).toHaveValue("My unsaved change");
  expect(backendState.saves[0].p_expected_version).toBe(1);
  await page.getByRole("button", { name: "Reload saved details (replace this draft)", exact: true }).click();
  await expect(page.getByLabel("Mailing address", { exact: true })).toHaveValue("Saved by another staff member");
  await page.getByLabel("Housecall address", { exact: true }).fill("Updated housecall location");
  await page.getByRole("button", { name: "Save client", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(backendState.saves[1].p_expected_version).toBe(2);
});
