import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
const receipt = JSON.parse(
  readFileSync(
    new URL(
      "../tests/prescription-review/receipt.fixture.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
interface MockRow {
  // This synthetic server models heterogeneous RPC requests and receipts.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}
async function fixture(
  page: Page,
  options: {
    fail?: boolean;
    wrongPatient?: boolean;
    pagination?: boolean;
    dvm?: boolean;
    initialHistory?: boolean;
    losePrepare?: boolean;
    loseApprove?: boolean;
  } = {},
) {
  const actor = receipt.approved_by,
    pet = receipt.pet_id;
  const user = {
    id: actor,
    aud: "authenticated",
    role: "authenticated",
    email: "synthetic@example.test",
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {},
    created_at: receipt.approved_at,
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
  const state = {
    fail: !!options.fail,
    calls: [] as Record<string, unknown>[],
    reviewCalls: [] as MockRow[],
    requests: [] as MockRow[],
    records: options.initialHistory
      ? [structuredClone(receipt)]
      : ([] as MockRow[]),
    losePrepare: !!options.losePrepare,
    loseApprove: !!options.loseApprove,
    stale: false,
    wrongActor: false,
    deferPrepare: false,
    releasePrepare: null as (() => void) | null,
  };
  const patient = {
    id: pet,
    client_id: receipt.client_id,
    name: "Synthetic Juniper",
    species: "Dog",
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
  };
  const appOrigin = new URL(test.info().project.use.baseURL!).origin;
  await page.route("**/*", (r) =>
    new URL(r.request().url()).origin === appOrigin
      ? r.continue()
      : r.abort(),
  );
  await page.route("http://127.0.0.1:54321/**", async (r) => {
    const path = new URL(r.request().url()).pathname;
    if (path === "/auth/v1/token") return r.fulfill({ json: session });
    if (path === "/auth/v1/user") return r.fulfill({ json: user });
    if (path === "/rest/v1/profiles")
      return r.fulfill({
        json: [
          {
            id: actor,
            full_name: "Synthetic staff",
            first_name: "Synthetic",
            last_name: "Staff",
            is_active: true,
            role: options.dvm ? "DVM" : "TECH",
          },
        ],
      });
    if (path === "/rest/v1/user_roles")
      return r.fulfill({ json: [{ role: options.dvm ? "DVM" : "TECH" }] });
    if (path === "/rest/v1/pets")
      return r.fulfill({
        json: r.request().headers().accept?.includes("vnd.pgrst.object")
          ? patient
          : [patient],
      });
    if (path === "/rest/v1/clients")
      return r.fulfill({
        json: {
          id: receipt.client_id,
          full_name: "Synthetic Family",
          housecall_address: null,
        },
      });
    const body =
      r.request().method() === "POST" ? r.request().postDataJSON() : {};
    if (
      path.includes("/rpc/") &&
      !path.endsWith("list_patient_imported_prescriptions")
    )
      state.reviewCalls.push({ path, ...body });
    if (path === "/rest/v1/catalog_products")
      return r.fulfill({ json: [receipt.items[0].product] });
    if (path.endsWith("list_ezyvet_prescription_review_candidates"))
      return r.fulfill({
        json: {
          candidates: [
            {
              id: receipt.context.item_run.id,
              created_at: receipt.approved_at,
              status: "review_ready",
              animal_link_id: receipt.animal_link_id,
              prescription_external_id: receipt.prescription_external_id,
              source: receipt.context.source,
              item_count: receipt.context.items.length,
            },
          ],
          has_more: false,
          next_cursor: null,
        },
      });
    if (path.endsWith("get_ezyvet_prescription_review_candidate"))
      return r.fulfill({
        json: {
          run: {
            id: receipt.context.item_run.id,
            pet_id: pet,
            animal_link_id: receipt.animal_link_id,
            prescription_external_id: receipt.prescription_external_id,
            source_origin: receipt.source_origin,
            source_site_uid: receipt.source_site_uid,
          },
          patient_version: 1,
          source_context: receipt.context,
          eligible_for_review: !state.stale,
          unavailable_reason: state.stale ? "SOURCE_CONTEXT_CHANGED" : null,
        },
      });
    if (path.endsWith("list_ezyvet_prescription_review_requests"))
      return r.fulfill({
        json: { requests: state.requests, has_more: false, next_cursor: null },
      });
    if (path.endsWith("prepare_ezyvet_prescription_review")) {
      if (!state.requests.some((e) => e.request.id === body.p_id)) {
        const context = structuredClone(receipt.context);
        const {
          items,
          replaces_id: _replaces,
          expected_predecessor_hash: _hash,
          ...reviewed
        } = body.p_payload.interpretation;
        context.reviewed = reviewed;
        context.patient_version = body.p_payload.patient_version;
        context.selected_items = items.map((item: MockRow) => ({
          source: context.items.find(
            (source: MockRow) => source.snapshot_id === item.snapshot_id,
          ),
          reviewed: {
            start_on: item.start_on,
            start_date_status: item.start_date_status,
            note: item.note,
          },
          product: item.product_id ? receipt.items[0].product : null,
        }));
        context.omitted_items = context.items.filter(
          (item: MockRow) =>
            !items.some(
              (selected: MockRow) => selected.snapshot_id === item.snapshot_id,
            ),
        );
        state.requests.push({
          request: {
            id: body.p_id,
            actor_id: actor,
            pet_id: pet,
            payload: body.p_payload,
            request_hash: "c".repeat(64),
            review_context: context,
            status: "prepared",
            approved_record_id: null,
            created_at: receipt.approved_at,
            resolved_at: null,
          },
          receipt: null,
          clinical_approval_available: true,
        });
      }
      if (state.deferPrepare)
        await new Promise<void>((resolve) => {
          state.releasePrepare = resolve;
        });
      if (state.losePrepare) {
        state.losePrepare = false;
        return r.fulfill({
          status: 503,
          json: { message: "Synthetic lost prepare response" },
        });
      }
      return r.fulfill({
        json: state.requests.find((e) => e.request.id === body.p_id),
      });
    }
    if (path.endsWith("recover_ezyvet_prescription_review")) {
      const envelope = structuredClone(
        state.requests.find((e) => e.request.id === body.p_id) ?? null,
      );
      if (state.wrongActor && envelope)
        envelope.request.actor_id = "cd000000-0000-4000-8000-000000000001";
      return r.fulfill({ json: envelope });
    }
    if (path.endsWith("approve_ezyvet_prescription_review")) {
      if (state.stale)
        return r.fulfill({ status: 409, json: { message: "SOURCE_STALE" } });
      const e = state.requests.find((e) => e.request.id === body.p_id)!;
      if (e.request.status === "prepared") {
        const prior = state.records.at(-1);
        const value = {
          ...structuredClone(receipt),
          id: e.request.id,
          context: structuredClone(e.request.review_context),
          items: structuredClone(e.request.review_context.selected_items),
          reason: e.request.payload.interpretation.reason,
          version: (prior?.version ?? 0) + 1,
          version_hash: "d".repeat(64),
          replaces_id: e.request.payload.interpretation.replaces_id,
          expected_predecessor_hash:
            e.request.payload.interpretation.expected_predecessor_hash,
          correction_history: [...(prior?.correction_history ?? [])],
        };
        value.correction_history.push({
          id: value.id,
          version: value.version,
          version_hash: value.version_hash,
          replaces_id: value.replaces_id,
          reason: value.reason,
          approved_by: actor,
          approved_at: value.approved_at,
        });
        e.request.status = "approved";
        e.request.approved_record_id = value.id;
        e.request.resolved_at = value.approved_at;
        e.receipt = value;
        state.records.push(value);
      }
      if (state.loseApprove) {
        state.loseApprove = false;
        return r.fulfill({
          status: 503,
          json: { message: "Synthetic lost approval response" },
        });
      }
      return r.fulfill({ json: e });
    }
    if (path.endsWith("abandon_ezyvet_prescription_review")) {
      let e = state.requests.find((e) => e.request.id === body.p_id);
      if (!e) {
        e = {
          request: {
            id: body.p_id,
            actor_id: actor,
            pet_id: pet,
            payload: null,
            request_hash: null,
            review_context: null,
            status: "abandoned",
            approved_record_id: null,
            created_at: receipt.approved_at,
            resolved_at: receipt.approved_at,
          },
          receipt: null,
          clinical_approval_available: true,
        };
        state.requests.push(e);
      } else if (e.request.status === "prepared") {
        e.request.status = "abandoned";
        e.request.resolved_at = receipt.approved_at;
      }
      return r.fulfill({ json: e });
    }
    if (path.endsWith("list_patient_imported_prescriptions")) {
      const body = r.request().postDataJSON();
      state.calls.push(body);
      if (state.fail)
        return r.fulfill({
          status: 503,
          json: { message: "Synthetic unavailable" },
        });
      const row = structuredClone(receipt);
      row.current.is_current = false;
      if (options.wrongPatient) row.pet_id = receipt.client_id;
      return r.fulfill({
        json: {
          prescriptions: options.dvm
            ? [...state.records].reverse()
            : body.p_before_at
              ? []
              : [row],
          has_more: !!options.pagination && !body.p_before_at,
          next_cursor:
            options.pagination && !body.p_before_at
              ? { before_at: row.approved_at, before_id: row.id }
              : null,
        },
      });
    }
    if (path.endsWith("list_patient_imported_vaccinations"))
      return r.fulfill({
        json: { vaccinations: [], has_more: false, next_cursor: null },
      });
    return r.fulfill({ json: [] });
  });
  await page.goto(`/hub/patient/${pet}`);
  await expect(
    page.getByRole("heading", {
      name: "Outside prescription history",
      exact: true,
    }),
  ).toBeVisible();
  return state;
}
test("staff reads attributed partial outside history and escaped original values", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fixture(page);
  const panel = page.getByRole("region", {
    name: "Outside prescription history",
  });
  await expect(panel.getByRole("article")).toBeVisible();
  await expect(
    panel.getByText("<script>outside prose</script>", { exact: true }).first(),
  ).toBeVisible();
  await expect(panel.locator("script")).toHaveCount(0);
  await expect(panel.getByText(/Partial historical account:/)).toBeVisible();
  await expect(
    panel.getByText(/Source or patient context has changed/),
  ).toBeVisible();
  await panel
    .getByText("Unresolved source item accounting", { exact: true })
    .click();
  await expect(
    panel.getByText("Malformed references", { exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByRole("button", { name: /approve|dispense|refill/i }),
  ).toHaveCount(0);
  expect(
    await panel.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
  ).toBe(true);
});
test("chart pagination preserves patient and exposes empty page with return control", async ({
  page,
}) => {
  const state = await fixture(page, { pagination: true });
  await page
    .getByRole("button", { name: "Older outside prescriptions", exact: true })
    .click();
  await expect(
    page.getByText("No reviewed outside prescriptions on this page."),
  ).toBeVisible();
  expect(state.calls.at(-1)?.p_pet_id).toBe(receipt.pet_id);
  expect(state.calls.at(-1)?.p_before_id).toBe(receipt.id);
  await page
    .getByRole("button", { name: "Newest outside prescriptions", exact: true })
    .click();
  await expect(
    page.getByRole("article", { name: /Outside prescription/ }),
  ).toBeVisible();
});
test("wrong-patient response never renders medical source evidence", async ({
  page,
}) => {
  await fixture(page, { wrongPatient: true });
  const panel = page.getByRole("region", {
    name: "Outside prescription history",
  });
  await expect(panel.getByRole("alert")).toBeVisible();
  await expect(panel.getByRole("article")).toHaveCount(0);
});
test("failed history request offers a working retry", async ({ page }) => {
  const state = await fixture(page, { fail: true });
  const panel = page.getByRole("region", {
    name: "Outside prescription history",
  });
  await expect(panel.getByRole("alert")).toBeVisible();
  state.fail = false;
  await panel
    .getByRole("button", { name: "Refresh outside prescriptions", exact: true })
    .click();
  await expect(panel.getByRole("article")).toBeVisible();
});

async function fillReview(page: Page) {
  const panel = page.getByRole("region", {
    name: "Review outside prescription history",
    exact: true,
  });
  await panel.getByRole("button", { name: /Inspect prescription/ }).click();
  await panel
    .getByRole("combobox", {
      name: "Historical prescription status",
      exact: true,
    })
    .selectOption("unknown");
  await panel
    .getByRole("combobox", {
      name: "Prescription date interpretation",
      exact: true,
    })
    .selectOption("uninterpreted");
  await panel
    .getByRole("combobox", {
      name: "Historical account completeness",
      exact: true,
    })
    .selectOption("partial");
  await panel
    .getByLabel("Partial account disclosure", { exact: true })
    .fill("The parent source list is missing");
  await panel
    .getByLabel("Review rationale", { exact: true })
    .fill("Reviewed original outside prescription evidence");
  const item = receipt.context.items[0].external_id;
  await panel
    .getByLabel(`Include source medication item ${item}`, { exact: true })
    .check();
  await panel
    .getByRole("combobox", {
      name: `Item ${item} start date interpretation`,
      exact: true,
    })
    .selectOption("uninterpreted");
  return panel;
}
test("DVM explicitly prepares and approves outside prescription history", async ({
  page,
}) => {
  const state = await fixture(page, { dvm: true });
  const panel = await fillReview(page);
  await panel
    .getByRole("button", { name: "Prepare prescription review", exact: true })
    .click();
  await expect(
    panel.getByText("Frozen prescription review", { exact: true }),
  ).toBeVisible();
  const approve = panel.getByRole("button", {
    name: "Approve outside prescription history",
    exact: true,
  });
  await expect(approve).toBeDisabled();
  await panel
    .getByLabel(
      "I reviewed the frozen source evidence and exact prescription interpretation.",
    )
    .check();
  await approve.click();
  await expect(
    panel.getByText(
      "Outside prescription history saved. Recovery uses the same receipt.",
    ),
  ).toBeVisible();
  expect(state.records).toHaveLength(1);
  expect(
    state.requests[0].request.payload.interpretation.items[0].product_id,
  ).toBeNull();
});
test("lost preparation and approval recover original operation after reload", async ({
  page,
}) => {
  const state = await fixture(page, {
    dvm: true,
    losePrepare: true,
    loseApprove: true,
  });
  let panel = await fillReview(page);
  await panel
    .getByRole("button", { name: "Prepare prescription review", exact: true })
    .click();
  await expect(panel.getByRole("alert")).toBeVisible();
  await page.reload();
  panel = page.getByRole("region", {
    name: "Review outside prescription history",
    exact: true,
  });
  await panel
    .getByRole("button", {
      name: "Recover original prescription review",
      exact: true,
    })
    .click();
  await expect(
    panel.getByText("Frozen prescription review", { exact: true }),
  ).toBeVisible();
  await panel
    .getByLabel(
      "I reviewed the frozen source evidence and exact prescription interpretation.",
    )
    .check();
  await panel
    .getByRole("button", {
      name: "Approve outside prescription history",
      exact: true,
    })
    .click();
  await expect(panel.getByRole("alert")).toBeVisible();
  await panel
    .getByRole("button", {
      name: "Recover original prescription review",
      exact: true,
    })
    .click();
  await expect(
    panel.getByText(
      "Outside prescription history saved. Recovery uses the same receipt.",
    ),
  ).toBeVisible();
  expect(state.requests).toHaveLength(1);
  expect(state.records).toHaveLength(1);
});
test("shared patient navigation guard retains prepared prescription reference", async ({
  page,
}) => {
  await fixture(page, { dvm: true });
  const panel = await fillReview(page);
  await panel
    .getByRole("button", { name: "Prepare prescription review", exact: true })
    .click();
  await expect(
    panel.getByText("Frozen prescription review", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Synthetic Family", exact: true })
    .click();
  await expect(page.getByRole("alertdialog")).toHaveCount(1);
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(
    panel.getByText("Frozen prescription review", { exact: true }),
  ).toBeVisible();
});
test("stale approval remains recoverable and can be explicitly abandoned", async ({
  page,
}) => {
  const state = await fixture(page, { dvm: true });
  const panel = await fillReview(page);
  await panel
    .getByRole("button", { name: "Prepare prescription review", exact: true })
    .click();
  await expect(
    panel.getByText("Frozen prescription review", { exact: true }),
  ).toBeVisible();
  state.stale = true;
  await panel
    .getByLabel(
      "I reviewed the frozen source evidence and exact prescription interpretation.",
    )
    .check();
  await panel
    .getByRole("button", {
      name: "Approve outside prescription history",
      exact: true,
    })
    .click();
  await expect(panel.getByRole("alert")).toBeVisible();
  await panel
    .getByLabel(
      "Abandon this original prescription request if it has not been approved.",
    )
    .check();
  await panel
    .getByRole("button", {
      name: "Abandon original prescription review",
      exact: true,
    })
    .click();
  await expect(
    panel.getByText("Original review abandoned. It cannot be approved."),
  ).toBeVisible();
  expect(state.records).toHaveLength(0);
});

test("correction retains expected predecessor and selected catalog revision", async ({
  page,
}) => {
  const state = await fixture(page, { dvm: true, initialHistory: true });
  await page
    .getByRole("button", {
      name: `Correct prescription ${receipt.prescription_external_id} version 1`,
      exact: true,
    })
    .click();
  const panel = await fillReview(page);
  const item = receipt.context.items[0].external_id;
  await panel
    .getByRole("combobox", {
      name: "Prescription date interpretation",
      exact: true,
    })
    .selectOption("date");
  await panel
    .getByLabel("Reviewed prescription date", { exact: true })
    .fill("2026-09-13");
  const product = receipt.items[0].product;
  await panel
    .getByRole("combobox", {
      name: `Item ${item} optional catalog match`,
      exact: true,
    })
    .selectOption(`${product.id}:${product.version}`);
  await panel
    .getByRole("button", { name: "Prepare prescription review", exact: true })
    .click();
  await expect(
    panel.getByText("Frozen prescription review", { exact: true }),
  ).toBeVisible();
  expect(state.requests[0].request.payload.interpretation.replaces_id).toBe(
    receipt.id,
  );
  expect(
    state.requests[0].request.payload.interpretation.expected_predecessor_hash,
  ).toBe(receipt.version_hash);
  expect(
    state.requests[0].request.payload.interpretation.items[0].product_version,
  ).toBe(product.version);
  await panel
    .getByLabel(
      "I reviewed the frozen source evidence and exact prescription interpretation.",
    )
    .check();
  await panel
    .getByRole("button", {
      name: "Approve outside prescription history",
      exact: true,
    })
    .click();
  await expect(
    panel.getByText(
      "Outside prescription history saved. Recovery uses the same receipt.",
    ),
  ).toBeVisible();
  expect(state.records.at(-1)?.version).toBe(2);
});
test("mismatched recovery clears approval eligibility until exact original is recovered", async ({
  page,
}) => {
  const state = await fixture(page, { dvm: true });
  const panel = await fillReview(page);
  await panel
    .getByRole("button", { name: "Prepare prescription review", exact: true })
    .click();
  await expect(
    panel.getByText("Frozen prescription review", { exact: true }),
  ).toBeVisible();
  state.wrongActor = true;
  await panel
    .getByRole("button", {
      name: "Recover original prescription review",
      exact: true,
    })
    .click();
  await expect(panel.getByRole("alert")).toBeVisible();
  await expect(
    panel.getByRole("button", {
      name: "Approve outside prescription history",
      exact: true,
    }),
  ).toHaveCount(0);
  state.wrongActor = false;
  await panel
    .getByRole("button", {
      name: "Recover original prescription review",
      exact: true,
    })
    .click();
  await expect(
    panel.getByText("Frozen prescription review", { exact: true }),
  ).toBeVisible();
});
test("saved request discovery recovers loss of browser pointer without another preparation", async ({
  page,
}) => {
  const state = await fixture(page, { dvm: true });
  let panel = await fillReview(page);
  await panel
    .getByRole("button", { name: "Prepare prescription review", exact: true })
    .click();
  await expect(
    panel.getByText("Frozen prescription review", { exact: true }),
  ).toBeVisible();
  await page.evaluate(() => {
    for (const key of Object.keys(sessionStorage))
      if (key.startsWith("ezyvet-prescription-review:"))
        sessionStorage.removeItem(key);
  });
  await page.reload();
  panel = page.getByRole("region", {
    name: "Review outside prescription history",
    exact: true,
  });
  await panel
    .getByText("Saved prescription review requests", { exact: true })
    .click();
  await panel
    .getByRole("button", { name: /^Recover prescription request / })
    .click();
  await expect(
    panel.getByText("Frozen prescription review", { exact: true }),
  ).toBeVisible();
  expect(state.requests).toHaveLength(1);
});
test("unavailable browser storage prevents submitting a new clinical operation", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key.startsWith("ezyvet-prescription-review:"))
        throw new Error("Synthetic unavailable storage");
      original.call(this, key, value);
    };
  });
  const state = await fixture(page, { dvm: true });
  const panel = await fillReview(page);
  await panel
    .getByRole("button", { name: "Prepare prescription review", exact: true })
    .click();
  await expect(panel.getByRole("alert")).toContainText(
    "No review request was submitted",
  );
  expect(
    state.reviewCalls.filter((call) =>
      call.path.endsWith("prepare_ezyvet_prescription_review"),
    ),
  ).toHaveLength(0);
});
test("late preparation reply cannot reopen review after leaving patient chart", async ({
  page,
}) => {
  const state = await fixture(page, { dvm: true });
  const panel = await fillReview(page);
  state.deferPrepare = true;
  await panel
    .getByRole("button", { name: "Prepare prescription review", exact: true })
    .click();
  await expect.poll(() => !!state.releasePrepare).toBe(true);
  await page
    .getByRole("link", { name: "Synthetic Family", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Discard and leave", exact: true })
    .click();
  const recovery = page.waitForResponse((response) =>
    response.url().endsWith("recover_ezyvet_prescription_review"),
  );
  state.releasePrepare!();
  await recovery;
  await expect(panel).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        Object.keys(sessionStorage).filter((key) =>
          key.startsWith("ezyvet-prescription-review:"),
        ).length,
    ),
  ).toBe(1);
});
