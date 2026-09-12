import { test, expect, type Page } from "@playwright/test";
const backend = "http://127.0.0.1:54321";
const actor = "11111111-1111-4111-8111-111111111111";
const pet = "22222222-2222-4222-8222-222222222222";
const client = "33333333-3333-4333-8333-333333333333";
const lot = "44444444-4444-4444-8444-444444444444";
const invoice = "55555555-5555-4555-8555-555555555555";
async function fixture(page: Page) {
  const user = {
    id: actor,
    aud: "authenticated",
    role: "authenticated",
    email: "synthetic@example.test",
    app_metadata: {},
    user_metadata: {},
    created_at: "2026-01-01T00:00:00Z",
  };
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const session = {
    access_token: `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ sub: actor, exp: expires, role: "authenticated" })).toString("base64url")}.synthetic`,
    refresh_token: "synthetic",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: expires,
    user,
  };
  await page.addInitScript(
    (s) => localStorage.setItem("sb-127-auth-token", JSON.stringify(s)),
    session,
  );
  const calls: unknown[] = [];
  await page.route(`${backend}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/auth/v1/user") return route.fulfill({ json: user });
    if (path === "/auth/v1/token") return route.fulfill({ json: session });
    if (path === "/rest/v1/profiles")
      return route.fulfill({
        json: [
          {
            id: actor,
            full_name: "Synthetic Staff",
            role: "STAFF",
            is_active: true,
          },
        ],
      });
    if (path === "/rest/v1/user_roles")
      return route.fulfill({ json: [{ role: "STAFF" }] });
    if (path === "/rest/v1/pets")
      return route.fulfill({
        json: [
          {
            id: pet,
            client_id: client,
            name: "Stock Juniper",
            species: "Dog",
            allergies: "Legacy antibiotic allergy",
            version: 1,
            birth_date_precision: "unknown",
            sex: "unknown",
            neuter_status: "unknown",
          },
        ],
      });
    if (path === "/rest/v1/clients")
      return route.fulfill({
        json: { id: client, full_name: "Synthetic Family" },
      });
    if (path === "/rest/v1/patient_problems")
      return route.fulfill({
        json: [
          {
            id: "reaction",
            pet_id: pet,
            title: "Vaccine reaction",
            notes: "Monitor closely",
            importance: "high",
            status: "resolved",
          },
        ],
      });
    if (path === "/rest/v1/billing_invoices")
      return route.fulfill({
        json: [
          {
            id: invoice,
            client_id: client,
            status: "draft",
            created_at: "2026-09-12T12:00:00Z",
          },
        ],
      });
    if (path === "/rest/v1/rpc/search_inventory_products")
      return route.fulfill({ json: [] });
    if (path === "/rest/v1/rpc/inventory_lot_balances")
      return route.fulfill({
        json: [
          {
            id: lot,
            product_id: "product",
            product_name: "Rabies vaccine",
            kind: "vaccine",
            unit: "dose",
            active: true,
            lot_number: "R123",
            expires_on: "2099-12-31",
            location: "Clinic",
            balance: 9,
          },
        ],
      });
    if (
      path === "/rest/v1/rpc/record_patient_treatment" ||
      path === "/rest/v1/rpc/create_inventory_product"
    ) {
      calls.push(route.request().postDataJSON());
      if (calls.length === 1)
        return route.fulfill({
          status: 503,
          json: { message: "Outcome unavailable" },
        });
      return route.fulfill({ json: { id: "saved" } });
    }
    return route.fulfill({ json: [] });
  });
  return calls;
}
test("catalog create retains exact operation after ambiguous response", async ({
  page,
}, testInfo) => {
  const calls = await fixture(page);
  await page.goto("/hub/inventory");
  await page
    .getByLabel("Product name", { exact: true })
    .fill("Synthetic vaccine");
  await page.getByLabel("Stock unit (e.g. tablet, dose, mL)").fill("dose");
  await page.getByLabel("Price per unit (USD)").fill("35.00");
  await page
    .getByRole("button", { name: "Create product", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("Outcome unconfirmed");
  await expect(page.getByLabel("Product name", { exact: true })).toBeDisabled();
  await page
    .getByRole("button", { name: "Retry same product request" })
    .click();
  await expect.poll(() => calls.length).toBe(2);
  expect(calls[1]).toEqual(calls[0]);
  await page.screenshot({
    path: testInfo.outputPath("inventory-workflow.png"),
    fullPage: true,
  });
});
test("treatment requires historical alert review and retries same debit and charge", async ({
  page,
}, testInfo) => {
  const calls = await fixture(page);
  await page.goto(`/hub/patient/${pet}`);
  const tab = page.getByRole("tab", { name: "Treatments", exact: true });
  if (await tab.count()) await tab.click();
  await expect(
    page.getByRole("heading", { name: "Important patient alerts" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Existing allergy information" }),
  ).toBeVisible();
  await page.getByLabel("Lot to dispense").selectOption(lot);
  await page.getByLabel("Draft invoice", { exact: true }).selectOption(invoice);
  await page.getByLabel("Stock quantity", { exact: true }).fill("1");
  await page.getByLabel("Clinical dose", { exact: true }).fill("1 mL");
  await page.getByLabel("Route", { exact: true }).fill("SC");
  await page.getByLabel("Veterinarian", { exact: true }).fill("Dr Synthetic");
  await page
    .getByLabel("Administration date/time (America/Denver)")
    .fill("2026-09-12T09:00");
  await page.getByRole("button", { name: "Record treatment & charge" }).click();
  expect(calls).toHaveLength(0);
  await page
    .getByLabel(
      "I reviewed the important patient alerts before recording this treatment.",
    )
    .check();
  await page.getByRole("button", { name: "Record treatment & charge" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Outcome unconfirmed" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Retry same treatment" }).click();
  await expect.poll(() => calls.length).toBe(2);
  expect(calls[1]).toEqual(calls[0]);
  expect(
    (calls[0] as { p_request: { administered_at: string } }).p_request
      .administered_at,
  ).toBe("2026-09-12T15:00:00.000Z");
  await page.screenshot({
    path: testInfo.outputPath("inventory-workflow.png"),
    fullPage: true,
  });
});
