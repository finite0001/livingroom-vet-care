import { sourceLabels } from "../src/hub/features/record-releases/selection";
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
const mappingId = "44444444-4444-4444-8444-444444444444",
  documentId = "55555555-5555-4555-8555-555555555555",
  date = "2026-09-12T12:00:00.000Z";
const original = Buffer.from(
    "%PDF-1.4\nSynthetic medical history original\n%%EOF",
  ),
  digest = (v: string | Buffer) => createHash("sha256").update(v).digest("hex");
interface Row {
  // Synthetic transport rows intentionally cover multiple SQL tables.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}
const doc = (id = documentId) => ({
  id,
  pet_id: petId,
  version: 1,
  file_name:
    id === documentId
      ? "Original exported history.pdf"
      : "Replacement exported history.pdf",
  file_path: `${petId}/${id}.pdf`,
  file_size: original.length,
  mime_type: "application/pdf",
  status: "ready",
  category: "medical_record",
  visibility: "internal",
  created_by: staffId,
  created_at: date,
  source: "Manual",
  document_date: null,
  encounter_id: null,
});
function seed(
  id: string,
  docId = documentId,
  version = 1,
  previous: string | null = null,
) {
  const r = {
    id,
    actor_id: staffId,
    animal_link_id: mappingId,
    pet_id: petId,
    pet_version: 1,
    source_origin: "https://synthetic.ezyvet.test",
    source_site_uid: "reviewed-site",
    source_animal_id: "source-animal",
    document_id: docId,
    document_version: 1,
    mime_type: "application/pdf",
    file_size: original.length,
    export_reference: "export-1",
    received_at: date,
    previous_record_id: previous,
    review_reason: "Compared original export and patient identity",
    receipt_hash: digest(id + "receipt"),
    entry_method: "staff_reviewed_manual_export_v1",
    created_at: date,
  };
  const c = {
    receipt_id: id,
    actor_id: staffId,
    receipt_hash: r.receipt_hash,
    document_version: 1,
    content_sha256: digest(original),
    file_size: original.length,
    mime_type: "application/pdf",
    capture_hash: digest(id + "capture"),
    captured_at: date,
  };
  const v = {
    id: crypto.randomUUID(),
    actor_id: staffId,
    receipt_id: id,
    animal_link_id: mappingId,
    pet_id: petId,
    pet_version: 1,
    document_id: docId,
    document_version: 1,
    receipt_hash: r.receipt_hash,
    capture_hash: c.capture_hash,
    export_reference: "export-1",
    previous_record_id: previous,
    version,
    kind: previous ? "replacement" : "original",
    review_reason: r.review_reason,
    created_at: date,
  };
  return { receipt: r, capture: c, record: v };
}
async function fixture(page: Page, role = "ADMIN") {
  const state = {
    receipts: [] as Row[],
    captures: {} as Record<string, Row>,
    records: [] as Row[],
    acks: [] as Row[],
    calls: [] as { path: string; body: Row }[],
    failBefore: false,
    failCapture: false,
    failApproveAfter: false,
    rejectApprove: false,
    failAckAfter: false,
    failAckRecovery: false,
    petVersion: 1,
    sourceLoads: 0,
    onePerPage: false,
  };
  const expires = Math.floor(Date.now() / 1000) + 3600,
    payload = Buffer.from(
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
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin === "http://127.0.0.1:8080"
      ? route.continue()
      : route.abort(),
  );
  await page.route("http://127.0.0.1:54321/**", async (route) => {
    const url = new URL(route.request().url()),
      path = url.pathname;
    if (path === "/rest/v1/rpc/read_ezyvet_attachment_chart") return route.fulfill({json:{pet_id:petId,records:[],has_more:false,next_cursor:null}});
    if (path === "/rest/v1/rpc/list_record_release_sources_v8") {
      state.sourceLoads++;
      return route.fulfill({
        json: {
          pet_id: petId,
          client_id: clientId,
          client_name: "Synthetic family",
          email: "synthetic@example.test",
          phone: "+13035550100",
          policy_accepted: true,
          policy_v4_accepted: true,
          policy_v8_accepted: true,
          ...Object.fromEntries(Object.keys(sourceLabels).map((k) => [k, []])),
          has_more: Object.fromEntries(
            Object.keys(sourceLabels).map((k) => [k, false]),
          ),
          external_record_ids: state.records.map((r) => ({
            id: r.id,
            version: r.version,
            recorded_at: date,
            label: `Available export ${r.version}`,
            required_document_id: r.document_id,
            required_document_version: r.document_version,
            file_size: original.length,
            mime_type: "application/pdf",
            kind: r.kind,
            historical: true,
            source_label: "ezyVet",
            acknowledgment_count: state.acks.filter((a) => a.record_id === r.id)
              .length,
          })),
        },
      });
    }
    if (path === "/auth/v1/token") return route.fulfill({ json: session });
    if (path === "/auth/v1/user") return route.fulfill({ json: user });
    if (path === "/rest/v1/profiles")
      return route.fulfill({ json: [{ ...profile, role }] });
    if (path === "/rest/v1/user_roles")
      return route.fulfill({ json: [{ role }] });
    if (path === "/rest/v1/pets")
      return route.fulfill({
        json:
          url.searchParams.get("select") === "version"
            ? { version: state.petVersion }
            : [{ ...patient, version: state.petVersion }],
      });
    if (path === "/rest/v1/clients")
      return route.fulfill({
        json: { id: clientId, full_name: "Synthetic Household" },
      });
    if (path === "/rest/v1/patient_documents")
      return route.fulfill({
        json: [doc(), doc("77777777-7777-4777-8777-777777777777")],
      });
    if (path === "/rest/v1/ezyvet_record_links") {
      expect(role).toBe("ADMIN");
      expect(url.searchParams.get("pet_id")).toBe(`eq.${petId}`);
      expect(url.searchParams.get("resource")).toBe("eq.animal");
      return route.fulfill({
        json: [
          {
            id: mappingId,
            pet_id: petId,
            client_id: clientId,
            resource: "animal",
            source_origin: "https://synthetic.ezyvet.test",
            source_site_uid: "reviewed-site",
            external_id: "source-animal",
            approved_by: staffId,
            created_at: date,
            local_version: 1,
          },
        ],
      });
    }
    if (path.startsWith("/storage/v1/object/"))
      return route.fulfill({ body: original, contentType: "application/pdf" });
    const body =
      route.request().method() === "POST" ? route.request().postDataJSON() : {};
    if (path.startsWith("/rest/v1/rpc/") || path.startsWith("/functions/v1/"))
      state.calls.push({ path, body });
    const envelope = (id: string) => {
      const r = state.receipts.find((r) => r.id === id);
      return r
        ? {
            receipt: r,
            capture: state.captures[id] ?? null,
            record: state.records.find((v) => v.receipt_id === id) ?? null,
          }
        : null;
    };
    if (path === "/rest/v1/rpc/list_external_record_receipts") {
      expect(role).toBe("ADMIN");
      return route.fulfill({
        json: {
          pet_id: petId,
          has_more: false,
          receipts: state.receipts.map((r) => envelope(r.id)),
        },
      });
    }
    if (path === "/rest/v1/rpc/read_external_record_history") {
      let rows = [...state.records].reverse();
      const more = state.onePerPage && rows.length > 1 && !body.p_before_id;
      if (state.onePerPage)
        rows = body.p_before_id ? rows.slice(1) : rows.slice(0, 1);
      return route.fulfill({
        json: {
          pet_id: petId,
          has_more: more,
          records: rows.map((v) => {
            const r = state.receipts.find((r) => r.id === v.receipt_id)!;
            return {
              ...v,
              provider: "ezyVet",
              entry_method: r.entry_method,
              source_origin: r.source_origin,
              source_site_uid: r.source_site_uid,
              source_animal_id: r.source_animal_id,
              received_at: r.received_at,
              document_status: "ready",
              capture: state.captures[v.receipt_id],
              acknowledgments: state.acks.filter((a) => a.record_id === v.id),
            };
          }),
        },
      });
    }
    if (path === "/functions/v1/prepare-external-record") {
      expect(role).toBe("ADMIN");
      if (body.action === "recover")
        return route.fulfill({
          contentType: "application/json",
          json: envelope(body.p_receipt_id),
        });
      if (state.failBefore) {
        state.failBefore = false;
        return route.abort();
      }
      let r = state.receipts.find((r) => r.id === body.p_id);
      if (!r) {
        r = {
          ...seed(body.p_id, body.p_document_id).receipt,
          pet_version: body.p_expected_pet_version,
          document_version: body.p_document_version,
          export_reference: body.p_export_reference,
          received_at: body.p_received_at,
          previous_record_id: body.p_previous_record_id,
          review_reason: body.p_review_reason,
        };
        state.receipts.push(r);
      }
      if (state.failCapture)
        return route.fulfill({
          status: 202,
          json: {
            error: "Verification unconfirmed",
            receipt_id: r.id,
            retry_requires_recovery: true,
          },
        });
      state.captures[r.id] = {
        ...seed(r.id, r.document_id).capture,
        receipt_hash: r.receipt_hash,
      };
      return route.fulfill({ json: envelope(r.id) });
    }
    if (path === "/rest/v1/rpc/approve_external_record_import") {
      if (state.rejectApprove) {
        state.petVersion = 2;
        return route.fulfill({
          status: 409,
          json: { code: "40001", message: "Patient changed" },
        });
      }
      const r = state.receipts.find((r) => r.id === body.p_receipt_id)!,
        prior = state.records.find((v) => v.id === r.previous_record_id);
      const v = {
        id: body.p_id,
        actor_id: staffId,
        receipt_id: r.id,
        animal_link_id: r.animal_link_id,
        pet_id: petId,
        pet_version: r.pet_version,
        document_id: r.document_id,
        document_version: r.document_version,
        receipt_hash: r.receipt_hash,
        capture_hash: body.p_expected_capture_hash,
        export_reference: r.export_reference,
        previous_record_id: r.previous_record_id,
        version: prior ? prior.version + 1 : 1,
        kind: prior ? "replacement" : "original",
        review_reason: r.review_reason,
        created_at: date,
      };
      state.records.push(v);
      if (state.failApproveAfter) {
        state.failApproveAfter = false;
        return route.abort();
      }
      return route.fulfill({ json: v });
    }
    if (path === "/rest/v1/rpc/acknowledge_external_record") {
      expect(role).toBe("DVM");
      const a = {
        id: body.p_id,
        actor_id: staffId,
        record_id: body.p_record_id,
        capture_hash: body.p_expected_capture_hash,
        document_version: body.p_expected_document_version,
        created_at: date,
      };
      state.acks.push(a);
      if (state.failAckAfter) {
        state.failAckAfter = false;
        state.failAckRecovery = true;
        return route.abort();
      }
      return route.fulfill({ json: a });
    }
    if (path === "/rest/v1/rpc/recover_external_record_acknowledgment") {
      expect(role).toBe("DVM");
      if (state.failAckRecovery) {
        state.failAckRecovery = false;
        return route.abort();
      }
      return route.fulfill({
        contentType: "application/json",
        json: state.acks.find((a) => a.id === body.p_id) ?? null,
      });
    }
    return route.fulfill({ json: [] });
  });
  return state;
}
async function open(page: Page) {
  await page.goto(`/hub/patient/${petId}`);
  await expect(
    page.getByRole("button", {
      name: "Recover historical record work",
      exact: true,
    }),
  ).toBeEnabled({ timeout: 15_000 });
}
async function stage(page: Page) {
  await page
    .getByLabel("Approved ezyVet patient mapping", { exact: true })
    .selectOption(mappingId);
  await page
    .getByLabel("Ready private medical-record original", { exact: true })
    .selectOption(documentId);
  await page
    .getByLabel("Source export reference", { exact: true })
    .fill("export-1");
  await page
    .getByLabel("Original/replacement review reason", { exact: true })
    .fill("Compared source identity and original medical history");
  await page
    .getByRole("button", {
      name: "Verify historical original bytes",
      exact: true,
    })
    .click();
}
async function approve(page: Page) {
  await page
    .getByRole("button", {
      name: "Download verified historical original",
      exact: true,
    })
    .click();
  await page
    .getByLabel(/I reviewed the downloaded original, approved ezyVet identity/)
    .check();
  await page
    .getByRole("button", {
      name: "Approve historical original in patient chart",
      exact: true,
    })
    .click();
}
test("ADMIN recovers lost verification and approval with unchanged source intent and native data", async ({
  page,
}) => {
  const state = await fixture(page);
  await open(page);
  state.failBefore = true;
  await stage(page);
  await expect(
    page.getByRole("button", {
      name: "Retry original historical record request",
      exact: true,
    }),
  ).toBeEnabled();
  const initial = state.calls.find((c) => c.body.action === "prepare")!.body;
  expect(Object.keys(initial)).toHaveLength(10);
  expect(initial).not.toHaveProperty("p_content_sha256");
  await page.reload();
  await page
    .getByRole("button", {
      name: "Retry original historical record request",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Download verified historical original",
      exact: true,
    }),
  ).toBeEnabled();
  expect(
    state.calls.filter((c) => c.body.action === "prepare").map((c) => c.body),
  ).toEqual([initial, initial]);
  const sourceLoadsBeforeApproval = state.sourceLoads;
  state.failApproveAfter = true;
  await approve(page);
  await expect(
    page.getByRole("heading", {
      name: "export-1 · version 1 · original",
      exact: true,
    }),
  ).toBeVisible();
  await expect
    .poll(() => state.sourceLoads)
    .toBeGreaterThan(sourceLoadsBeforeApproval);
  await expect(
    page
      .getByRole("region", { name: "Patient medical-record releases" })
      .getByText("Available export 1", { exact: false }),
  ).toBeVisible();
  expect(state.records).toHaveLength(1);
  expect(
    state.calls.filter((c) =>
      c.path.endsWith("approve_external_record_import"),
    ),
  ).toHaveLength(1);
  await expect(
    page.getByRole("button", {
      name: "Acknowledge export-1 version 1",
      exact: true,
    }),
  ).toHaveCount(0);
  expect(
    state.calls.some((c) =>
      /save_patient|save_clinical|vaccine|billing/.test(c.path),
    ),
  ).toBe(false);
});
test("incomplete original resumes from server receipt after browser cleanup with exact timestamp", async ({
  page,
}) => {
  const state = await fixture(page);
  await open(page);
  state.failCapture = true;
  await stage(page);
  await expect(
    page.getByRole("button", {
      name: "Retry original historical record request",
      exact: true,
    }),
  ).toBeEnabled();
  const id = state.receipts[0].id;
  state.receipts[0].received_at = state.receipts[0].received_at.replace(
    "Z",
    "000+00:00",
  );
  await page.evaluate(() => {
    for (const k of Object.keys(sessionStorage))
      if (k.startsWith("external-record-intent:")) sessionStorage.removeItem(k);
  });
  await page.reload();
  await page
    .getByLabel("Your staged and approved export receipts", { exact: true })
    .selectOption(id);
  state.failCapture = false;
  await page
    .getByRole("button", {
      name: "Resume original export verification",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Download verified historical original",
      exact: true,
    }),
  ).toBeEnabled();
  const requests = state.calls.filter((c) => c.body.action === "prepare");
  expect(requests).toHaveLength(2);
  expect(requests[1].body.p_id).toBe(id);
  expect(requests[1].body.p_received_at).toBe(state.receipts[0].received_at);
  expect(state.receipts).toHaveLength(1);
});
test("DVM recovers an older-page acknowledgment without ADMIN receipts or carrying review to replacements", async ({
  page,
}) => {
  const state = await fixture(page, "DVM"),
    a = seed("66666666-6666-4666-8666-666666666666"),
    b = seed(
      "88888888-8888-4888-8888-888888888888",
      "77777777-7777-4777-8777-777777777777",
      2,
      a.record.id,
    );
  for (const v of [a, b]) {
    state.receipts.push(v.receipt);
    state.captures[v.receipt.id] = v.capture;
    state.records.push(v.record);
  }
  state.onePerPage = true;
  await open(page);
  await expect(
    page.getByRole("button", {
      name: "Verify historical original bytes",
      exact: true,
    }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Older historical originals", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Download export-1 version 1", exact: true })
    .click();
  await page
    .getByLabel(
      "I reviewed the clinical original for export-1, version 1. This acknowledgment applies only to this version.",
      { exact: true },
    )
    .check();
  state.failAckAfter = true;
  await page
    .getByRole("button", {
      name: "Acknowledge export-1 version 1",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Retry original historical record request",
      exact: true,
    }),
  ).toBeEnabled();
  await page.reload();
  await expect(
    page.getByText("The original veterinarian acknowledgment is saved.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("No veterinarian acknowledgment for this version.", {
      exact: true,
    }),
  ).toBeVisible();
  expect(state.acks).toHaveLength(1);
  expect(
    state.calls.filter((c) => c.path.endsWith("acknowledge_external_record")),
  ).toHaveLength(1);
  expect(
    state.calls.some((c) => c.path.endsWith("list_external_record_receipts")),
  ).toBe(false);
});
test("stale patient approval stays unconfirmed and signout clears local request", async ({
  page,
}) => {
  const state = await fixture(page);
  await open(page);
  await stage(page);
  state.rejectApprove = true;
  await approve(page);
  await expect(
    page.getByText(/The local patient changed since this receipt was staged/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Discard confirmed uncreated historical request",
      exact: true,
    }),
  ).toBeEnabled();
  expect(state.records).toHaveLength(0);
  expect(
    await page.evaluate(() =>
      Object.keys(sessionStorage).some((k) =>
        k.startsWith("external-record-intent:"),
      ),
    ),
  ).toBe(true);
  await page.getByRole("button", { name: /sign out/i }).click();
  await expect(
    page.getByRole("region", { name: "Historical external records" }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      Object.keys(sessionStorage).some((k) =>
        k.startsWith("external-record-intent:"),
      ),
    ),
  ).toBe(false);
});
test("replacement review freezes prior export identity and participates in the patient navigation guard", async ({
  page,
}) => {
  const state = await fixture(page),
    originalRecord = seed("99999999-9999-4999-8999-999999999999");
  state.receipts.push(originalRecord.receipt);
  state.captures[originalRecord.receipt.id] = originalRecord.capture;
  state.records.push(originalRecord.record);
  await open(page);
  await page
    .getByRole("button", {
      name: "Prepare replacement for export-1 version 1",
      exact: true,
    })
    .click();
  await expect(
    page.getByLabel("Approved ezyVet patient mapping", { exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByLabel("Source export reference", { exact: true }),
  ).toHaveValue("export-1");
  await page
    .getByRole("link", { name: "Synthetic Household", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Leave with unsaved changes?",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "Leave with unsaved changes?",
      exact: true,
    }),
  ).toHaveCount(0);
  await page
    .getByLabel("Ready private medical-record original", { exact: true })
    .selectOption("77777777-7777-4777-8777-777777777777");
  await page
    .getByLabel("Original/replacement review reason", { exact: true })
    .fill("Replacement export reviewed; original is retained");
  await expect(
    page.getByLabel("Original/replacement review reason", { exact: true }),
  ).toHaveValue("Replacement export reviewed; original is retained");
  await page
    .getByRole("button", {
      name: "Verify historical original bytes",
      exact: true,
    })
    .click();
  await approve(page);
  await expect(
    page.getByRole("heading", {
      name: "export-1 · version 2 · replacement",
      exact: true,
    }),
  ).toBeVisible();
  expect(state.records).toHaveLength(2);
  const prepared = state.calls.find((c) => c.body.action === "prepare")!.body;
  expect(prepared.p_previous_record_id).toBe(originalRecord.record.id);
  expect(prepared.p_animal_link_id).toBe(mappingId);
  expect(prepared.p_export_reference).toBe("export-1");
  expect(state.acks).toHaveLength(0);
});

test("DVM acknowledgment refreshes release source evidence without remounting the patient", async ({
  page,
}) => {
  const state = await fixture(page, "DVM");
  const original = seed("66666666-6666-4666-8666-666666666666");
  state.receipts.push(original.receipt);
  state.captures[original.receipt.id] = original.capture;
  state.records.push(original.record);
  await open(page);
  const releases = page.getByRole("region", {
    name: "Patient medical-record releases",
  });
  await expect(
    releases.getByText(/No DVM acknowledgment recorded for this exact version/),
  ).toBeVisible();
  const loads = state.sourceLoads;
  await page
    .getByRole("button", { name: "Download export-1 version 1", exact: true })
    .click();
  await page
    .getByLabel(
      "I reviewed the clinical original for export-1, version 1. This acknowledgment applies only to this version.",
      { exact: true },
    )
    .check();
  await page
    .getByRole("button", {
      name: "Acknowledge export-1 version 1",
      exact: true,
    })
    .click();
  await expect.poll(() => state.sourceLoads).toBeGreaterThan(loads);
  await expect(
    releases.getByText(/1 exact-version DVM acknowledgment\(s\)/),
  ).toBeVisible();
  expect(state.acks).toHaveLength(1);
});

function apiChartFixture(){
 const u=(n:number)=>`de790000-0000-4000-8000-${String(n).padStart(12,'0')}`,h='a'.repeat(64),content=Buffer.from('%PDF-1.4\nSynthetic reviewed API source\n%%EOF');
 const parent={animal_link_id:u(3),pet_id:petId,client_id:clientId,animal_external_id:'77',source_origin:'https://api.trial.ezyvet.com',source_site_uid:'chart-site',parent_type:'Animal',parent_external_id:'77',parent_snapshot_id:u(4),parent_payload_hash:h,parent_observed_head_version:1};
 const record={id:u(1),actor_id:u(2),request_id:u(5),pet_id:petId,animal_link_id:u(3),source_origin:parent.source_origin,source_site_uid:parent.source_site_uid,attachment_external_id:'701',request_hash:h,capture_hash:h,source_context:{schema_version:1,run_id:u(6),page:1,parent,attachment_snapshot_id:u(7),attachment_external_id:'701',attachment_payload_hash:h,attachment_observed_head_version:1},title:'Reviewed API source',review_reason:'Staff inspected the original',previous_record_id:null,version:1,entry_method:'staff_reviewed_api_attachment_v1',record_hash:h,created_at:'2026-09-13T12:00:00Z'};
 const capture={request_id:record.request_id,actor_id:record.actor_id,pet_id:petId,intent_hash:h,capture_hash:h,storage_object_id:u(8),bucket:'ezyvet-attachments',object_path:`${record.actor_id}/${petId}/${record.request_id}/${u(9)}/original`,content_sha256:createHash('sha256').update(content).digest('hex'),file_size:content.length,mime_type:'application/pdf',captured_at:'2026-09-13T12:00:00Z'};
 return {record,capture,content,page:{pet_id:petId,records:[{record,is_latest:true,source_current:false}],has_more:false,next_cursor:null}};
}
test('DVM chart shows reviewed API provenance and verifies the approved private original',async({page})=>{
 await fixture(page,'DVM');const data=apiChartFixture();
 await page.route('**/rest/v1/rpc/read_ezyvet_attachment_chart',r=>r.fulfill({json:data.page}));
 await page.route('**/rest/v1/rpc/get_ezyvet_attachment_chart_original',r=>r.fulfill({json:{record:data.record,capture:data.capture}}));
 await page.route('**/storage/v1/object/ezyvet-attachments/**',r=>r.fulfill({contentType:'application/pdf',body:data.content}));
 await page.goto(`/hub/patient/${petId}`);const chart=page.getByRole('region',{name:'Reviewed API attachments'});
 await expect(chart.getByText('Reviewed API source · Version 1',{exact:true})).toBeVisible();await expect(chart.getByText('Source changed or is unavailable. Review required.',{exact:true})).toBeVisible();await chart.getByRole('button',{name:'Verify original for version 1',exact:true}).click();await expect(chart.getByRole('link',{name:'Download reviewed original',exact:true})).toHaveAttribute('href',/^blob:/);
});
test('chart rejects wrong-patient records and corrupted approved originals',async({page})=>{
 await fixture(page,'DVM');const data=apiChartFixture();let wrong=true;
 await page.route('**/rest/v1/rpc/read_ezyvet_attachment_chart',r=>r.fulfill({json:{...data.page,pet_id:wrong?staffId:petId}}));
 await page.route('**/rest/v1/rpc/get_ezyvet_attachment_chart_original',r=>r.fulfill({json:{record:data.record,capture:data.capture}}));
 await page.route('**/storage/v1/object/ezyvet-attachments/**',r=>r.fulfill({contentType:'application/pdf',body:Buffer.alloc(data.content.length)}));
 await page.goto(`/hub/patient/${petId}`);const chart=page.getByRole('region',{name:'Reviewed API attachments'});await expect(chart.getByText('Reviewed attachment history could not be verified.',{exact:true})).toBeVisible();wrong=false;await chart.getByRole('button',{name:'Recheck reviewed attachments',exact:true}).click();await chart.getByRole('button',{name:'Verify original for version 1',exact:true}).click();await expect(chart.getByText('The reviewed original could not be verified. No download is available.',{exact:true})).toBeVisible();await expect(chart.getByRole('link',{name:'Download reviewed original',exact:true})).toHaveCount(0);
});
