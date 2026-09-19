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

async function fixture(page: Page) {
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
    rows: [] as Record<string, unknown>[],
    objects: [] as { name: string }[],
    ids: [] as string[],
    uploads: 0,
    finalizations: 0,
    failFinalize: true,
    loseUploadResponse: false,
    downloadBody: null as Record<string, unknown> | null,
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
    if (path === "/rest/v1/pets") return route.fulfill({ json: [patient] });
    if (path === "/rest/v1/clients")
      return route.fulfill({
        json: { id: clientId, full_name: "Synthetic Household" },
      });
    if (path === "/rest/v1/clinical_encounters")
      return route.fulfill({
        json: [
          {
            id: "own-encounter",
            pet_id: petId,
            visit_at: "2026-09-12T15:00:00Z",
            visit_type: "clinic",
            status: "draft",
          },
          {
            id: "wrong-encounter",
            pet_id: "other-pet",
            visit_at: "2026-09-13T15:00:00Z",
            visit_type: "WRONG PATIENT",
            status: "draft",
          },
        ],
      });
    if (path === "/rest/v1/patient_documents")
      return route.fulfill({ json: state.rows });
    if (path === "/rest/v1/rpc/prepare_patient_document") {
      const body = route.request().postDataJSON();
      state.ids.push(body.p_id);
      expect(body.p_pet_id).toBe(petId);
      const row = {
        id: body.p_id,
        pet_id: petId,
        encounter_id: body.p_encounter_id,
        file_name: body.p_file_name,
        file_path: `${staffId}/${petId}/${body.p_id}/document`,
        mime_type: body.p_mime_type,
        file_size: body.p_file_size,
        category: body.p_category,
        source: body.p_source,
        document_date: body.p_document_date,
        visibility: body.p_visibility,
        status: "uploading",
        created_by: staffId,
        created_at: "2026-09-12T15:00:00Z",
        version: 1,
      };
      state.rows = [row];
      return route.fulfill({ json: row });
    }
    if (path === "/storage/v1/object/list/patient-documents")
      return route.fulfill({ json: state.objects });
    if (path.startsWith("/storage/v1/object/patient-documents/")) {
      state.uploads++;
      expect(route.request().headers()["x-upsert"]).toBe("false");
      state.objects = [{ name: "document" }];
      if (state.loseUploadResponse) {
        state.loseUploadResponse = false;
        return route.abort("connectionfailed");
      }
      return route.fulfill({
        json: { Key: path.replace("/storage/v1/object/", "") },
      });
    }
    if (path === "/rest/v1/rpc/finalize_patient_document") {
      state.finalizations++;
      if (state.failFinalize) {
        state.failFinalize = false;
        return route.fulfill({
          status: 503,
          json: { message: "Temporary finalization failure" },
        });
      }
      state.rows[0] = { ...state.rows[0], status: "ready", version: 2 };
      return route.fulfill({ json: state.rows[0] });
    }
    if (path.startsWith("/storage/v1/object/sign/patient-documents/")) {
      state.downloadBody = route.request().postDataJSON();
      return route.fulfill({
        json: {
          signedURL: "/object/sign/patient-documents/synthetic?token=synthetic",
        },
      });
    }
    if (path === "/rest/v1/rpc/void_patient_document") {
      const body = route.request().postDataJSON();
      expect(body.p_expected_version).toBe(2);
      expect(body.p_reason).toBe("Wrong source record");
      state.rows[0] = {
        ...state.rows[0],
        status: "void",
        voided_by: staffId,
        void_reason: body.p_reason,
        version: 3,
      };
      return route.fulfill({ json: state.rows[0] });
    }
    return route.fulfill({ json: [] });
  });
  return state;
}

test("private document finalization retries without duplicate upload and retains void history", async ({
  page,
}, testInfo) => {
  const state = await fixture(page);
  await page.goto(`/hub/patient/${petId}`);
  await expect(
    page.getByText("Patient documents", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Related encounter").locator("option"),
  ).toHaveCount(2);
  await expect(page.getByLabel("Document visibility")).toHaveValue("internal");
  await page
    .getByLabel("Document file")
    .setInputFiles({
      name: "lab-result.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.7\nSynthetic lab fixture"),
    });
  await page.getByLabel("Document category").selectOption("lab_result");
  await page.getByLabel("Document source").fill("Synthetic lab");
  await page
    .getByRole("button", { name: "Save document", exact: true })
    .click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Temporary finalization failure" }),
  ).toBeVisible();
  await expect(page.getByLabel("Document source")).toHaveValue("Synthetic lab");
  await expect(page.getByLabel("Document source")).toBeDisabled();
  await page.getByRole("button", { name: "Retry document upload" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Document saved privately" }),
  ).toBeVisible();
  expect(state.ids).toHaveLength(1);
  expect(state.uploads).toBe(1);
  expect(state.finalizations).toBe(2);
  await page.getByRole("button", { name: "Download lab-result.pdf" }).click();
  await expect.poll(() => state.downloadBody).toEqual({ expiresIn: 60 });
  await page
    .getByRole("button", { name: "Void lab-result.pdf", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Confirm void" }),
  ).toBeDisabled();
  await page
    .getByLabel("Reason for voiding document")
    .fill("Wrong source record");
  await page.getByRole("button", { name: "Confirm void" }).click();
  await page.getByText("Voided document history", { exact: true }).click();
  await expect(page.getByText("Void — retained history")).toBeVisible();
  await expect(
    page.getByText(/Voided by Synthetic Staff: Wrong source record/),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("patient-document-history.png"),
    fullPage: true,
  });
});

test("rejects a renamed HTML file before reserving a document", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto(`/hub/patient/${petId}`);
  await page
    .getByLabel("Document file")
    .setInputFiles({
      name: "fake.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("<html>not a PDF</html>"),
    });
  await page
    .getByRole("button", { name: "Save document", exact: true })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "contents match its file type" }),
  ).toBeVisible();
  expect(state.ids).toHaveLength(0);
  expect(state.uploads).toBe(0);
});

test("ambiguous upload response probes the same path before finalizing", async ({
  page,
}) => {
  const state = await fixture(page);
  state.loseUploadResponse = true;
  state.failFinalize = false;
  await page.goto(`/hub/patient/${petId}`);
  await page
    .getByLabel("Document file")
    .setInputFiles({
      name: "record.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.7\nSynthetic record"),
    });
  await page
    .getByRole("button", { name: "Save document", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Retry document upload" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Retry document upload" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Document saved privately" }),
  ).toBeVisible();
  expect(state.uploads).toBe(1);
  expect(state.ids).toHaveLength(1);
  expect(state.finalizations).toBe(1);
});
