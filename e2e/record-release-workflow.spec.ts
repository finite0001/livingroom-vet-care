import { record as apiRecord } from "../tests/ezyvet/attachment-review-fixture";
import { prescriptionArtifact } from "../tests/record-releases/prescription-fixture";
import { vaccinationArtifact } from "../tests/record-releases/vaccination-fixture";
import { clinicalHistoryArtifact } from "../tests/record-releases/clinical-history-fixture";
import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { sourceProvenanceArtifact } from "../tests/record-releases/source-provenance-fixture";
import { provenanceArtifact } from "../tests/record-releases/provenance-fixture";
const chartArtifact = provenanceArtifact();
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
  imported_prescription_ids: "imported_prescriptions",
  imported_vaccination_ids: "imported_vaccinations",
  imported_history_ids: "imported_histories",
  problem_ids: "problems",
  patient_summary_ids: "patient_summaries",
  weight_ids: "weights",
  treatment_ids: "treatments",
  encounter_ids: "encounters",
  certificate_ids: "certificates",
  lab_order_ids: "lab_results",
  lab_report_ids: "lab_reports",
  external_record_ids: "external_records",
  document_ids: "attachments",
  dental_ids: "dental_charts",
  qol_ids: "qol_records",
  anesthesia_ids: "anesthesia_records",
  lesion_ids: "lesions",
} as const;
async function fixture(
  page: Page,
  accepted = true,
  v4Accepted = accepted,
  sourceMode = false,
  clinicalMode = false,
  vaccinationMode = false,
  prescriptionMode = false,
) {
  const currentArtifact = prescriptionMode ? prescriptionArtifact() : vaccinationMode
    ? vaccinationArtifact()
    : clinicalMode
    ? clinicalHistoryArtifact()
    : sourceMode
      ? sourceProvenanceArtifact()
      : chartArtifact;
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
    malformedSources: false,
    apiCandidateCount: 0,
    malformedApi: false,
    prescriptionCandidateCount: 0,
    malformedPrescription: false,
    emails: [] as Array<{
      request: {
        id: string;
        release_id: string;
        actor_id: string;
        conversation_id: string;
        recipient: string;
        subject: string;
        body: string;
        release_hash: string;
        state: string;
      };
      payload_hash: string;
      manifest: Array<{
        filename: string;
        mime_type: string;
        file_size: number;
        sha256: string;
      }>;
      report_html: string;
      purged_at: null;
      receipt: {
        outbox_id: string;
        state: string;
        queued: boolean;
        delivered: boolean;
      } | null;
    }>,
    emailPrepareCalls: [] as Array<Record<string, string>>,
    emailQueueCalls: 0,
    loseCaptureResponse: false,
    loseQueueResponse: false,
    haveConversation: false,
    malformedRecovery: false,
    rows: [] as ReleaseBundle[],
    requests: [] as ReleaseConfirmArgs[],
    oversized: false,
    allCalls: 0,
    sourceLoads: 0,
    sourceSuffix: "",
    ambiguous: false,
    stale: false,
  };
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin ===
    new URL(test.info().project.use.baseURL as string).origin
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
    if (path === "/rest/v1/conversations")
      return route.fulfill({
        json: state.haveConversation
          ? [
              {
                id: "44444444-4444-4444-8444-444444444444",
                client_id: clientId,
                status: "ACTIVE",
                created_at: "2026-09-12T18:00:00Z",
              },
            ]
          : [],
      });
    if (path === "/rest/v1/rpc/ensure_active_conversation") {
      state.haveConversation = true;
      return route.fulfill({
        json: { id: "44444444-4444-4444-8444-444444444444" },
      });
    }
    if (path === "/rest/v1/rpc/recover_release_email") {
      if (state.malformedRecovery) return route.fulfill({ json: [] });
      const args = route.request().postDataJSON();
      return route.fulfill({
        json:
          state.emails
            .filter(
              (e) =>
                e.request.release_id === args.p_release_id &&
                e.request.state !== "abandoned" &&
                (!args.p_request_id || e.request.id === args.p_request_id),
            )
            .at(-1) || null,
      });
    }
    if (path === "/functions/v1/prepare-release-email") {
      const a = route.request().postDataJSON();
      state.emailPrepareCalls.push(a);
      let saved = state.emails.find((e) => e.request.id === a.p_request_id);
      if (!saved) {
        saved = {
          request: {
            id: a.p_request_id,
            release_id: a.p_release_id,
            actor_id: staffId,
            conversation_id: a.p_conversation_id,
            recipient: "owner@example.test",
            subject: a.p_subject,
            body: a.p_body,
            release_hash: a.p_release_hash,
            state: "ready",
          },
          payload_hash: "b".repeat(64),
          manifest: [
            {
              filename: "reviewed-report.html",
              mime_type: "text/html",
              file_size: 80,
              sha256: "c".repeat(64),
            },
          ],
          report_html: "<!doctype html><h1>Exact frozen clinical report</h1>",
          purged_at: null,
          receipt: null,
        };
        state.emails.push(saved);
      }
      if (state.loseCaptureResponse) {
        state.loseCaptureResponse = false;
        return route.abort("failed");
      }
      return route.fulfill({ json: saved });
    }
    if (path === "/rest/v1/rpc/enqueue_release_email") {
      state.emailQueueCalls++;
      const a = route.request().postDataJSON();
      const saved = state.emails.find((e) => e.request.id === a.p_request_id)!;
      saved.request.state = "queued";
      saved.receipt = {
        outbox_id: saved.request.id,
        state: "pending",
        queued: true,
        delivered: false,
      };
      if (state.loseQueueResponse) {
        state.loseQueueResponse = false;
        return route.abort("failed");
      }
      return route.fulfill({
        json: { id: saved.request.id, state: "pending" },
      });
    }
    if (path === "/rest/v1/rpc/abandon_release_email") {
      const a = route.request().postDataJSON();
      state.emails.find((e) => e.request.id === a.p_request_id)!.request.state =
        "abandoned";
      return route.fulfill({ json: null });
    }
    if (path === "/rest/v1/rpc/list_record_release_sources_v9") {
      state.sourceLoads++;
      if (state.malformedSources) return route.fulfill({ json: [] });
      const candidates: Record<string, unknown> = {
        pet_id: petId,
        client_id: clientId,
        client_name: "Test family",
        email: "owner@example.test",
        phone: "+13035550100",
        policy_accepted: accepted,
        policy_v4_accepted: v4Accepted,
        policy_v9_accepted: v4Accepted,
        api_original_ids: [],
        lab_report_ids: [],
        external_record_ids: [],
        has_more: Object.fromEntries(
          Object.keys(sourceLabels).map((key) => [key, false]),
        ),
      };
      const offset = route.request().postDataJSON().p_offset;
      for (const [key, array] of Object.entries(groups))
        candidates[key] = (currentArtifact.preview.snapshot[array] || []).map(
          (row) => ({
            id: row.id,
            version: 2,
            recorded_at: "2026-09-12T18:00:00Z",
            label: `Source ${row.id}${state.sourceSuffix}`,
            source_label:
              (key === "imported_history_ids" || key === "imported_vaccination_ids" || key === "imported_prescription_ids")
                ? "ezyVet reviewed outside history"
                : undefined,
            required_document_id: key === "lab_order_ids" ? "document" : null,
            required_lab_report_ids: key === "document_ids" ? [] : undefined,
            required_external_record_ids:
              key === "document_ids" ? [] : undefined,
            mime_type: key === "document_ids" ? "application/pdf" : undefined,
            file_size: key === "document_ids" ? 100 : undefined,
          }),
        );
      if (sourceMode) {
        for (const [key, array] of [
          ["lab_report_ids", "lab_reports"],
          ["external_record_ids", "external_records"],
        ] as const)
          candidates[key] = offset
            ? []
            : currentArtifact.preview.snapshot[array]!.map((r) => ({
                id: r.id,
                version: r.version,
                recorded_at: r.received_at,
                label: `Source ${r.id}`,
                required_document_id: r.document_id,
                required_document_version: r.document_version,
                file_size: r.file_size,
                mime_type: r.mime_type,
                kind: r.kind,
                historical: r.historical,
                source_label: r.source.provider_label,
                acknowledgment_count: r.acknowledgments.length,
              }));
        candidates.document_ids = offset
          ? currentArtifact.preview.snapshot.attachments.map((d) => ({
              id: d.id,
              version: d.version,
              recorded_at: "2026-09-12T18:00:00Z",
              label: `Original ${d.id}`,
              file_size: d.file_size,
              mime_type: d.mime_type,
              required_lab_report_ids: currentArtifact.preview.snapshot
                .lab_reports!.filter((r) => r.document_id === d.id)
                .map((r) => r.id),
              required_external_record_ids: currentArtifact.preview.snapshot
                .external_records!.filter((r) => r.document_id === d.id)
                .map((r) => r.id),
            }))
          : [];
        candidates.has_more = Object.fromEntries(
          Object.keys(sourceLabels).map((key) => [
            key,
            key === "document_ids" && !offset,
          ]),
        );
      }
      if (prescriptionMode) candidates.imported_prescription_ids = currentArtifact.preview.snapshot.imported_prescriptions!.map((p) => ({
        id: p.id, version: p.version, version_hash: p.version_hash,
        recorded_at: p.approved_at, label: `Outside prescription ${p.id}`,
        source_label: "ezyVet reviewed outside history",
        completeness: p.context.reviewed.completeness,
        partial_disclosure: p.context.reviewed.partial_reason,
      }));
      if (state.prescriptionCandidateCount) {
        candidates.imported_prescription_ids = Array.from({ length: state.prescriptionCandidateCount }, (_, index) => ({
          id: `c8000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
          version: 1,
          version_hash: "a".repeat(64),
          recorded_at: "2026-09-13T12:00:00Z",
          label: `Outside prescription ${index + 1}`,
          source_label: "ezyVet reviewed outside history",
          completeness: "partial",
          partial_disclosure: state.malformedPrescription ? null : "One referenced item was unavailable; no current medication reconciliation.",
        }));
      }
      candidates.api_original_ids = Array.from({ length: state.apiCandidateCount }, (_, index) => ({
        id: index === 0 ? apiRecord().id : `c9000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        version: 1, version_hash: apiRecord().record_hash,
        recorded_at: apiRecord().approved_at, label: `API original ${index + 1}`,
        source_label: "ezyVet API original", capture_hash: apiRecord().capture_hash,
        content_sha256: apiRecord().content_sha256, mime_type: "application/pdf", file_size: 30,
        acknowledgment_count: state.malformedApi ? 0 : 1, historical_source: true,
      }));
      return route.fulfill({ json: candidates });
    }
    if (path === "/rest/v1/rpc/select_all_record_release_sources_v9") {
      state.allCalls++;
      if (state.oversized)
        return route.fulfill({
          status: 400,
          json: {
            code: "23514",
            message:
              "More than 100 records in weight_ids. Split this patient history into explicitly reviewed packages; no partial all-record selection was returned",
          },
        });
      return route.fulfill({
        json: {
          selection: {
            api_original_ids: Array.from({ length: state.apiCandidateCount }, (_, index) => index === 0 ? apiRecord().id : `c9000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`),
            lab_report_ids: [],
            external_record_ids: [],
            ...Object.fromEntries(
              Object.entries(groups).map(([key, array]) => [
                key,
                (currentArtifact.preview.snapshot[array] || []).map(
                  (x) => x.id,
                ),
              ]),
            ),
          },
          excluded_unavailable_originals: 0,
          excluded_labs_without_shareable_original: 0,
          scope: "All eligible records across every page; fixed selection.",
        },
      });
    }
    if (path === "/rest/v1/record_releases")
      return route.fulfill({ json: state.rows.map((v) => v.release) });
    if (path === "/rest/v1/rpc/read_record_release")
      return route.fulfill({
        json: state.rows.find(
          (v) => v.release.id === route.request().postDataJSON().p_id,
        ),
      });
    if (path === "/rest/v1/rpc/preview_record_release_v9") {
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
      const preview = structuredClone(currentArtifact.preview);
      if (body.p_selection.api_original_ids?.length) {
        preview.snapshot.patient.id = petId;
        preview.snapshot.recipient.client_id = clientId;
      }
      Object.assign(preview.snapshot, {
        schema_version: 9,
        api_originals: body.p_selection.api_original_ids?.length ? [{
          record: apiRecord(), acknowledgment: {
            id: "99999999-9999-4999-8999-999999999999", action_id: "88888888-8888-4888-8888-888888888888",
            record_id: apiRecord().id, pet_id: petId, actor_id: staffId,
            record_hash: apiRecord().record_hash, capture_hash: apiRecord().capture_hash,
            created_at: "2026-09-14T13:00:00Z",
          },
        }] : [],
        imported_prescriptions: preview.snapshot.imported_prescriptions || [],
        imported_vaccinations: preview.snapshot.imported_vaccinations || [],
        imported_histories: preview.snapshot.imported_histories || [],
        problem_source_extractions:
          preview.snapshot.problem_source_extractions || [],
        lab_reports: preview.snapshot.lab_reports || [],
        external_records: preview.snapshot.external_records || [],
      });
      for (const [key, array] of Object.entries(groups))
        Object.assign(preview.snapshot, {
          [array]: (preview.snapshot[array] || []).filter((row) =>
            body.p_selection[key]?.includes(row.id),
          ),
        });
      preview.snapshot.problem_source_extractions = (
        preview.snapshot.problem_source_extractions || []
      )
        .filter((e) => body.p_selection.problem_ids?.includes(e.problem_id))
        .map((e) => ({
          ...e,
          sources: e.sources.map((h) => ({
            ...h,
            narrative_included:
              !!body.p_selection.imported_history_ids?.includes(h.id),
          })),
          discrepancy: {
            ...e.discrepancy,
            review_history: e.discrepancy.review_history.map((r) => ({
              ...r,
              sources: r.sources.map((h) => ({
                ...h,
                narrative_included:
                  !!body.p_selection.imported_history_ids?.includes(h.id),
              })),
            })),
          },
        }));
      preview.snapshot.selection = { ...body.p_selection, api_original_ids: body.p_selection.api_original_ids || [], imported_prescription_ids: body.p_selection.imported_prescription_ids || [], imported_vaccination_ids: body.p_selection.imported_vaccination_ids || [] };
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
  const loadsBeforeRefresh = state.sourceLoads;
  state.sourceSuffix = " refreshed";
  await panel
    .getByRole("button", { name: "Refresh source list", exact: true })
    .click();
  await expect
    .poll(() => state.sourceLoads)
    .toBeGreaterThan(loadsBeforeRefresh);
  await expect(panel.getByText(/refreshed/).first()).toBeVisible();
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
  await expect(
    panel.getByRole("button", { name: "Refresh source list", exact: true }),
  ).toBeDisabled();
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

test("malformed release sources show a local retry error without crashing the patient record", async ({
  page,
}) => {
  const state = await fixture(page);
  state.malformedSources = true;
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Retry release data", exact: true }),
  ).toBeVisible({ timeout: 15000 });
  await expect(
    page.getByRole("region", { name: "Clinical records", exact: true }),
  ).toBeVisible();
  state.malformedSources = false;
  await page
    .getByRole("button", { name: "Retry release data", exact: true })
    .click();
  await expect(page.getByLabel("Household delivery contact")).toBeVisible();
});

test("all-eligible selection is server-collected and the locked review includes clinical histories", async ({
  page,
}) => {
  const state = await fixture(page);
  const panel = page.getByRole("region", {
    name: "Patient medical-record releases",
  });
  await panel
    .getByRole("button", {
      name: "Select all eligible records across every page",
      exact: true,
    })
    .click();
  expect(state.allCalls).toBe(1);
  await expect(
    panel.getByText(
      "All eligible records across every page; fixed selection.",
      { exact: false },
    ),
  ).toBeVisible();
  await panel
    .getByRole("button", { name: "Review selected package", exact: true })
    .click();
  const frame = panel.frameLocator("iframe");
  await expect(
    frame
      .getByRole("heading", {
        name: "IMPORTANT — Vaccine reaction",
        exact: true,
      })
      .first(),
  ).toBeVisible();
  await expect(
    frame.getByText("Penicillin reaction", { exact: true }),
  ).toBeVisible();
  await expect(
    frame.getByText("External record provenance", { exact: true }),
  ).toBeVisible();
  await expect(
    frame.getByRole("heading", { name: "2026-09-01 · 11.34 kg" }),
  ).toBeVisible();
  await expect(
    frame.getByText("Source clinician unknown", { exact: false }),
  ).toBeVisible();
  await expect(
    frame.getByText("Retain local measurement", { exact: false }),
  ).toBeVisible();
  await expect(
    panel.getByRole("button", {
      name: "Select all eligible records across every page",
    }),
  ).toBeDisabled();
});
test("oversized all-record request preserves prior explicit selection and requires splitting", async ({
  page,
}) => {
  const state = await fixture(page);
  state.oversized = true;
  const panel = page.getByRole("region", {
    name: "Patient medical-record releases",
  });
  await panel
    .getByRole("button", {
      name: "Select all shown: Problem and diagnosis history",
      exact: true,
    })
    .click();
  await panel
    .getByRole("button", {
      name: "Select all eligible records across every page",
      exact: true,
    })
    .click();
  await expect(
    panel.getByText("More than 100 records in weight_ids.", { exact: false }),
  ).toBeVisible();
  await expect(
    panel.getByText("Problem and diagnosis history · 1 selected", {
      exact: true,
    }),
  ).toBeVisible();
  await panel
    .getByRole("button", { name: "Review selected package", exact: true })
    .click();
  await expect(
    panel
      .frameLocator("iframe")
      .getByRole("heading", { name: "IMPORTANT — Vaccine reaction" })
      .first(),
  ).toBeVisible();
});

async function emailFixture(page: Page) {
  const state = await fixture(page);
  state.rows.push({
    release: {
      ...structuredClone(chartArtifact.preview),
      id: "55555555-5555-4555-8555-555555555555",
      pet_id: petId,
      client_id: clientId,
      channel: "EMAIL",
      recipient: "owner@example.test",
      selection: {},
      created_by: staffId,
      created_at: "2026-09-12T18:00:00Z",
    },
    events: [],
    eligible: true,
    ineligibility_reason: null,
  });
  await page.reload();
  await page
    .getByRole("button", { name: "Open release package", exact: true })
    .click();
  return state;
}
test("release email recovers lost capture and queue responses across reload and creates a separate new intent explicitly", async ({
  page,
}) => {
  const state = await emailFixture(page);
  let email = page.getByRole("region", { name: "Reviewed release email" });
  await email
    .getByRole("button", {
      name: "Create or use active household conversation",
    })
    .click();
  await email.getByLabel("Email subject", { exact: true }).fill("");
  await email
    .getByRole("button", {
      name: "Prepare exact email attachments",
      exact: true,
    })
    .click();
  await expect(
    email.getByText(
      "Choose a household conversation and enter an email subject and message.",
      { exact: true },
    ),
  ).toBeVisible();
  expect(state.emailPrepareCalls).toHaveLength(0);
  await email.getByLabel("Email subject", { exact: true }).fill("Records A");
  state.loseCaptureResponse = true;
  await email
    .getByRole("button", {
      name: "Prepare exact email attachments",
      exact: true,
    })
    .click();
  await expect(
    email
      .frameLocator("iframe")
      .getByRole("heading", { name: "Exact frozen clinical report" }),
  ).toBeVisible();
  const requestId = state.emails[0].request.id;
  await page.reload();
  await page
    .getByRole("button", { name: "Open release package", exact: true })
    .click();
  email = page.getByRole("region", { name: "Reviewed release email" });
  await expect(email.getByLabel("Email subject", { exact: true })).toHaveValue(
    "Records A",
  );
  await expect(email.getByLabel("Household conversation")).toHaveValue(
    "44444444-4444-4444-8444-444444444444",
  );
  await email
    .getByLabel(
      "I reviewed the exact frozen report, original attachments, email message and household recipient.",
    )
    .check();
  state.loseQueueResponse = true;
  await email
    .getByRole("button", { name: "Queue reviewed record email", exact: true })
    .click();
  await expect(
    email.getByText("Saved queue receipt:", { exact: false }),
  ).toBeVisible();
  expect(state.emailQueueCalls).toBe(1);
  await page.reload();
  await page
    .getByRole("button", { name: "Open release package", exact: true })
    .click();
  email = page.getByRole("region", { name: "Reviewed release email" });
  await expect(email.getByText(requestId, { exact: false })).toBeVisible();
  await email
    .getByRole("button", { name: "Compose a separate new email" })
    .click();
  await email
    .getByRole("button", {
      name: "Create or use active household conversation",
    })
    .click();
  await email.getByLabel("Email subject", { exact: true }).fill("Records B");
  await email
    .getByRole("button", {
      name: "Prepare exact email attachments",
      exact: true,
    })
    .click();
  await expect(email.getByLabel("Email subject", { exact: true })).toHaveValue(
    "Records B",
  );
  expect(state.emails).toHaveLength(2);
  expect(state.emails[1].request.id).not.toBe(requestId);
  expect(state.emailQueueCalls).toBe(1);
});
test("malformed email recovery remains a local error and cannot create another email", async ({
  page,
}) => {
  const state = await emailFixture(page);
  state.malformedRecovery = true;
  await page.reload();
  await page
    .getByRole("button", { name: "Open release package", exact: true })
    .click();
  const email = page.getByRole("region", { name: "Reviewed release email" });
  await expect(
    email.getByText("Saved-email recovery failed.", { exact: false }),
  ).toBeVisible();
  await expect(
    email.getByRole("button", { name: "Prepare exact email attachments" }),
  ).toBeDisabled();
  expect(state.emailPrepareCalls).toHaveLength(0);
});

test("new package confirmation cannot replace an active release email draft", async ({
  page,
}) => {
  await emailFixture(page);
  const email = page.getByRole("region", { name: "Reviewed release email" });
  await email
    .getByLabel("Email subject", { exact: true })
    .fill("Unsaved clinical email draft");
  const panel = page.getByRole("region", {
    name: "Patient medical-record releases",
  });
  await panel
    .getByRole("button", {
      name: "Select all shown: Problem and diagnosis history",
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
  await expect(email.getByLabel("Email subject", { exact: true })).toHaveValue(
    "Unsaved clinical email draft",
  );
});

test("legacy acceptance does not enable confirmation of the expanded version 9 form", async ({
  page,
}) => {
  await fixture(page, true, false);
  const panel = page.getByRole("region", {
    name: "Patient medical-record releases",
  });
  await panel
    .getByRole("button", {
      name: "Select all eligible records across every page",
      exact: true,
    })
    .click();
  await panel
    .getByRole("button", { name: "Review selected package", exact: true })
    .click();
  await expect(
    panel.getByText("version 9, including DVM-acknowledged API originals, reviewed outside prescriptions, vaccinations, imported clinical narratives", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(
    panel.getByRole("button", {
      name: "Confirm reviewed package",
      exact: true,
    }),
  ).toBeDisabled();
});

test("SMS release draft protects package selection and recovery preserves revocation after clinical withdrawal", async ({
  page,
}) => {
  const state = await fixture(page);
  const releaseId = "55555555-5555-4555-8555-555555555555";
  state.rows.push({
    release: {
      ...structuredClone(chartArtifact.preview),
      id: releaseId,
      pet_id: petId,
      client_id: clientId,
      channel: "SMS",
      recipient: "+13035550123",
      selection: {},
      created_by: staffId,
      created_at: "2026-09-12T18:00:00Z",
    },
    events: [],
    eligible: true,
    ineligibility_reason: null,
  });
  let revoked = false;
  let recovery: unknown = null;
  await page.route("**/*document*", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("read_document_link_history"))
      return route.fulfill({ json: [] });
    if (path.endsWith("recover-document-link"))
      return route.fulfill({ status: 503, json: { error: "Key removed" } });
    if (path.endsWith("recover_document_link"))
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(recovery),
      });
    if (path.endsWith("revoke_document_link")) {
      revoked = true;
      (recovery as { grant: { state: string } }).grant.state = "revoked";
      return route.fulfill({ contentType: "application/json", body: "null" });
    }
    return route.fallback();
  });
  await page.reload();
  await page
    .getByRole("button", { name: "Open release package", exact: true })
    .click();
  const sms = page.getByRole("region", {
    name: "Document text message",
    exact: true,
  });
  await expect(sms.getByLabel("Link expiry")).toBeEnabled();
  await sms
    .getByRole("textbox")
    .first()
    .fill("Please review {{document_link}}");
  await expect(
    page.getByRole("button", { name: "Open release package", exact: true }),
  ).toBeDisabled();
  await expect(
    sms.getByRole("button", { name: "Recover document text and receipt" }),
  ).toBeDisabled();
  await sms
    .getByRole("button", { name: "Discard document text draft" })
    .click();
  recovery = {
    grant: {
      id: releaseId,
      family: "record_release",
      source_id: releaseId,
      client_id: clientId,
      actor_id: staffId,
      conversation_id: releaseId,
      recipient: "+13035550123",
      source_hash: "a".repeat(64),
      message_template: "Documents {{document_link}}",
      expires_at: new Date(Date.now() + 3600000).toISOString(),
      state: "preparing",
    },
    artifact_hash: null,
    message_hash: null,
    manifest: null,
    report_html: null,
    receipt: null,
  };
  state.rows[0].eligible = false;
  state.rows[0].ineligibility_reason = "Clinical approval withdrawn";
  await page.reload();
  await page
    .getByRole("button", { name: "Open release package", exact: true })
    .click();
  await expect(sms.getByText(/New preparation is unavailable/)).toBeVisible();
  await sms.getByLabel("Revocation reason").fill("Withdrawn clinical review");
  await sms
    .getByRole("button", { name: "Revoke document link", exact: true })
    .click();
  await expect(
    sms.getByText("This link is revoked.", { exact: true }),
  ).toBeVisible();
  expect(revoked).toBe(true);
});

test("verified lab and imported versions retain explicit matching originals across pages", async ({
  page,
}) => {
  const state = await fixture(page, true, true, true);
  const panel = page.getByRole("region", {
    name: "Patient medical-record releases",
  });
  await expect(panel.getByText(/corrected · Current version/)).toBeVisible();
  await expect(panel.getByText(/replacement · Current version/)).toBeVisible();
  await expect(
    panel
      .getByText(/No DVM acknowledgment recorded for this exact version/)
      .first(),
  ).toBeVisible();
  await expect(
    panel.getByText(/1 exact-version DVM acknowledgment/).first(),
  ).toBeVisible();
  for (const kind of ["lab_report_ids", "external_record_ids"] as const)
    await panel
      .getByRole("button", {
        name: `Select all shown: ${sourceLabels[kind]}`,
        exact: true,
      })
      .click();
  await expect(
    panel.getByRole("button", { name: "Review selected package", exact: true }),
  ).toBeDisabled();
  await panel
    .getByRole("button", { name: "Older source records", exact: true })
    .click();
  await panel
    .getByRole("button", {
      name: `Select all shown: ${sourceLabels.document_ids}`,
      exact: true,
    })
    .click();
  await expect(
    panel.getByRole("button", { name: "Review selected package", exact: true }),
  ).toBeEnabled();
  const original = panel
    .getByRole("checkbox", { name: /Original b5000000/ })
    .first();
  await original.uncheck();
  await expect(panel.getByRole("alert")).toContainText("matching original");
  await expect(
    panel.getByRole("button", { name: "Review selected package", exact: true }),
  ).toBeDisabled();
  await original.check();
  await panel
    .getByRole("button", { name: "Review selected package", exact: true })
    .click();
  const frame = panel.frameLocator(
    'iframe[title="Medical-record release artifact"]',
  );
  await expect(
    frame.getByText("Antech (synthetic)", { exact: false }).first(),
  ).toBeVisible();
  await expect(
    frame.getByText("ezyVet", { exact: false }).first(),
  ).toBeVisible();
  await panel
    .getByLabel(
      "I reviewed the complete selected records, original attachments and household recipient.",
    )
    .check();
  state.ambiguous = true;
  await panel
    .getByRole("button", { name: "Confirm reviewed package", exact: true })
    .click();
  await panel
    .getByRole("button", {
      name: "Retry same package confirmation",
      exact: true,
    })
    .click();
  await expect(
    panel.getByRole("heading", { name: /Opened release / }),
  ).toBeVisible();
  expect(state.requests[0]).toEqual(state.requests[1]);
  expect(state.requests[0].p_selection.lab_report_ids).toHaveLength(2);
  expect(state.requests[0].p_selection.external_record_ids).toHaveLength(2);
  expect(state.requests[0].p_selection.document_ids).toHaveLength(4);
  expect(state.requests[0].p_reviewed_snapshot.schema_version).toBe(9);
});

test("all-source selection includes reciprocal provenance and stale source rejection preserves review workflow", async ({
  page,
}) => {
  const state = await fixture(page, true, true, true);
  const panel = page.getByRole("region", {
    name: "Patient medical-record releases",
  });
  await panel
    .getByRole("button", { name: "Older source records", exact: true })
    .click();
  await panel
    .getByRole("button", {
      name: `Select all shown: ${sourceLabels.document_ids}`,
      exact: true,
    })
    .click();
  await expect(panel.getByRole("alert")).toContainText(
    "every associated approved report",
  );
  await panel
    .getByRole("button", {
      name: "Select all eligible records across every page",
      exact: true,
    })
    .click();
  await panel
    .getByRole("button", { name: "Review selected package", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Schedule", exact: true })
    .first()
    .click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.getByRole("button", { name: /keep/i }).click();
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
  expect(state.rows).toHaveLength(0);
});

test("schema9 explicitly selects outside narratives while retaining compact problem provenance and exact confirmation recovery", async ({
  page,
}) => {
  const state = await fixture(page, true, true, true, true);
  state.ambiguous = true;
  const panel = page.getByRole("region", {
    name: "Patient medical-record releases",
  });
  await panel
    .getByRole("button", {
      name: `Select all shown: ${sourceLabels.problem_ids}`,
      exact: true,
    })
    .click();
  await panel
    .getByRole("button", { name: "Review selected package", exact: true })
    .click();
  await expect(
    panel.frameLocator("iframe").getByRole("heading", {
      name: "Local problem source provenance",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    panel
      .frameLocator("iframe")
      .getByText("The original narrative was not selected for this package.", {
        exact: true,
      }),
  ).toBeVisible();
  await expect(
    panel
      .frameLocator("iframe")
      .getByRole("heading", { name: "Imported outside history", exact: true }),
  ).toHaveCount(0);
  await panel
    .getByRole("button", { name: "Edit selection and review again" })
    .click();
  await panel
    .getByRole("button", {
      name: `Select all shown: ${sourceLabels.imported_history_ids}`,
      exact: true,
    })
    .click();
  await panel
    .getByRole("button", { name: "Review selected package", exact: true })
    .click();
  await expect(
    panel
      .frameLocator("iframe")
      .getByRole("heading", { name: "Imported outside history", exact: true }),
  ).toBeVisible();
  await expect(
    panel
      .frameLocator("iframe")
      .getByText("The original narrative is included in this package.", {
        exact: true,
      }),
  ).toBeVisible();
  await panel
    .getByLabel(
      "I reviewed the complete selected records, original attachments and household recipient.",
    )
    .check();
  await panel
    .getByRole("button", { name: "Confirm reviewed package", exact: true })
    .click();
  await panel
    .getByRole("button", {
      name: "Retry same package confirmation",
      exact: true,
    })
    .click();
  expect(state.requests).toHaveLength(2);
  expect(state.requests[0]).toEqual(state.requests[1]);
  expect(state.requests[0].p_reviewed_snapshot.schema_version).toBe(9);
  expect(state.requests[0].p_selection.imported_history_ids).toHaveLength(1);
});


test("schema9 shares explicitly selected outside vaccination and narrative with exact recovery", async ({ page }) => {
  const state = await fixture(page, true, true, true, true, true);
  state.ambiguous = true;
  const panel = page.getByRole("region", { name: "Patient medical-record releases" });
  for (const key of ["imported_vaccination_ids", "imported_history_ids"] as const) {
    await panel.getByRole("button", { name: `Select all shown: ${sourceLabels[key]}`, exact: true }).click();
  }
  await panel.getByRole("button", { name: "Review selected package", exact: true }).click();
  const artifact = panel.frameLocator("iframe");
  await expect(artifact.getByRole("heading", { name: "Clinician-reviewed outside vaccination history", exact: true })).toBeVisible();
  await expect(artifact.getByRole("heading", { name: "Imported outside history", exact: true })).toBeVisible();
  await expect(artifact.getByText("Outside <script>vaccine</script>", { exact: true })).toBeVisible();
  await expect(artifact.locator("script")).toHaveCount(0);
  await panel.getByLabel("I reviewed the complete selected records, original attachments and household recipient.").check();
  await panel.getByRole("button", { name: "Confirm reviewed package", exact: true }).click();
  await panel.getByRole("button", { name: "Retry same package confirmation", exact: true }).click();
  expect(state.requests).toHaveLength(2);
  expect(state.requests[0]).toEqual(state.requests[1]);
  expect(state.requests[0].p_reviewed_snapshot.schema_version).toBe(9);
  expect(state.requests[0].p_selection.imported_vaccination_ids).toHaveLength(1);
  expect(state.requests[0].p_selection.imported_history_ids).toHaveLength(1);
});


test("outside prescription selection is explicit, discloses partial history and refuses more than 20", async ({ page }) => {
  const state = await fixture(page);
  state.prescriptionCandidateCount = 21;
  const panel = page.getByRole("region", { name: "Patient medical-record releases" });
  await panel.getByRole("button", { name: "Refresh source list", exact: true }).click();
  await expect(panel.getByText("Clinician-reviewed outside prescriptions · 0 selected", { exact: true })).toBeVisible();
  await expect(panel.getByText("Partial source history · One referenced item was unavailable; no current medication reconciliation.", { exact: true })).toHaveCount(21);
  await panel.getByRole("button", { name: "Select all shown: Clinician-reviewed outside prescriptions", exact: true }).click();
  await expect(panel.getByText("Selecting these records would exceed 20 in this family. Use a separate package; no selections were changed.", { exact: true })).toBeVisible();
  await expect(panel.getByText("Clinician-reviewed outside prescriptions · 0 selected", { exact: true })).toBeVisible();
  for (let index = 1; index <= 20; index++) {
    await panel.getByRole("checkbox", { name: new RegExp(`^Outside prescription ${index} ·`) }).check();
  }
  await panel.getByRole("checkbox", { name: /^Outside prescription 21 ·/ }).click();
  await expect(panel.getByText("Use a separate package for more than 20 records in this source family.", { exact: true })).toBeVisible();
  await expect(panel.getByRole("checkbox", { name: /^Outside prescription 21 ·/ })).not.toBeChecked();
  await expect(panel.getByText("Clinician-reviewed outside prescriptions · 20 selected", { exact: true })).toBeVisible();
});

test("partial prescription candidate missing disclosure fails closed", async ({ page }) => {
  const state = await fixture(page);
  state.prescriptionCandidateCount = 1;
  state.malformedPrescription = true;
  const panel = page.getByRole("region", { name: "Patient medical-record releases" });
  await panel.getByRole("button", { name: "Refresh source list", exact: true }).click();
  await expect(panel.getByText("Release data could not be loaded.", { exact: false })).toBeVisible({ timeout: 15000 });
});


test("schema9 includes explicitly selected prescription with vaccination and narrative through exact recovery", async ({ page }) => {
  const state = await fixture(page, true, true, true, true, true, true);
  state.ambiguous = true;
  const panel = page.getByRole("region", { name: "Patient medical-record releases" });
  for (const key of ["imported_prescription_ids", "imported_vaccination_ids", "imported_history_ids"] as const) {
    await panel.getByRole("button", { name: `Select all shown: ${sourceLabels[key]}`, exact: true }).click();
  }
  await panel.getByRole("button", { name: "Review selected package", exact: true }).click();
  const artifact = panel.frameLocator("iframe");
  await expect(artifact.getByRole("heading", { name: "Clinician-reviewed outside prescription history", exact: true })).toBeVisible();
  await expect(artifact.getByRole("heading", { name: "Clinician-reviewed outside vaccination history", exact: true })).toBeVisible();
  await expect(artifact.getByRole("heading", { name: "Imported outside history", exact: true })).toBeVisible();
  await expect(artifact.getByText("<script>outside prose</script>", { exact: true }).first()).toBeVisible();
  await expect(artifact.locator("script")).toHaveCount(0);
  await panel.getByLabel("I reviewed the complete selected records, original attachments and household recipient.").check();
  await panel.getByRole("button", { name: "Confirm reviewed package", exact: true }).click();
  await panel.getByRole("button", { name: "Retry same package confirmation", exact: true }).click();
  expect(state.requests).toHaveLength(2);
  expect(state.requests[0]).toEqual(state.requests[1]);
  expect(state.requests[0].p_reviewed_snapshot.schema_version).toBe(9);
  expect(state.requests[0].p_selection.imported_prescription_ids).toHaveLength(1);
  expect(state.requests[0].p_selection.imported_vaccination_ids).toHaveLength(1);
  expect(state.requests[0].p_selection.imported_history_ids).toHaveLength(1);
  state.rows[0].eligible = false;
  state.rows[0].ineligibility_reason = "Outside prescription item changed";
  state.rows[0].events.push({
    id: "prescription-change", release_id: state.rows[0].release.id,
    kind: "source_changed", reason: "Outside prescription item changed",
    created_by: staffId, created_at: "2026-09-13T13:00:00Z",
  });
  const downloadPromise = page.waitForEvent("download");
  await panel.getByRole("button", { name: "Save review HTML", exact: true }).click();
  const download = await downloadPromise;
  const html = await readFile((await download.path())!, "utf8");
  expect(html).toContain("INVALIDATED RELEASE");
  expect(html).toContain("Outside prescription item changed");
  expect(html).toContain("Clinician-reviewed outside prescription history");
});

test("API originals require acknowledgment and enforce the 20-record cap without truncation", async ({ page }) => {
  const state = await fixture(page);
  state.apiCandidateCount = 21;
  const panel = page.getByRole("region", { name: "Patient medical-record releases" });
  await panel.getByRole("button", { name: "Refresh source list", exact: true }).click();
  await expect(panel.getByText("Historical provider source at admission.", { exact: false })).toHaveCount(21);
  await panel.getByRole("button", { name: "Select all shown: DVM-acknowledged API originals", exact: true }).click();
  await expect(panel.getByText("Selecting these records would exceed 20 in this family. Use a separate package; no selections were changed.", { exact: true })).toBeVisible();
  await expect(panel.getByText("DVM-acknowledged API originals · 0 selected", { exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "Select all eligible records across every page", exact: true }).click();
  await expect(panel.getByText("All-record selection is incomplete or exceeds a family limit; selections were not changed.", { exact: true })).toBeVisible();
  await expect(panel.getByText("DVM-acknowledged API originals · 0 selected", { exact: true })).toBeVisible();
  for (let index = 1; index <= 20; index++) await panel.getByRole("checkbox", { name: new RegExp(`^API original ${index} ·`) }).check();
  await panel.getByRole("checkbox", { name: /^API original 21 ·/ }).click();
  await expect(panel.getByRole("checkbox", { name: /^API original 21 ·/ })).not.toBeChecked();
  await expect(panel.getByText("DVM-acknowledged API originals · 20 selected", { exact: true })).toBeVisible();
});

test("API original without exact DVM acknowledgment fails closed", async ({ page }) => {
  const state = await fixture(page);
  state.apiCandidateCount = 1;
  state.malformedApi = true;
  const panel = page.getByRole("region", { name: "Patient medical-record releases" });
  await panel.getByRole("button", { name: "Refresh source list", exact: true }).click();
  await expect(panel.getByText("Release data could not be loaded.", { exact: false })).toBeVisible({ timeout: 15000 });
});

test("schema9 supports API-original-only review and exact lost-confirmation recovery", async ({ page }) => {
  const state = await fixture(page);
  state.apiCandidateCount = 1;
  state.ambiguous = true;
  const storageRequests: string[] = [];
  page.on("request", request => { if (request.url().includes("/storage/v1/")) storageRequests.push(request.url()); });
  const panel = page.getByRole("region", { name: "Patient medical-record releases" });
  await panel.getByRole("button", { name: "Refresh source list", exact: true }).click();
  await panel.getByRole("button", { name: "Select all shown: DVM-acknowledged API originals", exact: true }).click();
  await panel.getByRole("button", { name: "Review selected package", exact: true }).click();
  await expect(panel.frameLocator("iframe").getByText(apiRecord().content_sha256, { exact: false })).toBeVisible();
  await panel.getByLabel("I reviewed the complete selected records, original attachments and household recipient.").check();
  await panel.getByRole("button", { name: "Confirm reviewed package", exact: true }).click();
  await panel.getByRole("button", { name: "Retry same package confirmation", exact: true }).click();
  expect(state.requests).toHaveLength(2);
  expect(state.requests[0]).toEqual(state.requests[1]);
  expect(state.requests[0].p_reviewed_snapshot.schema_version).toBe(9);
  expect(state.requests[0].p_selection.api_original_ids).toEqual([apiRecord().id]);
  expect(state.requests[0].p_reviewed_snapshot.attachments).toEqual([]);
  expect(storageRequests).toEqual([]);
});
