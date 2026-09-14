import { dispatchOne } from "../../supabase/functions/_shared/outbox-dispatch.ts";
import { createRetrieveDocumentLinkHandler, createStaffDocumentLinkHandler } from "../../supabase/functions/_shared/document-link-http.ts";
import { documentLinkConfig } from "../../supabase/functions/_shared/document-link-capability.ts";
import { createPrepareReleaseEmailHandler } from "../../supabase/functions/_shared/prepare-release-email.ts";
import { renderRecordRelease } from "../../supabase/functions/_shared/record-release-renderer.ts";
import { parseAttachmentChart, parseAttachmentChartOriginal } from "../../src/hub/features/imports/attachment-chart-state.ts";
import { parseAttachmentDecisionOutcome } from "../../src/hub/features/imports/attachment-decision-state.ts";
import { parseAttachmentReviewHistory } from "../../src/hub/features/imports/attachment-review-state.ts";
import { verifyAttachmentOriginal } from "../../src/hub/features/imports/attachment-original.ts";
import { parseAttachmentCleanupHistory, parseAttachmentCleanupRecovery } from "../../src/hub/features/imports/attachment-cleanup-state.ts";
import { parseAttachmentFileHistory, parseAttachmentFileRecovery } from "../../src/hub/features/imports/attachment-file-state.ts";
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
const nativeFixturePaths: string[] = [];
const boundaryRunIds: string[] = [];
const deliveryFixtureIds: string[] = [];
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
let chartActor = "", chartHeaders: Record<string, string> = {};
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
  if (includeCapture) {
    const chartEmail = `attachment-reviewer-${randomUUID()}@example.test`, chartPassword = `Synthetic-${randomUUID()}-Aa1!`;
    chartActor = (await api("/auth/v1/admin/users", { email: chartEmail, password: chartPassword, email_confirm: true })).id;
    additionalActors.push(chartActor); ids.push(chartActor);
    sql(`insert into user_roles(user_id,role) values(${quote(chartActor)},'DVM');`);
    const chartAuth = await api("/auth/v1/token?grant_type=password", { email: chartEmail, password: chartPassword }, { apikey: local.ANON_KEY, "Content-Type": "application/json" });
    chartHeaders = { apikey: local.ANON_KEY, Authorization: `Bearer ${chartAuth.access_token}`, "Content-Type": "application/json" };
  }
  client = (
    await rpc(
      "save_client",
      {
        p_actor_id: actor,
        p_client_id: null,
        p_expected_version: null,
        p_first_name: "Synthetic",
        p_last_name: "PrescriptionItem source",
        p_primary_phone: "+13035550481",
        p_primary_email: email,
        p_preferred_channel: "EMAIL",
        p_mailing_address: null,
        p_housecall_address: null,
      },
      true,
    )
  ).id;
  ids.push(client);
  if (includeCapture) await rpc("record_sms_consent", { p_actor_id: actor, p_client_id: client, p_phone: "+13035550481", p_opted_in: true, p_method: "WRITTEN", p_details: "Synthetic local consent only", p_expected_updated_at: null }, true);
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
  let boundaryBatch = false;
  const attachmentPayload = (kind: string, page: number) => ({ id: (kind === "Animal" ? 700 : 800) + page, record_type: kind, record_id: wrongParent ? "999" : kind === "Animal" ? "77" : "201", mime_type: includeCapture ? "application/pdf" : "unsupported/example", name: "<script>source name</script>", file_download_url: "https://untrusted.example.test/do-not-fetch" });
  const upstream = await serve(async (req, res) => {
    upstreamCalls++;
    const url = new URL(req.url!, "http://synthetic.test");
    res.setHeader("Content-Type", "application/json");
    if (url.pathname === "/v1/oauth/access_token") { res.end(JSON.stringify({ access_token: "synthetic-only", expires_in: 43200 })); return; }
    if (includeCapture && /^\/v1\/attachment\/download\/[78][0-9]{2}$/.test(url.pathname)) {
      assert.equal(req.method, "GET"); res.setHeader("Content-Type", "application/pdf"); const bytes = original.slice(); const number = Number(url.pathname.split("/").at(-1)) % 100; assert.ok(number >= 1 && number <= 20); if (number > 1) bytes[bytes.length - 1] ^= number === 2 ? 4 : number + 4; res.end(bytes); return;
    }
    assert.equal(url.pathname, "/v1/attachment"); assert.equal(req.method, "GET");
    if (includeCapture && url.searchParams.has("id")) {
      assert.deepEqual([...url.searchParams.keys()].sort(), ["id", "limit", "page", "record_id", "record_type"]);
      const kind = url.searchParams.get("record_type")!;
      assert.ok(kind === "Animal" || kind === "Consult"); assert.equal(url.searchParams.get("record_id"), kind === "Animal" ? "77" : "201");
      const selectedPage = Number(url.searchParams.get("id")) - (kind === "Animal" ? 700 : 800); assert.ok(selectedPage >= 1 && selectedPage <= 20);
      res.end(JSON.stringify({ meta: { items_page: 1, items_page_total: 1 }, items: [{ attachment: attachmentPayload(kind, selectedPage) }] })); return;
    }
    assert.deepEqual([...url.searchParams.keys()].sort(), ["limit", "page", "record_id", "record_type"]);
    const kind = url.searchParams.get("record_type"); assert.ok(kind === "Animal" || kind === "Consult");
    assert.equal(url.searchParams.get("record_id"), kind === "Animal" ? "77" : "201");
    assert.equal(url.searchParams.get("limit"), "10");
    const page = Number(url.searchParams.get("page"));
    res.end(JSON.stringify({ meta: { items_page: page, items_page_total: 2 }, items: (boundaryBatch ? Array.from({ length: 10 }, (_, index) => (page - 1) * 10 + index + 1) : [page]).map(index => ({ attachment: attachmentPayload(kind!, index) })) }));
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
  check(sql("select not has_function_privilege('authenticated','public.approve_ezyvet_attachment_record_uncancelled(uuid,uuid,uuid,text,uuid,text,text,boolean)','EXECUTE') and not has_function_privilege('service_role','public.approve_ezyvet_attachment_record_uncancelled(uuid,uuid,uuid,text,uuid,text,text,boolean)','EXECUTE');") === "t", "API roles cannot bypass the cancellation-aware approval wrapper");
  let lastAttachmentRun = "", lastAttachmentApproval = "", lastCapturedAttachment = "";
  check(sql("select not has_table_privilege('authenticated','public.ezyvet_attachment_record_versions','SELECT,INSERT,UPDATE,DELETE') and not has_table_privilege('service_role','public.ezyvet_attachment_record_versions','SELECT,INSERT,UPDATE,DELETE');") === "t", "API approval history denies direct client and service-role table access");
  check(sql("select not has_function_privilege('anon','public.approve_ezyvet_attachment_record(uuid,uuid,uuid,text,uuid,text,text,boolean)','EXECUTE') and not has_function_privilege('service_role','public.approve_ezyvet_attachment_record(uuid,uuid,uuid,text,uuid,text,text,boolean)','EXECUTE');") === "t", "Approval RPC requires authenticated actor context rather than anonymous/service execution");
  for (const parentType of ["Animal", "Consult"]) {
    resetCooldown();
    const runId = randomUUID(); ids.push(runId); lastAttachmentRun = runId;
    const body = { run_id: runId, resource: "attachment", animal_link_id: mapping, parent_type: parentType, parent_snapshot_id: parentType === "Animal" ? snapshot : consult.id, parent_payload_hash: parentType === "Animal" ? "a".repeat(64) : consult.hash, parent_observed_head_version: 1 };
    const prepareArgs = { p_id: runId, p_animal_link_id: mapping, p_parent_type: parentType, p_parent_snapshot_id: body.parent_snapshot_id, p_parent_payload_hash: body.parent_payload_hash, p_parent_observed_head_version: 1 };
    const preparationCalls = upstreamCalls;
    const preparedScan = await rpc("prepare_ezyvet_attachment_scan", prepareArgs, true);
    check(preparedScan.id === runId && preparedScan.status === "running" && preparedScan.next_page === 1 && !preparedScan.lease_active, "Authenticated preparation saves an unleased first-page scan");
    check(preparedScan.parent_context.parent_type === parentType && preparedScan.parent_context.pet_id === pet, "Prepared Animal/Consult scan pins exact reviewed patient context");
    const preparedRetry = await rpc("prepare_ezyvet_attachment_scan", prepareArgs, true);
    check(JSON.stringify(preparedRetry) === JSON.stringify(preparedScan), "Lost preparation acknowledgment recovers exact original scan");
    check(upstreamCalls === preparationCalls, "Scan preparation performs no provider requests");
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
      const inspectionBlob = await downloaded.clone().blob();
      const verified = await readAttachmentBytes(downloaded, intent.mime_type, AbortSignal.timeout(5000));
      check((await verifyAttachmentOriginal(inspectionBlob, intent)).size === intent.file_size, "Frontend original verifier accepts actual private Storage bytes");
      check(verified.sha256 === intent.content_sha256 && verified.size === intent.file_size, "Physical Storage readback matches frozen digest and size");
      const finalMetadata = await captureAdapter.attachmentMetadata(String(selected.payload.id), captureParent);
      const completeArgs = { p_id: downloadId, p_actor: actor, p_lease_id: lease.lease_id, p_request_hash: requestHash, p_intent_hash: intent.intent_hash, p_verified_sha256: verified.sha256, p_verified_size: verified.size, p_verified_mime: verified.mimeType, p_final_metadata: finalMetadata.payload };
      const receipt = await rpc("complete_ezyvet_attachment_capture", completeArgs);
      check(receipt.content_sha256 === read.file.sha256, "Actual capture binds verified physical bytes");
      check(JSON.stringify(await rpc("complete_ezyvet_attachment_capture", completeArgs)) === JSON.stringify(receipt), "Lost capture acknowledgment recovers exact receipt");
      const final = await rpc("recover_ezyvet_attachment_download", { p_id: downloadId, p_pet_id: pet }, true);
      check(final.request.status === "captured" && final.capture.capture_hash === receipt.capture_hash && !JSON.stringify(final).includes(lease.lease_id), "Owner recovery exposes completion without service lease");
      const sdkOriginal = await fetch(local.API_URL + "/storage/v1/object/ezyvet-attachments/" + intent.object_path, { headers: { apikey: local.ANON_KEY, Authorization: staffHeaders.Authorization } });
      check(sdkOriginal.ok && (await verifyAttachmentOriginal(await sdkOriginal.blob(), intent)).size === intent.file_size, "Exact frontend SDK route returns verifiable captured bytes under staff JWT");
      check(!(await fetch(local.API_URL + "/storage/v1/object/ezyvet-attachments/" + intent.object_path, { headers: chartHeaders })).ok, "Different staff member cannot read an unreviewed capture");
      const approvalId = randomUUID(), correctionId = randomUUID(), conflictingApproval = randomUUID(); ids.push(approvalId, correctionId, conflictingApproval);
      const approvalArgs = { p_id: approvalId, p_request_id: downloadId, p_pet_id: pet, p_capture_hash: receipt.capture_hash, p_previous_record_id: null, p_title: "Synthetic reviewed API attachment", p_review_reason: "Synthetic staff inspected the captured original", p_attest: true };
      await assert.rejects(rpc("approve_ezyvet_attachment_record", { ...approvalArgs, p_attest: false }, true), (error: { code: string }) => error.code === "23514"); assertions++;
      await assert.rejects(rpc("approve_ezyvet_attachment_record", { ...approvalArgs, p_capture_hash: "0".repeat(64) }, true), (error: { code: string }) => error.code === "42501"); assertions++;
      const canceledApproval = randomUUID(); ids.push(canceledApproval);
      const cancelArgs = { p_id: canceledApproval, p_request_id: downloadId, p_pet_id: pet, p_capture_hash: receipt.capture_hash, p_confirmed: true };
      const canceled = await rpc("cancel_ezyvet_attachment_approval", cancelArgs, true);
      check(canceled.status === "canceled" && canceled.record === null && canceled.cancellation.id === canceledApproval, "Explicit cancellation saves an owned terminal decision before approval");
      check(JSON.stringify(await rpc("cancel_ezyvet_attachment_approval", cancelArgs, true)) === JSON.stringify(canceled), "Cancellation retries recover the exact immutable receipt");
      check(JSON.stringify(await rpc("recover_ezyvet_attachment_approval", { p_id: canceledApproval, p_request_id: downloadId, p_pet_id: pet, p_capture_hash: receipt.capture_hash }, true)) === JSON.stringify(canceled), "Canceled decision is recoverable after browser state loss");
      await assert.rejects(rpc("approve_ezyvet_attachment_record", { ...approvalArgs, p_id: canceledApproval }, true), (error: { code: string }) => error.code === "23514"); assertions++;
      await assert.rejects(rpc("cancel_ezyvet_attachment_approval", { ...cancelArgs, p_pet_id: randomUUID() }, true), (error: { code: string }) => error.code === "42501"); assertions++;
      const approved = await rpc("approve_ezyvet_attachment_record", approvalArgs, true); lastAttachmentApproval = approvalId; lastCapturedAttachment = downloadId;
      const decisionFile = { id: downloadId, actor, pet, requestHash, runId, page: 1, snapshotId: selected.id, payloadHash: selected.hash, headVersion: selected.version, externalId: String(selected.payload.id), parent: approved.source_context.parent, name: "Synthetic original" };
      const decision = { id: approvalId, actor, pet, request: downloadId, captureHash: receipt.capture_hash, previous: null, title: approvalArgs.p_title, reason: approvalArgs.p_review_reason };
      check(parseAttachmentDecisionOutcome({ status: "approved", record: approved, cancellation: null }, decision, decisionFile)?.status === "approved", "Form validator accepts actual saved approval and exact captured source pins");
      check(parseAttachmentDecisionOutcome(canceled, { ...decision, id: canceledApproval }, decisionFile)?.status === "canceled", "Form validator accepts actual durable cancellation outcome");
      const retained = await rpc("cancel_ezyvet_attachment_approval", { ...cancelArgs, p_id: approvalId }, true);
      check(retained.status === "approved" && retained.cancellation === null, "Cancellation after approval preserves the approved outcome");
      assert.deepEqual(retained.record, approved, "Cancellation preserves every saved approval field regardless of JSON key order"); assertions++;
      check(approved.version === 1 && approved.previous_record_id === null && approved.entry_method === "staff_reviewed_api_attachment_v1" && approved.capture_hash === receipt.capture_hash, "Staff approval creates explicit immutable API provenance bound to captured bytes");
      check(JSON.stringify(await rpc("approve_ezyvet_attachment_record", approvalArgs, true)) === JSON.stringify(approved), "Lost approval acknowledgment recovers exact saved version");
      check(JSON.stringify(await rpc("recover_ezyvet_attachment_record", { p_id: approvalId, p_pet_id: pet }, true)) === JSON.stringify(approved), "Owner recovers approval without browser state");
      await assert.rejects(rpc("approve_ezyvet_attachment_record", { ...approvalArgs, p_title: "Different title" }, true), (error: { code: string }) => error.code === "23505"); assertions++;
      await assert.rejects(rpc("recover_ezyvet_attachment_record", { p_id: approvalId, p_pet_id: randomUUID() }, true), (error: { code: string }) => error.code === "42501"); assertions++;
      await assert.rejects(rpc("approve_ezyvet_attachment_record", { ...approvalArgs, p_id: conflictingApproval }, true), (error: { code: string }) => error.code === "40001"); assertions++;
      const corrected = await rpc("approve_ezyvet_attachment_record", { ...approvalArgs, p_id: correctionId, p_previous_record_id: approvalId, p_title: "Corrected synthetic attachment title", p_review_reason: "Explicit synthetic correction" }, true);
      check(sql(`do $immutable$ begin begin update ezyvet_attachment_record_versions set title='rewritten' where id=${quote(approvalId)};raise exception 'Immutable guard failed';exception when check_violation then null;end;end $immutable$;select title='Synthetic reviewed API attachment' from ezyvet_attachment_record_versions where id=${quote(approvalId)};`) === "t", "Append-only trigger rejects rewriting approved clinical source history");
      check(corrected.version === 2 && corrected.previous_record_id === approvalId && corrected.record_hash !== approved.record_hash, "Correction appends an exact predecessor without rewriting source bytes");
      check(JSON.stringify(await rpc("recover_ezyvet_attachment_record", { p_id: approvalId, p_pet_id: pet }, true)) === JSON.stringify(approved), "Original approval remains unchanged after correction");
      const reviewHistory = await rpc("list_ezyvet_attachment_record_versions", { p_request_id: downloadId, p_pet_id: pet, p_limit: 1 }, true);
      const expectedReview = { id: downloadId, pet, parent: approved.source_context.parent, externalId: approved.attachment_external_id };
      check(parseAttachmentReviewHistory(reviewHistory, expectedReview).records[0].id === correctionId && reviewHistory.latest_record_id === correctionId, "Actual approval history identifies latest correction through frontend validator");
      check(!JSON.stringify(reviewHistory).includes("attachment_metadata") && !JSON.stringify(reviewHistory).includes("file_download_url"), "Review history omits raw metadata and provider URLs");
      const olderReview = await rpc("list_ezyvet_attachment_record_versions", { p_request_id: downloadId, p_pet_id: pet, p_limit: 1, p_before_at: reviewHistory.next_cursor.before_at, p_before_id: reviewHistory.next_cursor.before_id }, true);
      check(parseAttachmentReviewHistory(olderReview, expectedReview).records[0].id === approvalId && olderReview.latest_record_id === correctionId && !olderReview.has_more, "Older history retains latest decision identity and exact cursor");
      await assert.rejects(rpc("list_ezyvet_attachment_record_versions", { p_request_id: downloadId, p_pet_id: randomUUID() }, true), (error: { code: string }) => error.code === "42501"); assertions++;
      const chart = await api("/rest/v1/rpc/read_ezyvet_attachment_chart", { p_pet_id: pet, p_limit: 1 }, chartHeaders);
      const parsedChart = parseAttachmentChart(chart, pet);
      check(parsedChart.records[0].record.id === correctionId && parsedChart.records[0].is_latest && parsedChart.records[0].source_current, "Other active staff discovers latest reviewed API record with current source pins");
      const chartOlder = await api("/rest/v1/rpc/read_ezyvet_attachment_chart", { p_pet_id: pet, p_limit: 1, p_before_at: chart.next_cursor.before_at, p_before_id: chart.next_cursor.before_id }, chartHeaders);
      check(parseAttachmentChart(chartOlder, pet).records[0].record.id === approvalId && !chartOlder.records[0].is_latest, "Chart cursor retains superseded original approval");
      const chartOriginal = await api("/rest/v1/rpc/get_ezyvet_attachment_chart_original", { p_record_id: correctionId, p_pet_id: pet }, chartHeaders);
      const chartCapture = parseAttachmentChartOriginal(chartOriginal, pet, correctionId, receipt.capture_hash).capture;
      check(chartCapture.actor_id === actor && !("lease_id" in chartOriginal.capture), "Reviewed original retains capture owner and hides worker lease");
      const chartDownload = await fetch(local.API_URL + "/storage/v1/object/ezyvet-attachments/" + chartCapture.object_path, { headers: chartHeaders });
      check(chartDownload.ok && (await verifyAttachmentOriginal(await chartDownload.blob(), intent)).size === intent.file_size, "Different active staff downloads only approved original and verifies its exact bytes");
      await assert.rejects(api("/rest/v1/rpc/get_ezyvet_attachment_chart_original", { p_record_id: correctionId, p_pet_id: randomUUID() }, chartHeaders), (error: { code: string }) => error.code === "42501"); assertions++;
      const releaseRefs = [{ id: correctionId, record_hash: corrected.record_hash }];
      const releaseCall = (refs: unknown, selectedPet = pet) => `public.ezyvet_validate_release_attachments(${quote(selectedPet)},${quote(JSON.stringify(refs))}::jsonb)`;
      const rejectRelease = (refs: unknown, code: string, selectedPet = pet) => {
        sql(`do $test$ begin perform ${releaseCall(refs, selectedPet)}; raise exception 'Expected selected API validation rejection'; exception when sqlstate '${code}' then null; end $test$;`); assertions++;
      };
      const releaseOriginals = JSON.parse(sql(`select ${releaseCall(releaseRefs)};`));
      check(releaseOriginals.length === 1 && parseAttachmentChartOriginal(releaseOriginals[0], pet, correctionId, receipt.capture_hash).capture.storage_object_id === chartCapture.storage_object_id, "Selected release projection binds the exact reviewed capture without intake ownership");
      check(!JSON.stringify(releaseOriginals).includes('attachment_metadata') && !JSON.stringify(releaseOriginals).includes('lease_id'), "Selected release projection omits provider metadata and worker leases");
      for (const invalid of [null, [], Array(21).fill(releaseRefs[0]), [{ id: 'invalid', record_hash: corrected.record_hash }], [releaseRefs[0], releaseRefs[0]], [{ id: correctionId, record_hash: null }], [{ ...releaseRefs[0], extra: true }]]) rejectRelease(invalid, '23514');
      rejectRelease([{ id: correctionId, record_hash: '0'.repeat(64) }], '40001');
      rejectRelease(releaseRefs, '40001', randomUUID());
      rejectRelease([{ id: approvalId, record_hash: approved.record_hash }], '40001');
      rejectRelease([{ id: randomUUID(), record_hash: corrected.record_hash }], '40001');
      sql(`begin; update storage.objects set metadata='{}' where id=${quote(chartCapture.storage_object_id)}; do $test$ begin perform ${releaseCall(releaseRefs)}; raise exception 'Expected original metadata rejection'; exception when sqlstate '40001' then null; end $test$; rollback;`); assertions++;
      sql(`begin; update ezyvet_identity_heads set version=version+1 where snapshot_id=${quote(corrected.source_context.parent.parent_snapshot_id)}; do $test$ begin perform ${releaseCall(releaseRefs)}; raise exception 'Expected stale API parent rejection'; exception when sqlstate '40001' then null; end $test$; rollback;`); assertions++;
      check(sql(`select bool_and(not has_function_privilege(role,'public.ezyvet_validate_release_attachments(uuid,jsonb)','EXECUTE')) from unnest(array['anon','authenticated','service_role']) role;`) === 't', "Selected attachment release helper is private to database composition");
      const packageArgs = { p_pet_id: pet, p_client_id: client, p_channel: 'EMAIL', p_recipient: email, p_selection: { api_attachment_ids: [correctionId] } };
      const releaseCandidates = await api('/rest/v1/rpc/list_record_release_sources_v9', { p_pet_id: pet, p_offset: 0 }, chartHeaders);
      const releaseCandidate = releaseCandidates.api_attachment_ids.find((item: { id: string }) => item.id === correctionId);
      check(releaseCandidate?.record_hash === corrected.record_hash && releaseCandidate.capture_hash === receipt.capture_hash && !releaseCandidates.api_attachment_ids.some((item: { id: string }) => item.id === approvalId) && typeof releaseCandidates.policy_v9_accepted === 'boolean', "Schema9 source discovery offers current latest approval with exact capture identity");
      check((await api('/rest/v1/rpc/list_record_release_sources_v9', { p_pet_id: pet, p_offset: 100 }, chartHeaders)).api_attachment_ids.length === 0, "API source candidate pagination does not repeat prior results");
      const allReleaseSources = await api('/rest/v1/rpc/select_all_record_release_sources_v9', { p_pet_id: pet }, chartHeaders);
      check(allReleaseSources.selection.api_attachment_ids.includes(correctionId) && !allReleaseSources.selection.api_attachment_ids.includes(approvalId), "Select-all returns exact current API approvals alongside existing explicit source families");
      const packagePreview = await api('/rest/v1/rpc/preview_record_release_v9', packageArgs, chartHeaders);
      const packageDocument = packagePreview.snapshot.attachments[0];
      check(renderRecordRelease({ preview: packagePreview }).includes("Selected ezyVet API originals"), "Shared renderer accepts actual schema9 SQL projection for the selected captured original");
      check(packagePreview.snapshot.schema_version === 9 && packagePreview.snapshot.api_attachments.length === 1 && packagePreview.snapshot.attachments.length === 1 && packageDocument.bucket === 'ezyvet-attachments' && packageDocument.id === downloadId && packageDocument.api_attachment_ref.record_id === correctionId, "Schema9 explicitly composes one selected API original without adding patient documents");
      const priorPreview = await api('/rest/v1/rpc/preview_record_release_v8', { ...packageArgs, p_selection: { patient_summary_ids: [pet] } }, chartHeaders);
      const mixedPreview = await api('/rest/v1/rpc/preview_record_release_v9', { ...packageArgs, p_selection: { patient_summary_ids: [pet], api_attachment_ids: [correctionId] } }, chartHeaders);
      check(priorPreview.snapshot.schema_version === 8 && !('api_attachments' in priorPreview.snapshot) && mixedPreview.snapshot.patient_summaries.length === 1 && mixedPreview.snapshot.api_attachments.length === 1, "Schema9 retains explicitly selected native summaries while schema8 keeps its original contract");
      const verifyOriginalSql = (doc: unknown, bytes: string) => `public.verify_release_source_original_v5(${quote(JSON.stringify(packagePreview.snapshot))}::jsonb,${quote(JSON.stringify(doc))}::jsonb,decode(${quote(bytes)},'hex'))`;
      sql(`select ${verifyOriginalSql(packageDocument, Buffer.from(original).toString('hex'))};`); assertions++;
      for (const [doc, content] of [[packageDocument, Buffer.alloc(original.length).toString('hex')], [{ ...packageDocument, api_attachment_ref: { ...packageDocument.api_attachment_ref, record_hash: '0'.repeat(64) } }, Buffer.from(original).toString('hex')], [{ ...packageDocument, bucket: 'patient-documents' }, Buffer.from(original).toString('hex')]] as const) {
        sql(`do $test$ begin perform ${verifyOriginalSql(doc, content)}; raise exception 'Expected API byte/provenance rejection'; exception when sqlstate '23514' then null; end $test$;`); assertions++;
      }
      sql(`insert into record_release_policy(id,enabled,accepted_by,accepted_at,acceptance_reference,accepted_schema_version) values(true,true,${quote(actor)},now(),'Synthetic local policy only',8) on conflict(id) do update set accepted_schema_version=8;`);
      const packageId = randomUUID(); ids.push(packageId);
      const confirmPackage = { ...packageArgs, p_id: packageId, p_reviewed_snapshot: packagePreview.snapshot, p_reviewed_hash: packagePreview.source_hash, p_attest_review: true };
      await assert.rejects(api('/rest/v1/rpc/confirm_record_release', confirmPackage, chartHeaders), (error: { code: string }) => error.code === '42501'); assertions++;
      sql('update record_release_policy set accepted_schema_version=9 where id;');
      const savedPackage = await api('/rest/v1/rpc/confirm_record_release', confirmPackage, chartHeaders);
      const readyPackage = await api('/rest/v1/rpc/read_record_release', { p_id: packageId }, chartHeaders);
      check(readyPackage.eligible && savedPackage.source_hash === packagePreview.source_hash && sql(`select source_kind from record_release_sources where release_id=${quote(packageId)};`) === 'api_attachment', "Schema9 confirmation requires policy9 and registers exact API source for eligible recovery");
      const conversation = sql(`select id from conversations where client_id=${quote(client)} and status='ACTIVE' limit 1;`) || randomUUID(), emailRequest = randomUUID(); ids.push(conversation, emailRequest);
      sql(`insert into conversations(id,client_id) values(${quote(conversation)},${quote(client)}) on conflict(id) do nothing;`);
      let emailReads = 0, loseEmailCaptureReply = true, linkReads = 0, loseLinkCaptureReply = true;
      const emailDb = (headers: Record<string, string>, service = false) => ({ rpc: async (name: string, args: Record<string, unknown>) => {
        try {
          const data = await api('/rest/v1/rpc/' + name, args, headers);
          if (service && name === 'capture_release_email_payload' && loseEmailCaptureReply) {
            loseEmailCaptureReply = false;
            return { data: null, error: { code: 'synthetic_lost_reply' } };
          }
          if (service && name === 'capture_document_link' && loseLinkCaptureReply) {
            loseLinkCaptureReply = false;
            return { data: null, error: { code: 'synthetic_lost_reply' } };
          }
          return { data, error: null };
        } catch (error) { return { data: null, error }; }
      } });
      const emailHandler = createPrepareReleaseEmailHandler({
        authenticate: async token => {
          const response = await fetch(local.API_URL + '/auth/v1/user', { headers: { apikey: local.ANON_KEY, Authorization: `Bearer ${token}` } });
          if (!response.ok) return null;
          const user = await response.json();
          return { actorId: user.id, db: emailDb({ ...chartHeaders, Authorization: `Bearer ${token}` }) };
        },
        service: emailDb(serviceHeaders, true),
        sender: { from: 'care@example.test', replyTo: 'care@example.test' },
        download: async (bucket, path, expectedSize) => {
          emailReads++;
          check(bucket === 'ezyvet-attachments' && path === chartCapture.object_path, "Email handler downloads the exact selected API original from its private bucket");
          const response = await fetch(local.API_URL + '/storage/v1/object/' + bucket + '/' + path, { headers: serviceHeaders });
          assert.ok(response.ok);
          const bytes = new Uint8Array(await response.arrayBuffer());
          assert.equal(bytes.length, expectedSize);
          return bytes;
        },
      });
      const emailArgs = { p_request_id: emailRequest, p_release_id: packageId, p_conversation_id: conversation, p_subject: 'Synthetic reviewed API original', p_body: 'Synthetic release acceptance only', p_release_hash: savedPackage.source_hash };
      const prepareEmail = (args = emailArgs, headers = chartHeaders) => emailHandler(new Request('http://localhost/prepare-release-email', { method: 'POST', headers, body: JSON.stringify(args) }));
      check((await prepareEmail(emailArgs, { 'Content-Type': 'application/json' })).status === 401 && emailReads === 0, "Anonymous email preparation cannot read private API bytes");
      check((await prepareEmail()).status === 500, "Lost successful email capture acknowledgment requires exact recovery");
      const capturedEmail = await api('/rest/v1/rpc/recover_release_email', { p_release_id: packageId, p_request_id: emailRequest }, chartHeaders);
      check(/^[a-f0-9]{64}$/.test(capturedEmail.payload_hash) && capturedEmail.manifest.some((file: { sha256: string }) => file.sha256 === receipt.content_sha256), "Full email handler records a SQL-verified manifest for actual API bytes despite lost acknowledgment");
      const emailRetry = await prepareEmail();
      check(emailRetry.status === 200 && (await emailRetry.json()).payload_hash === capturedEmail.payload_hash && emailReads === 1, "Exact handler retry recovers captured API email without another Storage download");
      check((await prepareEmail({ ...emailArgs, p_subject: 'Changed intent' })).status === 409, "Captured API email rejects changed request identity");
      const smsArgs = { ...packageArgs, p_channel: 'SMS', p_recipient: '+13035550481' };
      const smsPreview = await api('/rest/v1/rpc/preview_record_release_v9', smsArgs, chartHeaders);
      const smsId = randomUUID(), linkId = randomUUID(); ids.push(smsId, linkId);
      await api('/rest/v1/rpc/confirm_record_release', { ...smsArgs, p_id: smsId, p_reviewed_snapshot: smsPreview.snapshot, p_reviewed_hash: smsPreview.source_hash, p_attest_review: true }, chartHeaders);
      const linkPreview = await api('/rest/v1/rpc/preview_document_link', { p_family: 'record_release', p_source_id: smsId, p_client_id: client }, chartHeaders);
      const linkConfig = documentLinkConfig({ origin: 'https://thelivingroom.vet', activeKeyVersion: 'synthetic', keys: JSON.stringify({ synthetic: Buffer.from('synthetic-local-secret-00000000000').toString('base64') }), publicEnabled: 'true' });
      const linkHandler = createStaffDocumentLinkHandler({
        config: linkConfig,
        service: emailDb(serviceHeaders, true),
        authenticate: async token => {
          const response = await fetch(local.API_URL + '/auth/v1/user', { headers: { apikey: local.ANON_KEY, Authorization: `Bearer ${token}` } });
          if (!response.ok) return null;
          const user = await response.json();
          return { actorId: user.id, db: emailDb({ ...chartHeaders, Authorization: `Bearer ${token}` }) };
        },
        practice: { name: 'Synthetic', address: 'Synthetic', domain: null },
        download: async (bucket, path, expectedSize) => {
          linkReads++;
          check(bucket === 'ezyvet-attachments' && path === chartCapture.object_path, "Link handler downloads the exact reviewed API original");
          const response = await fetch(local.API_URL + '/storage/v1/object/' + bucket + '/' + path, { headers: serviceHeaders });
          assert.ok(response.ok);
          const bytes = new Uint8Array(await response.arrayBuffer()); assert.equal(bytes.length, expectedSize); return bytes;
        },
      }, 'prepare');
      const linkArgs = { p_request_id: linkId, p_family: 'record_release', p_source_id: smsId, p_client_id: client, p_conversation_id: conversation, p_recipient: '+13035550481', p_source_hash: linkPreview.source_hash, p_expires_at: new Date(Date.now() + 86400000).toISOString(), p_message_template: 'Synthetic records: {{document_link}}' };
      const prepareLink = (args = linkArgs, headers = chartHeaders) => linkHandler(new Request('http://localhost/prepare-document-link', { method: 'POST', headers, body: JSON.stringify(args) }));
      check((await prepareLink(linkArgs, { 'Content-Type': 'application/json' })).status === 401 && linkReads === 0, "Anonymous link preparation cannot read private API bytes");
      check((await prepareLink()).status === 500 && !loseLinkCaptureReply, "Lost successful link capture acknowledgment requires recovery");
      const recoveredLink = await prepareLink();
      check(recoveredLink.status === 200 && linkReads === 1, "Exact link handler retry recovers without another original download");
      const capturedLink = await recoveredLink.json();
      check(/^[a-f0-9]{64}$/.test(capturedLink.artifact_hash) && capturedLink.manifest.some((file: { sha256: string }) => file.sha256 === receipt.content_sha256), "Link SQL manifest binds actual API original bytes");
      check(new Date(capturedLink.grant.expires_at).toISOString() === linkArgs.p_expires_at && typeof capturedLink.client_url === 'string', "Link recovery preserves original expiry and materializes its capability");
      check((await prepareLink({ ...linkArgs, p_message_template: 'Changed {{document_link}}' })).status === 409, "Captured API link rejects changed exact intent");
      await api('/rest/v1/rpc/attest_document_link', { p_request_id: linkId, p_reviewed_artifact_hash: capturedLink.artifact_hash, p_reviewed_message_hash: capturedLink.message_hash, p_attest: true }, chartHeaders);
      const retrieveLinkHandler = createRetrieveDocumentLinkHandler({ config: linkConfig, service: emailDb(serviceHeaders) });
      const linkToken = new URL(capturedLink.client_url).hash.slice(1);
      const retrieveLink = (artifact: number | null, token = linkToken) => retrieveLinkHandler(new Request('http://localhost/retrieve-document-link', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ grant_id: linkId, token, artifact_index: artifact }) }));
      const publicManifest = await retrieveLink(null);
      check(publicManifest.status === 200 && (await publicManifest.json()).manifest.length === 2, "Reviewed API link exposes the exact public manifest through the retrieval handler");
      const publicOriginal = await retrieveLink(1);
      check(publicOriginal.status === 200 && Buffer.from(await publicOriginal.arrayBuffer()).equals(Buffer.from(original)), "Public API link returns the exact captured original bytes");
      check((await retrieveLink(1, 'v1.' + 'x'.repeat(43))).status === 404 && (await retrieveLink(24)).status === 404, "Wrong capability and absent artifact cannot retrieve private API bytes");
      // Owned disposable fixture clock; preserve the immutable capability context.
      sql(`begin;alter table document_link_grants disable trigger document_link_immutable;update document_link_grants set expires_at=clock_timestamp()-interval '1 minute' where id=${quote(linkId)};alter table document_link_grants enable trigger document_link_immutable;commit;`);
      check((await retrieveLink(null)).status === 404 && (await retrieveLink(1)).status === 404, "Expired API link denies both public manifest and original bytes");
      sql(`begin;alter table document_link_grants disable trigger document_link_immutable;update document_link_grants set expires_at=${quote(capturedLink.grant.expires_at)} where id=${quote(linkId)};alter table document_link_grants enable trigger document_link_immutable;commit;`);
      check((await retrieveLink(1)).status === 200, "Restoring the synthetic clock restores otherwise-current API link access");
      const queuedEmail = await api('/rest/v1/rpc/enqueue_release_email', { p_request_id: emailRequest, p_reviewed_payload_hash: capturedEmail.payload_hash, p_attest: true }, chartHeaders);
      const queuedLink = await api('/rest/v1/rpc/enqueue_document_link_sms', { p_request_id: linkId, p_reviewed_artifact_hash: capturedLink.artifact_hash, p_reviewed_message_hash: capturedLink.message_hash, p_attest: true }, chartHeaders);
      ids.push(queuedEmail.id, queuedEmail.message_id, queuedLink.id, queuedLink.message_id);
      deliveryFixtureIds.push(queuedEmail.id, queuedLink.id);
      check(queuedEmail.state === 'pending' && queuedLink.state === 'pending', "Reviewed API email and link enter the actual outbox as pending work");
      sql(`begin; select set_config('request.jwt.claims',${quote(JSON.stringify({ sub: chartActor, role: 'authenticated' }))},true); do $test$ begin if not (public.release_read_internal(${quote(packageId)})->>'eligible')::boolean then raise exception 'Expected eligible baseline'; end if; end $test$; update storage.objects set metadata='{}' where id=${quote(chartCapture.storage_object_id)}; do $test$ begin if (public.release_read_internal(${quote(packageId)})->>'eligible')::boolean then raise exception 'Missing original remained eligible'; end if; end $test$; rollback;`); assertions++;
      sql(`delete from user_roles where user_id=${quote(chartActor)};`);
      check((await prepareLink()).status === 403 && linkReads === 1, "Revoked staff cannot recover API link artifacts or capability");
      check((await prepareEmail()).status === 403 && emailReads === 1, "Revoked staff cannot recover the captured API email through the handler");
      await assert.rejects(api("/rest/v1/rpc/read_ezyvet_attachment_chart", { p_pet_id: pet }, chartHeaders), (error: { code: string }) => error.code === "42501"); assertions++;
      check(!(await fetch(local.API_URL + "/storage/v1/object/ezyvet-attachments/" + chartCapture.object_path, { headers: chartHeaders })).ok, "Revoked staff cannot download reviewed original");
      sql(`insert into user_roles(user_id,role) values(${quote(chartActor)},'DVM');`);
      sql(`update ezyvet_identity_heads set version=version+1 where snapshot_id=${quote(selected.id)};`);
      const staleChart = parseAttachmentChart(await api("/rest/v1/rpc/read_ezyvet_attachment_chart", { p_pet_id: pet, p_limit: 1 }, chartHeaders), pet);
      check(staleChart.records[0].is_latest && !staleChart.records[0].source_current, "Chart distinguishes latest approval from changed source evidence");
      rejectRelease(releaseRefs, '40001');
      check(!(await api('/rest/v1/rpc/list_record_release_sources_v9', { p_pet_id: pet, p_offset: 0 }, chartHeaders)).api_attachment_ids.some((item: { id: string }) => item.id === correctionId), "Changed API evidence is removed from current eligible source candidates");
      const historicalEmail = await prepareEmail();
      check(historicalEmail.status === 200 && (await historicalEmail.json()).payload_hash === capturedEmail.payload_hash && emailReads === 1, "API source invalidation preserves exact captured email recovery without rereading bytes");
      const freshEmailRequest = randomUUID(); ids.push(freshEmailRequest);
      check((await prepareEmail({ ...emailArgs, p_request_id: freshEmailRequest })).status === 403 && emailReads === 1, "Invalidated API release cannot prepare a new email or fetch originals");
      const historicalLink = await prepareLink();
      check(historicalLink.status === 200 && linkReads === 1, "Invalidated API source preserves captured link history without downloading again");
      const historicalLinkBody = await historicalLink.json();
      check(historicalLinkBody.artifact_hash === capturedLink.artifact_hash && historicalLinkBody.client_url === capturedLink.client_url && historicalLinkBody.grant.expires_at === capturedLink.grant.expires_at, "Historical link recovery preserves exact artifact, capability and expiry");
      const newLinkId = randomUUID(); ids.push(newLinkId);
      check((await prepareLink({ ...linkArgs, p_request_id: newLinkId })).status === 403 && linkReads === 1, "Invalidated API release cannot prepare a new link or fetch originals");
      check((await retrieveLink(null)).status === 404 && (await retrieveLink(1)).status === 404, "Source invalidation closes public API manifest and original access");
      let providerCalls = 0;
      const workerEnvironment = { APP_ENV: 'staging', OUTBOUND_DELIVERY_MODE: 'test', OUTBOUND_TEST_EMAILS: email, OUTBOUND_TEST_PHONES: '+13035550481', RESEND_API_KEY: 'synthetic', RESEND_FROM: 'care@example.test', RESEND_REPLY_TO: 'care@example.test', TWILIO_ACCOUNT_SID: 'AC' + 'a'.repeat(32), TWILIO_AUTH_TOKEN: 'synthetic', TWILIO_FROM_NUMBER: '+13035550199', DOCUMENT_LINK_ORIGIN: 'https://thelivingroom.vet', DOCUMENT_LINK_ACTIVE_KEY_VERSION: 'synthetic', DOCUMENT_LINK_KEYS: JSON.stringify({ synthetic: Buffer.from('synthetic-local-secret-00000000000').toString('base64') }), DOCUMENT_LINK_PUBLIC_ENABLED: 'true' };
      const noProvider = (async () => { providerCalls++; throw new Error('Synthetic invalidated work must never reach provider transport'); }) as typeof fetch;
      await dispatchOne(emailDb(serviceHeaders), workerEnvironment, noProvider);
      await dispatchOne(emailDb(serviceHeaders), workerEnvironment, noProvider);
      check(providerCalls === 0, "Actual outbox dispatcher makes no provider request for invalidated API email or link");
      for (const queued of [queuedEmail, queuedLink]) {
        check(sql(`select state||':'||attempt_count::text from communication_outbox where id=${quote(queued.id)};`) === 'failed:0', "Invalidated API delivery fails before a provider attempt is recorded");
      }
      const invalidatedPackage = await api('/rest/v1/rpc/read_record_release', { p_id: packageId }, chartHeaders);
      check(!invalidatedPackage.eligible && invalidatedPackage.events.some((event: { kind: string }) => event.kind === 'source_changed') && JSON.stringify(invalidatedPackage.release.snapshot) === JSON.stringify(packagePreview.snapshot), "Source revision adds an invalidation event without rewriting the reviewed API package");
      check((await api('/rest/v1/rpc/confirm_record_release', confirmPackage, chartHeaders)).id === packageId, "Exact schema9 confirmation retry recovers original after source change");

      check(JSON.stringify(await rpc("approve_ezyvet_attachment_record", approvalArgs, true)) === JSON.stringify(approved), "Exact approval retry survives a later source revision");
      await assert.rejects(rpc("approve_ezyvet_attachment_record", { ...approvalArgs, p_id: conflictingApproval, p_previous_record_id: correctionId }, true), (error: { code: string }) => error.code === "40001"); assertions++;
      sql(`update ezyvet_identity_heads set version=version-1 where snapshot_id=${quote(selected.id)};`);
      for (const channel of ['EMAIL', 'SMS'] as const) for (const interruption of ['finish-reply', 'start-reply', 'finish-write', 'source-before-start'] as const) {
        const acceptedArgs = channel === 'EMAIL' ? packageArgs : smsArgs;
        const acceptedPreview = await api('/rest/v1/rpc/preview_record_release_v9', acceptedArgs, chartHeaders);
        const acceptedRelease = randomUUID(), acceptedRequest = randomUUID(); ids.push(acceptedRelease, acceptedRequest);
        await api('/rest/v1/rpc/confirm_record_release', { ...acceptedArgs, p_id: acceptedRelease, p_reviewed_snapshot: acceptedPreview.snapshot, p_reviewed_hash: acceptedPreview.source_hash, p_attest_review: true }, chartHeaders);
        let acceptedOutbox, acceptedLinkUrl = '';
        if (channel === 'EMAIL') {
          const result = await prepareEmail({ ...emailArgs, p_request_id: acceptedRequest, p_release_id: acceptedRelease, p_release_hash: acceptedPreview.source_hash });
          check(result.status === 200, "Fresh eligible API email prepares for successful worker delivery");
          const prepared = await result.json();
          acceptedOutbox = await api('/rest/v1/rpc/enqueue_release_email', { p_request_id: acceptedRequest, p_reviewed_payload_hash: prepared.payload_hash, p_attest: true }, chartHeaders);
        } else {
          const preview = await api('/rest/v1/rpc/preview_document_link', { p_family: 'record_release', p_source_id: acceptedRelease, p_client_id: client }, chartHeaders);
          const result = await prepareLink({ ...linkArgs, p_request_id: acceptedRequest, p_source_id: acceptedRelease, p_source_hash: preview.source_hash });
          check(result.status === 200, "Fresh eligible API link prepares for successful worker delivery");
          const prepared = await result.json();
          acceptedLinkUrl = prepared.client_url;
          await api('/rest/v1/rpc/attest_document_link', { p_request_id: acceptedRequest, p_reviewed_artifact_hash: prepared.artifact_hash, p_reviewed_message_hash: prepared.message_hash, p_attest: true }, chartHeaders);
          acceptedOutbox = await api('/rest/v1/rpc/enqueue_document_link_sms', { p_request_id: acceptedRequest, p_reviewed_artifact_hash: prepared.artifact_hash, p_reviewed_message_hash: prepared.message_hash, p_attest: true }, chartHeaders);
        }
        ids.push(acceptedOutbox.id, acceptedOutbox.message_id); deliveryFixtureIds.push(acceptedOutbox.id);
        let acceptanceCalls = 0, lostFinish = false;
        const acceptedTransport = (async (_url, init) => {
          acceptanceCalls++;
          if (channel === 'EMAIL') {
            const payload = JSON.parse(String(init?.body));
            check(payload.attachments.some((file: { content: string }) => Buffer.from(file.content, 'base64').equals(Buffer.from(original))), "Worker sends exact captured API bytes in frozen email payload");
          } else {
            const payload = new URLSearchParams(String(init?.body));
            check(payload.get('Body')?.includes('/shared/' + acceptedRequest + '#v1.'), "Worker materializes the reviewed API link in its SMS payload");
          }
          return new Response(JSON.stringify(channel === 'EMAIL' ? { id: randomUUID() } : { sid: 'SM' + randomUUID().replaceAll('-', '') }), { status: 202 });
        }) as typeof fetch;
        const interruptedDb = { rpc: async (name: string, args: Record<string, unknown> = {}) => {
          if (interruption === 'source-before-start' && name === 'start_communication_attempt') {
            sql(`update ezyvet_identity_heads set version=version+1 where snapshot_id=${quote(selected.id)};`);
          }
          if (interruption === 'finish-write' && name === 'finish_communication_attempt') {
            lostFinish = true;
            return { data: null, error: new Error('Synthetic finish write unavailable') };
          }
          const result = await emailDb(serviceHeaders).rpc(name, args);
          if (!result.error && ((interruption === 'finish-reply' && name === 'finish_communication_attempt') || (interruption === 'start-reply' && name === 'start_communication_attempt'))) {
            lostFinish = true;
            return { data: null, error: new Error('Synthetic committed acknowledgment lost') };
          }
          return result;
        } };
        if (interruption === 'source-before-start') {
          const result = await dispatchOne(interruptedDb, workerEnvironment, acceptedTransport);
          check(result.processed && result.state === 'failed' && acceptanceCalls === 0, "Source revision after payload materialization stops actual worker before provider transport");
          check(sql(`select state||':'||attempt_count::text from communication_outbox where id=${quote(acceptedOutbox.id)};`) === 'failed:0', "Final start guard records no provider attempt for newly invalidated API source");
          check(sql(`select count(*) from communication_attempts where outbox_id=${quote(acceptedOutbox.id)};`) === '0', "Rejected start creates no ambiguous provider attempt receipt");
          sql(`update ezyvet_identity_heads set version=version-1 where snapshot_id=${quote(selected.id)};`);
          continue;
        }
        await assert.rejects(dispatchOne(interruptedDb, workerEnvironment, acceptedTransport)); assertions++;
        const expectedCalls = interruption === 'start-reply' ? 0 : 1;
        const expectedState = interruption === 'finish-reply' ? 'accepted:1:' : 'claimed:1:';
        assert.deepEqual({ channel, interruption, lostFinish, acceptanceCalls, saved: sql(`select state||':'||attempt_count::text||':'||coalesce(last_error,'') from communication_outbox where id=${quote(acceptedOutbox.id)};`) }, { channel, interruption, lostFinish: true, acceptanceCalls: expectedCalls, saved: expectedState }, 'Interrupted worker preserves exact attempt state'); assertions++;
        await dispatchOne(emailDb(serviceHeaders), workerEnvironment, acceptedTransport);
        check(acceptanceCalls === expectedCalls, "Worker retry does not resend accepted or still-leased API delivery");
        if (channel === 'SMS' && interruption === 'finish-reply') {
          const retrieveAccepted = () => retrieveLinkHandler(new Request('http://localhost/retrieve-document-link', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ grant_id: acceptedRequest, token: new URL(acceptedLinkUrl).hash.slice(1), artifact_index: 1 }) }));
          check((await retrieveAccepted()).status === 200, "Accepted API link remains accessible before explicit revocation");
          await api('/rest/v1/rpc/revoke_document_link', { p_request_id: acceptedRequest, p_reason: 'Synthetic explicit access revocation' }, chartHeaders);
          check((await retrieveAccepted()).status === 404, "Explicit staff revocation closes an otherwise-current accepted API link");
        }
        if (interruption !== 'finish-reply') {
          // Owned disposable fixture clock: expire only this recorded delivery lease.
          sql(`update communication_outbox set lease_expires_at=clock_timestamp()-interval '1 second' where id=${quote(acceptedOutbox.id)};`);
          await dispatchOne(emailDb(serviceHeaders), workerEnvironment, acceptedTransport);
          check(acceptanceCalls === expectedCalls && sql(`select state||':'||attempt_count::text from communication_outbox where id=${quote(acceptedOutbox.id)};`) === 'uncertain:1', "Expired interrupted API delivery becomes uncertain without an automatic resend");
          check(sql(`select outcome||':'||error_code from communication_attempts where outbox_id=${quote(acceptedOutbox.id)};`) === 'uncertain:worker_lease_expired', "Lease recovery retains an uncertain attempt receipt for reconciliation");
        }
      }
      const secondSource = JSON.parse(sql(`select jsonb_build_object('id',s.id,'hash',s.payload_hash,'version',o.head_version) from ezyvet_attachment_page_observations o join ezyvet_import_snapshots s on s.id=o.snapshot_id where o.run_id=${quote(runId)} and o.page=2;`));
      const secondRequest = randomUUID(), secondApproval = randomUUID(); ids.push(secondRequest, secondApproval);
      const secondPrepared = await rpc('prepare_ezyvet_attachment_download', { p_id: secondRequest, p_pet_id: pet, p_run_id: runId, p_page: 2, p_snapshot_id: secondSource.id, p_payload_hash: secondSource.hash, p_observed_head_version: secondSource.version }, true);
      const secondWorker = await postCapture({ request_id: secondRequest, pet_id: pet, request_hash: secondPrepared.request.request_hash });
      check(secondWorker.status === 200, "Actual worker captures the distinct second-page API original");
      const secondSaved = await rpc('recover_ezyvet_attachment_download', { p_id: secondRequest, p_pet_id: pet }, true);
      storageObjects.push(secondSaved.capture.object_path);
      const secondRecord = await rpc('approve_ezyvet_attachment_record', { p_id: secondApproval, p_request_id: secondRequest, p_pet_id: pet, p_capture_hash: secondSaved.capture.capture_hash, p_previous_record_id: null, p_title: 'Second selected API original', p_review_reason: 'Synthetic exact second original review', p_attest: true }, true);
      check(secondRecord.request_id === secondRequest && secondRecord.id === secondApproval, "Second API approval retains its own capture identity");
      for (const apiIds of [[correctionId, correctionId], [correctionId, secondApproval, ...Array.from({ length: 19 }, () => randomUUID())]]) {
        await assert.rejects(api('/rest/v1/rpc/preview_record_release_v9', { ...packageArgs, p_selection: { api_attachment_ids: apiIds } }, chartHeaders), (error: { code: string; message: string }) => error.code === '23514' && error.message.includes('at most20 distinct')); assertions++;
      }
      const secondBytes = original.slice(); secondBytes[secondBytes.length - 1] ^= 4;
      const mixedDocuments: string[] = [], mixedFiles = new Map<string, Uint8Array>();
      mixedFiles.set('ezyvet-attachments/' + chartCapture.object_path, original);
      mixedFiles.set('ezyvet-attachments/' + secondSaved.capture.object_path, secondBytes);
      for (let index = 1; index <= 2; index++) {
        const documentId = randomUUID(); ids.push(documentId); mixedDocuments.push(documentId);
        const bytes = original.slice(); bytes[bytes.length - 1] ^= index;
        const document = await api('/rest/v1/rpc/prepare_patient_document', { p_id: documentId, p_pet_id: pet, p_encounter_id: null, p_file_name: `synthetic-mixed-${index}.pdf`, p_mime_type: 'application/pdf', p_file_size: bytes.length, p_category: 'medical_record', p_source: 'Synthetic multiple-original acceptance', p_document_date: null, p_visibility: 'client_shareable' }, chartHeaders);
        nativeFixturePaths.push(document.file_path);
        mixedFiles.set('patient-documents/' + document.file_path, bytes);
        const upload = await fetch(local.API_URL + '/storage/v1/object/patient-documents/' + document.file_path, { method: 'POST', headers: { ...chartHeaders, 'Content-Type': 'application/pdf', 'x-upsert': 'false' }, body: bytes });
        check(upload.ok, "Distinct ordinary original uploads through actual staff Storage policy");
        await api('/rest/v1/rpc/finalize_patient_document', { p_id: documentId }, chartHeaders);
      }
      let mixedReads: string[] = [], swapApiBytes = false;
      const mixedDependencies = {
        service: emailDb(serviceHeaders),
        authenticate: async (token: string) => {
          const response = await fetch(local.API_URL + '/auth/v1/user', { headers: { apikey: local.ANON_KEY, Authorization: `Bearer ${token}` } });
          if (!response.ok) return null;
          const user = await response.json(); return { actorId: user.id, db: emailDb({ ...chartHeaders, Authorization: `Bearer ${token}` }) };
        },
        download: async (bucket: string, path: string, expectedSize: number) => {
          const key = bucket + '/' + path; mixedReads.push(key); assert.ok(mixedFiles.has(key), 'Only explicitly selected original paths may be fetched');
          const response = await fetch(local.API_URL + '/storage/v1/object/' + key, { headers: serviceHeaders }); assert.ok(response.ok);
          const bytes = new Uint8Array(await response.arrayBuffer()); assert.equal(bytes.length, expectedSize);
          assert.deepEqual(bytes, mixedFiles.get(key), 'Actual private Storage bytes match the selected file');
          return swapApiBytes && bucket === 'ezyvet-attachments' ? mixedFiles.get('patient-documents/' + nativeFixturePaths.at(-1))! : bytes;
        },
      };
      const mixedEmailHandler = createPrepareReleaseEmailHandler({ ...mixedDependencies, sender: { from: 'care@example.test', replyTo: 'care@example.test' } });
      const mixedLinkHandler = createStaffDocumentLinkHandler({ ...mixedDependencies, config: linkConfig, practice: { name: 'Synthetic', address: 'Synthetic', domain: null } }, 'prepare');
      for (const channel of ['EMAIL', 'SMS'] as const) for (const corrupted of [false, true]) {
        const mixedArgs = { ...(channel === 'EMAIL' ? packageArgs : smsArgs), p_selection: { api_attachment_ids: [correctionId, secondApproval], document_ids: mixedDocuments, patient_summary_ids: [pet] } };
        const preview = await api('/rest/v1/rpc/preview_record_release_v9', mixedArgs, chartHeaders);
        check(preview.snapshot.attachments.length === 4 && preview.snapshot.api_attachments.length === 2 && preview.snapshot.patient_summaries.length === 1, "Actual schema9 preview keeps four explicitly selected originals and native patient summary");
        const mixedRelease = randomUUID(), mixedRequest = randomUUID(); ids.push(mixedRelease, mixedRequest);
        await api('/rest/v1/rpc/confirm_record_release', { ...mixedArgs, p_id: mixedRelease, p_reviewed_snapshot: preview.snapshot, p_reviewed_hash: preview.source_hash, p_attest_review: true }, chartHeaders);
        const request = channel === 'EMAIL' ? { ...emailArgs, p_request_id: mixedRequest, p_release_id: mixedRelease, p_release_hash: preview.source_hash } : { ...linkArgs, p_request_id: mixedRequest, p_source_id: mixedRelease, p_source_hash: preview.source_hash };
        mixedReads = []; swapApiBytes = corrupted;
        const response = await (channel === 'EMAIL' ? mixedEmailHandler : mixedLinkHandler)(new Request('http://localhost/prepare-mixed', { method: 'POST', headers: chartHeaders, body: JSON.stringify(request) }));
        if (corrupted) {
          check(response.status !== 200, "Mixed package rejects a same-size ordinary original swapped into the API slot");
          const table = channel === 'EMAIL' ? 'release_email_payloads' : 'document_link_payloads', key = channel === 'EMAIL' ? 'request_id' : 'grant_id';
          check(sql(`select count(*) from ${table} where ${key}=${quote(mixedRequest)};`) === '0', "Rejected mixed bytes leave no frozen delivery artifact");
        } else {
          check(response.status === 200 && new Set(mixedReads).size === 4 && mixedReads.length === 4, "Mixed handler fetches each selected original exactly once across both private buckets");
          const captured = await response.json();
          const expectedDigests = await Promise.all([...mixedFiles.values()].map(async bytes => Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex')));
          check(captured.manifest.length === 5 && expectedDigests.every(digest => captured.manifest.some((item: { sha256: string }) => item.sha256 === digest)), "SQL-frozen mixed manifest contains report plus all four distinct original digests");
        }
      }
      boundaryBatch = true; resetCooldown();
      const batchRun = randomUUID(); ids.push(batchRun); boundaryRunIds.push(batchRun);
      await rpc('prepare_ezyvet_attachment_scan', { ...prepareArgs, p_id: batchRun }, true);
      for (let page = 1; page <= 2; page++) {
        resetCooldown(); check((await post({ ...body, run_id: batchRun })).ok, "Boundary fixture imports an actual full page of ten API attachments");
      }
      boundaryBatch = false;
      // Advance the owned fixture past metadata-import cooldown before file capture.
      resetCooldown();
      const batchSources = JSON.parse(sql(`select jsonb_agg(jsonb_build_object('id',s.id,'hash',s.payload_hash,'version',o.head_version,'page',o.page,'external_id',s.external_id) order by s.external_id::integer) from ezyvet_attachment_page_observations o join ezyvet_import_snapshots s on s.id=o.snapshot_id where o.run_id=${quote(batchRun)};`));
      check(batchSources.length === 20, "Two actual import pages preserve twenty exact source observations");
      const boundaryApiIds = [correctionId, secondApproval];
      for (const source of batchSources.slice(2)) {
        const requestId = randomUUID(), approvalId = randomUUID(); ids.push(requestId, approvalId);
        const prepared = await rpc('prepare_ezyvet_attachment_download', { p_id: requestId, p_pet_id: pet, p_run_id: batchRun, p_page: source.page, p_snapshot_id: source.id, p_payload_hash: source.hash, p_observed_head_version: source.version }, true);
        const capturedResponse = await postCapture({ request_id: requestId, pet_id: pet, request_hash: prepared.request.request_hash });
        const capturedSummary = await capturedResponse.json();
        check(capturedResponse.ok, `Boundary API capture ${source.external_id}: HTTP ${capturedResponse.status}, code ${capturedSummary.code ?? capturedSummary.error ?? 'unknown'}`);
        const saved = await rpc('recover_ezyvet_attachment_download', { p_id: requestId, p_pet_id: pet }, true); storageObjects.push(saved.capture.object_path);
        await rpc('approve_ezyvet_attachment_record', { p_id: approvalId, p_request_id: requestId, p_pet_id: pet, p_capture_hash: saved.capture.capture_hash, p_previous_record_id: null, p_title: 'Boundary API original ' + source.external_id, p_review_reason: 'Synthetic exact captured original review', p_attest: true }, true);
        boundaryApiIds.push(approvalId);
        const bytes = original.slice(); bytes[bytes.length - 1] ^= Number(source.external_id) % 100 + 4;
        mixedFiles.set('ezyvet-attachments/' + saved.capture.object_path, bytes);
      }
      for (let index = 3; index <= 5; index++) {
        const id = randomUUID(); ids.push(id); mixedDocuments.push(id);
        const bytes = original.slice(); bytes[bytes.length - 1] ^= index + 40;
        const document = await api('/rest/v1/rpc/prepare_patient_document', { p_id: id, p_pet_id: pet, p_encounter_id: null, p_file_name: `synthetic-boundary-${index}.pdf`, p_mime_type: 'application/pdf', p_file_size: bytes.length, p_category: 'medical_record', p_source: 'Synthetic package limit', p_document_date: null, p_visibility: 'client_shareable' }, chartHeaders);
        nativeFixturePaths.push(document.file_path);
        if (index < 5) mixedFiles.set('patient-documents/' + document.file_path, bytes);
        const uploaded = await fetch(local.API_URL + '/storage/v1/object/patient-documents/' + document.file_path, { method: 'POST', headers: { ...chartHeaders, 'Content-Type': 'application/pdf', 'x-upsert': 'false' }, body: bytes }); assert.ok(uploaded.ok);
        await api('/rest/v1/rpc/finalize_patient_document', { p_id: id }, chartHeaders);
      }
      for (const channel of ['EMAIL', 'SMS'] as const) {
        const boundaryArgs = { ...(channel === 'EMAIL' ? packageArgs : smsArgs), p_selection: { api_attachment_ids: boundaryApiIds, document_ids: mixedDocuments.slice(0, 4), patient_summary_ids: [pet] } };
        const preview = await api('/rest/v1/rpc/preview_record_release_v9', boundaryArgs, chartHeaders);
        check(preview.snapshot.api_attachments.length === 20 && preview.snapshot.attachments.length === 24, "Actual preview accepts the full twenty-API/twenty-four-original boundary");
        const releaseId = randomUUID(), requestId = randomUUID(); ids.push(releaseId, requestId);
        await api('/rest/v1/rpc/confirm_record_release', { ...boundaryArgs, p_id: releaseId, p_reviewed_snapshot: preview.snapshot, p_reviewed_hash: preview.source_hash, p_attest_review: true }, chartHeaders);
        const request = channel === 'EMAIL' ? { ...emailArgs, p_request_id: requestId, p_release_id: releaseId, p_release_hash: preview.source_hash } : { ...linkArgs, p_request_id: requestId, p_source_id: releaseId, p_source_hash: preview.source_hash };
        mixedReads = []; swapApiBytes = false;
        const response = await (channel === 'EMAIL' ? mixedEmailHandler : mixedLinkHandler)(new Request('http://localhost/prepare-boundary', { method: 'POST', headers: chartHeaders, body: JSON.stringify(request) }));
        check(response.ok && mixedReads.length === 24 && new Set(mixedReads).size === 24, "Boundary handler downloads every selected original exactly once");
        const captured = await response.json();
        const digests = await Promise.all([...mixedFiles.values()].map(async bytes => Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex')));
        check(captured.manifest.length === 25 && digests.length === 24 && digests.every(digest => captured.manifest.some((item: { sha256: string }) => item.sha256 === digest)), "Boundary frozen manifest preserves report plus all twenty-four originals");
        await assert.rejects(api('/rest/v1/rpc/preview_record_release_v9', { ...boundaryArgs, p_selection: { ...boundaryArgs.p_selection, document_ids: mixedDocuments } }, chartHeaders), (error: { code: string; message: string }) => error.code === '23514' && error.message.includes('within24-file')); assertions++;
      }
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

      const unreservedRequest = randomUUID(), unreservedCleanup = randomUUID(); ids.push(unreservedRequest, unreservedCleanup);
      const unreserved = await rpc("prepare_ezyvet_attachment_download", { p_id: unreservedRequest, p_pet_id: pet, p_run_id: runId, p_page: 1, p_snapshot_id: selected.id, p_payload_hash: selected.hash, p_observed_head_version: selected.version }, true);
      await rpc("abandon_ezyvet_attachment_download", { p_id: unreservedRequest, p_pet_id: pet, p_confirmed: true }, true);
      const unreservedStorageCalls = cleanupStorageCalls, unreservedSourceCalls = upstreamCalls;
      const noReservationResponse = await postCleanup({ cleanup_id: unreservedCleanup, request_id: unreservedRequest, pet_id: pet, request_hash: unreserved.request.request_hash });
      check(noReservationResponse.status === 409 && (await noReservationResponse.json()).retry_safe === false, "Unreserved abandoned request is explicitly ineligible, not a retryable cleanup failure");
      check(cleanupStorageCalls === unreservedStorageCalls && upstreamCalls === unreservedSourceCalls, "Unreserved cleanup performs no Storage or provider operation");
      check(await rpc("recover_ezyvet_attachment_cleanup", { p_cleanup_id: unreservedCleanup, p_id: unreservedRequest, p_pet_id: pet }, true) === null, "Unreserved cleanup creates no attempt or absence receipt");
      const emptyAbandonId = randomUUID(); ids.push(emptyAbandonId);
      const emptyAbandon = await rpc("abandon_ezyvet_attachment_download", { p_id: emptyAbandonId, p_pet_id: pet, p_confirmed: true }, true);
      const emptyIntent = { id: emptyAbandonId, actor, pet, runId, page: 1, snapshotId: selected.id, payloadHash: selected.hash, headVersion: selected.version, externalId: String(unreserved.request.source_context.attachment_external_id), parent: unreserved.request.source_context.parent, name: "Synthetic unprepared request" };
      const emptyState = parseAttachmentFileRecovery(emptyAbandon, emptyIntent);
      check(emptyState.status === "abandoned" && emptyState.requestHash === null && !emptyState.captured, "Browser parser recognizes actual owned unprepared abandonment without inventing capture evidence");
      const emptyRecovered = await rpc("recover_ezyvet_attachment_download", { p_id: emptyAbandonId, p_pet_id: pet }, true);
      check(parseAttachmentFileRecovery(emptyRecovered, emptyIntent).status === "abandoned", "Lost unprepared abandonment acknowledgment recovers exact terminal state");
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
      check(parseAttachmentCleanupRecovery(afterCleanup, { id: cleanupId, request: cleanupRequest, actor, pet, requestHash: cleanupBody.request_hash, intentHash: afterCleanup.attempt.intent_hash })?.receipt?.verified_absent_at === cleanupResult.verified_absent_at, "Frontend recovery validates actual cleanup completion after lost replies");
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
      check(parseAttachmentCleanupHistory(cleanupHistory, { id: cleanupRequest, actor, pet, requestHash: cleanupBody.request_hash }).next_cursor?.before_id === laterCleanup, "Frontend cleanup history validates actual newest receipt and cursor");
      check(parseAttachmentCleanupHistory(cleanupOlder, { id: cleanupRequest, actor, pet, requestHash: cleanupBody.request_hash }).cleanups[0].receipt?.cleanup_id === cleanupId, "Frontend cleanup history validates actual prior receipt");
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
  const discoveredRuns = (await rpc("list_ezyvet_attachment_runs", { p_animal_link_id: mapping }, true)).runs;
  check(discoveredRuns.length === 4 + boundaryRunIds.length && boundaryRunIds.every(id => discoveredRuns.some((run: { id: string }) => run.id === id)), "Actual staff discovery includes original terminal/pending runs and exact boundary fixture runs");
  const privateRows = await fetch(local.API_URL + "/rest/v1/ezyvet_attachment_runs?select=run_id", { headers: staffHeaders });
  check(privateRows.status === 401 || privateRows.status === 403, "Private run table denies direct staff access");
  if (includeCapture) {
    const actualHistory = await rpc("list_ezyvet_attachment_downloads", { p_pet_id: pet, p_limit: 20 }, true);
    const parsedHistory = parseAttachmentFileHistory(actualHistory, actor, { link_id: mapping, pet_id: pet, source_origin: discoveredParent.source_origin, source_site_uid: site, external_id: "77" });
    check(parsedHistory.requests.some(item => item.status === "captured" && item.sameMapping), "Browser history parser accepts actual captured request projections");
    check(parsedHistory.requests.some(item => item.status === "abandoned"), "Actual history retains abandoned requests alongside captured source evidence");
    check(actualHistory.requests.every((item: { request: { source_context: Record<string, unknown> | null } }) => !item.request.source_context || !("attachment_metadata" in item.request.source_context)), "Actual discovery omits raw provider metadata");
  }
  sql(`delete from user_roles where user_id=${quote(actor)} and role='ADMIN';`);
  if (includeCapture) { await assert.rejects(rpc("list_ezyvet_attachment_record_versions", { p_request_id: lastCapturedAttachment, p_pet_id: pet }, true), (error: { code: string }) => error.code === "42501"); assertions++; }
  if (includeCapture) { await assert.rejects(rpc("recover_ezyvet_attachment_record", { p_id: lastAttachmentApproval, p_pet_id: pet }, true), (error: { code: string }) => error.code === "42501"); assertions++; }
  check((await post({ run_id: randomUUID(), resource: "attachment" })).status === 403, "Role loss prevents HTTP import");
  await assert.rejects(rpc("list_ezyvet_attachment_runs", { p_animal_link_id: mapping }, true), (error: { code: string }) => error.code === "42501"); assertions++;
  await assert.rejects(rpc("list_ezyvet_attachment_observations", { p_run_id: lastAttachmentRun, p_pet_id: pet }, true), (error: { code: string }) => error.code === "42501"); assertions++;
  const expectedEffects = JSON.parse(beforeEffects); expectedEffects[0] += nativeFixturePaths.length; expectedEffects[4] += deliveryFixtureIds.length;
  check(JSON.stringify(JSON.parse(effects())) === JSON.stringify(expectedEffects), "Intake creates no clinical/billing/stock effects or outbox work beyond the explicitly reviewed release fixtures");
} catch (error) {
  failures.push(error);
} finally {
  for (const server of closeables.reverse()) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  try {
    if (nativeFixturePaths.length) {
      const removed = await fetch(local.API_URL + '/storage/v1/object/patient-documents', { method: 'DELETE', headers: serviceHeaders, body: JSON.stringify({ prefixes: nativeFixturePaths }) }); assert.ok(removed.ok);
      check(sql(`select count(*) from storage.objects where bucket_id='patient-documents' and name in (${nativeFixturePaths.map(quote).join(',')});`) === '0', "Owned ordinary originals removed through actual Storage API");
    }
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
