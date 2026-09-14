import { createHash } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
const actor = "11111111-1111-4111-8111-111111111111",
  pet = "22222222-2222-4222-8222-222222222222",
  link = "33333333-3333-4333-8333-333333333333",
  client = "44444444-4444-4444-8444-444444444444",
  snapshot = "55555555-5555-4555-8555-555555555555",
  savedId = "66666666-6666-4666-8666-666666666666";
const at = "2026-09-13T12:00:00Z";
interface Row {
  [key: string]: unknown;
}
async function metadataFixture(page: Page, admin = true) {
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
  const mapping = {
    link_id: link,
    pet_id: pet,
    patient_name: "Synthetic Juniper",
    household_name: "Synthetic Family",
    source_origin: "https://api.trial.ezyvet.com",
    source_site_uid: "synthetic-site",
    external_id: "22",
    patient_version: 1,
  };
  const state = {
    runs: [] as Row[],
    calls: [] as Row[],
    lose: false,
    failRecovery: false,
    wrong: false,
    unsafe: false,
    more: false,
    running: false,
    secondMapping: false,
  };
  function run(id: unknown) {
    return {
      id,
      requested_by: actor,
      resource: "attachment",
      source_origin: mapping.source_origin,
      source_site_uid: mapping.source_site_uid,
      status: state.running ? "running" : "review_ready",
      next_page: 2,
      retry_after: null,
      last_error_code: null,
      created_at: at,
      updated_at: at,
      lease_active: false,
      scope: "animal_attachment_metadata",
      parent_context: {
        animal_link_id: link,
        pet_id: pet,
        client_id: client,
        animal_external_id: "22",
        source_origin: mapping.source_origin,
        source_site_uid: mapping.source_site_uid,
        parent_type: "Animal",
        parent_external_id: "22",
        parent_snapshot_id: snapshot,
        parent_payload_hash: "a".repeat(64),
        parent_observed_head_version: 1,
      },
      observed_count: 2,
      staged_count: 1,
      capture_available: false,
    };
  }
  await page.route("**/*", (r) =>
    new URL(r.request().url()).origin ===
    new URL(test.info().project.use.baseURL!).origin
      ? r.continue()
      : r.abort(),
  );
  await page.route("http://127.0.0.1:54321/**", async (r) => {
    const path = new URL(r.request().url()).pathname,
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
            last_name: "Admin",
            full_name: "Synthetic Admin",
            role: admin ? "ADMIN" : "STAFF",
            is_active: true,
          },
        ],
      });
    if (path === "/rest/v1/user_roles")
      return r.fulfill({ json: [{ role: admin ? "ADMIN" : "STAFF" }] });
    if (path.endsWith("search_ezyvet_mapped_patients"))
      return r.fulfill({
        json: state.secondMapping
          ? [
              {
                ...mapping,
                link_id: client,
                pet_id: snapshot,
                patient_name: "Synthetic Cedar",
                external_id: "99",
              },
            ]
          : [mapping],
      });
    if (path.endsWith("list_ezyvet_attachment_runs")) {
      state.calls.push({ path, ...body });
      return r.fulfill({
        json: {
          runs: state.runs,
          has_more: state.more && !body.p_before_id,
          next_cursor:
            state.more && !body.p_before_id
              ? { before_at: at, before_id: savedId }
              : null,
        },
      });
    }
    if (path.endsWith("recover_ezyvet_attachment_run")) {
      state.calls.push({ path, ...body });
      if (state.failRecovery)
        return r.fulfill({ status: 500, json: { message: "unavailable" } });
      const value = state.runs.find((v) => v.id === body.p_id);
      return r.fulfill({
        json: value
          ? { ...value, requested_by: state.wrong ? client : actor }
          : null,
      });
    }
    if (path.endsWith("list_ezyvet_attachment_observations")) {
      state.calls.push({ path, ...body });
      const ordinal = body.p_after_ordinal ? 2 : 1;
      return r.fulfill({
        json: {
          observations: [
            {
              run_id: body.p_run_id,
              page: 1,
              ordinal,
              external_id: "7",
              file_id: "8",
              metadata: {
                id: "7",
                file_id: "8",
                record_type: "Animal",
                record_id: "22",
                name: "<script>outside attachment</script>",
                ...(state.unsafe
                  ? { file_download_url: "https://private.example.test/secret" }
                  : {}),
              },
              raw_record_sha256: "a".repeat(64),
              stable_metadata_sha256: "b".repeat(64),
              snapshot_id: snapshot,
              observed_head_version: 1,
              is_current: ordinal === 1,
              created_at: at,
              file_sha256: null,
            },
          ],
          has_more: state.more && ordinal === 1,
          next_cursor:
            state.more && ordinal === 1
              ? { after_page: 1, after_ordinal: 1 }
              : null,
        },
      });
    }
    if (path === "/functions/v1/ezyvet-import") {
      state.calls.push({ path, ...body });
      state.runs = [run(body.run_id)];
      if (state.lose) return r.abort();
      return r.fulfill({
        json: {
          run_id: body.run_id,
          status: state.running ? "running" : "review_ready",
          next_page: 2,
          complete: !state.running,
        },
      });
    }
    return r.fulfill({ json: [] });
  });
  return { state, run };
}
async function select(page: Page) {
  await page.goto("/hub/tools/ezyvet");
  const panel = page.getByRole("region", {
    name: "Attachment metadata import",
    exact: true,
  });
  await panel.getByLabel("Find attachment patient").fill("Juniper");
  await panel
    .getByRole("button", {
      name: "Synthetic Juniper · Synthetic Family · synthetic-site",
      exact: true,
    })
    .click();
  return panel;
}
async function fixture(page: Page, mime = "application/pdf") {
  const metadata = await metadataFixture(page);
  const bytes =
    mime === "image/jpeg"
      ? Buffer.from([255, 216, 255, 1, 2, 3, 4])
      : Buffer.from("%PDF-1.4\nSynthetic original\n%%EOF");
  const state = {
    captures: [] as Row[],
    calls: [] as Row[],
    losePrepare: false,
    loseCapture: false,
    loseDiscard: false,
    failRecover: false,
    wrong: false,
    tamper: false,
    more: false,
    holdReserved: false,
    rejectPrepare: false,
    historicalOnly: false,
    racePrepare: false,
    loseAbandon: false,
  };
  function capture(id: unknown) {
    return {
      id,
      requested_by: actor,
      animal_link_id: link,
      pet_id: pet,
      client_id: client,
      run_id: savedId,
      page: 1,
      ordinal: 1,
      snapshot_id: snapshot,
      observed_head_version: 1,
      external_id: "7",
      file_id: "8",
      stable_metadata_sha256: "b".repeat(64),
      raw_record_sha256: "a".repeat(64),
      metadata: {
        id: "7",
        file_id: "8",
        record_type: "Animal",
        record_id: "22",
        name: "Synthetic original.pdf",
      },
      parent_context: {
        animal_link_id: link,
        pet_id: pet,
        client_id: client,
        animal_external_id: "22",
        source_origin: "https://api.trial.ezyvet.com",
        source_site_uid: "synthetic-site",
        parent_type: "Animal",
        parent_external_id: "22",
        parent_snapshot_id: snapshot,
        parent_payload_hash: "a".repeat(64),
        parent_observed_head_version: 1,
      },
      request_hash: "c".repeat(64),
      status: "prepared",
      source_current: true,
      lease_active: false,
      retry_after: null,
      last_error_code: null,
      retryable: true,
      created_at: at,
      updated_at: at,
      capture: null,
    };
  }
  function receipt(id: unknown) {
    return {
      id: snapshot,
      request_id: id,
      entry_method: "ezyvet_api_attachment_original_v1",
      content_sha256: createHash("sha256").update(bytes).digest("hex"),
      mime_type: mime,
      file_size: bytes.length,
      capture_hash: "d".repeat(64),
      captured_at: at,
    };
  }
  await page.route("http://127.0.0.1:54321/**", async (route) => {
    const path = new URL(route.request().url()).pathname,
      body =
        route.request().method() === "POST"
          ? route.request().postDataJSON()
          : {};
    if (path.endsWith("search_ezyvet_mapped_patients") && state.historicalOnly)
      return route.fulfill({ json: [] });
    if (path.endsWith("list_ezyvet_attachment_capture_mappings"))
      return route.fulfill({
        json: {
          mappings: state.historicalOnly
            ? [
                {
                  link_id: link,
                  pet_id: pet,
                  patient_name: "Synthetic Juniper",
                  household_name: "Original household",
                  source_origin: "https://api.trial.ezyvet.com",
                  source_site_uid: "synthetic-site",
                  external_id: "22",
                  patient_version: 2,
                  last_capture_at: at,
                },
              ]
            : [],
          has_more: false,
          next_cursor: null,
        },
      });
    if (path.endsWith("list_ezyvet_attachment_captures")) {
      state.calls.push({ path, ...body });
      return route.fulfill({
        json: {
          captures: state.captures,
          has_more: state.more && !body.p_before_id,
          next_cursor:
            state.more && !body.p_before_id && state.captures.length
              ? { before_at: at, before_id: state.captures.at(-1)!.id }
              : null,
        },
      });
    }
    if (path.endsWith("recover_ezyvet_attachment_capture")) {
      state.calls.push({ path, ...body });
      if (state.failRecover)
        return route.fulfill({ status: 500, json: { message: "unavailable" } });
      const c = state.captures.find((c) => c.id === body.p_id);
      return route.fulfill({
        json: c ? { ...c, requested_by: state.wrong ? client : actor } : null,
      });
    }
    if (path.endsWith("abandon_ezyvet_attachment_capture_preparation")) {
      state.calls.push({ path, ...body });
      let c = state.captures.find((c) => c.id === body.p_id);
      if (!c) {
        c = {
          ...capture(body.p_id),
          run_id: body.p_run_id,
          page: body.p_page,
          ordinal: body.p_ordinal,
          snapshot_id: body.p_snapshot_id,
          observed_head_version: body.p_observed_head_version,
          stable_metadata_sha256: body.p_stable_metadata_sha256,
          status: state.racePrepare ? "prepared" : "abandoned",
          retryable: state.racePrepare,
        };
        state.captures = [c];
      }
      if (state.loseAbandon) return route.abort();
      return route.fulfill({ json: c });
    }
    if (path.endsWith("prepare_ezyvet_attachment_capture")) {
      state.calls.push({ path, ...body });
      if (state.rejectPrepare)
        return route.fulfill({ status: 409, json: { message: "stale" } });
      const existing = state.captures.find((c) => c.id === body.p_id);
      if (existing) return route.fulfill({ json: existing });
      const c = {
        ...capture(body.p_id),
        run_id: body.p_run_id,
        page: body.p_page,
        ordinal: body.p_ordinal,
        snapshot_id: body.p_snapshot_id,
        observed_head_version: body.p_observed_head_version,
        stable_metadata_sha256: body.p_stable_metadata_sha256,
      };
      state.captures = [c];
      if (state.losePrepare) return route.abort();
      return route.fulfill({ json: c });
    }
    if (path.endsWith("/capture-ezyvet-attachment")) {
      state.calls.push({ path, ...body });
      const c = state.captures.find((c) => c.id === body.request_id)!;
      if (body.action === "retrieve")
        return route.fulfill({
          contentType: mime,
          body: state.tamper ? Buffer.alloc(bytes.length, 65) : bytes,
        });
      if (body.action === "discard") {
        Object.assign(c, { status: "abandoned", retryable: false });
        if (state.loseDiscard) return route.abort();
        return route.fulfill({ json: {} });
      }
      Object.assign(
        c,
        state.holdReserved
          ? { status: "reserved" }
          : { status: "ready", retryable: false, capture: receipt(c.id) },
      );
      if (state.loseCapture) return route.abort();
      return route.fulfill({ json: {} });
    }
    return route.fallback();
  });
  return { state, capture, receipt, metadata };
}
async function openCapture(page: Page) {
  const metadata = await select(page);
  await metadata
    .getByRole("button", { name: "Start attachment metadata scan" })
    .click();
  await expect(metadata.getByText(/Saved state: review_ready/)).toBeVisible();
  const panel = metadata.getByRole("region", {
    name: "Original attachment capture",
    exact: true,
  });
  await expect(
    panel.getByLabel("Current attachment to capture").locator("option"),
  ).toHaveCount(2);
  await panel
    .getByLabel("Current attachment to capture")
    .selectOption({ index: 1 });
  return panel;
}
test("explicit capture prepares pinned observation then recovers private receipt", async ({
  page,
}) => {
  const { state } = await fixture(page);
  const panel = await openCapture(page);
  await panel
    .getByRole("button", { name: "Capture selected original", exact: true })
    .click();
  await expect(
    panel.getByRole("heading", {
      name: "Original captured privately",
      exact: true,
    }),
  ).toBeVisible();
  const prepare = state.calls.find((c) =>
    String(c.path).endsWith("prepare_ezyvet_attachment_capture"),
  );
  expect(prepare).toMatchObject({
    p_animal_link_id: link,
    p_page: 1,
    p_ordinal: 1,
    p_snapshot_id: snapshot,
    p_observed_head_version: 1,
    p_stable_metadata_sha256: "b".repeat(64),
  });
  expect(prepare).not.toHaveProperty("file_id");
  await expect(
    panel.getByRole("button", { name: /approve|release/i }),
  ).toHaveCount(0);
});
test("lost prepare response recovers same intent before worker call", async ({
  page,
}) => {
  const { state } = await fixture(page);
  state.losePrepare = true;
  const panel = await openCapture(page);
  await panel
    .getByRole("button", { name: "Capture selected original", exact: true })
    .click();
  await expect(panel.getByRole("alert")).toBeVisible();
  await panel
    .getByRole("button", { name: "Retry original capture", exact: true })
    .click();
  await expect(
    panel.getByRole("heading", {
      name: "Original captured privately",
      exact: true,
    }),
  ).toBeVisible();
  expect(
    state.calls.filter((c) =>
      String(c.path).endsWith("prepare_ezyvet_attachment_capture"),
    ),
  ).toHaveLength(1);
});
test("lost final response recovers ready without repeating capture", async ({
  page,
}) => {
  const { state } = await fixture(page);
  state.loseCapture = true;
  const panel = await openCapture(page);
  await panel
    .getByRole("button", { name: "Capture selected original", exact: true })
    .click();
  await expect(
    panel.getByRole("heading", {
      name: "Original captured privately",
      exact: true,
    }),
  ).toBeVisible();
  expect(state.calls.filter((c) => c.action === "capture")).toHaveLength(1);
});
test("reserved request retries exact ID and unfinished discard recovers lost response", async ({
  page,
}) => {
  const { state } = await fixture(page);
  state.holdReserved = true;
  const panel = await openCapture(page);
  await panel
    .getByRole("button", { name: "Capture selected original", exact: true })
    .click();
  await expect(
    panel.getByRole("heading", { name: "Verifying saved file" }),
  ).toBeVisible();
  await panel
    .getByRole("button", { name: "Retry original capture", exact: true })
    .click();
  expect(
    new Set(
      state.calls
        .filter((c) => c.action === "capture")
        .map((c) => c.request_id),
    ).size,
  ).toBe(1);
  state.loseDiscard = true;
  await panel.getByRole("checkbox").check();
  await panel
    .getByRole("button", { name: "Discard unfinished capture", exact: true })
    .click();
  await expect(
    panel.getByRole("heading", { name: "Unfinished capture discarded" }),
  ).toBeVisible();
});
test("verified download rehashes bytes and rejects same-size tampering", async ({
  page,
}) => {
  const { state } = await fixture(page);
  const panel = await openCapture(page);
  await panel
    .getByRole("button", { name: "Capture selected original", exact: true })
    .click();
  await expect(
    panel.getByRole("button", { name: "Download verified original" }),
  ).toBeVisible();
  const download = page.waitForEvent("download");
  await panel
    .getByRole("button", { name: "Download verified original" })
    .click();
  expect((await download).suggestedFilename()).toBe("ezyvet-attachment-7.pdf");
  state.tamper = true;
  await panel
    .getByRole("button", { name: "Download verified original" })
    .click();
  await expect(panel.getByRole("alert")).toBeVisible();
});
test("pointerless history discovers stale ready capture and paginates", async ({
  page,
}) => {
  const { state, capture, receipt } = await fixture(page);
  state.captures = [
    {
      ...capture(savedId),
      status: "ready",
      retryable: false,
      source_current: false,
      capture: receipt(savedId),
    },
  ];
  state.more = true;
  const metadata = await select(page);
  const panel = metadata.getByRole("region", {
    name: "Original attachment capture",
    exact: true,
  });
  await panel
    .getByRole("button", { name: "Recover original 66666666" })
    .click();
  await expect(
    panel.getByText(/Source or patient mapping has changed/),
  ).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "Download verified original" }),
  ).toBeEnabled();
  await panel.getByRole("button", { name: "Older original captures" }).click();
  expect(state.calls.some((c) => c.p_before_id === savedId)).toBe(true);
});
test("wrong actor recovery remains uncertain and locks mapping", async ({
  page,
}) => {
  const { state, capture } = await fixture(page);
  state.captures = [capture(savedId)];
  state.wrong = true;
  const metadata = await select(page);
  const panel = metadata.getByRole("region", {
    name: "Original attachment capture",
    exact: true,
  });
  await panel
    .getByRole("button", { name: "Recover original 66666666" })
    .click();
  await expect(panel.getByRole("alert")).toBeVisible();
  await expect(metadata.getByLabel("Find attachment patient")).toBeDisabled();
});
test("uncertain capture participates in navigation warning", async ({
  page,
}) => {
  const { state } = await fixture(page);
  state.losePrepare = true;
  const panel = await openCapture(page);
  await panel
    .getByRole("button", { name: "Capture selected original", exact: true })
    .click();
  await expect(panel.getByRole("alert")).toBeVisible();
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
});

test("JPEG retrieval preserves binary bytes before verified download", async ({
  page,
}) => {
  await fixture(page, "image/jpeg");
  const panel = await openCapture(page);
  await panel
    .getByRole("button", { name: "Capture selected original", exact: true })
    .click();
  await expect(
    panel.getByRole("button", { name: "Download verified original" }),
  ).toBeVisible();
  const download = page.waitForEvent("download");
  await panel
    .getByRole("button", { name: "Download verified original" })
    .click();
  expect((await download).suggestedFilename()).toBe("ezyvet-attachment-7.jpg");
});
test("late original download after signout cannot create a download", async ({
  page,
}) => {
  await fixture(page);
  const panel = await openCapture(page);
  await panel
    .getByRole("button", { name: "Capture selected original", exact: true })
    .click();
  await expect(
    panel.getByRole("button", { name: "Download verified original" }),
  ).toBeVisible();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started!: () => void;
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  await page.route(
    "**/functions/v1/capture-ezyvet-attachment",
    async (route) => {
      if (route.request().postDataJSON().action === "retrieve") {
        started();
        await gate;
      }
      await route.fallback();
    },
  );
  let downloads = 0;
  page.on("download", () => {
    downloads++;
  });
  await panel
    .getByRole("button", { name: "Download verified original" })
    .click();
  await entered;
  await page.getByRole("button", { name: "Sign Out", exact: true }).click();
  await expect(panel).toHaveCount(0);
  const response = page.waitForResponse((r) =>
    r.url().endsWith("/capture-ezyvet-attachment"),
  );
  release();
  await (await response).finished();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  );
  await expect(page).toHaveURL(/login/);
  expect(downloads).toBe(0);
});

test("historical capture mapping survives household move without enabling new metadata scans", async ({
  page,
}) => {
  const { state, capture, receipt } = await fixture(page);
  state.historicalOnly = true;
  state.captures = [
    {
      ...capture(savedId),
      status: "ready",
      retryable: false,
      source_current: false,
      capture: receipt(savedId),
    },
  ];
  await page.goto("/hub/tools/ezyvet");
  const metadata = page.getByRole("region", {
    name: "Attachment metadata import",
    exact: true,
  });
  await metadata.getByLabel("Find attachment patient").fill("Juniper");
  await expect(
    metadata.getByText("No approved patient mappings found."),
  ).toBeVisible();
  await metadata
    .getByRole("button", {
      name: "Earlier captures: Synthetic Juniper · Original household · synthetic-site",
      exact: true,
    })
    .click();
  const panel = metadata.getByRole("region", {
    name: "Original attachment capture",
    exact: true,
  });
  await panel
    .getByRole("button", { name: "Recover original 66666666" })
    .click();
  await expect(
    panel.getByRole("button", { name: "Download verified original" }),
  ).toBeEnabled();
  await expect(
    metadata.getByRole("button", { name: "Start attachment metadata scan" }),
  ).toHaveCount(0);
});
test("stale unsaved preparation can be tombstoned before local request is cleared", async ({
  page,
}) => {
  const { state } = await fixture(page);
  state.rejectPrepare = true;
  state.loseAbandon = true;
  const panel = await openCapture(page);
  await panel
    .getByRole("button", { name: "Capture selected original", exact: true })
    .click();
  await expect(panel.getByRole("alert")).toBeVisible();
  await panel.getByRole("checkbox").check();
  await panel
    .getByRole("button", {
      name: "Discard unsaved capture request",
      exact: true,
    })
    .click();
  await panel
    .getByRole("button", { name: "Recheck original capture", exact: true })
    .click();
  await expect(
    panel.getByRole("heading", { name: "Unfinished capture discarded" }),
  ).toBeVisible();
  await panel
    .getByRole("button", { name: "Choose another original", exact: true })
    .click();
  await expect(panel.getByText(/Capture request:/)).toHaveCount(0);
  expect(state.calls.filter((c) => c.action === "capture")).toHaveLength(0);
  expect(state.captures[0].status).toBe("abandoned");
});
test("concurrent preparation during abandonment requires actual unfinished discard", async ({
  page,
}) => {
  const { state } = await fixture(page);
  state.rejectPrepare = true;
  state.racePrepare = true;
  const panel = await openCapture(page);
  await panel
    .getByRole("button", { name: "Capture selected original", exact: true })
    .click();
  await expect(panel.getByRole("alert")).toBeVisible();
  await panel.getByRole("checkbox").check();
  await panel
    .getByRole("button", {
      name: "Discard unsaved capture request",
      exact: true,
    })
    .click();
  await expect(
    panel.getByRole("heading", { name: "Queued", exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "Choose another original", exact: true }),
  ).toBeDisabled();
  await panel.getByRole("checkbox").check();
  await panel
    .getByRole("button", { name: "Discard unfinished capture", exact: true })
    .click();
  await expect(
    panel.getByRole("heading", { name: "Unfinished capture discarded" }),
  ).toBeVisible();
  expect(state.calls.filter((c) => c.action === "discard")).toHaveLength(1);
});
