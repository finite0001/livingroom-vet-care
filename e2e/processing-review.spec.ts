import { test, expect, type Page } from "@playwright/test";
const backend = "http://127.0.0.1:54321",
  actor = "11111111-1111-4111-8111-111111111111",
  eventId = "22222222-2222-4222-8222-222222222222",
  otherId = "33333333-3333-4333-8333-333333333333",
  date = "2026-09-12T12:00:00.000Z",
  hash = "a".repeat(64);
interface Row {
  // Synthetic database projections intentionally use several row contracts.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}
async function fixture(page: Page, role = "ADMIN") {
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
  const original = {
    id: eventId,
    provider: "resend",
    event_id: "signed-provider-event",
    resource_id: "received-email",
    event_type: "inbound",
    state: "review",
    attempts: 10,
    cycle_no: 0,
    cycle_attempts: 10,
    received_at: date,
    available_at: date,
    last_error: "provider_fetch_or_persistence_retry",
    revision: 21,
  };
  const state = {
    events: [
      original,
      {
        ...original,
        id: otherId,
        provider: "twilio",
        event_id: "signed-sms-event",
        resource_id: "inbound-sms",
        attempts: 2,
        cycle_attempts: 2,
        last_error: "provider_content_requires_review",
      },
    ] as Row[],
    receipts: [] as Row[],
    calls: [] as { path: string; body: Row }[],
    failBefore: false,
    failAfter: false,
    failRecover: false,
    stale: false,
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
    const path = new URL(route.request().url()).pathname;
    if (path === "/auth/v1/user") return route.fulfill({ json: user });
    if (path === "/auth/v1/token") return route.fulfill({ json: session });
    if (path === "/rest/v1/profiles")
      return route.fulfill({
        json: [
          {
            id: actor,
            first_name: "Synthetic",
            last_name: "Operator",
            full_name: "Synthetic Operator",
            role,
            is_active: true,
          },
        ],
      });
    if (path === "/rest/v1/user_roles")
      return route.fulfill({ json: [{ role }] });
    if (!path.startsWith("/rest/v1/rpc/")) return route.fulfill({ json: [] });
    const b = route.request().postDataJSON();
    state.calls.push({ path, body: b });
    if (path.endsWith("list_communication_processing_queue"))
      return route.fulfill({
        json: {
          events: state.events.filter((e) =>
            !b.p_state ? e.state !== "processed" : e.state === b.p_state,
          ),
          has_more: false,
        },
      });
    if (path.endsWith("list_communication_event_retries")) {
      expect(role).toBe("ADMIN");
      return route.fulfill({
        json: { retries: state.receipts, has_more: false },
      });
    }
    if (path.endsWith("preview_communication_event_retry")) {
      expect(role).toBe("ADMIN");
      const e = state.events.find((e) => e.id === b.p_event_id)!;
      return route.fulfill({
        json: {
          event: e,
          eligible:
            e.state === "review" &&
            e.cycle_attempts === 10 &&
            e.last_error === "provider_fetch_or_persistence_retry",
          expected_work_hash: state.stale ? "b".repeat(64) : hash,
          history: [
            {
              id: 1,
              event_id: e.id,
              action: "legacy_snapshot",
              state: e.state,
              attempts: e.attempts,
              cycle_no: e.cycle_no,
              cycle_attempts: e.cycle_attempts,
              revision: e.revision,
              last_error: e.last_error,
              created_at: date,
            },
          ],
          history_has_more: false,
          retries: state.receipts.filter((r) => r.event_id === e.id),
        },
      });
    }
    if (path.endsWith("recover_communication_event_retry")) {
      expect(role).toBe("ADMIN");
      if (state.failRecover) {
        state.failRecover = false;
        return route.abort();
      }
      return route.fulfill({
        contentType: "application/json",
        json: state.receipts.find((r) => r.id === b.p_id) ?? null,
      });
    }
    if (path.endsWith("requeue_communication_event")) {
      expect(role).toBe("ADMIN");
      if (state.failBefore) {
        state.failBefore = false;
        return route.abort();
      }
      if (state.stale)
        return route.fulfill({
          status: 409,
          json: { code: "40001", message: "Work changed" },
        });
      const r = {
        id: b.p_id,
        actor_id: actor,
        event_id: b.p_event_id,
        expected_work_hash: b.p_expected_work_hash,
        reason: b.p_reason,
        previous_cycle_no: 0,
        cycle_no: 1,
        lifetime_attempts: 10,
        created_at: date,
      };
      state.receipts.push(r);
      state.events[0] = {
        ...state.events[0],
        state: "pending",
        cycle_no: 1,
        cycle_attempts: 0,
        last_error: null,
        revision: 22,
      };
      if (state.failAfter) {
        state.failAfter = false;
        state.failRecover = true;
        return route.abort();
      }
      return route.fulfill({ json: r });
    }
    return route.fulfill({ json: [] });
  });
  return state;
}
async function open(page: Page) {
  await page.goto("/hub/inbox/processing");
  await expect(
    page.getByRole("button", {
      name: "Refresh processing and recover retry",
      exact: true,
    }),
  ).toBeEnabled();
}
async function review(page: Page) {
  await page
    .getByRole("button", {
      name: "Review processing event 22222222",
      exact: true,
    })
    .click();
  await page
    .getByLabel("Repair completed before retry", { exact: true })
    .selectOption("configuration_repaired");
  await page
    .getByLabel(/I reviewed this exact exhausted processing cycle/)
    .check();
}
test("staff reads only safe queue while ADMIN-only processing operations remain absent", async ({
  page,
}) => {
  const state = await fixture(page, "STAFF");
  await open(page);
  await expect(
    page.getByText("Provider content requires separate review", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Review processing event/ }),
  ).toHaveCount(0);
  await page
    .getByLabel("Processing state", { exact: true })
    .selectOption("processed");
  await expect(
    page.getByText("No processing work on this page.", { exact: true }),
  ).toBeVisible();
  expect(
    state.calls.some((c) =>
      /preview_communication|list_communication_event_retries|requeue_communication/.test(
        c.path,
      ),
    ),
  ).toBe(false);
});
test("lost retry acknowledgment recovers receipt first without another cycle or eligibility refresh", async ({
  page,
}) => {
  const state = await fixture(page);
  await open(page);
  await review(page);
  state.failAfter = true;
  await page
    .getByRole("button", {
      name: "Request reviewed processing retry",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Retry original processing request",
      exact: true,
    }),
  ).toBeEnabled();
  await page.reload();
  await expect(
    page.getByRole("region", { name: "Processing retry receipt", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Cycle 0 → 1 · 10 lifetime attempts retained", {
      exact: true,
    }),
  ).toBeVisible();
  expect(state.receipts).toHaveLength(1);
  expect(
    state.calls.filter((c) => c.path.endsWith("requeue_communication_event")),
  ).toHaveLength(1);
  expect(
    state.calls.filter((c) =>
      c.path.endsWith("preview_communication_event_retry"),
    ),
  ).toHaveLength(1);
  await page
    .getByRole("button", { name: "Close processing review", exact: true })
    .click();
  await page
    .getByLabel("Recover a recorded retry", { exact: true })
    .selectOption(state.receipts[0].id);
  await expect(
    page.getByRole("region", { name: "Processing retry receipt", exact: true }),
  ).toBeVisible();
});
test("pre-commit retry preserves exact UUID/hash/reason across reload", async ({
  page,
}) => {
  const state = await fixture(page);
  await open(page);
  await review(page);
  state.failBefore = true;
  await page
    .getByRole("button", {
      name: "Request reviewed processing retry",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Retry original processing request",
      exact: true,
    }),
  ).toBeEnabled();
  await page.reload();
  await page
    .getByRole("button", {
      name: "Check changed work before clearing draft",
      exact: true,
    })
    .click();
  await expect(
    page.getByText(/The original request could still complete/),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "Retry original processing request",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("region", { name: "Processing retry receipt", exact: true }),
  ).toBeVisible();
  const calls = state.calls.filter((c) =>
    c.path.endsWith("requeue_communication_event"),
  );
  expect(calls).toHaveLength(2);
  expect(calls[0].body).toEqual(calls[1].body);
  expect(state.receipts).toHaveLength(1);
});
test("content failure cannot be retried; stale reviewed hash stays pending until explicit discard and auth cleanup", async ({
  page,
}) => {
  const state = await fixture(page);
  await open(page);
  await page
    .getByRole("button", {
      name: "Review processing event 33333333",
      exact: true,
    })
    .click();
  await expect(
    page.getByText(/A retry is unavailable for this snapshot/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Request reviewed processing retry",
      exact: true,
    }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Close processing review", exact: true })
    .click();
  await review(page);
  state.stale = true;
  await page
    .getByRole("button", {
      name: "Request reviewed processing retry",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Check changed work before clearing draft",
      exact: true,
    }),
  ).toBeEnabled();
  expect(state.receipts).toHaveLength(0);
  await page.getByRole("button", { name: /sign out/i }).click();
  await expect(
    page.getByRole("heading", {
      name: "Communication processing",
      exact: true,
    }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      Object.keys(sessionStorage).some((k) =>
        k.startsWith("communication-processing-intent:"),
      ),
    ),
  ).toBe(false);
});

test("changed work permits local draft cleanup only after another exact receipt check", async ({
  page,
}) => {
  const state = await fixture(page);
  await open(page);
  await review(page);
  state.stale = true;
  await page
    .getByRole("button", {
      name: "Request reviewed processing retry",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", {
      name: "Check changed work before clearing draft",
      exact: true,
    })
    .click();
  await expect(
    page.getByText(
      /Local retry draft cleared; no server operation was canceled/,
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Retry original processing request",
      exact: true,
    }),
  ).toHaveCount(0);
  const calls = state.calls.map((c) => c.path.split("/").pop()).filter((name) =>
    name === "recover_communication_event_retry" || name === "preview_communication_event_retry",
  );
  expect(calls.slice(-3)).toEqual([
    "recover_communication_event_retry",
    "preview_communication_event_retry",
    "recover_communication_event_retry",
  ]);
  expect(state.receipts).toHaveLength(0);
});
