import { test, expect, type Page } from "@playwright/test";
const backend = "http://127.0.0.1:54321";
const actor = "11111111-1111-4111-8111-111111111111";
const pet = "22222222-2222-4222-8222-222222222222";
const client = "33333333-3333-4333-8333-333333333333";
interface Row {
  id: string;
  version: number;
  [key: string]: unknown;
}
interface Fixture {
  qol: Row | null;
  lesion: Row | null;
  observations: Record<string, unknown>[];
  staleQol: boolean;
  staleLesion: boolean;
}
async function fixture(page: Page) {
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
  const state: Fixture = {
    qol: null,
    lesion: null,
    observations: [],
    staleQol: false,
    staleLesion: false,
  };
  await page.route(`${backend}/**`, async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const single = route
      .request()
      .headers()
      .accept?.includes("vnd.pgrst.object");
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
    if (path === "/rest/v1/pets")
      return route.fulfill({
        json: [
          {
            id: pet,
            client_id: client,
            name: "Chart Juniper",
            species: "Dog",
            version: 1,
            birth_date_precision: "unknown",
            sex: "unknown",
            neuter_status: "unknown",
          },
        ],
      });
    if (path === "/rest/v1/clients")
      return route.fulfill({
        json: { id: client, full_name: "Synthetic Family" },
      });
    if (path === "/rest/v1/patient_qol_records")
      return route.fulfill({
        json: single ? state.qol : state.qol ? [state.qol] : [],
      });
    if (path === "/rest/v1/patient_lesions")
      return route.fulfill({
        json: single ? state.lesion : state.lesion ? [state.lesion] : [],
      });
    if (path === "/rest/v1/patient_lesion_observations")
      return route.fulfill({ json: [...state.observations].reverse() });
    if (path === "/rest/v1/rpc/save_patient_qol") {
      const b = route.request().postDataJSON();
      if (state.staleQol) {
        state.staleQol = false;
        state.qol = {
          ...state.qol!,
          version: state.qol!.version + 1,
          comfort: "Remote observation",
        };
        return route.fulfill({
          status: 409,
          json: {
            code: "40001",
            message: "Chart changed; reload before saving",
          },
        });
      }
      state.qol = {
        id: b.p_id,
        pet_id: pet,
        version: (state.qol?.version ?? 0) + 1,
        status: "draft",
        observed_at: b.p_observed_at,
        observer: b.p_observer,
        appetite: b.p_appetite,
        drinking: b.p_drinking,
        mobility: b.p_mobility,
        comfort: b.p_comfort,
        social_engagement: b.p_social_engagement,
        good_days: b.p_good_days,
        notes: b.p_notes,
      };
      return route.fulfill({ json: state.qol });
    }
    if (path === "/rest/v1/rpc/sign_patient_qol") {
      state.qol = {
        ...state.qol!,
        status: "signed",
        version: state.qol!.version + 1,
        signed_at: "2026-09-12T16:00:00Z",
      };
      return route.fulfill({ json: state.qol });
    }
    if (path === "/rest/v1/rpc/record_lesion_observation") {
      const b = route.request().postDataJSON();
      if (state.staleLesion) {
        state.staleLesion = false;
        state.lesion = {
          ...state.lesion!,
          version: state.lesion!.version + 1,
          x: 0.7,
          y: 0.6,
        };
        return route.fulfill({
          status: 409,
          json: {
            code: "40001",
            message: "Body map changed; reload before saving",
          },
        });
      }
      state.lesion = {
        id: b.p_lesion_id,
        pet_id: pet,
        label: b.p_label,
        body_view: b.p_body_view,
        x: b.p_x,
        y: b.p_y,
        version: (state.lesion?.version ?? 0) + 1,
      };
      const obs = {
        id: b.p_id,
        lesion_id: b.p_lesion_id,
        label: b.p_label,
        body_view: b.p_body_view,
        x: b.p_x,
        y: b.p_y,
        length_mm: b.p_length_mm,
        width_mm: b.p_width_mm,
        depth_mm: b.p_depth_mm,
        observed_at: b.p_observed_at,
        notes: b.p_notes,
        photo_document_id: null,
      };
      state.observations.push(obs);
      return route.fulfill({ json: obs });
    }
    return route.fulfill({ json: [] });
  });
  return state;
}
test("QOL draft reopens, retains stale edits, reloads and signs saved observations", async ({
  page,
}, testInfo) => {
  const state = await fixture(page);
  await page.goto(`/hub/patient/${pet}`);
  await page
    .getByRole("button", { name: "New QOL observation", exact: true })
    .click();
  await page.getByLabel("Observer / source").fill("Caregiver");
  await page.getByLabel("Comfort", { exact: true }).fill("Rested comfortably");
  await page.getByRole("button", { name: "Save QOL draft" }).click();
  await page.getByRole("button", { name: "Open QOL chart" }).click();
  await expect(page.getByLabel("Comfort", { exact: true })).toHaveValue(
    "Rested comfortably",
  );
  state.staleQol = true;
  await page
    .getByLabel("Comfort", { exact: true })
    .fill("Local draft retained");
  await page.getByRole("button", { name: "Save QOL draft" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Chart changed" }),
  ).toBeVisible();
  await expect(page.getByLabel("Comfort", { exact: true })).toHaveValue(
    "Local draft retained",
  );
  await page.getByRole("button", { name: "Reload latest chart" }).click();
  await expect(page.getByLabel("Comfort", { exact: true })).toHaveValue(
    "Remote observation",
  );
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Sign saved observations" }).click();
  await page.getByRole("button", { name: "Open QOL chart" }).click();
  await expect(page.getByLabel("Comfort", { exact: true })).toHaveAttribute(
    "readonly",
    "",
  );
  await expect(page.getByLabel("QOL correction / addendum")).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("qol.png"),
    fullPage: true,
  });
});
test("lesion schematic keyboard location persists across reopen and protects concurrent edits", async ({
  page,
}, testInfo) => {
  const state = await fixture(page);
  await page.goto(`/hub/patient/${pet}`);
  await page.getByRole("button", { name: "Add lesion", exact: true }).click();
  await page.getByLabel("Lesion label", { exact: true }).fill("Shoulder mass");
  await page.getByLabel("Length (mm, optional)").fill("10");
  await page
    .getByRole("button", {
      name: "Set lesion location on schematic; arrow keys move marker",
    })
    .focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByLabel("Horizontal coordinate (0–1)")).toHaveValue(
    "0.51",
  );
  await page.getByRole("button", { name: "Save lesion observation" }).click();
  const stableId = state.lesion!.id;
  await page
    .getByRole("button", { name: "Open Shoulder mass", exact: true })
    .click();
  await expect(page.getByLabel("Horizontal coordinate (0–1)")).toHaveValue(
    "0.51",
  );
  state.staleLesion = true;
  await page.getByLabel("Length (mm, optional)").fill("20");
  await page.getByRole("button", { name: "Save lesion observation" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Body map changed" }),
  ).toBeVisible();
  await expect(page.getByLabel("Length (mm, optional)")).toHaveValue("20");
  await page.getByRole("button", { name: "Reload latest body map" }).click();
  await expect(page.getByLabel("Horizontal coordinate (0–1)")).toHaveValue(
    "0.7",
  );
  await page.getByLabel("Length (mm, optional)").fill("12");
  await page.getByRole("button", { name: "Save lesion observation" }).click();
  expect(state.lesion!.id).toBe(stableId);
  expect(state.observations).toHaveLength(2);
  await expect(page.getByText(/length 10 mm/)).toBeVisible();
  await expect(page.getByText(/length 12 mm/)).toBeVisible();
  await page
    .getByRole("button", { name: "Open Shoulder mass", exact: true })
    .click();
  await page.screenshot({
    path: testInfo.outputPath("body-map.png"),
    fullPage: true,
  });
});
