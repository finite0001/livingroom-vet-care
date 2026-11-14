import { test, expect, type Page } from "@playwright/test";
const backend = "http://127.0.0.1:54321",
  actor = "11111111-1111-4111-8111-111111111111",
  pet = "22222222-2222-4222-8222-222222222222";
const now = "2026-11-14T12:00:00Z";
async function fixture(page: Page) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const user = {
    id: actor,
    aud: "authenticated",
    role: "authenticated",
    email: "synthetic@example.test",
    app_metadata: {},
    user_metadata: {},
    created_at: now,
  };
  const session = {
    access_token: `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ sub: actor, exp, role: "authenticated", aud: "authenticated" })).toString("base64url")}.synthetic`,
    refresh_token: "synthetic",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: exp,
    user,
  };
  await page.addInitScript(
    (s) => localStorage.setItem("sb-127-auth-token", JSON.stringify(s)),
    session,
  );
  const staff = [{ id: actor, name: "Synthetic Susan" }];
  const workforce = {
    can_manage: true,
    job_active: false,
    can_pay: true,
    can_assign: true,
    staff,
    access: [],
    settings: {
      singleton: true,
      version: 1,
      workweek_start: null,
      weekly_hours: null,
      daily_hours: null,
      auto_close_hours: null,
      late_grace_minutes: null,
      payroll_provider: null,
      updated_at: now,
    },
    policies: [],
    balances: [{ staff_id: actor, kind: "PTO", hours: 16 }],
    requests: [] as Record<string, unknown>[],
    off: [] as Record<string, unknown>[],
    shifts: [],
    holidays: [],
    periods: [],
    approvals: [],
    corrections: [],
    flags: [],
    entries: [],
  };
  const team = {
    can_manage: true,
    staff,
    posts: [],
    tasks: [],
    events: [] as Record<string, unknown>[],
    my_milestones: null,
    milestones: [],
    rotations: [],
  };
  const clinical = {
    can_review: true,
    protocols: [],
    patient: { id: pet, name: "Synthetic Juniper", species: "Dog" },
    encounters: [],
    labs: [],
    calculations: [],
    helpers: [],
    pill_references: [],
  };
  const state = {
    fail: false,
    loseNextCreate: false,
    requestIds: [] as string[],
  };
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin ===
    new URL(test.info().project.use.baseURL as string).origin
      ? route.continue()
      : route.abort(),
  );
  await page.route(`${backend}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/auth/v1/user") return route.fulfill({ json: user });
    if (path === "/auth/v1/token") return route.fulfill({ json: session });
    if (path === "/rest/v1/profiles")
      return route.fulfill({
        json: [
          {
            id: actor,
            first_name: "Synthetic",
            last_name: "Susan",
            full_name: "Synthetic Susan",
            role: "ADMIN",
            is_active: true,
          },
        ],
      });
    if (path === "/rest/v1/user_roles")
      return route.fulfill({ json: [{ role: "ADMIN" }, { role: "DVM" }] });
    if (path.endsWith("/workforce_read"))
      return state.fail
        ? route.fulfill({
            status: 503,
            json: { message: "Synthetic workforce read failed" },
          })
        : route.fulfill({ json: workforce });
    if (path.endsWith("/team_read")) return route.fulfill({ json: team });
    if (path.endsWith("/clinical_tools_read"))
      return route.fulfill({ json: clinical });
    if (path.endsWith("/workforce_command")) {
      const body = route.request().postDataJSON();
      if (
        body.p_action === "request_leave" &&
        !workforce.requests.some((r) => r.id === body.p_id)
      )
        workforce.requests.push({
          id: body.p_id,
          staff_id: actor,
          status: "PENDING",
          version: 1,
          ...body.p_data,
        });
      if (body.p_action === "decide_leave") {
        const row = workforce.requests.find((r) => r.id === body.p_id)!;
        row.status = body.p_data.decision;
        row.version = 2;
        if (row.status === "APPROVED")
          workforce.off.push({
            id: row.id,
            staff_id: actor,
            starts_on: row.starts_on,
            ends_on: row.ends_on,
          });
      }
      if (body.p_action === "request_leave") {
        state.requestIds.push(body.p_id);
        if (state.loseNextCreate) {
          state.loseNextCreate = false;
          return route.abort("connectionreset");
        }
      }
      return route.fulfill({ json: { id: body.p_id, action: body.p_action } });
    }
    if (path.endsWith("/team_command")) {
      const body = route.request().postDataJSON();
      if (body.p_action === "event")
        team.events.push({
          id: body.p_id,
          ...body.p_data,
          created_by: actor,
          cancelled: false,
          version: 1,
          my_answer: null,
          going: 0,
          waiting: 0,
        });
      if (body.p_action === "rsvp") {
        const event = team.events.find((e) => e.id === body.p_id)!;
        event.my_answer = body.p_data.answer;
        event.going = 1;
      }
      return route.fulfill({ json: { id: body.p_id, action: body.p_action } });
    }
    if (path.endsWith("/inbox_unread_totals"))
      return route.fulfill({
        json: [{ unread_conversations: 0, unread_messages: 0 }],
      });
    return route.fulfill({ json: [] });
  });
  return state;
}
for (const width of [390, 768, 1280, 1920]) {
  test(`time/PTO request and approval remain usable at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await fixture(page);
    await page.goto("/hub/team/time-off");
    await expect(
      page.getByRole("heading", { name: "Time & leave", exact: true }),
    ).toBeVisible();
    await page.getByLabel("Leave type", { exact: true }).selectOption("PTO");
    await page.getByLabel("First day", { exact: true }).fill("2026-11-20");
    await page.getByLabel("Last day", { exact: true }).fill("2026-11-20");
    await page.getByLabel("Total hours requested").fill("8");
    await page
      .getByLabel("Private note to approvers")
      .fill("Synthetic appointment");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      page.getByText("Synthetic appointment", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(page.getByText("APPROVED", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Who's off & shifts" }).click();
    await expect(
      page.getByText("Synthetic Susan · 2026-11-20 – 2026-11-20", {
        exact: true,
      }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: test.info().outputPath(`staff-time-${width}.png`),
      fullPage: true,
    });
  });
}
test("party creation and RSVP use the staff event workflow", async ({
  page,
}) => {
  await fixture(page);
  await page.goto("/hub/team");
  await page.getByRole("button", { name: "Events & parties" }).click();
  await page
    .getByLabel("Event name", { exact: true })
    .fill("Synthetic team party");
  await page
    .getByLabel("Starts (Denver)", { exact: true })
    .fill("2099-12-01T18:00");
  await page
    .getByLabel("RSVP deadline (Denver)", { exact: true })
    .fill("2099-11-30T18:00");
  await page.getByLabel("Available places").fill("1");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Synthetic team party", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Attend / join waitlist" }).click();
  await expect(page.getByText(/Your response: YES/)).toBeVisible();
});
test("clinical worksheet preserves patient context and confirms navigation away from unsaved results", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await fixture(page);
  await page.goto(`/hub/tools/clinical?pet=${pet}`);
  await expect(
    page.getByText("Synthetic Juniper", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Species", { exact: true }).selectOption("dog");
  await page.getByLabel("Confirmed current weight").fill("10");
  await page.getByLabel("Weight unit").selectOption("kg");
  await page.getByLabel("Estimated dehydration (%)").fill("5");
  await page.getByRole("button", { name: "Calculate worksheet" }).click();
  await expect(
    page.getByRole("heading", { name: "Worksheet result" }),
  ).toBeVisible();
  await page
    .getByRole("navigation", { name: "Hub navigation" })
    .getByRole("button", { name: "Our team", exact: true })
    .click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.getByRole("button", { name: "Keep editing" }).click();
  await expect(page).toHaveURL(/\/hub\/tools\/clinical/);
  await page.screenshot({
    path: test.info().outputPath("clinical-worksheet.png"),
    fullPage: true,
  });
});
test("failed workforce reads remain errors and do not show fabricated balances", async ({
  page,
}) => {
  const state = await fixture(page);
  state.fail = true;
  await page.goto("/hub/team/time-off");
  await expect(
    page.getByText("Synthetic workforce read failed", { exact: true }),
  ).toBeVisible({ timeout: 30000 });
  await expect(
    page.getByRole("button", { name: "Retry", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("0 hours", { exact: true })).toHaveCount(0);
});

test("an unconfirmed leave save retries the same request without a duplicate", async ({
  page,
}) => {
  const state = await fixture(page);
  state.loseNextCreate = true;
  await page.goto("/hub/team/time-off");
  await page.getByLabel("Leave type", { exact: true }).selectOption("PTO");
  await page.getByLabel("First day", { exact: true }).fill("2026-11-20");
  await page.getByLabel("Last day", { exact: true }).fill("2026-11-20");
  await page.getByLabel("Total hours requested").fill("8");
  await page.getByLabel("Private note to approvers").fill("Synthetic retry");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Synthetic retry", { exact: true })).toHaveCount(
    1,
  );
  expect(state.requestIds).toHaveLength(2);
  expect(state.requestIds[0]).toBe(state.requestIds[1]);
});
