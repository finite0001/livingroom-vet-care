import { createPrepareReleaseEmailHandler } from "../../supabase/functions/_shared/prepare-release-email.ts";
import { buildReleaseEmailPayload } from "../../supabase/functions/_shared/release-email-payload.ts";
import { renderRecordRelease } from "../../supabase/functions/_shared/record-release-renderer.ts";
/** Original capture through real local HTTP, Auth and private Storage; synthetic source only. */
import { createServer } from "node:http";
import type { RequestListener } from "node:http";
import { createHandler as createImportHandler } from "../../supabase/functions/ezyvet-import/handler.ts";
import { createHandler as createReviewedHandler } from "../../supabase/functions/retrieve-reviewed-ezyvet-original/handler.ts";
import { parseAttachmentDecision, parseAttachmentDecisionOutcome } from "../../src/hub/features/imports/attachment-decision-state.ts";
import { validateCapture } from "../../src/hub/features/imports/attachment-capture-state.ts";
import { createHandler as createCaptureHandler } from "../../supabase/functions/capture-ezyvet-attachment/handler.ts";
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
let upstreamCalls = 0, urlRevision = 1, downloadCalls = 0, exactReads = 0;
let sourceMode = "valid";
const originalBytes = new TextEncoder().encode("%PDF-1.4\nSynthetic original record.\n%%EOF\n");
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
  const email = `attachment-import-${randomUUID()}@example.test`,
    password = `Synthetic-${randomUUID()}-Aa1!`;
  actor = (
    await api("/auth/v1/admin/users", {
      email,
      password,
      email_confirm: true,
    })
  ).id;
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
        p_last_name: "Attachment source",
        p_primary_phone: null,
        p_primary_email: "attachment-owner@example.test",
        p_preferred_channel: "EMAIL",
        p_mailing_address: null,
        p_housecall_address: null,
      },
      true,
    )
  ).id;
  const pet = (
    await rpc(
      "save_patient",
      {
        p_id: null,
        p_client_id: client,
        p_expected_version: null,
        p_name: "Synthetic attachment import",
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
  const snapshot = randomUUID(),
    mapping = randomUUID(),
    otherMapping = randomUUID(),
    siteId = randomUUID(),
    site = "Synthetic-" + siteId;
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
  const upstream = await serve(async (req, res) => {
    try {
      upstreamCalls++;
      const url = new URL(req.url!, "http://synthetic.test");
      res.setHeader("Content-Type", "application/json");
      if (url.pathname === "/v1/oauth/access_token") {
        assert.equal(req.method, "POST");
        let requestBody = ""; for await (const chunk of req) requestBody += chunk;
        assert.deepEqual(JSON.parse(requestBody), { client_id: "synthetic", client_secret: "synthetic", site_uid: site, grant_type: "client_credentials", scope: "read-attachment" });
        res.end(JSON.stringify({ access_token: "synthetic-only", expires_in: 43200 }));
        return;
      }
      assert.equal(req.method, "GET");
      assert.equal(req.headers.authorization, "Bearer synthetic-only");
      if (url.pathname === "/v1/attachment/download/701") {
        downloadCalls++;
        res.setHeader("Content-Type", sourceMode === "html" ? "text/html" : "application/octet-stream");
        const bytes = sourceMode === "html" ? new TextEncoder().encode("<html>not an original</html>") : originalBytes;
        res.setHeader("Content-Length", sourceMode === "oversize" ? 20971521 : bytes.byteLength);
        res.end(bytes); return;
      }
      assert.equal(url.pathname, "/v1/attachment");
      if (url.searchParams.has("id")) {
        exactReads++;
        assert.equal(url.searchParams.get("id"), "701");
        assert.deepEqual([...url.searchParams.keys()].sort(), ["id", "limit", "page", "record_id", "record_type"]);
        assert.equal(url.searchParams.get("record_type"), "Animal");
        assert.equal(url.searchParams.get("record_id"), "77");
        assert.equal(url.searchParams.get("page"), "1");
        assert.equal(url.searchParams.get("limit"), "10");
        res.end(JSON.stringify({ meta: { items_page: 1, items_page_total: 1, items_page_size: 10, items_total: 1 }, items: [{ attachment: {
          id: 701, file_id: 801, record_type: "Animal", record_id: "77", mime_type: "application/pdf",
          name: sourceMode === "mismatch" && exactReads % 2 === 0 ? "Changed source" : "<script>source name</script>", notes: "Synthetic metadata only",
          file_download_url: `https://files.example.test/private?cap=${urlRevision++}`, unknown_provider_field: "private-unknown-field",
        } }] })); return;
      }
      assert.deepEqual([...url.searchParams.keys()].sort(), ["limit", "page", "record_id", "record_type"]);
      assert.equal(url.searchParams.get("record_type"), "Animal");
      assert.equal(url.searchParams.get("record_id"), "77");
      assert.equal(url.searchParams.get("limit"), "10");
      const page = Number(url.searchParams.get("page"));
      assert.ok(page === 1 || page === 2);
      const items = Array.from({ length: page === 1 ? 2 : 1 }, (_, i) => ({ attachment: {
        id: page === 1 ? 701 : 702, file_id: page === 1 ? 801 : 802,
        record_type: "Animal", record_id: "77",
        mime_type: "application/pdf", name: "<script>source name</script>", notes: "Synthetic metadata only",
        file_download_url: `https://files.example.test/original?cap=private-capability-${urlRevision}-${i}`,
        unknown_provider_field: "private-unknown-field",
      } }));
      res.end(JSON.stringify({ meta: { items_page: page, items_page_total: 2, items_page_size: 2, items_total: 3 }, items }));
    } catch (error) { failures.push(error); res.statusCode = 500; res.end('{}'); }
  });
  const env: Record<string, string> = { APP_URL: origin, APP_ENV: "staging", EZYVET_IMPORT_MODE: "staging", EZYVET_SITE_UID: site, EZYVET_CLIENT_ID: "synthetic", EZYVET_CLIENT_SECRET: "synthetic", EZYVET_READ_RESOURCES: "attachment" };
  const handler = createImportHandler({ env: key => env[key], now: Date.now, sleep: async () => {},
    fetch: async (input, init) => {
      const url = new URL(String(input));
      assert.equal(url.origin, "https://api.trial.ezyvet.com");
      assert.equal(init?.redirect, "error");
      const localResponse = await fetch(upstream + url.pathname + url.search, init);
      return new Response(localResponse.body, { status: localResponse.status, headers: localResponse.headers });
    }, gateway: {
      authenticate: async bearer => {
        const response = await fetch(local.API_URL + "/auth/v1/user", { headers: { apikey: local.ANON_KEY, Authorization: `Bearer ${bearer}` } });
        if (!response.ok) return null;
        const user = await response.json();
        return { id: user.id, activeAdmin: await rpc("ezyvet_is_active_admin", { p_actor: user.id }) };
      },
      claim: async () => { throw new Error("Attachments must not use generic claim"); },
      claimAttachment: async (id, actor, site, sourceOrigin, animalLinkId) => rpc("claim_ezyvet_attachment_import", { p_id: id, p_actor: actor, p_site_uid: site, p_source_origin: sourceOrigin, p_animal_link_id: animalLinkId }),
      stage: async () => { throw new Error("Attachments must not use generic staging"); },
      stageAttachment: async (run: ImportRun, actor, page) => {
        const args = { p_run_id: run.id, p_actor: actor, p_lease_id: run.lease_id, p_page: page };
        const result = await rpc("stage_ezyvet_attachment_page", args);
        return result;
      },
      fail: async (run, actor, code, seconds) => { await rpc("fail_ezyvet_import_page", { p_id: run.id, p_actor: actor, p_lease_id: run.lease_id, p_code: code, p_retry_seconds: seconds }); },
    },
  });
  const endpoint = await serve(async (req, res) => {
    try {
      let body = ""; for await (const chunk of req) body += chunk;
      const response = await handler(new Request("http://127.0.0.1/ezyvet-import", { method: req.method, headers: req.headers as Record<string, string>, body }));
      res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(await response.text());
    } catch (error) { failures.push(error); res.statusCode = 500; res.end('{}'); }
  });
  const post = (body: Record<string, unknown>, authorization = staffHeaders.Authorization) => fetch(endpoint, { method: "POST", headers: { Authorization: authorization, Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const resetCooldown = () => sql(`update ezyvet_import_runs set retry_after=null,lease_until=null,lease_id=null where source_site_uid=${quote(site)};`);
  const observations = (id: string, cursor: Record<string, unknown> = {}) => rpc("list_ezyvet_attachment_observations", { p_run_id: id, p_animal_link_id: mapping, p_limit: 2, ...cursor }, true);
  const runId = randomUUID();
  const body = { run_id: runId, resource: "attachment", animal_link_id: mapping };
  check((await post(body)).status === 200, "Metadata page one commits");
  resetCooldown();
  check((await post(body)).status === 200, "Metadata page two commits");
  const observation = (await observations(runId)).observations[0];
  const captureRecover = (id: string) => rpc("recover_ezyvet_attachment_capture", { p_id: id, p_animal_link_id: mapping }, true);
  const prepareArgs = (id: string) => ({ p_id: id, p_animal_link_id: mapping, p_run_id: runId, p_page: observation.page, p_ordinal: observation.ordinal, p_snapshot_id: observation.snapshot_id, p_observed_head_version: observation.observed_head_version, p_stable_metadata_sha256: observation.stable_metadata_sha256 });
  const prepare = (id: string) => rpc("prepare_ezyvet_attachment_capture", prepareArgs(id), true);
  const resetCaptureCooldown = () => sql(`update ezyvet_attachment_capture_requests set retry_after=null where requested_by=${quote(actor)} and status in('prepared','reserved') and retry_after is not null;`);
  interface Intent { id: string; bucket_id: string; object_path: string; content_sha256: string; mime_type: string; file_size: number }
  const storageFetch = (input: string, init: RequestInit = {}) => fetch(input, { ...init, redirect: "error", signal: AbortSignal.timeout(20_000) });
  const objectUrl = (intent: Intent, authenticated = false) => local.API_URL + "/storage/v1/object/" + (authenticated ? "authenticated/" : "") + intent.bucket_id + "/" + intent.object_path;
  const readObject = async (intent: Intent) => {
    const response = await storageFetch(objectUrl(intent, true), { headers: { ...serviceHeaders, "Accept-Encoding": "identity" } });
    if (response.ok) return response;
    const problem = await response.json().catch(() => ({}));
    if ((response.status === 400 || response.status === 404) && String(problem.statusCode) === "404" && (problem.error === "not_found" || problem.message === "Object not found")) return null;
    throw new Error("Private object read failed");
  };
  let uploadCalls = 0, loseUploadAck = false, loseCompleteAck = false, loseDiscardAck = false, loseDeleteAck = false, stopBeforeUpload = false;
  let afterUpload: (() => Promise<void>) | null = null;
  const captureHandler = createCaptureHandler({ env: key => env[key], now: Date.now, sleep: async () => {},
    fetch: async (input, init) => {
      const url = new URL(String(input));
      assert.equal(url.origin, "https://api.trial.ezyvet.com"); assert.equal(init?.redirect, "error");
      const response = await fetch(upstream + url.pathname + url.search, init);
      return new Response(response.body, { status: response.status, headers: response.headers });
    }, gateway: {
      authenticate: async bearer => {
        const response = await fetch(local.API_URL + "/auth/v1/user", { headers: { apikey: local.ANON_KEY, Authorization: `Bearer ${bearer}` } });
        if (!response.ok) return null; const user = await response.json();
        return { id: user.id, activeAdmin: (await rpc("ezyvet_is_active_admin", { p_actor: user.id })) === true };
      },
      context: (id, actor) => rpc("get_ezyvet_attachment_capture_context", { p_id: id, p_actor: actor }),
      claim: (id, actor) => rpc("claim_ezyvet_attachment_capture", { p_id: id, p_actor: actor }),
      reserve: (id, actor, leaseId, file, beforeRaw, afterRaw) => rpc("reserve_ezyvet_attachment_original", { p_id: id, p_actor: actor, p_lease_id: leaseId, p_content_sha256: file.sha256, p_mime_type: file.mimeType, p_file_size: file.size, p_before_raw_sha256: beforeRaw, p_after_raw_sha256: afterRaw }),
      complete: async (id, actor, leaseId, intent, file) => {
        const result = await rpc("complete_ezyvet_attachment_capture", { p_id: id, p_actor: actor, p_lease_id: leaseId, p_intent_id: intent.id, p_content_sha256: file.sha256, p_mime_type: file.mimeType, p_file_size: file.size });
        if (loseCompleteAck) { loseCompleteAck = false; throw new Error("Lost committed capture acknowledgment"); }
        return result;
      },
      fail: (id, actor, leaseId, code, seconds, terminal) => rpc("fail_ezyvet_attachment_capture", { p_id: id, p_actor: actor, p_lease_id: leaseId, p_code: code, p_retry_seconds: seconds, p_terminal: terminal }),
      beginDiscard: (id, actor) => rpc("begin_discard_ezyvet_attachment_capture", { p_id: id, p_actor: actor }),
      completeDiscard: async (id, actor) => {
        const result = await rpc("complete_discard_ezyvet_attachment_capture", { p_id: id, p_actor: actor });
        if (loseDiscardAck) { loseDiscardAck = false; throw new Error("Lost committed discard acknowledgment"); }
        return result;
      },
      readObject,
      uploadObject: async (intent, bytes, bearer) => {
        if (stopBeforeUpload) { stopBeforeUpload = false; throw new Error("Synthetic upload interruption"); }
        uploadCalls++;
        const response = await storageFetch(objectUrl(intent), { method: "POST", headers: { apikey: local.ANON_KEY, Authorization: `Bearer ${bearer}`, "Content-Type": intent.mime_type, "x-upsert": "false" }, body: bytes });
        if (!response.ok) throw new Error("Staff upload refused");
        if (afterUpload) { const effect = afterUpload; afterUpload = null; await effect(); }
        if (loseUploadAck) { loseUploadAck = false; throw new Error("Lost successful upload acknowledgment"); }
      },
      deleteObject: async intent => {
        const response = await storageFetch(local.API_URL + "/storage/v1/object/" + intent.bucket_id, { method: "DELETE", headers: serviceHeaders, body: JSON.stringify({ prefixes: [intent.object_path] }) });
        if (!response.ok) throw new Error("Owned fenced deletion failed");
        if (loseDeleteAck) { loseDeleteAck = false; throw new Error("Lost successful deletion acknowledgment"); }
      },
    },
  });
  const captureEndpoint = await serve(async (req, res) => {
    try {
      let body = ""; for await (const chunk of req) body += chunk;
      const response = await captureHandler(new Request("http://127.0.0.1/capture-ezyvet-attachment", { method: req.method, headers: req.headers as Record<string, string>, body }));
      res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(new Uint8Array(await response.arrayBuffer()));
    } catch (error) { failures.push(error); res.statusCode = 500; res.end('{}'); }
  });
  const act = (id: string, action = "capture", authorization = staffHeaders.Authorization) => fetch(captureEndpoint, { method: "POST", headers: { Authorization: authorization, Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ request_id: id, action }) });
  const hash = async (bytes: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))).map(b => b.toString(16).padStart(2, "0")).join("");
  const nativeEffects = () => sql("select jsonb_build_array((select count(*) from patient_documents),(select count(*) from patient_treatments),(select count(*) from billing_invoices),(select count(*) from inventory_movements),(select count(*) from communication_outbox));");
  const initialNative = nativeEffects();
  const id = randomUUID();
  const intentPrepared = await prepare(id);
  check(intentPrepared.status === "prepared" && intentPrepared.capture === null, "Preparation reserves metadata intent without claiming bytes");
  check((await prepare(id)).request_hash === intentPrepared.request_hash, "Lost prepare acknowledgment recovers same immutable request");
  const callsBeforeAuth = upstreamCalls;
  check((await act(id, "capture", "Bearer invalid")).status === 401 && upstreamCalls === callsBeforeAuth, "Invalid JWT makes no source request");
  resetCooldown();
  loseUploadAck = true; loseCompleteAck = true;
  await act(id);
  const savedAfterLost = await captureRecover(id);
  check(savedAfterLost.status === "ready" || savedAfterLost.status === "reserved", "Unknown upload/capture reply preserves durable original intent");
  const sourceAfterUpload = upstreamCalls;
  if (savedAfterLost.status !== "ready") { resetCaptureCooldown(); await act(id); }
  const ready = await captureRecover(id);
  check(ready.status === "ready" && ready.capture.content_sha256 === await hash(originalBytes), "Capture records checksum of actual private bytes");
  check(ready.capture.file_size === originalBytes.byteLength && ready.capture.mime_type === "application/pdf", "Signature resolves octet-stream into verified PDF");
  check(upstreamCalls === sourceAfterUpload && uploadCalls === 1, "Lost acknowledgment recovers private upload without source re-download or overwrite");
  check(!JSON.stringify(ready).includes('private?cap=') && !('lease_id' in ready) && !('object_path' in ready), "Browser capture receipt excludes temporary capabilities and service context");
  const privateReady = await rpc("get_ezyvet_attachment_capture_context", { p_id: id, p_actor: actor });
  check(privateReady.intent.before_raw_sha256 !== privateReady.intent.after_raw_sha256, "URL-only renewal retains distinct before/after observations");
  // Exercise canonical approvals over PostgREST against the actual captured file.
  const parsedCapture=validateCapture(ready,actor,{link_id:mapping,pet_id:pet,external_id:"77",source_origin:"https://api.trial.ezyvet.com",source_site_uid:site});
  check((await rpc("read_ezyvet_attachment_chart",{p_pet_id:pet},true)).records.length===0,"Unreviewed physical capture stays out of chart");
  const reviewId=randomUUID(),correctionId=randomUUID(),cancelId=randomUUID();
  const decision=parseAttachmentDecision({id:reviewId,actor,pet,request:id,captureHash:ready.capture.capture_hash,previous:null,title:"Reviewed real local original",reason:"Synthetic patient and original verified"},parsedCapture,actor);
  const approvalArgs=(review:string,previous:string|null=null)=>({p_id:review,p_request_id:id,p_pet_id:pet,p_capture_hash:ready.capture.capture_hash,p_previous_record_id:previous,p_title:decision.title,p_review_reason:decision.reason,p_attest:true});
  const approved=await rpc("approve_ezyvet_attachment_record",approvalArgs(reviewId),true);
  check(parseAttachmentDecisionOutcome({status:"approved",record:approved,cancellation:null},decision,parsedCapture)?.status==="approved","Actual SQL approval provenance passes canonical client parser");
  const recoveredDecision=await rpc("recover_ezyvet_attachment_approval",{p_id:reviewId,p_request_id:id,p_pet_id:pet,p_capture_hash:ready.capture.capture_hash},true);
  check(parseAttachmentDecisionOutcome(recoveredDecision,decision,parsedCapture)?.record?.record_hash===approved.record_hash,"Actual lost approval reply recovers exact immutable record");
  const corrected=await rpc("approve_ezyvet_attachment_record",approvalArgs(correctionId,reviewId),true);
  check(corrected.version===2&&corrected.previous_record_id===reviewId,"Actual correction preserves predecessor");
  // Actual API-only release: no clinical sending, only owned fixture acceptance.
  const releaseSelection={api_attachment_ids:[correctionId]};
  const releasePreview=await rpc("preview_record_release_v9",{p_pet_id:pet,p_client_id:client,p_channel:"EMAIL",p_recipient:"attachment-owner@example.test",p_selection:releaseSelection},true);
  check(renderRecordRelease({preview:releasePreview}).includes("Selected ezyVet API originals"),"Actual canonical SQL preview passes production shared renderer");
  check(releasePreview.snapshot.attachments[0].content_sha256===ready.capture.content_sha256,"Actual preview binds physical capture checksum");
  const releaseId=randomUUID(),conversationId=randomUUID(),emailRequestId=randomUUID();
  const confirmArgs={p_id:releaseId,p_pet_id:pet,p_client_id:client,p_channel:"EMAIL",p_recipient:"attachment-owner@example.test",p_selection:releaseSelection,p_reviewed_snapshot:releasePreview.snapshot,p_reviewed_hash:releasePreview.source_hash,p_attest_review:true};
  await assert.rejects(rpc("confirm_record_release",confirmArgs,true),(e:{code:string})=>e.code==="42501");assertions++;
  sql("insert into record_release_policy(id,enabled,accepted_by,accepted_at,acceptance_reference,accepted_schema_version) values(true,true,'Synthetic local reviewer',now(),'LOCAL TEST ONLY',9);");
  const confirmedRelease=await rpc("confirm_record_release",confirmArgs,true);
  check(confirmedRelease.source_hash===releasePreview.source_hash,"Actual release confirms exact reviewed hash");
  sql(`insert into conversations(id,client_id) values(${quote(conversationId)},${quote(client)});`);
  const releaseEmailArgs={p_request_id:emailRequestId,p_release_id:releaseId,p_conversation_id:conversationId,p_subject:"Synthetic original release",p_body:"Local acceptance only",p_release_hash:releasePreview.source_hash};
  let releaseReads=0,losePayloadReply=true;
  const releaseDownload=async(bucket:string,path:string,expectedSize:number)=>{
    releaseReads++;
    const url=local.API_URL+"/storage/v1/object/authenticated/"+encodeURIComponent(bucket)+"/"+path.split('/').map(encodeURIComponent).join('/');
    const response=await storageFetch(url,{headers:{...serviceHeaders,"Accept-Encoding":"identity"}});
    assert.ok(response.ok,"Physical release Storage read succeeded");
    const bytes=new Uint8Array(await response.arrayBuffer());assert.equal(bytes.length,expectedSize);return bytes;
  };
  const releaseDb=(staff:boolean)=>({rpc:async(name:string,args:Record<string,unknown>)=>{
    try{const data=await rpc(name,args,staff);
      if(!staff&&name==="capture_release_email_payload"&&losePayloadReply){losePayloadReply=false;return {data:null,error:new Error("Lost committed payload reply")};}
      return {data,error:null};
    }catch(error){return {data:null,error};}
  }});
  const emailHandler=createPrepareReleaseEmailHandler({authenticate:async(token)=>{
    const response=await fetch(local.API_URL+"/auth/v1/user",{headers:{apikey:local.ANON_KEY,Authorization:`Bearer ${token}`}});
    if(!response.ok)return null;const user=await response.json();return user.id===actor?{actorId:user.id,db:releaseDb(true)}:null;
  },service:releaseDb(false),download:releaseDownload,sender:{from:"care@example.test",replyTo:"care@example.test"}});
  const emailEndpoint=await serve(async(req,res)=>{
    try{let body="";for await(const chunk of req)body+=chunk;
      const response=await emailHandler(new Request("http://local.test/prepare-release-email",{method:req.method,headers:req.headers as Record<string,string>,body}));
      res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
    }catch(error){failures.push(error);res.statusCode=500;res.end('{}');}
  });
  const prepareEmail=()=>fetch(emailEndpoint,{method:"POST",headers:staffHeaders,body:JSON.stringify(releaseEmailArgs)});
  // SQL verifier must reject swapped bytes before any successful capture exists.
  const emailPrepared=await rpc("prepare_release_email",releaseEmailArgs,true);
  const currentRelease=await rpc("read_record_release",{p_id:releaseId},true);
  const frozen=await buildReleaseEmailPayload(emailPrepared.request,currentRelease,{from:"care@example.test",replyTo:"care@example.test"},releaseDownload);
  const changedPayload=JSON.parse(frozen.payload_text),changedBytes=originalBytes.slice();changedBytes[changedBytes.length-1]^=1;
  changedPayload.attachments[1].content=Buffer.from(changedBytes).toString('base64');
  await assert.rejects(rpc("capture_release_email_payload",{p_request_id:emailRequestId,p_actor_id:actor,p_payload_text:JSON.stringify(changedPayload)}),(e:{code:string})=>e.code==="23514");assertions++;
  check(sql(`select count(*) from release_email_payloads where request_id=${quote(emailRequestId)};`)==="0","Corrupted original cannot create a saved payload");
  check(!(await prepareEmail()).ok&&!losePayloadReply,"Simulated lost reply happens after actual payload capture");
  const readsAfterPayload=releaseReads;
  const recoveredEmailResponse=await prepareEmail();check(recoveredEmailResponse.ok,"Same handler request recovers saved payload");
  const recoveredEmail=await recoveredEmailResponse.json();
  check(recoveredEmail.payload_hash===frozen.payload_hash&&releaseReads===readsAfterPayload,"Lost response recovery preserves bytes without downloading again");
  check(recoveredEmail.manifest[1].sha256===ready.capture.content_sha256,"Actual SQL payload manifest binds captured original digest");
  check(sql(`select count(*) from release_email_payloads where request_id=${quote(emailRequestId)};`)==="1","Unknown response produces exactly one immutable payload");
  const canceled=await rpc("cancel_ezyvet_attachment_approval",{p_id:cancelId,p_request_id:id,p_pet_id:pet,p_capture_hash:ready.capture.capture_hash,p_confirmed:true},true);
  check(canceled.status==="canceled","Unconfirmed review obtains durable cancellation");
  await assert.rejects(rpc("approve_ezyvet_attachment_record",approvalArgs(cancelId,correctionId),true),(error:{code:string})=>error.code==="23514");assertions++;
  const readerEmail=`attachment-reader-${randomUUID()}@example.test`,readerPassword=`Synthetic-${randomUUID()}-Aa1!`;
  const readerActor=(await api("/auth/v1/admin/users",{email:readerEmail,password:readerPassword,email_confirm:true})).id;
  sql(`insert into user_roles(user_id,role) values(${quote(readerActor)},'STAFF') on conflict do nothing;`);
  const readerAuth=await api("/auth/v1/token?grant_type=password",{email:readerEmail,password:readerPassword},{apikey:local.ANON_KEY,"Content-Type":"application/json"});
  const readerHeaders={...staffHeaders,Authorization:`Bearer ${readerAuth.access_token}`};
  const chart=await api("/rest/v1/rpc/read_ezyvet_attachment_chart",{p_pet_id:pet},readerHeaders);
  check(chart.records.length===2&&chart.records[0].is_latest&&!chart.records[1].is_latest,"Non-owner staff sees both actual approval versions");
  check(!JSON.stringify(chart).includes('object_path')&&!JSON.stringify(chart).includes('source_context'),"Actual staff chart projection omits private context");
  await assert.rejects(api("/rest/v1/rpc/get_reviewed_ezyvet_original_context",{p_actor:readerActor,p_record_id:reviewId,p_pet_id:pet,p_capture_hash:ready.capture.capture_hash},readerHeaders),(error:{code:string})=>error.code==="42501");assertions++;
  let revokeReaderDuringRead=false,reviewedReads=0;
  const setReaderActive=(active:boolean)=>sql(`begin;select set_config('request.jwt.claims',${quote(JSON.stringify({sub:actor,role:"authenticated"}))},true);update profiles set is_active=${active} where id=${quote(readerActor)};commit;`);
  const reviewedHandler=createReviewedHandler({env:key=>env[key],authenticate:async token=>{
    const response=await fetch(local.API_URL+"/auth/v1/user",{headers:{apikey:local.ANON_KEY,Authorization:`Bearer ${token}`}});
    if(!response.ok)return null;return(await response.json()).id;
  },context:(reader,record,patient,captureHash)=>rpc("get_reviewed_ezyvet_original_context",{p_actor:reader,p_record_id:record,p_pet_id:patient,p_capture_hash:captureHash}),read:async context=>{
    reviewedReads++;
    const response=await storageFetch(objectUrl({...context,id:context.intent_id},true),{headers:{...serviceHeaders,"Accept-Encoding":"identity"}});
    if(revokeReaderDuringRead){revokeReaderDuringRead=false;setReaderActive(false);}
    return response;
  }});
  const reviewedEndpoint=await serve(async(req,res)=>{
    try{let body="";for await(const chunk of req)body+=chunk;
      const response=await reviewedHandler(new Request("http://local.test/reviewed",{method:req.method,headers:req.headers as Record<string,string>,body}));
      res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
    }catch(error){failures.push(error);res.statusCode=500;res.end('{}');}
  });
  const reviewedDownload=(record=reviewId,patient=pet,captureHash=ready.capture.capture_hash)=>fetch(reviewedEndpoint,{method:"POST",headers:{...readerHeaders,Origin:origin},body:JSON.stringify({record_id:record,pet_id:patient,capture_hash:captureHash})});
  const verifiedOriginal=await reviewedDownload();
  check(verifiedOriginal.ok&&await hash(new Uint8Array(await verifiedOriginal.arrayBuffer()))===ready.capture.content_sha256,"Non-owner staff retrieves exact physical original through reviewed handler");
  check(!(await storageFetch(objectUrl(privateReady.intent,true),{headers:readerHeaders})).ok,"Reviewed staff cannot bypass handler via direct Storage");
  const readsBeforeMismatch=reviewedReads;
  check(!(await reviewedDownload(reviewId,client)).ok&&!(await reviewedDownload(reviewId,pet,'f'.repeat(64))).ok&&reviewedReads===readsBeforeMismatch,"Wrong patient or capture hash denied before physical read");
  revokeReaderDuringRead=true;
  check(!(await reviewedDownload()).ok,"Deactivation after actual Storage response prevents reviewed download");
  const readsBeforeInactive=reviewedReads;
  check(!(await reviewedDownload()).ok&&reviewedReads===readsBeforeInactive,"Inactive reader denied before physical read");
  setReaderActive(true);
  check((await reviewedDownload(correctionId)).ok,"Reactivated staff can retrieve explicitly corrected version");
  env.EZYVET_IMPORT_MODE = "disabled";
  check((await act(id)).status === 200 && upstreamCalls === sourceAfterUpload, "Ready capture retry bypasses disabled source configuration");
  const downloaded = await act(id, "retrieve");
  check(downloaded.ok && downloaded.headers.get("x-content-type-options") === "nosniff" && downloaded.headers.get("cache-control")?.includes("no-store"), "Verified original retrieval is noncacheable and non-sniffable");
  check(await hash(new Uint8Array(await downloaded.arrayBuffer())) === ready.capture.content_sha256, "Retrieved bytes exactly match immutable capture checksum");
  check(upstreamCalls === sourceAfterUpload, "Retrieval never contacts ezyVet");
  const directRead = await storageFetch(objectUrl(privateReady.intent, true), { headers: staffHeaders });
  check(!directRead.ok, "Even original owner cannot bypass verified retrieval via direct Storage read");
  const overwrite = await storageFetch(objectUrl(privateReady.intent), { method: "PUT", headers: { ...staffHeaders, "Content-Type": "application/pdf", "x-upsert": "true" }, body: originalBytes });
  check(!overwrite.ok, "Captured object cannot be overwritten through staff Storage access");
  check(!(await act(id, "discard")).ok && (await captureRecover(id)).status === "ready", "Captured originals cannot be discarded through pending cleanup");
  env.EZYVET_IMPORT_MODE = "staging";
  const interruptedId = randomUUID(); await prepare(interruptedId); resetCaptureCooldown(); resetCooldown(); stopBeforeUpload = true;
  await act(interruptedId);
  const interrupted = await captureRecover(interruptedId);
  check(interrupted.status === "reserved" && interrupted.last_error_code === "STORAGE_UNAVAILABLE", "Pre-upload failure preserves immutable reserved intent and durable error");
  const interruptedPrivate = await rpc("get_ezyvet_attachment_capture_context", { p_id: interruptedId, p_actor: actor });
  check(await readObject(interruptedPrivate.intent) === null, "Interrupted upload has no private object");
  loseDiscardAck = true; await act(interruptedId, "discard");
  check((await captureRecover(interruptedId)).status === "abandoned", "Lost discard reply recovers exact abandoned receipt");
  check((await act(interruptedId, "discard")).ok, "Repeated discard is provider-free and idempotent");
  const lateUpload = await storageFetch(objectUrl(interruptedPrivate.intent), { method: "POST", headers: { ...staffHeaders, "Content-Type": "application/pdf", "x-upsert": "false" }, body: originalBytes });
  check(!lateUpload.ok && await readObject(interruptedPrivate.intent) === null, "Fenced discard blocks delayed staff upload");
  for (const mode of ["html", "oversize", "mismatch"]) {
    sourceMode = mode; exactReads = 0; const blockedId = randomUUID(); await prepare(blockedId); resetCaptureCooldown(); resetCooldown();
    const uploadedBefore = uploadCalls;
    await act(blockedId);
    const blocked = await captureRecover(blockedId);
    const expectedCode = { html: "ATTACHMENT_UNSUPPORTED_TYPE", oversize: "ATTACHMENT_TOO_LARGE", mismatch: "SOURCE_ATTACHMENT_METADATA_CHANGED" }[mode];
    check(blocked.status === "blocked" && blocked.capture === null && blocked.last_error_code === expectedCode && blocked.retry_after === null && blocked.retryable === false, "Unsupported or changed source stays an explicit blocked result");
    check(uploadCalls === uploadedBefore, "Rejected source bytes never reach private Storage");
  }
  sourceMode = "valid";
  const pendingId = randomUUID(); await prepare(pendingId); resetCaptureCooldown(); resetCooldown();
  afterUpload = async () => { sql(`update ezyvet_identity_heads set version=version+1 where source_site_uid=${quote(site)} and resource='animal' and external_id='77';`); };
  await act(pendingId);
  const changed = await captureRecover(pendingId);
  check(changed.status !== "ready" && changed.capture === null && !changed.source_current, "Parent change after upload prevents clinical-original receipt");
  const changedPrivate = await rpc("get_ezyvet_attachment_capture_context", { p_id: pendingId, p_actor: actor });
  check((await readObject(changedPrivate.intent))?.ok, "Uncommitted stale object remains tracked by immutable intent");
  loseDeleteAck = true;
  check((await act(pendingId, "discard")).ok && await readObject(changedPrivate.intent) === null, "Explicit discard removes only owned uncommitted stale object");
  const uncreatedId = randomUUID();
  await assert.rejects(prepare(uncreatedId)); assertions++;
  check(await captureRecover(uncreatedId) === null, "Rejected stale preparation has no false capture row");
  const abandonedUnknown = await rpc("abandon_ezyvet_attachment_capture_preparation", prepareArgs(uncreatedId), true);
  check(abandonedUnknown.status === "abandoned", "Unknown stale preparation receives durable owned cancellation receipt");
  check((await prepare(uncreatedId)).status === "abandoned", "Delayed prepare cannot recreate abandoned request");
  check((await rpc("abandon_ezyvet_attachment_capture_preparation", prepareArgs(id), true)).status === "ready", "Preparation cancellation recovers existing capture without deleting bytes");
  const historicalChart=await api("/rest/v1/rpc/read_ezyvet_attachment_chart",{p_pet_id:pet},readerHeaders);
  check(historicalChart.records.every((row:{source_current:boolean})=>!row.source_current)&&(await reviewedDownload()).ok,"Source changes retain historical staff access with honest stale chart flags");
  const historical = await captureRecover(id);
  check(historical.status === "ready" && historical.source_current === false, "Historical capture remains ready with explicit stale source badge");
  const staleRelease=await rpc("read_record_release",{p_id:releaseId},true);
  check(!staleRelease.eligible&&staleRelease.events.some((e:{kind:string})=>e.kind==="source_changed"),"Actual source revision invalidates confirmed API release");
  const historicalEmailResponse=await prepareEmail(),historicalEmail=await historicalEmailResponse.json();
  check(historicalEmailResponse.ok&&historicalEmail.payload_hash===recoveredEmail.payload_hash&&releaseReads===readsAfterPayload,"Historical handler recovery returns saved artifact without source read or send");
  check((await rpc("confirm_record_release",confirmArgs,true)).source_hash===confirmedRelease.source_hash,"Actual confirmation replay preserves immutable historical receipt");
  sql("update record_release_policy set enabled=false;");

  check((await act(id, "retrieve")).ok, "Original historical bytes remain recoverable after parent changes");
  const history = await rpc("list_ezyvet_attachment_captures", { p_animal_link_id: mapping, p_limit: 2 }, true);
  check(history.captures.length === 2 && history.has_more && history.next_cursor !== null, "Server capture history supports bounded pointerless discovery");
  const nextHistory = await rpc("list_ezyvet_attachment_captures", { p_animal_link_id: mapping, p_limit: 2, p_before_at: history.next_cursor.before_at, p_before_id: history.next_cursor.before_id }, true);
  check(nextHistory.captures.every((c: { id: string }) => !history.captures.some((h: { id: string }) => c.id === h.id)), "Capture history cursor avoids repeated rows");
  const tampered = originalBytes.slice(); tampered[12] ^= 1;
  const tamperWrite = await storageFetch(objectUrl(privateReady.intent), { method: "PUT", headers: { ...serviceHeaders, "Content-Type": "application/pdf", "x-upsert": "true" }, body: tampered });
  check(tamperWrite.ok, "Owned local fixture simulates same-size private object corruption");
  check(!(await reviewedDownload()).ok,"Reviewed handler rejects actual same-size private Storage corruption");
  const tamperRetrieval = await act(id, "retrieve");
  check(!tamperRetrieval.ok, "Same-size Storage byte substitution cannot be served under original receipt");
  const repairWrite = await storageFetch(objectUrl(privateReady.intent), { method: "PUT", headers: { ...serviceHeaders, "Content-Type": "application/pdf", "x-upsert": "true" }, body: originalBytes });
  check(repairWrite.ok && (await act(id, "retrieve")).ok, "Restored fixture bytes again satisfy immutable receipt");
  const movedClient = (await rpc("save_client", { p_actor_id: actor, p_client_id: null, p_expected_version: null, p_first_name: "Synthetic", p_last_name: "Moved household", p_primary_phone: null, p_primary_email: null, p_preferred_channel: "EMAIL", p_mailing_address: null, p_housecall_address: null }, true)).id;
  // Owner-only future transfer fixture; production currently forbids direct household changes.
  sql(`begin; alter table pets disable trigger pets_version; update pets set client_id=${quote(movedClient)} where id=${quote(pet)}; alter table pets enable trigger pets_version; commit;`);
  const historicalMappings = await rpc("list_ezyvet_attachment_capture_mappings", { p_limit: 20 }, true);
  check(historicalMappings.mappings.some((m: { link_id: string }) => m.link_id === mapping), "Owned original discovery survives patient household changes");
  check((await act(id, "retrieve")).ok, "Owned historical original retrieval survives household changes");
  check((await reviewedDownload()).ok,"Reviewed physical original remains bound to patient after household move");
  const otherEmail = `attachment-other-${randomUUID()}@example.test`, otherPassword = `Synthetic-${randomUUID()}-Aa1!`;
  const otherActor = (await api("/auth/v1/admin/users", { email: otherEmail, password: otherPassword, email_confirm: true })).id;
  sql(`insert into user_roles(user_id,role) values(${quote(otherActor)},'ADMIN');`);
  const otherAuth = await api("/auth/v1/token?grant_type=password", { email: otherEmail, password: otherPassword }, { apikey: local.ANON_KEY, "Content-Type": "application/json" });
  check(!(await act(id, "retrieve", `Bearer ${otherAuth.access_token}`)).ok, "Another active administrator cannot retrieve owned original");
  await assert.rejects(api("/rest/v1/rpc/recover_ezyvet_attachment_capture", { p_id: id, p_animal_link_id: mapping }, { ...staffHeaders, Authorization: `Bearer ${otherAuth.access_token}` }), (e: { code: string }) => e.code === "42501"); assertions++;
  check(nativeEffects() === initialNative, "API capture does not promote patient documents, clinical records, billing, inventory or messages");
  check((await observations(runId)).observations.every((o: { file_sha256: unknown }) => o.file_sha256 === null), "Original capture never rewrites metadata observations into byte evidence");
  sql(`delete from user_roles where user_id=${quote(actor)} and role='ADMIN';`);
  const sourceBeforeRole = upstreamCalls;
  check((await act(id, "retrieve")).status === 403 && upstreamCalls === sourceBeforeRole, "Current staff-role removal denies original retrieval");
  check(downloadCalls >= 1 && failures.length === 0, "Native source/handler servers completed without unexpected failure");
} finally {
  for (const server of closeables) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
console.log(`Attachment original HTTP/Auth/Storage: ${assertions} checks passed. Synthetic upstream only; no ezyVet requests.`);
