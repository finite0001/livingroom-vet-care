import { expect, type Page, test } from "@playwright/test";
import { actor, backend, fixture } from "./invoice-email-fixture";
import type {
  StripeRetryCycle,
  StripeRetryIntent,
} from "../src/hub/features/payments/StripeRetryState";
const receiptId = "11111111-1111-4111-8111-111111111199";
async function setup(page: Page, baseURL: string | undefined) {
  await fixture(page, baseURL);
  const state = {
    admin: true,
    eligible: true,
    hash: "a".repeat(64),
    calls: [] as StripeRetryIntent[],
    cycles: [] as StripeRetryCycle[],
    lose: "none",
    completed: false,
  };
  await page.route(`${backend}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/user_roles")) {
      return route.fulfill({
        json: [{ role: state.admin ? "ADMIN" : "STAFF" }],
      });
    }
    if (path.endsWith("/read_stripe_event_queue_page")) {
      return route.fulfill({
        json: {
          items: [
            {
              created_at: "2026-09-01T12:00:00.123456+00:00",
              id: receiptId,
              event_type: "checkout.session.completed",
              work_state: state.cycles.length
                ? state.completed
                  ? "completed"
                  : "queued"
                : "quarantined",
              attempt_count: 5,
              cycle_no: state.cycles.length,
              cycle_attempt_count: state.cycles.length ? 0 : 5,
              work_reason: state.cycles.length ? "" : "retry_exhausted",
            },
          ],
          has_more: false,
        },
      });
    }
    if (path.endsWith("/preview_stripe_event_retry")) {
      return route.fulfill({
        json: {
          receipt: { id: receiptId },
          work: {
            receipt_id: receiptId,
            state: state.cycles.length
              ? state.completed
                ? "completed"
                : "queued"
              : "quarantined",
            attempt_count: 5,
            cycle_no: state.cycles.length,
            cycle_attempt_count: state.cycles.length ? 0 : 5,
          },
          eligible: state.eligible && !state.cycles.length,
          expected_work_hash: state.hash,
          cycles: state.cycles,
          history: [
            {
              action: "exhausted",
              reason: "provider_unavailable",
              attempt_count: 5,
              cycle_no: 0,
              created_at: new Date().toISOString(),
            },
          ],
        },
      });
    }
    if (path.endsWith("/requeue_stripe_event")) {
      const a = route.request().postDataJSON() as StripeRetryIntent;
      state.calls.push(a);
      if (state.lose === "before") {
        state.lose = "none";
        return route.abort("connectionfailed");
      }
      let c = state.cycles.find((c) => c.id === a.p_resolution_id);
      if (!c) {
        c = {
          id: a.p_resolution_id,
          receipt_id: a.p_receipt_id,
          actor_id: actor,
          cycle_no: 1,
          expected_work_hash: a.p_expected_work_hash,
          reason: a.p_reason,
          previous_attempt_count: 5,
          previous_cycle_attempt_count: 5,
          created_at: new Date().toISOString(),
        };
        state.cycles.push(c);
      }
      if (state.lose === "after") {
        state.lose = "none";
        return route.abort("connectionfailed");
      }
      return route.fulfill({ json: c });
    }
    return route.fallback();
  });
  return state;
}
for (const loss of ["before", "after"]) {
  test(`administrator retry ${loss} lost response preserves exact retry and history`, async ({
    page,
    baseURL,
  }) => {
    const state = await setup(page, baseURL);
    state.lose = loss;
    state.completed = loss === "after";
    await page.goto("/hub/admin");
    await page
      .getByLabel("Payment notification", { exact: true })
      .selectOption(receiptId);
    await page
      .getByRole("button", { name: "Review processing history" })
      .click();
    await expect(page.getByLabel("Processing attempts")).toContainText(
      "provider unavailable",
    );
    await expect(
      page.getByRole("button", { name: "Queue reviewed processing retry" }),
    ).toBeDisabled();
    await page.getByRole("checkbox").check();
    await page
      .getByRole("button", { name: "Queue reviewed processing retry" })
      .click();
    if (loss === "before") {
      await expect(
        page.getByText("Saved retry awaiting confirmation.", { exact: false }),
      ).toBeVisible();
      await page.reload();
      await expect(
        page.getByRole("button", { name: "Recover saved retry" }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Retry same reviewed request" })
        .click();
      expect(state.calls).toHaveLength(2);
      expect(state.calls[1]).toEqual(state.calls[0]);
    } else expect(state.calls).toHaveLength(1);
    await expect(
      page.getByText("Retry cycle 1 recorded.", { exact: false }),
    ).toBeVisible();
    expect(state.cycles).toHaveLength(1);
    const saved = await page.evaluate(() =>
      Object.keys(sessionStorage).filter((k) =>
        k.includes("stripe-event-retry"),
      ),
    );
    expect(saved).toEqual([]);
  });
}
test("ineligible and ordinary staff cannot queue administrator processing retries", async ({
  page,
  baseURL,
}) => {
  const state = await setup(page, baseURL);
  state.eligible = false;
  await page.goto("/hub/admin");
  await page
    .getByLabel("Payment notification", { exact: true })
    .selectOption(receiptId);
  await page.getByRole("button", { name: "Review processing history" }).click();
  await expect(
    page.getByText(
      "This notification cannot be retried through this workflow.",
      { exact: false },
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Queue reviewed processing retry" }),
  ).toHaveCount(0);
  state.admin = false;
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Payment processing recovery" }),
  ).toHaveCount(0);
  expect(state.calls).toHaveLength(0);
});
