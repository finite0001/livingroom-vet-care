import { createHash } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";

const backend = "http://127.0.0.1:54321";
const staffId = "11111111-1111-4111-8111-111111111111";
const petId = "22222222-2222-4222-8222-222222222222";
const clientId = "33333333-3333-4333-8333-333333333333";
const user = {
  id: staffId,
  aud: "authenticated",
  role: "authenticated",
  email: "synthetic@example.test",
  app_metadata: { provider: "email", providers: ["email"] },
  user_metadata: {},
  created_at: "2026-01-01T00:00:00Z",
};
const profile = {
  id: staffId,
  first_name: "Synthetic",
  last_name: "Staff",
  full_name: "Synthetic Staff",
  role: "STAFF",
  is_active: true,
};
const patient = {
  id: petId,
  client_id: clientId,
  name: "Synthetic Juniper",
  species: "Dog",
  breed: null,
  dob: "2020-09-12",
  birth_date_precision: "exact",
  color: "Black",
  microchip_id: null,
  sex: "female",
  neuter_status: "neutered",
  archived_at: null,
  deceased_at: null,
  weight_lbs: null,
  allergies: null,
  version: 1,
};
const orderId = "44444444-4444-4444-8444-444444444444",
  documentId = "55555555-5555-4555-8555-555555555555",
  sourceId = "66666666-6666-4666-8666-666666666666";
const date = "2026-09-12T12:00:00.000Z";
const original = Buffer.from(
  "%PDF-1.4\nSynthetic original laboratory report\n%%EOF",
);
const hash = (v: string | Buffer) =>
  createHash("sha256").update(v).digest("hex");
const documents = [
  {
    id: documentId,
    pet_id: petId,
    version: 1,
    file_name: "Original synthetic report.pdf",
    file_path: `${petId}/original.pdf`,
    file_size: original.length,
    mime_type: "application/pdf",
    status: "ready",
  },
  {
    id: "77777777-7777-4777-8777-777777777777",
    pet_id: petId,
    version: 1,
    file_name: "Corrected synthetic report.pdf",
    file_path: `${petId}/corrected.pdf`,
    file_size: original.length,
    mime_type: "application/pdf",
    status: "ready",
  },
];
// Synthetic RPC fixture rows deliberately span several SQL tables.
interface Row {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}
async function fixture(page: Page, role = "STAFF") {
  const lab = {
    sources: [
      {
        id: sourceId,
        actor_id: staffId,
        provider_label: "Antech",
        account_reference: "Synthetic manual account",
        environment_label: "Manual reference reports",
        review_note: "Reviewed source",
        manual_import_enabled: true,
        transport_enabled: false,
        created_at: date,
      },
    ] as Row[],
    mappings: [] as Row[],
    receipts: [] as Row[],
    captures: {} as Record<string, Row>,
    reports: [] as Row[],
    acks: [] as Row[],
    requests: [] as Row[],
    mappingCalls: [] as Row[],
    linkCalls: [] as Row[],
    ackCalls: [] as Row[],
    failPrepareBefore: false,
    failCapture: false,
    failLinkAfter: false,
    rejectMapping: false,
  };
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const payload = Buffer.from(
    JSON.stringify({
      sub: staffId,
      exp: expires,
      role: "authenticated",
      aud: "authenticated",
    }),
  ).toString("base64url");
  const session = {
    access_token: `eyJhbGciOiJIUzI1NiJ9.${payload}.synthetic`,
    refresh_token: "synthetic",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: expires,
    user,
  };
  await page.addInitScript(
    (value) => localStorage.setItem("sb-127-auth-token", JSON.stringify(value)),
    session,
  );
  const state = {
    row: {
      id: orderId,
      pet_id: petId,
      version: 1,
      test_name: "Synthetic chemistry",
      status: "resulted",
      due_date: "2026-10-20",
      collected_date: "2026-09-10",
      result_date: "2026-09-11",
      accession: "native accession",
      notes: "Native observations retained",
      result_document_id: documentId,
      template_id: null,
      template_version: null,
      interval_days: null,
      interval_anchor: null,
      override_reason: "",
      created_by: staffId,
      updated_by: staffId,
      created_at: date,
      updated_at: date,
    } as Record<string, unknown> | null,
    revisions: [] as Record<string, unknown>[],
    failNext: false,
    saves: [] as string[],
  };
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin === "http://127.0.0.1:8080"
      ? route.continue()
      : route.abort(),
  );
  await page.route(`${backend}/**`, async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path === "/auth/v1/token") return route.fulfill({ json: session });
    if (path === "/auth/v1/user") return route.fulfill({ json: user });
    if (path === "/rest/v1/profiles")
      return route.fulfill({ json: [{ ...profile, role }] });
    if (path === "/rest/v1/user_roles")
      return route.fulfill({ json: [{ role }] });
    if (path === "/rest/v1/pets") return route.fulfill({ json: [patient] });
    if (path === "/rest/v1/clients")
      return route.fulfill({
        json: { id: clientId, full_name: "Synthetic Household" },
      });
    if (path === "/rest/v1/patient_lab_orders")
      return route.fulfill({
        json: url.searchParams.has("id")
          ? state.row
          : state.row
            ? [state.row]
            : [],
      });
    if (path === "/rest/v1/lab_work_revisions")
      return route.fulfill({ json: state.revisions });
    if (path === "/rest/v1/lab_due_templates")
      return route.fulfill({
        json: [
          {
            id: "44444444-4444-4444-8444-444444444444",
            name: "Clinician reviewed synthetic interval",
            interval_days: 30,
            version: 1,
            active: true,
          },
        ],
      });
    if (path === "/rest/v1/patient_documents")
      return route.fulfill({
        json: documents.map((d) => ({
          ...d,
          category: "lab_result",
          visibility: "internal",
          created_by: staffId,
          created_at: date,
          document_date: null,
          source: "Manual",
          encounter_id: null,
        })),
      });
    if (path.startsWith("/storage/v1/object/"))
      return route.fulfill({ body: original, contentType: "application/pdf" });
    if (path === "/rest/v1/rpc/read_lab_result_history")
      return route.fulfill({
        json: {
          pet_id: petId,
          order_id: orderId,
          sources: lab.sources,
          source_reviews: lab.mappings,
          staged_receipts: lab.receipts
            .filter((r) => !lab.reports.some((v) => v.receipt_id === r.id))
            .map((r) => ({ ...r, capture: lab.captures[r.id] ?? null })),
          reports: lab.reports.map((r) => ({
            ...r,
            capture: lab.captures[r.receipt_id],
            document_status: "ready",
            acknowledgments: lab.acks.filter((a) => a.report_id === r.id),
          })),
        },
      });
    if (path === "/functions/v1/prepare-lab-report") {
      const b = route.request().postDataJSON();
      lab.requests.push(b);
      if (b.action === "recover") {
        const r = lab.receipts.find((r) => r.id === b.p_receipt_id);
        return route.fulfill({
          contentType: "application/json",
          json: r
            ? {
                receipt: r,
                capture: lab.captures[r.id] ?? null,
                report: lab.reports.find((v) => v.receipt_id === r.id) ?? null,
              }
            : null,
        });
      }
      if (lab.failPrepareBefore) {
        lab.failPrepareBefore = false;
        return route.abort();
      }
      let r = lab.receipts.find((r) => r.id === b.p_id);
      if (!r) {
        r = {
          id: b.p_id,
          actor_id: staffId,
          source_account_id: b.p_source_account_id,
          document_id: b.p_document_id,
          document_version: b.p_document_version,
          pet_id: petId,
          source_patient_reference: b.p_source_patient_reference,
          source_order_reference: b.p_source_order_reference,
          source_report_reference: b.p_source_report_reference,
          received_at: b.p_received_at,
          mime_type: "application/pdf",
          file_size: original.length,
          receipt_hash: hash("receipt" + b.p_id),
          entry_method: "staff_entered_v1",
          created_at: date,
        };
        lab.receipts.push(r);
      }
      if (lab.failCapture)
        return route.fulfill({
          status: 202,
          json: {
            error: "Capture unconfirmed",
            receipt_id: r.id,
            retry_requires_recovery: true,
          },
        });
      lab.captures[r.id] = {
        receipt_id: r.id,
        actor_id: staffId,
        receipt_hash: r.receipt_hash,
        document_version: r.document_version,
        content_sha256: hash(original),
        file_size: original.length,
        mime_type: "application/pdf",
        capture_hash: hash("capture" + r.id),
        captured_at: date,
      };
      return route.fulfill({
        json: { receipt: r, capture: lab.captures[r.id], report: null },
      });
    }
    if (path === "/rest/v1/rpc/review_lab_order_source") {
      const b = route.request().postDataJSON();
      lab.mappingCalls.push(b);
      if (lab.rejectMapping)
        return route.fulfill({
          status: 409,
          json: { code: "40001", message: "Order changed" },
        });
      const r = {
        id: b.p_id,
        actor_id: staffId,
        order_id: orderId,
        pet_id: petId,
        order_version: b.p_expected_order_version,
        source_account_id: b.p_source_account_id,
        source_patient_reference: b.p_source_patient_reference,
        source_order_reference: b.p_source_order_reference,
        previous_review_id: b.p_previous_review_id,
        revision: lab.mappings.length + 1,
        review_reason: b.p_review_reason,
        created_at: date,
      };
      lab.mappings.push(r);
      return route.fulfill({ json: r });
    }
    if (path === "/rest/v1/rpc/link_lab_report_version") {
      const b = route.request().postDataJSON();
      lab.linkCalls.push(b);
      const receipt = lab.receipts.find((r) => r.id === b.p_receipt_id)!;
      const r = {
        id: b.p_id,
        actor_id: staffId,
        order_id: orderId,
        pet_id: petId,
        order_version: b.p_expected_order_version,
        source_review_id: b.p_source_review_id,
        receipt_id: receipt.id,
        receipt_hash: b.p_expected_receipt_hash,
        capture_hash: b.p_expected_capture_hash,
        document_id: receipt.document_id,
        document_version: receipt.document_version,
        previous_report_id: b.p_previous_report_id,
        version: lab.reports.length + 1,
        kind: b.p_kind,
        review_reason: b.p_review_reason,
        created_at: date,
      };
      lab.reports.push(r);
      if (lab.failLinkAfter) {
        lab.failLinkAfter = false;
        return route.abort();
      }
      return route.fulfill({ json: r });
    }
    if (path === "/rest/v1/rpc/acknowledge_lab_report") {
      const b = route.request().postDataJSON();
      lab.ackCalls.push(b);
      const r = {
        id: b.p_id,
        actor_id: staffId,
        report_id: b.p_report_id,
        capture_hash: b.p_expected_capture_hash,
        document_version: b.p_expected_document_version,
        created_at: date,
      };
      lab.acks.push(r);
      return route.fulfill({ json: r });
    }
    if (path === "/rest/v1/rpc/review_lab_source_account") {
      const b = route.request().postDataJSON();
      const r = {
        id: b.p_id,
        actor_id: staffId,
        provider_label: b.p_provider_label,
        account_reference: b.p_account_reference,
        environment_label: b.p_environment_label,
        review_note: b.p_review_note,
        manual_import_enabled: true,
        transport_enabled: false,
        created_at: date,
      };
      lab.sources.push(r);
      return route.fulfill({ json: r });
    }
    if (path === "/rest/v1/rpc/save_patient_lab_order") {
      const body = route.request().postDataJSON();
      state.saves.push(body.p_id);
      expect(body.p_pet_id).toBe(petId);
      if (state.failNext) {
        state.failNext = false;
        return route.fulfill({
          status: 409,
          json: { code: "40001", message: "Lab order version conflict" },
        });
      }
      state.row = {
        ...body.p_values,
        id: body.p_id,
        pet_id: petId,
        version: Number(state.row?.version || 0) + 1,
        created_by: staffId,
        updated_by: staffId,
        created_at: "2026-01-02T17:00:00Z",
        updated_at: "2026-01-02T17:00:00Z",
      };
      state.revisions.push({
        id: state.revisions.length + 1,
        entity: "order",
        entity_id: body.p_id,
        version: state.row.version,
        snapshot: { ...state.row },
        reason: body.p_correction_reason,
        actor_id: staffId,
        recorded_at: "2026-01-02T17:00:00Z",
      });
      return route.fulfill({ json: state.row });
    }
    return route.fulfill({ json: [] });
  });
  return { state, lab };
}
async function openResults(page: Page) {
  await page.goto(`/hub/patient/${petId}`);
  await page
    .getByRole("button", { name: "Open lab order", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Lab report provenance" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Recover saved lab result work",
      exact: true,
    }),
  ).toBeEnabled();
}
async function mapping(page: Page) {
  await page
    .getByLabel("Reviewed source account", { exact: true })
    .selectOption(sourceId);
  await page
    .getByLabel("Source patient reference", { exact: true })
    .fill("source-patient");
  await page
    .getByLabel("Source order reference", { exact: true })
    .fill("source-order");
  await page
    .getByLabel("Source matching review reason")
    .fill("Compared original account and accession against patient and order");
  await page
    .getByLabel(/I reviewed the source account and patient\/order references/)
    .check();
  await page
    .getByRole("button", { name: "Save reviewed source mapping", exact: true })
    .click();
}
async function prepare(page: Page, corrected = false) {
  await page
    .getByLabel("Ready report for this patient")
    .selectOption(documents[corrected ? 1 : 0].id);
  await page
    .getByLabel("Source report reference", { exact: true })
    .fill(corrected ? "report-corrected" : "report-original");
  await page
    .getByRole("button", { name: "Verify original report bytes", exact: true })
    .click();
}
async function link(page: Page, corrected = false) {
  await expect(
    page.getByRole("button", {
      name: "Download verified original report",
      exact: true,
    }),
  ).toBeEnabled();
  await page
    .getByRole("button", {
      name: "Download verified original report",
      exact: true,
    })
    .click();
  await page
    .getByLabel(
      corrected ? "Corrected report reason" : "Report linking reason",
      { exact: true },
    )
    .fill(
      corrected
        ? "New corrected original received"
        : "Verified original matched to this order",
    );
  await page.getByLabel(/I reviewed the downloaded original/).check();
  await page
    .getByRole("button", {
      name: corrected ? "Link corrected report" : "Link original report",
      exact: true,
    })
    .click();
}
test("lost verification and link acknowledgments preserve exact intent and native notes; staff cannot acknowledge clinically", async ({
  page,
}) => {
  const { lab, state } = await fixture(page);
  await openResults(page);
  await mapping(page);
  lab.failPrepareBefore = true;
  await prepare(page);
  await expect(
    page.getByRole("button", {
      name: "Retry original lab result request",
      exact: true,
    }),
  ).toBeEnabled();
  const initial = lab.requests.find((r) => r.action === "prepare");
  expect(initial).toBeTruthy();
  expect(Object.keys(initial)).toHaveLength(9);
  expect(initial).not.toHaveProperty("p_content_sha256");
  await page.reload();
  await page
    .getByRole("button", { name: "Open lab order", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Retry original lab result request",
      exact: true,
    })
    .click();
  await expect(
    page.getByText("Original file bytes verified.", { exact: false }),
  ).toBeVisible();
  expect(lab.requests.filter((r) => r.action === "prepare")).toEqual([
    initial,
    initial,
  ]);
  lab.failLinkAfter = true;
  await link(page);
  await expect(
    page.getByText("Report version 1 · original · current", { exact: true }),
  ).toBeVisible();
  expect(lab.linkCalls).toHaveLength(1);
  expect(lab.reports).toHaveLength(1);
  expect(state.row?.notes).toBe("Native observations retained");
  expect(state.row?.due_date).toBe("2026-10-20");
  expect(state.row?.result_document_id).toBe(documentId);
  await expect(
    page.getByRole("button", { name: /Record veterinarian acknowledgment/ }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      Object.keys(sessionStorage).filter((k) =>
        k.startsWith("lab-result-intent:"),
      ),
    ),
  ).toEqual([]);
});
test("stale mapping stays unconfirmed until absent recovery and explicit discard; result drafts guard native edits", async ({
  page,
}) => {
  const { lab } = await fixture(page);
  await openResults(page);
  lab.rejectMapping = true;
  await mapping(page);
  await expect(
    page.getByRole("button", {
      name: "Discard confirmed uncreated request",
      exact: true,
    }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Save lab work", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "New lab order", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", {
      name: "Discard confirmed uncreated request",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Close local report review", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "New lab order", exact: true }),
  ).toBeEnabled();
  expect(lab.mappings).toHaveLength(0);
  expect(lab.reports).toHaveLength(0);
});
test("DVM acknowledgment is separate and never carries forward to a corrected report", async ({
  page,
}) => {
  const { lab } = await fixture(page, "DVM");
  await openResults(page);
  await mapping(page);
  await prepare(page);
  await link(page);
  await page
    .getByRole("button", { name: "Download report version 1", exact: true })
    .click();
  await page
    .getByLabel(
      "I reviewed the original clinical report, version 1. This acknowledgment covers only this version.",
      { exact: true },
    )
    .check();
  await page
    .getByRole("button", {
      name: "Record veterinarian acknowledgment for version 1",
      exact: true,
    })
    .click();
  await expect(
    page.getByText("1 veterinarian acknowledgment(s) for this exact version.", {
      exact: true,
    }),
  ).toBeVisible();
  await prepare(page, true);
  await link(page, true);
  await expect(
    page.getByText("Report version 2 · corrected · current", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("No veterinarian acknowledgment for this version.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Record veterinarian acknowledgment for version 2",
      exact: true,
    }),
  ).toBeDisabled();
  expect(lab.ackCalls).toHaveLength(1);
  expect(lab.linkCalls[1].p_previous_report_id).toBe(lab.reports[0].id);
  expect(lab.ackCalls[0].p_expected_capture_hash).toBe(
    lab.reports[0].capture_hash,
  );
});
test("ADMIN registers only manual source identity; account change clears pending verification", async ({
  page,
}) => {
  const { lab } = await fixture(page, "ADMIN");
  await openResults(page);
  await page
    .getByText("Register a manual lab source account", { exact: true })
    .click();
  await page
    .getByLabel("Practice source account reference", { exact: true })
    .fill("Reviewed practice reference");
  await page
    .getByLabel("Source environment label", { exact: true })
    .fill("Manual portal reports");
  await page
    .getByLabel("Source identity review note", { exact: true })
    .fill("Nonsecret identifiers compared with original report");
  await page
    .getByLabel("I reviewed these nonsecret manual source identifiers.", {
      exact: true,
    })
    .check();
  await page
    .getByRole("button", {
      name: "Register reviewed manual source",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("option", { name: /Reviewed practice reference/ }),
  ).toHaveCount(1);
  expect(lab.sources[1].transport_enabled).toBe(false);
  await mapping(page);
  lab.failPrepareBefore = true;
  await prepare(page);
  await expect(
    page.getByRole("button", {
      name: "Retry original lab result request",
      exact: true,
    }),
  ).toBeEnabled();
  expect(
    await page.evaluate(() =>
      Object.keys(sessionStorage).some((k) =>
        k.startsWith("lab-result-intent:"),
      ),
    ),
  ).toBe(true);
  await page.getByRole("button", { name: /sign out/i }).click();
  await expect(
    page.getByRole("region", { name: "Lab report provenance" }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      Object.keys(sessionStorage).some((k) =>
        k.startsWith("lab-result-intent:"),
      ),
    ),
  ).toBe(false);
});
test("incomplete server receipt resumes after session intent cleanup without a new receipt or timestamp", async ({
  page,
}) => {
  const { lab } = await fixture(page);
  await openResults(page);
  await mapping(page);
  lab.failCapture = true;
  await prepare(page);
  await expect(
    page.getByRole("button", {
      name: "Retry original lab result request",
      exact: true,
    }),
  ).toBeEnabled();
  const originalRequest = lab.requests.find((r) => r.action === "prepare");
  expect(lab.receipts).toHaveLength(1);
  await page.evaluate(() => {
    for (const k of Object.keys(sessionStorage))
      if (k.startsWith("lab-result-intent:")) sessionStorage.removeItem(k);
  });
  lab.receipts[0].received_at = lab.receipts[0].received_at.replace(
    "Z",
    "000+00:00",
  );
  await page.reload();
  await page
    .getByRole("button", { name: "Open lab order", exact: true })
    .click();
  await page
    .getByLabel("Staged reports for this patient", { exact: true })
    .selectOption(lab.receipts[0].id);
  lab.failCapture = false;
  await page
    .getByRole("button", {
      name: "Resume original byte verification",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Download verified original report",
      exact: true,
    }),
  ).toBeEnabled();
  expect(lab.requests.filter((r) => r.action === "prepare")).toEqual([
    originalRequest,
    originalRequest,
  ]);
  expect(lab.receipts).toHaveLength(1);
  expect(lab.reports).toHaveLength(0);
});
