import { test, expect, type Page } from "@playwright/test";
const backend = "http://127.0.0.1:54321";
const actor = "11111111-1111-4111-8111-111111111111";
const pet = "22222222-2222-4222-8222-222222222222";
const client = "33333333-3333-4333-8333-333333333333";
const categories = [
  ["hurt", "Hurt"],
  ["hunger", "Hunger"],
  ["hydration", "Hydration"],
  ["hygiene", "Hygiene"],
  ["happiness", "Happiness"],
  ["mobility", "Mobility"],
  ["more_good_days", "More good days than bad"],
] as const;
type Row = Record<string, unknown> & { id: string; version: number };
interface Fixture {
  assessments: Row[];
  addenda: Record<string, unknown>[];
  reference: Record<string, unknown>;
  saves: Record<string, unknown>[];
}
async function fixture(
  page: Page,
  options: { admin?: boolean; reference?: Record<string, unknown> } = {},
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
  const state: Fixture = {
    assessments: [],
    addenda: [],
    saves: [],
    reference: {
      id: "00000000-0000-4000-8000-000000000070",
      enabled: false,
      reference_total: null,
      reference_label: "",
      review_note: "",
      version: 1,
      updated_by: null,
      updated_at: "2026-09-28T00:00:00Z",
      ...options.reference,
    },
  };
  const total = (r: Record<string, unknown>) =>
    categories.some(([k]) => r[k] === null)
      ? null
      : categories.reduce((sum, [k]) => sum + Number(r[k]), 0);
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
            role: options.admin ? "ADMIN" : "STAFF",
            is_active: true,
          },
        ],
      });
    if (path === "/rest/v1/user_roles")
      return route.fulfill({
        json: [{ role: options.admin ? "ADMIN" : "STAFF" }],
      });
    if (path === "/rest/v1/pets")
      return route.fulfill({
        json: [
          {
            id: pet,
            client_id: client,
            name: "Scale Juniper",
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
    if (path === "/rest/v1/qol_scale_reference_settings")
      return route.fulfill({ json: single ? state.reference : [state.reference] });
    if (path === "/rest/v1/patient_qol_scale_addenda")
      return route.fulfill({ json: state.addenda });
    if (path === "/rest/v1/patient_qol_scale_assessments") {
      const id = url.searchParams.get("id")?.replace("eq.", "");
      const signedOnly = url.searchParams.get("status") === "eq.signed";
      const rows = [...state.assessments]
        .filter((r) => !signedOnly || r.status === "signed")
        .filter((r) => !id || r.id === id)
        .sort((a, b) =>
          String(b.assessed_at).localeCompare(String(a.assessed_at)),
        );
      return route.fulfill({ json: single ? rows[0] : rows });
    }
    if (path === "/rest/v1/rpc/save_patient_qol_scale") {
      const b = route.request().postDataJSON();
      state.saves.push(b);
      const existing = state.assessments.find((r) => r.id === b.p_id);
      const next: Row = {
        id: b.p_id,
        pet_id: pet,
        scale_version: "hhhhhmm-villalobos",
        version: (existing?.version ?? 0) + 1,
        status: "draft",
        assessed_at: b.p_assessed_at,
        assessor: b.p_assessor,
        notes: b.p_notes,
        signed_at: null,
      };
      for (const [k] of categories) {
        next[k] = b[`p_${k}`];
        next[`${k}_note`] = b[`p_${k}_note`];
      }
      next.total = total(next);
      state.assessments = [
        ...state.assessments.filter((r) => r.id !== b.p_id),
        next,
      ];
      return route.fulfill({ json: next });
    }
    if (path === "/rest/v1/rpc/sign_patient_qol_scale") {
      const b = route.request().postDataJSON();
      const r = state.assessments.find((x) => x.id === b.p_id)!;
      Object.assign(r, {
        status: "signed",
        version: r.version + 1,
        signed_at: "2026-09-28T16:00:00Z",
      });
      return route.fulfill({ json: r });
    }
    if (path === "/rest/v1/rpc/add_patient_qol_scale_addendum") {
      const b = route.request().postDataJSON();
      const a = {
        id: b.p_id,
        assessment_id: b.p_assessment_id,
        content: b.p_content,
        created_at: "2026-09-28T17:00:00Z",
      };
      state.addenda.push(a);
      return route.fulfill({ json: a });
    }
    return route.fulfill({ json: [] });
  });
  return state;
}
test("HHHHHMM assessment totals live, signs, locks, trends and takes addenda", async ({
  page,
}, testInfo) => {
  const state = await fixture(page);
  await page.goto(`/hub/patient/${pet}?tab=medical`);
  // First paint waits for the cold dev-server module graph, like the sibling care-chart spec's first click.
  await expect(
    page.getByText("HHHHHMM quality-of-life scale", { exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/No signed, fully scored assessments yet/)).toBeVisible();
  await page
    .getByRole("button", { name: "New HHHHHMM assessment", exact: true })
    .click();
  await page.getByLabel("Assessor", { exact: true }).fill("Dr. Synthetic");
  await page.getByLabel("Hurt score (0–10)").selectOption("5");
  await page.getByLabel("Hunger score (0–10)").selectOption("7");
  await expect(page.getByTestId("qol-total")).toHaveText(
    "Total: not available until all 7 categories are scored (2 of 7 scored)",
  );
  await page.getByRole("button", { name: "Save HHHHHMM draft" }).click();
  expect(state.saves[0]).toMatchObject({ p_hurt: 5, p_hunger: 7, p_hydration: null });
  await page.getByRole("button", { name: "Open assessment draft" }).click();
  await expect(
    page.getByRole("button", { name: "Sign saved assessment" }),
  ).toBeDisabled();
  await expect(page.getByText(/Not yet scored: Hydration, Hygiene/)).toBeVisible();
  const scores = [5, 7, 6, 8, 4, 3, 2];
  for (const [i, [, label]] of categories.entries())
    await page.getByLabel(`${label} score (0–10)`).selectOption(String(scores[i]));
  await page.getByLabel("Mobility note (optional)").fill("Slow on stairs");
  await expect(page.getByTestId("qol-total")).toHaveText("Total: 35 / 70");
  await expect(
    page.getByRole("button", { name: "Sign saved assessment" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Save HHHHHMM draft" }).click();
  await page.getByRole("button", { name: "Open assessment draft" }).click();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Sign saved assessment" }).click();
  await expect(page.getByText(/total 35 \/ 70 · signed/)).toBeVisible();
  await expect(page.getByRole("img", { name: /Total score over 1 signed assessment; latest 35 of 70/ })).toBeVisible();
  await expect(page.getByTestId("qol-reference-notice")).toHaveCount(0);
  await expect(page.getByTestId("qol-reference-line")).toHaveCount(0);
  await page.getByLabel("Trend series").selectOption("mobility");
  await expect(page.getByRole("img", { name: /Mobility over 1 signed assessment; latest 3 of 10/ })).toBeVisible();
  await page.getByRole("button", { name: "View signed assessment" }).click();
  await expect(page.getByText("Signed HHHHHMM assessment (read-only)")).toBeVisible();
  await expect(page.getByLabel("Hurt score (0–10)")).toBeDisabled();
  await expect(page.getByLabel("Mobility note (optional)")).toHaveAttribute("readonly", "");
  await expect(page.getByRole("button", { name: "Save HHHHHMM draft" })).toHaveCount(0);
  await page.getByLabel("HHHHHMM correction / addendum").fill("Mobility note: back steps");
  await page.getByRole("button", { name: "Append HHHHHMM addendum" }).click();
  await expect(page.getByText(/Mobility note: back steps/)).toBeVisible();
  await page.getByLabel("Trend series").selectOption("total");
  await page.getByRole("button", { name: "Close assessment" }).click();
  await page
    .getByRole("region", { name: "Trend" })
    .screenshot({ path: testInfo.outputPath("qol-scale-trend.png") });
});
test("reference line appears only when configured and is labelled pending clinical review", async ({
  page,
}) => {
  const state = await fixture(page, {
    admin: true,
    reference: {
      enabled: true,
      reference_total: 30,
      reference_label: "Synthetic configured wording",
      review_note: "Synthetic review note",
    },
  });
  for (const [id, when, n] of [
    ["a", "2026-09-01T16:00:00Z", 4],
    ["b", "2026-09-15T16:00:00Z", 5],
  ] as const) {
    const r: Row = { id, version: 2, pet_id: pet, status: "signed", assessed_at: when, assessor: "Dr. Synthetic", notes: "", signed_at: when, total: n * 7 };
    for (const [k] of categories) {
      r[k] = n;
      r[`${k}_note`] = "";
    }
    state.assessments.push(r);
  }
  await page.goto(`/hub/patient/${pet}?tab=medical`);
  await expect(
    page.getByText("HHHHHMM quality-of-life scale", { exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("qol-reference-notice")).toContainText(
    "Practice-configured reference line at total 30: Synthetic configured wording",
  );
  await expect(page.getByTestId("qol-reference-notice")).toContainText(
    "pending Dr. Susan Edler’s clinical review",
  );
  await expect(page.getByTestId("qol-reference-line")).toHaveCount(1);
  await expect(page.getByText(/latest 35 \/ 70 \(\+7 since the previous signed assessment\)/)).toBeVisible();
  await expect(page.getByRole("table", { name: /Per-category history/ })).toContainText("35");
  await expect(
    page.getByText("Practice reference line (administrators)"),
  ).toBeVisible();
  await page.getByLabel("Trend series").selectOption("hurt");
  await expect(page.getByTestId("qol-reference-line")).toHaveCount(0);
});
