import { test, expect, type Page } from "@playwright/test";
const backend = "http://127.0.0.1:54321",
  actor = "11111111-1111-4111-8111-111111111111",
  inboundId = "22222222-2222-4222-8222-222222222222",
  clientId = "33333333-3333-4333-8333-333333333333",
  conversationId = "44444444-4444-4444-8444-444444444444",
  date = "2026-09-12T12:00:00.000Z";
interface Row {
  // Synthetic RPC fixture rows span inbound and assignment tables.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}
async function fixture(page: Page) {
  const user = {
      id: actor,
      aud: "authenticated",
      role: "authenticated",
      email: "staff@example.test",
      app_metadata: { provider: "email", providers: ["email"] },
      user_metadata: {},
      created_at: date,
    },
    expires = Math.floor(Date.now() / 1000) + 3600,
    payload = Buffer.from(
      JSON.stringify({
        sub: actor,
        exp: expires,
        role: "authenticated",
        aud: "authenticated",
      }),
    ).toString("base64url"),
    session = {
      access_token: `eyJhbGciOiJIUzI1NiJ9.${payload}.synthetic`,
      refresh_token: "synthetic",
      token_type: "bearer",
      expires_in: 3600,
      expires_at: expires,
      user,
    };
  const state = {
    inbound: {
      id: inboundId,
      channel: "EMAIL",
      sender: "unknown@example.test",
      recipient: "practice@example.test",
      subject: "Unmatched incoming original",
      body: 'Literal <img src="https://tracker.invalid/pixel"> text. Please review my pet.',
      occurred_at: date,
      received_at: date,
      client_id: null,
      conversation_id: null,
      message_id: null,
      review_reason: "unknown_sender",
      version: 1,
    } as Row,
    assignments: [] as Row[],
    calls: [] as Row[],
    failBefore: false,
    failAfter: false,
    failRecovery: false,
    race: false,
    selectedFields: [] as string[],
  };
  await page.addInitScript(
    (s) => localStorage.setItem("sb-127-auth-token", JSON.stringify(s)),
    session,
  );
  await page.route("**/*", (r) =>
    new URL(r.request().url()).origin === "http://127.0.0.1:8080"
      ? r.continue()
      : r.abort(),
  );
  await page.route(`${backend}/**`, async (route) => {
    const url = new URL(route.request().url()),
      path = url.pathname;
    if (path === "/auth/v1/user") return route.fulfill({ json: user });
    if (path === "/auth/v1/token") return route.fulfill({ json: session });
    if (path === "/rest/v1/profiles")
      return route.fulfill({
        json: [
          {
            id: actor,
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
    if (path === "/rest/v1/communication_inbound") {
      const fields = url.searchParams.get("select")!;
      state.selectedFields.push(fields);
      expect(fields).not.toContain("html_body");
      expect(fields).not.toContain("attachment_metadata");
      if (url.searchParams.has("id")) {
        if (state.failRecovery) {
          return route.abort();
        }
        return route.fulfill({ json: state.inbound });
      }
      return route.fulfill({
        json: state.inbound.message_id ? [] : [state.inbound],
      });
    }
    if (path === "/rest/v1/communication_inbound_assignments") {
      expect(url.searchParams.get("inbound_id")).toBe(`eq.${inboundId}`);
      return route.fulfill({ json: state.assignments });
    }
    if (path === "/rest/v1/rpc/search_clients")
      return route.fulfill({
        json: [
          {
            id: clientId,
            full_name: "Reviewed Household",
            primary_email: "verified@example.test",
            primary_phone: null,
          },
        ],
      });
    if (path === "/rest/v1/conversations") {
      expect(url.searchParams.get("client_id")).toBe(`eq.${clientId}`);
      return route.fulfill({
        json: [
          {
            id: conversationId,
            client_id: clientId,
            status: "ACTIVE",
            last_message_at: date,
          },
        ],
      });
    }
    if (path === "/rest/v1/rpc/assign_inbound_communication") {
      const b = route.request().postDataJSON();
      state.calls.push(b);
      expect(url.searchParams.get("select")).not.toContain("html_body");
      expect(Object.keys(b)).toHaveLength(6);
      expect(b.p_actor_id).toBe(actor);
      if (state.failBefore) {
        state.failBefore = false;
        return route.abort();
      }
      state.inbound = {
        ...state.inbound,
        client_id: b.p_client_id,
        conversation_id: b.p_conversation_id,
        message_id: "55555555-5555-4555-8555-555555555555",
        review_reason: null,
        version: 2,
      };
      state.assignments.push({
        id: "66666666-6666-4666-8666-666666666666",
        inbound_id: inboundId,
        client_id: b.p_client_id,
        conversation_id: b.p_conversation_id,
        assigned_by: state.race
          ? "77777777-7777-4777-8777-777777777777"
          : actor,
        reason: b.p_reason,
        created_at: date,
      });
      if (state.race)
        return route.fulfill({
          status: 409,
          json: { code: "40001", message: "Other staff assigned" },
        });
      if (state.failAfter) {
        state.failAfter = false;
        state.failRecovery = true;
        return route.abort();
      }
      return route.fulfill({ json: state.inbound });
    }
    return route.fulfill({ json: [] });
  });
  return state;
}
async function review(page: Page) {
  await page.goto("/hub/inbox/review");
  await page
    .getByRole("button", { name: "Review unknown@example.test", exact: true })
    .click();
  await page
    .getByLabel("Find existing household", { exact: true })
    .fill("Reviewed");
  await page
    .getByRole("button", {
      name: "Search households for assignment",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", {
      name: "Reviewed Household · verified@example.test",
      exact: true,
    })
    .click();
  await page
    .getByLabel("This household’s conversation", { exact: true })
    .selectOption(conversationId);
  await page
    .getByLabel("Household matching reason", { exact: true })
    .fill("Compared original sender and known household history");
  await page.getByLabel(/I reviewed the original sender and message/).check();
}
test("lost assignment acknowledgment recovers original incoming message and exact audit after reload", async ({
  page,
}) => {
  const state = await fixture(page);
  await review(page);
  await expect(page.locator('img[src*="tracker.invalid"]')).toHaveCount(0);
  await expect(page.getByText(/Literal <img/)).toBeVisible();
  state.failAfter = true;
  await page
    .getByRole("button", {
      name: "Assign original incoming message",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Retry original assignment",
      exact: true,
    }),
  ).toBeVisible();
  await expect.poll(() => state.assignments.length).toBe(1);
  await page.reload({ waitUntil: "commit" });
  state.failRecovery = false;
  await expect(
    page.getByText(
      "The original incoming message is assigned. No new message or reply was sent.",
      { exact: true },
    ),
  ).toBeVisible();
  expect(state.calls).toHaveLength(1);
  expect(state.assignments).toHaveLength(1);
  await expect(
    page.getByRole("link", { name: "Open assigned conversation", exact: true }),
  ).toHaveAttribute("href", `/hub/conversation/${conversationId}`);
  expect(
    await page.evaluate(() =>
      Object.keys(sessionStorage).some((k) =>
        k.startsWith("inbound-assignment-intent:"),
      ),
    ),
  ).toBe(false);
});
test("uncommitted assignment retries original version and forbids retargeting uncertain draft", async ({
  page,
}) => {
  const state = await fixture(page);
  await review(page);
  state.failBefore = true;
  await page
    .getByRole("button", {
      name: "Assign original incoming message",
      exact: true,
    })
    .click();
  await expect(
    page.getByLabel("This household’s conversation", { exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Retry original assignment", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "Open assigned conversation", exact: true }),
  ).toBeVisible();
  expect(state.calls).toHaveLength(2);
  expect(state.calls[0]).toEqual(state.calls[1]);
  expect(state.assignments).toHaveLength(1);
});
test("another staff assignment is a conflict rather than proof of this draft", async ({
  page,
}) => {
  const state = await fixture(page);
  await review(page);
  state.race = true;
  await page
    .getByRole("button", {
      name: "Assign original incoming message",
      exact: true,
    })
    .click();
  await expect(
    page.getByText(/Another assignment or version change is recorded/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Retry original assignment",
      exact: true,
    }),
  ).toBeDisabled();
  await page
    .getByRole("button", {
      name: "Clear conflicting local request",
      exact: true,
    })
    .click();
  expect(state.calls).toHaveLength(1);
  expect(state.assignments[0].assigned_by).not.toBe(actor);
  await expect(
    page.getByText(
      "The original incoming message is assigned. No new message or reply was sent.",
      { exact: true },
    ),
  ).toHaveCount(0);
});
test("navigation protects review draft and signout removes pending household assignment", async ({
  page,
}) => {
  const state = await fixture(page);
  await review(page);
  await page.getByRole("link", { name: "Back to inbox", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "Leave unfinished inbox review?",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Keep reviewing", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Leave unfinished inbox review?",
      exact: true,
    }),
  ).toHaveCount(0);
  state.failBefore = true;
  await page
    .getByRole("button", {
      name: "Assign original incoming message",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Retry original assignment",
      exact: true,
    }),
  ).toBeEnabled();
  await page.getByRole("button", { name: /sign out/i }).click();
  await expect(
    page.getByRole("heading", {
      name: "Review unmatched incoming messages",
      exact: true,
    }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      Object.keys(sessionStorage).some((k) =>
        k.startsWith("inbound-assignment-intent:"),
      ),
    ),
  ).toBe(false);
});
