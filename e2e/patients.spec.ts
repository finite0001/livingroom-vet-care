import { createHash } from "node:crypto";
import { test, expect } from "@playwright/test";

const backend = "http://127.0.0.1:54321";
const staffId = "11111111-1111-4111-8111-111111111111";
const clientId = "33333333-3333-4333-8333-333333333333";
interface PatientRow {
  id: string;
  client_id: string;
  name: string;
  species: string;
  breed: string | null;
  dob: string | null;
  birth_date_precision: string;
  color: string | null;
  sex: string;
  neuter_status: string;
  microchip_id: string | null;
  archived_at: string | null;
  deceased_at: string | null;
  weight_lbs: number | null;
  version: number;
  allergies: null;
}

test("mobile household adds two patients, retains identity fields and dated weight units after reload", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const user = {
    id: staffId,
    aud: "authenticated",
    role: "authenticated",
    email: "synthetic@example.test",
    app_metadata: {},
    user_metadata: {},
    created_at: "2026-01-01T00:00:00Z",
  };
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const session = {
    access_token: `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ sub: staffId, exp: expires, role: "authenticated" })).toString("base64url")}.synthetic`,
    refresh_token: "synthetic",
    expires_at: expires,
    expires_in: 3600,
    token_type: "bearer",
    user,
  };
  const household = {
    id: clientId,
    first_name: "Synthetic",
    last_name: "Household",
    full_name: "Synthetic Household",
    primary_email: null,
    primary_phone: null,
    preferred_channel: "SMS",
    mailing_address: "Synthetic mailing address",
    housecall_address: "Synthetic housecall address",
    version: 1,
  };
  const pets: PatientRow[] = [];
  const weights: Array<{
    id: string;
    pet_id: string;
    weight: number;
    unit: string;
    measured_at: string;
    created_at: string;
    recorded_by: string;
  }> = [];
  let showImportedSource = false;
  await page.addInitScript(
    (value) => localStorage.setItem("sb-127-auth-token", JSON.stringify(value)),
    session,
  );
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin ===
    new URL(String(testInfo.project.use.baseURL)).origin
      ? route.continue()
      : route.abort(),
  );
  let failChart = false, tamperOriginal = false;
  const originalBytes = Buffer.from([255,216,255,1,2,3,4]);
  const originalSha = createHash("sha256").update(originalBytes).digest("hex");
  await page.route(`${backend}/**`, async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if(path === "/functions/v1/retrieve-reviewed-ezyvet-original") {
      const body=route.request().postDataJSON();
      expect(body.capture_hash).toBe("b".repeat(64));
      return route.fulfill({status:200,body:tamperOriginal?Buffer.from([255,216,255,9,2,3,4]):originalBytes,
        headers:{"Access-Control-Allow-Origin":"http://127.0.0.1:8080","Access-Control-Expose-Headers":"X-Capture-Hash, X-Content-SHA256, Content-Length, Content-Type","Content-Type":"image/jpeg","Content-Length":String(originalBytes.length),"X-Capture-Hash":"b".repeat(64),"X-Content-SHA256":originalSha}});
    }
    if (path === "/rest/v1/rpc/read_ezyvet_attachment_chart") {
      if (failChart) return route.fulfill({ status: 500, json: { message: "unavailable" } });
      const body = route.request().postDataJSON();
      const version = body.p_before_id ? 1 : 2;
      const record = { id: version === 2 ? staffId : clientId, actor_id: staffId, request_id: staffId,
        pet_id: body.p_pet_id, animal_link_id: clientId, source_origin: "https://api.trial.ezyvet.com",
        source_site_uid: "synthetic-site", attachment_external_id: "7", request_hash: "a".repeat(64),
        capture_hash: "b".repeat(64), title: "Reviewed API original", review_reason: "Source and patient verified",
        previous_record_id: version === 2 ? clientId : null, version, entry_method: "staff_reviewed_api_attachment_v2",
        record_hash: "c".repeat(64), created_at: `2026-09-14T12:00:0${version}Z` };
      return route.fulfill({ json: { pet_id: body.p_pet_id, records: [{ record, is_latest: version === 2, source_current: false }],
        has_more: version === 2, next_cursor: version === 2 ? { before_at: record.created_at, before_id: record.id } : null } });
    }
    if (path === "/auth/v1/token") return route.fulfill({ json: session });
    if (path === "/auth/v1/user") return route.fulfill({ json: user });
    if (path === "/rest/v1/profiles")
      return route.fulfill({
        json: [
          {
            id: staffId,
            first_name: "Synthetic",
            last_name: "Staff",
            full_name: "Synthetic Staff",
            role: "STAFF",
            is_active: true,
          },
        ],
      });
    if (path === "/rest/v1/user_roles")
      return route.fulfill({ json: [{ role: "STAFF" }] });
    if (path === "/rest/v1/clients")
      return route.fulfill({
        json: route.request().headers().accept?.includes("vnd.pgrst.object")
          ? household
          : [household],
      });
    if (path === "/rest/v1/pets") {
      if (url.searchParams.get("select") === "id,name")
        return route.fulfill({ json: [] });
      const id = url.searchParams.get("id")?.slice(3);
      const rows = id ? pets.filter((pet) => pet.id === id) : pets;
      return route.fulfill({
        json: route.request().headers().accept?.includes("vnd.pgrst.object")
          ? rows[0]
          : rows,
      });
    }
    if (path === "/rest/v1/rpc/save_patient") {
      const body = route.request().postDataJSON();
      expect(body.p_client_id).toBe(clientId);
      const row: PatientRow = {
        id: `22222222-2222-4222-8222-22222222222${pets.length}`,
        client_id: body.p_client_id,
        name: body.p_name,
        species: body.p_species,
        breed: body.p_breed,
        dob: body.p_dob,
        birth_date_precision: body.p_birth_date_precision,
        color: body.p_color,
        sex: body.p_sex,
        neuter_status: body.p_neuter_status,
        microchip_id: body.p_microchip_id,
        archived_at: body.p_archived_at,
        deceased_at: body.p_deceased_at,
        version: 1,
        weight_lbs: null,
        allergies: null,
      };
      pets.push(row);
      return route.fulfill({ json: row });
    }
    if (path === "/rest/v1/rpc/read_weight_import_provenance")
      return route.fulfill({
        json: showImportedSource
          ? [
              {
                weight_id: weights[0].id,
                source_record_id: "99",
                source_weight: "4.54",
                source_unit: "kg",
                source_timestamp: "1767258000",
                reviewed_at: "2026-09-12T16:00:00Z",
                reviewer_name: "Synthetic Reviewer",
                reviewed_measurement_date: "2026-01-01",
              },
            ]
          : [],
      });
    if (path === "/rest/v1/patient_weights")
      return route.fulfill({
        json: weights.filter(
          (row) => `eq.${row.pet_id}` === url.searchParams.get("pet_id"),
        ),
      });
    if (path === "/rest/v1/rpc/record_patient_weight") {
      const body = route.request().postDataJSON();
      const row = {
        id: `weight-${weights.length}`,
        pet_id: body.p_pet_id,
        weight: body.p_weight,
        unit: body.p_unit,
        measured_at: body.p_measured_at,
        recorded_by: staffId,
        created_at: "2026-09-12T16:00:00Z",
      };
      weights.unshift(row);
      return route.fulfill({ json: row });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto(`/hub/client/${clientId}`);
  for (const name of ["Juniper", "Maple"]) {
    await page
      .getByRole("button", { name: "Add patient", exact: true })
      .click();
    await page.getByLabel("Patient name", { exact: true }).fill(name);
    await page.getByLabel("Species", { exact: true }).fill("Dog");
    await page.getByLabel("Breed", { exact: true }).fill("Mixed breed");
    await page.getByLabel("Color / markings").fill("Black and white");
    await page.getByLabel("Birthdate certainty").selectOption("estimated");
    await page.getByLabel("Birthday", { exact: true }).fill("2020-09-12");
    await page.getByLabel("Sex", { exact: true }).selectOption("female");
    await page.getByLabel("Neuter status").selectOption("neutered");
    await page
      .getByLabel("Microchip", { exact: true })
      .fill(name === "Juniper" ? "000012345" : "000054321");
    await page
      .getByRole("button", { name: "Save patient", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(name === "Juniper" ? "000012345" : "000054321", {
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole("link", { name: "Synthetic Household", exact: true })
      .click();
  }
  await page.getByRole("tab", { name: "Patients", exact: true }).click();
  await expect(page.getByRole("link", { name: /Juniper.*Dog/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Maple.*Dog/ })).toBeVisible();
  await page.getByRole("link", { name: /Juniper.*Dog/ }).click();
  for (const [weight, unit, date] of [
    ["10", "lb", "2026-09-10"],
    ["5", "kg", "2026-09-11"],
  ]) {
    await page.getByLabel("Weight", { exact: true }).fill(weight);
    await page.getByLabel("Unit", { exact: true }).selectOption(unit);
    await page.getByLabel("Measured on").fill(date);
    await page
      .getByRole("button", { name: "Record weight", exact: true })
      .click();
    await expect(
      page.getByRole("cell", { name: `${weight} ${unit}`, exact: true }),
    ).toBeVisible();
  }
  showImportedSource = true;
  await page.reload();
  await expect(page.getByText("000012345", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "4.54 kg", exact: true }),
  ).toBeVisible();
  await page.getByText("Reviewed ezyVet history", { exact: true }).click();
  await expect(page.getByText(/Source record #99/)).toBeVisible();
  await expect(
    page.getByText(/Reviewer is not necessarily the source clinician/),
  ).toBeVisible();
  expect(pets).toHaveLength(2);
  expect(pets[0]).toMatchObject({
    dob: "2020-09-12",
    color: "Black and white",
    sex: "female",
    neuter_status: "neutered",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const reviewed = page.getByRole("region", { name: "Reviewed API attachments", exact: true });
  await expect(reviewed.getByText("Reviewed API original · Version 2")).toBeVisible();
  await expect(reviewed.getByText(/Latest saved approval/)).toBeVisible();
  await expect(reviewed.getByText("Source changed or is unavailable. Review required.")).toBeVisible();
  await reviewed.getByRole("button", { name: "Older reviewed attachments" }).click();
  await expect(reviewed.getByText(/Superseded approval/)).toBeVisible();
  await expect(reviewed.getByRole("button", { name: "Older reviewed attachments" })).toBeDisabled();
  failChart = true;
  await reviewed.getByRole("button", { name: "Recheck reviewed attachments" }).click();
  await expect(reviewed.getByRole("alert")).toBeVisible();
  await expect(reviewed.getByText(/Superseded approval/)).toHaveCount(0);
  failChart = false;
  await reviewed.getByRole("button", { name: "Newest reviewed attachments" }).click();
  await expect(reviewed.getByText(/Latest saved approval/)).toBeVisible();
  const download = page.waitForEvent("download");
  await reviewed.getByRole("button",{name:"Download verified original version 2"}).click();
  expect((await download).suggestedFilename()).toBe(`reviewed-original-${staffId}.jpg`);
  tamperOriginal = true;
  let unexpectedDownloads = 0;
  page.on("download",()=>{unexpectedDownloads++;});
  await reviewed.getByRole("button",{name:"Download verified original version 2"}).click();
  await expect(reviewed.getByText("The reviewed original could not be verified. No download is available.")).toBeVisible();
  expect(unexpectedDownloads).toBe(0);
  tamperOriginal = false;
  await page.screenshot({
    path: testInfo.outputPath("mobile-patient-record.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({width:1280,height:900});
  let release!:()=>void, started!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  const entered=new Promise<void>(resolve=>{started=resolve;});
  await page.route("**/functions/v1/retrieve-reviewed-ezyvet-original",async route=>{started();await gate;await route.fallback();});
  await reviewed.getByRole("button",{name:"Download verified original version 2"}).click();
  await entered;
  await page.getByRole("button",{name:"Sign Out",exact:true}).click();
  await expect(page).toHaveURL(/login/);
  const response=page.waitForResponse(r=>r.url().endsWith("retrieve-reviewed-ezyvet-original"));
  release();await(await response).finished();
  await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve())));
  expect(unexpectedDownloads).toBe(0);
});
