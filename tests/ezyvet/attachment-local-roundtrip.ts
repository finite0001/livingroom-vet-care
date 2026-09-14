/** Attachment metadata through real local HTTP, Auth and PostgREST; synthetic upstream only. */
import { createServer } from "node:http";
import type { RequestListener } from "node:http";
import { attachmentCleanupRuntime } from "../../supabase/functions/ezyvet-attachment-cleanup/runtime.ts";
import { attachmentCaptureRuntime } from "../../supabase/functions/ezyvet-attachment-capture/runtime.ts";
import { createAdapter } from "../../supabase/functions/ezyvet-import/adapter.ts";
import { readAttachmentForCapture } from "../../supabase/functions/ezyvet-import/attachment-capture-read.ts";
import { readAttachmentBytes } from "../../supabase/functions/ezyvet-import/attachment-bytes.ts";
import { createHandler } from "../../supabase/functions/ezyvet-import/handler.ts";
import type { ImportRun } from "../../supabase/functions/ezyvet-import/handler.ts";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
const project = process.env.PAYMENT_TEST_PROJECT;
assert.ok(project, "Explicit disposable local project configuration required");
const projectId = readFileSync(`${project}/supabase/config.toml`, "utf8").match(
  /^project_id\s*=\s*"([a-zA-Z0-9_-]+)"/m,
)?.[1];
assert.ok(projectId, "Explicit local project required");
assert.match(projectId, /^lrv-attachment-[a-f0-9]{12}$/, "Only generated attachment projects accepted");
const local = JSON.parse(
  execFileSync(
    "supabase",
    ["status", "--workdir", project, "--output", "json"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ),
);
assert.match(local.API_URL, /^http:\/\/127\.0\.0\.1:\d+$/);
const sql = (query: string) =>
  execFileSync(
    "docker",
    [
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
    ],
    { input: query, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
  ).trim();
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;

const includeCapture = process.env.INCLUDE_ATTACHMENT_CAPTURE === "true";
const storageObjects: string[] = [];
const ids: string[] = [];
const additionalActors: string[] = [];
let actor = "",
  client = "";
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
    const problem = await response.json().catch(() => ({}));
    throw { code: problem.code, message: problem.message };
  }
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}
const rpc = (name: string, args: Record<string, unknown>, staff = false) =>
  api("/rest/v1/rpc/" + name, args, staff ? staffHeaders : serviceHeaders);
const origin = "https://thelivingroom.vet";
let upstreamCalls = 0,
  wrongParent = false,
  loseAck = false;
const closeables: ReturnType<typeof createServer>[] = [];
const serve = async (handler: RequestListener) => {
  const server = createServer(handler);
  closeables.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}`;
};
try {
  const email = `prescriptionitem-import-${randomUUID()}@example.test`,
    password = `Synthetic-${randomUUID()}-Aa1!`;
  actor = (
    await api("/auth/v1/admin/users", {
      email,
      password,
      email_confirm: true,
    })
  ).id;
  ids.push(actor);
  const auth = await api(
    "/auth/v1/token?grant_type=password",
    {
      email,
      password,
    },
    { apikey: local.ANON_KEY, "Content-Type": "application/json" },
  );
  staffHeaders = {
    apikey: local.ANON_KEY,
    Authorization: `Bearer ${auth.access_token}`,
    "Content-Type": "application/json",
  };
  sql(
    `insert into public.user_roles(user_id,role) values(${quote(
      actor,
    )},'ADMIN') on conflict do nothing;`,
  );
  client = (
    await rpc(
      "save_client",
      {
        p_actor_id: actor,
        p_client_id: null,
        p_expected_version: null,
        p_first_name: "Synthetic",
        p_last_name: "PrescriptionItem source",
        p_primary_phone: null,
        p_primary_email: null,
        p_preferred_channel: "EMAIL",
        p_mailing_address: null,
        p_housecall_address: null,
      },
      true,
    )
  ).id;
  ids.push(client);
  const pet = (
    await rpc(
      "save_patient",
      {
        p_id: null,
        p_client_id: client,
        p_expected_version: null,
        p_name: "Synthetic prescriptionitem import",
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
      },
      true,
    )
  ).id;
  ids.push(pet);
  const snapshot = randomUUID(),
    mapping = randomUUID(),
    otherMapping = randomUUID(),
    siteId = randomUUID(),
    site = "Synthetic-" + siteId;
  ids.push(snapshot, mapping, otherMapping, siteId);
  sql(
    `insert into public.ezyvet_import_snapshots(id,source_origin,source_site_uid,resource,external_id,payload,payload_hash,first_seen_by) values(${quote(
      snapshot,
    )},'https://api.trial.ezyvet.com',${quote(
      site,
    )},'animal','77','{"id":77,"contact_id":8}','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',${quote(
      actor,
    )});
 insert into public.ezyvet_import_snapshots(id,source_origin,source_site_uid,resource,external_id,payload,payload_hash,first_seen_by) values(${quote(
   otherMapping,
 )},'https://api.trial.ezyvet.com',${quote(
   site,
 )},'animal','78','{"id":78,"contact_id":8}','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',${quote(
   actor,
 )});
 insert into public.ezyvet_record_links(id,request_id,request_hash,source_origin,source_site_uid,resource,external_id,snapshot_id,head_version,client_id,pet_id,local_version,action,reason,approved_by) select x,x,'synthetic-link','https://api.trial.ezyvet.com',${quote(
   site,
 )},'animal',case when x=${quote(
   mapping,
 )}::uuid then '77' else '78' end,case when x=${quote(mapping)}::uuid then ${quote(
   snapshot,
 )}::uuid else ${quote(otherMapping)}::uuid end,1,${quote(client)},${quote(
   pet,
 )},1,'link','SYNTHETIC TEST ONLY',${quote(actor)} from unnest(array[${quote(
   mapping,
 )}::uuid,${quote(otherMapping)}::uuid]) x;`,
  );
  sql(`insert into ezyvet_identity_heads(source_origin,source_site_uid,resource,external_id,snapshot_id,version) values('https://api.trial.ezyvet.com',${quote(site)},'animal','77',${quote(snapshot)},1);`);
  const consultRun = randomUUID(); ids.push(consultRun);
  const consultClaim = await rpc("claim_ezyvet_clinical_import", { p_id: consultRun, p_actor: actor, p_site_uid: site, p_resource: "consult", p_source_origin: "https://api.trial.ezyvet.com", p_animal_link_id: mapping });
  await rpc("stage_ezyvet_import_page", { p_id: consultRun, p_actor: actor, p_lease_id: consultClaim.lease_id, p_page: 1, p_complete: true, p_items: [{ external_id: "201", payload: { id: 201, animal_id: 77 } }] });
  const consult = JSON.parse(sql(`select jsonb_build_object('id',s.id,'hash',s.payload_hash,'version',h.version) from ezyvet_import_snapshots s join ezyvet_identity_heads h on h.snapshot_id=s.id where s.source_site_uid=${quote(site)} and s.resource='consult';`));
  const effects = () => sql("select jsonb_build_array((select count(*) from patient_documents),(select count(*) from patient_treatments),(select count(*) from billing_invoices),(select count(*) from inventory_movements),(select count(*) from communication_outbox));");
  const beforeEffects = effects();
  const original = new TextEncoder().encode("%PDF-1.7\nSynthetic captured original\n%%EOF");
  const attachmentPayload = (kind: string, page: number) => ({ id: (kind === "Animal" ? 700 : 800) + page, record_type: kind, record_id: wrongParent ? "999" : kind === "Animal" ? "77" : "201", mime_type: includeCapture && page === 1 ? "application/pdf" : "unsupported/example", name: "<script>source name</script>", file_download_url: "https://untrusted.example.test/do-not-fetch" });
  const upstream = await serve(async (req, res) => {
    upstreamCalls++;
    const url = new URL(req.url!, "http://synthetic.test");
    res.setHeader("Content-Type", "application/json");
    if (url.pathname === "/v1/oauth/access_token") { res.end(JSON.stringify({ access_token: "synthetic-only", expires_in: 43200 })); return; }
    if (includeCapture && /^\/v1\/attachment\/download\/(701|801)$/.test(url.pathname)) {
      assert.equal(req.method, "GET"); res.setHeader("Content-Type", "application/pdf"); res.end(original); return;
    }
    assert.equal(url.pathname, "/v1/attachment"); assert.equal(req.method, "GET");
    if (includeCapture && url.searchParams.has("id")) {
      assert.deepEqual([...url.searchParams.keys()].sort(), ["id", "limit", "page", "record_id", "record_type"]);
      const kind = url.searchParams.get("record_type")!;
      assert.ok(kind === "Animal" || kind === "Consult"); assert.equal(url.searchParams.get("record_id"), kind === "Animal" ? "77" : "201");
      assert.equal(url.searchParams.get("id"), kind === "Animal" ? "701" : "801");
      res.end(JSON.stringify({ meta: { items_page: 1, items_page_total: 1 }, items: [{ attachment: attachmentPayload(kind, 1) }] })); return;
    }
    assert.deepEqual([...url.searchParams.keys()].sort(), ["limit", "page", "record_id", "record_type"]);
    const kind = url.searchParams.get("record_type"); assert.ok(kind === "Animal" || kind === "Consult");
    assert.equal(url.searchParams.get("record_id"), kind === "Animal" ? "77" : "201");
    assert.equal(url.searchParams.get("limit"), "10");
    const page = Number(url.searchParams.get("page"));
    res.end(JSON.stringify({ meta: { items_page: page, items_page_total: 2 }, items: [{ attachment: attachmentPayload(kind!, page) }] }));
  });
  const env: Record<string, string> = { APP_URL: origin, APP_ENV: "staging", EZYVET_IMPORT_MODE: "staging", EZYVET_SITE_UID: site, EZYVET_CLIENT_ID: "synthetic", EZYVET_CLIENT_SECRET: "synthetic", EZYVET_READ_RESOURCES: "attachment" };
  const handler = createHandler({ env: key => env[key], now: Date.now, sleep: async () => {}, fetch: async (input, init) => {
    const url = new URL(String(input)); assert.equal(url.origin, "https://api.trial.ezyvet.com");
    assert.equal(init?.redirect, "error"); return fetch(upstream + url.pathname + url.search, init);
  }, gateway: {
    authenticate: async bearer => {
      const response = await fetch(local.API_URL + "/auth/v1/user", { headers: { apikey: local.ANON_KEY, Authorization: `Bearer ${bearer}` } });
      if (!response.ok) return null; const user = await response.json();
      return { id: user.id, activeAdmin: await rpc("ezyvet_is_active_admin", { p_actor: user.id }) };
    },
    claim: async () => { throw new Error("Attachments must not use generic claim"); },
    claimAttachment: async (id, actor, site, sourceOrigin, animalLinkId, parentType, parentSnapshotId, parentPayloadHash, parentVersion) => rpc("claim_ezyvet_attachment_import", { p_id: id, p_actor: actor, p_site_uid: site, p_source_origin: sourceOrigin, p_animal_link_id: animalLinkId, p_parent_type: parentType, p_parent_snapshot_id: parentSnapshotId, p_parent_payload_hash: parentPayloadHash, p_parent_observed_head_version: parentVersion }),
    stage: async (run, actor, page) => {
      const result = await rpc("stage_ezyvet_import_page", { p_id: run.id, p_actor: actor, p_lease_id: run.lease_id, p_page: page.page, p_complete: page.complete, p_items: page.items });
      if (loseAck) { loseAck = false; throw new Error("Synthetic lost committed acknowledgment"); }
      return result as ImportRun;
    },
    fail: async (run, actor, code, seconds) => { await rpc("fail_ezyvet_import_page", { p_id: run.id, p_actor: actor, p_lease_id: run.lease_id, p_code: code, p_retry_seconds: seconds }); },
  } });
  const edge = await serve(async (req, res) => {
    try {
      const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const response = await handler(new Request(origin + "/ezyvet-import", { method: req.method, headers: req.headers as Record<string, string>, body: Buffer.concat(chunks) }));
      res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(await response.text());
    } catch { res.writeHead(500); res.end("Synthetic HTTP adapter failed"); }
  });
  const post = (body: Record<string, unknown>, authorized = true) => fetch(edge, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json", ...(authorized ? { Authorization: staffHeaders.Authorization } : {}) }, body: JSON.stringify(body) });
  let captureEnabled = true, loseWorkerUpload = false, loseWorkerComplete = false, loseWorkerReserve = false;
  const captureRuntime = attachmentCaptureRuntime(key => ({ ...env, SUPABASE_URL: local.API_URL, SUPABASE_ANON_KEY: local.ANON_KEY, SUPABASE_SERVICE_ROLE_KEY: local.SERVICE_ROLE_KEY, EZYVET_ATTACHMENT_CAPTURE_ENABLED: captureEnabled ? "true" : "false" })[key], async (input, init) => {
    const url = new URL(String(input));
    if (url.origin === "https://api.trial.ezyvet.com") {
      const response = await fetch(upstream + url.pathname + url.search, init);
      return new Response(response.body, { status: response.status, headers: response.headers });
    }
    assert.equal(url.origin, local.API_URL);
    const response = await fetch(input, init);
    if (response.ok && init?.method === "POST") {
      if (loseWorkerUpload && url.pathname.startsWith("/storage/v1/object/ezyvet-attachments/")) { loseWorkerUpload = false; void response.body?.cancel(); throw new Error("Discarded upload acknowledgment"); }
      if (loseWorkerComplete && url.pathname.endsWith("/rpc/complete_ezyvet_attachment_capture")) { loseWorkerComplete = false; void response.body?.cancel(); throw new Error("Discarded capture acknowledgment"); }
      if (loseWorkerReserve && url.pathname.endsWith("/rpc/prepare_ezyvet_attachment_capture")) { loseWorkerReserve = false; void response.body?.cancel(); throw new Error("Discarded reservation acknowledgment"); }
    }
    return response;
  });
  const captureEdge = await serve(async (req, res) => {
    try {
      const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const response = await captureRuntime(new Request(origin + "/ezyvet-attachment-capture", { method: req.method, headers: req.headers as Record<string, string>, body: Buffer.concat(chunks) }));
      res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(await response.text());
    } catch { res.writeHead(500); res.end("Synthetic capture HTTP adapter failed"); }
  });
  const postCapture = (payload: Record<string, unknown>, authorized = true) => fetch(captureEdge, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json", ...(authorized ? { Authorization: staffHeaders.Authorization } : {}) }, body: JSON.stringify(payload) });
  let cleanupEnabled = true, loseCleanupClaim = false, loseCleanupDelete = false, loseCleanupComplete = false, cleanupStorageCalls = 0;
  let expectedCleanupPath = "";
  const cleanupRuntime = attachmentCleanupRuntime(key => ({ APP_ENV: "staging", APP_URL: origin, SUPABASE_URL: local.API_URL, SUPABASE_ANON_KEY: local.ANON_KEY, SUPABASE_SERVICE_ROLE_KEY: local.SERVICE_ROLE_KEY, EZYVET_ATTACHMENT_CLEANUP_ENABLED: cleanupEnabled ? "true" : undefined })[key], async (input, init) => {
    const url = new URL(String(input)); assert.equal(url.origin, local.API_URL);
    if (url.pathname.startsWith("/storage/v1/")) {
      cleanupStorageCalls++;
      assert.equal(new Headers(init?.headers).get("Authorization"), staffHeaders.Authorization);
      if (init?.method === "DELETE") assert.deepEqual(JSON.parse(String(init.body)), { prefixes: [expectedCleanupPath] });
    }
    const response = await fetch(input, init);
    if (response.ok) {
      if (loseCleanupClaim && url.pathname.endsWith("/rpc/claim_ezyvet_attachment_cleanup")) { loseCleanupClaim = false; void response.body?.cancel(); throw new Error("Discarded cleanup claim acknowledgment"); }
      if (loseCleanupDelete && init?.method === "DELETE") { loseCleanupDelete = false; void response.body?.cancel(); throw new Error("Discarded cleanup deletion acknowledgment"); }
      if (loseCleanupComplete && url.pathname.endsWith("/rpc/complete_ezyvet_attachment_cleanup")) { loseCleanupComplete = false; void response.body?.cancel(); throw new Error("Discarded cleanup completion acknowledgment"); }
    }
    return response;
  });
  const cleanupEdge = await serve(async (req, res) => {
    try {
      const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const response = await cleanupRuntime(new Request(origin + "/ezyvet-attachment-cleanup", { method: req.method, headers: req.headers as Record<string, string>, body: Buffer.concat(chunks) }));
      res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(await response.text());
    } catch { res.writeHead(500); res.end("Synthetic cleanup HTTP adapter failed"); }
  });
  const postCleanup = (payload: Record<string, unknown>, authorized = true) => fetch(cleanupEdge, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json", ...(authorized ? { Authorization: staffHeaders.Authorization } : {}) }, body: JSON.stringify(payload) });
  const resetCooldown = () => sql(`update ezyvet_import_runs set retry_after=null,lease_until=null where source_site_uid=${quote(site)} and resource='attachment';`);
  const discoveredParent = await rpc("get_ezyvet_attachment_animal_parent", { p_animal_link_id: mapping }, true);
  check(discoveredParent.pet_id === pet && discoveredParent.parent_snapshot_id === snapshot && discoveredParent.parent_observed_head_version === 1, "Actual parent discovery binds current approved patient mapping");
  let lastAttachmentRun = "";
  for (const parentType of ["Animal", "Consult"]) {
    resetCooldown();
    const runId = randomUUID(); ids.push(runId); lastAttachmentRun = runId;
    const body = { run_id: runId, resource: "attachment", animal_link_id: mapping, parent_type: parentType, parent_snapshot_id: parentType === "Animal" ? snapshot : consult.id, parent_payload_hash: parentType === "Animal" ? "a".repeat(64) : consult.hash, parent_observed_head_version: 1 };
    const beforeCalls = upstreamCalls;
    check((await post(body, false)).status === 401, "Anonymous metadata HTTP request denied");
    check((await post({ ...body, record_id: "999" })).status === 400, "Caller cannot choose arbitrary upstream parent ID");
    check(upstreamCalls === beforeCalls, "Denied requests make no upstream call");
    loseAck = true;
    check((await post(body)).status === 503, "First page committed but acknowledgment intentionally discarded");
    const pending = await rpc("recover_ezyvet_attachment_run", { p_id: runId, p_animal_link_id: mapping }, true);
    check(pending.status === "running" && pending.next_page === 2, "Real recovery exposes committed next page after lost reply");
    check(!("lease_id" in pending) && pending.parent_context.parent_type === parentType, "Recovery preserves parent pins without disclosing lease");
    resetCooldown(); loseAck = true;
    check((await post(body)).status === 503, "Terminal page committed but acknowledgment intentionally discarded");
    const terminal = await rpc("recover_ezyvet_attachment_run", { p_id: runId, p_animal_link_id: mapping }, true);
    check(terminal.status === "review_ready" && terminal.next_page === 3, "Both real pages are committed");
    const observed = await rpc("list_ezyvet_attachment_observations", { p_run_id: runId, p_pet_id: pet, p_limit: 1 }, true);
    check(observed.run_id === runId && observed.pet_id === pet && observed.parent_context.parent_type === parentType, "Actual observation discovery preserves run/patient/parent identity");
    check(observed.parent_is_current && observed.observations[0].is_current && observed.has_more, "Discovery distinguishes current source and available next page");
    check(!("file_download_url" in observed.observations[0].metadata), "Operator discovery does not expose upstream download URLs");
    const observedNext = await rpc("list_ezyvet_attachment_observations", { p_run_id: runId, p_pet_id: pet, p_limit: 1, p_after_page: observed.next_cursor.after_page, p_after_snapshot_id: observed.next_cursor.after_snapshot_id }, true);
    check(observedNext.observations[0].page === 2 && !observedNext.has_more && observedNext.next_cursor === null, "Observation cursor reaches the second committed page exactly");
    const callsAtTerminal = upstreamCalls;
    check((await post(body)).status === 200, "Terminal HTTP retry recovers exact owned context");
    check(upstreamCalls === callsAtTerminal, "Terminal retry performs no additional upstream request");
    check(sql(`select count(*) from ezyvet_attachment_pages where run_id=${quote(runId)};`) === "2", "Lost replies never duplicate page receipts");
    check(sql(`select count(*) from ezyvet_attachment_page_observations where run_id=${quote(runId)};`) === "2", "Exact source page observations retained");
    await assert.rejects(rpc("recover_ezyvet_attachment_run", { p_id: runId, p_animal_link_id: otherMapping }, true), (error: { code: string }) => error.code === "42501"); assertions++;
    if (includeCapture) {
      resetCooldown();
      const selected = JSON.parse(sql(`select jsonb_build_object('id',s.id,'hash',s.payload_hash,'version',o.head_version,'payload',s.payload) from ezyvet_attachment_page_observations o join ezyvet_import_snapshots s on s.id=o.snapshot_id where o.run_id=${quote(runId)} and o.page=1;`));
      const downloadId = randomUUID(); ids.push(downloadId);
      const prepared = await rpc("prepare_ezyvet_attachment_download", { p_id: downloadId, p_pet_id: pet, p_run_id: runId, p_page: 1, p_snapshot_id: selected.id, p_payload_hash: selected.hash, p_observed_head_version: selected.version }, true);
      const requestHash = prepared.request.request_hash;
      const lease = await rpc("claim_ezyvet_attachment_download", { p_id: downloadId, p_actor: actor, p_pet_id: pet, p_request_hash: requestHash });
      check(lease.attempt_no === 1, "Actual service claim creates owned capture attempt");
      const captureAdapter = createAdapter({ baseUrl: "https://api.trial.ezyvet.com", siteUid: site, clientId: "synthetic", clientSecret: "synthetic", readResources: ["attachment"] }, { now: Date.now, sleep: async () => {}, fetch: async (input, init) => {
        const url = new URL(String(input)); assert.equal(url.origin, "https://api.trial.ezyvet.com"); assert.equal(init?.redirect, "error");
        const result = await fetch(upstream + url.pathname + url.search, init);
        return new Response(result.body, { status: result.status, headers: result.headers });
      } });
      const captureParent = { parent_type: parentType as "Animal" | "Consult", parent_external_id: parentType === "Animal" ? "77" : "201" };
      const read = await readAttachmentForCapture(captureAdapter, String(selected.payload.id), captureParent, selected.payload);
      check(Buffer.from(read.file.bytes).equals(Buffer.from(original)), "Actual metadata-file-metadata sequence preserves original bytes");
      const intentArgs = { p_id: downloadId, p_actor: actor, p_lease_id: lease.lease_id, p_request_hash: requestHash, p_content_sha256: read.file.sha256, p_file_size: read.file.size, p_mime_type: read.file.mimeType, p_before_metadata: read.before, p_after_metadata: read.after };
      const intent = await rpc("prepare_ezyvet_attachment_capture", intentArgs);
      assert.equal(intent.bucket, "ezyvet-attachments"); assert.ok(intent.object_path.startsWith(`${actor}/${pet}/${downloadId}/`)); storageObjects.push(intent.object_path);
      check(JSON.stringify(await rpc("prepare_ezyvet_attachment_capture", intentArgs)) === JSON.stringify(intent), "Lost reservation acknowledgment recovers same allocated path");
      const objectUrl = local.API_URL + "/storage/v1/object/ezyvet-attachments/" + intent.object_path;
      const uploadHeaders = { apikey: local.ANON_KEY, Authorization: staffHeaders.Authorization, "Content-Type": read.file.mimeType, "x-upsert": "false" };
      const uploaded = await fetch(objectUrl, { method: "POST", headers: uploadHeaders, body: read.file.bytes });
      check(uploaded.ok, "Actual staff JWT uploads reserved original through Storage RLS");
      // Discard the successful upload response and recover through the durable request.
      const recovery = await rpc("recover_ezyvet_attachment_download", { p_id: downloadId, p_pet_id: pet }, true);
      check(recovery.capture === null && recovery.capture_intent.object_path === intent.object_path, "Ambiguous upload retains the exact reservation without a false capture receipt");
      check(!(await fetch(objectUrl, { method: "POST", headers: uploadHeaders, body: read.file.bytes })).ok, "Actual duplicate upload cannot overwrite original");
      check(!(await fetch(objectUrl, { method: "PUT", headers: { ...uploadHeaders, "x-upsert": "true" }, body: read.file.bytes })).ok, "Actual authenticated replacement is denied");
      const downloaded = await fetch(local.API_URL + "/storage/v1/object/authenticated/ezyvet-attachments/" + intent.object_path, { headers: { apikey: local.ANON_KEY, Authorization: staffHeaders.Authorization, "Accept-Encoding": "identity" } });
      const verified = await readAttachmentBytes(downloaded, intent.mime_type, AbortSignal.timeout(5000));
      check(verified.sha256 === intent.content_sha256 && verified.size === intent.file_size, "Physical Storage readback matches frozen digest and size");
      const finalMetadata = await captureAdapter.attachmentMetadata(String(selected.payload.id), captureParent);
      const completeArgs = { p_id: downloadId, p_actor: actor, p_lease_id: lease.lease_id, p_request_hash: requestHash, p_intent_hash: intent.intent_hash, p_verified_sha256: verified.sha256, p_verified_size: verified.size, p_verified_mime: verified.mimeType, p_final_metadata: finalMetadata.payload };
      const receipt = await rpc("complete_ezyvet_attachment_capture", completeArgs);
      check(receipt.content_sha256 === read.file.sha256, "Actual capture binds verified physical bytes");
      check(JSON.stringify(await rpc("complete_ezyvet_attachment_capture", completeArgs)) === JSON.stringify(receipt), "Lost capture acknowledgment recovers exact receipt");
      const final = await rpc("recover_ezyvet_attachment_download", { p_id: downloadId, p_pet_id: pet }, true);
      check(final.request.status === "captured" && final.capture.capture_hash === receipt.capture_hash && !JSON.stringify(final).includes(lease.lease_id), "Owner recovery exposes completion without service lease");
      const noFetch = upstreamCalls;
      check((await rpc("claim_ezyvet_attachment_download", { p_id: downloadId, p_actor: actor, p_pet_id: pet, p_request_hash: requestHash })).status === "captured" && upstreamCalls === noFetch, "Terminal service claim recovers without a new source read");
      // Exercise the production runtime adapter and handler through actual loopback HTTP.
      for (const reservationInterrupted of [false, true]) {
        const operation = randomUUID(); ids.push(operation);
        const preparedWorker = await rpc("prepare_ezyvet_attachment_download", { p_id: operation, p_pet_id: pet, p_run_id: runId, p_page: 1, p_snapshot_id: selected.id, p_payload_hash: selected.hash, p_observed_head_version: selected.version }, true);
        const workerBody = { request_id: operation, pet_id: pet, request_hash: preparedWorker.request.request_hash };
        const beforeWorker = upstreamCalls;
        check((await postCapture(workerBody, false)).status === 401, "Actual worker HTTP rejects an anonymous request");
        check((await postCapture({ ...workerBody, object_path: "untrusted/original" })).status === 400, "Actual worker rejects caller-chosen Storage path");
        captureEnabled = false;
        check((await postCapture(workerBody)).status === 503 && upstreamCalls === beforeWorker, "Disabled worker makes no source read or claim"); captureEnabled = true;
        if (reservationInterrupted) {
          loseWorkerReserve = true;
          check((await postCapture(workerBody)).status === 503, "Lost reservation acknowledgment remains recoverable through worker response");
          const interrupted = await rpc("recover_ezyvet_attachment_download", { p_id: operation, p_pet_id: pet }, true);
          check(interrupted.request.status === "pending" && interrupted.capture_intent && interrupted.capture === null, "Interrupted worker retains reservation and no false capture");
          storageObjects.push(interrupted.capture_intent.object_path);
          // Explicit owner-only disposable clock simulation for the retry receipt.
          sql(`begin;set local session_replication_role=replica;update ezyvet_attachment_download_failures set retry_after=clock_timestamp()-interval '1 second' where lease_id in(select lease_id from ezyvet_attachment_download_attempts where request_id=${quote(operation)});commit;`);
        } else { loseWorkerUpload = true; loseWorkerComplete = true; }
        const workerResponse = await postCapture(workerBody);
        check(workerResponse.status === 200, "Actual capture endpoint completes through Auth, RPC, source and private Storage");
        const workerResult = await workerResponse.json();
        check(Object.keys(workerResult).sort().join(",") === "capture_hash,request_id,status" && workerResult.request_id === operation && workerResult.status === "captured", "Worker returns only an owned capture summary");
        const workerRecovery = await rpc("recover_ezyvet_attachment_download", { p_id: operation, p_pet_id: pet }, true);
        if (!reservationInterrupted) storageObjects.push(workerRecovery.capture_intent.object_path);
        check(workerRecovery.capture.capture_hash === workerResult.capture_hash && workerRecovery.capture.content_sha256 === read.file.sha256, "Production runtime receipt matches verified original");
        const unchangedCalls = upstreamCalls;
        check((await postCapture(workerBody)).status === 200 && upstreamCalls === unchangedCalls, "Completed worker retry performs no source or file transfer");
      }

      const cleanupRequest = randomUUID(), cleanupId = randomUUID(); ids.push(cleanupRequest, cleanupId);
      const cleanupPrepared = await rpc("prepare_ezyvet_attachment_download", { p_id: cleanupRequest, p_pet_id: pet, p_run_id: runId, p_page: 1, p_snapshot_id: selected.id, p_payload_hash: selected.hash, p_observed_head_version: selected.version }, true);
      const cleanupHash = cleanupPrepared.request.request_hash;
      const cleanupCaptureLease = await rpc("claim_ezyvet_attachment_download", { p_id: cleanupRequest, p_actor: actor, p_pet_id: pet, p_request_hash: cleanupHash });
      const cleanupIntent = await rpc("prepare_ezyvet_attachment_capture", { ...intentArgs, p_id: cleanupRequest, p_lease_id: cleanupCaptureLease.lease_id, p_request_hash: cleanupHash });
      expectedCleanupPath = cleanupIntent.object_path; storageObjects.push(expectedCleanupPath);
      const cleanupUpload = await fetch(local.API_URL + "/storage/v1/object/ezyvet-attachments/" + expectedCleanupPath, { method: "POST", headers: uploadHeaders, body: read.file.bytes });
      check(cleanupUpload.ok, "Actual abandoned-cleanup fixture uploads original with owner JWT"); void cleanupUpload.body?.cancel();
      const cleanupBody = { cleanup_id: cleanupId, request_id: cleanupRequest, pet_id: pet, request_hash: cleanupHash };
      const sourceCallsBeforeCleanup = upstreamCalls, storageCallsBeforeCleanup = cleanupStorageCalls;
      check((await postCleanup(cleanupBody, false)).status === 401, "Cleanup HTTP rejects anonymous callers");
      check((await postCleanup({ ...cleanupBody, object_path: expectedCleanupPath })).status === 400, "Cleanup HTTP rejects caller-supplied paths");
      check((await postCleanup(cleanupBody)).status === 409, "Pending ambiguous upload is not cleaned");
      check((await postCleanup({ ...cleanupBody, request_id: downloadId, request_hash: requestHash })).status === 409, "Completed capture cannot enter cleanup");
      check(cleanupStorageCalls === storageCallsBeforeCleanup, "Denied cleanup performs no Storage operation");
      // Disposable fixture clock only: expire upload lease, explicitly abandon,
      // then move the abandonment grace deadline into the past.
      sql(`begin;set local session_replication_role=replica;update ezyvet_attachment_download_attempts set created_at=clock_timestamp()-interval '10 minutes',lease_until=clock_timestamp()-interval '5 minutes' where lease_id=${quote(cleanupCaptureLease.lease_id)};commit;`);
      await rpc("abandon_ezyvet_attachment_download", { p_id: cleanupRequest, p_pet_id: pet, p_confirmed: true }, true);
      check((await postCleanup(cleanupBody)).status === 409, "Fresh abandonment still requires cleanup grace period");
      sql(`begin;set local session_replication_role=replica;update ezyvet_attachment_download_requests set resolved_at=clock_timestamp()-interval '5 minutes' where id=${quote(cleanupRequest)};commit;`);
      cleanupEnabled = false; check((await postCleanup(cleanupBody)).status === 503, "Cleanup remains separately default-off"); cleanupEnabled = true;
      loseCleanupClaim = true;
      check((await postCleanup(cleanupBody)).status === 503, "Lost cleanup claim response leaves a retryable durable operation");
      const cleanupSaved = await rpc("recover_ezyvet_attachment_cleanup", { p_cleanup_id: cleanupId, p_id: cleanupRequest, p_pet_id: pet }, true);
      check(cleanupSaved.attempt.id === cleanupId && cleanupSaved.receipt === null && !("lease_id" in cleanupSaved.attempt), "Owner recovers cleanup attempt without exposing worker lease");
      loseCleanupDelete = true; loseCleanupComplete = true;
      const cleanupResponse = await postCleanup(cleanupBody); check(cleanupResponse.status === 200, "Actual deletion and completion recover after both successful replies are lost");
      const cleanupResult = await cleanupResponse.json();
      check(Object.keys(cleanupResult).sort().join(",") === "cleanup_id,request_id,status,verified_absent_at" && cleanupResult.status === "cleanup_recorded", "Cleanup HTTP exposes only owned point-in-time receipt summary");
      const afterCleanup = await rpc("recover_ezyvet_attachment_cleanup", { p_cleanup_id: cleanupId, p_id: cleanupRequest, p_pet_id: pet }, true);
      check(afterCleanup.receipt.verified_absent_at === cleanupResult.verified_absent_at, "Lost cleanup completion recovers exact durable receipt");
      check(sql(`select count(*) from storage.objects where bucket_id='ezyvet-attachments' and name=${quote(expectedCleanupPath)};`) === "0", "Storage API deletion removes actual reserved object metadata");
      check(sql(`select status from ezyvet_attachment_download_requests where id=${quote(cleanupRequest)};`) === "abandoned", "Physical cleanup retains permanent abandonment tombstone");
      const retryCalls = cleanupStorageCalls;
      check((await postCleanup(cleanupBody)).status === 200 && cleanupStorageCalls === retryCalls, "Completed cleanup retry returns receipt without another file operation");
      const laterCleanup = randomUUID(); ids.push(laterCleanup);
      check((await postCleanup({ ...cleanupBody, cleanup_id: laterCleanup })).status === 200, "Later explicit sweep verifies already absent reserved path");
      const cleanupHistory = await rpc("list_ezyvet_attachment_cleanups", { p_id: cleanupRequest, p_pet_id: pet, p_limit: 1 }, true);
      check(cleanupHistory.cleanups[0].attempt.id === laterCleanup && cleanupHistory.cleanups[0].receipt.cleanup_id === laterCleanup && !cleanupHistory.cleanups[0].lease_active && !("lease_id" in cleanupHistory.cleanups[0].attempt), "Actual cleanup discovery exposes newest receipt without worker lease");
      const cleanupOlder = await rpc("list_ezyvet_attachment_cleanups", { p_id: cleanupRequest, p_pet_id: pet, p_limit: 1, p_before_at: cleanupHistory.next_cursor.before_at, p_before_id: cleanupHistory.next_cursor.before_id }, true);
      check(cleanupOlder.cleanups[0].receipt.cleanup_id === cleanupId && !cleanupOlder.has_more, "Actual cleanup cursor recovers prior exact operation without browser storage");
      check(upstreamCalls === sourceCallsBeforeCleanup, "Cleanup needs no provider credentials or source traffic");

    }
    const freshId = randomUUID(); ids.push(freshId); resetCooldown(); wrongParent = true;
    check((await post({ ...body, run_id: freshId })).status === 503, "Real HTTP intake rejects wrong-parent upstream metadata"); wrongParent = false;
    check(sql(`select count(*) from ezyvet_attachment_pages where run_id=${quote(freshId)};`) === "0", "Rejected page leaves no receipt");
    const resource = parentType === "Animal" ? "animal" : "consult";
    sql(`update ezyvet_identity_heads set version=version+1 where source_site_uid=${quote(site)} and resource=${quote(resource)};`);
    const historicalObservations = await rpc("list_ezyvet_attachment_observations", { p_run_id: runId, p_pet_id: pet }, true);
    check(!historicalObservations.parent_is_current && historicalObservations.observations.length === 2, "Original observed files stay discoverable after parent source changes");
    resetCooldown(); const staleCalls = upstreamCalls;
    const stale = await post({ ...body, run_id: freshId });
    check(stale.status === 409 && (await stale.json()).retry_safe === false, "Changed parent is actionable conflict through actual RPC");
    check(upstreamCalls === staleCalls, "Changed parent cannot trigger a fresh upstream read");
    check((await post(body)).status === 200 && upstreamCalls === staleCalls, "Original terminal receipt remains recoverable after parent revision");
  }
  check((await rpc("list_ezyvet_attachment_runs", { p_animal_link_id: mapping }, true)).runs.length === 4, "Actual staff discovery includes terminal and pending runs");
  const privateRows = await fetch(local.API_URL + "/rest/v1/ezyvet_attachment_runs?select=run_id", { headers: staffHeaders });
  check(privateRows.status === 401 || privateRows.status === 403, "Private run table denies direct staff access");
  sql(`delete from user_roles where user_id=${quote(actor)} and role='ADMIN';`);
  check((await post({ run_id: randomUUID(), resource: "attachment" })).status === 403, "Role loss prevents HTTP import");
  await assert.rejects(rpc("list_ezyvet_attachment_runs", { p_animal_link_id: mapping }, true), (error: { code: string }) => error.code === "42501"); assertions++;
  await assert.rejects(rpc("list_ezyvet_attachment_observations", { p_run_id: lastAttachmentRun, p_pet_id: pet }, true), (error: { code: string }) => error.code === "42501"); assertions++;
  check(effects() === beforeEffects, "Metadata intake creates no documents, native treatments, billing, stock or messages");
} catch (error) {
  failures.push(error);
} finally {
  for (const server of closeables.reverse()) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  try {
    if (storageObjects.length) {
      const removed = await fetch(local.API_URL + "/storage/v1/object/ezyvet-attachments", { method: "DELETE", headers: serviceHeaders, body: JSON.stringify({ prefixes: storageObjects }) });
      assert.ok(removed.ok);
      check(sql(`select count(*) from storage.objects where bucket_id='ezyvet-attachments' and name in (${storageObjects.map(quote).join(",")});`) === "0", "Owned physical Storage objects removed through actual API");
    }
    if (ids.length) {
      const patterns = ids.map((value) => quote(`%${value}%`)).join(",");
      sql(
        `begin;set local session_replication_role=replica;do $cleanup$ declare t record;begin for t in select schemaname,tablename from pg_tables where schemaname='public' loop execute format('delete from %I.%I r where to_jsonb(r)::text like any ($1)',t.schemaname,t.tablename) using array[${patterns}];end loop;end $cleanup$;commit;`,
      );
      sql(
        `do $verify$ declare t record; n bigint; begin for t in select schemaname,tablename from pg_tables where schemaname='public' loop execute format('select count(*) from %I.%I r where to_jsonb(r)::text like any ($1)',t.schemaname,t.tablename) into n using array[${patterns}]; if n<>0 then raise exception 'Synthetic rows remain'; end if; end loop; end $verify$;`,
      );
      check(
        true,
        "Aggregate verification confirms no owned fixture rows remain",
      );
    }
    for (const ownedActor of [actor, ...additionalActors].filter(Boolean)) {
      check(
        (
          await fetch(local.API_URL + "/auth/v1/admin/users/" + ownedActor, {
            method: "DELETE",
            headers: serviceHeaders,
          })
        ).ok,
        "Synthetic Auth user cleaned",
      );
      const absent = await fetch(
        local.API_URL + "/auth/v1/admin/users/" + ownedActor,
        { headers: serviceHeaders },
      );
      check(absent.status === 404, "Deleted synthetic Auth identity is absent");
    }
  } catch {
    failures.push(new Error("Synthetic fixture cleanup failed"));
  }
}
if (failures.length) {
  throw new Error(
    "Attachment local integration failed: " +
      failures
        .map((e) =>
          e instanceof Error
            ? e.message
            : typeof e === "object" && e && "code" in e
              ? String(e.code)
              : "unknown",
        )
        .join(", "),
  );
}
console.log(
  `${includeCapture ? "Attachment capture HTTP/Auth/Storage" : "Attachment metadata HTTP/Auth/PostgREST"}: ${assertions} checks passed. Synthetic upstream only; no ezyVet requests.`,
);
