import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
const actor = "11111111-1111-4111-8111-111111111111";
const inquiry = "22222222-2222-4222-8222-222222222222";
const client = "33333333-3333-4333-8333-333333333333";
async function fixture(page: Page) {
  const user = {
    id: actor,
    aud: "authenticated",
    role: "authenticated",
    email: "staff@example.test",
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {},
    created_at: "2026-01-01T00:00:00Z",
  };
  const exp = Math.floor(Date.now() / 1000) + 3600;
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
    version: 1,
    reviewed: false,
    conflict: false,
    searches: [] as string[],
    cursor: false,
    handoffs: 0,
    queues: 0,
  };
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin ===
    new URL(test.info().project.use.baseURL!).origin
      ? route.continue()
      : route.abort(),
  );
  await page.route("http://127.0.0.1:54321/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/auth/v1/user") return route.fulfill({ json: user });
    if (path === "/auth/v1/token") return route.fulfill({ json: session });
    if (path === "/rest/v1/profiles")
      return route.fulfill({
        json: [{ id: actor, full_name: "Test Staff", is_active: true }],
      });
    if (path === "/rest/v1/user_roles")
      return route.fulfill({ json: [{ role: "STAFF" }] });
    if (path === "/rest/v1/website_inquiry_history")
      return route.fulfill({ json: [] });
    const body = route.request().postDataJSON() ?? {};
    if (path.endsWith("/list_website_inquiries")) {
      state.cursor = !!body.p_before_id;
      return route.fulfill({
        json: body.p_before_id
          ? []
          : Array.from({ length: 25 }, (_, i) => ({
              inquiry_id:
                i === 0
                  ? inquiry
                  : `22222222-2222-4222-8222-${String(i).padStart(12, "0")}`,
              submitted_at: "2026-09-12T15:00:00Z",
              claimed_name: "Unverified Person",
              subject: `Request ${i}`,
              status: "new",
              version: 1,
              client_id: null,
              assigned_to_id: null,
            })),
      });
    }
    if (path.endsWith("/read_website_inquiry"))
      return route.fulfill({
        json: {
          submission: {
            id: inquiry,
            name: "Unverified Person",
            email: "claimed@example.test",
            phone: null,
            subject: "Request 0",
            message: "A private website request",
            created_at: "2026-09-12T15:00:00Z",
          },
          triage: {
            version: state.version,
            status: state.reviewed ? "in_progress" : "new",
            assigned_to_id: null,
            client_id: state.reviewed ? client : null,
            reply_channel: state.reviewed ? "EMAIL" : null,
            reply_recipient: state.reviewed ? "verified@example.test" : null,
          },
          household_name: state.reviewed ? "Confirmed Family" : null,
        },
      });
    if (path.endsWith("/search_clients")) {
      state.searches.push(body.p_search);
      return route.fulfill({
        json:
          body.p_search === "family"
            ? [
                {
                  id: client,
                  full_name: "Confirmed Family",
                  primary_email: "verified@example.test",
                  primary_phone: null,
                },
              ]
            : [],
      });
    }
    if (path.endsWith("/review_website_inquiry_household")) {
      expect(body.p_confirmed).toBe(true);
      expect(body.p_recipient).toBe("verified@example.test");
      state.reviewed = true;
      state.version++;
      return route.fulfill({ json: {} });
    }
    if (path.endsWith("/update_website_inquiry"))
      return state.conflict
        ? route.fulfill({
            status: 400,
            json: {
              message: "Inquiry changed; reload before saving",
              code: "40001",
            },
          })
        : route.fulfill({ json: {} });
    if (path.endsWith("/recover_message_request"))
      return route.fulfill({ json: null });
    if (path.endsWith("/authorize_website_inquiry_reply")) {
      state.handoffs++;
      return route.fulfill({
        status: 403,
        json: { message: "Current destination changed", code: "42501" },
      });
    }
    if (path.includes("/functions/")) {
      state.queues++;
      return route.abort();
    }
    return route.fulfill({
      json: path.endsWith("/inbox_unread_count") ? 0 : [],
    });
  });
  return state;
}
test("bounded inquiry list, reviewed household retained across search, no implicit queue", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto("/hub/inquiries");
  await expect(
    page.getByRole("heading", { name: "Website inquiries", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Load more inquiries" }).click();
  expect(state.cursor).toBe(true);
  await page.getByRole("button", { name: /Request 0 Unverified/ }).click();
  await expect(page.getByText("A private website request")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Queue reviewed reply" }),
  ).toHaveCount(0);
  await page.getByLabel("Search existing households").fill("family");
  await page
    .getByRole("button", { name: "Confirmed Family", exact: true })
    .click();
  await page.getByLabel("Search existing households").fill("different");
  await expect(page.getByText("Selected: Confirmed Family")).toBeVisible();
  await page
    .getByLabel("Review evidence")
    .fill("Verified by independent telephone discussion");
  await expect(
    page.getByRole("button", { name: "Confirm reply destination" }),
  ).toBeDisabled();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Confirm reply destination" }).click();
  await expect(
    page.getByText("EMAIL to reviewed destination: verified@example.test"),
  ).toBeVisible();
  expect(state.queues).toBe(0);
  await page.getByLabel("Reply subject").fill("Your request");
  await page.getByLabel("Reply message").fill("Thank you for contacting us.");
  await page.getByRole("button", { name: "Queue reviewed reply" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  expect(state.handoffs).toBe(1);
  expect(state.queues).toBe(0);
  await expect(page.getByLabel("Reply message")).toHaveValue(
    "Thank you for contacting us.",
  );
});
test("metadata conflict keeps draft and offers explicit reload", async ({
  page,
}) => {
  const state = await fixture(page);
  state.conflict = true;
  await page.goto("/hub/inquiries");
  await page.getByRole("button", { name: /Request 0 Unverified/ }).click();
  await page
    .getByLabel("Change reason")
    .fill("Called household to investigate");
  await page.getByRole("button", { name: "Save triage" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByLabel("Change reason")).toHaveValue(
    "Called household to investigate",
  );
  await expect(
    page.getByRole("button", { name: "Reload inquiry" }),
  ).toBeVisible();
});
