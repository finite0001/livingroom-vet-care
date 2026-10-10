import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
const backend = "http://127.0.0.1:54321";
const staffId = "11111111-1111-4111-8111-111111111111",
  petId = "22222222-2222-4222-8222-222222222222",
  clientId = "33333333-3333-4333-8333-333333333333",
  productId = "44444444-4444-4444-8444-444444444444",
  encounterId = "55555555-5555-4555-8555-555555555555";
const row = {
  id: "66666666-6666-4666-8666-666666666666",
  pet_id: petId,
  product_id: productId,
  product_name: "Synthetic rabies vaccine",
  event_type: "administered",
  item_kind: "vaccine",
  occurred_at: "2026-10-01T12:00:00Z",
  historical: false,
  clinician: "Synthetic DVM",
  lots: "LOT-1",
  correction_status: "current",
  correction_reason: null,
  replacement_id: null,
  encounter_id: null,
  authorization_id: null,
  source_note: "",
  patient_name: "Synthetic dog",
  species: "Dog",
  deceased_at: null,
  archived_at: null,
  client_id: clientId,
  client_name: "Synthetic family",
  phone: "+13035550101",
  email: "family@example.test",
};
const asOf = "2026-10-09T20:00:00Z";
async function session(page: Page) {
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const user = {
    id: staffId,
    aud: "authenticated",
    role: "authenticated",
    email: "staff@example.test",
    app_metadata: {},
    user_metadata: {},
    created_at: "2026-01-01T00:00:00Z",
  };
  const value = {
    access_token: `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ sub: staffId, exp: expires, role: "authenticated" })).toString("base64url")}.synthetic`,
    refresh_token: "synthetic",
    expires_at: expires,
    expires_in: 3600,
    token_type: "bearer",
    user,
  };
  await page.addInitScript(
    (s) => localStorage.setItem("sb-127-auth-token", JSON.stringify(s)),
    value,
  );
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin ===
    new URL(String(test.info().project.use.baseURL)).origin
      ? route.continue()
      : route.abort(),
  );
  return { user, value };
}
test("mobile Whogot filters, tied pagination and complete CSV use the same server scope", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const auth = await session(page);
  const queries: Record<string, unknown>[] = [];
  await page.route(`${backend}/**`, (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/auth/v1/user") return route.fulfill({ json: auth.user });
    if (path === "/auth/v1/token") return route.fulfill({ json: auth.value });
    if (path === "/rest/v1/profiles")
      return route.fulfill({
        json: [{ id: staffId, full_name: "Synthetic staff", is_active: true }],
      });
    if (path === "/rest/v1/user_roles")
      return route.fulfill({ json: [{ role: "STAFF" }] });
    if (path === "/rest/v1/rpc/search_whogot_products")
      return route.fulfill({
        json: [
          {
            id: productId,
            name: row.product_name,
            kind: "vaccine",
            active: true,
            aliases: ["Original name"],
          },
        ],
      });
    if (path === "/rest/v1/rpc/search_whogot") {
      const body = route.request().postDataJSON();
      queries.push(body);
      const second = {
        ...row,
        id: "77777777-7777-4777-8777-777777777777",
        patient_name: "Synthetic cat",
        species: "Cat",
      };
      return route.fulfill({
        json: {
          as_of: asOf,
          rows: body.p_before ? [second] : [row],
          next: body.p_before
            ? null
            : {
                occurred_at: row.occurred_at,
                event_type: row.event_type,
                id: row.id,
              },
        },
      });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto("/hub/whogot");
  await page.getByLabel("Product, vaccine or service").selectOption(productId);
  await page.getByLabel("Exact lot number").fill("LOT-1");
  await page.getByLabel("From (Denver date)").fill("2026-10-01");
  await page.getByLabel("Through (Denver date)").fill("2026-10-09");
  await page.getByRole("button", { name: "Search Whogot" }).click();
  await expect(
    page.getByRole("link", { name: "Synthetic dog", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Load more events" }).click();
  await expect(
    page.getByRole("link", { name: "Synthetic cat", exact: true }),
  ).toBeVisible();
  expect(queries[1].p_as_of).toBe(asOf);
  expect(queries[1].p_before).toEqual({
    occurred_at: row.occurred_at,
    event_type: "administered",
    id: row.id,
  });
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export all matches CSV" }).click();
  const file = await download;
  const csv = await readFile((await file.path())!, "utf8");
  expect(csv).toContain("Synthetic dog");
  expect(csv).toContain("Synthetic cat");
  expect(csv).toContain(asOf);
  expect(csv).toContain('"\'+13035550101"');
  for (const query of queries) {
    expect(query.p_product_id).toBe(productId);
    expect(query.p_lot).toBe("LOT-1");
    expect(query.p_from).toBe("2026-10-01");
    expect(query.p_include_corrected).toBe(false);
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("whogot-mobile.png"),
    fullPage: true,
  });
});
test("direct source exposes current correction and remains patient scoped", async ({
  page,
}) => {
  const auth = await session(page);
  await page.route(`${backend}/**`, (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/auth/v1/user") return route.fulfill({ json: auth.user });
    if (path === "/auth/v1/token") return route.fulfill({ json: auth.value });
    if (path === "/rest/v1/profiles")
      return route.fulfill({
        json: [{ id: staffId, full_name: "Synthetic staff", is_active: true }],
      });
    if (path === "/rest/v1/user_roles")
      return route.fulfill({ json: [{ role: "STAFF" }] });
    if (path === "/rest/v1/rpc/read_whogot_source") {
      expect(route.request().postDataJSON()).toEqual({
        p_pet_id: petId,
        p_event_type: "administered",
        p_id: row.id,
      });
      return route.fulfill({
        json: {
          event_type: "administered",
          record: {
            id: row.id,
            pet_id: petId,
            product_name: "Original vaccine",
            historical: true,
            administered_at: row.occurred_at,
            veterinarian: "Outside DVM",
            dose: "1 ml",
            route: "SC",
            site: "right rear",
            lot_number: "LOT-1",
            source: "Outside record",
          },
          corrections: [
            {
              id: productId,
              created_at: asOf,
              reason: "Entered in error",
              replacement_id: null,
            },
          ],
        },
      });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto(`/hub/whogot/source/administered/${row.id}?patient=${petId}`);
  await expect(
    page.getByText("Original vaccine", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Entered in error", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Open patient chart" }),
  ).toHaveAttribute("href", new RegExp(`/hub/patient/${petId}`));
});
test("service completion preserves the exact operation after an interrupted response", async ({
  page,
}) => {
  const auth = await session(page);
  const records: unknown[] = [];
  const requests: Record<string, unknown>[] = [];
  await page.route(`${backend}/**`, async (route) => {
    const url = new URL(route.request().url()),
      path = url.pathname;
    if (path === "/auth/v1/user") return route.fulfill({ json: auth.user });
    if (path === "/auth/v1/token") return route.fulfill({ json: auth.value });
    if (path === "/rest/v1/profiles")
      return route.fulfill({
        json: [{ id: staffId, full_name: "Synthetic DVM", is_active: true }],
      });
    if (path === "/rest/v1/user_roles")
      return route.fulfill({ json: [{ role: "STAFF" }] });
    if (path === "/rest/v1/pets")
      return route.fulfill({
        json: {
          id: petId,
          client_id: clientId,
          name: "Synthetic dog",
          species: "Dog",
          birth_date_precision: "unknown",
          sex: "unknown",
          neuter_status: "unknown",
          archived_at: null,
          deceased_at: null,
          version: 1,
        },
      });
    if (path === "/rest/v1/clients")
      return route.fulfill({
        json: { id: clientId, full_name: "Synthetic family" },
      });
    if (path === "/rest/v1/clinical_encounters")
      return route.fulfill({
        json: [
          {
            id: encounterId,
            pet_id: petId,
            visit_at: "2026-10-01T12:00:00Z",
            visit_type: "clinic",
            location: "",
            subjective: "",
            objective: "",
            assessment: "",
            plan: "",
            status: "draft",
            version: 1,
            created_by: staffId,
            updated_by: staffId,
            created_at: asOf,
            updated_at: asOf,
          },
        ],
      });
    if (path === "/rest/v1/rpc/list_patient_services")
      return route.fulfill({ json: records });
    if (path === "/rest/v1/rpc/list_service_clinicians")
      return route.fulfill({ json: [{ id: staffId, name: "Synthetic DVM" }] });
    if (path === "/rest/v1/rpc/search_whogot_products")
      return route.fulfill({
        json: [
          {
            id: productId,
            name: "Synthetic exam",
            kind: "service",
            active: true,
            aliases: [],
          },
        ],
      });
    if (path === "/rest/v1/rpc/record_patient_service") {
      const body = route.request().postDataJSON();
      requests.push(body);
      if (requests.length === 1)
        return route.fulfill({
          status: 503,
          json: { message: "Interrupted response" },
        });
      expect(body).toEqual(requests[0]);
      const r = body.p_request;
      records.push({
        ...r,
        id: body.p_id,
        product_name: "Synthetic exam",
        clinician_name: "Synthetic DVM",
        created_by: staffId,
        created_at: asOf,
        correction: null,
      });
      return route.fulfill({ json: { id: body.p_id } });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto(`/hub/patient/${petId}?tab=medical&section=soap`);
  await page
    .getByRole("button", { name: /Oct 1, 2026.*clinic.*draft/ })
    .click();
  await page.getByLabel("Service catalog item").selectOption(productId);
  await page.getByLabel("Performing clinician").selectOption(staffId);
  await page.getByLabel("Completed at (Denver)").fill("2026-10-02T12:00");
  await page.getByLabel("Service notes").fill("Completed examination");
  await page.getByRole("button", { name: "Record service completion" }).click();
  await expect(
    page.getByRole("button", { name: "Retry exact service request" }),
  ).toBeVisible();
  await expect(page.getByLabel("Service catalog item")).toBeDisabled();
  await page
    .getByRole("button", { name: "Retry exact service request" })
    .click();
  await expect(
    page.getByText("Service completion recorded. No charge was created."),
  ).toBeVisible();
  expect(requests).toHaveLength(2);
  expect(records).toHaveLength(1);
});
