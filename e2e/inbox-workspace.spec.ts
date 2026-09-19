import { test, expect, type Page } from "@playwright/test";
const staff = "11111111-1111-4111-8111-111111111111";
const other = "11111111-1111-4111-8111-222222222222";
const household = "22222222-2222-4222-8222-222222222222";
const conversation = "33333333-3333-4333-8333-333333333333";
const message = "44444444-4444-4444-8444-444444444444";
interface State {
  lists: Record<string, unknown>[];
  reads: Record<string, unknown>[];
  mutations: Record<string, unknown>[];
  snapshot: number;
  applied: number;
  conflict: boolean;
  version: number;
  badge: number;
}
async function fixture(page: Page, actor = staff) {
  const user = {
    id: actor,
    aud: "authenticated",
    role: "authenticated",
    email: "synthetic@example.test",
    app_metadata: {},
    user_metadata: {},
    created_at: "2026-01-01T00:00:00Z",
  };
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const token = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ sub: actor, exp, role: "authenticated", aud: "authenticated" })).toString("base64url")}.synthetic`;
  const session = {
    access_token: token,
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
  const state: State = {
    lists: [],
    reads: [],
    mutations: [],
    snapshot: 0,
    applied: 0,
    conflict: true,
    version: 1,
    badge: actor === staff ? 7 : 2,
  };
  const row = (index = 0) => ({
    conversation_id: index
      ? `33333333-3333-4333-8333-${String(index).padStart(12, "0")}`
      : conversation,
    client_id: household,
    client_name: index ? `Household ${index}` : "Synthetic Family",
    primary_phone: "+13035550100",
    primary_email: "family@example.test",
    updated_at: "2026-09-12T10:00:00Z",
    status: "ACTIVE",
    assigned_to_id: null,
    priority: "NORMAL",
    tags: ["followup"],
    revision: state.version,
    latest_message_id: message,
    latest_content: "Question for the clinic",
    latest_type: "EMAIL",
    unread_count: 1,
    is_unread: true,
  });
  await page.route("**/*", (route) =>
    new URL(route.request().url()).hostname === "127.0.0.1"
      ? route.continue()
      : route.abort(),
  );
  await page.route("http://127.0.0.1:54321/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const args =
      route.request().method() === "POST" ? route.request().postDataJSON() : {};
    if (path === "/auth/v1/token") return route.fulfill({ json: session });
    if (path === "/auth/v1/user") return route.fulfill({ json: user });
    if (path === "/rest/v1/profiles")
      return route.fulfill({
        json: [
          {
            id: actor,
            full_name: actor === staff ? "First Staff" : "Other Staff",
            first_name: "First",
            last_name: "Staff",
            role: "STAFF",
            is_active: true,
          },
        ],
      });
    if (path === "/rest/v1/user_roles")
      return route.fulfill({ json: [{ user_id: actor, role: "STAFF" }] });
    if (path === "/rest/v1/rpc/inbox_unread_totals")
      return route.fulfill({
        json: [{ unread_conversations: state.badge, unread_messages: 8 }],
      });
    if (path === "/rest/v1/rpc/list_inbox_workspace") {
      state.lists.push(args);
      const rows = args.p_before_id
        ? [row(51)]
        : args.p_search || args.p_assignment !== "all"
          ? [row()]
          : Array.from({ length: 50 }, (_, i) => row(i));
      return route.fulfill({ json: rows });
    }
    if (
      path === "/rest/v1/rpc/mark_conversation_read" ||
      path === "/rest/v1/rpc/mark_conversation_unread"
    ) {
      state.reads.push(args);
      return route.fulfill({ json: null });
    }
    if (path === "/rest/v1/rpc/capture_inbox_read_snapshot") {
      state.snapshot++;
      return route.fulfill({ json: "55555555-5555-4555-8555-555555555555" });
    }
    if (path === "/rest/v1/rpc/apply_inbox_read_snapshot") {
      expect(args.p_actor_id).toBe(actor);
      expect(args.p_snapshot_id).toBe("55555555-5555-4555-8555-555555555555");
      state.applied++;
      state.badge = 1;
      return route.fulfill({ json: null });
    }
    if (path === "/rest/v1/rpc/update_conversation_metadata") {
      state.mutations.push(args);
      if (state.conflict) {
        state.version = 2;
        return route.fulfill({
          status: 409,
          json: { code: "40001", message: "Conversation changed" },
        });
      }
      state.version++;
      return route.fulfill({
        json: { id: conversation, revision: state.version },
      });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto("/hub/chats");
  await expect(
    page.getByRole("button", { name: "Open Synthetic Family (unread)" }),
  ).toBeVisible();
  return state;
}

test("filtered inbox uses bounded keyset pages and personal unread totals", async ({
  page,
}) => {
  const state = await fixture(page);
  await expect(
    page.getByText("7 active conversations unread for you"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Load more conversations" }).click();
  await expect(
    page.getByRole("button", { name: "Open Household 51 (unread)" }),
  ).toBeVisible();
  expect(state.lists[1].p_before_id).toBe(
    "33333333-3333-4333-8333-000000000049",
  );
  expect(state.lists.every((r) => r.p_limit === 50)).toBe(true);
  await page.getByLabel("Search household, pet or message").fill("Synthetic");
  await expect.poll(() => state.lists.at(-1)?.p_search).toBe("Synthetic");
  expect(state.lists.at(-1)?.p_before_id).toBeUndefined();
  await page
    .getByLabel("Assigned staff", { exact: true })
    .selectOption("unassigned");
  await page.getByLabel("Priority", { exact: true }).selectOption("URGENT");
  await page.getByLabel("Channel", { exact: true }).selectOption("EMAIL");
  await page.getByLabel("Read status", { exact: true }).selectOption("unread");
  await page.getByLabel("Tag", { exact: true }).fill("followup");
  await expect.poll(() => state.lists.at(-1)?.p_tags).toEqual(["followup"]);
  expect(state.lists.at(-1)).toMatchObject({
    p_assignment: "unassigned",
    p_priority: "URGENT",
    p_channel: "EMAIL",
    p_read: "unread",
  });
});

test("read actions send exact displayed message and actor snapshot boundary", async ({
  page,
}) => {
  const state = await fixture(page, other);
  await expect(
    page.getByText("2 active conversations unread for you"),
  ).toBeVisible();
  await page
    .getByRole("article", { name: "Synthetic Family conversation" })
    .getByRole("button", { name: "Mark as read", exact: true })
    .click();
  await expect.poll(() => state.reads.length).toBe(1);
  expect(state.reads[0]).toEqual({
    p_actor_id: other,
    p_conversation_id: conversation,
    p_message_id: message,
  });
  await page.getByRole("button", { name: "Read all active" }).click();
  await expect.poll(() => state.applied).toBe(1);
  expect(state.snapshot).toBe(1);
  await expect(
    page.getByText("1 active conversations unread for you"),
  ).toBeVisible();
});

test("metadata conflict retains tag draft and requires reviewing latest revision", async ({
  page,
}) => {
  const state = await fixture(page);
  await page
    .getByRole("button", { name: "Actions for Synthetic Family" })
    .click();
  await expect(
    page.getByRole("button", { name: "Delete conversation" }),
  ).toHaveCount(0);
  await page.getByLabel("Tags, separated by commas").fill("followup, review");
  await page.getByRole("button", { name: "Save tags", exact: true }).click();
  await expect(
    page.getByText("Save not confirmed.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByLabel("Tags, separated by commas")).toHaveValue(
    "followup, review",
  );
  expect(state.mutations[0]).toMatchObject({
    p_actor_id: staff,
    p_expected_revision: 1,
    p_tags: ["followup", "review"],
  });
  await page.getByRole("button", { name: "Reload current details" }).click();
  state.conflict = false;
  await page.getByRole("button", { name: "Save tags", exact: true }).click();
  await expect.poll(() => state.mutations.length).toBe(2);
  expect(state.mutations[1].p_expected_revision).toBe(2);
  await expect(page.getByLabel("Tags, separated by commas")).toHaveCount(0);
});
