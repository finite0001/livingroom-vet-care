import { test, expect, type Page } from "@playwright/test";
const backend = "http://127.0.0.1:54321";
const actor = "11111111-1111-4111-8111-111111111111";
const pet = "22222222-2222-4222-8222-222222222222";
const client = "33333333-3333-4333-8333-333333333333";
const lot = "44444444-4444-4444-8444-444444444444";
const invoice = "55555555-5555-4555-8555-555555555555";
async function fixture(
  page: Page,
  firstOutcome: "uncertain" | "stale" = "uncertain",
) {
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
  const patientRow = {
    id: pet,
    client_id: client,
    name: "Stock Juniper",
    species: "Dog",
    allergies: "Legacy antibiotic allergy",
    version: 1,
    birth_date_precision: "unknown",
    sex: "unknown",
    neuter_status: "unknown",
    color: null as string | null,
  };
  const calls: unknown[] = [];
  const problems = [
    {
      id: "reaction",
      pet_id: pet,
      title: "Vaccine reaction",
      notes: "Monitor closely",
      importance: "high",
      status: "resolved",
      version: 1,
      onset_date: null,
      updated_at: "2026-09-12T12:00:00Z",
    },
  ];
  let alertRevision = 1;

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
    if (path === "/rest/v1/pets") return route.fulfill({ json: [patientRow] });
    if (path === "/rest/v1/rpc/save_patient") {
      const body = route.request().postDataJSON();
      patientRow.color = body.p_color;
      patientRow.version++;
      alertRevision++;
      return route.fulfill({ json: patientRow });
    }
    if (path === "/rest/v1/rpc/search_clients")
      return route.fulfill({
        json: [{ id: client, full_name: "Synthetic Family" }],
      });
    if (path === "/rest/v1/clients")
      return route.fulfill({
        json: route.request().headers().accept?.includes("object")
          ? { id: client, full_name: "Synthetic Family" }
          : [{ id: client, full_name: "Synthetic Family" }],
      });
    if (path === "/rest/v1/patient_problems")
      return route.fulfill({ json: problems });
    if (path === "/rest/v1/rpc/read_patient_treatment_alerts")
      return route.fulfill({
        json: {
          source_hash: String(alertRevision).repeat(64),
          snapshot: {
            schema_version: 1,
            pet_id: pet,
            patient_version: patientRow.version,
            important_problems: problems.filter((p) => p.importance === "high"),
            legacy_allergies: {
              text: patientRow.allergies,
              provenance:
                "Existing patient profile; source date and verification not established",
            },
          },
        },
      });
    if (path === "/rest/v1/rpc/save_patient_problem") {
      const request = route.request().postDataJSON();
      const problem = {
        id: "new-problem",
        pet_id: pet,
        title: request.p_title,
        notes: request.p_notes,
        importance: request.p_importance,
        status: request.p_status,
        version: 1,
        onset_date: null,
        updated_at: "2026-09-12T13:00:00Z",
      };
      problems.push(problem);
      alertRevision++;
      return route.fulfill({ json: problem });
    }
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
      if (calls.length === 1 && firstOutcome === "stale") {
        alertRevision++;
        return route.fulfill({
          status: 409,
          json: {
            code: "40001",
            message:
              "Patient alerts changed; reload and review the current alerts before recording treatment",
          },
        });
      }
      if (calls.length === 1)
        return route.fulfill({
          status: 503,
          json: { message: "Outcome unavailable" },
        });
      return route.fulfill({ json: { id: "saved" } });
    }
    return route.fulfill({ json: [] });
  });
  return Object.assign(calls, {
    changeLegacyAllergy: () => {
      patientRow.allergies = "Updated external allergy history";
      patientRow.version++;
      alertRevision++;
    },
  });
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
      "I reviewed the important patient history and recorded allergy information before recording this treatment.",
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
    (calls[0] as { p_request: { alert_review: unknown } }).p_request
      .alert_review,
  ).toEqual({ source_hash: "1".repeat(64), acknowledged: true });
  expect(
    (calls[0] as { p_request: { administered_at: string } }).p_request
      .administered_at,
  ).toBe("2026-09-12T15:00:00.000Z");
  await page.screenshot({
    path: testInfo.outputPath("inventory-workflow.png"),
    fullPage: true,
  });
});

test("saving an important diagnosis refreshes treatment and booking alerts in the same session", async ({
  page,
}) => {
  await fixture(page);
  await page.goto(`/hub/patient/${pet}`);
  const checkbox = page.getByLabel(
    "I reviewed the important patient history and recorded allergy information before recording this treatment.",
  );
  await checkbox.check();
  await page.getByRole("button", { name: "Add problem", exact: true }).click();
  await page
    .getByLabel("Problem or diagnosis", { exact: true })
    .fill("Newly flagged reaction");
  await page.getByLabel("History flag", { exact: true }).selectOption("high");
  await page.getByRole("button", { name: "Save problem", exact: true }).click();
  const treatmentAlerts = page.getByRole("alert").filter({
    has: page.getByRole("heading", { name: "Important patient alerts" }),
  });
  await expect(treatmentAlerts).toContainText("Newly flagged reaction");
  await expect(checkbox).not.toBeChecked();
  await page
    .getByRole("button", { name: "Schedule", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Book appointment", exact: true })
    .click();
  await page.getByLabel("Household", { exact: true }).selectOption(client);
  await page.getByLabel("Patient", { exact: true }).selectOption(pet);
  await expect(
    page.getByRole("note").filter({ hasText: "Important patient history" }),
  ).toContainText("Newly flagged reaction");
});

async function fillTreatment(page: Page) {
  await page.getByLabel("Lot to dispense").selectOption(lot);
  await page.getByLabel("Draft invoice", { exact: true }).selectOption(invoice);
  await page.getByLabel("Stock quantity", { exact: true }).fill("1");
  await page.getByLabel("Clinical dose", { exact: true }).fill("1 mL");
  await page.getByLabel("Route", { exact: true }).fill("SC");
  await page.getByLabel("Veterinarian", { exact: true }).fill("Dr Synthetic");
  await page
    .getByLabel("Administration date/time (America/Denver)")
    .fill("2026-09-12T09:00");
}
test("stale server review preserves treatment fields and allows a fresh acknowledged request", async ({
  page,
}) => {
  const calls = await fixture(page, "stale");
  await page.goto(`/hub/patient/${pet}`);
  await fillTreatment(page);
  const checkbox = page.getByLabel(
    "I reviewed the important patient history and recorded allergy information before recording this treatment.",
  );
  await checkbox.check();
  await page.getByRole("button", { name: "Record treatment & charge" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Patient alerts changed" }),
  ).toBeVisible();
  await expect(checkbox).not.toBeChecked();
  await expect(page.getByLabel("Clinical dose", { exact: true })).toHaveValue(
    "1 mL",
  );
  await checkbox.check();
  await page.getByRole("button", { name: "Record treatment & charge" }).click();
  await expect.poll(() => calls.length).toBe(2);
  const requests = calls as Array<{
    p_id: string;
    p_request: { alert_review: { source_hash: string } };
  }>;
  expect(requests[1].p_id).not.toBe(requests[0].p_id);
  expect(requests[1].p_request.alert_review.source_hash).toBe("2".repeat(64));
});
test("malformed alert response shows a local retry control instead of crashing the patient page", async ({
  page,
}) => {
  await fixture(page);
  let malformed = true;
  await page.route(
    `${backend}/rest/v1/rpc/read_patient_treatment_alerts`,
    (route) =>
      route.fulfill({
        json: {
          source_hash: "a".repeat(64),
          snapshot: {
            schema_version: 1,
            pet_id: pet,
            patient_version: 1,
            important_problems: malformed ? [null] : [],
            legacy_allergies: { text: null, provenance: "Existing profile" },
          },
        },
      }),
  );
  await page.goto(`/hub/patient/${pet}`);
  await expect(
    page.getByRole("button", { name: "Reload patient alerts" }),
  ).toBeVisible();
  malformed = false;
  await page.getByRole("button", { name: "Reload patient alerts" }).click();
  await expect(
    page.getByLabel("I reviewed the current patient alert summary.", {
      exact: false,
    }),
  ).toBeEnabled();
});

test("patient edit and refreshed external allergy history each clear the treatment acknowledgment", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto(`/hub/patient/${pet}`);
  const checkbox = page.getByLabel(
    "I reviewed the important patient history and recorded allergy information before recording this treatment.",
  );
  await checkbox.check();
  await page.getByRole("button", { name: "Edit patient", exact: true }).click();
  await page
    .getByLabel("Color / markings", { exact: true })
    .fill("Black and white");
  await page.getByRole("button", { name: "Save patient", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(checkbox).not.toBeChecked();
  await checkbox.check();
  state.changeLegacyAllergy();
  await page
    .getByRole("button", { name: "Refresh patient alerts", exact: true })
    .click();
  await expect(
    page.getByText("Updated external allergy history", { exact: true }),
  ).toBeVisible();
  await expect(checkbox).not.toBeChecked();
});
