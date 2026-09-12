import { test, expect, type Page } from "@playwright/test";
import { certificate } from "../tests/certificates/fixture";
import type {
  CertificateBundle,
  IssueArgs,
} from "../src/hub/features/certificates/api";
const petId = "22222222-2222-4222-8222-222222222222",
  staffId = "11111111-1111-4111-8111-111111111111";
async function fixture(page: Page, verified = true) {
  const user = {
    id: staffId,
    aud: "authenticated",
    role: "authenticated",
    email: "cert@example.test",
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {},
    created_at: "2026-01-01T00:00:00Z",
  };
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const token = Buffer.from(
    JSON.stringify({
      sub: staffId,
      exp,
      role: "authenticated",
      aud: "authenticated",
    }),
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
  const state = {
    issued: [] as CertificateBundle[],
    requests: [] as IssueArgs[],
    ambiguous: false,
    stale: false,
    missing: false,
  };
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin === "http://127.0.0.1:8091"
      ? route.continue()
      : route.abort(),
  );
  await page.route("http://127.0.0.1:54321/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/auth/v1/token") return route.fulfill({ json: session });
    if (path === "/auth/v1/user") return route.fulfill({ json: user });
    if (path === "/rest/v1/profiles")
      return route.fulfill({
        json: [
          {
            ...user,
            full_name: "Dr Test",
            first_name: "Test",
            last_name: "Vet",
            role: "DVM",
            is_active: true,
          },
        ],
      });
    if (path === "/rest/v1/user_roles")
      return route.fulfill({ json: [{ role: "DVM" }] });
    if (path === "/rest/v1/pets")
      return route.fulfill({
        json: [
          {
            id: petId,
            client_id: "33333333-3333-4333-8333-333333333333",
            name: "Test dog",
            species: "Dog",
            dob: "2020-01-01",
            birth_date_precision: "exact",
            breed: "Mixed",
            color: "Brown",
            sex: "female",
            neuter_status: "neutered",
            version: 1,
          },
        ],
      });
    if (path === "/rest/v1/clients")
      return route.fulfill({
        json: {
          id: "33333333-3333-4333-8333-333333333333",
          full_name: "Test family",
        },
      });
    if (path === "/rest/v1/certificate_issuers")
      return route.fulfill({
        json: verified
          ? {
              user_id: staffId,
              full_name: "Dr Test",
              license_number: "TEST-ONLY",
              license_state: "CO",
              license_expires_on: "2099-01-01",
              active: true,
              verified_at: "2026-01-01T00:00:00Z",
              clinical_acceptance_at: "2026-01-01T00:00:00Z",
            }
          : null,
      });
    if (path === "/rest/v1/patient_treatments")
      return route.fulfill({
        json: [
          {
            id: "dose",
            product_name: "Test vaccine",
            administered_at: "2026-09-12T12:00:00Z",
            historical: false,
            next_due_on: null,
          },
        ],
      });
    if (path === "/rest/v1/vaccine_certificates")
      return route.fulfill({ json: state.issued.map((v) => v.certificate) });
    if (path === "/rest/v1/rpc/read_vaccine_certificate")
      return route.fulfill({
        json: state.issued.find(
          (v) => v.certificate.id === route.request().postDataJSON().p_id,
        ),
      });
    if (path === "/rest/v1/rpc/preview_vaccine_certificate") {
      if (state.missing)
        return route.fulfill({
          status: 400,
          json: {
            code: "23514",
            message:
              "Rabies vaccine manufacturer, lot, valid expiry, site and reviewed due date are required",
          },
        });
      const args = route.request().postDataJSON();
      const snapshot = structuredClone(certificate.snapshot);
      snapshot.kind = args.p_kind;
      snapshot.details = args.p_details;
      snapshot.vaccinations[0].next_due_on = null;
      return route.fulfill({ json: snapshot });
    }
    if (path === "/rest/v1/rpc/issue_vaccine_certificate") {
      const args = route.request().postDataJSON() as IssueArgs;
      state.requests.push(args);
      if (state.stale)
        return route.fulfill({
          status: 409,
          json: {
            code: "40001",
            message:
              "Certificate details changed; reload and review before issuing",
          },
        });
      let issued = state.issued.find((v) => v.certificate.id === args.p_id);
      if (!issued) {
        issued = {
          certificate: {
            ...certificate,
            id: args.p_id,
            pet_id: petId,
            kind: args.p_kind,
            issued_by: staffId,
            snapshot: args.p_reviewed_snapshot,
          },
          events: [],
        };
        state.issued.push(issued);
      }
      if (state.ambiguous) {
        state.ambiguous = false;
        return route.abort("failed");
      }
      return route.fulfill({ json: issued.certificate });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto(`/hub/patient/${petId}`);
  await expect(
    page.getByRole("heading", { name: "Vaccine certificates", exact: true }),
  ).toBeVisible();
  return state;
}
test("review, ambiguous retry and reopened invalidation preserve the original certificate", async ({
  page,
}) => {
  const state = await fixture(page);
  state.ambiguous = true;
  const panel = page.getByRole("region", { name: "Patient certificates" });
  await panel
    .getByRole("button", { name: "Review certificate preview", exact: true })
    .click();
  await expect(
    panel.getByText("Not recorded — no due date certified", { exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByLabel("Certificate type", { exact: true }),
  ).toBeDisabled();
  await panel
    .getByLabel(
      "I reviewed every displayed field and date and explicitly sign this certificate.",
    )
    .check();
  await panel.getByLabel("Type your verified name: Dr Test").fill("Dr Test");
  await panel
    .getByRole("button", { name: "Sign and issue certificate", exact: true })
    .click();
  await expect(
    panel.getByRole("button", {
      name: "Retry same signed request",
      exact: true,
    }),
  ).toBeVisible();
  await panel
    .getByRole("button", { name: "Retry same signed request", exact: true })
    .click();
  await expect(
    panel.getByRole("button", { name: "Open print dialog", exact: true }),
  ).toBeVisible();
  expect(state.requests).toHaveLength(2);
  expect(state.requests[0]).toEqual(state.requests[1]);
  expect(state.issued).toHaveLength(1);
  state.issued[0].events.push({
    id: "event",
    kind: "treatment_corrected",
    reason: "Source lot corrected",
    created_at: "2026-09-13T00:00:00Z",
    replacement_id: null,
  });
  await panel
    .getByRole("button", { name: "Open certificate", exact: true })
    .click();
  await expect(
    panel.getByText(
      "Invalidated — this copy is retained for historical reference.",
    ),
  ).toBeVisible();
  const popupPromise = page.waitForEvent("popup");
  await panel
    .getByRole("button", { name: "Open print dialog", exact: true })
    .click();
  const popup = await popupPromise;
  await expect(popup.getByRole("alert")).toContainText("INVALIDATED");
  await expect(
    popup.getByText("Frozen manufacturer", { exact: true }),
  ).toBeVisible();
  await popup.close();
  await page.reload();
  await expect(
    panel.getByText("Invalidated — retained history", { exact: true }),
  ).toBeVisible();
});
test("missing rabies metadata cannot reach a signature and unverified DVM cannot issue", async ({
  page,
}) => {
  const state = await fixture(page);
  state.missing = true;
  const panel = page.getByRole("region", { name: "Patient certificates" });
  await panel
    .getByLabel("Certificate type", { exact: true })
    .selectOption("rabies");
  await panel
    .getByLabel("Rabies administration to certify", { exact: true })
    .selectOption("dose");
  await panel
    .getByRole("button", { name: "Review certificate preview", exact: true })
    .click();
  await expect(panel.getByRole("alert")).toContainText(
    "reviewed due date are required",
  );
  await expect(
    panel.getByRole("button", {
      name: "Sign and issue certificate",
      exact: true,
    }),
  ).toHaveCount(0);
  expect(state.requests).toHaveLength(0);
});
test("DVM without operator verification sees access explanation", async ({
  page,
}) => {
  await fixture(page, false);
  const panel = page.getByRole("region", { name: "Patient certificates" });
  await expect(
    panel.getByText(/operator-verified Colorado credentials/),
  ).toBeVisible();
  await expect(
    panel.getByRole("button", {
      name: "Review certificate preview",
      exact: true,
    }),
  ).toHaveCount(0);
});

test("editing and a stale source response require a fresh review and signature", async ({
  page,
}) => {
  const state = await fixture(page);
  const panel = page.getByRole("region", { name: "Patient certificates" });
  await panel
    .getByRole("button", { name: "Review certificate preview", exact: true })
    .click();
  await panel
    .getByLabel(
      "I reviewed every displayed field and date and explicitly sign this certificate.",
    )
    .check();
  await panel.getByLabel("Type your verified name: Dr Test").fill("Dr Test");
  await panel
    .getByRole("button", { name: "Edit and review again", exact: true })
    .click();
  await expect(
    panel.getByRole("button", {
      name: "Sign and issue certificate",
      exact: true,
    }),
  ).toHaveCount(0);
  await panel
    .getByRole("button", { name: "Review certificate preview", exact: true })
    .click();
  await expect(
    panel.getByLabel(
      "I reviewed every displayed field and date and explicitly sign this certificate.",
    ),
  ).not.toBeChecked();
  await expect(
    panel.getByLabel("Type your verified name: Dr Test"),
  ).toHaveValue("");
  await panel
    .getByLabel(
      "I reviewed every displayed field and date and explicitly sign this certificate.",
    )
    .check();
  await panel.getByLabel("Type your verified name: Dr Test").fill("Dr Test");
  state.stale = true;
  await panel
    .getByRole("button", { name: "Sign and issue certificate", exact: true })
    .click();
  await expect(panel.getByRole("alert")).toContainText(
    "reload and review before issuing",
  );
  await expect(
    panel.getByRole("button", {
      name: "Review certificate preview",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    panel.getByRole("button", {
      name: "Sign and issue certificate",
      exact: true,
    }),
  ).toHaveCount(0);
  expect(state.issued).toHaveLength(0);
});
