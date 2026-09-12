import { test, expect, type Page } from "@playwright/test";

const backend = "http://127.0.0.1:54321";
const staffId = "11111111-1111-4111-8111-111111111111";
const emailId = "44444444-4444-4444-8444-444444444444";
const smsId = "55555555-5555-4555-8555-555555555555";
const policyId = "66666666-6666-4666-8666-666666666666";
interface Policy {
  id: string;
  source_kind: string;
  channel: string;
  message_template_id: string;
  message_template_version: number;
  subject: string;
  enabled: boolean;
  review_note: string;
  version: number;
  approved_by: string;
  approved_at: string;
}
interface Call {
  name: string;
  args: Record<string, unknown>;
}
function existingPolicy(): Policy {
  return {
    id: policyId,
    source_kind: "appointment",
    channel: "EMAIL",
    message_template_id: emailId,
    message_template_version: 3,
    subject: "Saved appointment subject",
    enabled: true,
    review_note: "Prior review",
    version: 2,
    approved_by: staffId,
    approved_at: "2026-09-12T18:00:00Z",
  };
}
async function fixture(page: Page, baseURL: string | undefined, admin = true) {
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const user = {
    id: staffId,
    aud: "authenticated",
    role: "authenticated",
    email: "synthetic@example.test",
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {},
    created_at: "2026-01-01T00:00:00Z",
  };
  const jwt = Buffer.from(
    JSON.stringify({
      sub: staffId,
      exp: expires,
      role: "authenticated",
      aud: "authenticated",
    }),
  ).toString("base64url");
  const session = {
    access_token: `eyJhbGciOiJIUzI1NiJ9.${jwt}.synthetic`,
    refresh_token: "synthetic",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: expires,
    user,
  };
  await page.addInitScript(
    (value) => localStorage.setItem("sb-127-auth-token", JSON.stringify(value)),
    session,
  );
  const state = {
    policies: [] as Policy[],
    calls: [] as Call[],
    lostNext: false,
    conflictNext: false,
    committed: new Map<string, Policy>(),
    wording: [
      {
        id: emailId,
        name: "Reviewed email wording",
        channel: "email",
        version: 3,
        active: true,
        days_before: 7,
        body: "{{patient_name}}: {{care_name}} is due {{due_date}}.",
        review_note: "Synthetic reviewer",
      },
      {
        id: smsId,
        name: "Reviewed text wording",
        channel: "sms",
        version: 5,
        active: true,
        days_before: 2,
        body: "{{patient_name}}: {{care_name}} due {{due_date}}.",
        review_note: "Synthetic reviewer",
      },
    ],
  };
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin ===
    new URL(baseURL ?? "http://127.0.0.1:8080").origin
      ? route.continue()
      : route.abort(),
  );
  await page.route(`${backend}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/auth/v1/token") return route.fulfill({ json: session });
    if (path === "/auth/v1/user") return route.fulfill({ json: user });
    if (path === "/rest/v1/profiles")
      return route.fulfill({
        json: [
          {
            id: staffId,
            first_name: "Synthetic",
            last_name: "Staff",
            full_name: "Synthetic Staff",
            role: admin ? "ADMIN" : "STAFF",
            is_active: true,
          },
        ],
      });
    if (path === "/rest/v1/user_roles")
      return route.fulfill({ json: [{ role: admin ? "ADMIN" : "STAFF" }] });
    if (path === "/rest/v1/reminder_automation_policies")
      return route.fulfill({ json: state.policies });
    if (path === "/rest/v1/care_message_templates")
      return route.fulfill({ json: state.wording });
    if (path.startsWith("/rest/v1/rpc/")) {
      const name = path.split("/").at(-1)!;
      const args = route.request().postDataJSON();
      if (name === "inbox_unread_totals") return route.fulfill({ json: [] });
      state.calls.push({ name, args });
      if (
        name === "save_reminder_automation_policy" ||
        name === "disable_reminder_automation_policy"
      ) {
        if (state.conflictNext) {
          state.conflictNext = false;
          state.policies = [
            {
              ...existingPolicy(),
              version: 4,
              subject: "Remote reviewed subject",
            },
          ];
          return route.fulfill({
            status: 409,
            json: { code: "40001", message: "Policy version conflict" },
          });
        }
        const signature = JSON.stringify({ name, args });
        let row = state.committed.get(signature);
        if (!row) {
          const prior = state.policies.find((p) => p.id === args.p_id);
          expect(args.p_expected_version).toBe(prior?.version ?? null);
          row =
            name === "disable_reminder_automation_policy"
              ? {
                  ...prior!,
                  enabled: false,
                  version: prior!.version + 1,
                  review_note: args.p_review_note,
                }
              : {
                  id: args.p_id,
                  source_kind: args.p_source_kind,
                  channel: args.p_channel,
                  message_template_id: args.p_message_template_id,
                  message_template_version: args.p_message_template_version,
                  subject: args.p_subject,
                  enabled: args.p_enabled,
                  review_note: args.p_review_note,
                  version: (prior?.version ?? 0) + 1,
                  approved_by: staffId,
                  approved_at: "2026-09-12T18:00:00Z",
                };
          state.committed.set(signature, row);
          state.policies = [
            ...state.policies.filter((p) => p.id !== row!.id),
            row,
          ];
        }
        if (state.lostNext) {
          state.lostNext = false;
          return route.abort("failed");
        }
        return route.fulfill({ json: row });
      }
    }
    return route.fulfill({ json: [] });
  });
  return state;
}
async function openEmailPolicy(page: Page) {
  await page.goto("/hub/tools/care-reminders");
  await page
    .getByRole("button", {
      name: "Review appointments email policy",
      exact: true,
    })
    .click();
}
async function fillEmailPolicy(
  page: Page,
  reason = "Reviewed synthetic policy",
) {
  await page
    .getByLabel("Reviewed message wording", { exact: true })
    .selectOption(emailId);
  await page
    .getByLabel("Reminder email subject")
    .fill("Reviewed appointment reminder");
  await page.getByLabel("Enable this reviewed delivery policy").check();
  await page.getByLabel("Policy review reason").fill(reason);
}
const save = (page: Page) =>
  page
    .getByRole("button", { name: "Save reviewed delivery policy", exact: true })
    .click();

test("admin selects only same-channel reviewed wording and saves exact template version without dispatch", async ({
  page,
  baseURL,
}) => {
  const state = await fixture(page, baseURL);
  await openEmailPolicy(page);
  await expect(
    page.getByLabel("Reviewed message wording").locator("option"),
  ).toHaveCount(2);
  await expect(
    page
      .getByLabel("Reviewed message wording")
      .getByText("Reviewed text wording", { exact: false }),
  ).toHaveCount(0);
  await expect(
    page.getByLabel("Enable this reviewed delivery policy"),
  ).not.toBeChecked();
  await fillEmailPolicy(page);
  await expect(
    page.getByText(/wording offset is not applied again/),
  ).toBeVisible();
  await save(page);
  await expect(
    page.getByRole("status").filter({ hasText: "Delivery policy saved" }),
  ).toBeVisible();
  expect(state.calls.map((c) => c.name)).toEqual([
    "save_reminder_automation_policy",
  ]);
  expect(state.calls[0].args).toMatchObject({
    p_expected_version: null,
    p_channel: "EMAIL",
    p_message_template_id: emailId,
    p_message_template_version: 3,
    p_enabled: true,
  });
  await page.reload();
  await page
    .getByRole("button", {
      name: "Review appointments email policy",
      exact: true,
    })
    .click();
  await expect(page.getByLabel("Reminder email subject")).toHaveValue(
    "Reviewed appointment reminder",
  );
});

test("lost save response retries unchanged UUID and expected version with one saved revision", async ({
  page,
  baseURL,
}) => {
  const state = await fixture(page, baseURL);
  state.policies = [existingPolicy()];
  await openEmailPolicy(page);
  await fillEmailPolicy(page, "Preserve this review after response loss");
  state.lostNext = true;
  await save(page);
  await expect(
    page.getByRole("alert").filter({ hasText: "policy draft is retained" }),
  ).toBeVisible();
  await expect(page.getByLabel("Policy review reason")).toHaveValue(
    "Preserve this review after response loss",
  );
  await save(page);
  await expect(
    page.getByRole("status").filter({ hasText: "Delivery policy saved" }),
  ).toBeVisible();
  expect(state.calls).toHaveLength(2);
  expect(state.calls[1]).toEqual(state.calls[0]);
  expect(state.calls[0].args).toMatchObject({
    p_id: policyId,
    p_expected_version: 2,
  });
  expect(state.policies).toHaveLength(1);
  expect(state.policies[0].version).toBe(3);
});

test("retired wording can be disabled through the dedicated versioned RPC", async ({
  page,
  baseURL,
}) => {
  const state = await fixture(page, baseURL);
  state.policies = [existingPolicy()];
  state.wording[0].active = false;
  await openEmailPolicy(page);
  await expect(
    page.getByText(/needs a new wording review before delivery/),
  ).toBeVisible();
  await page.getByLabel("Enable this reviewed delivery policy").uncheck();
  await expect(page.getByLabel("Reviewed message wording")).toBeDisabled();
  await page
    .getByLabel("Policy review reason")
    .fill("Stop automation while retired wording is reviewed");
  await save(page);
  await expect(
    page.getByRole("status").filter({ hasText: "Delivery policy saved" }),
  ).toBeVisible();
  expect(state.calls).toEqual([
    {
      name: "disable_reminder_automation_policy",
      args: {
        p_id: policyId,
        p_expected_version: 2,
        p_review_note: "Stop automation while retired wording is reviewed",
      },
    },
  ]);
  expect(state.policies[0]).toMatchObject({
    enabled: false,
    version: 3,
    message_template_id: emailId,
    message_template_version: 3,
  });
});

test("version conflict retains local draft until explicit reload then uses current revision", async ({
  page,
  baseURL,
}) => {
  const state = await fixture(page, baseURL);
  state.policies = [existingPolicy()];
  await openEmailPolicy(page);
  await fillEmailPolicy(page, "Local unsaved review");
  state.conflictNext = true;
  await save(page);
  await expect(
    page.getByRole("alert").filter({ hasText: "policy draft is retained" }),
  ).toBeVisible();
  await expect(page.getByLabel("Reminder email subject")).toHaveValue(
    "Reviewed appointment reminder",
  );
  await expect(page.getByLabel("Policy review reason")).toHaveValue(
    "Local unsaved review",
  );
  page.once("dialog", (dialog) => dialog.dismiss());
  await page
    .getByRole("button", { name: "Reload saved delivery policy" })
    .click();
  await expect(page.getByLabel("Policy review reason")).toHaveValue(
    "Local unsaved review",
  );
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Reload saved delivery policy" })
    .click();
  await expect(page.getByLabel("Reminder email subject")).toHaveValue(
    "Remote reviewed subject",
  );
  await expect(page.getByLabel("Policy review reason")).toHaveValue("");
  await page
    .getByLabel("Policy review reason")
    .fill("Reviewed latest revision");
  await save(page);
  await expect(
    page.getByRole("status").filter({ hasText: "Delivery policy saved" }),
  ).toBeVisible();
  expect(state.calls.at(-1)?.args.p_expected_version).toBe(4);
});

test("wording and delivery drafts share one route guard and saving one does not clear the other", async ({
  page,
  baseURL,
}) => {
  await fixture(page, baseURL);
  await openEmailPolicy(page);
  await fillEmailPolicy(page);
  await page
    .getByRole("button", { name: "New reviewed reminder wording", exact: true })
    .click();
  await page
    .getByLabel("Reviewed setting name")
    .fill("Separate unsaved wording draft");
  await page.getByRole("button", { name: "Clients", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(1);
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(page.getByLabel("Reviewed setting name")).toHaveValue(
    "Separate unsaved wording draft",
  );
  await expect(page.getByLabel("Policy review reason")).toHaveValue(
    "Reviewed synthetic policy",
  );
  await save(page);
  await expect(
    page.getByRole("status").filter({ hasText: "Delivery policy saved" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Clients", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Discard and leave", exact: true })
    .click();
  await expect(page).toHaveURL(/\/hub\/clients$/);
});

test("staff can read care dashboard without administrator policy controls", async ({
  page,
  baseURL,
}) => {
  const state = await fixture(page, baseURL, false);
  await page.goto("/hub/tools/care-reminders");
  await expect(
    page.getByRole("heading", {
      name: "Care due dates and reminders",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Reminder delivery policies" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /Review appointments email policy/ }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "New reviewed reminder wording" }),
  ).toHaveCount(0);
  expect(state.calls).toHaveLength(0);
});
