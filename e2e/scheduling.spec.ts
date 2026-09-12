import { test, expect } from "@playwright/test";
const staff = "11111111-1111-4111-8111-111111111111";
const client = "22222222-2222-4222-8222-222222222222";
const pet = "33333333-3333-4333-8333-333333333333";
test("housecall booking shows alerts, retains conflicts and saves Denver instant", async ({
  page,
}, testInfo) => {
  const user = {
    id: staff,
    aud: "authenticated",
    role: "authenticated",
    email: "synthetic@example.test",
    app_metadata: {},
    user_metadata: {},
    created_at: "2026-01-01T00:00:00Z",
  };
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const token = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ sub: staff, exp: expires, role: "authenticated", aud: "authenticated" })).toString("base64url")}.synthetic`;
  const session = {
    access_token: token,
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
  let conflict = true;
  let saves = 0;
  await page.route("**/*", (route) =>
    new URL(route.request().url()).hostname === "127.0.0.1"
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
            id: staff,
            full_name: "Synthetic Staff",
            first_name: "Synthetic",
            last_name: "Staff",
            is_active: true,
            role: "STAFF",
          },
        ],
      });
    if (path === "/rest/v1/user_roles")
      return route.fulfill({ json: [{ user_id: staff, role: "STAFF" }] });
    if (path === "/rest/v1/rpc/schedule_clinicians")
      return route.fulfill({
        json: [{ id: staff, full_name: "Synthetic Staff" }],
      });
    if (path === "/rest/v1/rpc/search_clients")
      return route.fulfill({
        json:
          route.request().postDataJSON().p_search === "No match"
            ? []
            : [
                {
                  id: client,
                  full_name: "Synthetic Family",
                  housecall_address: "100 Synthetic Street, Boulder, CO",
                },
              ],
      });
    if (path === "/rest/v1/clients")
      return route.fulfill({
        json: [
          {
            id: client,
            full_name: "Synthetic Family",
            housecall_address: "100 Synthetic Street, Boulder, CO",
          },
        ],
      });
    if (path === "/rest/v1/pets")
      return route.fulfill({
        json: [
          {
            id: pet,
            client_id: client,
            name: "Synthetic Juniper",
            archived_at: null,
            deceased_at: null,
            allergies: "Legacy penicillin reaction",
          },
        ],
      });
    if (path === "/rest/v1/rpc/read_patient_treatment_alerts")
      return route.fulfill({
        json: {
          source_hash: "a".repeat(64),
          snapshot: {
            schema_version: 1,
            pet_id: pet,
            patient_version: 1,
            important_problems: [
              {
                id: "problem",
                title: "Historical vaccine reaction",
                notes: "",
                status: "resolved",
                importance: "high",
                version: 1,
                onset_date: null,
                updated_at: "2026-09-12T12:00:00Z",
              },
            ],
            legacy_allergies: {
              text: "Legacy penicillin reaction",
              provenance: "Existing patient profile",
            },
          },
        },
      });
    if (path === "/rest/v1/patient_problems")
      return route.fulfill({
        json: [
          {
            id: "problem",
            title: "Historical vaccine reaction",
            status: "resolved",
          },
        ],
      });
    if (path === "/rest/v1/rpc/save_appointment") {
      saves++;
      if (conflict) {
        conflict = false;
        return route.fulfill({
          status: 409,
          json: {
            code: "23P01",
            message:
              "Clinician or room is already booked, including travel buffers",
          },
        });
      }
      const body = route.request().postDataJSON();
      expect(body.p_scheduled_at).toBe("2026-10-28T15:00:00.000Z");
      expect(body.p_actor_id).toBe(staff);
      expect(body.p_address_snapshot).toBe("100 Synthetic Street, Boulder, CO");
      expect(body.p_reminder_offsets).toEqual([48, 24]);
      return route.fulfill({ json: { id: "appointment", ...body } });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto("/hub/schedule");
  await page
    .getByRole("button", { name: "Book appointment", exact: true })
    .click();
  await page.getByLabel("Household", { exact: true }).selectOption(client);
  await page.getByLabel("Patient", { exact: true }).selectOption(pet);
  await expect(
    page.getByRole("note").filter({ hasText: "Important patient history" }),
  ).toContainText("Historical vaccine reaction (resolved)");
  await expect(page.getByLabel("Recorded patient allergies")).toContainText(
    "Legacy penicillin reaction",
  );
  await page.getByLabel("Find household by name").fill("No match");
  await expect(page.getByLabel("Household", { exact: true })).toHaveValue(
    client,
  );
  await expect(page.getByLabel("Patient", { exact: true })).toHaveValue(pet);
  await expect(
    page.getByRole("note").filter({ hasText: "Important patient history" }),
  ).toContainText("Historical vaccine reaction (resolved)");
  await page.getByLabel("Visit reason").fill("Wellness visit");
  await page.getByLabel("Assigned staff", { exact: true }).selectOption(staff);
  await page
    .getByLabel("Date and time (America/Denver)", { exact: true })
    .fill("2026-10-28T09:00");
  await page.getByLabel("Location", { exact: true }).selectOption("housecall");
  await expect(page.getByLabel("Visit address")).toHaveValue(
    "100 Synthetic Street, Boulder, CO",
  );
  await expect(
    page.getByRole("link", { name: "Open directions in Google Maps" }),
  ).toHaveAttribute("href", /destination=100/);
  await page
    .getByRole("button", { name: "Save appointment", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("already booked");
  await expect(page.getByLabel("Visit reason")).toHaveValue("Wellness visit");
  await page.screenshot({
    path: testInfo.outputPath("housecall-booking.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Save appointment", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(saves).toBe(2);
});
