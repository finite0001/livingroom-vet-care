import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { chartArtifact } from "../tests/record-releases/charts-fixture";
import {
  sourceLabels,
  type SourceKind,
} from "../src/hub/features/record-releases/selection";
import type { ReleaseConfirmArgs } from "../src/hub/features/record-releases/api";
import type { ReleaseBundle } from "../src/hub/features/record-releases/print";
const petId = "22222222-2222-4222-8222-222222222222",
  staffId = "11111111-1111-4111-8111-111111111111",
  clientId = "33333333-3333-4333-8333-333333333333";
const groups = {
  encounter_ids: "encounters",
  certificate_ids: "certificates",
  lab_order_ids: "lab_results",
  document_ids: "attachments",
  dental_ids: "dental_charts",
  qol_ids: "qol_records",
  anesthesia_ids: "anesthesia_records",
  lesion_ids: "lesions",
} as const;
async function fixture(page: Page, accepted = true) {
  const user = {
    id: staffId,
    aud: "authenticated",
    role: "authenticated",
    email: "release@example.test",
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {},
    created_at: "2026-01-01T00:00:00Z",
  };
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const token = Buffer.from(
    JSON.stringify({
      sub: staffId,
      exp,
      role: "authenticated",
      aud: "authenticated",
    }),
  ).toString("base64url");
  const session = {
    access_token: `eyJhbGciOiJIUzI1NiJ9.${token}.synthetic`,
    refresh_token: "synthetic",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: exp,
    user,
  };
  await page.addInitScript(
    (value) => localStorage.setItem("sb-127-auth-token", JSON.stringify(value)),
    session,
  );
  const state = {
    rows: [] as ReleaseBundle[],
    requests: [] as ReleaseConfirmArgs[],
    ambiguous: false,
    stale: false,
  };
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin === "http://127.0.0.1:8091"
      ? route.continue()
      : route.abort(),
  );
  await page.route("http://127.0.0.1:54321/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/auth/v1/token") return route.fulfill({ json: session });
    if (path === "/auth/v1/user") return route.fulfill({ json: user });
    if (path === "/rest/v1/profiles")
      return route.fulfill({
        json: [
          {
            ...user,
            full_name: "Test staff",
            first_name: "Test",
            last_name: "Staff",
            role: "STAFF",
            is_active: true,
          },
        ],
      });
    if (path === "/rest/v1/user_roles")
      return route.fulfill({ json: [{ role: "STAFF" }] });
    if (path === "/rest/v1/pets")
      return route.fulfill({
        json: [
          {
            id: petId,
            client_id: clientId,
            name: "Test dog",
            species: "Dog",
            dob: "2020-01-01",
            birth_date_precision: "exact",
            breed: "Mixed",
            color: "Brown",
            sex: "female",
            neuter_status: "neutered",
            version: 1,
          },
        ],
      });
    if (path === "/rest/v1/clients")
      return route.fulfill({
        json: { id: clientId, full_name: "Test family" },
      });
    if (path === "/rest/v1/rpc/list_record_release_sources") {
      const candidates: Record<string, unknown> = {
        pet_id: petId,
        client_id: clientId,
        client_name: "Test family",
        email: "owner@example.test",
        phone: "+13035550100",
        policy_accepted: accepted,
      };
      for (const [key, array] of Object.entries(groups))
        candidates[key] = (chartArtifact.preview.snapshot[array] || []).map(
          (row) => ({
            id: row.id,
            version: 2,
            recorded_at: "2026-09-12T18:00:00Z",
            label: `Source ${row.id}`,
            required_document_id: key === "lab_order_ids" ? "document" : null,
            mime_type: key === "document_ids" ? "application/pdf" : undefined,
            file_size: key === "document_ids" ? 100 : undefined,
          }),
        );
      return route.fulfill({ json: candidates });
    }
    if (path === "/rest/v1/record_releases")
      return route.fulfill({ json: state.rows.map((v) => v.release) });
    if (path === "/rest/v1/rpc/read_record_release")
      return route.fulfill({
        json: state.rows.find(
          (v) => v.release.id === route.request().postDataJSON().p_id,
        ),
      });
    if (path === "/rest/v1/rpc/preview_record_release") {
      const body = route.request().postDataJSON();
      if (
        body.p_selection.lab_order_ids?.length &&
        !body.p_selection.document_ids?.includes("document")
      )
        return route.fulfill({
          status: 400,
          json: {
            code: "23514",
            message:
              "Select the lab original report explicitly as a shareable attachment",
          },
        });
      const preview = structuredClone(chartArtifact.preview);
      for (const [key, array] of Object.entries(groups))
        Object.assign(preview.snapshot, {
          [array]: (preview.snapshot[array] || []).filter((row) =>
            body.p_selection[key]?.includes(row.id),
          ),
        });
      return route.fulfill({ json: preview });
    }
    if (path === "/rest/v1/rpc/confirm_record_release") {
      const args = route.request().postDataJSON() as ReleaseConfirmArgs;
      state.requests.push(args);
      if (state.stale)
        return route.fulfill({
          status: 409,
          json: {
            code: "40001",
            message:
              "Release sources or recipient changed; preview and review again",
          },
        });
      let existing = state.rows.find((b) => b.release.id === args.p_id);
      if (!existing) {
        existing = {
          release: {
            id: args.p_id,
            pet_id: petId,
            client_id: clientId,
            channel: args.p_channel,
            recipient: args.p_recipient,
            selection: args.p_selection,
            snapshot: args.p_reviewed_snapshot,
            source_hash: args.p_reviewed_hash,
            created_by: staffId,
            created_at: "2026-09-12T21:00:00Z",
          },
          events: [],
          eligible: true,
          ineligibility_reason: null,
        };
        state.rows.push(existing);
      }
      if (state.ambiguous) {
        state.ambiguous = false;
        return route.abort("failed");
      }
      return route.fulfill({ json: existing.release });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto(`/hub/patient/${petId}`);
  await expect(
    page.getByRole("heading", {
      name: "Medical-record release packages",
      exact: true,
    }),
  ).toBeVisible();
  return state;
}
test("select clinical families, confirm identical retry, reopen invalidation and export current status", async ({
  page,
}) => {
  const state = await fixture(page);
  state.ambiguous = true;
  const panel = page.getByRole("region", {
    name: "Patient medical-record releases",
  });
  for (const kind of Object.keys(sourceLabels) as SourceKind[]) {
    const button = panel.getByRole("button", {
      name: `Select all shown: ${sourceLabels[kind]}`,
      exact: true,
    });
    if (await button.isEnabled()) await button.click();
  }
  await panel
    .getByRole("button", { name: "Review selected package", exact: true })
    .click();
  const frame = panel.frameLocator("iframe");
  await expect(
    frame.getByRole("heading", { name: "Signed dental chart", exact: true }),
  ).toBeVisible();
  await expect(
    frame.getByRole("heading", {
      name: "Signed qualitative QOL observation",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    frame.getByRole("heading", { name: /Signed anesthesia record/ }),
  ).toBeVisible();
  await expect(
    frame.getByText("Original measurement corrected", { exact: false }),
  ).toBeVisible();
  await expect(
    panel.getByLabel("Household delivery contact", { exact: true }),
  ).toBeDisabled();
  await panel
    .getByLabel(
      "I reviewed the complete selected records, original attachments and household recipient.",
    )
    .check();
  await panel
    .getByRole("button", { name: "Confirm reviewed package", exact: true })
    .click();
  await expect(
    panel.getByRole("button", {
      name: "Retry same package confirmation",
      exact: true,
    }),
  ).toBeVisible();
  await panel
    .getByRole("button", {
      name: "Retry same package confirmation",
      exact: true,
    })
    .click();
  await expect(
    panel.getByRole("heading", { name: /Opened release / }),
  ).toBeVisible();
  expect(state.requests).toHaveLength(2);
  expect(state.requests[0]).toEqual(state.requests[1]);
  expect(state.rows).toHaveLength(1);
  state.rows[0].eligible = false;
  state.rows[0].ineligibility_reason = "Reviewed dental history changed";
  state.rows[0].events.push({
    id: "event",
    release_id: state.rows[0].release.id,
    kind: "source_changed",
    reason: "Dental addendum added",
    created_by: staffId,
    created_at: "2026-09-13T00:00:00Z",
  });
  const downloadPromise = page.waitForEvent("download");
  await panel
    .getByRole("button", { name: "Save review HTML", exact: true })
    .click();
  const download = await downloadPromise;
  const html = await readFile((await download.path())!, "utf8");
  expect(html).toContain("INVALIDATED RELEASE");
  expect(html).toContain("Dental addendum added");
  expect(html).toContain("Signed dental chart");
  expect(html).not.toContain("PRIVATE-STORAGE-PATH");
  await page.reload();
  await expect(
    panel.getByText("Invalidated or withdrawn — historical package", {
      exact: true,
    }),
  ).toBeVisible();
  await panel
    .getByRole("button", { name: "Open release package", exact: true })
    .click();
  await expect(panel.frameLocator("iframe").getByRole("alert")).toContainText(
    "Not eligible for delivery",
  );
});
test("lab selection requires its explicit original and stale confirmation requires review again", async ({
  page,
}) => {
  const state = await fixture(page);
  const panel = page.getByRole("region", {
    name: "Patient medical-record releases",
  });
  await panel
    .getByRole("button", {
      name: `Select all shown: ${sourceLabels.lab_order_ids}`,
      exact: true,
    })
    .click();
  await panel
    .getByRole("button", { name: "Review selected package", exact: true })
    .click();
  await expect(panel.getByRole("alert")).toContainText(
    "Select the lab original report explicitly",
  );
  await expect(
    panel.getByRole("button", {
      name: "Confirm reviewed package",
      exact: true,
    }),
  ).toHaveCount(0);
  await panel
    .getByRole("button", {
      name: `Select all shown: ${sourceLabels.document_ids}`,
      exact: true,
    })
    .click();
  await panel
    .getByRole("button", { name: "Review selected package", exact: true })
    .click();
  await panel
    .getByLabel(
      "I reviewed the complete selected records, original attachments and household recipient.",
    )
    .check();
  state.stale = true;
  await panel
    .getByRole("button", { name: "Confirm reviewed package", exact: true })
    .click();
  await expect(panel.getByRole("alert")).toContainText(
    "preview and review again",
  );
  await expect(
    panel.getByRole("button", { name: "Review selected package", exact: true }),
  ).toBeVisible();
  expect(state.rows).toHaveLength(0);
});
test("clinical form acceptance gate permits preview but prevents confirmation", async ({
  page,
}) => {
  await fixture(page, false);
  const panel = page.getByRole("region", {
    name: "Patient medical-record releases",
  });
  await expect(
    panel.getByText(/Confirmation requires recorded clinical acceptance/),
  ).toBeVisible();
  await panel
    .getByRole("button", {
      name: `Select all shown: ${sourceLabels.qol_ids}`,
      exact: true,
    })
    .click();
  await panel
    .getByRole("button", { name: "Review selected package", exact: true })
    .click();
  await panel
    .getByLabel(
      "I reviewed the complete selected records, original attachments and household recipient.",
    )
    .check();
  await expect(
    panel.getByRole("button", {
      name: "Confirm reviewed package",
      exact: true,
    }),
  ).toBeDisabled();
});
