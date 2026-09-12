import { test, expect, type Page } from "@playwright/test";

const backend = "http://127.0.0.1:54321";
const staffId = "11111111-1111-4111-8111-111111111111";
const petId = "22222222-2222-4222-8222-222222222222";
const clientId = "33333333-3333-4333-8333-333333333333";
const user = {
  id: staffId,
  aud: "authenticated",
  role: "authenticated",
  email: "synthetic@example.test",
  app_metadata: { provider: "email", providers: ["email"] },
  user_metadata: {},
  created_at: "2026-01-01T00:00:00Z",
};
const profile = {
  id: staffId,
  first_name: "Synthetic",
  last_name: "Staff",
  full_name: "Synthetic Staff",
  role: "STAFF",
  is_active: true,
};
const patient = {
  id: petId,
  client_id: clientId,
  name: "Synthetic Juniper",
  species: "Dog",
  breed: null,
  dob: "2020-09-12",
  birth_date_precision: "exact",
  color: "Black",
  microchip_id: null,
  sex: "female",
  neuter_status: "neutered",
  archived_at: null,
  deceased_at: null,
  weight_lbs: null,
  allergies: null,
  version: 1,
};
async function fixture(page: Page, species = "Dog") {
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const payload = Buffer.from(
    JSON.stringify({
      sub: staffId,
      exp: expires,
      role: "authenticated",
      aud: "authenticated",
    }),
  ).toString("base64url");
  const session = {
    access_token: `eyJhbGciOiJIUzI1NiJ9.${payload}.synthetic`,
    refresh_token: "synthetic",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: expires,
    user,
  };
  await page.addInitScript(
    (value) => localStorage.setItem("sb-127-auth-token", JSON.stringify(value)),
    session,
  );
  const state = {
    row: null as Record<string, unknown> | null,
    revisions: [] as Record<string, unknown>[],
    addenda: [] as Record<string, unknown>[],
    failNextSave: false,
    saves: 0,
  };
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin === "http://127.0.0.1:8080"
      ? route.continue()
      : route.abort(),
  );
  await page.route(`${backend}/**`, async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path === "/auth/v1/token") return route.fulfill({ json: session });
    if (path === "/auth/v1/user") return route.fulfill({ json: user });
    if (path === "/rest/v1/profiles") return route.fulfill({ json: [profile] });
    if (path === "/rest/v1/user_roles")
      return route.fulfill({ json: [{ role: "STAFF" }] });
    if (path === "/rest/v1/pets")
      return route.fulfill({ json: [{ ...patient, species }] });
    if (path === "/rest/v1/clients")
      return route.fulfill({
        json: { id: clientId, full_name: "Synthetic Household" },
      });
    if (path === "/rest/v1/dental_charts")
      return route.fulfill({
        json: url.searchParams.has("id")
          ? state.row
          : state.row
            ? [state.row]
            : [],
      });
    if (path === "/rest/v1/dental_chart_revisions")
      return route.fulfill({ json: state.revisions });
    if (path === "/rest/v1/dental_chart_addenda")
      return route.fulfill({ json: state.addenda });
    if (path === "/rest/v1/rpc/save_dental_chart") {
      state.saves++;
      if (state.failNextSave) {
        state.failNextSave = false;
        return route.fulfill({
          status: 409,
          json: {
            code: "40001",
            message: "Dental chart changed; reload before saving",
          },
        });
      }
      const body = route.request().postDataJSON();
      expect(body.p_pet_id).toBe(petId);
      state.row = {
        id: body.p_id,
        pet_id: petId,
        species_family:
          species === "Dog" ? "dog" : species === "Cat" ? "cat" : "manual",
        dentition: body.p_dentition,
        visit_at: body.p_visit_at,
        notes: body.p_notes,
        teeth: body.p_teeth,
        status: "draft",
        version: Number(state.row?.version || 0) + 1,
        created_by: staffId,
        updated_by: staffId,
        signed_by: null,
        signed_at: null,
        created_at: "2026-09-12T16:00:00Z",
        updated_at: "2026-09-12T16:00:00Z",
      };
      state.revisions.push({
        ...state.row,
        id: crypto.randomUUID(),
        chart_id: state.row.id,
        actor_id: staffId,
      });
      return route.fulfill({ json: state.row });
    }
    if (path === "/rest/v1/rpc/sign_dental_chart") {
      const body = route.request().postDataJSON();
      expect(body.p_expected_version).toBe(state.row!.version);
      expect(body.p_pet_id).toBe(petId);
      state.row = {
        ...state.row!,
        version: Number(state.row!.version) + 1,
        status: "signed",
        signed_by: staffId,
        signed_at: "2026-09-12T17:00:00Z",
      };
      state.revisions.push({
        ...state.row,
        id: crypto.randomUUID(),
        chart_id: state.row.id,
        actor_id: staffId,
      });
      return route.fulfill({ json: state.row });
    }
    if (path === "/rest/v1/rpc/add_dental_addendum") {
      const body = route.request().postDataJSON();
      expect(body.p_pet_id).toBe(petId);
      const row = {
        id: body.p_id,
        chart_id: body.p_chart_id,
        content: body.p_content,
        created_by: staffId,
        created_at: "2026-09-12T18:00:00Z",
      };
      state.addenda.push(row);
      return route.fulfill({ json: row });
    }
    return route.fulfill({ json: [] });
  });
  return state;
}
test("dental findings reopen, retain failed draft and missing-tooth history, then sign and append correction", async ({
  page,
}, testInfo) => {
  const state = await fixture(page);
  await page.goto(`/hub/patient/${petId}`);
  await page
    .getByRole("button", { name: "New dental chart", exact: true })
    .click();
  await expect(page.getByLabel("Dentition", { exact: true })).toHaveValue("");
  await page.getByLabel("Dentition", { exact: true }).selectOption("adult");
  await expect(page.getByRole("button", { name: /^Tooth / })).toHaveCount(42);
  await page.getByLabel("Dental visit time (Denver)").fill("2026-09-12T09:00");
  await page.getByRole("button", { name: "Tooth 101", exact: true }).click();
  await expect(page.getByLabel("Recorded tooth presence")).toHaveValue(
    "not_recorded",
  );
  await page.getByLabel("Recorded tooth presence").selectOption("missing");
  await page
    .getByLabel("Tooth observations / findings")
    .fill("Not observed on initial examination");
  await page
    .getByRole("button", { name: "Save dental draft", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Dental draft saved." }),
  ).toBeVisible();
  expect(state.row!.visit_at).toBe("2026-09-12T15:00:00.000Z");
  await page.reload();
  await page.getByRole("button", { name: /^Open adult dental chart/ }).click();
  await page
    .getByRole("button", { name: "Tooth 101 · missing", exact: true })
    .click();
  await expect(page.getByLabel("Tooth observations / findings")).toHaveValue(
    "Not observed on initial examination",
  );
  await page.getByLabel("Recorded tooth presence").selectOption("extracted");
  await page
    .getByLabel("Tooth observations / findings")
    .fill("Prior extraction confirmed in history");
  state.failNextSave = true;
  await page
    .getByRole("button", { name: "Save dental draft", exact: true })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Your draft is preserved" }),
  ).toBeVisible();
  await expect(page.getByLabel("Tooth observations / findings")).toHaveValue(
    "Prior extraction confirmed in history",
  );
  await page
    .getByRole("button", { name: "Save dental draft", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Dental draft saved." }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Review and sign dental chart" })
    .click();
  await page
    .getByRole("button", { name: "Sign saved dental chart", exact: true })
    .click();
  await expect(page.getByText(/Signed by Synthetic Staff/)).toBeVisible();
  await page
    .getByRole("button", { name: "Tooth 101 · extracted", exact: true })
    .click();
  await expect(page.getByLabel("Tooth observations / findings")).toBeDisabled();
  await page
    .getByLabel("Append dental correction or additional information")
    .fill("Owner clarified timing of historical extraction.");
  await page.getByRole("button", { name: "Save dental addendum" }).click();
  await expect(
    page
      .getByRole("status")
      .filter({
        hasText: "Dental correction appended. Original chart retained.",
      }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("listitem")
      .filter({ hasText: "Owner clarified timing of historical extraction." }),
  ).toBeVisible();
  await page.getByText("Saved dental version history", { exact: true }).click();
  await expect(
    page.getByText("Tooth 101 · missing", { exact: true }),
  ).toBeVisible();
  expect(state.addenda).toHaveLength(1);
  await page.screenshot({
    path: testInfo.outputPath("signed-dental-history.png"),
    fullPage: true,
  });
});
test("feline deciduous chart has deliberate numbering gaps and no prefilled observations", async ({
  page,
}) => {
  await fixture(page, "Cat");
  await page.goto(`/hub/patient/${petId}`);
  await page
    .getByRole("button", { name: "New dental chart", exact: true })
    .click();
  await page.getByLabel("Dentition", { exact: true }).selectOption("deciduous");
  await expect(page.getByRole("button", { name: /^Tooth / })).toHaveCount(26);
  await expect(
    page.getByRole("button", { name: "Tooth 805", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Tooth 806", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Tooth 807", exact: true }).click();
  await expect(page.getByLabel("Recorded tooth presence")).toHaveValue(
    "not_recorded",
  );
});
test("unsupported species uses explicit manual dental notes", async ({
  page,
}) => {
  await fixture(page, "Rabbit");
  await page.goto(`/hub/patient/${petId}`);
  await page
    .getByRole("button", { name: "New dental chart", exact: true })
    .click();
  await expect(
    page.getByLabel("Dentition", { exact: true }).locator("option"),
  ).toHaveCount(2);
  await page.getByLabel("Dentition", { exact: true }).selectOption("manual");
  await expect(page.getByRole("button", { name: /^Tooth / })).toHaveCount(0);
  await page
    .getByLabel("Dental chart / manual notes")
    .fill(
      "Species-specific tooth identifiers and observations recorded manually.",
    );
  await page
    .getByRole("button", { name: "Save dental draft", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Dental draft saved." }),
  ).toBeVisible();
});

test("one patient navigation guard preserves multiple dirty panels and remains active after dental save", async ({
  page,
}) => {
  const warnings: string[] = [];
  page.on("console", (message) => {
    if (/blocker/i.test(message.text())) warnings.push(message.text());
  });
  await fixture(page);
  await page.goto(`/hub/patient/${petId}`);
  await page
    .getByRole("button", { name: "New dental chart", exact: true })
    .click();
  await page.getByLabel("Dentition", { exact: true }).selectOption("adult");
  await page
    .getByLabel("Dental chart / manual notes")
    .fill("Dental draft retained");
  await page
    .getByRole("button", { name: "New QOL observation", exact: true })
    .click();
  await page.getByLabel("Comfort", { exact: true }).fill("QOL draft retained");
  await page
    .getByRole("button", { name: "New encounter", exact: true })
    .click();
  await page
    .getByLabel("Subjective", { exact: true })
    .fill("SOAP draft retained");
  const household = page.getByRole("link", {
    name: "Synthetic Household",
    exact: true,
  });
  await household.click();
  await expect(page.getByRole("alertdialog")).toHaveCount(1);
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/hub/patient/${petId}$`));
  await expect(page.getByLabel("Dental chart / manual notes")).toHaveValue(
    "Dental draft retained",
  );
  await expect(page.getByLabel("Comfort", { exact: true })).toHaveValue(
    "QOL draft retained",
  );
  await expect(page.getByLabel("Subjective", { exact: true })).toHaveValue(
    "SOAP draft retained",
  );
  await page
    .getByRole("button", { name: "Save dental draft", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Dental draft saved." }),
  ).toBeVisible();
  await household.click();
  await expect(page.getByRole("alertdialog")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Discard and leave", exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`/hub/client/${clientId}$`));
  expect(warnings).toEqual([]);
});

for (const panel of ["dental", "QOL"] as const) {
  test(`${panel} alone protects SPA navigation and allows deliberate discard`, async ({
    page,
  }) => {
    await fixture(page);
    await page.goto(`/hub/patient/${petId}`);
    if (panel === "dental") {
      await page
        .getByRole("button", { name: "New dental chart", exact: true })
        .click();
      await page
        .getByLabel("Dental chart / manual notes")
        .fill("Unsaved dental observation");
    } else {
      await page
        .getByRole("button", { name: "New QOL observation", exact: true })
        .click();
      await page
        .getByLabel("Comfort", { exact: true })
        .fill("Unsaved comfort observation");
    }
    const field =
      panel === "dental"
        ? page.getByLabel("Dental chart / manual notes")
        : page.getByLabel("Comfort", { exact: true });
    const value = await field.inputValue();
    await page
      .getByRole("link", { name: "Synthetic Household", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Keep editing", exact: true })
      .click();
    await expect(field).toHaveValue(value);
    await page
      .getByRole("link", { name: "Synthetic Household", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Discard and leave", exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`/hub/client/${clientId}$`));
  });
}
