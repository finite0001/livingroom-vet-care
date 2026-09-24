import { test, expect, type Page } from "@playwright/test";
import { backend, fixture } from "./invoice-email-fixture";
const id = "11111111-1111-4111-8111-111111111191",
  old = "11111111-1111-4111-8111-111111111192",
  time = "2026-09-12T12:00:00.123456+00:00";
async function setup(page: Page, baseURL: string | undefined) {
  await fixture(page, baseURL);
  const state = {
    admin: true,
    fail: false,
    evidence: false,
    calls: [] as { name: string; args: Record<string, unknown> }[],
  };
  await page.route(`${backend}/**`, async (route) => {
    const name = new URL(route.request().url()).pathname.split("/").pop()!;
    if (name === "user_roles")
      return route.fulfill({
        json: [{ role: state.admin ? "ADMIN" : "STAFF" }],
      });
    if (!name.startsWith("operations_") && !name.includes("stripe_event"))
      return route.fallback();
    const args = route.request().postDataJSON();
    state.calls.push({ name, args });
    if (name === "operations_overview")
      return route.fulfill({
        json: {
          observed_at: time,
          outbox: {
            pending: 0,
            expired_claims: 0,
            uncertain: 1,
            failed: 0,
            oldest_pending_at: null,
          },
          inbound: { processing_review: 0, unassigned: 0 },
          stripe: {
            queued: 0,
            processing: 0,
            quarantined: 1,
            oldest_unfinished_at: time,
          },
          reminders: {
            candidate_count: 0,
            blocked_handoffs: 0,
            oldest_candidate_at: null,
            last_run: null,
            last_completed_at: null,
            unresolved_runs: 0,
          },
        },
      });
    if (name === "operations_outbox") {
      if (state.fail)
        return route.fulfill({ status: 503, json: { message: "unavailable" } });
      return route.fulfill({
        json: {
          observed_at: time,
          has_more: !args.p_before_id,
          items: [
            {
              id: args.p_before_id ? old : id,
              conversation_id: id,
              client_id: id,
              message_id: id,
              channel: "EMAIL",
              state: "uncertain",
              reason: "processing_review_required",
              created_at: time,
              updated_at: time,
              attempt_count: 1,
              lease_expired: false,
              first_attempt_at: time,
              accepted_at: null,
              delivered_at: null,
              delivery_failure_kind: null,
            },
          ],
        },
      });
    }
    if (state.evidence && name === "operations_reminder_blocks")
      return route.fulfill({
        json: {
          observed_at: time,
          items: [
            {
              job_kind: "care",
              job_id: id,
              policy_id: id,
              outbox_id: null,
              state: "blocked",
              reason: "reminder_handoff_blocked",
              created_at: time,
              invalidated_at: null,
              source_kind: "lab",
              source_id: old,
              pet_id: id,
              appointment_id: null,
            },
          ],
          has_more: false,
        },
      });
    if (state.evidence && name === "operations_scheduler_jobs")
      return route.fulfill({
        json: {
          observed_at: time,
          jobs: [
            {
              job: "dispatch-outbox",
              requested_at: time,
              outcome: "ok",
              status_code: 202,
              error_message: null,
              stale: false,
            },
            {
              job: "process-inbound",
              requested_at: time,
              outcome: "configuration_missing",
              status_code: null,
              error_message: "Missing Vault secret(s): scheduler_worker_key",
              stale: false,
            },
            {
              job: "queue-reminders",
              requested_at: new Date(Date.now() - 3600_000).toISOString(),
              outcome: "failed",
              status_code: 401,
              error_message: null,
              stale: true,
            },
          ],
        },
      });
    if (state.evidence && name === "operations_scheduler_runs")
      return route.fulfill({
        json: {
          items: [
            {
              run_id: id,
              requested_limit: 50,
              started_at: time,
              outcome: "started",
              finished_at: null,
              counts: null,
              failure_code: null,
            },
          ],
          has_more: false,
        },
      });
    if (name === "read_stripe_event_queue_page")
      return route.fulfill({
        json: {
          items: [
            {
              id: args.p_before_id ? old : id,
              event_type: "checkout.session.completed",
              work_state: "quarantined",
              attempt_count: 5,
              cycle_no: 0,
              cycle_attempt_count: 5,
              work_reason: "retry_exhausted",
              created_at: time,
            },
          ],
          has_more: !args.p_before_id,
        },
      });
    if (name === "preview_stripe_event_retry")
      return route.fulfill({
        json: {
          receipt: { id: args.p_receipt_id },
          work: {
            receipt_id: args.p_receipt_id,
            state: "quarantined",
            attempt_count: 5,
            cycle_no: 0,
            cycle_attempt_count: 5,
          },
          eligible: false,
          expected_work_hash: "a".repeat(64),
          cycles: [],
          history: [],
        },
      });
    return route.fulfill({
      json: { observed_at: time, items: [], has_more: false },
    });
  });
  return state;
}
test("operations observes independent sections, exact cursors and safe workflow links without mutations", async ({
  page,
  baseURL,
}) => {
  const state = await setup(page, baseURL);
  await page.goto("/hub/admin/operations");
  await expect(
    page.getByText("No recorded run", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Open conversation" }),
  ).toHaveAttribute("href", `/hub/conversation/${id}`);
  await expect(
    page.getByRole("link", { name: "Open household billing" }),
  ).toHaveAttribute("href", `/hub/client/${id}`);
  await page
    .getByRole("button", { name: "Next outgoing work page", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Next outgoing work page", exact: true }),
  ).toBeDisabled();
  expect(
    state.calls.filter((c) => c.name === "operations_outbox").at(-1)?.args,
  ).toMatchObject({ p_before_at: time, p_before_id: id });
  state.fail = true;
  await page
    .getByRole("button", { name: "Refresh outgoing work", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Outgoing work", exact: true }),
  ).toContainText("This section is unavailable");
  await expect(
    page.getByRole("link", { name: "Open conversation" }),
  ).toHaveCount(0);
  await expect(
    page.getByText("No recorded run", { exact: true }),
  ).toBeVisible();
  expect(state.calls.every((c) => c.name.startsWith("operations_"))).toBe(true);
});
test("ordinary staff cannot observe administrator operations", async ({
  page,
  baseURL,
}) => {
  const state = await setup(page, baseURL);
  state.admin = false;
  await page.goto("/hub/admin/operations");
  await expect(
    page.getByRole("heading", { name: "Operations", exact: true }),
  ).toHaveCount(0);
  await expect(page).not.toHaveURL(/admin\/operations/);
  expect(state.calls).toHaveLength(0);
});
test("older unfinished payment notification reaches exact existing history preview", async ({
  page,
  baseURL,
}) => {
  const state = await setup(page, baseURL);
  await page.goto("/hub/admin");
  await page
    .getByRole("button", { name: "Older notifications", exact: true })
    .click();
  await page
    .getByLabel("Payment notification", { exact: true })
    .selectOption(old);
  await page
    .getByRole("button", { name: "Review processing history", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Newest notifications", exact: true }),
  ).toBeDisabled();
  expect(
    state.calls.filter((c) => c.name === "read_stripe_event_queue_page").at(-1)
      ?.args,
  ).toMatchObject({ p_state: null, p_before_at: time, p_before_id: id });
  expect(
    state.calls.find((c) => c.name === "preview_stripe_event_retry")?.args,
  ).toEqual({ p_receipt_id: old });
  expect(state.calls.some((c) => c.name.startsWith("requeue"))).toBe(false);
});

test("old blocked source and unresolved scheduler evidence have stable references", async ({
  page,
  baseURL,
}) => {
  const state = await setup(page, baseURL);
  state.evidence = true;
  await page.goto("/hub/admin/operations");
  const blocks = page.getByRole("region", {
    name: "Blocked reminder handoffs",
    exact: true,
  });
  await expect(blocks).toContainText(`Reminder job: ${id}`);
  await expect(blocks).toContainText(`Source: lab ${old}`);
  await expect(
    blocks.getByRole("link", { name: "Open source patient" }),
  ).toHaveAttribute("href", `/hub/patient/${id}`);
  const runs = page.getByRole("region", {
    name: "Scheduler runs",
    exact: true,
  });
  await expect(runs).toContainText(`Run reference: ${id}`);
  await expect(runs).toContainText("Started; outcome unknown");
  await expect(runs).toContainText("Queue counts unknown.");
  const jobs = page.getByRole("region", {
    name: "Scheduled jobs",
    exact: true,
  });
  await expect(jobs).toContainText("dispatch-outbox");
  await expect(jobs).toContainText("Worker accepted the call");
  await expect(jobs).toContainText("HTTP 202");
  await expect(jobs).toContainText("Installed but not configured");
  await expect(jobs).toContainText(
    "Missing Vault secret(s): scheduler_worker_key",
  );
  await expect(jobs).toContainText("Worker refused or failed the call");
  await expect(jobs).toContainText("HTTP 401");
  await expect(jobs).toContainText("overdue for its cadence");
});
