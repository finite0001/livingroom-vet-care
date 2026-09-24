import { seedReviewedPrescription } from "./prescription-runtime-fixture.ts";
import { renderRecordRelease } from "../../supabase/functions/_shared/record-release-renderer.ts";
/** Actual source artifact Auth/Storage/PostgREST; disposable local project only. */
import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import {
  buildReleaseEmailPayload,
  sha256Hex,
} from "../../supabase/functions/_shared/release-email-payload.ts";
import { buildDocumentLinkArtifacts } from "../../supabase/functions/_shared/document-link-artifacts.ts";
import {
  documentLinkConfig,
  materializeDocumentLink,
} from "../../supabase/functions/_shared/document-link-capability.ts";
import { createStaffDocumentLinkHandler } from "../../supabase/functions/_shared/document-link-http.ts";
import { createPrepareReleaseEmailHandler } from "../../supabase/functions/_shared/prepare-release-email.ts";
const project = process.env.PAYMENT_TEST_PROJECT;
assert.ok(
  project,
  "Run source-disposable.py; an owned disposable project is required",
);
const projectId = readFileSync(`${project}/supabase/config.toml`, "utf8").match(
  /^project_id\s*=\s*"([a-zA-Z0-9_-]+)"/m,
)?.[1];
assert.ok(
  projectId && /^lrv-source-artifacts-[a-f0-9]{12}$/.test(projectId),
  "Refuse policy fixtures outside an owned disposable source-artifact project",
);
const inspected = JSON.parse(
  execFileSync("docker", ["inspect", `supabase_db_${projectId}`], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }),
);
const labels = inspected[0]?.Config?.Labels;
assert.equal(
  labels?.["com.supabase.cli.project"],
  projectId,
  "Disposable Docker project must match",
);
assert.equal(
  realpathSync(labels?.["com.supabase.cli.workdir"]),
  realpathSync(project),
  "Disposable Docker workdir must match",
);
const local = JSON.parse(
  execFileSync(
    "supabase",
    ["status", "--workdir", project, "--output", "json"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ),
);
assert.match(local.API_URL, /^http:\/\/127\.0\.0\.1:\d+$/);
const sql = (query: string) =>
  execFileSync("docker", [
    "exec",
    "-i",
    `supabase_db_${projectId}`,
    "psql",
    "-U",
    "postgres",
    "-d",
    "postgres",
    "-X",
    "-q",
    "-t",
    "-A",
    "-v",
    "ON_ERROR_STOP=1",
  ], { input: query, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] })
    .trim();
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;

const ids: string[] = [];
let actor = "", client = "";
let assertions = 0;
const failures: unknown[] = [];
const check = (value: unknown, message: string) => {
  assert.ok(value, message);
  assertions++;
};
const serviceHeaders = {
  apikey: local.ANON_KEY,
  Authorization: `Bearer ${local.SERVICE_ROLE_KEY}`,
  "Content-Type": "application/json",
};
let staffHeaders: Record<string, string> = {};
async function api(
  path: string,
  args: unknown,
  headers: Record<string, string> = serviceHeaders,
) {
  const response = await fetch(local.API_URL + path, {
    method: "POST",
    headers,
    body: JSON.stringify(args),
  });
  if (!response.ok) {
    const failure = await response.json().catch(() => null);
    const code =
      typeof failure?.code === "string" && /^[A-Z0-9]{5}$/.test(failure.code)
        ? failure.code
        : "unknown";
    throw new Error(
      `Local fixture ${path} failed: HTTP ${response.status}, SQL ${code}`,
    );
  }
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}
const rpc = (name: string, args: Record<string, unknown>, staff = false) =>
  api("/rest/v1/rpc/" + name, args, staff ? staffHeaders : serviceHeaders);

const service = createClient(local.API_URL, local.SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const priorPolicy = sql(
  "select coalesce((select to_jsonb(p)::text from public.record_release_policy p where id),'null');",
);
let storagePath = "", reads = 0;
const sender = { from: "care@example.test", replyTo: "care@example.test" };
const download = async (bucket: string, path: string, size: number) => {
  assert.equal(bucket, "patient-documents");
  assert.equal(path, storagePath);
  reads++;
  const response = await fetch(
    `${local.API_URL}/storage/v1/object/authenticated/${bucket}/${path}`,
    { headers: serviceHeaders, redirect: "error" },
  );
  if (!response.ok) throw new Error("Synthetic private download failed");
  const bytes = new Uint8Array(await response.arrayBuffer());
  assert.equal(bytes.length, size);
  return bytes;
};
try {
  check(
    sql(
      "select count(*) from public.communication_outbox where state in ('pending','claimed');",
    ) === "0",
    "No unrelated claimable work before synthetic capture test",
  );
  const email = `source-release-${randomUUID()}@example.test`,
    password = `Synthetic-${randomUUID()}-Aa1!`;
  actor = (await api("/auth/v1/admin/users", {
    email,
    password,
    email_confirm: true,
  })).id;
  // A1 (#164): handle_new_user no longer activates a new auth user, so a fixture
  // that needs an active synthetic staff member must activate it explicitly.
  sql(`insert into public.user_roles(user_id,role) values(${quote(actor)},'STAFF') on conflict do nothing; update public.profiles set is_active=true where id=${quote(actor)};`);
  ids.push(actor);
  const auth = await api("/auth/v1/token?grant_type=password", {
    email,
    password,
  }, { apikey: local.ANON_KEY, "Content-Type": "application/json" });
  staffHeaders = {
    apikey: local.ANON_KEY,
    Authorization: `Bearer ${auth.access_token}`,
    "Content-Type": "application/json",
  };
  sql(
    `insert into public.user_roles(user_id,role) values(${
      quote(actor)
    },'ADMIN'),(${quote(actor)},'DVM') on conflict do nothing;`,
  );
  const staff = (name: string, args: Record<string, unknown>) =>
    rpc(name, args, true);
  client = (await staff("save_client", {
    p_actor_id: actor,
    p_client_id: null,
    p_expected_version: null,
    p_first_name: "Synthetic",
    p_last_name: "Source Release",
    p_primary_phone: "+13035550481",
    p_primary_email: email,
    p_preferred_channel: "EMAIL",
    p_mailing_address: null,
    p_housecall_address: null,
  })).id;
  ids.push(client);
  const pet = (await staff("save_patient", {
    p_id: null,
    p_client_id: client,
    p_expected_version: null,
    p_name: "Synthetic source patient",
    p_species: "Dog",
    p_breed: null,
    p_dob: null,
    p_birth_date_precision: "unknown",
    p_color: null,
    p_sex: "unknown",
    p_neuter_status: "unknown",
    p_microchip_id: null,
    p_archived_at: null,
    p_deceased_at: null,
  })).id;
  ids.push(pet);
  const document = randomUUID(),
    source = randomUUID(),
    receipt = randomUUID(),
    order = randomUUID(),
    sourceReview = randomUUID(),
    report = randomUUID(),
    conversation = randomUUID();
  ids.push(
    document,
    source,
    receipt,
    order,
    sourceReview,
    report,
    conversation,
  );
  sql(
    `insert into public.conversations(id,client_id) values(${
      quote(conversation)
    },${quote(client)});`,
  );
  await staff("record_sms_consent", {
    p_actor_id: actor,
    p_client_id: client,
    p_phone: "+13035550481",
    p_opted_in: true,
    p_method: "WRITTEN",
    p_details: "Synthetic consent only",
    p_expected_updated_at: null,
  });
  const bytes = new TextEncoder().encode(
    "%PDF-1.7\nSynthetic captured lab original\n%%EOF",
  );
  const doc = await staff("prepare_patient_document", {
    p_id: document,
    p_pet_id: pet,
    p_encounter_id: null,
    p_file_name: "synthetic-source.pdf",
    p_mime_type: "application/pdf",
    p_file_size: bytes.length,
    p_category: "medical_record",
    p_source: "Synthetic test",
    p_document_date: null,
    p_visibility: "client_shareable",
  });
  storagePath = doc.file_path;
  const upload = await fetch(
    `${local.API_URL}/storage/v1/object/patient-documents/${storagePath}`,
    {
      method: "POST",
      headers: {
        apikey: local.ANON_KEY,
        Authorization: staffHeaders.Authorization,
        "Content-Type": "application/pdf",
        "x-upsert": "false",
      },
      body: bytes,
    },
  );
  check(upload.ok, "Real private original uploaded");
  const ready = await staff("finalize_patient_document", { p_id: document });
  await staff("review_lab_source_account", {
    p_id: source,
    p_provider_label: "Synthetic manual lab",
    p_account_reference: "Synthetic account",
    p_environment_label: "Local test",
    p_review_note: "Synthetic only",
  });
  const staged = await staff("stage_lab_report_receipt", {
    p_id: receipt,
    p_source_account_id: source,
    p_document_id: document,
    p_document_version: ready.version,
    p_source_patient_reference: "synthetic-patient",
    p_source_order_reference: "synthetic-order",
    p_source_report_reference: "synthetic-report",
    p_received_at: new Date(Date.now() - 1000).toISOString(),
  });
  const captured = await rpc("capture_lab_report_bytes", {
    p_receipt_id: receipt,
    p_actor_id: actor,
    p_expected_receipt_hash: staged.receipt_hash,
    p_document_version: ready.version,
    p_content_sha256: await sha256Hex(
      await download("patient-documents", storagePath, bytes.length),
    ),
    p_file_size: bytes.length,
    p_mime_type: "application/pdf",
  });
  const lab = await staff("save_patient_lab_order", {
    p_id: order,
    p_pet_id: pet,
    p_expected_version: null,
    p_values: {
      test_name: "Synthetic lab",
      status: "ordered",
      due_date: "2026-09-13",
    },
    p_correction_reason: "",
  });
  await staff("review_lab_order_source", {
    p_id: sourceReview,
    p_order_id: order,
    p_pet_id: pet,
    p_expected_order_version: lab.version,
    p_source_account_id: source,
    p_source_patient_reference: "synthetic-patient",
    p_source_order_reference: "synthetic-order",
    p_previous_review_id: null,
    p_review_reason: "Synthetic source mapping",
    p_attest: true,
  });
  await staff("link_lab_report_version", {
    p_id: report,
    p_receipt_id: receipt,
    p_expected_receipt_hash: staged.receipt_hash,
    p_expected_capture_hash: captured.capture_hash,
    p_order_id: order,
    p_pet_id: pet,
    p_expected_order_version: lab.version,
    p_source_review_id: sourceReview,
    p_previous_report_id: null,
    p_kind: "original",
    p_review_reason: "Synthetic explicit original review",
    p_attest: true,
  });
  // One original can legitimately back both a local lab report and an
  // explicitly approved imported record. Both frozen proofs must survive dedup.
  const externalSnapshot = randomUUID(),
    animalLink = randomUUID(),
    externalReceipt = randomUUID(),
    externalRecord = randomUUID(),
    mappingRequest = randomUUID(),
    site = `synthetic-${randomUUID()}`;
  ids.push(
    externalSnapshot,
    animalLink,
    externalReceipt,
    externalRecord,
    mappingRequest,
  );
  sql(
    `insert into public.ezyvet_import_snapshots(id,source_origin,source_site_uid,resource,external_id,payload,payload_hash,first_seen_by) values(${
      quote(externalSnapshot)
    },'https://api.trial.ezyvet.com',${
      quote(site)
    },'animal','77','{"id":77,"contact_id":8}','synthetic-hash',${
      quote(actor)
    });
    insert into public.ezyvet_record_links(id,request_id,request_hash,source_origin,source_site_uid,resource,external_id,snapshot_id,head_version,client_id,pet_id,local_version,action,reason,approved_by) values(${
      quote(animalLink)
    },${
      quote(mappingRequest)
    },'synthetic-link','https://api.trial.ezyvet.com',${
      quote(site)
    },'animal','77',${quote(externalSnapshot)},1,${quote(client)},${
      quote(pet)
    },1,'link','SYNTHETIC TEST ONLY',${quote(actor)});`,
  );
  const externalStaged = await staff("stage_external_record_receipt", {
    p_id: externalReceipt,
    p_animal_link_id: animalLink,
    p_expected_pet_version: 1,
    p_document_id: document,
    p_document_version: ready.version,
    p_export_reference: "Synthetic manually reviewed export",
    p_received_at: new Date(Date.now() - 1000).toISOString(),
    p_previous_record_id: null,
    p_review_reason: "Synthetic explicit mapping and original review",
  });
  const externalCaptured = await rpc("capture_external_record_bytes", {
    p_receipt_id: externalReceipt,
    p_actor_id: actor,
    p_expected_receipt_hash: externalStaged.receipt_hash,
    p_document_version: ready.version,
    p_content_sha256: await sha256Hex(
      await download("patient-documents", storagePath, bytes.length),
    ),
    p_file_size: bytes.length,
    p_mime_type: "application/pdf",
  });
  const externalApproved = await staff("approve_external_record_import", {
    p_id: externalRecord,
    p_receipt_id: externalReceipt,
    p_expected_receipt_hash: externalStaged.receipt_hash,
    p_expected_capture_hash: externalCaptured.capture_hash,
    p_attest: true,
  });
  check(
    externalApproved.id === externalRecord &&
      externalApproved.animal_link_id === animalLink,
    "Actual external stage, private-byte capture and separate approval bind the reviewed source mapping",
  );
  const historyRun = randomUUID(),
    historyApproval = randomUUID(),
    extractionId = randomUUID();
  ids.push(historyRun, historyApproval, extractionId);
  async function stageHistory(runId: string, comments: string) {
    const run = await rpc("claim_ezyvet_clinical_import", {
      p_id: runId,
      p_actor: actor,
      p_site_uid: site,
      p_source_origin: "https://api.trial.ezyvet.com",
      p_resource: "history",
      p_animal_link_id: animalLink,
    });
    await rpc("stage_ezyvet_import_page", {
      p_id: runId,
      p_actor: actor,
      p_lease_id: run.lease_id,
      p_page: 1,
      p_complete: true,
      p_items: [{
        external_id: "301",
        payload: {
          id: "301",
          animal_id: "77",
          comments,
          history_system: "opaque",
          chain: "unknown",
          timestamp: null,
          vet_id: "outside-clinician",
          active: "true",
          consult_id: null,
        },
      }],
    });
    const listed = await staff("list_ezyvet_clinical_candidates", {
      p_animal_link_id: animalLink,
      p_resource: "history",
      p_before_at: null,
      p_before_id: null,
      p_limit: 20,
    });
    for (const candidate of listed.candidates) {
      if (!ids.includes(candidate.id)) ids.push(candidate.id);
    }
    return listed.candidates.find((candidate: { is_current: boolean }) =>
      candidate.is_current
    );
  }
  async function approveHistory(
    id: string,
    candidate: { id: string; payload_hash: string; head_version: number },
  ) {
    const intent = {
      animal_link_id: animalLink,
      snapshot_id: candidate.id,
      payload_hash: candidate.payload_hash,
      observed_head_version: candidate.head_version,
      patient_version: 1,
      consult_mode: "not_referenced",
      consult_snapshot_id: null,
      consult_payload_hash: null,
      consult_head_version: null,
      reason: "Synthetic explicit source review",
    };
    const prepared = await staff("prepare_ezyvet_history_approval", {
      p_id: id,
      p_pet_id: pet,
      p_payload: intent,
    });
    return staff("approve_ezyvet_history", {
      p_id: id,
      p_pet_id: pet,
      p_expected_hash: prepared.request.request_hash,
      p_confirmed: true,
    });
  }
  const sourceHistory = await stageHistory(
    historyRun,
    "Synthetic outside reaction history <script>unsafe()</script>",
  );
  const approvedHistory = await approveHistory(historyApproval, sourceHistory);
  check(
    approvedHistory.receipt.id === historyApproval &&
      approvedHistory.receipt.original.timestamp === null,
    "Actual administrator approval preserves outside history and unknown source date",
  );
  const beforeAlert = await staff("read_patient_treatment_alerts", {
    p_pet_id: pet,
  });
  const extractionPayload = {
    sources: [{
      id: historyApproval,
      version_hash: approvedHistory.receipt.version_hash,
    }],
    patient_version: 1,
    action: "create",
    problem_id: null,
    problem_version: null,
    fields: {
      title: "Synthetic reviewed vaccine reaction",
      notes: "DVM explicitly reviewed outside source",
      onset_date: null,
      status: "active",
      importance: "high",
    },
    duplicate_decision: "distinct_finding",
    reason: "Synthetic explicit local clinical decision",
  };
  const extractionPrepared = await staff("prepare_ezyvet_problem_extraction", {
    p_id: extractionId,
    p_pet_id: pet,
    p_payload: extractionPayload,
  });
  const extractionApproved = await staff("approve_ezyvet_problem_extraction", {
    p_id: extractionId,
    p_pet_id: pet,
    p_expected_hash: extractionPrepared.request.request_hash,
    p_confirmed: true,
  });
  const problemId = extractionApproved.receipt.problem_id;
  ids.push(problemId);
  const extractionRecovered = await staff("recover_ezyvet_history_request", {
    p_id: extractionId,
    p_pet_id: pet,
    p_kind: "problem_extraction",
  });
  check(
    extractionRecovered.receipt.problem_id === problemId,
    "Lost local approval response recovers the one exact native problem",
  );
  const repeatedExtraction = await staff("approve_ezyvet_problem_extraction", {
    p_id: extractionId,
    p_pet_id: pet,
    p_expected_hash: extractionPrepared.request.request_hash,
    p_confirmed: true,
  });
  check(
    repeatedExtraction.receipt.problem_id === problemId,
    "Exact repeated clinical approval returns the original problem without a duplicate",
  );
  const afterAlert = await staff("read_patient_treatment_alerts", {
    p_pet_id: pet,
  });
  check(
    afterAlert.source_hash !== beforeAlert.source_hash &&
      afterAlert.snapshot.important_problems.some((p: { id: string }) =>
        p.id === problemId
      ),
    "Explicit DVM high-importance extraction appears in live treatment alert review",
  );
  const editedProblem = await staff("save_patient_problem", {
    p_id: problemId,
    p_pet_id: pet,
    p_expected_version: extractionApproved.receipt.problem_version,
    p_title: "Synthetic reviewed vaccine reaction",
    p_notes: "Subsequent local edit keeps original extraction evidence",
    p_onset_date: null,
    p_status: "active",
    p_importance: "high",
  });
  const consultRun = randomUUID(),
    vaccinationRun = randomUUID(),
    vaccinationReview = randomUUID();
  ids.push(consultRun, vaccinationRun, vaccinationReview);
  const consultLease = await rpc("claim_ezyvet_clinical_import", {
    p_id: consultRun,
    p_actor: actor,
    p_site_uid: site,
    p_resource: "consult",
    p_source_origin: "https://api.trial.ezyvet.com",
    p_animal_link_id: animalLink,
  });
  await rpc("stage_ezyvet_import_page", {
    p_id: consultRun,
    p_actor: actor,
    p_lease_id: consultLease.lease_id,
    p_page: 1,
    p_complete: true,
    p_items: [{ external_id: "901", payload: { id: 901, animal_id: 77 } }],
  });
  const consultCandidate = (await staff("list_ezyvet_clinical_candidates", {
    p_animal_link_id: animalLink,
    p_resource: "consult",
    p_limit: 20,
  })).candidates.find((c: { external_id: string; is_current: boolean }) =>
    c.external_id === "901" && c.is_current
  );
  ids.push(consultCandidate.id);
  const vaccinationLease = await rpc("claim_ezyvet_vaccination_import", {
    p_id: vaccinationRun,
    p_actor: actor,
    p_site_uid: site,
    p_resource: "vaccination",
    p_source_origin: "https://api.trial.ezyvet.com",
    p_animal_link_id: animalLink,
    p_consult_snapshot_id: consultCandidate.id,
    p_consult_payload_hash: consultCandidate.payload_hash,
    p_consult_observed_head_version: consultCandidate.head_version,
  });
  await rpc("stage_ezyvet_import_page", {
    p_id: vaccinationRun,
    p_actor: actor,
    p_lease_id: vaccinationLease.lease_id,
    p_page: 1,
    p_complete: true,
    p_items: [{
      external_id: "902",
      payload: {
        id: "902",
        consult_id: "901",
        description: "Synthetic outside vaccine <script>raw()</script>",
        date_of_administration: "ambiguous",
        date_of_next_administration: null,
        active: "unknown",
        qty: "1",
      },
    }],
  });
  const vaccinationCandidate =
    (await staff("list_ezyvet_vaccination_review_candidates", {
      p_pet_id: pet,
      p_animal_link_id: animalLink,
      p_limit: 20,
    })).candidates.find((c: { external_id: string }) =>
      c.external_id === "902"
    );
  ids.push(vaccinationCandidate.id);
  const vaccinePayload = {
    animal_link_id: animalLink,
    patient_version: 1,
    snapshot_id: vaccinationCandidate.id,
    payload_hash: vaccinationCandidate.payload_hash,
    observed_head_version: vaccinationCandidate.head_version,
    consult_snapshot_id: consultCandidate.id,
    consult_payload_hash: consultCandidate.payload_hash,
    consult_observed_head_version: consultCandidate.head_version,
    product_id: null,
    product_version: null,
    administered_on: null,
    administration_date_status: "uninterpreted",
    source_next_due_on: null,
    next_date_status: "unknown",
    status: "unknown",
    outside_author: null,
    reason: "Synthetic DVM review retains unknown source meanings",
    replaces_id: null,
    expected_predecessor_hash: null,
  };
  const vaccinePrepared = await staff("prepare_ezyvet_vaccination_review", {
    p_id: vaccinationReview,
    p_pet_id: pet,
    p_payload: vaccinePayload,
  });
  const vaccineApproved = await staff("approve_ezyvet_vaccination_review", {
    p_id: vaccinationReview,
    p_pet_id: pet,
    p_expected_hash: vaccinePrepared.request.request_hash,
    p_confirmed: true,
  });
  ids.push(vaccineApproved.receipt.id);
  check(
    vaccineApproved.receipt.reviewed.administered_on === null &&
      vaccineApproved.receipt.original.date_of_administration === "ambiguous",
    "Actual DVM vaccination review preserves unknown date and raw evidence",
  );
  const prescriptionFixture = await seedReviewedPrescription({ actor, pet, site, animalLink, ids, rpc, staff });
  const prescription = prescriptionFixture.approved.receipt;
  check(prescription.context.reviewed.completeness === "partial" &&
    prescription.context.reconciliation.missingIds.includes("905") &&
    prescription.items[0].source.original.qty === "outside units",
    "Actual DVM prescription approval preserves raw quantity and missing-item disclosure");
  sql(
    `select set_config('request.jwt.claims',${
      quote(JSON.stringify({ sub: actor, role: "authenticated" }))
    },false);insert into public.record_release_policy(id,enabled,accepted_by,accepted_at,acceptance_reference,accepted_schema_version) values(true,true,${
      quote(actor)
    },now(),'Synthetic test policy only',8) on conflict(id) do update set enabled=true,accepted_by=excluded.accepted_by,accepted_schema_version=8,accepted_at=now();`,
  );
  const prescriptionOnly = await staff("preview_record_release_v8", {
    p_pet_id: pet, p_client_id: client, p_channel: "EMAIL", p_recipient: email,
    p_selection: { imported_prescription_ids: [prescription.id] },
  });
  check(renderRecordRelease({ preview: prescriptionOnly }).includes("Source item 905 was not observed"),
    "Actual prescription-only schema8 snapshot passes inherited renderer validation");
  const selection = {
    imported_prescription_ids: [prescription.id],
    imported_vaccination_ids: [vaccineApproved.receipt.id],
    document_ids: [document],
    lab_report_ids: [report],
    external_record_ids: [externalRecord],
    imported_history_ids: [historyApproval],
    problem_ids: [problemId],
  };
  async function release(channel: "EMAIL" | "SMS") {
    const args = {
      p_pet_id: pet,
      p_client_id: client,
      p_channel: channel,
      p_recipient: channel === "EMAIL" ? email : "+13035550481",
      p_selection: selection,
    };
    const preview = await staff("preview_record_release_v8", args);
    const id = randomUUID();
    ids.push(id);
    await staff("confirm_record_release", {
      ...args,
      p_id: id,
      p_reviewed_snapshot: preview.snapshot,
      p_reviewed_hash: preview.source_hash,
      p_attest_review: true,
    });
    return staff("read_record_release", { p_id: id });
  }
  const e = await release("EMAIL"), s = await release("SMS");
  check(
    e.release.snapshot.attachments[0].content_sha256 ===
        captured.content_sha256 &&
      e.release.snapshot.lab_reports[0].capture_hash === captured.capture_hash,
    "Actual schema8 snapshot binds selected original to immutable lab capture",
  );
  check(
    [e, s].every((value) => {
      const snapshot = value.release.snapshot;
      const external = snapshot.external_records[0];
      const attachment = snapshot.attachments[0];
      return snapshot.attachments.length === 1 &&
        snapshot.external_records.length === 1 &&
        external.id === externalRecord &&
        external.capture_hash === externalCaptured.capture_hash &&
        external.receipt_hash === externalStaged.receipt_hash &&
        external.animal_link_id === animalLink &&
        external.content_sha256 === captured.content_sha256 &&
        attachment.provenance_captures.length === 2 &&
        attachment.provenance_captures.some((
          proof: { family: string; capture_hash: string },
        ) =>
          proof.family === "external_record" &&
          proof.capture_hash === externalCaptured.capture_hash
        );
    }),
    "Both real schema8 release projections retain external and lab proof on one deduplicated private original",
  );
  check(
    e.release.snapshot.imported_histories[0].id === historyApproval &&
      e.release.snapshot.problem_source_extractions[0].problem_id ===
        problemId &&
      e.release.snapshot.problem_source_extractions[0].locally_edited,
    "Real schema8 projection connects imported history, native problem and preserved original extraction",
  );
  check(e.release.snapshot.imported_prescriptions[0].id === prescription.id &&
    e.release.snapshot.imported_prescriptions[0].context.reconciliation.missingIds.includes("905"),
    "Actual schema8 selection includes the approved partial prescription and missing identity");
  const rendered = renderRecordRelease({ preview: e.release });
  check(rendered.includes("outside units") &&
    rendered.includes("Source item 905 was not observed") &&
    rendered.includes("&lt;script&gt;outside prescription prose&lt;/script&gt;"),
    "Actual prescription release renders escaped originals and explicit partial disclosure");
  check(
    rendered.includes("outside-clinician") &&
      rendered.includes("Local DVM decision") &&
      rendered.includes("subsequently edited") &&
      rendered.includes("&lt;script&gt;unsafe()&lt;/script&gt;"),
    "Actual frozen projection renders outside attribution, local edits and escaped narrative",
  );
  const requestId = randomUUID();
  ids.push(requestId);
  const emailArgs = {
    p_request_id: requestId,
    p_release_id: e.release.id,
    p_conversation_id: conversation,
    p_subject: "Synthetic selected originals",
    p_body: "Synthetic reviewed records",
    p_release_hash: e.release.source_hash,
  };
  const prepared = await staff("prepare_release_email", emailArgs);
  const frozen = await buildReleaseEmailPayload(
    prepared.request,
    e,
    sender,
    download,
  );
  const actualEmailHtml = Buffer.from(
    JSON.parse(frozen.payload_text).attachments[0].content,
    "base64",
  ).toString();
  const actualPrint = renderRecordRelease({
    preview: e.release,
    confirmed: {
      id: e.release.id,
      created_at: e.release.created_at,
      created_by: e.release.created_by,
      eligible: true,
      events: [],
      ineligibility_reason: null,
    },
  });
  check(
    actualEmailHtml === actualPrint &&
      actualEmailHtml.includes(
        "Clinician-reviewed outside vaccination history",
      ) && actualEmailHtml.includes("ambiguous") &&
      actualEmailHtml.includes("Imported outside history"),
    "Actual email HTML equals print and retains both raw vaccine meaning and outside narrative",
  );
  const altered = bytes.slice();
  altered[altered.length - 1] ^= 1;
  const alteredEmail = JSON.parse(frozen.payload_text);
  alteredEmail.attachments[1].content = Buffer.from(altered).toString("base64");
  await assert.rejects(
    rpc("capture_release_email_payload", {
      p_request_id: requestId,
      p_actor_id: actor,
      p_payload_text: JSON.stringify(alteredEmail),
    }),
    /SQL 23514/,
  );
  check(true, "Actual email SQL capture rejects same-length altered PDF");
  check(
    sql(
      `select count(*) from public.release_email_payloads where request_id=${
        quote(requestId)
      };`,
    ) === "0",
    "Rejected bytes create no email payload",
  );
  await rpc("capture_release_email_payload", {
    p_request_id: requestId,
    p_actor_id: actor,
    p_payload_text: frozen.payload_text,
  });
  const emailSaved = await staff("recover_release_email", {
    p_release_id: e.release.id,
    p_request_id: requestId,
  });
  check(
    emailSaved.manifest[1].sha256 === captured.content_sha256,
    "Email SQL manifest confirms exact original digest",
  );
  const linkId = randomUUID();
  ids.push(linkId);
  const previewLink = await staff("preview_document_link", {
    p_family: "record_release",
    p_source_id: s.release.id,
    p_client_id: client,
  });
  const linkArgs = {
    p_request_id: linkId,
    p_family: "record_release",
    p_source_id: s.release.id,
    p_client_id: client,
    p_conversation_id: conversation,
    p_recipient: "+13035550481",
    p_source_hash: previewLink.source_hash,
    p_expires_at: new Date(Date.now() + 86400000).toISOString(),
    p_message_template: "Synthetic records: {{document_link}}",
    p_origin: "https://thelivingroom.vet",
    p_key_version: "synthetic",
  };
  await staff("prepare_document_link", linkArgs);
  const context = await rpc("document_link_capture_context", {
    p_id: linkId,
    p_actor_id: actor,
  });
  const config = documentLinkConfig({
    origin: "https://thelivingroom.vet",
    activeKeyVersion: "synthetic",
    keys: JSON.stringify({
      synthetic: Buffer.from("synthetic-local-secret-00000000000").toString(
        "base64",
      ),
    }),
    publicEnabled: "true",
  });
  const capability = await materializeDocumentLink(context.grant, config);
  const artifacts = await buildDocumentLinkArtifacts(context.grant, {
    name: "Synthetic",
    address: "Synthetic",
    domain: null,
  }, download);
  const smsReport = JSON.parse(artifacts.payload_text).artifacts[0];
  const smsHtml = Buffer.from(smsReport.content, "base64").toString();
  const outsideSection = (html: string) =>
    html.match(
      /<article><h2>Clinician-reviewed outside vaccination history<\/h2>[\s\S]*?<\/article>/,
    )?.[0];
  check(
    !!outsideSection(actualEmailHtml) &&
      outsideSection(smsHtml) === outsideSection(actualEmailHtml),
    "Actual email, print and SMS link include identical reviewed vaccination content",
  );
  check([actualEmailHtml, actualPrint, smsHtml].every(html =>
    html.includes("Source item 905 was not observed") && html.includes("outside units") &&
    html.includes("&lt;script&gt;outside prescription prose&lt;/script&gt;")),
    "Real print, email and SMS artifacts preserve identical outside prescription facts");
  const changedArtifacts = JSON.parse(artifacts.payload_text);
  changedArtifacts.artifacts[1].content = Buffer.from(altered).toString(
    "base64",
  );
  const captureArgs = {
    p_id: linkId,
    p_actor_id: actor,
    p_token_hash: capability.token_hash,
    p_message_hash: capability.message_hash,
  };
  await assert.rejects(
    rpc("capture_document_link", {
      ...captureArgs,
      p_payload_text: JSON.stringify(changedArtifacts),
    }),
    /SQL 23514/,
  );
  check(
    true,
    "Actual document-link SQL capture independently rejects same-length altered PDF",
  );
  check(
    sql(
      `select count(*) from public.document_link_payloads where grant_id=${
        quote(linkId)
      };`,
    ) === "0",
    "Rejected bytes create no document artifact",
  );
  await rpc("capture_document_link", {
    ...captureArgs,
    p_payload_text: artifacts.payload_text,
  });
  const linkSaved = await staff("recover_document_link", {
    p_family: "record_release",
    p_source_id: s.release.id,
    p_request_id: linkId,
  });
  check(
    linkSaved.manifest[1].sha256 === captured.content_sha256,
    "Document SQL manifest confirms exact original digest",
  );
  await staff("attest_document_link", {
    p_request_id: linkId,
    p_reviewed_artifact_hash: artifacts.artifact_hash,
    p_reviewed_message_hash: capability.message_hash,
    p_attest: true,
  });
  const e2 = await release("EMAIL"), deliveryRequest = randomUUID();
  ids.push(deliveryRequest);
  const deliveryPrepared = await staff("prepare_release_email", {
    ...emailArgs,
    p_request_id: deliveryRequest,
    p_release_id: e2.release.id,
    p_release_hash: e2.release.source_hash,
  });
  const deliveryFrozen = await buildReleaseEmailPayload(
    deliveryPrepared.request,
    e2,
    sender,
    download,
  );
  await rpc("capture_release_email_payload", {
    p_request_id: deliveryRequest,
    p_actor_id: actor,
    p_payload_text: deliveryFrozen.payload_text,
  });
  const emailOutbox = await staff("enqueue_release_email", {
    p_request_id: deliveryRequest,
    p_reviewed_payload_hash: deliveryFrozen.payload_hash,
    p_attest: true,
  });
  ids.push(emailOutbox.id, emailOutbox.message_id);
  const smsOutbox = await staff("enqueue_document_link_sms", {
    p_request_id: linkId,
    p_reviewed_artifact_hash: artifacts.artifact_hash,
    p_reviewed_message_hash: capability.message_hash,
    p_attest: true,
  });
  ids.push(smsOutbox.id, smsOutbox.message_id);
  const overwritten = await fetch(
    `${local.API_URL}/storage/v1/object/patient-documents/${storagePath}`,
    {
      method: "PUT",
      headers: { ...serviceHeaders, "Content-Type": "application/pdf" },
      body: altered,
    },
  );
  check(
    overwritten.ok,
    "Only owned synthetic Storage object replaced with same-length altered bytes",
  );
  await assert.rejects(
    buildReleaseEmailPayload(prepared.request, e, sender, download),
    /captured source provenance/,
  );
  await assert.rejects(
    buildDocumentLinkArtifacts(context.grant, {
      name: "Synthetic",
      address: "Synthetic",
      domain: null,
    }, download),
    /captured source provenance/,
  );
  check(
    true,
    "Both real Storage download builders reject same-length changed source bytes",
  );
  const beforeReads = reads;
  const actorDb = createClient(local.API_URL, local.ANON_KEY, {
    global: { headers: { Authorization: staffHeaders.Authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const handler = createPrepareReleaseEmailHandler({
    authenticate: async (token) => {
      const { data, error } = await service.auth.getUser(token);
      if (error || !data.user) return null;
      return { actorId: data.user.id, db: actorDb };
    },
    service,
    download,
    sender,
  });
  const beforePrescriptionCorrection = await staff("read_record_release", { p_id: e.release.id });
  check(beforePrescriptionCorrection.eligible,
    "Prescription package remains source-eligible before an explicit correction");
  const prescriptionCorrectionId = randomUUID(); ids.push(prescriptionCorrectionId);
  const prescriptionCorrectionPrepared = await staff("prepare_ezyvet_prescription_review", {
    p_id: prescriptionCorrectionId, p_pet_id: pet, p_payload: {
      ...prescriptionFixture.payload,
      interpretation: { ...prescriptionFixture.payload.interpretation,
        reason: "Synthetic corrected interpretation preserves original prescription",
        outside_author: "Corrected outside attribution",
        replaces_id: prescription.id, expected_predecessor_hash: prescription.version_hash,
      },
    },
  });
  await staff("approve_ezyvet_prescription_review", {
    p_id: prescriptionCorrectionId, p_pet_id: pet,
    p_expected_hash: prescriptionCorrectionPrepared.request.request_hash, p_confirmed: true,
  });
  check(!(await staff("read_record_release", { p_id: e.release.id })).eligible,
    "Prescription-only correction invalidates the existing mixed package");
  check(JSON.stringify((await staff("read_record_release", { p_id: e.release.id })).release.snapshot) ===
    JSON.stringify(e.release.snapshot), "Correction leaves the frozen released prescription snapshot unchanged");
  const recoveredPrescription = await staff("recover_ezyvet_prescription_review", {
    p_id: prescription.id, p_pet_id: pet,
  });
  check(recoveredPrescription.receipt.id === prescription.id &&
    recoveredPrescription.receipt.context.reviewed.outside_author === "Outside prescriber, unverified name",
    "Original approval receipt recovers its original interpretation after correction");
  selection.imported_prescription_ids = [prescriptionCorrectionId];
  const changedRun = randomUUID();
  ids.push(changedRun);
  sql(
    `update public.ezyvet_import_runs set retry_after=clock_timestamp()-interval '1 second' where id=${
      quote(historyRun)
    };`,
  );
  const changedSource = await stageHistory(
    changedRun,
    "Synthetic revised outside history; local reaction unchanged",
  );
  const historicalApproval = await staff("approve_ezyvet_history", {
    p_id: historyApproval,
    p_pet_id: pet,
    p_expected_hash: approvedHistory.request.request_hash,
    p_confirmed: true,
  });
  const historicalExtraction = await staff(
    "approve_ezyvet_problem_extraction",
    {
      p_id: extractionId,
      p_pet_id: pet,
      p_expected_hash: extractionPrepared.request.request_hash,
      p_confirmed: true,
    },
  );
  check(
    historicalApproval.receipt.id === historyApproval &&
      historicalExtraction.receipt.problem_id === problemId,
    "Exact committed history and clinical approvals recover before changed-source eligibility checks",
  );
  const retainedAlert = await staff("read_patient_treatment_alerts", {
    p_pet_id: pet,
  });
  check(
    retainedAlert.snapshot.important_problems.some((p: { id: string }) =>
      p.id === problemId
    ),
    "Changed outside source cannot erase the local important reaction alert",
  );
  const changedRelease = await staff("read_record_release", {
    p_id: e.release.id,
  });
  check(
    !changedRelease.eligible,
    "Source-only history revision invalidates frozen release before any document metadata changes",
  );
  check(
    sql(
      `select version from public.patient_problems where id=${
        quote(problemId)
      };`,
    ) === String(editedProblem.version),
    "Changed outside source does not overwrite the locally reviewed reaction",
  );

  const recovered = await handler(
    new Request("http://localhost/prepare", {
      method: "POST",
      headers: staffHeaders,
      body: JSON.stringify(emailArgs),
    }),
  );
  check(
    recovered.status === 200 &&
      (await recovered.json()).payload_hash === frozen.payload_hash &&
      reads === beforeReads,
    "Actual handler exact retry returns captured original after source invalidation without download",
  );
  const linkHandler = createStaffDocumentLinkHandler({
    config,
    service,
    authenticate: async (token) => {
      const { data, error } = await service.auth.getUser(token);
      if (error || !data.user) return null;
      return { actorId: data.user.id, db: actorDb };
    },
    download,
    practice: { name: "Synthetic", address: "Synthetic", domain: null },
  }, "prepare");
  const { p_origin: _origin, p_key_version: _version, ...linkHttpArgs } =
    linkArgs;
  const recoveredLink = await linkHandler(
    new Request("http://localhost/prepare", {
      method: "POST",
      headers: staffHeaders,
      body: JSON.stringify(linkHttpArgs),
    }),
  );
  check(
    recoveredLink.status === 200 &&
      (await recoveredLink.json()).artifact_hash === artifacts.artifact_hash &&
      reads === beforeReads,
    "Actual document preparation exact retry preserves frozen artifact after source-only invalidation without download",
  );
  check(
    (await handler(
      new Request("http://localhost/prepare", {
        method: "POST",
        headers: staffHeaders,
        body: JSON.stringify({ ...emailArgs, p_subject: "Changed" }),
      }),
    )).status === 409,
    "Changed exact intent still rejected after capture",
  );
  await rpc("capture_release_email_payload", {
    p_request_id: requestId,
    p_actor_id: actor,
    p_payload_text: frozen.payload_text,
  });
  await rpc("capture_document_link", {
    ...captureArgs,
    p_payload_text: artifacts.payload_text,
  });
  check(
    true,
    "Both exact SQL capture retries recover historical frozen bytes after invalidation",
  );
  for (const outbox of [emailOutbox, smsOutbox]) {
    sql(
      `update public.communication_outbox set state='claimed',lease_token=gen_random_uuid(),lease_expires_at=now()+interval '2 minutes' where id=${
        quote(outbox.id)
      };`,
    );
    const lease = sql(
      `select lease_token from public.communication_outbox where id=${
        quote(outbox.id)
      };`,
    );
    const meta = outbox.channel === "EMAIL"
      ? { from: sender.from, reply_to: sender.replyTo }
      : {
        from: "+13035550999",
        account_sid: "ACsynthetic",
        document_link_token_hash: capability.token_hash,
        document_link_message_hash: capability.message_hash,
        document_link_artifact_hash: artifacts.artifact_hash,
      };
    const stopped = await rpc("start_communication_attempt", {
      p_id: outbox.id,
      p_lease_token: lease,
      p_provider_config: meta,
    });
    check(
      stopped.state === "failed" && stopped.attempt_count === 0,
      "Final wrapper chain stops invalidated original before provider attempt",
    );
  }
  check(
    sql(
      `select count(*) from public.communication_attempts where outbox_id in (${
        quote(emailOutbox.id)
      },${quote(smsOutbox.id)});`,
    ) === "0",
    "No provider attempt evidence was fabricated",
  );
  const updatedApproval = randomUUID(), discrepancyId = randomUUID();
  ids.push(updatedApproval, discrepancyId);
  const updatedHistory = await approveHistory(updatedApproval, changedSource);
  const discrepancyPrepared = await staff(
    "prepare_ezyvet_history_discrepancy",
    {
      p_id: discrepancyId,
      p_pet_id: pet,
      p_payload: {
        extraction_id: extractionId,
        reviewed_sources: [{
          original_history_id: historyApproval,
          reviewed_history_id: updatedApproval,
          version_hash: updatedHistory.receipt.version_hash,
        }],
        reason: "Synthetic separate source discrepancy review",
      },
    },
  );
  await staff("approve_ezyvet_history_discrepancy", {
    p_id: discrepancyId,
    p_pet_id: pet,
    p_expected_hash: discrepancyPrepared.request.request_hash,
    p_confirmed: true,
  });
  const afterReview = await staff("preview_record_release_v8", {
    p_pet_id: pet,
    p_client_id: client,
    p_channel: "EMAIL",
    p_recipient: email,
    p_selection: selection,
  });
  const provenance = afterReview.snapshot.problem_source_extractions[0];
  check(
    provenance.discrepancy.reviewed &&
      provenance.discrepancy.review_history[0].sources.some((
        r: { id: string; narrative_included: boolean },
      ) => r.id === updatedApproval && !r.narrative_included),
    "Separate DVM discrepancy review retains later source identity without forcing its narrative into a partial release",
  );
  check(
    renderRecordRelease({ preview: afterReview }).includes(
      "reviewed narrative was not selected",
    ),
    "Actual release renders reviewed source provenance separately from optional narrative",
  );
  const freshVaccinationPackage = await release("EMAIL");
  const correctionId = randomUUID();
  ids.push(correctionId);
  const correctionPrepared = await staff("prepare_ezyvet_vaccination_review", {
    p_id: correctionId,
    p_pet_id: pet,
    p_payload: {
      ...vaccinePayload,
      replaces_id: vaccineApproved.receipt.id,
      expected_predecessor_hash: vaccineApproved.receipt.version_hash,
      outside_author: "Explicit synthetic outside clinician",
      reason: "Synthetic attribution correction after further review",
    },
  });
  const correctedVaccination = await staff(
    "approve_ezyvet_vaccination_review",
    {
      p_id: correctionId,
      p_pet_id: pet,
      p_expected_hash: correctionPrepared.request.request_hash,
      p_confirmed: true,
    },
  );
  ids.push(correctedVaccination.receipt.id);
  const supersededPackage = await staff("read_record_release", {
    p_id: freshVaccinationPackage.release.id,
  });
  check(
    !supersededPackage.eligible &&
      JSON.stringify(supersededPackage.release.snapshot) ===
        JSON.stringify(freshVaccinationPackage.release.snapshot),
    "Actual vaccination correction invalidates pending delivery while retaining the immutable issued package",
  );
  const recoveredVaccination = await staff(
    "recover_ezyvet_vaccination_review",
    { p_id: vaccinationReview, p_pet_id: pet },
  );
  check(
    recoveredVaccination.receipt.id === vaccineApproved.receipt.id &&
      recoveredVaccination.receipt.reviewed.outside_author === null,
    "Exact original vaccination review recovers after correction without adopting later attribution",
  );
} catch (error) {
  failures.push(error);
} finally {
  try {
    if (storagePath) {
      check(
        (await fetch(`${local.API_URL}/storage/v1/object/patient-documents`, {
          method: "DELETE",
          headers: serviceHeaders,
          body: JSON.stringify({ prefixes: [storagePath] }),
        })).ok,
        "Owned private original removed",
      );
    }
    if (client) {
      ids.push(
        ...JSON.parse(
          sql(
            `select coalesce(json_agg(id),'[]'::json) from (select id from public.messages where conversation_id in(select id from public.conversations where client_id=${
              quote(client)
            }) union select id from public.communication_outbox where client_id=${
              quote(client)
            }) owned;`,
          ),
        ),
      );
    }
    const patterns = ids.map((v) => quote(`%${v}%`)).join(",");
    if (ids.length) {
      sql(
        `begin;set local session_replication_role=replica;do $cleanup$ declare t record;begin for t in select schemaname,tablename from pg_tables where schemaname='public' loop execute format('delete from %I.%I r where to_jsonb(r)::text like any ($1)',t.schemaname,t.tablename) using array[${patterns}];end loop;end $cleanup$;delete from public.record_release_policy where id;${
          priorPolicy === "null"
            ? ""
            : `insert into public.record_release_policy select * from jsonb_populate_record(null::public.record_release_policy,${
              quote(priorPolicy)
            }::jsonb);`
        }commit;`,
      );
    }
    check(
      sql(
        "select coalesce((select to_jsonb(p)::text from public.record_release_policy p where id),'null');",
      ) === priorPolicy,
      "Original local release policy restored exactly",
    );
    if (ids.length) {
      sql(
        `do $verify$ declare t record;n bigint;begin for t in select schemaname,tablename from pg_tables where schemaname='public' loop execute format('select count(*) from %I.%I r where to_jsonb(r)::text like any ($1)',t.schemaname,t.tablename) into n using array[${patterns}];if n<>0 then raise exception 'Synthetic fixture cleanup incomplete';end if;end loop;end $verify$;`,
      );
      check(
        true,
        "Owned synthetic rows and committed children cleanup verified",
      );
    }
    if (actor) {
      check(
        (await fetch(`${local.API_URL}/auth/v1/admin/users/${actor}`, {
          method: "DELETE",
          headers: serviceHeaders,
        })).ok,
        "Synthetic Auth identity removed",
      );
      check(
        (await fetch(`${local.API_URL}/auth/v1/admin/users/${actor}`, {
          headers: serviceHeaders,
        })).status === 404,
        "Removed synthetic Auth identity is absent",
      );
    }
  } catch (error) {
    failures.push(error);
  }
}
if (failures.length) {
  throw new AggregateError(
    failures,
    "Clinical history local capture or cleanup failed",
  );
}
console.log(
  `Clinical history Auth/Storage/PostgREST: ${assertions} checks passed. No provider requests; synthetic clinical fixtures only.`,
);
