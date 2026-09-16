import { test, expect, type Page } from "@playwright/test";
import {
  actor,
  id,
  hash,
  time,
  dispense,
} from "../tests/prescriptions/fulfillment-fixture";
import type {
  FinanceSnapshot,
  FinanceResult,
  FinanceReceipt,
  FinanceRequest,
  FinanceIntent,
} from "../src/hub/features/prescriptions/dispense-finance-api";
async function workspace(page: Page) {
  const fill = dispense(),
    target = {
      authorization_id: fill.authorization_id,
      pet_id: fill.pet_id,
      dispense_id: fill.id,
    };
  const results: FinanceResult[] = [],
    receipts = new Map<string, FinanceReceipt>(),
    calls: { id: string; request: FinanceRequest }[] = [];
  const control = { lose: false, reject: false };
  function snapshot(): FinanceSnapshot {
    const credited = results
        .filter((r) => r.action === "credit")
        .reduce((a, r) => a + BigInt(r.amount_cents), 0n),
      reserved = results
        .filter((r) => r.action === "refund")
        .reduce((a, r) => a + BigInt(r.amount_cents), 0n),
      empty = { event_id: null, version: 0, record_hash: null };
    return {
      target,
      authorization_hash: fill.authorization_hash,
      dispense_document_hash: fill.artifact_hash,
      invoice: {
        id: fill.invoice_id,
        client_id: id(91),
        item_id: fill.invoice_item_id,
        version: 1,
        status: "issued",
        currency: "usd",
        total_cents: "1000",
        item_amount_cents: "1000",
      },
      source_heads: { correction: empty, returns: empty, discrepancy: empty },
      clinical_context_hash: hash,
      financial_context_hash: hash,
      credits: results
        .filter((r) => r.action === "credit")
        .map((r) => ({
          id: r.id,
          amount_cents: r.amount_cents,
          reason: r.reason,
          actor_id: actor,
          created_at: r.created_at,
          dispense_id: fill.id,
        }))
        .sort((a, b) => a.id.localeCompare(b.id)),
      payments: [
        {
          id: id(92),
          amount_cents: "1000",
          remaining_cents: String(1000n - reserved),
        },
      ],
      refunds: results
        .filter((r) => r.action === "refund")
        .map((r) => ({
          id: r.id,
          payment_id: r.payment_id!,
          amount_cents: r.amount_cents,
          reason: r.reason,
          actor_id: actor,
          created_at: r.created_at,
          state: "pending" as const,
          settled: false,
          credit_id: r.credit_id,
          dispense_id: fill.id,
        }))
        .sort((a, b) => a.id.localeCompare(b.id)),
      balance: {
        obligation_cents: String(1000n - credited),
        paid_cents: "1000",
        refunded_cents: "0",
        net_cash_cents: "1000",
        outstanding_cents: "0",
        pending_refund_cents: String(reserved),
        refundable_cents: String(credited - reserved),
      },
      capacity: {
        linked_credit_cents: String(credited),
        unallocated_credit_cents: "0",
        item_credit_capacity_cents: String(1000n - credited),
        invoice_credit_capacity_cents: String(1000n - credited),
        credit_capacity_cents: String(1000n - credited),
      },
      blockers: [],
    };
  }
  const contexts = new Map<
    string,
    {
      snapshot: FinanceSnapshot;
      intent: FinanceIntent;
      eligible_amount_cents: string;
    }
  >();
  await page.route("**/rest/v1/rpc/*", async (route) => {
    const name = route.request().url().split("/").at(-1),
      args = route.request().postDataJSON();
    let value: unknown;
    if (name === "read_native_dispense_finance")
      value = {
        version: 1,
        actor_id: actor,
        snapshot: snapshot(),
        results: [...results].sort(
          (a, b) =>
            a.created_at.localeCompare(b.created_at) ||
            a.id.localeCompare(b.id),
        ),
      };
    else if (name === "preview_native_dispense_finance") {
      const intent = args.p_intent as FinanceIntent,
        s = snapshot(),
        eligible =
          intent.action === "credit"
            ? s.capacity.credit_capacity_cents
            : s.balance!.refundable_cents,
        c = { snapshot: s, intent, eligible_amount_cents: eligible };
      contexts.set(hash, c);
      const blockers =
        BigInt(intent.amount_cents) > BigInt(eligible)
          ? [
              intent.action === "credit"
                ? "credit_capacity_exceeded"
                : "refund_capacity_exceeded",
            ]
          : [];
      value = {
        version: 1,
        actor_id: actor,
        observed_at: time,
        context: c,
        context_hash: hash,
        allowed: !blockers.length,
        blockers,
      };
    } else if (name === "record_native_dispense_finance") {
      calls.push({ id: args.p_id, request: args.p_request });
      if (control.reject) {
        await route.fulfill({
          status: 409,
          json: { code: "40001", message: "Reviewed evidence changed" },
        });
        return;
      }
      if (!receipts.has(args.p_id)) {
        const q = args.p_request as FinanceRequest,
          c = contexts.get(q.expected_context_hash)!,
          r: FinanceResult = {
            id: args.p_id,
            target,
            action: q.intent.action,
            actor_id: actor,
            created_at: new Date(
              Date.parse(time) + results.length * 1000,
            ).toISOString(),
            invoice_id: fill.invoice_id,
            invoice_item_id: fill.invoice_item_id,
            credit_id:
              q.intent.action === "credit" ? args.p_id : q.intent.credit_id!,
            refund_request_id: q.intent.action === "refund" ? args.p_id : null,
            payment_id: q.intent.payment_id,
            amount_cents: q.intent.amount_cents,
            currency: "usd",
            reason: q.intent.reason,
            reviewed_context: c,
            reviewed_context_hash: hash,
            record_hash: hash,
          };
        results.push(r);
        receipts.set(args.p_id, {
          version: 1,
          id: args.p_id,
          actor_id: actor,
          request: q,
          request_hash: hash,
          result: r,
          created_at: r.created_at,
        });
      }
      if (control.lose) {
        await route.abort("failed");
        return;
      }
      value = receipts.get(args.p_id);
    } else if (name === "recover_native_dispense_finance")
      value = receipts.get(args.p_id) ?? null;
    else {
      await route.fulfill({ json: null });
      return;
    }
    await route.fulfill({ json: value });
  });
  async function mount(recovery = false) {
    await page.goto("/");
    await page.evaluate(
      async ({ actor, fill }) => {
        const harness = await import(
          "/tests/prescriptions/finance-browser-harness.tsx"
        );
        harness.mountFinance(actor, fill);
      },
      { actor, fill },
    );
    await expect(
      page.getByRole("heading", {
        name: "Credit and refund review · Synthetic medication",
      }),
    ).toBeVisible({ timeout: 30000 });
    await expect(
      page.getByRole("button", {
        name: recovery
          ? "Recover original financial request"
          : "Review financial evidence",
      }),
    ).toBeEnabled();
  }
  await mount();
  return { control, calls, results, mount };
}
async function review(page: Page) {
  await page.getByLabel("Amount in dollars").fill("2.50");
  await page.getByLabel("Financial reason").fill("Duplicate charge");
  await page.getByRole("button", { name: "Review financial evidence" }).click();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Lock reviewed request" }).click();
  await page
    .getByRole("button", { name: "Record reviewed financial operation" })
    .click();
}
test("credit and linked refund are separate reviews without provider execution", async ({
  page,
}) => {
  const w = await workspace(page);
  await review(page);
  await expect(
    page.getByText(
      "The exact financial operation was confirmed in the ledger.",
    ),
  ).toBeVisible();
  expect(w.results).toHaveLength(1);
  await page.getByLabel("Financial action").selectOption("refund");
  await page
    .getByLabel("Recorded dispense credit")
    .selectOption(w.results[0].id);
  await page.getByLabel("Captured payment").selectOption(id(92));
  await review(page);
  await expect(
    page.getByText("Current refund outcome: pending.", { exact: false }),
  ).toBeVisible();
  expect(w.calls).toHaveLength(2);
  expect(w.results[1].credit_id).toBe(w.results[0].id);
});
test("lost reply survives reload and recovers exact request without second write", async ({
  page,
}) => {
  const w = await workspace(page);
  w.control.lose = true;
  await review(page);
  await expect(
    page.getByRole("button", { name: "Recover original financial request" }),
  ).toBeVisible();
  expect(w.calls).toHaveLength(1);
  await w.mount(true);
  await expect(
    page.getByRole("button", { name: "Recover original financial request" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Recover original financial request" })
    .click();
  await expect(
    page.getByText(
      "The exact financial operation was confirmed in the ledger.",
    ),
  ).toBeVisible();
  expect(w.calls).toHaveLength(1);
  expect(w.results).toHaveLength(1);
});

test("blocked amount cannot lock a write and stale server review retains the draft", async ({
  page,
}) => {
  const w = await workspace(page);
  await page.getByLabel("Amount in dollars").fill("20");
  await page.getByLabel("Financial reason").fill("Review amount");
  await page.getByRole("button", { name: "Review financial evidence" }).click();
  await expect(
    page.getByText("The amount exceeds the available credit allowance."),
  ).toBeVisible();
  await page.getByRole("checkbox").check();
  await expect(
    page.getByRole("button", { name: "Lock reviewed request" }),
  ).toBeDisabled();
  expect(w.calls).toHaveLength(0);
  w.control.reject = true;
  await review(page);
  await expect(
    page.getByText("The server rejected this operation.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByLabel("Amount in dollars")).toHaveValue("2.50");
  await expect(
    page.getByRole("button", { name: "Lock reviewed request" }),
  ).toHaveCount(0);
  expect(w.results).toHaveLength(0);
});
test("sibling invoice invalidation preserves a locked review and requires new evidence", async ({
  page,
}) => {
  const w = await workspace(page);
  await page.getByLabel("Amount in dollars").fill("2.50");
  await page.getByLabel("Financial reason").fill("Duplicate charge");
  await page.getByRole("button", { name: "Review financial evidence" }).click();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Lock reviewed request" }).click();
  await page.evaluate(async (invoiceId) => {
    const h = await import("/tests/prescriptions/finance-browser-harness.tsx");
    await h.invalidateFinanceInvoice(invoiceId);
  }, dispense().invoice_id);
  await expect(
    page.getByText("Related evidence changed.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Record reviewed financial operation" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Edit review" }).click();
  await expect(page.getByLabel("Amount in dollars")).toHaveValue("2.50");
  expect(w.calls).toHaveLength(0);
  await review(page);
  await expect(
    page.getByText(
      "The exact financial operation was confirmed in the ledger.",
    ),
  ).toBeVisible();
  const invalidated = await page.evaluate(async (invoiceId) => {
    const h = await import("/tests/prescriptions/finance-browser-harness.tsx");
    return h.financeInvoiceInvalidated(invoiceId);
  }, dispense().invoice_id);
  expect(invalidated).toBe(true);
});
