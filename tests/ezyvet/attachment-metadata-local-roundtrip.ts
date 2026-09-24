/** Attachment metadata through real local HTTP, Auth and PostgREST; synthetic upstream only. */
import { createServer } from "node:http";
import type { RequestListener } from "node:http";
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
let upstreamCalls = 0, wrongParent = false, loseAck = false, urlRevision = 1;
let capturedFirstPage: Record<string, unknown> | null = null;
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
  // A1 (#164): handle_new_user no longer activates a new auth user, so a fixture
  // that needs an active synthetic staff member must activate it explicitly.
  sql(
    `insert into public.user_roles(user_id,role) values(${quote(actor)},'STAFF') on conflict do nothing; update public.profiles set is_active=true where id=${quote(actor)};`,
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
        p_primary_email: null,
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
  const effects = () => sql("select jsonb_build_array((select count(*) from patient_documents),(select count(*) from patient_treatments),(select count(*) from billing_invoices),(select count(*) from inventory_movements),(select count(*) from communication_outbox),(select count(*) from storage.objects));");
  const beforeEffects = effects();
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
      assert.equal(url.pathname, "/v1/attachment");
      assert.deepEqual([...url.searchParams.keys()].sort(), ["limit", "page", "record_id", "record_type"]);
      assert.equal(url.searchParams.get("record_type"), "Animal");
      assert.equal(url.searchParams.get("record_id"), "77");
      assert.equal(url.searchParams.get("limit"), "10");
      const page = Number(url.searchParams.get("page"));
      assert.ok(page === 1 || page === 2);
      const items = Array.from({ length: page === 1 ? 2 : 1 }, (_, i) => ({ attachment: {
        id: page === 1 ? 701 : 702, file_id: page === 1 ? 801 : 802,
        record_type: "Animal", record_id: wrongParent ? "999" : "77",
        mime_type: "application/pdf", name: "<script>source name</script>", notes: "Synthetic metadata only",
        file_download_url: `https://files.example.test/original?cap=private-capability-${urlRevision}-${i}`,
        unknown_provider_field: "private-unknown-field",
      } }));
      res.end(JSON.stringify({ meta: { items_page: page, items_page_total: 2, items_page_size: 2, items_total: 3 }, items }));
    } catch (error) { failures.push(error); res.statusCode = 500; res.end('{}'); }
  });
  const env: Record<string, string> = { APP_URL: origin, APP_ENV: "staging", EZYVET_IMPORT_MODE: "staging", EZYVET_SITE_UID: site, EZYVET_CLIENT_ID: "synthetic", EZYVET_CLIENT_SECRET: "synthetic", EZYVET_READ_RESOURCES: "attachment" };
  const handler = createHandler({ env: key => env[key], now: Date.now, sleep: async () => {},
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
        if (!capturedFirstPage) capturedFirstPage = structuredClone(args);
        const result = await rpc("stage_ezyvet_attachment_page", args);
        if (loseAck) { loseAck = false; throw new Error("Simulated lost committed acknowledgment"); }
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
  const recover = (id: string) => rpc("recover_ezyvet_attachment_run", { p_id: id, p_animal_link_id: mapping }, true);
  const observations = (id: string, cursor: Record<string, unknown> = {}) => rpc("list_ezyvet_attachment_observations", { p_run_id: id, p_animal_link_id: mapping, p_limit: 2, ...cursor }, true);
  const runId = randomUUID();
  const body = { run_id: runId, resource: "attachment", animal_link_id: mapping };
  check((await post(body, "Bearer invalid")).status === 401, "Invalid authentication rejected");
  check(upstreamCalls === 0, "Authentication failure performs no provider traffic");
  loseAck = true;
  check((await post(body)).status === 503, "Lost first-page reply reports uncertainty");
  const first = await recover(runId);
  check(first.status === "running" && first.next_page === 2, "Recovery sees actual committed checkpoint");
  check(first.observed_count === 2 && first.staged_count === 1, "Observed duplicates remain distinct from staged snapshot versions");
  check(!("lease_id" in first) && first.capture_available === false, "Recovery hides service lease and claims no file capture");
  const firstObservations = await observations(runId);
  check(firstObservations.observations.length === 2, "Both ordered duplicate observations preserved");
  check(firstObservations.observations.every((o: { file_sha256: unknown }) => o.file_sha256 === null), "No invented file checksum");
  check(!JSON.stringify(firstObservations).includes('private-capability') && !JSON.stringify(firstObservations).includes('private-unknown-field'), "Staff projection excludes temporary URLs and unknown source fields");
  resetCooldown(); loseAck = true;
  check((await post(body)).status === 503, "Lost terminal reply reports uncertainty");
  const terminal = await recover(runId);
  check(terminal.status === "review_ready" && terminal.next_page === 3 && terminal.observed_count === 3 && terminal.staged_count === 2, "Terminal recovery preserves exact counts");
  const callsAtTerminal = upstreamCalls;
  check((await post(body)).status === 200 && upstreamCalls === callsAtTerminal, "Terminal retry recovers without another provider read");
  const pageOne = await observations(runId);
  check(pageOne.has_more && pageOne.next_cursor.after_page === 1 && pageOne.next_cursor.after_ordinal === 2, "Observation discovery exposes bounded cursor");
  const pageTwo = await observations(runId, { p_after_page: pageOne.next_cursor.after_page, p_after_ordinal: pageOne.next_cursor.after_ordinal });
  check(pageTwo.observations.length === 1 && pageTwo.observations[0].page === 2 && !pageTwo.has_more, "Discovery resumes with no duplicate rows");
  const listed = await rpc("list_ezyvet_attachment_runs", { p_animal_link_id: mapping, p_limit: 20 }, true);
  check(listed.runs.some((r: { id: string }) => r.id === runId), "Server discovery recovers browser pointer loss");
  await assert.rejects(rpc("recover_ezyvet_attachment_run", { p_id: runId, p_animal_link_id: otherMapping }, true), (e: { code: string }) => e.code === "42501"); assertions++;
  assert.ok(capturedFirstPage);
  await rpc("stage_ezyvet_attachment_page", capturedFirstPage);
  check((await recover(runId)).observed_count === 3, "Exact committed replay leaves immutable receipt count unchanged");
  const altered = structuredClone(capturedFirstPage) as { p_page: { page_sha256: string } };
  altered.p_page.page_sha256 = 'f'.repeat(64);
  await assert.rejects(rpc("stage_ezyvet_attachment_page", altered), (e: { code: string }) => ['23514','40001'].includes(e.code)); assertions++;
  await assert.rejects(rpc("stage_ezyvet_import_page", { p_id: runId, p_actor: actor, p_lease_id: randomUUID(), p_page: 3, p_complete: true, p_items: [] }), (e: { code: string }) => e.code === '23514'); assertions++;
  const secondRun = randomUUID(); urlRevision++;
  resetCooldown();
  check((await post({ ...body, run_id: secondRun })).status === 200, "New scan observes renewed URLs");
  const renewed = (await observations(secondRun)).observations;
  check(renewed[0].snapshot_id === firstObservations.observations[0].snapshot_id && renewed[0].observed_head_version === firstObservations.observations[0].observed_head_version, "URL renewal does not advance stable source head");
  check(renewed[0].stable_metadata_sha256 === firstObservations.observations[0].stable_metadata_sha256 && renewed[0].raw_record_sha256 !== firstObservations.observations[0].raw_record_sha256, "Renewed URL has distinct observed evidence and unchanged stable fingerprint");
  resetCooldown();
  check((await post({ ...body, run_id: secondRun })).status === 200, "Second metadata scan completes");
  const rejectedRun = randomUUID(); wrongParent = true; resetCooldown();
  check((await post({ ...body, run_id: rejectedRun })).status === 503, "Wrong source parent fails the entire page");
  check((await recover(rejectedRun)).next_page === 1 && (await observations(rejectedRun)).observations.length === 0, "Rejected page does not advance checkpoint or persist observations");
  const rejectedReceipt = await recover(rejectedRun);
  check(rejectedReceipt.last_error_code === "ATTACHMENT_PARENT_MISMATCH" && Date.parse(rejectedReceipt.retry_after) > Date.now(), "Rejected source page persists its actual failure and cooldown");
  wrongParent = false;
  sql(`update ezyvet_identity_heads set version=version+1 where source_site_uid=${quote(site)} and resource='animal' and external_id='77';`);
  const sourceCalls = upstreamCalls; resetCooldown();
  check((await post({ ...body, run_id: rejectedRun })).status === 409 && upstreamCalls === sourceCalls, "Stale frozen parent rejects continuation before provider traffic");
  check((await observations(runId)).observations.every((o: { is_current: boolean }) => !o.is_current), "Historical metadata remains discoverable and visibly stale");
  check((await recover(runId)).status === 'review_ready', "Historical terminal receipt survives parent changes");
  check(sql(`select count(*) from ezyvet_import_snapshots where resource='attachment' and (payload::text like '%private-capability%' or payload::text like '%private-unknown-field%');`) === '0', "Raw snapshot storage has no temporary capabilities or unknown fields");
  check(sql(`select count(*) from ezyvet_import_snapshots where resource='attachment' and payload->>'representation'='sanitized_attachment_metadata_v1';`) === '2', "Stored metadata snapshots are explicitly labeled sanitized");
  check(effects() === beforeEffects, "Metadata intake creates no native treatment, invoice, inventory, outbox or private file effects");
  const otherEmail = `attachment-other-${randomUUID()}@example.test`, otherPassword = `Synthetic-${randomUUID()}-Aa1!`;
  const otherActor = (await api("/auth/v1/admin/users", { email: otherEmail, password: otherPassword, email_confirm: true })).id;
  sql(`insert into user_roles(user_id,role) values(${quote(otherActor)},'ADMIN');`);
  // A1 (#164): handle_new_user no longer activates a new auth user, so a fixture
  // that needs an active synthetic staff member must activate it explicitly.
  sql(`insert into user_roles(user_id,role) values(${quote(otherActor)},'STAFF') on conflict do nothing; update profiles set is_active=true where id=${quote(otherActor)};`);
  const otherAuth = await api("/auth/v1/token?grant_type=password", { email: otherEmail, password: otherPassword }, { apikey: local.ANON_KEY, "Content-Type": "application/json" });
  const otherHeaders = { ...staffHeaders, Authorization: `Bearer ${otherAuth.access_token}` };
  await assert.rejects(api("/rest/v1/rpc/recover_ezyvet_attachment_run", { p_id: runId, p_animal_link_id: mapping }, otherHeaders), (e: { code: string }) => e.code === "42501"); assertions++;
  await assert.rejects(api("/rest/v1/rpc/list_ezyvet_attachment_observations", { p_run_id: runId, p_animal_link_id: mapping }, otherHeaders), (e: { code: string }) => e.code === "42501"); assertions++;
  check((await api("/rest/v1/rpc/list_ezyvet_attachment_runs", { p_animal_link_id: mapping }, otherHeaders)).runs.length === 0, "Another active administrator cannot discover owned run history");
  for (const headers of [staffHeaders, otherHeaders]) {
    for (const path of [
      "/ezyvet_import_runs?resource=eq.attachment",
      "/ezyvet_import_snapshots?resource=eq.attachment",
      `/ezyvet_import_pages?run_id=eq.${runId}`,
      `/ezyvet_import_page_items?run_id=eq.${runId}`,
      "/ezyvet_identity_heads?resource=eq.attachment",
    ]) {
      const response = await fetch(local.API_URL + "/rest/v1" + path, { headers });
      check(response.ok && (await response.json()).length === 0, "Shared table reads cannot bypass owned attachment RPCs");
    }
  }
  const legacyRead = await fetch(local.API_URL + "/rest/v1/ezyvet_import_snapshots?resource=eq.animal", { headers: staffHeaders });
  check(legacyRead.ok && (await legacyRead.json()).length === 2, "Attachment restriction preserves prior Animal source reads");
  sql(`delete from user_roles where user_id=${quote(actor)} and role='ADMIN';`);
  const callsBeforeRoleRemoval = upstreamCalls;
  check((await post(body)).status === 403 && upstreamCalls === callsBeforeRoleRemoval, "Removed administrator role rejects valid JWT before provider traffic");
  await assert.rejects(recover(runId), (e: { code: string }) => e.code === "42501"); assertions++;
  await assert.rejects(rpc("list_ezyvet_attachment_runs", { p_animal_link_id: mapping }, true), (e: { code: string }) => e.code === "42501"); assertions++;
  check(failures.length === 0, "Native loopback servers completed without handler failures");
} finally {
  for (const server of closeables) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
console.log(`Attachment metadata HTTP/Auth/PostgREST: ${assertions} checks passed. Synthetic upstream only; no ezyVet requests.`);
