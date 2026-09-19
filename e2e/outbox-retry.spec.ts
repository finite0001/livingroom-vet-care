import { test, expect, type Page } from "@playwright/test";
import { fixture, backend, actor } from "./invoice-email-fixture";
import type {
  RetryAction,
  RetryIntent,
} from "../src/hub/features/outbox-retry/OutboxRetryState";
const id = "11111111-1111-4111-8111-111111111191",
  time = "2026-09-12T12:00:00.123456+00:00",
  hash = "a".repeat(64);
async function setup(page: Page, baseURL: string | undefined) {
  await fixture(page, baseURL);
  const state = {
    admin: true,
    eligible: true,
    changed: false,
    changedSourceOnly: false,
    loss: "none",
    failRecover: false,
    actions: [] as RetryAction[],
    mutations: [] as RetryIntent[],
    calls: [] as { name: string; args: Record<string, unknown> }[],
  };
  await page.route(`${backend}/**`, async (route) => {
    const name = new URL(route.request().url()).pathname.split("/").pop()!;
    if (name === "user_roles")
      return route.fulfill({
        json: [{ role: state.admin ? "ADMIN" : "STAFF" }],
      });
    if (
      ![
        "preview_outbox_retry",
        "recover_outbox_retry",
        "requeue_outbox_retry",
        "list_outbox_retry_actions",
      ].includes(name)
    )
      return route.fallback();
    const args = route.request().postDataJSON();
    state.calls.push({ name, args });
    if (name === "preview_outbox_retry")
      return route.fulfill({
        json: {
          outbox: {
            id,
            conversation_id: id,
            client_id: id,
            message_id: id,
            created_by: actor,
            channel: "SMS",
            state: "failed",
            provider: "twilio",
            created_at: time,
            updated_at: time,
            revision: state.changed ? 3 : 1,
            attempt_count: 0,
            reason: "processing_review_required",
          },
          eligible: state.eligible,
          reason: state.eligible ? "eligible_for_requeue" : "source_ineligible",
          expected_work_hash:
            state.changed || state.changedSourceOnly ? "b".repeat(64) : hash,
          source: {
            family: "message",
            source_id: null,
            eligible: state.eligible,
          },
          history: state.actions,
          history_has_more: false,
        },
      });
    if (name === "list_outbox_retry_actions")
      return route.fulfill({ json: { items: state.actions, has_more: false } });
    if (name === "recover_outbox_retry") {
      if (state.failRecover) {
        state.failRecover = false;
        return route.abort();
      }
      return route.fulfill({
        json: state.actions.find((r) => r.id === args.p_id) ?? null,
      });
    }
    state.mutations.push(args);
    if (state.loss === "before") {
      state.loss = "none";
      return route.abort();
    }
    let r = state.actions.find((r) => r.id === args.p_id);
    if (!r) {
      r = {
        id: args.p_id,
        actor_id: actor,
        outbox_id: args.p_outbox_id,
        expected_work_hash: args.p_expected_work_hash,
        reason: args.p_reason,
        previous_revision: 1,
        queued_revision: 2,
        created_at: time,
      };
      state.actions.push(r);
    }
    if (state.loss === "after") {
      state.loss = "none";
      state.changed = true;
      state.failRecover = true;
      return route.abort();
    }
    return route.fulfill({ json: r });
  });
  return state;
}
async function review(page: Page) {
  await page.goto(`/hub/admin/outbox/${id}`);
  await page
    .getByLabel("Repair completed", { exact: true })
    .selectOption("configuration_repaired");
  await page.getByLabel(/I reviewed this exact outgoing work/).check();
}
test("late acknowledgment after later failure recovers original action without replay; history survives pointer loss", async ({
  page,
  baseURL,
}) => {
  const s = await setup(page, baseURL);
  await review(page);
  s.loss = "after";
  await page
    .getByRole("button", {
      name: "Request reviewed outgoing retry",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Recover original outgoing retry",
      exact: true,
    }),
  ).toBeEnabled();
  await page.reload();
  await expect(
    page.getByRole("region", { name: "Outgoing retry receipt", exact: true }),
  ).toBeVisible();
  expect(s.mutations).toHaveLength(1);
  expect(s.actions).toHaveLength(1);
  expect(s.calls.filter((c) => c.name === "preview_outbox_retry")).toHaveLength(
    1,
  );
  await page
    .getByRole("button", { name: "Close outgoing review", exact: true })
    .click();
  await page
    .getByLabel("Recorded action", { exact: true })
    .selectOption(s.actions[0].id);
  await expect(
    page.getByRole("region", { name: "Outgoing retry receipt", exact: true }),
  ).toContainText(s.actions[0].id);
  expect(s.mutations).toHaveLength(1);
});
test("missing receipt keeps original request through reload and unchanged work cleanup attempt", async ({
  page,
  baseURL,
}) => {
  const s = await setup(page, baseURL);
  await review(page);
  s.loss = "before";
  await page
    .getByRole("button", {
      name: "Request reviewed outgoing retry",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Check changed work before clearing draft",
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
    .getByRole("button", { name: "Retry exact outgoing request", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Outgoing retry receipt", exact: true }),
  ).toBeVisible();
  expect(s.mutations).toHaveLength(2);
  expect(s.mutations[0]).toEqual(s.mutations[1]);
});
test("source ineligibility blocks retry and staff cannot access administrator review", async ({
  page,
  baseURL,
}) => {
  const s = await setup(page, baseURL);
  s.eligible = false;
  await page.goto(`/hub/admin/outbox/${id}`);
  await expect(
    page.getByText("Original source is ineligible", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Request reviewed outgoing retry",
      exact: true,
    }),
  ).toHaveCount(0);
  s.admin = false;
  await page.reload();
  await expect(page).not.toHaveURL(/admin\/outbox/);
  expect(s.mutations).toHaveLength(0);
});
test("draft navigation and signout clear account-specific recovery state", async ({
  page,
  baseURL,
}) => {
  const s = await setup(page, baseURL);
  await review(page);
  await page
    .getByRole("link", { name: "Back to Operations", exact: true })
    .click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page
    .getByRole("button", { name: "Keep reviewing", exact: true })
    .click();
  s.loss = "before";
  await page
    .getByRole("button", {
      name: "Request reviewed outgoing retry",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Retry exact outgoing request",
      exact: true,
    }),
  ).toBeEnabled();
  await page.getByRole("button", { name: /sign out/i }).click();
  await expect(
    page.getByRole("heading", { name: "Outgoing retry review", exact: true }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      Object.keys(sessionStorage).some((k) =>
        k.startsWith("outbox-retry-intent:"),
      ),
    ),
  ).toBe(false);
});
test("changed work cleanup requires a second receipt read and makes no cancellation claim", async ({
  page,
  baseURL,
}) => {
  const s = await setup(page, baseURL);
  await review(page);
  s.loss = "before";
  await page
    .getByRole("button", {
      name: "Request reviewed outgoing retry",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Check changed work before clearing draft",
      exact: true,
    }),
  ).toBeEnabled();
  s.changed = true;
  await page
    .getByRole("button", {
      name: "Check changed work before clearing draft",
      exact: true,
    })
    .click();
  await expect(
    page.getByText(/Local draft cleared; no server operation was canceled/),
  ).toBeVisible();
  expect(s.calls.slice(-3).map((c) => c.name)).toEqual([
    "recover_outbox_retry",
    "preview_outbox_retry",
    "recover_outbox_retry",
  ]);
  expect(s.mutations).toHaveLength(1);
});

test("reversible source hash change cannot clear pending request at unchanged outbox revision", async ({
  page,
  baseURL,
}) => {
  const s = await setup(page, baseURL);
  await review(page);
  s.loss = "before";
  await page
    .getByRole("button", {
      name: "Request reviewed outgoing retry",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Check changed work before clearing draft",
      exact: true,
    }),
  ).toBeEnabled();
  s.changedSourceOnly = true;
  await page
    .getByRole("button", {
      name: "Check changed work before clearing draft",
      exact: true,
    })
    .click();
  await expect(
    page.getByText(/The original request could still complete/),
  ).toBeVisible();
  s.changedSourceOnly = false;
  await page.reload();
  await page
    .getByRole("button", { name: "Retry exact outgoing request", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Outgoing retry receipt", exact: true }),
  ).toBeVisible();
  expect(s.mutations[1]).toEqual(s.mutations[0]);
});
