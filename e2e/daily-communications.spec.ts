import { test, expect, type Page } from "@playwright/test";
const backend = "http://127.0.0.1:54321";
const staffId = "11111111-1111-4111-8111-111111111111",
  clientId = "33333333-3333-4333-8333-333333333333",
  conversationId = "44444444-4444-4444-8444-444444444444";
const stamp = "2026-10-09T18:00:00Z";
const row = {
  source: "outbox",
  id: "55555555-5555-4555-8555-555555555555",
  activity_at: stamp,
  created_at: stamp,
  updated_at: stamp,
  channel: "EMAIL",
  status: "accepted",
  summary: "Staff message",
  client_id: clientId,
  client_name: "Synthetic family",
  pet_id: null,
  patient_name: null,
  conversation_id: conversationId,
  recipient: "synthetic@example.test",
  attempt_count: 2,
  accepted_at: stamp,
  delivered_at: null,
  reason: null,
  source_href: `/hub/conversation/${conversationId}`,
};
async function setup(page: Page, admin = false) {
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const user = {
    id: staffId,
    aud: "authenticated",
    role: "authenticated",
    email: "staff@example.test",
    app_metadata: {},
    user_metadata: {},
    created_at: stamp,
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
  await page.route(`${backend}/**`, (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/auth/v1/user") return route.fulfill({ json: user });
    if (path === "/auth/v1/token") return route.fulfill({ json: value });
    if (path === "/rest/v1/profiles")
      return route.fulfill({
        json: [{ id: staffId, full_name: "Synthetic staff", is_active: true }],
      });
    if (path === "/rest/v1/user_roles")
      return route.fulfill({ json: [{ role: admin ? "ADMIN" : "STAFF" }] });
    return route.fulfill({ json: [] });
  });
}
test("mobile daily filters, pagination and attempt history keep acceptance distinct", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  const queries: Record<string, unknown>[] = [];
  const second = {
    ...row,
    id: "66666666-6666-4666-8666-666666666666",
    status: "uncertain",
    client_name: "Synthetic second family",
    reason: "Delivery is unconfirmed; do not resend without reconciliation",
  };
  await page.route(
    `${backend}/rest/v1/rpc/list_daily_communications`,
    (route) => {
      const query = route.request().postDataJSON();
      queries.push(query);
      return route.fulfill({
        json: {
          read_at: stamp,
          rows: query.p_before ? [second] : [row],
          next: query.p_before
            ? null
            : { activity_at: stamp, source: row.source, id: row.id },
        },
      });
    },
  );
  await page.route(`${backend}/rest/v1/rpc/read_daily_communication`, (route) =>
    route.fulfill({
      json: {
        record: row,
        attempts: [
          {
            attempt_number: 1,
            started_at: stamp,
            finished_at: stamp,
            outcome: "failed",
          },
          {
            attempt_number: 2,
            started_at: stamp,
            finished_at: stamp,
            outcome: "accepted",
          },
        ],
      },
    }),
  );
  await page.goto("/hub/deliveries");
  await expect(
    page.getByRole("heading", { name: "Daily communications", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByText("Provider accepted · delivery unconfirmed", { exact: true })
      .last(),
  ).toBeVisible();
  expect(queries[0].p_from).toEqual(queries[0].p_to);
  expect(queries[0].p_channel).toBeNull();
  await page.getByLabel("From (Denver date)").fill("2026-10-01");
  await page.getByLabel("Through (Denver date)").fill("2026-10-09");
  await page.getByLabel("Channel", { exact: true }).selectOption("EMAIL");
  await page.getByLabel("Client or patient name").fill("Synthetic");
  await page
    .getByRole("button", { name: "Apply filters", exact: true })
    .click();
  await expect.poll(() => queries.at(-1)?.p_search).toBe("Synthetic");
  await page
    .getByRole("button", { name: "Load more communications", exact: true })
    .click();
  await expect(
    page.getByText("Synthetic second family", { exact: true }),
  ).toBeVisible();
  expect(queries.at(-1)).toMatchObject({
    p_from: "2026-10-01",
    p_to: "2026-10-09",
    p_channel: "EMAIL",
    p_search: "Synthetic",
    p_before: { activity_at: stamp, source: "outbox", id: row.id },
  });
  await page
    .getByRole("button", { name: "Status and attempts", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("region", { name: "Communication history" }),
  ).toBeVisible();
  await expect(page.getByText(/Attempt 2/)).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Review retry", exact: true }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("daily-communications-mobile.png"),
  });
});
test("admin retry links use the existing review, uncertain sends have no resend control", async ({
  page,
}) => {
  await setup(page, true);
  const failed = { ...row, status: "failed", accepted_at: null };
  const uncertain = {
    ...row,
    id: "66666666-6666-4666-8666-666666666666",
    status: "uncertain",
  };
  await page.route(
    `${backend}/rest/v1/rpc/list_daily_communications`,
    (route) =>
      route.fulfill({
        json: { read_at: stamp, rows: [failed, uncertain], next: null },
      }),
  );
  await page.goto("/hub/deliveries");
  await expect(
    page.getByRole("link", { name: "Review retry", exact: true }),
  ).toHaveAttribute("href", `/hub/admin/outbox/${row.id}`);
  await expect(
    page.getByRole("button", { name: /Retry retained/ }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: /resend/i })).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Open source", exact: true }).first(),
  ).toHaveAttribute("href", row.source_href);
});
test("failed next page retains results and refresh restarts at the first page", async ({
  page,
}) => {
  await setup(page);
  let fail = true;
  const cursors: unknown[] = [];
  await page.route(
    `${backend}/rest/v1/rpc/list_daily_communications`,
    (route) => {
      const cursor = route.request().postDataJSON().p_before;
      cursors.push(cursor);
      if (cursor && fail)
        return route.fulfill({
          status: 503,
          json: { message: "Synthetic outage" },
        });
      return route.fulfill({
        json: {
          read_at: stamp,
          rows: [row],
          next: cursor
            ? null
            : { activity_at: stamp, source: "outbox", id: row.id },
        },
      });
    },
  );
  await page.goto("/hub/deliveries");
  await expect(
    page.getByText("Synthetic family", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Load more communications", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Your loaded results are retained",
  );
  await expect(
    page.getByText("Synthetic family", { exact: true }),
  ).toBeVisible();
  fail = false;
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect.poll(() => cursors.at(-1)).toBeNull();
  await expect(
    page.getByRole("button", { name: "Load more communications", exact: true }),
  ).toBeVisible();
});
test("invalid filters stay editable and safe projection failures are explicit", async ({
  page,
}) => {
  await setup(page);
  await page.route(
    `${backend}/rest/v1/rpc/list_daily_communications`,
    (route) =>
      route.fulfill({
        json: {
          read_at: stamp,
          rows: [{ ...row, lease_token: "PRIVATE" }],
          next: null,
        },
      }),
  );
  await page.goto("/hub/deliveries");
  await expect(page.getByRole("alert")).toContainText(
    "Could not load daily communications",
  );
  await page.getByLabel("From (Denver date)").fill("2026-10-09");
  await page.getByLabel("Through (Denver date)").fill("2026-10-01");
  await page
    .getByRole("button", { name: "Apply filters", exact: true })
    .click();
  await expect(
    page.getByText(/Choose a range of up to 366 days/),
  ).toBeVisible();
  await expect(page.getByLabel("Through (Denver date)")).toHaveValue(
    "2026-10-01",
  );
});
test("scheduled retained delivery cancels through its original version-checked RPC", async ({
  page,
}) => {
  await setup(page);
  let cancelled = false;
  const retained = {
    ...row,
    source: "legacy",
    status: "scheduled",
    accepted_at: null,
    summary: "Retained staff delivery",
    attempt_count: 0,
  };
  await page.route(
    `${backend}/rest/v1/rpc/list_daily_communications`,
    (route) =>
      route.fulfill({
        json: {
          read_at: stamp,
          rows: [
            { ...retained, status: cancelled ? "cancelled" : "scheduled" },
          ],
          next: null,
        },
      }),
  );
  await page.route(
    `${backend}/rest/v1/rpc/cancel_outbound_delivery`,
    (route) => {
      expect(route.request().postDataJSON()).toMatchObject({
        p_delivery_id: row.id,
        p_expected_updated_at: stamp,
      });
      cancelled = true;
      return route.fulfill({ json: { id: row.id, status: "CANCELED" } });
    },
  );
  await page.goto("/hub/deliveries");
  await expect(
    page.getByRole("button", { name: "Cancel retained delivery", exact: true }),
  ).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Cancel retained delivery", exact: true })
    .click();
  await expect(
    page.getByText("Cancelled", { exact: true }).last(),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Cancel retained delivery", exact: true }),
  ).toHaveCount(0);
});
