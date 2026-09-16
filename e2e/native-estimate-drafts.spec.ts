import { test, expect, type Page } from "@playwright/test";
import type {
  EstimateDraft,
  EstimateFields,
  EstimateReceipt,
  EstimateRequest,
} from "../src/hub/features/estimates/estimate-api";
import { estimateTotalCents } from "../src/hub/features/estimates/estimate-api";
const id = (n: number) =>
    `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  actor = id(1),
  client = id(2),
  pet = id(3),
  product = id(4),
  hash = "a".repeat(64),
  time = "2026-09-16T12:00:00.000Z";
const fields = (): EstimateFields => ({
  title: "Existing estimate",
  notes: "",
  terms: "Discuss changes before proceeding.",
  accept_by: "2026-10-31",
  lines: [
    {
      id: id(6),
      product_id: product,
      product_version: 1,
      description: "Consultation",
      kind: "service",
      unit: "visit",
      quantity: "1",
      pricing: { kind: "unit", unit_price_cents: "1000" },
      pricing_reason: null,
    },
  ],
});
async function workspace(page: Page, historyCount = 0) {
  const drafts = new Map<string, EstimateDraft>(),
    histories = new Map<string, EstimateDraft[]>(),
    receipts = new Map<string, EstimateReceipt>(),
    closures = new Map<string, unknown>(),
    calls: { id: string; request: EstimateRequest }[] = [],
    closeCalls: { id: string; request: EstimateRequest }[] = [];
  const state = {
    lose: false,
    neverSent: false,
    loseClose: false,
    stale: false,
    productVersion: 1,
  };
  if (historyCount) {
    const rows = Array.from({ length: historyCount }, (_, i) => ({
      id: id(5),
      client_id: client,
      pet_id: pet,
      version: i + 1,
      fields: fields(),
      total_cents: "1000",
      created_by: actor,
      created_at: time,
      updated_by: actor,
      updated_at: new Date(Date.parse(time) + i * 1000).toISOString(),
    }));
    drafts.set(id(5), rows.at(-1)!);
    histories.set(id(5), rows);
  }
  await page.route("**/rest/v1/**", async (route) => {
    const url = new URL(route.request().url()),
      name = url.pathname.split("/").at(-1)!;
    let value: unknown;
    if (!url.pathname.includes("/rpc/")) {
      value =
        name === "pets"
          ? [{ id: pet, name: "Juniper" }]
          : name === "catalog_products"
            ? [
                {
                  id: product,
                  name: "Consultation",
                  kind: "service",
                  unit: "visit",
                  unit_price_cents: 1000,
                  active: true,
                  version: state.productVersion,
                },
              ]
            : [];
      await route.fulfill({ json: value });
      return;
    }
    const a = route.request().postDataJSON();
    if (name === "list_native_estimate_drafts") {
      const rows = [...drafts.values()]
          .sort(
            (a, b) =>
              b.created_at.localeCompare(a.created_at) ||
              b.id.localeCompare(a.id),
          )
          .filter(
            (d) =>
              !a.p_before_id ||
              d.created_at < a.p_before_at ||
              (d.created_at === a.p_before_at && d.id < a.p_before_id),
          ),
        slice = rows.slice(0, a.p_limit),
        last = slice.at(-1);
      value = {
        version: 1,
        actor_id: actor,
        client_id: client,
        drafts: slice,
        has_more: rows.length > a.p_limit,
        next_cursor:
          rows.length > a.p_limit
            ? { before_at: last!.created_at, before_id: last!.id }
            : null,
      };
    } else if (name === "read_native_estimate_draft")
      value = {
        version: 1,
        actor_id: actor,
        draft: drafts.get(a.p_id) ?? null,
      };
    else if (name === "read_native_estimate_draft_history") {
      const rows = [...(histories.get(a.p_id) ?? [])]
          .reverse()
          .filter(
            (d) =>
              a.p_before_version === null || d.version < a.p_before_version,
          ),
        slice = rows.slice(0, a.p_limit);
      value = {
        version: 1,
        actor_id: actor,
        client_id: client,
        estimate_id: a.p_id,
        revisions: slice,
        has_more: rows.length > a.p_limit,
        next_before_version:
          rows.length > a.p_limit ? slice.at(-1)!.version : null,
      };
    } else if (name === "save_native_estimate_draft") {
      calls.push({ id: a.p_id, request: a.p_request });
      if (state.neverSent) {
        await route.abort("failed");
        return;
      }
      if (state.stale) {
        await route.fulfill({
          status: 409,
          json: { code: "40001", message: "Draft revision changed" },
        });
        return;
      }
      if (!receipts.has(a.p_id)) {
        const q = a.p_request as EstimateRequest,
          old = drafts.get(q.estimate_id),
          stamp = new Date(
            Date.parse(time) + (q.expected_version ?? 0) * 1000,
          ).toISOString(),
          d: EstimateDraft = {
            id: q.estimate_id,
            client_id: client,
            pet_id: q.pet_id,
            version: (q.expected_version ?? 0) + 1,
            fields: q.fields,
            total_cents: estimateTotalCents(q.fields.lines),
            created_by: old?.created_by ?? actor,
            created_at: old?.created_at ?? stamp,
            updated_by: actor,
            updated_at: stamp,
          };
        drafts.set(d.id, d);
        histories.set(d.id, [...(histories.get(d.id) ?? []), d]);
        receipts.set(a.p_id, {
          version: 1,
          id: a.p_id,
          actor_id: actor,
          request: q,
          request_hash: hash,
          result: d,
          created_at: stamp,
        });
      }
      if (state.lose) {
        await route.abort("failed");
        return;
      }
      value = receipts.get(a.p_id);
    } else if (name === "recover_native_estimate_draft")
      value = receipts.get(a.p_id) ?? null;
    else if (name === "close_native_estimate_draft") {
      closeCalls.push({ id: a.p_id, request: a.p_request });
      if (receipts.has(a.p_id))
        value = {
          version: 1,
          status: "recorded",
          receipt: receipts.get(a.p_id),
        };
      else {
        if (!closures.has(a.p_id))
          closures.set(a.p_id, {
            version: 1,
            status: "closed_unrecorded",
            closure: {
              version: 1,
              id: a.p_id,
              actor_id: actor,
              request: a.p_request,
              request_hash: hash,
              closed_at: time,
              record_hash: hash,
            },
          });
        value = closures.get(a.p_id);
      }
      if (state.loseClose) {
        await route.abort("failed");
        return;
      }
    } else value = null;
    await route.fulfill({ json: value });
  });
  async function mount(recover = false) {
    await page.goto("/");
    await page.evaluate(
      async ({ actor, client }) => {
        const h = await import("/tests/estimates/browser-harness.tsx");
        h.mountEstimateDrafts(actor, client);
      },
      { actor, client },
    );
    await expect(
      page.getByRole("heading", { name: "Estimates", exact: true }),
    ).toBeVisible({ timeout: 30000 });
    await expect(
      page.getByRole("button", {
        name: recover ? "Recover original estimate save" : "New estimate draft",
      }),
    ).toBeEnabled();
  }
  await mount();
  return { state, calls, closeCalls, drafts, histories, mount };
}
async function newEditor(page: Page) {
  await page.getByRole("button", { name: "New estimate draft" }).click();
  await page
    .getByLabel("Estimate title", { exact: true })
    .fill("Housecall plan");
  await page.getByLabel("Acceptance deadline").fill("2026-10-31");
  await page
    .getByRole("combobox", { name: "Patient", exact: true })
    .selectOption(pet);
  await page
    .getByLabel("Estimate terms and exclusions")
    .fill("Discuss any change before proceeding.");
  await page
    .getByRole("combobox", { name: "Catalog product", exact: true })
    .selectOption(product);
  await page.getByRole("button", { name: "Add estimate line" }).click();
}
async function save(page: Page) {
  await page.getByRole("button", { name: "Review draft save" }).click();
  await page.getByRole("button", { name: "Save reviewed draft" }).click();
}
test("mobile draft editor and expanded history remain readable without horizontal scrolling", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await workspace(page, 1);
  await page.getByRole("button", { name: "Existing estimate · revision 1 · $10.00" }).click();
  await page.getByRole("button", { name: "Load revision history" }).click();
  await page.locator("summary").filter({ hasText: "Revision 1 ·" }).click();
  await expect(page.getByRole("heading", { name: "Existing estimate", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("estimate-mobile-history.png"), fullPage: true });
});

test("saves exact partial quantity and allocated pricing without billing or approval", async ({
  page,
}) => {
  const w = await workspace(page);
  await newEditor(page);
  await page.getByLabel("Quantity for line 1", { exact: true }).fill("0.125");
  await page
    .getByRole("combobox", { name: "Pricing for line 1", exact: true })
    .selectOption("allocated");
  await page.getByLabel("Whole-line amount in dollars for line 1").fill("7.25");
  await page
    .getByLabel("Pricing reason for line 1")
    .fill("Agreed partial service allocation");
  await save(page);
  await expect(
    page.getByText("The exact estimate draft revision was saved."),
  ).toBeVisible();
  expect(w.calls).toHaveLength(1);
  const r = w.calls[0].request;
  expect(r.fields.lines[0].quantity).toBe("0.125");
  expect(r.fields.lines[0].pricing).toEqual({
    kind: "allocated",
    amount_cents: "725",
  });
  expect([...w.drafts.values()][0].total_cents).toBe("725");
  await expect(
    page.getByRole("button", { name: /publish|approve|pay/i }),
  ).toHaveCount(0);
});
test("stale version retains edits and requires explicit current-version comparison", async ({
  page,
}) => {
  const w = await workspace(page, 1);
  await page
    .getByRole("button", { name: "Existing estimate · revision 1 · $10.00" })
    .click();
  await page
    .getByLabel("Estimate title", { exact: true })
    .fill("My edited estimate");
  w.state.stale = true;
  await save(page);
  await expect(
    page.getByRole("button", { name: "Load current revision for comparison" }),
  ).toBeVisible();
  await expect(page.getByLabel("Estimate title", { exact: true })).toHaveValue(
    "My edited estimate",
  );
  await expect(
    page.getByRole("button", { name: "Review draft save" }),
  ).toBeDisabled();
  const old = w.drafts.get(id(5))!;
  w.drafts.set(id(5), {
    ...old,
    version: 2,
    fields: { ...old.fields, title: "Other staff revision" },
  });
  await page
    .getByRole("button", { name: "Load current revision for comparison" })
    .click();
  await expect(
    page.getByText("Current saved revision 2:", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "Keep my edits against this current revision",
    })
    .click();
  w.state.stale = false;
  await save(page);
  await expect(
    page.getByText("The exact estimate draft revision was saved."),
  ).toBeVisible();
  expect(w.calls[1].request.expected_version).toBe(2);
  expect(w.calls[1].request.fields.title).toBe("My edited estimate");
});
test("lost save reload recovers the exact original and immutable history pages", async ({
  page,
}) => {
  const w = await workspace(page, 21);
  await page
    .getByRole("button", { name: "Existing estimate · revision 21 · $10.00" })
    .click();
  await page.getByRole("button", { name: "Load revision history" }).click();
  await expect(
    page.locator("summary").filter({ hasText: "Revision 21 ·" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Older revisions" }).click();
  await expect(
    page.locator("summary").filter({ hasText: "Revision 1 ·" }),
  ).toBeVisible();
  await page.getByLabel("Draft notes").fill("Retain this exact note");
  w.state.lose = true;
  await save(page);
  await expect(
    page.getByRole("button", { name: "Recover original estimate save" }),
  ).toBeVisible();
  await w.mount(true);
  await page
    .getByRole("button", { name: "Recover original estimate save" })
    .click();
  await expect(
    page.getByText("The exact estimate draft revision was saved."),
  ).toBeVisible();
  expect(w.calls).toHaveLength(1);
  expect(w.calls[0].request.expected_version).toBe(21);
  await expect(page.getByLabel("Draft notes")).toHaveValue(
    "Retain this exact note",
  );
});
test("lost close response reload retains original identity until durable closure", async ({
  page,
}) => {
  const w = await workspace(page);
  await newEditor(page);
  w.state.neverSent = true;
  await save(page);
  w.state.loseClose = true;
  await page
    .getByRole("button", { name: "Resolve or close original estimate save" })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Resolve or close original estimate save",
    }),
  ).toBeEnabled();
  await w.mount(true);
  w.state.loseClose = false;
  await page
    .getByRole("button", { name: "Resolve or close original estimate save" })
    .click();
  await expect(
    page.getByText(
      "The original request was closed without saving a draft revision.",
      { exact: false },
    ),
  ).toBeVisible();
  await expect(page.getByLabel("Estimate title", { exact: true })).toHaveValue(
    "Housecall plan",
  );
  expect(w.closeCalls).toHaveLength(2);
  expect(w.closeCalls[1]).toEqual(w.closeCalls[0]);
  expect(w.drafts.size).toBe(0);
});
test("catalog refresh requires explicit line revision adoption and unsaved navigation confirmation", async ({
  page,
}) => {
  const w = await workspace(page);
  await newEditor(page);
  w.state.productVersion = 2;
  await page
    .getByRole("button", { name: "Search catalog", exact: true })
    .click();
  await expect(
    page.getByText("Current catalog revision is 2", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Review draft save" }).click();
  await expect(
    page.getByRole("button", { name: "Save reviewed draft" }),
  ).toHaveCount(0);
  await page
    .getByRole("button", {
      name: "Use current catalog unit and revision for line 1",
    })
    .click();
  await page.getByRole("link", { name: "Leave household fixture" }).click();
  await expect(
    page.getByRole("dialog", { name: "Unfinished estimate" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Stay", exact: true }).click();
  await expect(page.getByLabel("Estimate title", { exact: true })).toHaveValue(
    "Housecall plan",
  );
  await save(page);
  await expect(
    page.getByText("The exact estimate draft revision was saved."),
  ).toBeVisible();
  expect(w.calls[0].request.fields.lines[0].product_version).toBe(2);
});
