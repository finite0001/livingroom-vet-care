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
  const upstream = await serve(async (req, res) => {
    upstreamCalls++;
    const url = new URL(req.url!, "http://synthetic.test");
    res.setHeader("Content-Type", "application/json");
    if (url.pathname === "/v1/oauth/access_token") { res.end(JSON.stringify({ access_token: "synthetic-only", expires_in: 43200 })); return; }
    assert.equal(url.pathname, "/v1/attachment"); assert.equal(req.method, "GET");
    assert.deepEqual([...url.searchParams.keys()].sort(), ["limit", "page", "record_id", "record_type"]);
    const kind = url.searchParams.get("record_type"); assert.ok(kind === "Animal" || kind === "Consult");
    assert.equal(url.searchParams.get("record_id"), kind === "Animal" ? "77" : "201");
    assert.equal(url.searchParams.get("limit"), "10");
    const page = Number(url.searchParams.get("page"));
    res.end(JSON.stringify({ meta: { items_page: page, items_page_total: 2 }, items: [{ attachment: { id: (kind === "Animal" ? 700 : 800) + page, record_type: kind, record_id: wrongParent ? "999" : kind === "Animal" ? "77" : "201", mime_type: "unsupported/example", name: "<script>source name</script>", file_download_url: "https://untrusted.example.test/do-not-fetch" } }] }));
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
  const resetCooldown = () => sql(`update ezyvet_import_runs set retry_after=null,lease_until=null where source_site_uid=${quote(site)} and resource='attachment';`);
  for (const parentType of ["Animal", "Consult"]) {
    resetCooldown();
    const runId = randomUUID(); ids.push(runId);
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
    const callsAtTerminal = upstreamCalls;
    check((await post(body)).status === 200, "Terminal HTTP retry recovers exact owned context");
    check(upstreamCalls === callsAtTerminal, "Terminal retry performs no additional upstream request");
    check(sql(`select count(*) from ezyvet_attachment_pages where run_id=${quote(runId)};`) === "2", "Lost replies never duplicate page receipts");
    check(sql(`select count(*) from ezyvet_attachment_page_observations where run_id=${quote(runId)};`) === "2", "Exact source page observations retained");
    await assert.rejects(rpc("recover_ezyvet_attachment_run", { p_id: runId, p_animal_link_id: otherMapping }, true), (error: { code: string }) => error.code === "42501"); assertions++;
    const freshId = randomUUID(); ids.push(freshId); resetCooldown(); wrongParent = true;
    check((await post({ ...body, run_id: freshId })).status === 503, "Real HTTP intake rejects wrong-parent upstream metadata"); wrongParent = false;
    check(sql(`select count(*) from ezyvet_attachment_pages where run_id=${quote(freshId)};`) === "0", "Rejected page leaves no receipt");
    const resource = parentType === "Animal" ? "animal" : "consult";
    sql(`update ezyvet_identity_heads set version=version+1 where source_site_uid=${quote(site)} and resource=${quote(resource)};`);
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
  check(effects() === beforeEffects, "Metadata intake creates no documents, native treatments, billing, stock or messages");
} catch (error) {
  failures.push(error);
} finally {
  for (const server of closeables.reverse()) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  try {
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
  `Attachment metadata HTTP/Auth/PostgREST: ${assertions} checks passed. Synthetic upstream only; no ezyVet requests.`,
);
