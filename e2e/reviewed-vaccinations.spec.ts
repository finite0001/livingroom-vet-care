import { test, expect, type Page } from "@playwright/test";
import {
  actor,
  pet,
  client,
  mapping,
  id,
  at,
  candidate,
  receipt,
  reviewContext,
} from "../tests/vaccination-review/fixtures";
interface Row {
  // Synthetic responses include heterogeneous request and receipt shapes.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}
async function fixture(page: Page, role = "DVM", initialVaccinations: Row[] = []) {
  const user = {
    id: actor,
    aud: "authenticated",
    role: "authenticated",
    email: "synthetic@example.test",
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {},
    created_at: at,
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
    calls: [] as Row[],
    requests: [] as Row[],
    vaccinations: initialVaccinations,
    losePrepare: false,
    loseApprove: false,
    stale: false,
    wrongActor: false,
    omitPrepare: false,
    deferPrepare: false,
    releasePrepare: null as (() => void) | null,
  };
  const patient = {
    id: pet,
    client_id: client,
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
  await page.route("**/*", (r) =>
    new URL(r.request().url()).origin === "http://127.0.0.1:8080"
      ? r.continue()
      : r.abort(),
  );
  await page.route("http://127.0.0.1:54321/**", async (r) => {
    const url = new URL(r.request().url()),
      path = url.pathname,
      body = r.request().method() === "POST" ? r.request().postDataJSON() : {};
    if (path === "/auth/v1/token") return r.fulfill({ json: session });
    if (path === "/auth/v1/user") return r.fulfill({ json: user });
    if (path === "/auth/v1/logout") return r.fulfill({ json: {} });
    if (path === "/rest/v1/profiles")
      return r.fulfill({
        json: [
          {
            id: actor,
            first_name: "Synthetic",
            last_name: "Reviewer",
            full_name: "Synthetic Reviewer",
            role,
            is_active: true,
          },
        ],
      });
    if (path === "/rest/v1/user_roles") return r.fulfill({ json: [{ role }] });
    if (path === "/rest/v1/pets")
      return r.fulfill({
        json: r.request().headers().accept?.includes("vnd.pgrst.object")
          ? patient
          : [patient],
      });
    if (path === "/rest/v1/clients")
      return r.fulfill({
        json: {
          id: client,
          full_name: "Synthetic Family",
          housecall_address: "Synthetic address",
        },
      });
    if (path === "/rest/v1/catalog_products")
      return r.fulfill({
        json: [
          { id: id(9), name: "Synthetic vaccine", version: 3, kind: "vaccine" },
        ],
      });
    if (path.startsWith("/rest/v1/rpc/") || path.startsWith("/functions/"))
      state.calls.push({ path, ...body });
    if (path.endsWith("list_ezyvet_vaccination_review_mappings"))
      return r.fulfill({
        json: [
          {
            link_id: mapping,
            pet_id: pet,
            source_origin: "https://api.trial.ezyvet.com",
            source_site_uid: "synthetic-site",
            external_id: "22",
            patient_version: 1,
          },
        ],
      });
    if (path.endsWith("list_ezyvet_vaccination_review_candidates"))
      return r.fulfill({
        json: {
          animal_link_id: mapping,
          resource: "vaccination",
          candidates: [candidate()],
          has_more: false,
          next_cursor: null,
        },
      });
    if (path.endsWith("list_ezyvet_vaccination_review_requests"))
      return r.fulfill({
        json: { requests: state.requests, has_more: false, next_cursor: null },
      });
    if (path.endsWith("list_patient_imported_vaccinations"))
      return r.fulfill({
        json: {
          vaccinations: state.vaccinations,
          has_more: false,
          next_cursor: null,
        },
      });
    if (path.endsWith("prepare_ezyvet_vaccination_review")) {
      if (state.stale)
        return r.fulfill({ status: 409, json: { message: "SOURCE_STALE" } });
      if (
        !state.requests.some((e) => e.request.id === body.p_id) &&
        !state.omitPrepare
      )
        state.requests.push({
          request: {
            id: body.p_id,
            actor_id: actor,
            pet_id: pet,
            status: "prepared",
            payload: body.p_payload,
            request_hash: "d".repeat(64),
            review_context: {
              ...reviewContext(),
              product: body.p_payload.product_id
                ? {
                    id: id(9),
                    name: "Synthetic vaccine",
                    version: 3,
                    kind: "vaccine",
                  }
                : null,
              reviewed: Object.fromEntries(
                Object.keys(reviewContext().reviewed).map((k) => [
                  k,
                  body.p_payload[k],
                ]),
              ),
            },
            created_at: at,
            resolved_at: null,
            approved_record_id: null,
          },
          receipt: null,
        });
      if (state.deferPrepare)
        await new Promise<void>((resolve) => {
          state.releasePrepare = resolve;
        });
      if (state.losePrepare) {
        state.losePrepare = false;
        return r.abort();
      }
      return r.fulfill({
        json: state.requests.find((e) => e.request.id === body.p_id) ?? null,
      });
    }
    if (path.endsWith("recover_ezyvet_vaccination_review")) {
      const value = state.requests.find((e) => e.request.id === body.p_id);
      return r.fulfill({
        json: value
          ? {
              ...value,
              request: {
                ...value.request,
                actor_id: state.wrongActor ? id(99) : actor,
              },
            }
          : null,
      });
    }
    if (path.endsWith("approve_ezyvet_vaccination_review")) {
      if (state.stale)
        return r.fulfill({ status: 409, json: { message: "SOURCE_STALE" } });
      const e = state.requests.find((v) => v.request.id === body.p_id)!;
      e.request.status = "approved";
      e.request.resolved_at = at;
      e.request.approved_record_id = id(7);
      const v = receipt();
      e.receipt = {
        ...v,
        reviewed: Object.fromEntries(
          Object.keys(v.reviewed).map((k) => [k, e.request.payload[k]]),
        ),
        reason: e.request.payload.reason,
      };
      state.vaccinations = [e.receipt];
      if (state.loseApprove) {
        state.loseApprove = false;
        return r.abort();
      }
      return r.fulfill({ json: e });
    }
    if (path.endsWith("abandon_ezyvet_vaccination_review")) {
      let e = state.requests.find((v) => v.request.id === body.p_id);
      if (!e) {
        e = {
          request: {
            id: body.p_id,
            actor_id: actor,
            pet_id: pet,
            status: "abandoned",
            payload: null,
            request_hash: null,
            review_context: null,
            created_at: at,
            resolved_at: at,
            approved_record_id: null,
          },
          receipt: null,
        };
        state.requests.push(e);
      } else if (e.request.status !== "approved") {
        e.request.status = "abandoned";
        e.request.resolved_at = at;
      }
      return r.fulfill({ json: e });
    }
    if (path.endsWith("list_patient_imported_histories"))
      return r.fulfill({
        json: { histories: [], has_more: false, next_cursor: null },
      });
    if (path.endsWith("list_ezyvet_history_requests"))
      return r.fulfill({
        json: { requests: [], has_more: false, next_cursor: null },
      });
    return r.fulfill({ json: [] });
  });
  await page.goto(`/hub/patient/${pet}`);
  await expect(
    page.getByRole("heading", {
      name: "Outside vaccination history",
      exact: true,
    }),
  ).toBeVisible({ timeout: 15000 });
  return state;
}
async function fill(page: Page) {
  const panel = page.getByRole("region", {
    name: "Review outside vaccination history",
    exact: true,
  });
  await panel.getByLabel("ezyVet patient mapping").selectOption(mapping);
  await panel
    .getByRole("button", { name: "Review source vaccination 71", exact: true })
    .click();
  await panel.getByLabel("Reviewed vaccination status").selectOption("unknown");
  await panel
    .getByLabel("Administration date interpretation")
    .selectOption("uninterpreted");
  await panel
    .getByLabel("Source next date interpretation")
    .selectOption("unknown");
  await panel
    .getByLabel("Vaccination review rationale")
    .fill("Reviewed ambiguous source evidence");
  return panel;
}
test("DVM explicitly reviews nullable outside history without native side effects", async ({
  page,
}) => {
  const state = await fixture(page),
    panel = await fill(page);
  await panel
    .getByText("Original ezyVet vaccination values", { exact: true })
    .click();
  await expect(
    panel.getByText("unknown units 100", { exact: true }),
  ).toBeVisible();
  await expect(panel.locator("img")).toHaveCount(0);
  await panel
    .getByRole("button", { name: "Prepare vaccination review", exact: true })
    .click();
  await expect(
    panel.getByRole("button", { name: "Approve outside vaccination history" }),
  ).toBeDisabled();
  await panel
    .getByLabel(
      "I reviewed the frozen source evidence and exact vaccination interpretation.",
    )
    .check();
  await panel
    .getByRole("button", { name: "Approve outside vaccination history" })
    .click();
  await expect(
    panel.getByText(
      "Outside vaccination history saved. Recovery uses the same receipt.",
    ),
  ).toBeVisible();
  const prepare = state.calls.find((c) =>
    c.path.endsWith("prepare_ezyvet_vaccination_review"),
  )!;
  expect(prepare.p_payload).toMatchObject({
    status: "unknown",
    administered_on: null,
    source_next_due_on: null,
    product_id: null,
    outside_author: null,
  });
  expect(
    state.calls.filter(
      (c) =>
        /record_patient_treatment|save_patient_vaccine_due_plan|invoice|reminder|certificate/.test(
          c.path,
        ) && Object.keys(c).length > 2,
    ),
  ).toEqual([]);
});
test("lost prepare and approval responses recover one exact operation after reload", async ({
  page,
}) => {
  const state = await fixture(page),
    panel = await fill(page);
  state.losePrepare = true;
  await panel
    .getByRole("button", { name: "Prepare vaccination review", exact: true })
    .click();
  await expect(panel.getByRole("alert")).toBeVisible();
  const initial = state.calls.find((c) =>
    c.path.endsWith("prepare_ezyvet_vaccination_review"),
  )!;
  await page.reload();
  await panel
    .getByRole("button", { name: "Recover original vaccination review" })
    .click();
  await panel
    .getByLabel(
      "I reviewed the frozen source evidence and exact vaccination interpretation.",
    )
    .check();
  state.loseApprove = true;
  await panel
    .getByRole("button", { name: "Approve outside vaccination history" })
    .click();
  await expect(panel.getByRole("alert")).toBeVisible();
  state.stale = true;
  await panel
    .getByRole("button", { name: "Recover original vaccination review" })
    .click();
  await expect(
    panel.getByText(
      "Outside vaccination history saved. Recovery uses the same receipt.",
    ),
  ).toBeVisible();
  expect(state.requests).toHaveLength(1);
  expect(
    state.calls
      .filter((c) => c.path.endsWith("approve_ezyvet_vaccination_review"))
      .map((c) => c.p_id),
  ).toEqual([initial.p_id]);
});
test("lost uncommitted preparation retries frozen intent, then explicit abandon", async ({
  page,
}) => {
  const state = await fixture(page),
    panel = await fill(page);
  state.omitPrepare = true;
  state.losePrepare = true;
  await panel
    .getByRole("button", { name: "Prepare vaccination review", exact: true })
    .click();
  await expect(panel.getByRole("alert")).toBeVisible();
  await page.reload();
  state.omitPrepare = false;
  await panel
    .getByRole("button", { name: "Retry exact vaccination preparation" })
    .click();
  await expect(
    panel.getByText("Frozen review values", { exact: true }),
  ).toBeVisible();
  const calls = state.calls.filter((c) =>
    c.path.endsWith("prepare_ezyvet_vaccination_review"),
  );
  expect(calls).toHaveLength(2);
  expect(calls[0]).toEqual(calls[1]);
  await panel
    .getByLabel(
      "Abandon this original vaccination request if it has not been approved.",
    )
    .check();
  await panel
    .getByRole("button", { name: "Abandon original vaccination review" })
    .click();
  await expect(
    panel.getByRole("button", { name: "Close resolved vaccination review" }),
  ).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "Approve outside vaccination history" }),
  ).toHaveCount(0);
});
test("durable discovery restores pointer loss; wrong actor response blocks approval", async ({
  page,
}) => {
  const state = await fixture(page),
    panel = await fill(page);
  await panel
    .getByRole("button", { name: "Prepare vaccination review", exact: true })
    .click();
  await expect(
    panel.getByText("Frozen review values", { exact: true }),
  ).toBeVisible();
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await panel
    .getByText("Saved vaccination review requests", { exact: true })
    .click();
  state.wrongActor = true;
  await panel
    .getByRole("button", { name: /^Recover vaccination request / })
    .click();
  await expect(panel.getByRole("alert")).toContainText("differs");
  await expect(
    panel.getByRole("button", { name: "Approve outside vaccination history" }),
  ).toHaveCount(0);
  state.wrongActor = false;
  await panel
    .getByRole("button", { name: "Recover original vaccination review" })
    .click();
  await expect(
    panel.getByRole("button", { name: "Approve outside vaccination history" }),
  ).toBeDisabled();
});
test("all active staff read immutable review history, only DVM sees interpretation", async ({
  page,
}) => {
  const state = await fixture(page, "CSR", [
    {
      ...receipt(),
      current: { ...receipt().current, is_current: false, is_latest: false },
    },
  ]);
  await page
    .getByRole("button", { name: "Refresh outside vaccination history" })
    .click();
  await expect(
    page.getByText("Superseded review — retained for history."),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Source or patient context has changed since this review. The saved interpretation remains unchanged.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("region", {
      name: "Review outside vaccination history",
      exact: true,
    }),
  ).toHaveCount(0);
  expect(
    state.calls.filter((c) =>
      /list_ezyvet_vaccination_review_(mappings|candidates|requests)/.test(
        c.path,
      ),
    ),
  ).toEqual([]);
});
test("patient navigation preserves request with one shared confirmation", async ({
  page,
}) => {
  await fixture(page);
  const panel = await fill(page);
  await panel
    .getByRole("button", { name: "Prepare vaccination review", exact: true })
    .click();
  await expect(
    panel.getByText("Frozen review values", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Synthetic Family", exact: true })
    .click();
  await expect(page.getByRole("alertdialog")).toHaveCount(1);
  await page.getByRole("button", { name: "Keep editing" }).click();
  await expect(
    panel.getByText("Frozen review values", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Synthetic Family", exact: true })
    .click();
  await page.getByRole("button", { name: "Discard and leave" }).click();
  const retained = await page.evaluate(() =>
    Object.keys(sessionStorage).filter((k) =>
      k.startsWith("ezyvet-vaccination-review:"),
    ),
  );
  expect(retained).toHaveLength(1);
});

test("correction freezes predecessor, explicit catalog version and calendar date", async ({
  page,
}) => {
  const state = await fixture(page);
  state.vaccinations = [receipt()];
  await page
    .getByRole("button", { name: "Refresh outside vaccination history" })
    .click();
  await page
    .getByRole("button", { name: "Correct vaccination 71 version 1" })
    .click();
  const panel = await fill(page);
  await panel
    .getByLabel("Administration date interpretation")
    .selectOption("date");
  await panel
    .getByLabel("Reviewed administration date", { exact: true })
    .fill("2026-02-28");
  await panel
    .getByLabel("Local vaccine product (optional)")
    .selectOption(id(9));
  await panel
    .getByRole("button", { name: "Prepare vaccination review", exact: true })
    .click();
  await expect(
    panel.getByText("Frozen review values", { exact: true }),
  ).toBeVisible();
  const prepared = state.calls.find((c) =>
    c.path.endsWith("prepare_ezyvet_vaccination_review"),
  )!;
  expect(prepared.p_payload).toMatchObject({
    replaces_id: id(7),
    expected_predecessor_hash: "c".repeat(64),
    product_id: id(9),
    product_version: 3,
    administered_on: "2026-02-28",
    administration_date_status: "date",
  });
  expect(prepared.p_payload).not.toHaveProperty("manufacturer");
});
test("stale evidence refuses approval and retains original reference", async ({
  page,
}) => {
  const state = await fixture(page),
    panel = await fill(page);
  await panel
    .getByRole("button", { name: "Prepare vaccination review", exact: true })
    .click();
  await panel
    .getByLabel(
      "I reviewed the frozen source evidence and exact vaccination interpretation.",
    )
    .check();
  state.stale = true;
  await panel
    .getByRole("button", { name: "Approve outside vaccination history" })
    .click();
  await expect(panel.getByRole("alert")).toContainText(
    "Recover the original request",
  );
  await expect(
    panel.getByRole("button", { name: "Approve outside vaccination history" }),
  ).toBeDisabled();
  await expect(
    panel.getByRole("button", { name: "Recover original vaccination review" }),
  ).toBeVisible();
  expect(state.vaccinations).toHaveLength(0);
});

test("late preparation response cannot reopen review after leaving patient chart", async ({
  page,
}) => {
  const state = await fixture(page),
    panel = await fill(page);
  state.deferPrepare = true;
  await panel
    .getByRole("button", { name: "Prepare vaccination review", exact: true })
    .click();
  await expect.poll(() => state.releasePrepare !== null).toBe(true);
  await page
    .getByRole("link", { name: "Synthetic Family", exact: true })
    .click();
  await page.getByRole("button", { name: "Discard and leave" }).click();
  await expect(page).toHaveURL(new RegExp(`/hub/client/${client}`));
  state.releasePrepare!();
  await expect
    .poll(
      () =>
        state.calls.filter((c) =>
          c.path.endsWith("recover_ezyvet_vaccination_review"),
        ).length,
    )
    .toBe(1);
  await expect(
    page.getByRole("region", {
      name: "Review outside vaccination history",
      exact: true,
    }),
  ).toHaveCount(0);
  expect(
    state.calls.filter((c) =>
      c.path.endsWith("approve_ezyvet_vaccination_review"),
    ),
  ).toHaveLength(0);
  const retained = await page.evaluate(() =>
    Object.keys(sessionStorage).filter((k) =>
      k.startsWith("ezyvet-vaccination-review:"),
    ),
  );
  expect(retained).toEqual([`ezyvet-vaccination-review:${actor}:${pet}`]);
});
