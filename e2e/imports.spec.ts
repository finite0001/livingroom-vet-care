import { test, expect, type Page } from "@playwright/test";
const backend = "http://127.0.0.1:54321";
const staffId = "e6000000-0000-4000-8000-000000000001";
const clientId = "e6000000-0000-4000-8000-000000000002";
const petId = "e6000000-0000-4000-8000-000000000003";
const contactId = "e6000000-0000-4000-8000-000000000004";
const animalId = "e6000000-0000-4000-8000-000000000005";
async function fixture(page: Page, admin = true) {
  const user = {
    id: staffId,
    aud: "authenticated",
    role: "authenticated",
    email: "synthetic@example.test",
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {},
    created_at: "2026-01-01T00:00:00Z",
  };
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
  const source = {
    source_origin: "https://api.trial.ezyvet.com",
    source_site_uid: "synthetic-site",
    created_at: "2026-09-12T16:00:00Z",
    first_seen_by: staffId,
  };
  const contact = {
    ...source,
    id: contactId,
    resource: "contact",
    external_id: "11",
    payload_hash: "contact-hash",
    payload: { id: 11, first_name: "<b>Source name</b>", last_name: "Family" },
  };
  const animal = {
    ...source,
    id: animalId,
    resource: "animal",
    external_id: "22",
    payload_hash: "animal-hash",
    payload: {
      id: 22,
      contact_id: 11,
      name: "Juniper",
      species_id: 7,
      microchip_number: "0000123",
    },
  };
  const state = {
    links: [] as Record<string, unknown>[],
    approvals: [] as Record<string, unknown>[],
    lostResponse: true,
    stageRequests: 0,
    reviewReads: 0,
  };
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin ===
    new URL(String(test.info().project.use.baseURL)).origin
      ? route.continue()
      : route.abort(),
  );
  await page.route(`${backend}/**`, async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path === "/auth/v1/token") return route.fulfill({ json: session });
    if (path === "/auth/v1/user") return route.fulfill({ json: user });
    if (path === "/rest/v1/profiles")
      return route.fulfill({
        json: [
          {
            id: staffId,
            first_name: "Synthetic",
            last_name: "Admin",
            full_name: "Synthetic Admin",
            role: admin ? "ADMIN" : "STAFF",
            is_active: true,
          },
        ],
      });
    if (path === "/rest/v1/user_roles")
      return route.fulfill({ json: [{ role: admin ? "ADMIN" : "STAFF" }] });
    if (path === "/rest/v1/ezyvet_import_snapshots") {
      state.reviewReads++;
      return route.fulfill({
        json:
          url.searchParams.get("resource") === "eq.animal"
            ? [animal]
            : [contact],
      });
    }
    if (path === "/rest/v1/ezyvet_identity_heads") {
      const isAnimal = url.searchParams.get("resource") === "eq.animal";
      return route.fulfill({
        json: [
          {
            ...source,
            resource: isAnimal ? "animal" : "contact",
            external_id: isAnimal ? "22" : "11",
            snapshot_id: isAnimal ? animalId : contactId,
            version: 1,
          },
        ],
      });
    }
    if (path === "/rest/v1/ezyvet_record_links") {
      const requestId = url.searchParams.get("request_id")?.slice(3);
      const externalId = url.searchParams.get("external_id")?.slice(3);
      return route.fulfill({
        json: state.links.filter((link) =>
          requestId
            ? link.request_id === requestId
            : link.external_id === externalId,
        ),
      });
    }
    if (path === "/rest/v1/pets") {
      expect(url.searchParams.get("client_id")).toBe(`eq.${clientId}`);
      return route.fulfill({
        json: [
          { id: petId, name: "Existing Juniper", species: "Dog", version: 4 },
        ],
      });
    }
    if (path === "/rest/v1/rpc/promote_ezyvet_identity") {
      const body = route.request().postDataJSON();
      state.approvals.push(body);
      const isAnimal = body.p_snapshot_id === animalId;
      const link = {
        ...source,
        id: crypto.randomUUID(),
        request_id: body.p_request_id,
        resource: isAnimal ? "animal" : "contact",
        external_id: isAnimal ? "22" : "11",
        client_id: clientId,
        pet_id: isAnimal ? petId : null,
        approved_by: staffId,
        reason: body.p_reason,
        local_version: isAnimal ? 4 : 1,
      };
      state.links.push(link);
      if (state.lostResponse) {
        state.lostResponse = false;
        return route.abort("connectionfailed");
      }
      return route.fulfill({ json: link });
    }
    if (path === "/functions/v1/ezyvet-import") {
      state.stageRequests++;
      return route.fulfill({
        status: 503,
        json: {
          error: "IMPORT_DISABLED",
          retry_after_seconds: 2,
          retry_safe: true,
        },
      });
    }
    if (path.endsWith("list_ezyvet_attachment_capture_mappings"))
      return route.fulfill({
        json: { mappings: [], has_more: false, next_cursor: null },
      });
    return route.fulfill({ json: [] });
  });
  return state;
}
test("admin reviews corrected household, recovers lost approval and links patient without overwriting", async ({
  page,
}, testInfo) => {
  const state = await fixture(page);
  await page.goto("/hub/tools/ezyvet");
  await page
    .getByRole("button", { name: "Review contact #11", exact: true })
    .click();
  await expect(page.getByLabel("First name", { exact: true })).toHaveValue(
    "<b>Source name</b>",
  );
  await page.getByLabel("First name", { exact: true }).fill("Reviewed");
  await page
    .getByLabel("Review reason")
    .fill("Confirmed household and checked duplicates");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Approve reviewed import" }).click();
  await expect(
    page.getByRole("button", { name: "Recheck approval status" }),
  ).toBeEnabled();
  await expect(page.getByLabel("First name", { exact: true })).toHaveValue(
    "Reviewed",
  );
  await page.getByRole("button", { name: "Recheck approval status" }).click();
  await expect(page.getByText("Already linked", { exact: true })).toBeVisible();
  expect(state.approvals).toHaveLength(1);
  expect(state.approvals[0].p_values).toMatchObject({
    first_name: "Reviewed",
    last_name: "Family",
  });
  await page.getByLabel("Source resource").selectOption("animal");
  await page
    .getByRole("button", { name: "Review animal #22", exact: true })
    .click();
  await expect(page.getByLabel("Species", { exact: true })).toHaveValue("");
  await page.getByLabel("Reviewed action").selectOption("link");
  await page.getByLabel("Existing local record").selectOption(petId);
  await page
    .getByLabel("Review reason")
    .fill("Same patient; preserve local chart");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Approve reviewed import" }).click();
  await expect(page.getByText("Already linked", { exact: true })).toBeVisible();
  expect(state.approvals[1]).toMatchObject({
    p_action: "link",
    p_client_id: clientId,
    p_pet_id: petId,
    p_expected_local_version: 4,
    p_values: {},
  });
  await page.screenshot({
    path: testInfo.outputPath("reviewed-ezyvet-link.png"),
    fullPage: true,
  });
});
test("server-disabled importer reports failure and does not claim success", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto("/hub/tools/ezyvet");
  await page.getByRole("button", { name: "Start staged import" }).click();
  await expect(page.getByRole("alert")).toContainText("IMPORT_DISABLED");
  expect(state.stageRequests).toBe(1);
  expect(state.approvals).toHaveLength(0);
});
test("nonadministrator cannot query staged source records", async ({
  page,
}) => {
  const state = await fixture(page, false);
  await page.goto("/hub/tools/ezyvet");
  await expect(page).toHaveURL(/\/hub$/);
  await expect(
    page.getByRole("button", { name: "ezyVet imports", exact: true }),
  ).toHaveCount(0);
  expect(state.reviewReads).toBe(0);
  expect(state.stageRequests).toBe(0);
});
