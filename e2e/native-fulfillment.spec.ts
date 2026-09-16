import { test, expect, type Page } from "@playwright/test";
import {
  actor,
  pet,
  client,
  time,
  hash,
  id,
  signed,
  initialUsage,
  head,
  target,
  dispenseContext,
  slot,
  usedUsage,
  dispense,
} from "../tests/prescriptions/fulfillment-fixture";
// Synthetic server intentionally models several closed RPC envelopes.
interface Row {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}
async function fixture(
  page: Page,
  existing = false,
  additionalRefills = 0,
  dvm = false,
) {
  const authorization = signed(),
    draft = {
      ...authorization.context.draft,
      status: "signed",
      authorization_id: authorization.id,
    };
  authorization.artifact.refills_authorized = additionalRefills;
  authorization.context.draft.fields.refills_authorized = additionalRefills;
  const state = {
    records: existing ? [dispense() as Row] : ([] as Row[]),
    slots: existing ? [slot() as Row] : ([] as Row[]),
    closures: [] as Row[],
    pickups: [] as Row[],
    receipts: new Map<string, Row>(),
    events: [] as Row[],
    calls: [] as Row[],
    lost: false,
    absent: false,
    wrongRecovery: false,
    wrongPrint: false,
    status: "active",
    printReads: 0,
  };
  const user = {
    id: actor,
    aud: "authenticated",
    role: "authenticated",
    email: "synthetic@example.test",
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {},
    created_at: time,
  };
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const session = {
    access_token: `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ sub: actor, exp, role: "authenticated", aud: "authenticated" })).toString("base64url")}.synthetic`,
    refresh_token: "synthetic",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: exp,
    user,
  };
  await page.addInitScript(
    (s) => localStorage.setItem("sb-127-auth-token", JSON.stringify(s)),
    session,
  );
  const currentHead = () => ({
    ...head(),
    state: state.status,
    head_id: state.status === "cancelled" ? id(90) : null,
    head_version: state.status === "cancelled" ? 1 : 0,
  });
  const openSlot = () => state.slots.find((s) => s.state === "open") ?? null;
  const usage = () => {
    const open = openSlot(),
      unopened = additionalRefills + 1 - state.slots.length;
    return {
      ...initialUsage(),
      dispensed_quantity: state.slots
        .reduce((sum, s) => sum + Number(s.dispensed_quantity), 0)
        .toFixed(3),
      used_fill_slots: state.slots.length,
      remaining_quantity: (
        Number(open?.remaining_quantity ?? 0) +
        2.5 * unopened
      ).toFixed(3),
      forfeited_quantity: state.closures
        .reduce((sum, c) => sum + Number(c.forfeited_quantity), 0)
        .toFixed(3),
      unopened_fill_slots: unopened,
      open_slot: open
        ? {
            id: open.id,
            index: open.index,
            version: open.version,
            remaining_quantity: open.remaining_quantity,
          }
        : null,
      fulfillment_head: {
        event_id: state.closures[0]?.id ?? state.records[0]?.id ?? null,
        version: state.slots.reduce((sum, s) => sum + s.version, 0),
      },
    };
  };
  const status = () => ({
    authorization_id: authorization.id,
    authorization_hash: hash,
    checked_at: time,
    state: state.status,
    reason: state.status === "cancelled" ? "DVM cancellation" : null,
    replacement_id: null,
  });
  const preview = (input: Row) => {
    const c: Row = dispenseContext();
    c.target = structuredClone(input);
    c.slot = openSlot();
    c.previous_slot = c.slot ? null : (state.slots.at(-1) ?? null);
    c.signed_artifact = authorization.artifact;
    c.usage = usage();
    c.lots = input.allocations.map((a: Row) => ({
      ...c.lots[0],
      id: a.lot_id,
      lot_number: a.lot_id === id(3) ? "LOT-1" : "LOT-2",
      quantity: Number(a.quantity).toFixed(3),
    }));
    c.charge = {
      quantity: Number(input.quantity).toFixed(3),
      unit_price_cents: "100",
      amount_cents: String(Math.round(Number(input.quantity) * 100)),
      projected_invoice_total_cents: String(
        Math.round(Number(input.quantity) * 100),
      ),
    };
    return c;
  };
  await page.route("**/*", (r) =>
    new URL(r.request().url()).origin === "http://127.0.0.1:8080"
      ? r.continue()
      : r.abort(),
  );
  await page.route("http://127.0.0.1:54321/**", async (r) => {
    const path = new URL(r.request().url()).pathname,
      name = path.split("/").at(-1);
    const input =
      r.request().method() === "POST" ? r.request().postDataJSON() : {};
    if (path === "/auth/v1/token") return r.fulfill({ json: session });
    if (path === "/auth/v1/user") return r.fulfill({ json: user });
    if (path === "/rest/v1/profiles")
      return r.fulfill({
        json: [
          {
            id: actor,
            first_name: "Staff",
            last_name: "Test",
            full_name: "Staff Test",
            is_active: true,
          },
        ],
      });
    if (path === "/rest/v1/user_roles")
      return r.fulfill({
        json: dvm ? [{ role: "STAFF" }, { role: "DVM" }] : [{ role: "STAFF" }],
      });
    if (path === "/rest/v1/pets")
      return r.fulfill({
        json: {
          id: pet,
          client_id: client,
          name: "Patient",
          species: "Canine",
          breed: null,
          dob: null,
          birth_date_precision: "unknown",
          color: null,
          microchip_id: null,
          sex: "unknown",
          neuter_status: "unknown",
          archived_at: null,
          deceased_at: null,
          weight_lbs: null,
          allergies: null,
          version: 1,
        },
      });
    if (path === "/rest/v1/clients")
      return r.fulfill({
        json: {
          id: client,
          full_name: "Household",
          housecall_address: "Reviewed address",
        },
      });
    if (path === "/rest/v1/billing_invoices")
      return r.fulfill({ json: [{ id: id(2), created_at: time }] });
    if (name === "list_native_prescribers")
      return r.fulfill({
        json: { version: 1, entries: [], has_more: false, next_after_id: null },
      });
    if (name === "list_native_prescription_drafts")
      return r.fulfill({
        json: {
          version: 1,
          pet_id: pet,
          drafts: [draft],
          has_more: false,
          next_cursor: null,
        },
      });
    if (name === "read_native_prescription_draft")
      return r.fulfill({ json: draft });
    if (name === "read_native_prescription_authorization")
      return r.fulfill({ json: authorization });
    if (name === "read_native_prescription_status")
      return r.fulfill({
        json: {
          version: 1,
          pet_id: pet,
          status: status(),
          head_id: currentHead().head_id,
          head_version: currentHead().head_version,
          usage: usage(),
        },
      });
    if (name === "list_native_prescription_events")
      return r.fulfill({
        json: {
          version: 1,
          pet_id: pet,
          authorization_id: authorization.id,
          events: state.events,
          has_more: false,
          next_cursor: null,
        },
      });
    if (name === "read_native_fulfillment")
      return r.fulfill({
        json: {
          version: 1,
          authorization: currentHead(),
          usage: usage(),
          open_slot: openSlot(),
        },
      });
    if (name === "list_native_fill_slots")
      return r.fulfill({
        json: {
          version: 1,
          authorization_id: authorization.id,
          pet_id: pet,
          slots: state.slots,
          has_more: false,
          next_index: null,
        },
      });
    const histories: Record<string, [string, Row[]]> = {
      list_native_dispenses: ["dispenses", state.records],
      list_native_slot_closures: ["closures", state.closures],
      list_native_pickups: ["pickups", state.pickups],
    };
    if (name && histories[name]) {
      const [key, values] = histories[name];
      return r.fulfill({
        json: {
          version: 1,
          authorization_id: authorization.id,
          pet_id: pet,
          [key]: values,
          has_more: false,
          next_cursor: null,
        },
      });
    }
    if (name === "inventory_lot_balances")
      return r.fulfill({
        json: [3, 9].map((n) => ({
          id: id(n),
          product_id: authorization.context.product!.id,
          product_name: "Stock medication",
          kind: "medication",
          unit: "tablet",
          active: true,
          lot_number: n === 3 ? "LOT-1" : "LOT-2",
          expires_on: "2026-09-16",
          location: "Clinic",
          balance: 10,
        })),
      });
    if (name === "preview_native_prescription_cancel")
      return r.fulfill({
        json: {
          version: 1,
          actor_id: actor,
          pet_id: pet,
          context: {
            version: 1,
            authorization,
            head: {
              id: null,
              version: 0,
              state: "active",
              reason: null,
              replacement_id: null,
            },
            patient_current: {
              id: pet,
              client_id: client,
              version: 1,
              archived_at: null,
              deceased_at: null,
            },
            prescriber: authorization.context.prescriber,
            alerts: authorization.context.alerts,
            usage: usage(),
          },
          context_hash: hash,
          observed_at: time,
        },
      });
    if (name === "cancel_native_prescription") {
      const event = {
        version: 1,
        id: input.p_id,
        authorization_id: authorization.id,
        authorization_hash: hash,
        pet_id: pet,
        action: "cancel",
        prior_event_id: null,
        event_version: 1,
        replacement_id: null,
        actor_id: actor,
        reason: input.p_request.reason,
        reviewed_context: {
          version: 1,
          authorization,
          head: {
            id: null,
            version: 0,
            state: "active",
            reason: null,
            replacement_id: null,
          },
          patient_current: {
            id: pet,
            client_id: client,
            version: 1,
            archived_at: null,
            deceased_at: null,
          },
          prescriber: authorization.context.prescriber,
          alerts: authorization.context.alerts,
          usage: usage(),
        },
        reviewed_context_hash: hash,
        reconciliation: null,
        record_hash: hash,
        created_at: time,
      };
      state.status = "cancelled";
      state.events = [event];
      state.calls.push({ name, ...input });
      return r.fulfill({
        json: {
          version: 1,
          id: input.p_id,
          actor_id: actor,
          operation: "cancel",
          pet_id: pet,
          request: input.p_request,
          request_hash: hash,
          result: event,
          created_at: time,
        },
      });
    }
    if (name === "preview_native_dispense")
      return r.fulfill({
        json: {
          version: 1,
          actor_id: actor,
          context: preview(input.p_target),
          context_hash: hash,
          observed_at: time,
        },
      });
    if (name === "preview_native_slot_close")
      return r.fulfill({
        json: {
          version: 1,
          actor_id: actor,
          context: {
            version: 1,
            authorization: currentHead(),
            slot: openSlot(),
            usage: usage(),
          },
          context_hash: hash,
          observed_at: time,
        },
      });
    if (name === "preview_native_pickup")
      return r.fulfill({
        json: {
          version: 1,
          actor_id: actor,
          context: {
            version: 1,
            authorization: currentHead(),
            dispense: state.records.find((d) => d.id === input.p_dispense_id),
            existing_pickup_id:
              state.pickups.find((p) => p.dispense_id === input.p_dispense_id)
                ?.id ?? null,
            refill: null,
          },
          context_hash: hash,
          observed_at: time,
        },
      });
    if (name === "recover_native_fulfillment_operation") {
      const saved = state.receipts.get(input.p_id);
      return r.fulfill({
        json: state.absent
          ? null
          : saved && state.wrongRecovery
            ? { ...saved, actor_id: client }
            : (saved ?? null),
      });
    }
    if (
      [
        "record_native_dispense",
        "close_native_fill_slot",
        "record_native_pickup",
      ].includes(name!)
    ) {
      state.calls.push({ name, ...input });
      if (state.receipts.has(input.p_id))
        return r.fulfill({ json: state.receipts.get(input.p_id) });
      const request = input.p_request;
      let result: Row, kind: string;
      if (name === "record_native_dispense") {
        kind = "dispense";
        const {
          expected_context_hash: _h,
          reason: _r,
          attest_alert_review: _a,
          attest_dispense_review: _d,
          ...t
        } = request;
        const c = preview(t),
          d: Row = dispense();
        Object.assign(d, {
          id: input.p_id,
          reason: request.reason,
          quantity: c.charge.quantity,
          slot_index: t.slot_index,
          slot_id: c.slot?.id ?? id(40 + t.slot_index),
          amount_cents: c.charge.amount_cents,
          reviewed_context: c,
          slot_version_before: c.slot?.version ?? null,
          slot_version_after: (c.slot?.version ?? 0) + 1,
          allocations: c.lots.map((l: Row, i: number) => ({
            lot_id: l.id,
            quantity: l.quantity,
            movement_id: id(30 + i),
          })),
        });
        d.artifact = {
          ...d.artifact,
          id: d.id,
          fill_index: d.slot_index,
          quantity: d.quantity,
          lots: c.lots.map((l: Row) => ({
            id: l.id,
            number: l.lot_number,
            expires_on: l.expires_on,
            quantity: l.quantity,
          })),
        };
        const total =
            Number(c.slot?.dispensed_quantity ?? 0) + Number(d.quantity),
          s = {
            ...slot(),
            id: d.slot_id,
            index: d.slot_index,
            version: d.slot_version_after,
            dispensed_quantity: total.toFixed(3),
            remaining_quantity: (2.5 - total).toFixed(3),
            state: total === 2.5 ? "closed" : "open",
            closure_kind: total === 2.5 ? "filled" : null,
            closed_by: total === 2.5 ? actor : null,
            closed_at: total === 2.5 ? time : null,
          };
        state.records.unshift(d);
        state.records.sort((a, b) => b.id.localeCompare(a.id));
        state.slots = [
          ...state.slots.filter((old) => old.index !== s.index),
          s,
        ].sort((a, b) => a.index - b.index);
        result = { dispense: d, slot: s, refill_event: null };
      } else if (name === "close_native_fill_slot") {
        kind = "close_slot";
        const before = structuredClone(openSlot()!);
        const after = {
          ...before,
          version: before.version + 1,
          remaining_quantity: "0.000",
          state: "closed",
          closure_kind: "forfeited",
          closed_by: actor,
          closed_at: time,
          close_reason: request.reason,
        };
        result = {
          version: 1,
          id: input.p_id,
          authorization_id: authorization.id,
          pet_id: pet,
          slot_id: before.id,
          actor_id: actor,
          reason: request.reason,
          forfeited_quantity: before.remaining_quantity,
          before,
          after,
          reviewed_context: {
            version: 1,
            authorization: currentHead(),
            slot: before,
            usage: usage(),
          },
          reviewed_context_hash: hash,
          created_at: time,
        };
        state.closures.unshift(result);
        state.slots = state.slots.map((s) => (s.id === after.id ? after : s));
      } else {
        kind = "pickup";
        result = {
          version: 1,
          id: input.p_id,
          authorization_id: authorization.id,
          pet_id: pet,
          dispense_id: request.dispense_id,
          actor_id: actor,
          recipient_name: request.recipient_name,
          recipient_relationship: request.recipient_relationship,
          reason: request.reason,
          reviewed_context: {
            version: 1,
            authorization: currentHead(),
            dispense: state.records.find((d) => d.id === request.dispense_id),
            existing_pickup_id: null,
            refill: null,
          },
          reviewed_context_hash: hash,
          refill_id: null,
          refill_event_id: null,
          picked_up_at: time,
        };
        state.pickups.unshift(result);
      }
      const saved = {
        version: 1,
        id: input.p_id,
        actor_id: actor,
        operation: kind,
        request,
        request_hash: hash,
        result,
        created_at: time,
      };
      state.receipts.set(input.p_id, saved);
      if (state.lost) {
        state.lost = false;
        return r.abort();
      }
      return r.fulfill({ json: saved });
    }
    if (name === "read_native_prescription_print") {
      state.printReads++;
      const d = state.records.find((d) => d.id === input.p_dispense_id);
      return r.fulfill({
        json: {
          prescription: authorization.artifact,
          status: status(),
          dispense: d
            ? {
                ...d.artifact,
                quantity: state.wrongPrint ? "99.000" : d.artifact.quantity,
              }
            : null,
        },
      });
    }
    return r.fulfill({ json: [] });
  });
  await page.goto(`/hub/patient/${pet}`);
  await page
    .getByRole("button", { name: "View signed snapshot", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Prescription fulfillment" }),
  ).toContainText("Native quantity dispensed:");
  return state;
}
async function prepare(page: Page, multi = false, quantity = "1") {
  await page
    .getByRole("button", { name: "Record a dispense", exact: true })
    .click();
  await page
    .getByLabel("Draft household invoice", { exact: true })
    .selectOption(id(2));
  await page
    .getByLabel("Total quantity to dispense", { exact: true })
    .fill(quantity);
  await page.getByLabel("Lot 1", { exact: true }).selectOption(id(3));
  await page
    .getByLabel("Quantity from lot 1", { exact: true })
    .fill(multi ? "0.5" : quantity);
  if (multi) {
    await page.getByRole("button", { name: "Add another lot" }).click();
    await page.getByLabel("Lot 2", { exact: true }).selectOption(id(9));
    await page.getByLabel("Quantity from lot 2", { exact: true }).fill("0.5");
  }
  await page
    .getByLabel("Reason for this fulfillment record", { exact: true })
    .fill("Reviewed dispense");
  await page
    .getByRole("button", { name: "Review fulfillment evidence" })
    .click();
  await expect(
    page.getByRole("region", { name: "Frozen fulfillment review" }),
  ).toContainText(`charge $${Number(quantity).toFixed(2)}`);
}
test("staff reviews multiple lots and exact invoice, records partial fill and prints frozen label", async ({
  page,
}) => {
  const s = await fixture(page);
  await prepare(page, true);
  await expect(
    page.getByRole("button", { name: "Confirm reviewed dispense" }),
  ).toBeDisabled();
  await page
    .getByRole("checkbox", {
      name: /I reviewed patient identity, signed directions/,
    })
    .check();
  await page.getByRole("button", { name: "Confirm reviewed dispense" }).click();
  await expect(
    page.getByRole("region", { name: "Prescription fulfillment" }),
  ).toContainText("Open fill 1: 1.500");
  expect(s.calls).toHaveLength(1);
  expect(s.calls[0].p_request.allocations).toEqual([
    { lot_id: id(3), quantity: "0.5" },
    { lot_id: id(9), quantity: "0.5" },
  ]);
  await page
    .getByRole("button", { name: "Preview this dispense label", exact: true })
    .click();
  await expect(
    page
      .frameLocator('iframe[title="Native dispensing label"]')
      .locator("body"),
  ).toContainText("LOT-2");
  expect(s.printReads).toBe(1);
});
test("lost dispense response locks competing patient work and recovers only original operation", async ({
  page,
}) => {
  const s = await fixture(page);
  await prepare(page);
  await page
    .getByRole("checkbox", {
      name: /I reviewed patient identity, signed directions/,
    })
    .check();
  s.lost = true;
  await page.getByRole("button", { name: "Confirm reviewed dispense" }).click();
  await expect(
    page.getByRole("button", {
      name: "Recover original operation",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "New prescription draft" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Refresh fulfillment history" }),
  ).toBeDisabled();
  await expect(
    page.getByLabel("Total quantity to dispense", { exact: true }),
  ).toBeDisabled();
  s.wrongRecovery = true;
  await page
    .getByRole("button", { name: "Recover original operation", exact: true })
    .click();
  await expect(
    page.getByText("Recovery could not be confirmed.", { exact: false }),
  ).toBeVisible();
  s.wrongRecovery = false;
  s.absent = true;
  await page
    .getByRole("button", { name: "Recover original operation", exact: true })
    .click();
  await page.getByRole("button", { name: "Retry identical operation" }).click();
  await expect(
    page.getByRole("region", { name: "Prescription fulfillment" }),
  ).toContainText("Open fill 1: 1.500");
  expect(s.calls).toHaveLength(2);
  expect(s.calls[1]).toEqual(s.calls[0]);
  expect(s.records).toHaveLength(1);
});
test("explicit forfeiture preserves partial history without another charge", async ({
  page,
}) => {
  const s = await fixture(page, true);
  await page
    .getByRole("button", { name: "Forfeit open fill remainder" })
    .click();
  await page
    .getByLabel("Reason for this fulfillment record", { exact: true })
    .fill("Owner declined remainder");
  await page
    .getByRole("button", { name: "Review fulfillment evidence" })
    .click();
  await expect(
    page.getByRole("region", { name: "Frozen fulfillment review" }),
  ).toContainText("Forfeit 1.500");
  await page
    .getByRole("checkbox", { name: /confirm permanently forfeiting/ })
    .check();
  await page
    .getByRole("button", { name: "Confirm remainder forfeiture" })
    .click();
  await expect(
    page.getByRole("region", { name: "Fulfillment history" }),
  ).toContainText("1.500 forfeited");
  expect(s.records).toHaveLength(1);
  expect(s.calls[0].name).toBe("close_native_fill_slot");
  await expect(
    page.getByRole("button", { name: "Record a dispense", exact: true }),
  ).toBeDisabled();
});
test("historical pickup reviews cancelled status and does not dispense or bill again", async ({
  page,
}) => {
  const s = await fixture(page, true);
  s.status = "cancelled";
  await page
    .getByRole("button", { name: "Refresh fulfillment history" })
    .click();
  await page
    .getByRole("button", { name: "Record pickup", exact: true })
    .click();
  await page.getByLabel("Recipient name", { exact: true }).fill("Alex");
  await page
    .getByLabel("Recipient relationship", { exact: true })
    .fill("Owner");
  await page
    .getByLabel("Reason for this fulfillment record", { exact: true })
    .fill("Handoff acknowledged");
  await page
    .getByRole("button", { name: "Review fulfillment evidence" })
    .click();
  await expect(
    page.getByRole("region", { name: "Frozen fulfillment review" }),
  ).toContainText("CANCELLED");
  await page
    .getByRole("checkbox", { name: /confirm the actual handoff/ })
    .check();
  await page.getByRole("button", { name: "Confirm physical pickup" }).click();
  await expect(
    page.getByRole("region", { name: "Fulfillment history" }),
  ).toContainText("Alex (Owner)");
  expect(s.records).toHaveLength(1);
  expect(s.calls.map((c) => c.name)).toEqual(["record_native_pickup"]);
});
test("changed print artifact cannot be substituted for selected dispense", async ({
  page,
}) => {
  const s = await fixture(page, true);
  s.wrongPrint = true;
  await page
    .getByRole("button", { name: "Preview this dispense label", exact: true })
    .click();
  await expect(
    page.getByText("Fulfillment evidence could not be confirmed.", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(
    page.locator('iframe[title="Native dispensing label"]'),
  ).toHaveCount(0);
});
test("successive partials complete first slot before opening the next signed refill", async ({
  page,
}) => {
  const s = await fixture(page, false, 1);
  for (const quantity of ["1", "1.5", "1"]) {
    await prepare(page, false, quantity);
    await page
      .getByRole("checkbox", {
        name: /I reviewed patient identity, signed directions/,
      })
      .check();
    await page
      .getByRole("button", { name: "Confirm reviewed dispense" })
      .click();
    await expect(
      page.getByRole("button", { name: "Record a dispense", exact: true }),
    ).toBeEnabled();
  }
  expect(s.calls.map((c) => c.p_request.slot_index)).toEqual([0, 0, 1]);
  expect(s.calls.map((c) => c.p_request.expected_slot_version)).toEqual([
    null,
    1,
    null,
  ]);
  await expect(
    page.getByRole("region", { name: "Fulfillment history" }),
  ).toContainText("Fill 1: closed (filled)");
  await expect(
    page.getByRole("region", { name: "Prescription fulfillment" }),
  ).toContainText("Open fill 2: 1.500");
});
test("unfinished fulfillment participates in patient route and browser unload guards", async ({
  page,
}) => {
  await fixture(page);
  await page
    .getByRole("button", { name: "Record a dispense", exact: true })
    .click();
  await page
    .getByLabel("Total quantity to dispense", { exact: true })
    .fill("1");
  const prevented = await page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(prevented).toBe(true);
  await page.getByRole("link", { name: "Household", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.getByRole("button", { name: /Keep editing|Stay/i }).click();
  await expect(
    page.getByLabel("Total quantity to dispense", { exact: true }),
  ).toHaveValue("1");
});
test("same-screen cancellation invalidates dispensing status without a manual refresh", async ({
  page,
}) => {
  await fixture(page, false, 0, true);
  await expect(
    page.getByRole("button", { name: "Record a dispense", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Cancel this authorization", exact: true })
    .click();
  await page
    .getByLabel("Clinical reason for cancellation", { exact: true })
    .fill("DVM cancellation");
  await page
    .getByRole("button", { name: "Load current evidence for review" })
    .click();
  await page
    .getByRole("checkbox", { name: /I reviewed the exact order, reason/ })
    .check();
  await page
    .getByRole("button", { name: "Confirm authorization cancellation" })
    .click();
  await expect(
    page.getByRole("region", { name: "Prescription fulfillment" }),
  ).toContainText("CANCELLED");
  await expect(
    page.getByRole("button", { name: "Record a dispense", exact: true }),
  ).toBeDisabled();
});
test("confirmed dispense refreshes sibling authorization quantities automatically", async ({
  page,
}) => {
  await fixture(page);
  const lifecycle = page.getByRole("region", {
    name: "Prescription lifecycle",
  });
  await expect(lifecycle).toContainText("Native dispensed quantity: 0.000");
  await prepare(page);
  await page
    .getByRole("checkbox", {
      name: /I reviewed patient identity, signed directions/,
    })
    .check();
  await page.getByRole("button", { name: "Confirm reviewed dispense" }).click();
  await expect(lifecycle).toContainText("Native dispensed quantity: 1.000");
  await expect(lifecycle).toContainText(
    "remaining mathematical allowance: 1.500",
  );
});
test("re-review gets a concurrent partial slot version without discarding entered values", async ({
  page,
}) => {
  const state = await fixture(page);
  await page
    .getByRole("button", { name: "Record a dispense", exact: true })
    .click();
  await page
    .getByLabel("Draft household invoice", { exact: true })
    .selectOption(id(2));
  await page
    .getByLabel("Total quantity to dispense", { exact: true })
    .fill("0.5");
  await page.getByLabel("Lot 1", { exact: true }).selectOption(id(3));
  await page.getByLabel("Quantity from lot 1", { exact: true }).fill("0.5");
  await page
    .getByLabel("Reason for this fulfillment record", { exact: true })
    .fill("Retain my entered reason");
  state.records = [dispense()];
  state.slots = [slot()];
  await page
    .getByRole("button", { name: "Review fulfillment evidence" })
    .click();
  await expect(
    page.getByRole("region", { name: "Frozen fulfillment review" }),
  ).toContainText("Retain my entered reason");
  await page
    .getByRole("checkbox", {
      name: /I reviewed patient identity, signed directions/,
    })
    .check();
  await page.getByRole("button", { name: "Confirm reviewed dispense" }).click();
  await expect(
    page.getByRole("region", { name: "Prescription fulfillment" }),
  ).toContainText("Open fill 1: 1.000");
  expect(state.calls[0].p_request.expected_slot_version).toBe(1);
  expect(state.calls[0].p_request.quantity).toBe("0.5");
});
