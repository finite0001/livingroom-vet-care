import { test, expect, type Page } from "@playwright/test";
const petId = "22222222-2222-4222-8222-222222222222",
  staffId = "11111111-1111-4111-8111-111111111111";
function denverToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Denver",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
function shift(date: string, days: number) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}
async function fixture(page: Page, dueSoonSetting: string | null) {
  const today = denverToday();
  const user = {
    id: staffId,
    aud: "authenticated",
    role: "authenticated",
    email: "vaccine-status@example.test",
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {},
    created_at: "2026-01-01T00:00:00Z",
  };
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const token = Buffer.from(
    JSON.stringify({ sub: staffId, exp, role: "authenticated", aud: "authenticated" }),
  ).toString("base64url");
  const session = {
    access_token: `eyJhbGciOiJIUzI1NiJ9.${token}.synthetic`,
    refresh_token: "synthetic",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: exp,
    user,
  };
  await page.addInitScript(
    (value) => localStorage.setItem("sb-127-auth-token", JSON.stringify(value)),
    session,
  );
  const base = {
    group_source: "due_template",
    last_given_source: "practice_administration",
    last_record_id: "44444444-4444-4444-8444-444444444444",
    last_product_name: "Synthetic product",
    record_count: 1,
    plan: null,
    flags: [],
  };
  const summary = {
    pet_id: petId,
    as_of: today,
    groups: [
      { ...base, group_key: "a", group_name: "Current group", last_given_on: shift(today, -10), due_on: shift(today, 300), due_source: "reviewed_due_plan" },
      { ...base, group_key: "b", group_name: "Overdue group", last_given_on: shift(today, -400), due_on: shift(today, -2), due_source: "outside_record", last_given_source: "outside_record" },
      { ...base, group_key: "c", group_name: "Soon group", last_given_on: shift(today, -340), due_on: shift(today, 20), due_source: "practice_administration", flags: ["plan_awaiting_review"] },
      { ...base, group_key: "d", group_name: "Undated group", last_given_on: shift(today, -30), due_on: null, due_source: null },
    ],
  };
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin ===
    new URL(test.info().project.use.baseURL as string).origin
      ? route.continue()
      : route.abort(),
  );
  await page.route("http://127.0.0.1:54321/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/auth/v1/token") return route.fulfill({ json: session });
    if (path === "/auth/v1/user") return route.fulfill({ json: user });
    if (path === "/rest/v1/profiles")
      return route.fulfill({
        json: [{ ...user, full_name: "Staff Test", first_name: "Staff", last_name: "Test", role: "STAFF", is_active: true }],
      });
    if (path === "/rest/v1/user_roles")
      return route.fulfill({ json: [{ role: "STAFF" }] });
    if (path === "/rest/v1/pets")
      return route.fulfill({
        json: [{ id: petId, client_id: "33333333-3333-4333-8333-333333333333", name: "Status dog", species: "Dog", dob: "2020-01-01", birth_date_precision: "exact", breed: "Mixed", color: "Brown", sex: "female", neuter_status: "neutered", version: 1 }],
      });
    if (path === "/rest/v1/clients")
      return route.fulfill({ json: { id: "33333333-3333-4333-8333-333333333333", full_name: "Test family" } });
    if (path === "/rest/v1/app_settings")
      return route.fulfill({
        json: dueSoonSetting ? [{ key: "vaccine_due_soon_days", value: dueSoonSetting }] : [],
      });
    if (path === "/rest/v1/rpc/patient_vaccine_status_summary")
      return route.fulfill({ json: summary });
    return route.fulfill({ json: [] });
  });
}

test("mobile patient header lists vaccine groups most urgent first with sources", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fixture(page, null);
  await page.goto(`/hub/patient/${petId}`);
  const status = page.getByRole("region", { name: "Vaccine status" });
  await expect(status).toBeVisible();
  await expect(status.getByText(/Display default pending clinical review/)).toBeVisible();
  const rows = status.getByRole("listitem");
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0)).toContainText("Overdue group");
  await expect(rows.nth(0)).toContainText("Overdue");
  await expect(rows.nth(0)).toContainText("2 days overdue");
  await expect(rows.nth(0)).toContainText("Reviewed outside record (ezyVet)");
  await expect(rows.nth(1)).toContainText("Soon group");
  await expect(rows.nth(1)).toContainText("Due soon");
  await expect(rows.nth(1)).toContainText("Due plan awaiting review");
  await expect(rows.nth(2)).toContainText("Undated group");
  await expect(rows.nth(2)).toContainText("No due date");
  await expect(rows.nth(3)).toContainText("Current group");
  await expect(rows.nth(3)).toContainText("Source: Reviewed due plan");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
});

test("practice due-soon window changes only the display state", async ({ page }) => {
  await fixture(page, "10");
  await page.goto(`/hub/patient/${petId}`);
  const status = page.getByRole("region", { name: "Vaccine status" });
  await expect(status.getByText(/within 10 days \(practice setting\)/)).toBeVisible();
  const soon = status.getByRole("listitem").filter({ hasText: "Soon group" });
  await expect(soon).toContainText("Current");
  await expect(soon).toContainText("In 20 days");
});
