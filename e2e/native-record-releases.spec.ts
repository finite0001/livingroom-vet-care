import { replayNativeReturnQuantities } from "../supabase/functions/_shared/native-return-quantity-replay";
import { test, expect, type Page } from "@playwright/test";
import { apiAttachmentArtifact } from "../tests/record-releases/api-attachment-fixture";
import {
  signed,
  dispense,
  usedUsage,
  actor,
  pet,
  client,
  time,
  hash,
  id,
} from "../tests/prescriptions/fulfillment-fixture";
import { sourceLabels } from "../src/hub/features/record-releases/selection";
// Synthetic RPC fixture handles heterogeneous versioned release envelopes.
interface Row {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}
async function fixture(page: Page) {
  const prescription = {
    id: signed().id,
    authorization_hash: hash,
    artifact: signed().artifact,
    status: {
      state: "active",
      head_id: null,
      head_version: 0,
      event_at: null,
      reason: null,
      replacement_id: null,
    },
    usage: usedUsage(),
    returns: {"version":2,"discrepancy_event_count":0,"open_case_count":0,"event_count":0,"affected_dispense_count":0,"heads_hash":"4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"},
    corrections: {"version":1,"event_count":0,"affected_dispense_count":0,"heads_hash":"4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"},
  };
  const { invoice_id: _invoice, ...publicDispense } = dispense().artifact;
  const recordedDispense = {
    id: dispense().id,
    artifact_hash: hash,
    artifact: publicDispense,
    prescription,
    pickup: null,
    returns: {version:2,replay:replayNativeReturnQuantities(publicDispense.lots.map((l,i)=>({allocation_id:id(800+i),lot_id:l.id,quantity:l.quantity})),[]),discrepancies:{version:1,head:{version:0,event_id:null,record_hash:null},open_case_count:0,held_lot_ids:[],cases:[]},head:{event_id:null,version:0,record_hash:null},events:[],allocations:publicDispense.lots.map((l,i)=>({allocation_id:id(800+i),lot_id:l.id,lot_number:l.number,expires_on:l.expires_on,dispensed_quantity:l.quantity,returned_quantity:"0.000",remaining_returnable_quantity:l.quantity,held_quantity:"0.000",disposed_quantity:"0.000",restocked_quantity:"0.000"}))},
    corrections: {"version":1,"head":{"event_id":null,"version":0,"record_hash":null},"events":[],"latest_pickup_amendment":null},
  };
  const state = {
    accepted: true,
    lost: false,
    stale: false,
    wrongResponse: false,
    malformed: false,
    oversized: false,
    count: 1,
    includeSoap: false,
    requests: [] as Row[],
    previews: [] as Row[],
    rows: [] as Row[],
    prescription,
    recordedDispense,
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
  const emptySelection = () =>
    Object.fromEntries(Object.keys(sourceLabels).map((k) => [k, []]));
  const sources = () => ({
    pet_id: pet,
    client_id: client,
    client_name: "Synthetic Household",
    email: "owner@example.test",
    phone: "+13035550100",
    policy_accepted: true,
    policy_v4_accepted: true,
    policy_v8_accepted: true,
    policy_v9_accepted: true,
    policy_v10_accepted: true,
    policy_v13_accepted: state.accepted,
    ...emptySelection(),
    has_more: Object.fromEntries(
      Object.keys(sourceLabels).map((k) => [k, false]),
    ),
    encounter_ids: state.includeSoap
      ? [
          {
            id: id(80),
            version: 2,
            recorded_at: time,
            label: "Signed synthetic SOAP",
          },
        ]
      : [],
    native_prescription_ids: Array.from(
      { length: state.count },
      (_, index) => ({
        id: index === 0 ? prescription.id : id(index + 100),
        version: 1,
        recorded_at: time,
        label: `Native prescription ${index + 1}`,
        source_label: state.malformed
          ? "Outside pharmacy"
          : "Living Room Vet · Signed prescription",
      }),
    ),
    native_dispense_ids: [
      {
        id: recordedDispense.id,
        version: 1,
        recorded_at: time,
        label: "Native dispense 1",
        source_label: "Living Room Vet · Recorded dispense",
      },
    ],
  });
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin === "http://127.0.0.1:8080"
      ? route.continue()
      : route.abort(),
  );
  await page.route("http://127.0.0.1:54321/**", async (route) => {
    const path = new URL(route.request().url()).pathname,
      name = path.split("/").at(-1),
      input =
        route.request().method() === "POST"
          ? route.request().postDataJSON()
          : {};
    if (path === "/auth/v1/token") return route.fulfill({ json: session });
    if (path === "/auth/v1/user") return route.fulfill({ json: user });
    if (path === "/rest/v1/profiles")
      return route.fulfill({
        json: [
          {
            id: actor,
            full_name: "Synthetic Staff",
            first_name: "Synthetic",
            last_name: "Staff",
            is_active: true,
          },
        ],
      });
    if (path === "/rest/v1/user_roles")
      return route.fulfill({ json: [{ role: "STAFF" }] });
    if (path === "/rest/v1/pets")
      return route.fulfill({
        json: {
          id: pet,
          client_id: client,
          name: "Patient",
          species: "Canine",
          version: 1,
          archived_at: null,
          deceased_at: null,
          birth_date_precision: "unknown",
          sex: "unknown",
          neuter_status: "unknown",
        },
      });
    if (path === "/rest/v1/clients")
      return route.fulfill({
        json: {
          id: client,
          full_name: "Synthetic Household",
          primary_email: "owner@example.test",
          primary_phone: "+13035550100",
        },
      });
    if (path === "/rest/v1/record_releases")
      return route.fulfill({ json: state.rows.map((r) => r.release) });
    if (name === "list_record_release_sources_v13")
      return route.fulfill({ json: sources() });
    if (name === "select_all_record_release_sources_v13") {
      if (state.oversized || state.count > 20)
        return route.fulfill({
          status: 400,
          json: {
            code: "23514",
            message:
              "Native family limit or complete 1 MiB snapshot bound exceeded; split the package. No partial selection returned.",
          },
        });
      return route.fulfill({
        json: {
          selection: {
            ...emptySelection(),
            native_prescription_ids: [prescription.id],
            native_dispense_ids: [recordedDispense.id],
          },
          excluded_unavailable_originals: 0,
          excluded_labs_without_shareable_original: 0,
          scope: "All eligible across pages",
        },
      });
    }
    if (name === "preview_record_release_v13") {
      state.previews.push(input);
      const snapshot: Row = structuredClone(
        apiAttachmentArtifact().preview.snapshot,
      );
      for (const [key, value] of Object.entries(snapshot))
        if (Array.isArray(value)) snapshot[key] = [];
      snapshot.schema_version = 13;
      snapshot.patient.id = pet;
      snapshot.recipient = {
        ...snapshot.recipient,
        client_id: client,
        channel: input.p_channel,
        address: input.p_recipient,
      };
      snapshot.selection = { ...emptySelection(), ...input.p_selection };
      snapshot.native_prescriptions = (
        input.p_selection.native_prescription_ids ?? []
      ).map((selectedId: string, index: number) => {
        const selected = structuredClone(prescription);
        selected.id = selectedId;
        selected.artifact.authorization_id = selectedId;
        if (selectedId !== prescription.id) {
          selected.usage.open_slot.id = id(200 + index);
          selected.usage.fulfillment_head.event_id = id(300 + index);
        }
        return selected;
      });
      if (input.p_selection.encounter_ids?.includes(id(80))) {
        const encounter = structuredClone(
          apiAttachmentArtifact().preview.snapshot.encounters[0],
        );
        encounter.id = id(80);
        snapshot.encounters = [encounter];
      }
      snapshot.native_dispenses =
        input.p_selection.native_dispense_ids?.includes(recordedDispense.id)
          ? [structuredClone(recordedDispense)]
          : [];
      if (state.wrongResponse) snapshot.patient.id = id(999);
      return route.fulfill({ json: { snapshot, source_hash: hash } });
    }
    if (name === "confirm_record_release") {
      state.requests.push(input);
      if (state.stale)
        return route.fulfill({
          status: 409,
          json: {
            code: "40001",
            message: "Native sources changed; review again",
          },
        });
      let row = state.rows.find((row) => row.release.id === input.p_id);
      if (!row) {
        row = {
          release: {
            id: input.p_id,
            pet_id: pet,
            client_id: client,
            channel: input.p_channel,
            recipient: input.p_recipient,
            selection: input.p_selection,
            snapshot: input.p_reviewed_snapshot,
            source_hash: input.p_reviewed_hash,
            created_by: actor,
            created_at: time,
          },
          events: [],
          eligible: true,
          ineligibility_reason: null,
        };
        state.rows.push(row);
      }
      if (state.lost) {
        state.lost = false;
        return route.abort();
      }
      return route.fulfill({ json: row.release });
    }
    if (name === "read_record_release")
      return route.fulfill({
        json: state.rows.find((row) => row.release.id === input.p_id),
      });
    return route.fulfill({ json: [] });
  });
  await page.goto(`/hub/patient/${pet}`);
  await expect(
    page.getByRole("checkbox", { name: /Native prescription 1 ·/ }),
  ).toBeVisible({ timeout: 30000 });
  return state;
}
const panel = (page: Page) =>
  page.getByRole("region", {
    name: "Patient medical-record releases",
    exact: true,
  });
async function review(page: Page) {
  await panel(page)
    .getByRole("button", { name: "Review selected package", exact: true })
    .click();
  await expect(
    panel(page).getByRole("checkbox", {
      name: /I reviewed the complete selected records/,
    }),
  ).toBeVisible();
}
async function confirm(page: Page) {
  await panel(page)
    .getByRole("checkbox", { name: /I reviewed the complete selected records/ })
    .check();
  await panel(page)
    .getByRole("button", { name: "Confirm reviewed package", exact: true })
    .click();
}
test("dispense-only package embeds signed context without silently selecting order or financial fields", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.getByRole("checkbox", { name: /Native dispense 1 ·/ }).check();
  await review(page);
  const html = page
    .frameLocator('iframe[title="Medical-record release artifact"]')
    .locator("body");
  await expect(html).toContainText("Authored medication");
  await expect(html).toContainText("LOT-1");
  await expect(html).not.toContainText(id(2));
  await confirm(page);
  await expect(
    panel(page).getByRole("button", {
      name: "Confirm reviewed package",
      exact: true,
    }),
  ).toHaveCount(0);
  expect(state.requests).toHaveLength(1);
  expect(state.requests[0].p_selection.native_prescription_ids ?? []).toEqual(
    [],
  );
  expect(
    state.requests[0].p_reviewed_snapshot.native_dispenses[0].prescription.id,
  ).toBe(signed().id);
  expect(
    state.requests[0].p_reviewed_snapshot.native_dispenses[0].artifact,
  ).not.toHaveProperty("invoice_id");
});
test("explicit native parent and dispense selection retains exact lost-confirmation request after later rejection", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.getByRole("checkbox", { name: /Native prescription 1 ·/ }).check();
  await page.getByRole("checkbox", { name: /Native dispense 1 ·/ }).check();
  await review(page);
  state.lost = true;
  await confirm(page);
  const retry = panel(page).getByRole("button", {
    name: "Retry same package confirmation",
    exact: true,
  });
  await expect(retry).toBeVisible();
  state.stale = true;
  await retry.click();
  await expect(retry).toBeVisible();
  state.stale = false;
  await retry.click();
  await expect(retry).toHaveCount(0);
  expect(state.requests).toHaveLength(3);
  expect(state.requests[1]).toEqual(state.requests[0]);
  expect(state.requests[2]).toEqual(state.requests[0]);
  expect(state.rows).toHaveLength(1);
});
test("policy12 does not authorize schema13 confirmation and selected cancelled order is historical", async ({
  page,
}) => {
  const state = await fixture(page);
  state.accepted = false;
  Object.assign(state.prescription.status, {
    state: "cancelled",
    head_id: id(70),
    head_version: 1,
    event_at: time,
    reason: "Synthetic historical cancellation",
    replacement_id: null,
  });
  await panel(page)
    .getByRole("button", { name: /Refresh/ })
    .first()
    .click();
  await page.getByRole("checkbox", { name: /Native prescription 1 ·/ }).check();
  await review(page);
  await expect(
    page
      .frameLocator('iframe[title="Medical-record release artifact"]')
      .locator("body"),
  ).toContainText("Synthetic historical cancellation");
  await panel(page)
    .getByRole("checkbox", { name: /I reviewed the complete selected records/ })
    .check();
  await expect(
    panel(page).getByRole("button", {
      name: "Confirm reviewed package",
      exact: true,
    }),
  ).toBeDisabled();
  expect(state.requests).toHaveLength(0);
});
test("native twenty-first selection and oversized all-source response preserve prior choices", async ({
  page,
}) => {
  const state = await fixture(page);
  state.count = 21;
  await panel(page)
    .getByRole("button", { name: /Refresh/ })
    .first()
    .click();
  for (let n = 1; n <= 20; n++)
    await page
      .getByRole("checkbox", { name: new RegExp(`Native prescription ${n} ·`) })
      .check();
  await page
    .getByRole("checkbox", { name: /Native prescription 21 ·/ })
    .click();
  await expect(
    page.getByRole("checkbox", { name: /Native prescription 21 ·/ }),
  ).not.toBeChecked();
  await expect(panel(page)).toContainText("20");
  await panel(page)
    .getByRole("button", {
      name: "Select all eligible records across every page",
    })
    .click();
  await expect(panel(page)).toContainText("No partial selection returned");
  await expect(
    page.getByRole("checkbox", { name: /Native prescription 1 ·/ }),
  ).toBeChecked();
  await review(page);
  await confirm(page);
  expect(
    state.requests[0].p_reviewed_snapshot.native_prescriptions,
  ).toHaveLength(20);
});
test("foreign patient preview fails locally without crashing or clearing explicit selection", async ({
  page,
}) => {
  const state = await fixture(page);
  state.wrongResponse = true;
  await page.getByRole("checkbox", { name: /Native dispense 1 ·/ }).check();
  await panel(page)
    .getByRole("button", { name: "Review selected package", exact: true })
    .click();
  await expect(panel(page)).toContainText("does not match this patient");
  await expect(
    page.getByRole("checkbox", { name: /Native dispense 1 ·/ }),
  ).toBeChecked();
  await expect(
    panel(page).getByRole("button", {
      name: "Confirm reviewed package",
      exact: true,
    }),
  ).toHaveCount(0);
});
test("native prescriptions can be explicitly packaged with inherited signed SOAP evidence", async ({
  page,
}) => {
  const state = await fixture(page);
  state.includeSoap = true;
  await panel(page)
    .getByRole("button", { name: /Refresh/ })
    .first()
    .click();
  await page.getByRole("checkbox", { name: /Native prescription 1 ·/ }).check();
  await page.getByRole("checkbox", { name: /Signed synthetic SOAP ·/ }).check();
  await review(page);
  const body = page
    .frameLocator('iframe[title="Medical-record release artifact"]')
    .locator("body");
  await expect(body).toContainText("Owner reports improvement");
  await expect(body).toContainText("Authored medication");
  await confirm(page);
  await expect(
    panel(page).getByRole("button", {
      name: "Confirm reviewed package",
      exact: true,
    }),
  ).toHaveCount(0);
  expect(state.requests[0].p_reviewed_snapshot.encounters).toHaveLength(1);
  expect(
    state.requests[0].p_reviewed_snapshot.native_prescriptions,
  ).toHaveLength(1);
});
test("malformed native candidate provenance is a local error and cannot produce a preview", async ({
  page,
}) => {
  const state = await fixture(page);
  state.malformed = true;
  await panel(page)
    .getByRole("button", { name: /Refresh/ })
    .first()
    .click();
  await expect(
    panel(page)
      .getByText(
        /could not be loaded|could not be confirmed|incomplete|Retry loading/i,
      )
      .first(),
  ).toBeVisible();
  expect(state.previews).toHaveLength(0);
});
