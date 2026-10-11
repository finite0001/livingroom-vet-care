/** Explicitly owned localhost only; genuine Auth/PostgREST, no provider requests. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { parseOwnedRuntimeStatus } from "../estimates/owned-runtime-status.ts";
import {
  detailSchema,
  receiptSchema,
  pageSchema,
  packagesSchema,
  documentsSchema,
} from "../../src/hub/features/records-requests/model.ts";
import { buildReleaseEmailPayload } from "../../supabase/functions/_shared/release-email-payload.ts";
import {
  renderRecordRelease,
  type ReleaseBundle,
} from "../../supabase/functions/_shared/record-release-renderer.ts";
const project = process.env.RECORDS_TEST_PROJECT;
assert.ok(
  project && process.env.RECORDS_RUN_SYNTHETIC_LOCAL === "true",
  "Explicit synthetic local project required",
);
const projectId = readFileSync(`${project}/supabase/config.toml`, "utf8").match(
  /^project_id\s*=\s*"([a-zA-Z0-9_-]+)"/m,
)?.[1];
assert.ok(projectId);
const container = `supabase_db_${projectId}`;
const labels = JSON.parse(
  execFileSync("docker", ["inspect", container], { encoding: "utf8" }),
)[0].Config.Labels;
assert.equal(labels["com.supabase.cli.project"], projectId);
assert.equal(
  realpathSync(labels["com.supabase.cli.workdir"]),
  realpathSync(project),
);
const status = parseOwnedRuntimeStatus(
  execFileSync(
    "supabase",
    ["status", "--workdir", project, "--output", "json", "--agent", "no"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ),
);
const sql = (query: string) =>
  execFileSync(
    "docker",
    [
      "exec",
      "-i",
      container,
      "psql",
      "-X",
      "-qAt",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    { input: query, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
  ).trim();
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
function claimOwn(id: string) {
  assert.match(id, /^[a-f0-9-]{36}$/);
  const lease = randomUUID();
  return JSON.parse(
    sql(
      `update communication_outbox set state='claimed',lease_token='${lease}',lease_expires_at=now()+interval '2 minutes',updated_at=now() where id='${id}' and state='pending' returning to_jsonb(communication_outbox);`,
    ),
  );
}
let checks = 0;
const cleanupErrors: unknown[] = [];
let clientId = "";
const oldReleasePolicy = sql(
  "select to_jsonb(p) from record_release_policy p where id;",
);
const oldDisclosurePolicy = sql(
  "select to_jsonb(p) from record_request_disclosure_policy p where id;",
);
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
  sql(
    `insert into record_release_policy(id,enabled,accepted_by,accepted_at,acceptance_reference,accepted_schema_version) values(true,true,'${staff.id}',now(),'Synthetic local review',13) on conflict(id) do update set enabled=true,accepted_by=excluded.accepted_by,accepted_at=excluded.accepted_at,acceptance_reference=excluded.acceptance_reference,accepted_schema_version=13;insert into record_request_disclosure_policy(id,enabled,accepted_at,reviewer,review_reference) values(true,true,now(),'Synthetic local reviewer','Synthetic only') on conflict(id) do update set enabled=true,accepted_at=now(),reviewer='Synthetic local reviewer',review_reference='Synthetic only';`,
  );
  const confirmed = receiptSchema.parse(
    await rpc(staff.db, "confirm_record_request_package", confirmArgs),
  );
  assert.equal(confirmed.request.status, "ready");
  checks++;
  const bundle = (await rpc(staff.db, "read_record_release", {
    p_id: p.release_id,
  })) as ReleaseBundle;
  assert.equal(bundle.eligible, true);
  assert.equal(bundle.package_context?.ordinal, 1);
  checks += 2;
  const html = renderRecordRelease({
    preview: bundle.release,
    package_context: bundle.package_context,
  });
  assert.match(html, /Records request package 1 of 1/);
  assert.match(html, /authorized third-party/);
  assert.ok(
    !html.includes("PRIVATE AUTHORITY NOTE") &&
      !html.includes("PRIVATE DESTINATION NOTE"),
  );
  checks += 3;
  const conversation = await rpc(staff.db, "ensure_active_conversation", {
    p_client_id: client.id,
  });
  const emailId = randomUUID(),
    emailArgs = {
      p_request_id: emailId,
      p_release_id: p.release_id,
      p_conversation_id: conversation.id,
      p_subject: "Synthetic records request",
      p_body: "Synthetic original and report",
      p_release_hash: bundle.release.source_hash,
    };
  const prepared = await rpc(staff.db, "prepare_release_email", emailArgs);
  const payload = await buildReleaseEmailPayload(
    prepared.request,
    bundle,
    {
      from: "Synthetic practice <synthetic-practice@example.test>",
      replyTo: "synthetic-practice@example.test",
    },
    async (bucket, path, size) => {
      const d = await service.storage.from(bucket).download(path);
      if (d.error) throw d.error;
      const b = new Uint8Array(await d.data.arrayBuffer());
      assert.equal(b.length, size);
      return b;
    },
  );
  const frozen = JSON.parse(payload.payload_text);
  assert.equal(frozen.attachments.length, 2);
  assert.deepEqual(
    Buffer.from(frozen.attachments[1].content, "base64"),
    Buffer.from(bytes),
  );
  assert.deepEqual(frozen.to, [third.recipient_email]);
  checks += 3;
  await rpc(service, "capture_release_email_payload", {
    p_actor_id: staff.id,
    p_request_id: emailId,
    p_payload_text: payload.payload_text,
  });
  const queued = await rpc(staff.db, "enqueue_release_email", {
    p_request_id: emailId,
    p_reviewed_payload_hash: payload.payload_hash,
    p_attest: true,
  });
  assert.equal(queued.recipient, third.recipient_email);
  assert.equal(queued.state, "pending");
  checks += 2;
  await denied(
    staff.db,
    "transition_record_request",
    {
      p_action_id: randomUUID(),
      p_request_id: outgoingId,
      p_expected_version: 4,
      p_values: {
        status: "fulfilled",
        review_note: "Synthetic queue is not delivery",
      },
    },
    "23514",
  );
  checks++;
  const claim = claimOwn(queued.id);
  assert.equal(claim.id, queued.id);
  checks++;
  const started = await rpc(service, "start_communication_attempt", {
    p_id: queued.id,
    p_lease_token: claim.lease_token,
    p_provider_config: {
      from: "Synthetic practice <synthetic-practice@example.test>",
      reply_to: "synthetic-practice@example.test",
    },
  });
  assert.ok(started.attempt_started_at);
  checks++;
  const secondEmailId = randomUUID();
  const second = await rpc(staff.db, "prepare_release_email", {
    ...emailArgs,
    p_request_id: secondEmailId,
    p_subject: "Synthetic second records package",
  });
  const secondPayload = await buildReleaseEmailPayload(
    second.request,
    bundle,
    {
      from: "Synthetic practice <synthetic-practice@example.test>",
      replyTo: "synthetic-practice@example.test",
    },
    async (bucket, path) => {
      const original = await service.storage.from(bucket).download(path);
      if (original.error) throw original.error;
      return new Uint8Array(await original.data.arrayBuffer());
    },
  );
  await rpc(service, "capture_release_email_payload", {
    p_actor_id: staff.id,
    p_request_id: secondEmailId,
    p_payload_text: secondPayload.payload_text,
  });
  const secondOutbox = await rpc(staff.db, "enqueue_release_email", {
    p_request_id: secondEmailId,
    p_reviewed_payload_hash: secondPayload.payload_hash,
    p_attest: true,
  });
  const secondClaim = claimOwn(secondOutbox.id);
  assert.equal(secondClaim.id, secondOutbox.id);
  checks++;
  await rpc(staff.db, "revoke_record_request_authorization", {
    p_action_id: randomUUID(),
    p_request_id: outgoingId,
    p_expected_version: 4,
    p_values: {
      authorization_id: authorizeArgs.p_values.authorization_id,
      review_note: "Synthetic client revoked future disclosure",
    },
  });
  const blocked = await rpc(service, "start_communication_attempt", {
    p_id: secondOutbox.id,
    p_lease_token: secondClaim.lease_token,
    p_provider_config: {
      from: "Synthetic practice <synthetic-practice@example.test>",
      reply_to: "synthetic-practice@example.test",
    },
  });
  assert.equal(blocked.state, "failed");
  assert.equal(blocked.attempt_started_at, null);
  checks += 2;
  assert.equal(
    (await rpc(staff.db, "read_record_release", { p_id: p.release_id }))
      .eligible,
    false,
  );
  checks++;
  await denied(
    staff.db,
    "prepare_release_email",
    { ...emailArgs, p_request_id: randomUUID() },
    "42501",
  );
  checks++;
  assert.deepEqual(
    receiptSchema.parse(
      await rpc(staff.db, "confirm_record_request_package", confirmArgs),
    ),
    confirmed,
  );
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
  await denied(service, "list_record_requests", {}, "42501");
  await denied(
    staff.db,
    "record_request_authorization_current",
    { p_request_id: outgoingId, p_manifest_id: manifestId },
    "42501",
  );
  checks += 3;
  console.log(
    `Genuine local records Auth/Storage/renderer/typed email queue passed: ${checks} assertions; zero provider HTTP requests.`,
  );
} finally {
  // Synthetic local policy commissioning is never left enabled; restore exact predecessor values.
  for (const [table, old] of [
    ["record_release_policy", oldReleasePolicy],
    ["record_request_disclosure_policy", oldDisclosurePolicy],
  ]) {
    try {
      if (old)
        sql(
          `delete from ${table};insert into ${table} select * from jsonb_populate_record(null::${table},'${old.replaceAll("'", "''")}'::jsonb);`,
        );
      else sql(`delete from ${table};`);
    } catch (e) {
      cleanupErrors.push(e);
    }
  }
  for (const a of actors) {
    try {
      await a.db.auth.signOut({ scope: "global" });
      sql(
        `update profiles set is_active=false where id='${a.id}';delete from auth.refresh_tokens where user_id='${a.id}';update auth.sessions set not_after=now() where user_id='${a.id}';`,
      );
      const ban = await service.auth.admin.updateUserById(a.id, {
        ban_duration: "876000h",
      });
      if (ban.error) cleanupErrors.push(ban.error);
    } catch (e) {
      cleanupErrors.push(e);
    }
  }
  if (clientId)
    sql(
      `update communication_outbox set state='failed',lease_token=null,lease_expires_at=null,last_error='synthetic_test_cleanup' where client_id='${clientId}' and state in ('pending','claimed');`,
    );
}
if (cleanupErrors.length)
  throw new AggregateError(cleanupErrors, "Synthetic local cleanup failed");
