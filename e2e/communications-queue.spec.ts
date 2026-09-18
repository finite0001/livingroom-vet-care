import { test, expect, type Page } from "@playwright/test";
const backend = "http://127.0.0.1:54321";
const staff = "11111111-1111-4111-8111-111111111111";
const client = "22222222-2222-4222-8222-222222222222";
const conversation = "33333333-3333-4333-8333-333333333333";
const message = "44444444-4444-4444-8444-444444444444";
async function fixture(page: Page, mode: "lost" | "offline" | "rejected") {
  const user = {
    id: staff,
    aud: "authenticated",
    role: "authenticated",
    email: "synthetic@example.test",
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {},
    created_at: "2026-01-01T00:00:00Z",
  };
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const token = Buffer.from(
    JSON.stringify({
      sub: staff,
      exp: expires,
      role: "authenticated",
      aud: "authenticated",
    }),
  ).toString("base64url");
  const session = {
    access_token: `eyJhbGciOiJIUzI1NiJ9.${token}.synthetic`,
    refresh_token: "synthetic",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: expires,
    user,
  };
  await page
    .context()
    .addInitScript(
      (value) =>
        localStorage.setItem("sb-127-auth-token", JSON.stringify(value)),
      session,
    );
  const prepared = new Map<
    string,
    {
      request_id: string;
      payload: Record<string, unknown> | null;
      status: string;
      receipt: unknown;
      actor: string;
      scope: string;
    }
  >();
  const state = {
    requests: [] as { request_id: string; body: string }[],
    stored: false,
    offline: mode === "offline",
    legacyCalls: 0,
    prepared,
    recoverOffline: false,
    prepareUnknown: false,
    prepareLost: false,
    ackOffline: false,
  };
  await page
    .context()
    .route("**/*", (route) =>
      new URL(route.request().url()).hostname === "127.0.0.1"
        ? route.continue()
        : route.abort(),
    );
  await page.context().route(`${backend}/**`, async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path === "/auth/v1/token") return route.fulfill({ json: session });
    if (path === "/auth/v1/user") return route.fulfill({ json: user });
    if (path === "/rest/v1/profiles")
      return route.fulfill({
        json: [
          {
            id: staff,
            full_name: "Synthetic Staff",
            first_name: "Synthetic",
            last_name: "Staff",
            is_active: true,
          },
        ],
      });
    if (path === "/rest/v1/user_roles")
      return route.fulfill({ json: [{ role: "STAFF" }] });
    if (path === "/rest/v1/conversations")
      return route.fulfill({
        json: {
          id: conversation,
          client_id: client,
          status: "ACTIVE",
          is_read: true,
          priority: "NORMAL",
          tags: [],
          last_message_at: "2026-09-12T12:00:00Z",
        },
      });
    if (path === "/rest/v1/clients")
      return route.fulfill({
        json: {
          id: client,
          full_name: "Synthetic Household",
          first_name: "Synthetic",
          last_name: "Household",
          primary_email: "synthetic@example.test",
          primary_phone: "+13035550123",
          preferred_channel: "EMAIL",
        },
      });
    if (path === "/rest/v1/rpc/current_sms_consent")
      return route.fulfill({
        json: {
          client_id: client,
          opted_in: true,
          can_message: true,
          phone_number: "+13035550123",
          updated_at: null,
        },
      });
    if (path === "/rest/v1/rpc/search_clients")
      return route.fulfill({
        json: [
          {
            id: client,
            full_name: "Synthetic Household",
            first_name: "Synthetic",
            last_name: "Household",
            primary_phone: "+13035550123",
            primary_email: "synthetic@example.test",
            version: 1,
          },
        ],
      });
    if (path === "/rest/v1/rpc/ensure_active_conversation")
      return route.fulfill({ json: { id: conversation, client_id: client } });
    if (path === "/rest/v1/rpc/inbox_unread_totals")
      return route.fulfill({
        json: [{ unread_conversations: 0, unread_messages: 0 }],
      });
    if (path === "/rest/v1/rpc/list_inbox_workspace")
      return route.fulfill({ json: [] });
    if (
      path === "/functions/v1/send-email" ||
      path === "/functions/v1/send-sms"
    ) {
      state.legacyCalls++;
      return route.fulfill({ status: 500, json: { error: "Legacy bypass" } });
    }
    if (path === "/rest/v1/rpc/recover_message_request") {
      if (state.recoverOffline) return route.abort();
      const a = route.request().postDataJSON();
      const snapshot = a.p_request_id
        ? prepared.get(a.p_request_id)
        : [...prepared.values()].find(
            (r) =>
              r.actor === a.p_actor_id &&
              r.scope === a.p_scope &&
              r.status === "prepared",
          );
      return route.fulfill({
        json:
          snapshot &&
          snapshot.actor === a.p_actor_id &&
          snapshot.scope === a.p_scope
            ? snapshot
            : null,
      });
    }
    if (path === "/rest/v1/rpc/prepare_message_request") {
      const a = route.request().postDataJSON();
      if (state.prepareUnknown) return route.abort();
      if (!prepared.has(a.p_request_id))
        prepared.set(a.p_request_id, {
          request_id: a.p_request_id,
          actor: a.p_actor_id,
          scope: a.p_scope,
          status: "prepared",
          receipt: null,
          payload: {
            conversation_id: a.p_conversation_id,
            channel: a.p_channel,
            to: a.p_recipient,
            subject: a.p_subject,
            body: a.p_body,
            attachment_ids: a.p_attachment_ids,
          },
        });
      if (state.prepareLost) {
        state.recoverOffline = true;
        return route.abort();
      }
      return route.fulfill({ json: prepared.get(a.p_request_id) });
    }
    if (path === "/rest/v1/rpc/resolve_message_request") {
      if (state.ackOffline) return route.abort();
      const a = route.request().postDataJSON();
      const snapshot = prepared.get(a.p_request_id) ?? {
        request_id: a.p_request_id,
        actor: a.p_actor_id,
        scope: a.p_scope,
        status: "prepared",
        payload: null,
        receipt: null,
      };
      snapshot.status = snapshot.receipt ? "acknowledged" : "abandoned";
      prepared.set(a.p_request_id, snapshot);
      return route.fulfill({ json: snapshot });
    }
    if (path === "/functions/v1/enqueue-message") {
      const payload = route.request().postDataJSON();
      state.requests.push(payload);
      expect(prepared.get(payload.request_id)?.payload).toMatchObject({
        body: payload.body,
        to: payload.to,
      });
      if (mode === "rejected")
        return route.fulfill({
          status: 403,
          json: {
            error: "Delivery disabled in this environment",
            queue_rejected: true,
          },
        });
      if (state.offline) return route.abort();
      state.stored = true;
      prepared.get(payload.request_id)!.receipt = {
        success: true,
        queued: true,
        outbox_id: "queue",
        message_id: message,
        state: "pending",
      };
      if (mode === "lost") return route.abort();
      return route.fulfill({
        status: 202,
        json: {
          success: true,
          queued: true,
          outbox_id: "queue",
          message_id: message,
          state: "pending",
        },
      });
    }
    if (
      path === "/rest/v1/conversation_read_cursors" ||
      path === "/rest/v1/conversation_unread_flags"
    )
      return route.fulfill({ json: null });
    if (path === "/rest/v1/communication_outbox") {
      const row = {
        id: "queue",
        message_id: message,
        state: "pending",
        last_error: null,
      };
      return route.fulfill({
        json: url.searchParams.has("request_id")
          ? state.stored
            ? row
            : null
          : state.stored
            ? [row]
            : [],
      });
    }
    if (path === "/rest/v1/messages")
      return route.fulfill({
        json: state.stored
          ? [
              {
                id: message,
                conversation_id: conversation,
                type: "EMAIL",
                sender_type: "STAFF",
                content: "Synthetic queue test",
                is_internal: false,
                created_at: "2026-09-12T12:00:00Z",
              },
            ]
          : [],
      });
    return route.fulfill({ json: [] });
  });
  return state;
}
async function compose(page: Page) {
  await page.goto(`/hub/conversation/${conversation}`);
  await page.getByRole("tab", { name: "Email", exact: true }).click();
  await page
    .getByPlaceholder("Subject", { exact: true })
    .fill("Synthetic subject");
  await page.getByPlaceholder("Send EMAIL...").fill("Synthetic queue test");
}
test("lost response recovers durable queue and shows queued rather than delivered", async ({
  page,
}) => {
  const state = await fixture(page, "lost");
  await compose(page);
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.getByPlaceholder("Send EMAIL...")).toHaveValue("");
  await expect(
    page.getByRole("status").filter({ hasText: /^Queued$/ }),
  ).toBeVisible();
  expect(state.requests).toHaveLength(1);
  expect(state.legacyCalls).toBe(0);
});
test("offline retry preserves draft and request UUID; editing cannot create a new intent", async ({
  page,
}) => {
  const state = await fixture(page, "offline");
  await compose(page);
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.getByText(/Queue confirmation was lost/)).toBeVisible();
  await expect(page.getByPlaceholder("Send EMAIL...")).toHaveValue(
    "Synthetic queue test",
  );
  await page.getByPlaceholder("Send EMAIL...").fill("Changed draft");
  await expect(
    page.getByRole("button", { name: "Send message", exact: true }),
  ).toBeDisabled();
  expect(state.requests).toHaveLength(1);
  state.offline = false;
  await page.getByRole("button", { name: "Restore saved draft" }).click();
  await page.getByRole("button", { name: "Replace with saved draft" }).click();
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.getByPlaceholder("Send EMAIL...")).toHaveValue("");
  expect(state.requests).toHaveLength(2);
  expect(state.requests[0].request_id).toBe(state.requests[1].request_id);
  expect(state.legacyCalls).toBe(0);
});
test("disabled delivery leaves the draft and never claims queued", async ({
  page,
}) => {
  const state = await fixture(page, "rejected");
  await compose(page);
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(
    page.getByText("Delivery disabled in this environment"),
  ).toBeVisible();
  await expect(page.getByPlaceholder("Send EMAIL...")).toHaveValue(
    "Synthetic queue test",
  );
  expect(state.stored).toBe(false);
  expect(state.legacyCalls).toBe(0);
});
test("consent records server version and preserves stale entry without bypassing suppression", async ({
  page,
}) => {
  await fixture(page, "rejected");
  let version = "2026-09-12T12:00:00Z";
  let conflict = true;
  let saved: Record<string, unknown> | null = null;
  await page.route(`${backend}/rest/v1/rpc/current_sms_consent`, (route) =>
    route.fulfill({
      json: {
        id: "consent",
        client_id: client,
        phone_number: "+13035550123",
        opted_in: true,
        can_message: false,
        updated_at: version,
        consent_details: "Existing synthetic record",
      },
    }),
  );
  await page.route(`${backend}/rest/v1/rpc/record_sms_consent`, (route) => {
    const args = route.request().postDataJSON();
    if (conflict) {
      conflict = false;
      version = "2026-09-12T13:00:00Z";
      return route.fulfill({
        status: 409,
        json: {
          code: "40001",
          message: "Consent changed; reload before saving",
        },
      });
    }
    saved = args;
    return route.fulfill({
      json: { id: "consent", updated_at: "2026-09-12T14:00:00Z" },
    });
  });
  await page.goto(`/hub/client/${client}`);
  const panel = page.getByRole("region", { name: "SMS consent" });
  await expect(panel).toContainText("SMS is blocked");
  await panel
    .getByRole("button", { name: "Record consent or withdrawal" })
    .click();
  await panel.getByLabel("Preference", { exact: true }).selectOption("yes");
  await panel
    .getByLabel("Consent evidence", { exact: true })
    .fill("Synthetic written preference, reviewed today");
  await panel.getByRole("button", { name: "Save consent record" }).click();
  await expect(panel.getByRole("alert")).toContainText(
    "Your entry is preserved",
  );
  await expect(
    panel.getByLabel("Consent evidence", { exact: true }),
  ).toHaveValue("Synthetic written preference, reviewed today");
  page.once("dialog", (dialog) => dialog.accept());
  await panel.getByRole("button", { name: "Discard and reload" }).click();
  await panel
    .getByRole("button", { name: "Record consent or withdrawal" })
    .click();
  await panel.getByLabel("Preference", { exact: true }).selectOption("yes");
  await panel
    .getByLabel("Consent evidence", { exact: true })
    .fill("Synthetic reviewed replacement evidence");
  await panel.getByRole("button", { name: "Save consent record" }).click();
  await expect(panel.getByRole("status")).toContainText("Consent record saved");
  expect(saved).toMatchObject({
    p_actor_id: staff,
    p_client_id: client,
    p_expected_updated_at: "2026-09-12T13:00:00Z",
    p_opted_in: true,
  });
  await expect(panel).toContainText("SMS is blocked");
});
for (const mobile of [false, true])
  test(`older messages preserve position and unread visibility on ${mobile ? "mobile" : "desktop"}`, async ({
    page,
  }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    await fixture(page, "rejected");
    const row = (index: number) => ({
      id: `55555555-5555-4555-8555-${String(index).padStart(12, "0")}`,
      conversation_id: conversation,
      type: "EMAIL",
      sender_type: "CLIENT",
      content: `Synthetic history ${index}`,
      is_internal: false,
      created_at: new Date(Date.UTC(2026, 8, 12, 12, 0, index)).toISOString(),
    });
    const latest = Array.from({ length: 50 }, (_, index) => row(50 - index));
    const reads: string[] = [];
    const cursors: string[] = [];
    await page.route(`${backend}/rest/v1/conversation_read_cursors*`, (route) =>
      route.fulfill({ json: null }),
    );
    await page.route(`${backend}/rest/v1/conversation_unread_flags*`, (route) =>
      route.fulfill({ json: { forced: true } }),
    );
    await page.route(
      `${backend}/rest/v1/rpc/mark_conversation_read`,
      (route) => {
        const body = route.request().postDataJSON();
        expect(body.p_actor_id).toBe(staff);
        reads.push(body.p_message_id);
        return route.fulfill({ json: null });
      },
    );
    await page.route(`${backend}/rest/v1/messages*`, (route) => {
      const url = new URL(route.request().url());
      if (route.request().method() === "HEAD")
        return route.fulfill({
          headers: { "content-range": "0-0/1" },
          body: "",
        });
      if (url.searchParams.get("limit") === "1")
        return route.fulfill({ json: [latest[0]] });
      expect(url.searchParams.get("limit")).toBe("50");
      const cursor = url.searchParams.get("or");
      if (cursor) cursors.push(cursor);
      return route.fulfill({ json: cursor ? [row(0)] : latest.slice(0, 50) });
    });
    await page.goto(`/hub/conversation/${conversation}`);
    await expect.poll(() => reads).toContain(row(50).id);
    await expect(
      page.getByRole("button", { name: "Send message", exact: true }),
    ).toBeInViewport();
    const history = page.getByRole("region", { name: "Conversation messages" });
    await history.evaluate((element) => {
      element.scrollTop = 0;
    });
    await page.getByRole("button", { name: "Load older messages" }).click();
    await expect(
      history.getByText("Synthetic history 0", { exact: true }),
    ).toBeAttached();
    expect(cursors[0]).toContain(row(1).id);
    const remaining = await history.evaluate(
      (element) =>
        element.scrollHeight - element.scrollTop - element.clientHeight,
    );
    expect(remaining).toBeGreaterThan(300);
    latest.unshift(row(51));
    // Polling observes the arrival without simulating a user reading the bottom.
    await expect(
      history.getByText("Synthetic history 51", { exact: true }),
    ).toBeAttached({ timeout: 22000 });
    expect(reads).not.toContain(row(51).id);
    await history.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect.poll(() => reads).toContain(row(51).id);
  });

test("reload restores exact prepared payload after an ambiguous prepare without auto-send", async ({
  page,
}) => {
  const state = await fixture(page, "offline");
  await compose(page);
  state.prepareLost = true;
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Saved message recovery" }),
  ).toContainText("Message preparation is not confirmed");
  expect(state.requests).toHaveLength(0);
  const id = [...state.prepared.keys()][0];
  const values = await page.evaluate(() =>
    Object.entries(sessionStorage).filter(([key]) =>
      key.startsWith("lrv-message-request:"),
    ),
  );
  expect(values).toEqual([
    [`lrv-message-request:${staff}:conversation:${conversation}`, id],
  ]);
  state.prepareLost = false;
  state.recoverOffline = false;
  state.offline = false;
  await page.reload();
  await expect(
    page.getByRole("region", { name: "Saved message recovery" }),
  ).toContainText("A saved message needs review");
  expect(state.requests).toHaveLength(0);
  await page.getByRole("button", { name: "Restore saved draft" }).click();
  await expect(page.getByPlaceholder("Subject", { exact: true })).toHaveValue(
    "Synthetic subject",
  );
  await expect(page.getByPlaceholder("Send EMAIL...")).toHaveValue(
    "Synthetic queue test",
  );
  await expect(
    page.getByText(
      "Saved recipient: synthetic@example.test. Retry keeps this exact recipient.",
    ),
  ).toBeVisible();
  expect(state.requests).toHaveLength(0);
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.getByPlaceholder("Send EMAIL...")).toHaveValue("");
  expect(state.requests[0].request_id).toBe(id);
});

test("unknown prepare survives reload until explicit tombstone while keeping a new typed draft", async ({
  page,
}) => {
  const state = await fixture(page, "offline");
  await compose(page);
  state.prepareUnknown = true;
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Saved message recovery" }),
  ).toContainText("Message preparation is not confirmed");
  const id = await page.evaluate(
    (key) => sessionStorage.getItem(key),
    `lrv-message-request:${staff}:conversation:${conversation}`,
  );
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Discard saved request" }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Email", exact: true }).click();
  await page.getByPlaceholder("Subject", { exact: true }).fill("New subject");
  await page.getByPlaceholder("Send EMAIL...").fill("New unrelated draft");
  await expect(
    page.getByRole("button", { name: "Send message", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Discard saved request" }).click();
  await page.getByRole("button", { name: "Confirm discard" }).click();
  await expect(
    page.getByRole("region", { name: "Saved message recovery" }),
  ).toHaveCount(0);
  expect(state.prepared.get(id!)?.status).toBe("abandoned");
  expect(state.requests).toHaveLength(0);
  await expect(page.getByPlaceholder("Send EMAIL...")).toHaveValue(
    "New unrelated draft",
  );
  await expect(page.getByPlaceholder("Subject", { exact: true })).toHaveValue(
    "New subject",
  );
});

test("reload acknowledges an already queued receipt without clearing a different draft", async ({
  page,
}) => {
  const state = await fixture(page, "lost");
  await compose(page);
  state.ackOffline = true;
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Saved message recovery" }),
  ).toContainText("already queued");
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Acknowledge queued message" }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Email", exact: true }).click();
  await page
    .getByPlaceholder("Subject", { exact: true })
    .fill("Different subject");
  await page.getByPlaceholder("Send EMAIL...").fill("Different draft");
  state.ackOffline = false;
  await page
    .getByRole("button", { name: "Acknowledge queued message" })
    .click();
  await expect(
    page.getByRole("region", { name: "Saved message recovery" }),
  ).toHaveCount(0);
  await expect(page.getByPlaceholder("Send EMAIL...")).toHaveValue(
    "Different draft",
  );
  expect(state.requests).toHaveLength(1);
});

test("navigation changes scope without exposing or discarding the previous prepared draft", async ({
  page,
}) => {
  const state = await fixture(page, "offline");
  await compose(page);
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Restore saved draft" }),
  ).toBeVisible();
  await page.goto("/hub/conversation/66666666-6666-4666-8666-666666666666");
  await expect(
    page.getByRole("region", { name: "Saved message recovery" }),
  ).toHaveCount(0);
  await page.getByRole("tab", { name: "Email", exact: true }).click();
  await expect(page.getByPlaceholder("Send EMAIL...")).toHaveValue("");
  await page.goto(`/hub/conversation/${conversation}`);
  await expect(
    page.getByRole("button", { name: "Restore saved draft" }),
  ).toBeVisible();
  expect([...state.prepared.values()][0].status).toBe("prepared");
  expect(state.requests).toHaveLength(1);
});

test("a second tab recovers the same server claim without automatically sending", async ({
  page,
  context,
}) => {
  const state = await fixture(page, "offline");
  await compose(page);
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Restore saved draft" }),
  ).toBeVisible();
  const second = await context.newPage();
  await second.goto(`/hub/conversation/${conversation}`);
  await expect(
    second.getByRole("button", { name: "Restore saved draft" }),
  ).toBeVisible();
  await second.getByRole("button", { name: "Restore saved draft" }).click();
  await expect(second.getByPlaceholder("Send EMAIL...")).toHaveValue(
    "Synthetic queue test",
  );
  expect(state.requests).toHaveLength(1);
  const id = await second.evaluate(
    (key) => sessionStorage.getItem(key),
    `lrv-message-request:${staff}:conversation:${conversation}`,
  );
  expect(id).toBe(state.requests[0].request_id);
  await second.close();
});

test("account switch hides the previous actors draft and saved request immediately", async ({
  page,
}) => {
  const state = await fixture(page, "offline");
  await compose(page);
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Restore saved draft" }),
  ).toBeVisible();
  const other = "77777777-7777-4777-8777-777777777777";
  const user = {
    id: other,
    aud: "authenticated",
    role: "authenticated",
    email: "other@example.test",
    app_metadata: {},
    user_metadata: {},
    created_at: "2026-01-01T00:00:00Z",
  };
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const token = Buffer.from(
    JSON.stringify({
      sub: other,
      exp: expires,
      role: "authenticated",
      aud: "authenticated",
    }),
  ).toString("base64url");
  const session = {
    access_token: `eyJhbGciOiJIUzI1NiJ9.${token}.synthetic`,
    refresh_token: "other",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: expires,
    user,
  };
  await page.route(`${backend}/auth/v1/user`, (route) =>
    route.fulfill({ json: user }),
  );
  await page.route(`${backend}/rest/v1/profiles*`, (route) =>
    route.fulfill({
      json: [
        {
          id: other,
          full_name: "Other Staff",
          first_name: "Other",
          last_name: "Staff",
          is_active: true,
        },
      ],
    }),
  );
  await page.evaluate((value) => {
    localStorage.setItem("sb-127-auth-token", JSON.stringify(value));
    const channel = new BroadcastChannel("sb-127-auth-token");
    channel.postMessage({ event: "SIGNED_IN", session: value });
    setTimeout(() => channel.close(), 100);
  }, session);
  await expect(
    page.getByRole("region", { name: "Saved message recovery" }),
  ).toHaveCount(0);
  await page.getByRole("tab", { name: "Email", exact: true }).click();
  await expect(page.getByPlaceholder("Send EMAIL...")).toHaveValue("");
  await expect(page.getByPlaceholder("Subject", { exact: true })).toHaveValue(
    "",
  );
  expect([...state.prepared.values()][0].actor).toBe(staff);
  expect(state.requests).toHaveLength(1);
});

test("new-message sheet reopens its saved household draft with exact recipient", async ({
  page,
}) => {
  const state = await fixture(page, "offline");
  await page.goto("/hub/chats");
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByLabel("Household", { exact: true }).fill("Synthetic");
  await page
    .getByRole("button", { name: "Synthetic Household · +13035550123" })
    .click();
  await page
    .getByLabel("Message", { exact: true })
    .fill("Synthetic sheet draft");
  await page.getByRole("button", { name: "Send SMS", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Restore saved draft" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "New", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Restore saved draft" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Restore saved draft" }).click();
  await expect(page.getByLabel("Household", { exact: true })).toHaveValue(
    "Synthetic Household",
  );
  await expect(page.getByLabel("Recipient (SMS)", { exact: true })).toHaveValue(
    "+13035550123",
  );
  await expect(page.getByLabel("Message", { exact: true })).toHaveValue(
    "Synthetic sheet draft",
  );
  expect(state.requests).toHaveLength(1);
});

test("client dialog reload restores saved email subject and body instead of new defaults", async ({
  page,
}) => {
  const state = await fixture(page, "offline");
  const pet = "77777777-7777-4777-8777-777777777777";
  await page.route(`${backend}/rest/v1/rpc/list_native_refills`, (route) =>
    route.fulfill({
      json: {
        version: 1,
        refills: [{
          version: 1,
          refill: {
            id: "88888888-8888-4888-8888-888888888888",
            pet_id: pet,
            client_id: client,
            version: 1,
            state: "open",
            medication_requested: "Synthetic refill",
            requester_note: null,
            channel: "email",
            assigned_to: null,
            authorization_id: null,
            authorization_hash: null,
            created_by: staff,
            created_at: "2026-09-16T12:00:00Z",
            updated_by: staff,
            updated_at: "2026-09-16T12:00:00Z",
          },
          head_id: "99999999-9999-4999-8999-999999999999",
          current_household_id: client,
          household_matches: true,
          authorization_status: null,
          authorization_usage: null,
          operational_only: true,
        }],
        has_more: false,
        next_cursor: null,
      },
    }),
  );
  await page.goto("/hub/tools/refills");
  await page.getByRole("button", { name: "Compose neutral client update" }).click();
  const dialog = page.getByRole("dialog", { name: "Send to client" });
  await dialog.getByRole("button", { name: "Email", exact: true }).click();
  await dialog
    .getByPlaceholder("Subject", { exact: true })
    .fill("Exact saved client subject");
  await dialog
    .getByPlaceholder("Type message…")
    .fill("Exact saved client body");
  await dialog.getByRole("button", { name: "Send email", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "Restore saved draft" }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Compose neutral client update" }).click();
  await dialog.getByRole("button", { name: "Restore saved draft" }).click();
  await page.getByRole("button", { name: "Replace with saved draft" }).click();
  await expect(dialog.getByPlaceholder("Subject", { exact: true })).toHaveValue(
    "Exact saved client subject",
  );
  await expect(dialog.getByPlaceholder("Type message…")).toHaveValue(
    "Exact saved client body",
  );
  expect(state.requests).toHaveLength(1);
});
