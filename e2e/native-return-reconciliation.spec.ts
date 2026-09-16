import { test, expect, type Page } from "@playwright/test";
import {
  actor,
  id,
  hash,
  time,
  dispense,
} from "../tests/prescriptions/fulfillment-fixture";
import { replayNativeReturnQuantities } from "../supabase/functions/_shared/native-return-quantity-replay";
import { reconciliationAttestations } from "../src/hub/features/prescriptions/fulfillment-reconciliation-api";
import type {
  ReconciliationEvent,
  ReturnDiscrepancyEvent,
  ReturnDiscrepancyCase,
  ReconciliationIntent,
  ReturnDiscrepancyIntent,
} from "../supabase/functions/_shared/native-return-reconciliation-contract";
/** Browser interaction coverage uses closed synthetic RPC responses; actual DB acceptance is separate. */
async function workspace(page: Page) {
  const fill = dispense(),
    allocation = id(600),
    target = {
      authorization_id: fill.authorization_id,
      pet_id: fill.pet_id,
      dispense_id: fill.id,
    };
  const events: ReconciliationEvent[] = [],
    cases: ReturnDiscrepancyCase[] = [],
    decisions: ReturnDiscrepancyEvent[] = [];
  const receipts = new Map<string, unknown>(),
    calls: Array<{ id: string; request: Record<string, unknown> }> = [];
  const controls = { lose: false };
  const empty = { event_id: null, version: 0, record_hash: null };
  const head = () =>
    events.length
      ? {
          event_id: events.at(-1)!.id,
          version: events.length,
          record_hash: hash,
        }
      : empty;
  const caseHead = () =>
    decisions.length
      ? {
          event_id: decisions.at(-1)!.id,
          version: decisions.length,
          record_hash: hash,
        }
      : empty;
  const replay = () =>
    replayNativeReturnQuantities(
      [
        {
          allocation_id: allocation,
          lot_id: fill.allocations[0].lot_id,
          quantity: fill.quantity,
        },
      ],
      events.map((e) => ({
        id: e.id,
        sequence: e.sequence,
        action: e.action,
        intake_id: e.intake_id,
        correction_target_id: e.correction_target?.event_id ?? null,
        allocations: e.allocations.map((a) => ({
          allocation_id: a.allocation_id,
          lot_id: a.lot_id,
          quantity: a.quantity,
        })),
      })),
    );
  const balances = () =>
    replay().allocations.map((a) => ({
      ...a,
      lot_number: fill.artifact.lots[0].number,
      expires_on: fill.artifact.lots[0].expires_on,
    }));
  const discrepancies = () => ({
    version: 1,
    head: caseHead(),
    open_case_count: cases.filter((c) => c.status === "open").length,
    held_lot_ids: cases.some((c) => c.status === "open")
      ? [fill.allocations[0].lot_id]
      : [],
    cases,
  });
  const intake = (intakeId: string) => {
    const source = events.find((e) => e.id === intakeId)!;
    return {
      ...replay().intakes.find((i) => i.id === intakeId),
      sequence: source.sequence,
      custody: source.custody,
      package_condition: source.package_condition,
      storage_history: source.storage_history,
    };
  };
  function append(
    intent: ReconciliationIntent,
    eventId: string,
  ): ReconciliationEvent {
    const prior = head();
    const e: ReconciliationEvent = {
      version: 2,
      id: eventId,
      target,
      authorization_hash: fill.authorization_hash,
      dispense_document_hash: hash,
      sequence: events.length + 1,
      prior_event_id: prior.event_id,
      prior_record_hash: prior.record_hash,
      actor: {
        id: actor,
        name: "Synthetic reviewer",
        authority:
          intent.action.startsWith("retract_") || intent.action === "restock"
            ? "active_dvm"
            : "active_staff",
      },
      action: intent.action,
      intake_id: intent.intake_id,
      allocations: intent.allocations.map((a) => ({
        ...a,
        quantity: Number(a.quantity).toFixed(3),
        lot_id: fill.allocations[0].lot_id,
        movement_id: null,
      })),
      custody: intent.custody,
      package_condition: intent.package_condition,
      storage_history: intent.storage_history,
      reason: intent.reason,
      note: intent.note,
      policy: null,
      correction_target: intent.correction_target,
      discrepancy_id: intent.discrepancy_id,
      physical_attestations: reconciliationAttestations(intent.action),
      reviewed_context_hash: hash,
      created_at: time,
      record_hash: hash,
    };
    events.push(e);
    return e;
  }
  const initial: ReconciliationIntent = {
    target,
    action: "intake",
    intake_id: null,
    correction_target: null,
    discrepancy_id: null,
    allocations: [{ allocation_id: allocation, quantity: "1" }],
    custody: "clinic_retained",
    package_condition: "sealed_intact",
    storage_history: "controlled",
    reason: "Original intake",
    note: "Original physical claim",
  };
  append(initial, id(601));
  append(
    {
      ...initial,
      action: "dispose",
      intake_id: id(601),
      allocations: [{ allocation_id: allocation, quantity: "0.5" }],
      custody: null,
      package_condition: null,
      storage_history: null,
      reason: "Original disposal",
    },
    id(602),
  );
  await page.route("**/rest/v1/rpc/*", async (route) => {
    const name = new URL(route.request().url()).pathname.split("/").at(-1),
      p = route.request().postDataJSON() ?? {};
    const read = {
      version: 2,
      target,
      authorization_hash: fill.authorization_hash,
      dispense_document_hash: hash,
      dispensed_at: fill.dispensed_at,
      head: head(),
      allocations: balances(),
      replay: replay(),
      discrepancies: discrepancies(),
    };
    if (name === "read_native_dispense_returns_v2")
      return route.fulfill({ json: read });
    if (name === "list_native_dispense_returns_v2")
      return route.fulfill({
        json: {
          version: 2,
          target,
          head: head(),
          discrepancy_head: caseHead(),
          events: [...events].reverse(),
          next_before_version: null,
        },
      });
    if (name === "read_native_return_intake_v2")
      return route.fulfill({
        json: {
          version: 2,
          target,
          head: head(),
          discrepancy_head: caseHead(),
          intake: intake(p.p_intake_id),
        },
      });
    if (name === "preview_native_dispense_return_v2")
      return route.fulfill({
        json: {
          version: 2,
          actor_id: actor,
          observed_at: time,
          context: {
            ...read,
            discrepancy_head: caseHead(),
            original_pickup: null,
            correction_head: empty,
            intake: p.p_intent.intake_id ? intake(p.p_intent.intake_id) : null,
            stock_review: null,
            policy: null,
            intent: p.p_intent,
          },
          context_hash: hash,
          allowed: true,
          blockers: [],
        },
      });
    if (name === "record_native_dispense_return_v2") {
      calls.push({ id: p.p_id, request: p.p_request });
      if (!receipts.has(p.p_id))
        receipts.set(p.p_id, {
          version: 2,
          id: p.p_id,
          actor_id: actor,
          request: p.p_request,
          request_hash: hash,
          result: append(p.p_request.intent, p.p_id),
          created_at: time,
        });
      if (controls.lose) {
        controls.lose = false;
        return route.abort();
      }
      return route.fulfill({ json: receipts.get(p.p_id) });
    }
    if (
      name === "recover_native_dispense_return_v2" ||
      name === "recover_native_return_discrepancy"
    )
      return route.fulfill({ json: receipts.get(p.p_id) ?? null });
    if (name === "preview_native_return_discrepancy") {
      const intent = p.p_intent as ReturnDiscrepancyIntent;
      return route.fulfill({
        json: {
          version: 1,
          actor_id: actor,
          observed_at: time,
          context: {
            version: 1,
            target,
            return_head: head(),
            discrepancy_head: caseHead(),
            source: events.find((e) => e.id === intent.source.event_id),
            replay: replay(),
            discrepancies: discrepancies(),
            intent,
          },
          context_hash: hash,
          allowed: true,
          blockers: [],
        },
      });
    }
    if (name === "record_native_return_discrepancy") {
      calls.push({ id: p.p_id, request: p.p_request });
      if (!receipts.has(p.p_id)) {
        const intent = p.p_request.intent as ReturnDiscrepancyIntent,
          prior = caseHead();
        const e: ReturnDiscrepancyEvent = {
          version: 1,
          id: p.p_id,
          target,
          sequence: decisions.length + 1,
          prior_event_id: prior.event_id,
          prior_record_hash: prior.record_hash,
          actor: {
            id: actor,
            name: "Synthetic reviewer",
            authority:
              intent.action === "resolve_confirmed_original"
                ? "active_dvm"
                : "active_staff",
          },
          action: intent.action,
          case_id: intent.case_id ?? p.p_id,
          source: intent.source,
          allocations: intent.allocations.map((a) => ({
            ...a,
            quantity: Number(a.quantity).toFixed(3),
            lot_id: fill.allocations[0].lot_id,
          })),
          observation: intent.observation,
          correction_ids: intent.correction_ids,
          return_head: head(),
          reviewed_context_hash: hash,
          created_at: time,
          record_hash: hash,
        };
        decisions.push(e);
        if (e.action === "report")
          cases.push({
            id: e.id,
            source: e.source,
            allocations: e.allocations,
            status: "open",
            report: e,
            decisions: [],
          });
        else {
          const c = cases.find((c) => c.id === e.case_id)!;
          c.decisions.push(e);
          if (e.action === "resolve_confirmed_original")
            c.status = "resolved_confirmed_original";
          if (e.action === "resolve_corrected") c.status = "resolved_corrected";
        }
        receipts.set(p.p_id, {
          version: 1,
          id: p.p_id,
          actor_id: actor,
          request: p.p_request,
          request_hash: hash,
          result: e,
          created_at: time,
        });
      }
      return route.fulfill({ json: receipts.get(p.p_id) });
    }
    return route.fulfill({ json: null });
  });
  await page.goto("/");
  await page.evaluate(
    async ({ actor, fill }) => {
      const moduleAt = (path: string) => import(path);
      const { mountReconciliation } = await moduleAt(
        "/tests/prescriptions/reconciliation-browser-harness.tsx",
      );
      mountReconciliation({ actor, dispense: fill });
    },
    { actor, fill },
  );
  const panel = page.getByRole("region", {
    name: "Physical return records",
    exact: true,
  });
  await expect(panel.getByText("Current allocation balances")).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "Review return evidence", exact: true }),
  ).toBeEnabled();
  return {
    panel,
    events,
    cases,
    calls,
    controls,
    lot: fill.artifact.lots[0].number,
    allocation,
  };
}
test("physical correction uses exact source, explicit facts and recover-first lost response", async ({
  page,
}) => {
  const f = await workspace(page);
  await f.panel
    .getByLabel("Return action", { exact: true })
    .selectOption("retract_disposal");
  await f.panel
    .getByLabel("Original event to correct", { exact: true })
    .selectOption(id(602));
  await f.panel
    .getByLabel(`Quantity for lot ${f.lot}`, { exact: true })
    .fill("0.25");
  await f.panel
    .getByLabel("Return or disposition reason", { exact: true })
    .fill("Disposal did not occur");
  await f.panel
    .getByLabel("Custody and disposition note", { exact: true })
    .fill("Selected quantity remains physically held");
  await f.panel
    .getByRole("button", { name: "Review return evidence", exact: true })
    .click();
  const save = f.panel.getByRole("button", {
    name: "Save reviewed return record",
    exact: true,
  });
  await expect(save).toBeDisabled();
  await f.panel
    .getByRole("checkbox", { name: /I verified the exact original lots/ })
    .check();
  await expect(save).toBeDisabled();
  await f.panel
    .getByRole("checkbox", {
      name: /were not destroyed and remain physically held/,
    })
    .check();
  f.controls.lose = true;
  await save.click();
  await expect(
    f.panel.getByRole("button", { name: /Recover original/ }),
  ).toBeVisible();
  await f.panel.getByRole("button", { name: /Recover original/ }).click();
  await expect(
    f.panel.getByText("Disposal did not occur", { exact: true }),
  ).toBeVisible();
  expect(f.calls).toHaveLength(1);
  expect(f.events).toHaveLength(3);
  expect(f.events[2].correction_target?.event_id).toBe(id(602));
  expect(f.events[2].physical_attestations.was_not_destroyed).toBe(true);
});
test("open discrepancy holds are visible until explicit DVM factual confirmation", async ({
  page,
}) => {
  const f = await workspace(page),
    p = f.panel.getByRole("region", {
      name: "Return discrepancies",
      exact: true,
    });
  await p
    .getByLabel("Disputed original event", { exact: true })
    .selectOption(id(602));
  await p
    .getByLabel(`Disputed quantity ${f.allocation}`, { exact: true })
    .fill("0.25");
  await p
    .getByLabel("Physical review observation", { exact: true })
    .fill("Disposal record requires physical review");
  await p
    .getByRole("button", { name: "Review discrepancy evidence", exact: true })
    .click();
  await p
    .getByRole("checkbox", { name: /I reviewed the exact source/ })
    .check();
  await p
    .getByRole("button", {
      name: "Save reviewed discrepancy decision",
      exact: true,
    })
    .click();
  await expect(
    p.getByRole("status").filter({ hasText: /open cases ·/ }),
  ).toContainText("1 open cases · 1 lots held");
  await p
    .getByLabel("Discrepancy action", { exact: true })
    .selectOption("resolve_confirmed_original");
  await p
    .getByLabel("Open discrepancy", { exact: true })
    .selectOption(f.cases[0].id);
  await p
    .getByLabel("Physical review observation", { exact: true })
    .fill("Physical investigation confirms original disposal");
  await p
    .getByRole("button", { name: "Review discrepancy evidence", exact: true })
    .click();
  await p
    .getByRole("checkbox", { name: /I reviewed the exact source/ })
    .check();
  const save = p.getByRole("button", {
    name: "Save reviewed discrepancy decision",
    exact: true,
  });
  await expect(save).toBeDisabled();
  await p
    .getByRole("checkbox", { name: /As the reviewing DVM, I confirm/ })
    .check();
  await save.click();
  await expect(
    p.getByRole("status").filter({ hasText: /open cases ·/ }),
  ).toContainText("0 open cases · 0 lots held");
  expect(f.events).toHaveLength(2);
  expect(f.cases[0].status).toBe("resolved_confirmed_original");
});
