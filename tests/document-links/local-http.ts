/** Explicit local-only integration runner: no provider requests or cloud targets. */
import { execFileSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
const project =
  process.env.DOCUMENT_LINK_TEST_PROJECT || "/tmp/livingroom-vet-foundation";
const configText = readFileSync(`${project}/supabase/config.toml`, "utf8");
const projectId = configText.match(
  /^project_id\s*=\s*"([a-zA-Z0-9_-]+)"/m,
)?.[1];
if (!projectId) throw new Error("Explicit local Supabase project required");
const env = JSON.parse(
  execFileSync(
    "supabase",
    ["status", "--workdir", project, "--output", "json"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ),
) as Record<string, string>;
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(env.API_URL))
  throw new Error("Local HTTP target required");
const container = `supabase_db_${projectId}`;
const sql = (query: string) =>
  execFileSync(
    "docker",
    [
      "exec",
      "-i",
      container,
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
    ],
    { input: query, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
  ).trim();
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
const root = "http://127.0.0.1:56451";
const serviceHeaders = {
  apikey: env.ANON_KEY,
  Authorization: `Bearer ${env.SERVICE_ROLE_KEY}`,
  "Content-Type": "application/json",
};
async function jsonRequest(
  path: string,
  body: unknown,
  headers: Record<string, string>,
) {
  const res = await fetch(`${env.API_URL}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const failure = await res.json();
    throw new Error(
      `Local setup ${path} HTTP ${res.status}: ${failure.code || ""} ${failure.message || ""}`,
    );
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}
const priorPolicy = sql(
  "select coalesce((select to_jsonb(p)::text from public.record_release_policy p where id),'null');",
);
const ids: string[] = [];
let actor = "",
  staffHeaders: Record<string, string> = {};
let storagePath = "";
let server: ReturnType<typeof spawn> | null = null;
let assertions = 0;
const failures: unknown[] = [];
const check = (value: unknown, message: string) => {
  assert.ok(value, message);
  assertions++;
};
try {
  const emailId = crypto.randomUUID();
  ids.push(emailId);
  const email = `document-links-${emailId}@example.test`,
    password = `Synthetic-${crypto.randomUUID()}-Aa1!`;
  const user = await jsonRequest(
    "/auth/v1/admin/users",
    { email, password, email_confirm: true },
    serviceHeaders,
  );
  actor = user.id;
  ids.push(actor);
  const auth = await jsonRequest(
    "/auth/v1/token?grant_type=password",
    { email, password },
    { apikey: env.ANON_KEY, "Content-Type": "application/json" },
  );
  staffHeaders = {
    apikey: env.ANON_KEY,
    Authorization: `Bearer ${auth.access_token}`,
    "Content-Type": "application/json",
  };
  const rpc = async (name: string, args: Record<string, unknown>) =>
    jsonRequest(`/rest/v1/rpc/${name}`, args, staffHeaders);
  sql(
    `insert into public.user_roles(user_id,role) values(${quote(actor)},'ADMIN') on conflict do nothing;`,
  );
  const client = await rpc("save_client", {
    p_actor_id: actor,
    p_client_id: null,
    p_expected_version: null,
    p_first_name: "Synthetic link",
    p_last_name: "Household",
    p_primary_phone: "+13035550808",
    p_primary_email: email,
    p_preferred_channel: "SMS",
    p_mailing_address: null,
    p_housecall_address: null,
  });
  ids.push(client.id);
  await rpc("record_sms_consent", {
    p_actor_id: actor,
    p_client_id: client.id,
    p_phone: "+13035550808",
    p_opted_in: true,
    p_method: "WRITTEN",
    p_details: "LOCAL SYNTHETIC ONLY",
    p_expected_updated_at: null,
  });
  const pet = await rpc("save_patient", {
    p_id: null,
    p_client_id: client.id,
    p_expected_version: null,
    p_name: "Synthetic link patient",
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
  });
  ids.push(pet.id);
  const product = await rpc("save_catalog_product", {
    p_id: null,
    p_expected_version: null,
    p_name: "Synthetic link exam",
    p_kind: "service",
    p_manufacturer: "",
    p_unit: "visit",
    p_unit_price_cents: 12500,
    p_active: true,
  });
  ids.push(product.id);
  const invoice = crypto.randomUUID();
  ids.push(invoice);
  await rpc("create_billing_invoice", {
    p_id: invoice,
    p_client_id: client.id,
  });
  await rpc("add_invoice_service", {
    p_id: crypto.randomUUID(),
    p_invoice_id: invoice,
    p_pet_id: pet.id,
    p_product_id: product.id,
    p_quantity: 1,
  });
  await rpc("issue_billing_invoice", { p_id: invoice, p_expected_version: 2 });
  const conversation = await rpc("ensure_active_conversation", {
    p_client_id: client.id,
  });
  ids.push(conversation.id);
  const docId = crypto.randomUUID();
  ids.push(docId);
  const original = new TextEncoder().encode(
    "%PDF-1.4\nSynthetic original bytes\n%%EOF",
  );
  const doc = await rpc("prepare_patient_document", {
    p_id: docId,
    p_pet_id: pet.id,
    p_encounter_id: null,
    p_file_name: "synthetic-original.pdf",
    p_mime_type: "application/pdf",
    p_file_size: original.length,
    p_category: "medical_record",
    p_source: "LOCAL SYNTHETIC ONLY",
    p_document_date: null,
    p_visibility: "client_shareable",
  });
  storagePath = doc.file_path;
  const upload = await fetch(
    `${env.API_URL}/storage/v1/object/patient-documents/${storagePath}`,
    {
      method: "POST",
      headers: {
        apikey: env.ANON_KEY,
        Authorization: staffHeaders.Authorization,
        "Content-Type": "application/pdf",
        "x-upsert": "false",
      },
      body: original,
    },
  );
  check(upload.ok, "Actual private Storage upload succeeds");
  await rpc("finalize_patient_document", { p_id: docId });
  sql(
    `select set_config('request.jwt.claims',${quote(JSON.stringify({ sub: actor, role: "authenticated" }))},false);insert into public.record_release_policy(id,enabled,accepted_by,accepted_at,acceptance_reference,accepted_schema_version) values(true,true,'LOCAL SYNTHETIC ONLY',now(),'LOCAL HTTP TEST ONLY',4) on conflict(id) do update set enabled=true,accepted_schema_version=4,accepted_at=now();`,
  );
  const selection = { document_ids: [docId] };
  const preview = await rpc("preview_record_release_v4", {
    p_pet_id: pet.id,
    p_client_id: client.id,
    p_channel: "SMS",
    p_recipient: "+13035550808",
    p_selection: selection,
  });
  const release = crypto.randomUUID();
  ids.push(release);
  await rpc("confirm_record_release", {
    p_id: release,
    p_pet_id: pet.id,
    p_client_id: client.id,
    p_channel: "SMS",
    p_recipient: "+13035550808",
    p_selection: selection,
    p_reviewed_snapshot: preview.snapshot,
    p_reviewed_hash: preview.source_hash,
    p_attest_review: true,
  });
  server = spawn(
    "deno",
    [
      "run",
      "--allow-env",
      "--allow-net",
      "--allow-read",
      "--config",
      "supabase/functions/prepare-document-link/deno.json",
      "tests/document-links/local-server.ts",
    ],
    {
      env: {
        ...process.env,
        SUPABASE_URL: env.API_URL,
        SUPABASE_SERVICE_ROLE_KEY: env.SERVICE_ROLE_KEY,
        SUPABASE_ANON_KEY: env.ANON_KEY,
        DOCUMENT_LINK_ORIGIN: "https://thelivingroom.vet",
        DOCUMENT_LINK_ACTIVE_KEY_VERSION: "local-v1",
        DOCUMENT_LINK_KEYS: JSON.stringify({
          "local-v1": btoa("local-synthetic-key-material-00001"),
        }),
        DOCUMENT_LINK_PUBLIC_ENABLED: "true",
        DOCUMENT_LINK_TEST_PORT: "56451",
      },
      stdio: "ignore",
    },
  );
  let ready = false;
  for (let tries = 0; tries < 80; tries++) {
    try {
      await fetch(`${root}/health`);
      ready = true;
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  if (!ready) throw new Error("Local handler did not start");
  const post = async (path: string, body: unknown, staff = false) =>
    fetch(`${root}${path}`, {
      method: "POST",
      headers: staff ? staffHeaders : { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  async function prepare(family: string, source: string) {
    const current = await rpc("preview_document_link", {
      p_family: family,
      p_source_id: source,
      p_client_id: client.id,
    });
    const requestId = crypto.randomUUID();
    ids.push(requestId);
    const args = {
      p_request_id: requestId,
      p_family: family,
      p_source_id: source,
      p_client_id: client.id,
      p_conversation_id: conversation.id,
      p_recipient: current.recipient,
      p_source_hash: current.source_hash,
      p_expires_at: new Date(Date.now() + 86400000).toISOString(),
      p_message_template: "Reviewed documents: {{document_link}}",
    };
    const response = await post("/prepare", args, true);
    check(response.status === 200, `${family} capture succeeds over HTTP`);
    const prepared = await response.json();
    const again = await (await post("/prepare", args, true)).json();
    check(
      again.client_url === prepared.client_url &&
        again.artifact_hash === prepared.artifact_hash,
      "Retry preserves capability and frozen bytes",
    );
    const token = new URL(prepared.client_url).hash.slice(1);
    const request = { grant_id: requestId, token, artifact_index: null };
    check(
      (await post("/retrieve", request)).status === 404,
      "Unreviewed capture unavailable",
    );
    await rpc("attest_document_link", {
      p_request_id: requestId,
      p_reviewed_artifact_hash: prepared.artifact_hash,
      p_reviewed_message_hash: prepared.message_hash,
      p_attest: true,
    });
    return { request, prepared, args };
  }
  const inv = await prepare("invoice", invoice);
  const rec = await prepare("record_release", release);
  for (const current of [inv, rec]) {
    const manifestResponse = await post("/retrieve", current.request);
    check(
      manifestResponse.status === 200,
      "Reviewed metadata retrieval succeeds",
    );
    const metadata = await manifestResponse.json();
    check(
      metadata.manifest.length === (current === rec ? 2 : 1),
      "Manifest has exact selected count",
    );
    check(
      !JSON.stringify(metadata).includes("file_path"),
      "No private paths exposed",
    );
    const report = await post("/retrieve", {
      ...current.request,
      artifact_index: 0,
    });
    check(report.status === 200, "Actual frozen HTML delivered");
    const html = await report.text();
    check(
      html.includes("Content-Security-Policy") && html.includes("no-referrer"),
      "Standalone HTML carries privacy policy",
    );
    check(
      report.headers.get("cache-control") === "no-store, private",
      "Response is not cacheable",
    );
    check(
      (
        await post("/retrieve", {
          ...current.request,
          token: "v1." + "x".repeat(43),
        })
      ).status === 404,
      "Wrong token unavailable",
    );
    check(
      (
        await post("/retrieve", {
          ...current.request,
          grant_id: crypto.randomUUID(),
        })
      ).status === 404,
      "Wrong grant unavailable",
    );
    for (const index of [-1, 0.5, 25, "0"])
      check(
        (await post("/retrieve", { ...current.request, artifact_index: index }))
          .status === 404,
        "Invalid selector unavailable",
      );
    check(
      (await post("/off", current.request)).status === 503,
      "Default-disabled endpoint fails closed",
    );
    check(
      (await post("/removed-key", current.request)).status === 404,
      "Removed key fails closed",
    );
    check(
      (await post("/changed-origin", current.request)).status === 404,
      "Changed origin fails closed",
    );
  }
  const downloaded = await post("/retrieve", {
    ...rec.request,
    artifact_index: 1,
  });
  check(
    downloaded.status === 200,
    "Actual original delivered through endpoint",
  );
  check(
    Buffer.from(await downloaded.arrayBuffer()).equals(Buffer.from(original)),
    "Original bytes are exact",
  );
  check(
    downloaded.headers.get("content-disposition")?.startsWith("attachment;"),
    "Original uses attachment disposition",
  );
  // Operator-only synthetic corruption is rolled back after verifying the endpoint.
  const originalPayload = sql(
    `select payload_text from public.document_link_payloads where grant_id=${quote(rec.request.grant_id)};`,
  );
  sql(
    `begin;alter table public.document_link_payloads disable trigger document_link_immutable;update public.document_link_payloads set payload_text='{"artifacts":[]}' where grant_id=${quote(rec.request.grant_id)};alter table public.document_link_payloads enable trigger document_link_immutable;commit;`,
  );
  check(
    (await post("/retrieve", { ...rec.request, artifact_index: 1 })).status ===
      404,
    "Frozen byte corruption denied before HTTP bytes",
  );
  sql(
    `begin;alter table public.document_link_payloads disable trigger document_link_immutable;update public.document_link_payloads set payload_text=${quote(originalPayload)} where grant_id=${quote(rec.request.grant_id)};alter table public.document_link_payloads enable trigger document_link_immutable;commit;`,
  );
  sql(
    `begin;alter table public.document_link_grants disable trigger document_link_immutable;update public.document_link_grants set expires_at=now()-interval '1 minute' where id=${quote(rec.request.grant_id)};alter table public.document_link_grants enable trigger document_link_immutable;commit;`,
  );
  check(
    (await post("/retrieve", rec.request)).status === 404,
    "Expired capability denied over HTTP",
  );
  sql(
    `begin;alter table public.document_link_grants disable trigger document_link_immutable;update public.document_link_grants set expires_at=${quote(rec.prepared.grant.expires_at)} where id=${quote(rec.request.grant_id)};alter table public.document_link_grants enable trigger document_link_immutable;commit;`,
  );
  await rpc("credit_billing_invoice", {
    p_id: crypto.randomUUID(),
    p_invoice_id: invoice,
    p_amount_cents: 1,
    p_reason: "LOCAL SYNTHETIC correction",
  });
  check(
    (await post("/retrieve", inv.request)).status === 404,
    "Current invoice credit invalidates public retrieval",
  );
  const recovered = await (
    await post(
      "/recover",
      {
        p_family: "invoice",
        p_source_id: invoice,
        p_request_id: inv.request.grant_id,
      },
      true,
    )
  ).json();
  check(
    recovered.client_url === inv.prepared.client_url &&
      recovered.artifact_hash === inv.prepared.artifact_hash,
    "Recovery after source change preserves exact frozen capability",
  );
  sql(
    `update public.sms_consent set opted_in=false where client_id=${quote(client.id)};`,
  );
  check(
    (await post("/retrieve", rec.request)).status === 404,
    "Current SMS opt-out denies public retrieval",
  );
  sql(
    `update public.sms_consent set opted_in=true where client_id=${quote(client.id)};`,
  );
  await rpc("revoke_document_link", {
    p_request_id: rec.request.grant_id,
    p_reason: "LOCAL SYNTHETIC revocation",
  });
  check(
    (await post("/retrieve", { ...rec.request, artifact_index: 1 })).status ===
      404,
    "Revoked original denied",
  );
  const persisted = sql(
    `select coalesce(jsonb_agg(to_jsonb(g))::text,'[]') from public.document_link_grants g where actor_id=${quote(actor)};select coalesce(jsonb_agg(to_jsonb(p))::text,'[]') from public.document_link_payloads p join public.document_link_grants g on g.id=p.grant_id where g.actor_id=${quote(actor)};select coalesce(jsonb_agg(to_jsonb(a))::text,'[]') from public.audit_logs a where table_name like 'document_link%';`,
  );
  check(
    !persisted.includes(inv.request.token) &&
      !persisted.includes(rec.request.token),
    "Usable tokens absent from database and audit history",
  );
  console.log(`Local document-link HTTP/Storage checks passed: ${assertions}`);
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Local integration failed",
  );
  failures.push(error);
} finally {
  try {
    server?.kill("SIGTERM");
    if (storagePath) {
      const removedObject = await fetch(
        `${env.API_URL}/storage/v1/object/patient-documents`,
        {
          method: "DELETE",
          headers: serviceHeaders,
          body: JSON.stringify({ prefixes: [storagePath] }),
        },
      );
      if (!removedObject.ok)
        failures.push(new Error("Local private object cleanup failed"));
    }
    if (ids.length) {
      const patterns = ids.map((id) => quote(`%${id}%`)).join(",");
      sql(
        `begin;set local session_replication_role=replica;do $cleanup$ declare t record;begin for t in select schemaname,tablename from pg_tables where schemaname='public' loop execute format('delete from %I.%I row_to_remove where to_jsonb(row_to_remove)::text like any ($1)',t.schemaname,t.tablename) using array[${patterns}];end loop;end $cleanup$;delete from public.record_release_policy where id;${priorPolicy === "null" ? "" : `insert into public.record_release_policy select * from jsonb_populate_record(null::public.record_release_policy,${quote(priorPolicy)}::jsonb);`}commit;`,
      );
    }
    if (actor) {
      const removed = await fetch(
        `${env.API_URL}/auth/v1/admin/users/${actor}`,
        { method: "DELETE", headers: serviceHeaders },
      );
      if (!removed.ok)
        failures.push(new Error("Local synthetic auth user cleanup failed"));
    }
  } catch (cleanupError) {
    failures.push(cleanupError);
  }
}

if (failures.length)
  throw new AggregateError(
    failures,
    "Local document-link HTTP check or cleanup failed",
  );
