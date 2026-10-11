import { test, expect, type Page } from "@playwright/test";
import { releaseArtifact } from "../tests/record-releases/fixture.ts";
const backend = "http://127.0.0.1:54321",
  actor = "aabb0000-0000-4000-8000-000000000001",
  pet = "aabb0000-0000-4000-8000-000000000002",
  client = "aabb0000-0000-4000-8000-000000000003",
  id = "aabb0000-0000-4000-8000-000000000004",
  at = "2026-10-10T18:00:00Z";
const request = {
  id,
  pet_id: pet,
  client_id: client,
  direction: "incoming",
  subset: "full",
  channel: null,
  recipient: null,
  recipient_kind: "client",
  recipient_name: null,
  requester_name: "Synthetic clinic",
  request_note: "",
  requested_on: "2026-10-10",
  due_on: null,
  assigned_to: actor,
  ticket_id: null,
  conversation_id: null,
  status: "requested",
  active_manifest_id: null,
  version: 1,
  created_by: actor,
  updated_by: actor,
  created_at: at,
  updated_at: at,
};
interface Saved {
  body: Record<string, unknown>;
  receipt: unknown;
}
async function fixture(
  page: Page,
  baseURL: string | undefined,
  existing = false,
) {
  const user = {
    id: actor,
    aud: "authenticated",
    role: "authenticated",
    email: "synthetic-records@example.test",
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {},
    created_at: at,
  };
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const token = `${Buffer.from('{"alg":"none"}').toString("base64url")}.${Buffer.from(JSON.stringify({ sub: actor, role: "authenticated", exp: expires })).toString("base64url")}.synthetic`;
  const session = {
    access_token: token,
    refresh_token: "synthetic-refresh",
    expires_in: 3600,
    expires_at: expires,
    token_type: "bearer",
    user,
  };
  await page.addInitScript(
    (s) => localStorage.setItem("sb-127-auth-token", JSON.stringify(s)),
    session,
  );
  const state = {
    manifestMode: false,
    policy: false,
    authorization: null as Record<string, unknown> | null,
    rejectConfirm: false,
    malformedPackage: false,
    requests: existing ? [structuredClone(request)] : [],
    saved: new Map<string, Saved>(),
    submitted: [] as Record<string, unknown>[],
    loseAck: false,
    mutations: 0,
  };
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin ===
    new URL(baseURL ?? "http://127.0.0.1:8080").origin
      ? route.continue()
      : route.abort(),
  );
  await page.route(`${backend}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname,
      name = path.replace("/rest/v1/rpc/", "");
    const body =
      route.request().method() === "POST"
        ? (route.request().postDataJSON() ?? {})
        : {};
    const ok = (json: unknown) => route.fulfill({ json });
    if (path === "/auth/v1/token") return ok(session);
    if (path === "/auth/v1/user") return ok(user);
    if (path === "/rest/v1/profiles")
      return ok([
        {
          id: actor,
          full_name: "Synthetic staff",
          role: "STAFF",
          is_active: true,
        },
      ]);
    if (path === "/rest/v1/user_roles") return ok([{ role: "STAFF" }]);
    if (name === "record_request_choices")
      return ok({
        patients: [
          {
            id: pet,
            name: "Synthetic Juniper",
            client_id: client,
            client_name: "Synthetic household",
          },
        ],
        staff: [{ id: actor, name: "Synthetic staff" }],
      });
    if (name === "list_record_requests")
      return ok({
        items: state.requests.map((r) => ({
          ...r,
          pet_name: "Synthetic Juniper",
          client_name: "Synthetic household",
          assignee_name: "Synthetic staff",
        })),
        next: null,
      });
    if (name === "read_record_request")
      return ok({
        request: state.requests.find((r) => r.id === body.p_id) ?? request,
        pet_name: "Synthetic Juniper",
        client_name: "Synthetic household",
        manifest: state.manifestMode
          ? {
              id: "aabb0000-0000-4000-8000-000000000007",
              request_id: id,
              fingerprint: "b".repeat(64),
              package_count: 1,
              source_count: 1,
              captured_at: at,
              subset: "custom",
              channel: "EMAIL",
              recipient: "synthetic-clinic@example.test",
            }
          : null,
        disclosure_policy_accepted: state.policy,
        authorization: state.authorization,
      });
    if (name === "list_record_request_documents") return ok([]);
    if (name === "list_record_request_evidence")
      return ok({ items: [], next: null });
    if (name === "list_record_request_packages")
      return ok({
        items: [
          {
            id: "aabb0000-0000-4000-8000-000000000008",
            ordinal: 1,
            release_id: "aabb0000-0000-4000-8000-000000000009",
            selection: { encounter_ids: [pet] },
            scope_expansion: false,
            source_hash: "a".repeat(64),
            confirmed: false,
            deliveries: [],
          },
        ],
        next: null,
      });
    if (name === "read_record_request_package") {
      const preview = structuredClone(releaseArtifact.preview);
      preview.snapshot.patient.id = pet;
      preview.snapshot.patient.name = "Synthetic Juniper";
      preview.snapshot.recipient.client_id = client;
      preview.snapshot.recipient.name = "Synthetic clinic";
      preview.snapshot.recipient.address = "synthetic-clinic@example.test";
      preview.snapshot.attachments = [];
      if (!state.malformedPackage) preview.snapshot.lab_results = [];
      preview.snapshot.certificates = [];
      preview.snapshot.encounters[0].id = pet;
      return ok({
        id: body.p_package_id,
        release_id: "aabb0000-0000-4000-8000-000000000009",
        scope_expansion: false,
        confirmed: false,
        preview,
        package_context: {
          manifest_id: "aabb0000-0000-4000-8000-000000000007",
          manifest_hash: "b".repeat(64),
          ordinal: 1,
          package_count: 1,
          captured_at: at,
          recipient_kind: "third_party",
          recipient_name: "Synthetic clinic",
          authorization: null,
        },
      });
    }
    if (name === "authorize_record_request_recipient") {
      state.requests[0].version++;
      state.authorization = {
        id: body.p_values.authorization_id,
        client_authority: body.p_values.client_authority,
        destination_verification: body.p_values.destination_verification,
        expires_at: "2026-10-21T06:00:00Z",
        revoked: false,
        current: state.policy,
      };
      return ok({ request: state.requests[0] });
    }
    if (name === "confirm_record_request_package" && state.rejectConfirm)
      return route.fulfill({
        status: 409,
        json: { code: "PT409", message: "Synthetic source changed" },
      });
    if (name === "read_record_request_action")
      return ok(state.saved.get(body.p_action_id)?.receipt ?? null);
    if (name === "save_record_request") {
      state.submitted.push(structuredClone(body));
      const old = state.saved.get(body.p_action_id);
      if (old) {
        expect(body).toEqual(old.body);
        return ok(old.receipt);
      }
      state.mutations++;
      const values = {
        ...request,
        ...body.p_values,
        id: body.p_id,
        version: 1,
        recipient:
          body.p_values.recipient_kind === "third_party"
            ? body.p_values.recipient_email
            : body.p_values.direction === "outgoing"
              ? "synthetic-client@example.test"
              : null,
      };
      delete values.recipient_email;
      state.requests = [values];
      const receipt = { request: values };
      state.saved.set(body.p_action_id, {
        body: structuredClone(body),
        receipt,
      });
      if (state.loseAck) {
        state.loseAck = false;
        return route.abort("failed");
      }
      return ok(receipt);
    }
    return ok([]);
  });
  return state;
}
async function newRequest(page: Page) {
  await page.goto("/hub/tools/record-requests");
  await page.getByRole("button", { name: "New records request" }).click();
  await page.getByLabel("Patient and household").selectOption(pet);
  await page
    .getByLabel("Requesting person or clinic")
    .fill("Synthetic referring clinic");
}
test("Incoming request persists explicit patient household, assignment and calendar dates", async ({
  page,
  baseURL,
}) => {
  const state = await fixture(page, baseURL);
  await newRequest(page);
  await page.getByLabel("Assigned staff").selectOption(actor);
  await page.getByLabel("Requested date").fill("2026-10-10");
  await page.getByLabel("Due date").fill("2026-10-20");
  await page.getByRole("button", { name: "Save request", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "Synthetic Juniper · Synthetic household" }),
  ).toBeVisible();
  expect(state.mutations).toBe(1);
  expect(state.submitted[0].p_values).toMatchObject({
    pet_id: pet,
    client_id: client,
    assigned_to: actor,
    due_on: "2026-10-20",
    direction: "incoming",
    channel: null,
  });
});
test("Third-party request keeps named email and does not offer SMS", async ({
  page,
  baseURL,
}) => {
  const state = await fixture(page, baseURL);
  await newRequest(page);
  await page.getByLabel("Direction", { exact: true }).selectOption("outgoing");
  await page
    .getByLabel("Recipient", { exact: true })
    .selectOption("third_party");
  await expect(page.getByLabel("Delivery channel")).toBeDisabled();
  await expect(page.getByLabel("Delivery channel")).toHaveValue("EMAIL");
  await page.getByLabel("Named recipient").fill("Synthetic authorized clinic");
  await page
    .getByLabel("Recipient email", { exact: true })
    .fill("synthetic-clinic@example.test");
  await page.getByRole("button", { name: "Save request", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "Synthetic Juniper · Synthetic household" }),
  ).toBeVisible();
  expect(state.submitted[0].p_values).toMatchObject({
    recipient_kind: "third_party",
    recipient_name: "Synthetic authorized clinic",
    recipient_email: "synthetic-clinic@example.test",
    channel: "EMAIL",
  });
});
test("Lost save acknowledgement freezes draft and retries the exact original action once", async ({
  page,
  baseURL,
}) => {
  const state = await fixture(page, baseURL);
  state.loseAck = true;
  await newRequest(page);
  await page.getByRole("button", { name: "Save request", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Retry unchanged save" }),
  ).toBeVisible();
  await expect(page.getByLabel("Requesting person or clinic")).toBeDisabled();
  await page.getByRole("button", { name: "Retry unchanged save" }).click();
  await expect(
    page.getByRole("link", { name: "Synthetic Juniper · Synthetic household" }),
  ).toBeVisible();
  expect(state.submitted).toHaveLength(2);
  expect(state.submitted[0]).toEqual(state.submitted[1]);
  expect(state.mutations).toBe(1);
});
test("Saved-action lookup recovers an uncertain save without a second mutation", async ({
  page,
  baseURL,
}) => {
  const state = await fixture(page, baseURL);
  state.loseAck = true;
  await newRequest(page);
  await page.getByRole("button", { name: "Save request", exact: true }).click();
  await page.getByRole("button", { name: "Check saved action" }).click();
  await expect(
    page.getByRole("link", { name: "Synthetic Juniper · Synthetic household" }),
  ).toBeVisible();
  expect(state.submitted).toHaveLength(1);
  expect(state.mutations).toBe(1);
});
test("Request review draft remains when navigation is declined", async ({
  page,
  baseURL,
}) => {
  await fixture(page, baseURL, true);
  await page.goto(`/hub/tools/record-requests/${id}`);
  await page
    .getByLabel("Review note / reason")
    .fill("Keep this receipt review");
  await page.getByRole("link", { name: "All requests", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(page.getByLabel("Review note / reason")).toHaveValue(
    "Keep this receipt review",
  );
  await expect(page).toHaveURL(new RegExp(id));
});

function thirdParty(
  state: Awaited<ReturnType<typeof fixture>>,
  current = false,
) {
  state.manifestMode = true;
  state.policy = current;
  Object.assign(state.requests[0], {
    direction: "outgoing",
    subset: "custom",
    channel: "EMAIL",
    recipient: "synthetic-clinic@example.test",
    recipient_kind: "third_party",
    recipient_name: "Synthetic clinic",
    status: "preparing",
    active_manifest_id: "aabb0000-0000-4000-8000-000000000007",
    version: 2,
  });
  if (current)
    state.authorization = {
      id: "aabb0000-0000-4000-8000-000000000010",
      client_authority: "Synthetic exact client authority",
      destination_verification: "Synthetic verified clinic destination",
      expires_at: "2026-10-21T06:00:00Z",
      revoked: false,
      current: true,
    };
}
test("Third-party authorization can be recorded while practice disclosure gate keeps confirmation disabled", async ({
  page,
  baseURL,
}) => {
  const state = await fixture(page, baseURL, true);
  thirdParty(state);
  await page.goto(`/hub/tools/record-requests/${id}`);
  await page
    .getByRole("button", { name: "Review package 1", exact: true })
    .click();
  await page
    .getByLabel(
      "I reviewed this entire numbered package, originals and exact recipient.",
      { exact: true },
    )
    .check();
  await expect(
    page.getByRole("button", { name: "Confirm package 1", exact: true }),
  ).toBeDisabled();
  await page
    .getByLabel(
      "I reviewed this entire numbered package, originals and exact recipient.",
      { exact: true },
    )
    .uncheck();
  await page
    .getByLabel("Who authorized this release, when, and how?")
    .fill("Synthetic client approved this exact package by verified call");
  await page
    .getByLabel("How did you independently verify this destination?")
    .fill("Synthetic independent clinic verification");
  await page
    .getByLabel("Authorization expiry date (Denver)")
    .fill("2026-10-20");
  await page
    .getByText(
      "I verified client authority and this recipient’s email, and reviewed the exact scope of every numbered package below.",
      { exact: true },
    )
    .click();
  await page
    .getByRole("button", { name: "Record exact client authorization" })
    .click();
  await expect(
    page.getByText("Not currently eligible", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Confirm package 1", exact: true }),
  ).toBeDisabled();
  expect(state.authorization?.client_authority).toContain(
    "Synthetic client approved",
  );
});
test("A rejected numbered-package confirmation retains the exact content review", async ({
  page,
  baseURL,
}) => {
  const state = await fixture(page, baseURL, true);
  thirdParty(state, true);
  state.rejectConfirm = true;
  await page.goto(`/hub/tools/record-requests/${id}`);
  await page
    .getByRole("button", { name: "Review package 1", exact: true })
    .click();
  const acknowledgement = page.getByLabel(
    "I reviewed this entire numbered package, originals and exact recipient.",
    { exact: true },
  );
  await acknowledgement.check();
  await page
    .getByRole("button", { name: "Confirm package 1", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("changed");
  await expect(acknowledgement).toBeChecked();
  await expect(
    page.getByRole("button", { name: "Confirm package 1", exact: true }),
  ).toBeEnabled();
});
test("Records request queue and editor fit a phone viewport", async ({
  page,
  baseURL,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fixture(page, baseURL, true);
  await newRequest(page);
  await expect(page.getByLabel("Patient and household")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save request", exact: true }),
  ).toBeVisible();
  const width = await page.evaluate(() => ({
    viewport: innerWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(width.content).toBeLessThanOrEqual(width.viewport + 1);
});

test("Malformed numbered report stays a local error and preserves the request draft", async ({
  page,
  baseURL,
}) => {
  const state = await fixture(page, baseURL, true);
  thirdParty(state, true);
  state.malformedPackage = true;
  await page.goto(`/hub/tools/record-requests/${id}`);
  await page
    .getByLabel("Review note / reason")
    .fill("Retain this scope review");
  await page
    .getByRole("button", { name: "Review package 1", exact: true })
    .click();
  await expect(
    page.getByText("Could not load exact package.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Records requests", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Review note / reason")).toHaveValue(
    "Retain this scope review",
  );
  await expect(
    page.getByRole("button", { name: "Confirm package 1", exact: true }),
  ).toHaveCount(0);
});
