import { test, expect, type Page } from "@playwright/test";
const backend = "http://127.0.0.1:54321";
const staff = "11111111-1111-4111-8111-111111111111";
const other = "11111111-1111-4111-8111-222222222222";
const household = "22222222-2222-4222-8222-222222222222";
const conversation = "33333333-3333-4333-8333-333333333333";
const message = "44444444-4444-4444-8444-444444444444";
interface RequestRecord {
  path: string;
  method: string;
  select: string | null;
}
async function fixture(page: Page, baseURL: string | undefined, actor = staff) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const user = {
    id: actor,
    aud: "authenticated",
    role: "authenticated",
    email: "synthetic@example.test",
    app_metadata: {},
    user_metadata: {},
    created_at: "2026-01-01T00:00:00Z",
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
    (value) => localStorage.setItem("sb-127-auth-token", JSON.stringify(value)),
    session,
  );
  const state = {
    fail: false,
    hold: null as Promise<void> | null,
    requests: [] as RequestRecord[],
  };
  const row = {
    conversation_id: conversation,
    client_id: household,
    client_name: "Synthetic Household",
    primary_phone: null,
    primary_email: "synthetic@example.test",
    updated_at: "2026-09-12T18:00:00Z",
    status: "ACTIVE",
    assigned_to_id: null,
    priority: "NORMAL",
    tags: [],
    revision: 1,
    latest_message_id: message,
    latest_content: "Question for the practice",
    latest_type: "EMAIL",
    unread_count: actor === staff ? 1 : 0,
    is_unread: actor === staff,
  };
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin ===
    new URL(baseURL ?? "http://127.0.0.1:8080").origin
      ? route.continue()
      : route.abort(),
  );
  await page.route(`${backend}/**`, async (route) => {
    const url = new URL(route.request().url()),
      path = url.pathname,
      method = route.request().method();
    state.requests.push({
      path,
      method,
      select: url.searchParams.get("select"),
    });
    if (path === "/auth/v1/token") return route.fulfill({ json: session });
    if (path === "/auth/v1/user") return route.fulfill({ json: user });
    if (path === "/rest/v1/profiles")
      return route.fulfill({
        json: [
          {
            id: actor,
            first_name: actor === staff ? "First" : "Other",
            last_name: "Staff",
            full_name: "Synthetic Staff",
            role: "ADMIN",
            is_active: true,
            email_signature: "",
          },
        ],
      });
    if (path === "/rest/v1/user_roles")
      return route.fulfill({ json: [{ user_id: actor, role: "ADMIN" }] });
    const homeRead =
      [
        "/rest/v1/rpc/inbox_unread_totals",
        "/rest/v1/rpc/list_inbox_workspace",
        "/rest/v1/rpc/list_native_refills",
        "/rest/v1/appointments",
      ].includes(path) ||
      (method === "HEAD" &&
        ["/rest/v1/conversations", "/rest/v1/tickets", "/rest/v1/appointments", "/rest/v1/clinical_encounters", "/rest/v1/patient_vaccine_due_plans", "/rest/v1/patient_lab_orders", "/rest/v1/communication_outbox"].includes(path));
    if (homeRead && state.hold) await state.hold;
    if (homeRead && state.fail)
      return method === "HEAD"
        ? route.fulfill({ status: 403, body: "" })
        : route.fulfill({
            status: 403,
            json: { code: "42501", message: "Synthetic read unavailable" },
          });
    if (path === "/rest/v1/rpc/inbox_unread_totals")
      return route.fulfill({
        json: [
          {
            unread_conversations: actor === staff ? 7 : 2,
            unread_messages: 99,
          },
        ],
      });
    if (path === "/rest/v1/rpc/list_inbox_workspace")
      return route.fulfill({ json: [row] });
    if (path === "/rest/v1/rpc/list_native_refills")
      return route.fulfill({ json: { version: 1, refills: [], has_more: false, next_cursor: null } });
    // Today-screen read counts (HEAD selects with content-range).
    if (
      method === "HEAD" &&
      ["/rest/v1/appointments", "/rest/v1/clinical_encounters", "/rest/v1/patient_vaccine_due_plans", "/rest/v1/patient_lab_orders", "/rest/v1/communication_outbox"].includes(path)
    )
      return route.fulfill({
        status: 200,
        body: "",
        headers: {
          "access-control-expose-headers": "content-range",
          "content-range": "0-0/0",
        },
      });
    if (
      method === "HEAD" &&
      ["/rest/v1/conversations", "/rest/v1/tickets"].includes(path)
    )
      return route.fulfill({
        status: 200,
        body: "",
        headers: {
          "access-control-expose-headers": "content-range",
          "content-range": path.endsWith("tickets") ? "0-2/3" : "0-4/5",
        },
      });
    if (path === "/rest/v1/conversations")
      return route.fulfill({
        json: {
          id: conversation,
          client_id: household,
          status: "ACTIVE",
          is_read: true,
          revision: 1,
          last_message_at: row.updated_at,
          priority: "NORMAL",
          tags: [],
        },
      });
    if (path === "/rest/v1/clients")
      return route.fulfill({
        json: {
          id: household,
          full_name: "Synthetic Household",
          primary_email: "synthetic@example.test",
          primary_phone: null,
          preferred_channel: "EMAIL",
        },
      });
    if (path === "/rest/v1/messages")
      return route.fulfill({
        json: [
          {
            id: message,
            conversation_id: conversation,
            sender_type: "CLIENT",
            content: row.latest_content,
            type: "EMAIL",
            is_internal: false,
            created_at: row.updated_at,
          },
        ],
      });
    if (
      path === "/rest/v1/conversation_read_cursors" ||
      path === "/rest/v1/conversation_unread_flags"
    )
      return route.fulfill({ json: null });
    if (path === "/rest/v1/rpc/read_communication_draft")
      return route.fulfill({ json: null });
    return route.fulfill({ json: [] });
  });
  return state;
}
const unavailable = [
  ["/hub/tools/campaigns", "Campaigns"],
  ["/hub/tools/alerts", "Broadcast messages"],
  ["/hub/tools/surveys", "Surveys"],
  ["/hub/call", "Voice calling"],
  ["/hub/voicemails", "Voicemail"],
  ["/hub/admin/import", "Legacy CSV import"],
];
test("optional direct routes stay read-only and never mount their legacy data hooks", async ({
  page,
  baseURL,
}) => {
  const state = await fixture(page, baseURL);
  for (const [path, name] of unavailable) {
    await page.goto(path);
    await expect(
      page.getByRole("heading", { name: `${name} — unavailable`, exact: true }),
    ).toBeVisible();
    await expect(page.locator("main").getByRole("button")).toHaveCount(0);
    if (path.endsWith("alerts"))
      await expect(
        page.getByText(/Clinical alerts remain available/),
      ).toBeVisible();
  }
  expect(
    state.requests.filter((r) =>
      /campaign|survey|voicemail|call_log|alerts|functions\/v1/.test(r.path),
    ),
  ).toEqual([]);
  expect(
    state.requests
      .filter(
        (r) =>
          !["GET", "HEAD"].includes(r.method) && r.path.startsWith("/rest/v1/"),
      )
      .every((r) => r.path === "/rest/v1/rpc/inbox_unread_totals"),
  ).toBe(true);
});

test("desktop home exposes today counts, implemented tools and personal unread state, never shared is_read", async ({
  page,
  baseURL,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const state = await fixture(page, baseURL);
  await page.goto("/hub");
  await expect(
    page.getByRole("region", {
      name: "Unread conversations for you",
      exact: true,
    }),
  ).toContainText("7");
  for (const name of [
    "Phone",
    "Voicemails",
    "Campaigns",
    "Surveys",
    "Alerts",
    "Import",
  ])
    await expect(page.getByRole("button", { name, exact: true })).toHaveCount(
      0,
    );
  for (const name of ["Messages", "Schedule", "Care reminders", "Templates"])
    await expect(
      page.locator("main").getByRole("link", { name, exact: true }),
    ).toBeVisible();
  expect(
    state.requests
      .filter((r) => r.path === "/rest/v1/conversations")
      .every((r) => r.method === "HEAD" && !r.select?.includes("is_read")),
  ).toBe(true);
  expect(state.requests.some((r) => r.path.includes("get_last_messages"))).toBe(
    false,
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("home-1440.png"), animations: "disabled" });
});

test("another staff session sees its own unread total", async ({
  page,
  baseURL,
}) => {
  await fixture(page, baseURL, other);
  await page.goto("/hub");
  await expect(
    page.getByRole("region", {
      name: "Unread conversations for you",
      exact: true,
    }),
  ).toContainText("2");
});

test("home distinguishes loading and failed reads from zero and supports retry", async ({
  page,
  baseURL,
}) => {
  const state = await fixture(page, baseURL);
  let release!: () => void;
  state.hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  state.fail = true;
  await page.goto("/hub");
  await expect(
    page.getByRole("region", {
      name: "Unread conversations for you",
      exact: true,
    }),
  ).toContainText("Loading…");
  release();
  state.hold = null;
  for (const label of [
    "Unread conversations for you",
    "Open refill requests",
    "Reminders due",
    "Unsigned notes",
    "Outbox failures",
  ])
    await expect(
      page.getByRole("region", { name: label, exact: true }),
    ).toContainText("Unavailable", { timeout: 15000 });
  await expect(page.getByRole("region", { name: "Right now" })).toContainText("unavailable");
  await expect(page.getByRole("region", { name: "The rest of your day" })).toContainText("unavailable");
  state.fail = false;
  for (const label of [
    "Unread conversations for you",
    "Open refill requests",
    "Reminders due",
    "Unsigned notes",
    "Outbox failures",
  ])
    await page
      .getByRole("button", { name: `Retry ${label.toLowerCase()}`, exact: true })
      .click();
  await page.getByRole("region", { name: "Right now" }).getByRole("button", { name: "Retry" }).click();
  await expect(
    page.getByRole("region", {
      name: "Unread conversations for you",
      exact: true,
    }),
  ).toContainText("7");
});

test("mobile navigation keeps schedule and care reminders while hiding unavailable tools", async ({
  page,
  baseURL,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await fixture(page, baseURL);
  await page.goto("/hub");
  await expect(
    page.getByRole("region", {
      name: "Unread conversations for you",
      exact: true,
    }),
  ).toContainText("7");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("home-390.png"), animations: "disabled" });
  await page.getByRole("button", { name: "More", exact: true }).click();
  for (const name of [
    "Call",
    "Phone",
    "Voicemails",
    "Campaigns",
    "Surveys",
    "Alerts",
    "Import Clients",
    "ezyVet imports",
  ])
    await expect(page.getByRole("button", { name, exact: true })).toHaveCount(
      0,
    );
  await page
    .getByRole("button", { name: "Care reminders", exact: true })
    .click();
  await expect(page).toHaveURL(/\/hub\/tools\/care-reminders$/);
  await expect(
    page.getByRole("heading", {
      name: "Care due dates and reminders",
      exact: true,
    }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(state.requests.filter((r) => /voicemail/.test(r.path))).toEqual([]);
});

test("settings routes wellness review to implemented Care reminders without legacy toggle writes", async ({
  page,
  baseURL,
}) => {
  const state = await fixture(page, baseURL);
  await page.goto("/hub/settings");
  await expect(
    page.getByRole("switch", {
      name: "Enable wellness reminders",
      exact: true,
    }),
  ).toHaveCount(0);
  await page
    .getByRole("link", { name: "Open Care reminders", exact: true })
    .click();
  await expect(page).toHaveURL(/\/hub\/tools\/care-reminders$/);
  expect(
    state.requests.filter(
      (r) => r.path.endsWith("app_settings") && r.method !== "GET",
    ),
  ).toEqual([]);
});

test("manual conversation composer remains available without AI suggestion controls", async ({
  page,
  baseURL,
}) => {
  const state = await fixture(page, baseURL);
  await page.goto(`/hub/conversation/${conversation}`);
  await expect(
    page.getByText("Question for the practice", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Refresh suggestions", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Click to generate suggestions", { exact: true }),
  ).toHaveCount(0);
  await expect(page.locator("main textarea")).toBeVisible();
  expect(
    state.requests.filter((r) => r.path.includes("suggest-replies")),
  ).toEqual([]);
});
