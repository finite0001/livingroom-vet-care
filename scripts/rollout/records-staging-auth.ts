/** Historical PR #237 staging acceptance at the October 11 baseline.
 * This script accesses hosted credentials and creates retained synthetic fixtures.
 * Review current schema/session prerequisites and authorization before any rerun;
 * restoring it to main does not approve a new hosted run. */
/** Staging-only engineering acceptance; disclosure remains OFF and no queue/provider calls. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  detailSchema,
  receiptSchema,
  pageSchema,
  packagesSchema,
  documentsSchema,
} from "../../src/hub/features/records-requests/model.ts";
import { renderRecordRelease } from "../../supabase/functions/_shared/record-release-renderer.ts";
const project = "kothoqicubowyhwfsrte";
assert.equal(process.env.RECORDS_RUN_SYNTHETIC_STAGING, "true");
const raw = JSON.parse(
  execFileSync(
    "supabase",
    [
      "projects",
      "api-keys",
      "--project-ref",
      project,
      "--reveal",
      "--output",
      "json",
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ),
);
const keys = Array.isArray(raw) ? raw : raw.rows;
const status = {
  API_URL: `https://${project}.supabase.co`,
  SERVICE_ROLE_KEY:
    keys.find((k) => k.name === "service_role")?.api_key ||
    keys.find((k) => k.type === "secret")?.api_key,
  ANON_KEY:
    keys.find((k) => k.name === "anon")?.api_key ||
    keys.find((k) => k.type === "publishable")?.api_key,
};
assert.ok(status.SERVICE_ROLE_KEY && status.ANON_KEY);
const sql = (query: string) => {
  const data = JSON.parse(
    execFileSync(
      "supabase",
      [
        "db",
        "query",
        "--linked",
        "--project-ref",
        project,
        query,
        "--output-format",
        "json",
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ),
  );
  const rows = Array.isArray(data) ? data : data.rows;
  return rows
    .map((r) =>
      Object.values(r)
        .map((v) => (typeof v === "object" ? JSON.stringify(v) : String(v)))
        .join("|"),
    )
    .join("\n");
};
assert.equal(
  sql("select count(*) from record_request_disclosure_policy;"),
  "0",
  "Never commission disclosure during hosted acceptance",
);
assert.equal(
  sql("select count(*) from record_release_policy;"),
  "0",
  "Never change clinical release commissioning",
);
const cleanup: Array<() => Promise<void>> = [];
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(status.API_URL, status.SERVICE_ROLE_KEY, options);
interface Actor {
  id: string;
  db: SupabaseClient;
}
const actors: Actor[] = [];
async function actor(role: "DVM" | "STAFF" | "ADMIN") {
  const email = `synthetic-records-${randomUUID()}@example.test`,
    password = randomUUID() + randomUUID();
  const created = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (created.error) throw created.error;
  const id = created.data.user!.id;
  const db = createClient(status.API_URL, status.ANON_KEY, options);
  const value = { id, db };
  actors.push(value);
  sql(
    `update profiles set is_active=true,full_name='Synthetic ${role} reviewer' where id='${id}';insert into user_roles(user_id,role) values('${id}','${role}') on conflict do nothing;`,
  );
  const login = await db.auth.signInWithPassword({ email, password });
  if (login.error) throw login.error;
  return value;
}
async function rpc(
  db: SupabaseClient,
  name: string,
  args: Record<string, unknown> = {},
) {
  const { data, error } = await db.rpc(name, args);
  if (error) throw error;
  return data;
}
async function denied(
  db: SupabaseClient,
  name: string,
  args: Record<string, unknown>,
  code: string,
) {
  const { error } = await db.rpc(name, args);
  assert.equal(error?.code, code);
}
let checks = 0;
const cleanupErrors: unknown[] = [];
let clientId = "";
try {
  const staff = await actor("STAFF"),
    other = await actor("STAFF");
  const client = await rpc(staff.db, "save_client", {
    p_actor_id: staff.id,
    p_client_id: null,
    p_expected_version: null,
    p_first_name: "Synthetic",
    p_last_name: "Records Auth",
    p_primary_phone: "+12025550185",
    p_primary_email: "synthetic-records-auth@example.test",
    p_preferred_channel: "EMAIL",
    p_mailing_address: null,
    p_housecall_address: null,
  });
  clientId = client.id;
  const patientArgs = {
    p_id: null,
    p_client_id: client.id,
    p_expected_version: null,
    p_name: "Synthetic records Auth patient",
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
  };
  const pet = await rpc(staff.db, "save_patient", patientArgs),
    sibling = await rpc(staff.db, "save_patient", {
      ...patientArgs,
      p_name: "Synthetic records Auth sibling",
    });
  for (const patient of [pet, sibling])
    cleanup.unshift(async () => {
      const current = JSON.parse(
        sql(`select to_jsonb(p) from pets p where id='${patient.id}';`),
      );
      await rpc(staff.db, "save_patient", {
        ...patientArgs,
        p_id: patient.id,
        p_name: current.name,
        p_expected_version: current.version,
        p_archived_at: new Date().toISOString(),
        p_deceased_at: current.deceased_at,
      });
    });
  const docId = randomUUID(),
    bytes = new TextEncoder().encode(
      "%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n",
    );
  const doc = await rpc(staff.db, "prepare_patient_document", {
    p_id: docId,
    p_pet_id: pet.id,
    p_encounter_id: null,
    p_file_name: "synthetic-records.pdf",
    p_mime_type: "application/pdf",
    p_file_size: bytes.length,
    p_category: "other",
    p_source: "Synthetic actual private original",
    p_document_date: null,
    p_visibility: "client_shareable",
  });
  const upload = await staff.db.storage
    .from("patient-documents")
    .upload(doc.file_path, bytes, {
      contentType: "application/pdf",
      upsert: false,
    });
  if (upload.error) throw upload.error;
  const ready = await rpc(staff.db, "finalize_patient_document", {
    p_id: docId,
  });
  cleanup.unshift(async () => {
    await rpc(staff.db, "void_patient_document", {
      p_id: docId,
      p_expected_version: ready.version,
      p_reason: "Synthetic hosted acceptance closed",
    });
  });
  assert.equal(ready.version, 2);
  checks++;
  const download = await staff.db.storage
    .from("patient-documents")
    .download(ready.file_path);
  if (download.error) throw download.error;
  assert.deepEqual(new Uint8Array(await download.data.arrayBuffer()), bytes);
  checks++;
  const base = {
    pet_id: pet.id,
    client_id: client.id,
    direction: "incoming",
    subset: "full",
    channel: null,
    recipient_kind: "client",
    recipient_name: null,
    recipient_email: null,
    requester_name: "Synthetic referring clinic",
    request_note: "",
    requested_on: new Date().toISOString().slice(0, 10),
    due_on: null,
    assigned_to: staff.id,
    ticket_id: null,
    conversation_id: null,
  };
  const incomingId = randomUUID(),
    saveArgs = {
      p_action_id: randomUUID(),
      p_id: incomingId,
      p_expected_version: null,
      p_values: base,
    };
  for (const id of [incomingId])
    cleanup.push(async () => {
      const current = detailSchema.parse(
        await rpc(staff.db, "read_record_request", { p_id: id }),
      );
      if (["fulfilled", "cancelled"].includes(current.request.status)) return;
      await rpc(staff.db, "transition_record_request", {
        p_action_id: randomUUID(),
        p_request_id: id,
        p_expected_version: current.request.version,
        p_values: {
          status: "cancelled",
          review_note: "Synthetic hosted acceptance closed",
        },
      });
    });
  const saved = receiptSchema.parse(
    await rpc(staff.db, "save_record_request", saveArgs),
  );
  assert.equal(saved.request.created_by, staff.id);
  checks++;
  assert.deepEqual(
    receiptSchema.parse(await rpc(staff.db, "save_record_request", saveArgs)),
    saved,
  );
  checks++;
  await denied(other.db, "save_record_request", saveArgs, "23505");
  checks++;
  documentsSchema.parse(
    await rpc(staff.db, "list_record_request_documents", {
      p_request_id: incomingId,
    }),
  );
  checks++;
  const receiveArgs = {
    p_action_id: randomUUID(),
    p_request_id: incomingId,
    p_expected_version: 1,
    p_values: {
      documents: [{ id: docId, version: ready.version }],
      review_note: "Synthetic actual PDF original reviewed",
    },
  };
  const received = receiptSchema.parse(
    await rpc(staff.db, "receive_record_request", receiveArgs),
  );
  assert.equal(received.request.status, "received");
  checks++;
  const siblingId = randomUUID();
  cleanup.push(async () => {
    const current = detailSchema.parse(
      await rpc(staff.db, "read_record_request", { p_id: siblingId }),
    );
    if (["fulfilled", "cancelled"].includes(current.request.status)) return;
    await rpc(staff.db, "transition_record_request", {
      p_action_id: randomUUID(),
      p_request_id: siblingId,
      p_expected_version: current.request.version,
      p_values: {
        status: "cancelled",
        review_note: "Synthetic hosted acceptance closed",
      },
    });
  });
  await rpc(staff.db, "save_record_request", {
    ...saveArgs,
    p_action_id: randomUUID(),
    p_id: siblingId,
    p_values: { ...base, pet_id: sibling.id },
  });
  await denied(
    staff.db,
    "receive_record_request",
    { ...receiveArgs, p_action_id: randomUUID(), p_request_id: siblingId },
    "PT409",
  );
  checks++;
  const fulfilled = receiptSchema.parse(
    await rpc(staff.db, "transition_record_request", {
      p_action_id: randomUUID(),
      p_request_id: incomingId,
      p_expected_version: 2,
      p_values: {
        status: "fulfilled",
        review_note: "Actual stored PDF verified",
      },
    }),
  );
  assert.equal(fulfilled.request.status, "fulfilled");
  checks++;
  const outgoingId = randomUUID(),
    third = {
      ...base,
      direction: "outgoing",
      subset: "custom",
      channel: "EMAIL",
      recipient_kind: "third_party",
      recipient_name: "Synthetic authorized clinic",
      recipient_email: "synthetic-authorized-clinic@example.test",
    };
  await rpc(staff.db, "save_record_request", {
    ...saveArgs,
    p_action_id: randomUUID(),
    p_id: outgoingId,
    p_values: third,
  });
  cleanup.push(async () => {
    const current = detailSchema.parse(
      await rpc(staff.db, "read_record_request", { p_id: outgoingId }),
    );
    if (["fulfilled", "cancelled"].includes(current.request.status)) return;
    await rpc(staff.db, "transition_record_request", {
      p_action_id: randomUUID(),
      p_request_id: outgoingId,
      p_expected_version: current.request.version,
      p_values: {
        status: "cancelled",
        review_note: "Synthetic hosted acceptance closed",
      },
    });
  });
  const manifestId = randomUUID(),
    manifest = receiptSchema.parse(
      await rpc(staff.db, "prepare_record_request_manifest", {
        p_action_id: randomUUID(),
        p_request_id: outgoingId,
        p_expected_version: 1,
        p_values: {
          manifest_id: manifestId,
          selection: { document_ids: [docId] },
          review_note: "Synthetic exact original scope",
        },
      }),
    );
  const page = packagesSchema.parse(
    await rpc(staff.db, "list_record_request_packages", {
      p_request_id: outgoingId,
      p_manifest_id: manifestId,
    }),
  );
  assert.equal(page.items.length, 1);
  checks++;
  const p = page.items[0],
    context = detailSchema.parse(
      await rpc(staff.db, "read_record_request", { p_id: outgoingId }),
    );
  assert.equal(context.disclosure_policy_accepted, false);
  checks++;
  const authorizeArgs = {
    p_action_id: randomUUID(),
    p_request_id: outgoingId,
    p_expected_version: 2,
    p_values: {
      authorization_id: randomUUID(),
      manifest_hash: context.manifest!.fingerprint,
      client_authority:
        "PRIVATE AUTHORITY NOTE synthetic client approved original",
      destination_verification:
        "PRIVATE DESTINATION NOTE independently verified synthetic clinic",
      evidence_document_id: docId,
      evidence_document_version: ready.version,
      expires_on: new Date(Date.now() + 86400000 * 3)
        .toISOString()
        .slice(0, 10),
      attest_client_authority: true,
      attest_destination: true,
      attest_source_scope: true,
    },
  };
  await rpc(staff.db, "authorize_record_request_recipient", authorizeArgs);
  const confirmArgs = {
    p_action_id: randomUUID(),
    p_request_id: outgoingId,
    p_expected_version: 3,
    p_values: {
      package_id: p.id,
      manifest_hash: context.manifest!.fingerprint,
      attest_review: true,
      attest_scope_expansion: false,
    },
  };
  await denied(
    staff.db,
    "confirm_record_request_package",
    confirmArgs,
    "42501",
  );
  checks++;
  const preview = await rpc(staff.db, "read_record_request_package", {
    p_request_id: outgoingId,
    p_package_id: p.id,
  });
  const html = renderRecordRelease({
    preview: preview.preview,
    package_context: preview.package_context,
  });
  assert.match(html, /Records request package 1 of 1/);
  assert.ok(
    !html.includes("PRIVATE AUTHORITY NOTE") &&
      !html.includes("PRIVATE DESTINATION NOTE"),
  );
  checks += 2;
  await rpc(staff.db, "revoke_record_request_authorization", {
    p_action_id: randomUUID(),
    p_request_id: outgoingId,
    p_expected_version: 3,
    p_values: {
      authorization_id: authorizeArgs.p_values.authorization_id,
      review_note: "Synthetic authority closed",
    },
  });
  const revoked = detailSchema.parse(
    await rpc(staff.db, "read_record_request", { p_id: outgoingId }),
  );
  assert.equal(revoked.authorization!.revoked, true);
  checks++;
  pageSchema.parse(
    await rpc(staff.db, "list_record_requests", {
      p_filter: { client_id: client.id },
      p_limit: 1,
    }),
  );
  checks++;
  const anon = createClient(status.API_URL, status.ANON_KEY, options);
  await denied(anon, "list_record_requests", {}, "42501");
  checks++;
  await denied(service, "list_record_requests", {}, "42501");
  checks++;
  sql(`update profiles set is_active=false where id='${other.id}';`);
  await denied(other.db, "list_record_requests", {}, "42501");
  checks++;
  assert.equal(
    sql(
      `select count(*) from communication_outbox where client_id='${client.id}';`,
    ),
    "0",
  );
  checks++;
  assert.equal(
    sql("select count(*) from record_request_disclosure_policy;"),
    "0",
  );
  checks++;
  assert.equal(sql("select count(*) from record_release_policy;"), "0");
  checks++;
} finally {
  for (const close of cleanup) {
    try {
      await close();
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  for (const a of actors) {
    try {
      const logout = await a.db.auth.signOut({ scope: "global" });
      if (logout.error) cleanupErrors.push(logout.error);
      sql(
        `update profiles set is_active=false where id='${a.id}';delete from auth.refresh_tokens where user_id='${a.id}';update auth.sessions set not_after=now() where user_id='${a.id}';`,
      );
      const ban = await service.auth.admin.updateUserById(a.id, {
        ban_duration: "876000h",
      });
      if (ban.error) cleanupErrors.push(ban.error);
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
}
if (cleanupErrors.length)
  throw new AggregateError(cleanupErrors, "Synthetic staging cleanup failed");
console.log(
  `Genuine staging records Auth/private Storage/numbered renderer passed: ${checks} assertions; cleanup complete; policies untouched; zero outbox/provider requests.`,
);
