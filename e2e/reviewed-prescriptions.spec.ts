import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
const receipt = JSON.parse(
  readFileSync(
    new URL(
      "../tests/prescription-review/receipt.fixture.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
async function fixture(
  page: Page,
  options: {
    fail?: boolean;
    wrongPatient?: boolean;
    pagination?: boolean;
  } = {},
) {
  const actor = receipt.approved_by,
    pet = receipt.pet_id;
  const user = {
    id: actor,
    aud: "authenticated",
    role: "authenticated",
    email: "synthetic@example.test",
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {},
    created_at: receipt.approved_at,
  };
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const session = {
    access_token: `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ sub: actor, exp, role: "authenticated", aud: "authenticated" })).toString("base64url")}.synthetic`,
    refresh_token: "synthetic",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: exp,
    user,
  };
  await page.addInitScript(
    (s) => localStorage.setItem("sb-127-auth-token", JSON.stringify(s)),
    session,
  );
  const state = {
    fail: !!options.fail,
    calls: [] as Record<string, unknown>[],
  };
  const patient = {
    id: pet,
    client_id: receipt.client_id,
    name: "Synthetic Juniper",
    species: "Dog",
    breed: null,
    dob: null,
    birth_date_precision: "unknown",
    color: null,
    microchip_id: null,
    sex: "unknown",
    neuter_status: "unknown",
    archived_at: null,
    deceased_at: null,
    weight_lbs: null,
    allergies: null,
    version: 1,
  };
  await page.route("**/*", (r) =>
    new URL(r.request().url()).origin === "http://127.0.0.1:8080"
      ? r.continue()
      : r.abort(),
  );
  await page.route("http://127.0.0.1:54321/**", async (r) => {
    const path = new URL(r.request().url()).pathname;
    if (path === "/auth/v1/token") return r.fulfill({ json: session });
    if (path === "/auth/v1/user") return r.fulfill({ json: user });
    if (path === "/rest/v1/profiles")
      return r.fulfill({
        json: [
          {
            id: actor,
            full_name: "Synthetic staff",
            first_name: "Synthetic",
            last_name: "Staff",
            is_active: true,
            role: "TECH",
          },
        ],
      });
    if (path === "/rest/v1/user_roles")
      return r.fulfill({ json: [{ role: "TECH" }] });
    if (path === "/rest/v1/pets")
      return r.fulfill({
        json: r.request().headers().accept?.includes("vnd.pgrst.object")
          ? patient
          : [patient],
      });
    if (path === "/rest/v1/clients")
      return r.fulfill({
        json: {
          id: receipt.client_id,
          full_name: "Synthetic Family",
          housecall_address: null,
        },
      });
    if (path.endsWith("list_patient_imported_prescriptions")) {
      const body = r.request().postDataJSON();
      state.calls.push(body);
      if (state.fail)
        return r.fulfill({
          status: 503,
          json: { message: "Synthetic unavailable" },
        });
      const row = structuredClone(receipt);
      row.current.is_current = false;
      if (options.wrongPatient) row.pet_id = receipt.client_id;
      return r.fulfill({
        json: {
          prescriptions: body.p_before_at ? [] : [row],
          has_more: !!options.pagination && !body.p_before_at,
          next_cursor:
            options.pagination && !body.p_before_at
              ? { before_at: row.approved_at, before_id: row.id }
              : null,
        },
      });
    }
    if (path.endsWith("list_patient_imported_vaccinations"))
      return r.fulfill({
        json: { vaccinations: [], has_more: false, next_cursor: null },
      });
    return r.fulfill({ json: [] });
  });
  await page.goto(`/hub/patient/${pet}`);
  await expect(
    page.getByRole("heading", {
      name: "Outside prescription history",
      exact: true,
    }),
  ).toBeVisible();
  return state;
}
test("staff reads attributed partial outside history and escaped original values", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fixture(page);
  const panel = page.getByRole("region", {
    name: "Outside prescription history",
  });
  await expect(panel.getByRole("article")).toBeVisible();
  await expect(
    panel.getByText("<script>outside prose</script>", { exact: true }).first(),
  ).toBeVisible();
  await expect(panel.locator("script")).toHaveCount(0);
  await expect(panel.getByText(/Partial historical account:/)).toBeVisible();
  await expect(
    panel.getByText(/Source or patient context has changed/),
  ).toBeVisible();
  await panel
    .getByText("Unresolved source item accounting", { exact: true })
    .click();
  await expect(
    panel.getByText("Malformed references", { exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByRole("button", { name: /approve|dispense|refill/i }),
  ).toHaveCount(0);
  expect(
    await panel.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
  ).toBe(true);
});
test("chart pagination preserves patient and exposes empty page with return control", async ({
  page,
}) => {
  const state = await fixture(page, { pagination: true });
  await page
    .getByRole("button", { name: "Older outside prescriptions", exact: true })
    .click();
  await expect(
    page.getByText("No reviewed outside prescriptions on this page."),
  ).toBeVisible();
  expect(state.calls.at(-1)?.p_pet_id).toBe(receipt.pet_id);
  expect(state.calls.at(-1)?.p_before_id).toBe(receipt.id);
  await page
    .getByRole("button", { name: "Newest outside prescriptions", exact: true })
    .click();
  await expect(
    page.getByRole("article", { name: /Outside prescription/ }),
  ).toBeVisible();
});
test("wrong-patient response never renders medical source evidence", async ({
  page,
}) => {
  await fixture(page, { wrongPatient: true });
  const panel = page.getByRole("region", {
    name: "Outside prescription history",
  });
  await expect(panel.getByRole("alert")).toBeVisible();
  await expect(panel.getByRole("article")).toHaveCount(0);
});
test("failed history request offers a working retry", async ({ page }) => {
  const state = await fixture(page, { fail: true });
  const panel = page.getByRole("region", {
    name: "Outside prescription history",
  });
  await expect(panel.getByRole("alert")).toBeVisible();
  state.fail = false;
  await panel
    .getByRole("button", { name: "Refresh outside prescriptions", exact: true })
    .click();
  await expect(panel.getByRole("article")).toBeVisible();
});
