import { test, expect, type Page } from "@playwright/test";
import { paymentFixture, reopenPayment } from "./payment-fixture";
import { actor, invoice, backend } from "./invoice-email-fixture";
import type { ReconciliationIntent } from "../src/hub/features/payments/ReconciliationState";
const request = "77777777-7777-4777-8777-777777777777",
  blocker = "88888888-8888-4888-8888-888888888888";
function makeCase(a: ReconciliationIntent) {
  const created_at = new Date().toISOString();
  const capture = {
    case_id: a.p_case_id,
    proof_hash: "c".repeat(64),
    provider_observed_at: created_at,
    created_at,
    evidence: {
      family: a.p_family,
      request_id: a.p_request_id,
      object_id: a.p_provider_object_id,
      account_id: "acct_fixture",
      livemode: false,
      amount_cents: "12500",
      currency: "usd",
      provider_observed_at: created_at,
      status: "session_expired",
      payment_id: null,
      source_hash: "a".repeat(64),
    },
  };
  return {
    case: {
      id: a.p_case_id,
      invoice_id: invoice,
      actor_id: actor,
      family: a.p_family,
      request_id: a.p_request_id,
      provider_object_id: a.p_provider_object_id,
      blocker_refs: a.p_blocker_refs,
      snapshot_hash: a.p_expected_case_hash,
      created_at,
    },
    capture: capture as typeof capture | null,
    resolution: null as null | {
      case_id: string;
      actor_id: string;
      proof_hash: string;
      ledger_evidence_id: string;
      created_at: string;
    },
  };
}
async function setup(page: Page, baseURL: string | undefined) {
  const payment = await paymentFixture(page, baseURL);
  payment.state.data.attempts = [
    {
      id: request,
      invoice_id: invoice,
      client_id: payment.state.data.client_id,
      actor_id: actor,
      amount_cents: "12500",
      source_hash: "a".repeat(64),
      created_at: new Date().toISOString(),
      state: "reconciliation",
    },
  ];
  payment.state.data.reconciliation_observations = [
    {
      id: blocker,
      family: "checkout",
      request_id: request,
      reason: "provider_object_unavailable",
      created_at: new Date().toISOString(),
    },
  ];
  const target = {
    family: "checkout",
    request_id: request,
    provider_object_id: "cs_fixture",
    amount_cents: "12500",
    currency: "usd",
    state: "reconciliation",
    reviewable: true,
  };
  const state = {
    admin: true,
    known: true,
    loss: "none",
    recoverFail: false,
    rows: [] as ReturnType<typeof makeCase>[],
    prepares: [] as ReconciliationIntent[],
    completes: [] as Record<string, unknown>[],
    previews: 0,
  };
  await page.route(`${backend}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/user_roles"))
      return route.fulfill({
        json: [{ role: state.admin ? "ADMIN" : "STAFF" }],
      });
    if (path.endsWith("/list_payment_reconciliation_workspace"))
      return route.fulfill({
        json: {
          invoice_id: invoice,
          targets: state.known ? [target] : [],
          cases: state.rows,
          has_more_cases: false,
        },
      });
    if (path.endsWith("/verify-payment-reconciliation")) {
      const body = route.request().postDataJSON();
      if (body.action === "preview") {
        state.previews++;
        return route.fulfill({
          json: {
            invoice_id: invoice,
            ...target,
            account_id: "acct_fixture",
            livemode: false,
            blocker_refs: [{ kind: "observation", id: blocker }],
            snapshot_hash: "a".repeat(64),
          },
        });
      }
      if (body.action === "recover") {
        if (state.recoverFail) return route.abort("connectionfailed");
        return route.fulfill({
          contentType: "application/json",
          json: state.rows.find((r) => r.case.id === body.p_case_id) ?? null,
        });
      }
      expect(body.action).toBe("prepare");
      const { action: _action, ...args } = body as ReconciliationIntent & {
        action: string;
      };
      state.prepares.push(args);
      if (state.loss === "before") {
        state.loss = "none";
        return route.abort("connectionfailed");
      }
      let row = state.rows.find((r) => r.case.id === args.p_case_id);
      if (!row) {
        row = makeCase(args);
        state.rows.unshift(row);
      }
      if (state.loss === "after") {
        state.loss = "none";
        return route.abort("connectionfailed");
      }
      return route.fulfill({ json: row });
    }
    if (path.endsWith("/complete_payment_reconciliation")) {
      const args = route.request().postDataJSON();
      state.completes.push(args);
      const row = state.rows.find((r) => r.case.id === args.p_case_id)!;
      expect(args).toEqual({
        p_case_id: row.case.id,
        p_reviewed_proof_hash: row.capture!.proof_hash,
        p_expected_case_hash: row.case.snapshot_hash,
        p_attest: true,
      });
      row.resolution ??= {
        case_id: row.case.id,
        actor_id: actor,
        proof_hash: row.capture!.proof_hash,
        ledger_evidence_id: "99999999-9999-4999-8999-999999999999",
        created_at: new Date().toISOString(),
      };
      payment.state.data.reconciliation_observations[0].resolved = true;
      payment.state.data.attempts[0].state = "expired";
      if (state.loss === "complete") {
        state.loss = "none";
        return route.abort("connectionfailed");
      }
      return route.fulfill({ json: row });
    }
    return route.fallback();
  });
  await reopenPayment(page);
  const panel = page.getByRole("region", {
    name: "Administrator payment reconciliation",
    exact: true,
  });
  await expect(panel.getByLabel("Existing payment request")).toBeEnabled();
  return { panel, state, target, payment };
}
async function preview(panel: ReturnType<Page["getByRole"]>) {
  await panel
    .getByLabel("Existing payment request")
    .selectOption(`checkout:${request}`);
  await panel
    .getByRole("button", { name: "Preview exact reconciliation blockers" })
    .click();
  await expect(
    panel.getByRole("heading", { name: "Review the frozen blocker set" }),
  ).toBeVisible();
  await panel.getByRole("checkbox").check();
}
for (const loss of ["before", "after"])
  test(`administrator reconciliation ${loss} lost proof request recovers same case`, async ({
    page,
    baseURL,
  }) => {
    const { panel, state, payment } = await setup(page, baseURL);
    await preview(panel);
    state.loss = loss;
    state.recoverFail = loss === "after";
    await expect(
      page.getByRole("button", { name: /issued.*125.00/ }).first(),
    ).toBeDisabled();
    await panel
      .getByRole("button", {
        name: "Prepare review and fetch fresh provider proof",
      })
      .click();
    if (loss === "after") {
      await expect(panel.getByText(/response is uncertain/)).toBeVisible();
      state.recoverFail = false;
    } else
      await expect(
        panel.getByRole("button", {
          name: "Retry same case and fetch fresh proof",
        }),
      ).toBeEnabled();
    await reopenPayment(page);
    if (loss === "before")
      await panel
        .getByRole("button", { name: "Retry same case and fetch fresh proof" })
        .click();
    await expect(
      panel.getByText("Checkout expired without payment."),
    ).toBeVisible();
    expect(new Set(state.prepares.map((a) => a.p_case_id)).size).toBe(1);
    expect(
      new Set(state.prepares.map((a) => JSON.stringify(a.p_blocker_refs))).size,
    ).toBe(1);
    await panel.getByRole("checkbox").check();
    await panel
      .getByRole("button", { name: "Record reviewed reconciliation" })
      .click();
    await expect(
      panel.getByText(/Resolution recorded .*Original blocker history/),
    ).toBeVisible();
    expect(state.completes).toHaveLength(1);
    expect(payment.state.providerCalls).toHaveLength(0);
    const storage = await page.evaluate(() => JSON.stringify(sessionStorage));
    expect(storage).not.toContain("provider_observed_at");
    expect(storage).not.toContain("proof_hash");
  });
test("lost completion recovers durable receipt without another provider read or completion", async ({
  page,
  baseURL,
}) => {
  const { panel, state, payment } = await setup(page, baseURL);
  await preview(panel);
  await panel
    .getByRole("button", {
      name: "Prepare review and fetch fresh provider proof",
    })
    .click();
  await panel.getByRole("checkbox").check();
  state.loss = "complete";
  await panel
    .getByRole("button", { name: "Record reviewed reconciliation" })
    .click();
  await expect(panel.getByText(/response is uncertain/)).toBeVisible();
  await panel
    .getByRole("button", { name: "Recover reconciliation and refresh history" })
    .click();
  await expect(
    panel.getByText(/Resolution recorded .*Original blocker history/),
  ).toBeVisible();
  expect(state.prepares).toHaveLength(1);
  expect(state.completes).toHaveLength(1);
  await reopenPayment(page);
  await panel
    .getByLabel("Reconciliation history")
    .selectOption(state.rows[0].case.id);
  await expect(
    panel.getByText(/Resolution recorded .*Original blocker history/),
  ).toBeVisible();
  expect(payment.state.providerCalls).toHaveLength(0);
});
test("missing objects and expired proof remain unavailable and ordinary staff cannot resolve", async ({
  page,
  baseURL,
}) => {
  const { panel, state } = await setup(page, baseURL);
  state.known = false;
  await panel
    .getByRole("button", { name: "Recover reconciliation and refresh history" })
    .click();
  await panel
    .getByLabel("Existing payment request")
    .selectOption(`checkout:${request}`);
  await expect(
    panel.getByText(/No securely attributed provider object/),
  ).toBeVisible();
  await expect(
    panel.getByRole("button", {
      name: "Preview exact reconciliation blockers",
    }),
  ).toBeDisabled();
  state.known = true;
  await panel
    .getByRole("button", { name: "Recover reconciliation and refresh history" })
    .click();
  await preview(panel);
  await panel
    .getByRole("button", {
      name: "Prepare review and fetch fresh provider proof",
    })
    .click();
  await expect(
    panel.getByText("Checkout expired without payment."),
  ).toBeVisible();
  const old = new Date(Date.now() - 6 * 60000).toISOString();
  state.rows[0].capture!.provider_observed_at = old;
  state.rows[0].capture!.evidence.provider_observed_at = old;
  await panel
    .getByRole("button", { name: "Recover reconciliation and refresh history" })
    .click();
  await expect(
    panel.getByText(/five-minute proof window has expired/),
  ).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "Record reviewed reconciliation" }),
  ).toBeDisabled();
  state.admin = false;
  await reopenPayment(page);
  await expect(panel).toHaveCount(0);
  expect(state.completes).toHaveLength(0);
});
