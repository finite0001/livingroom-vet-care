/** Vaccination provenance through actual local Auth/PostgREST and synthetic upstream HTTP. */
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
  mixed = false,
  loseAck = false;
let consultSelection: Record<string, unknown> = {};
let consultDescription = "Synthetic outside consult";
let committedVaccinationPage: Record<string, unknown> | null = null;
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
  const email = `vaccination-import-${randomUUID()}@example.test`,
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
        p_last_name: "Vaccination source",
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
        p_name: "Synthetic vaccination import",
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
    )},'animal','77','{"id":77,"contact_id":8}','synthetic-hash',${quote(
      actor,
    )});
 insert into public.ezyvet_import_snapshots(id,source_origin,source_site_uid,resource,external_id,payload,payload_hash,first_seen_by) values(${quote(
   otherMapping,
 )},'https://api.trial.ezyvet.com',${quote(
   site,
 )},'animal','78','{"id":78,"contact_id":8}','synthetic-other-hash',${quote(
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
  const upstream = await serve(async (req, res) => {
    upstreamCalls++;
    const url = new URL(req.url!, "http://synthetic.test");
    res.setHeader("Content-Type", "application/json");
    if (url.pathname === "/v1/oauth/access_token") {
      res.end(
        JSON.stringify({ access_token: "synthetic-only", expires_in: 43200 }),
      );
      return;
    }
    assert.ok(["/v1/consult", "/v1/vaccination"].includes(url.pathname));
    assert.equal(req.method, "GET");
    const resource = url.pathname.slice(4);
    const scope = resource === "vaccination" ? "consult_id" : "animal_id";
    assert.equal(
      url.searchParams.get(scope),
      resource === "vaccination" ? "1" : "77",
    );
    assert.equal(url.searchParams.get("limit"), "10");
    assert.deepEqual(
      [...url.searchParams.keys()].sort(),
      [scope, "limit", "page"].sort(),
    );
    const page = Number(url.searchParams.get("page"));
    const payload =
      resource === "vaccination"
        ? {
            id: String(page),
            consult_id: "1",
            product_id: "42",
            qty: null,
            date_of_administration: "1700000000",
            date_of_next_administration: null,
            vet_id: "9",
            description: "<script>untrusted source vaccine</script>",
          }
        : {
            id: "1",
            animal_id: "77",
            description: consultDescription,
          };
    res.end(
      JSON.stringify({
        meta: {
          items_page: page,
          items_page_total: resource === "consult" ? 1 : 2,
        },
        items: [
          { [resource]: payload },
          ...(mixed
            ? [{ [resource]: { ...payload, id: "99", consult_id: "999" } }]
            : []),
        ],
      }),
    );
  });
  const env: Record<string, string> = {
    APP_URL: origin,
    APP_ENV: "staging",
    EZYVET_IMPORT_MODE: "staging",
    EZYVET_SITE_UID: site,
    EZYVET_CLIENT_ID: "synthetic",
    EZYVET_CLIENT_SECRET: "synthetic",
    EZYVET_READ_RESOURCES: "consult,vaccination",
  };
  const handler = createHandler({
    env: (k) => env[k],
    now: Date.now,
    sleep: async () => {},
    fetch: async (input, init) => {
      const url = new URL(String(input));
      assert.equal(url.origin, "https://api.trial.ezyvet.com");
      return fetch(upstream + url.pathname + url.search, init);
    },
    gateway: {
      authenticate: async (bearer) => {
        const response = await fetch(local.API_URL + "/auth/v1/user", {
          headers: {
            apikey: local.ANON_KEY,
            Authorization: `Bearer ${bearer}`,
          },
        });
        if (!response.ok) return null;
        const user = await response.json();
        return {
          id: user.id,
          activeAdmin: await rpc("ezyvet_is_active_admin", {
            p_actor: user.id,
          }),
        };
      },
      claim: async (id, actor, site, resource, sourceOrigin) =>
        rpc("claim_ezyvet_import", {
          p_id: id,
          p_actor: actor,
          p_site_uid: site,
          p_resource: resource,
          p_source_origin: sourceOrigin,
        }),
      claimClinical: async (
        id,
        actor,
        site,
        resource,
        sourceOrigin,
        animalLinkId,
      ) =>
        rpc("claim_ezyvet_clinical_import", {
          p_id: id,
          p_actor: actor,
          p_site_uid: site,
          p_resource: resource,
          p_source_origin: sourceOrigin,
          p_animal_link_id: animalLinkId,
        }),
      claimVaccination: async (
        id,
        actor,
        site,
        sourceOrigin,
        animalLinkId,
        consultSnapshotId,
        consultPayloadHash,
        consultHeadVersion,
      ) =>
        rpc("claim_ezyvet_vaccination_import", {
          p_id: id,
          p_actor: actor,
          p_site_uid: site,
          p_resource: "vaccination",
          p_source_origin: sourceOrigin,
          p_animal_link_id: animalLinkId,
          p_consult_snapshot_id: consultSnapshotId,
          p_consult_payload_hash: consultPayloadHash,
          p_consult_observed_head_version: consultHeadVersion,
        }),
      stage: async (run, actor, page) => {
        const result = await rpc("stage_ezyvet_import_page", {
          p_id: run.id,
          p_actor: actor,
          p_lease_id: run.lease_id,
          p_page: page.page,
          p_complete: page.complete,
          p_items: page.items,
        });
        if (run.resource === "vaccination") {
          committedVaccinationPage = {
            p_id: run.id,
            p_actor: actor,
            p_lease_id: null,
            p_page: page.page,
            p_complete: page.complete,
            p_items: page.items,
          };
        }
        if (loseAck) {
          loseAck = false;
          throw new Error("Synthetic lost acknowledgement");
        }
        return result as ImportRun;
      },
      fail: async (run, actor, code, seconds) => {
        await rpc("fail_ezyvet_import_page", {
          p_id: run.id,
          p_actor: actor,
          p_lease_id: run.lease_id,
          p_code: code,
          p_retry_seconds: seconds,
        });
      },
    },
  });
  const edge = await serve(async (req, res) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const result = await handler(
        new Request(origin + "/ezyvet-import", {
          method: req.method,
          headers: req.headers as Record<string, string>,
          body: Buffer.concat(chunks),
        }),
      );
      res.writeHead(result.status, Object.fromEntries(result.headers));
      res.end(await result.text());
    } catch {
      res.writeHead(500);
      res.end("Synthetic HTTP adapter failed");
    }
  });
  const post = (
    run: string,
    resource: string,
    extra: Record<string, unknown> = {},
    authorized = true,
  ) =>
    fetch(edge, {
      method: "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        ...(authorized ? { Authorization: staffHeaders.Authorization } : {}),
      },
      body: JSON.stringify({
        run_id: run,
        resource,
        animal_link_id: mapping,
        ...(resource === "vaccination" ? consultSelection : {}),
        ...extra,
      }),
    });
  const consultRun = randomUUID(),
    run = randomUUID();
  ids.push(consultRun, run);
  const consultResponse = await post(consultRun, "consult");
  check(
    consultResponse.status === 200,
    "Actual scoped consult stages successfully",
  );
  const consults = await rpc(
    "list_ezyvet_clinical_candidates",
    {
      p_animal_link_id: mapping,
      p_resource: "consult",
      p_before_at: null,
      p_before_id: null,
      p_limit: 20,
    },
    true,
  );
  const consult = consults.candidates[0];
  check(
    consult?.current_head_scoped === true,
    "Vaccination selection originates in validated scoped consult",
  );
  consultSelection = {
    consult_snapshot_id: consult.id,
    consult_payload_hash: consult.payload_hash,
    consult_observed_head_version: consult.observed_head_version,
  };
  const sideEffects = () =>
    sql(`select jsonb_build_object(
    'treatments',(select count(*) from public.patient_treatments),
    'invoices',(select count(*) from public.billing_invoices),
    'stock',(select coalesce(jsonb_agg(to_jsonb(l) order by l.id),'[]') from public.inventory_lots l),
    'movements',(select count(*) from public.inventory_movements),
    'invoice_items',(select count(*) from public.billing_invoice_items),
    'certificates',(select count(*) from public.vaccine_certificates),
    'reminders',(select count(*) from public.care_reminder_jobs),
    'outbox',(select count(*) from public.communication_outbox),
    'encounters',(select count(*) from public.clinical_encounters)
  )::text;`);
  const beforeEffects = sideEffects();
  let calls = upstreamCalls;
  check(
    (await post(run, "vaccination", {}, false)).status === 401,
    "Actual HTTP anonymous request denied",
  );
  env.EZYVET_IMPORT_MODE = "disabled";
  check(
    (await post(run, "vaccination")).status === 503 && upstreamCalls === calls,
    "Disabled vaccination import makes no upstream request",
  );
  env.EZYVET_IMPORT_MODE = "staging";
  check(
    (await post(run, "vaccination", { consult_id: "999" })).status === 400 &&
      upstreamCalls === calls,
    "Caller cannot inject upstream consult filter",
  );
  mixed = true;
  const rejected = await post(run, "vaccination");
  check(
    rejected.status === 503 &&
      (await rejected.json()).error === "SOURCE_CONSULT_MISMATCH",
    "Mixed-consult upstream page rejected before staging",
  );
  check(
    sql(
      `select next_page from public.ezyvet_import_runs where id=${quote(run)};`,
    ) === "1",
    "Rejected mixed page leaves durable cursor unchanged",
  );
  check(
    sql(
      `select count(*) from public.ezyvet_import_snapshots where source_site_uid=${quote(site)} and resource='vaccination';`,
    ) === "0",
    "Mixed page stores no partial vaccination evidence",
  );
  mixed = false;
  const advanceCooldown = () =>
    sql(
      `update public.ezyvet_import_runs set retry_after=clock_timestamp()-interval '1 second' where id=${quote(run)};`,
    );
  advanceCooldown();
  const sqlClaim = await rpc("claim_ezyvet_vaccination_import", {
    p_id: run,
    p_actor: actor,
    p_site_uid: site,
    p_resource: "vaccination",
    p_source_origin: "https://api.trial.ezyvet.com",
    p_animal_link_id: mapping,
    p_consult_snapshot_id: consult.id,
    p_consult_payload_hash: consult.payload_hash,
    p_consult_observed_head_version: consult.observed_head_version,
  });
  let stageDenied = false;
  try {
    await rpc("stage_ezyvet_import_page", {
      p_id: run,
      p_actor: actor,
      p_lease_id: sqlClaim.lease_id,
      p_page: 1,
      p_complete: true,
      p_items: [
        {
          external_id: "400",
          payload: { id: "400", consult_id: "1", product_id: "42" },
        },
        {
          external_id: "401",
          payload: { id: "401", consult_id: "999", product_id: "42" },
        },
      ],
    });
  } catch {
    stageDenied = true;
  }
  check(
    stageDenied,
    "Direct PostgREST mixed-consult stage rejected independently of handler",
  );
  check(
    sql(
      `select count(*) from public.ezyvet_import_snapshots where source_site_uid=${quote(site)} and resource='vaccination';`,
    ) === "0" &&
      sql(
        `select next_page from public.ezyvet_import_runs where id=${quote(run)};`,
      ) === "1",
    "SQL wrong-consult page is atomic including snapshots and cursor",
  );
  await rpc("fail_ezyvet_import_page", {
    p_id: run,
    p_actor: actor,
    p_lease_id: sqlClaim.lease_id,
    p_code: "SOURCE_UNAVAILABLE",
    p_retry_seconds: 1,
  });
  advanceCooldown();
  loseAck = true;
  check(
    (await post(run, "vaccination")).status === 503,
    "Lost committed stage acknowledgement stays unconfirmed",
  );
  check(
    sql(
      `select next_page from public.ezyvet_import_runs where id=${quote(run)};`,
    ) === "2",
    "Lost acknowledgement retains committed cursor",
  );
  const recoveryArgs = {
    p_id: run,
    p_animal_link_id: mapping,
    p_consult_snapshot_id: consult.id,
    p_consult_payload_hash: consult.payload_hash,
    p_consult_observed_head_version: consult.observed_head_version,
  };
  const recoveredPartial = await rpc(
    "recover_ezyvet_vaccination_run",
    recoveryArgs,
    true,
  );
  check(
    recoveredPartial.id === run &&
      recoveredPartial.next_page === 2 &&
      !JSON.stringify(recoveredPartial).includes("lease_id"),
    "Actual actor recovers durable progress without lease disclosure",
  );
  advanceCooldown();
  const completed = await post(run, "vaccination");
  check(
    completed.status === 200 &&
      (await completed.json()).status === "review_ready",
    "Same vaccination UUID resumes from committed page",
  );
  calls = upstreamCalls;
  check(
    (await post(run, "vaccination")).status === 200 && upstreamCalls === calls,
    "Terminal exact retry avoids upstream request",
  );
  check(
    (await post(run, "vaccination", { animal_link_id: otherMapping }))
      .status !== 200 && upstreamCalls === calls,
    "Terminal UUID cannot be rebound to a different mapping",
  );
  check(
    sql(
      `select count(*) from public.ezyvet_import_snapshots where source_site_uid=${quote(site)} and resource='vaccination';`,
    ) === "2",
    "Two pages persist once after acknowledgement loss",
  );
  const candidates = await rpc(
    "list_ezyvet_vaccination_candidates",
    {
      p_animal_link_id: mapping,
      p_before_at: null,
      p_before_id: null,
      p_limit: 20,
    },
    true,
  );
  check(
    candidates.candidates.length === 2 && !candidates.has_more,
    "Administrator discovers both durable vaccination candidates",
  );
  check(
    candidates.candidates.every(
      (candidate: Record<string, unknown>) =>
        candidate.pet_id === pet &&
        candidate.animal_link_id === mapping &&
        typeof candidate.payload_hash === "string" &&
        candidate.consult_snapshot_id === consult.id &&
        candidate.consult_external_id === "1" &&
        candidate.consult_is_current === true &&
        candidate.eligible_for_review === true,
    ),
    "Candidate patient identity follows original approved mapping",
  );
  check(
    candidates.candidates.every(
      (candidate: { payload: Record<string, unknown> }) =>
        candidate.payload.date_of_administration === "1700000000" &&
        candidate.payload.date_of_next_administration === null &&
        candidate.payload.qty === null &&
        candidate.payload.product_id === "42" &&
        candidate.payload.description ===
          "<script>untrusted source vaccine</script>",
    ),
    "Raw date, null quantity, product reference and untrusted text remain unmodified evidence",
  );
  const discovered = await rpc(
    "list_ezyvet_vaccination_runs",
    {
      p_animal_link_id: mapping,
      p_before_at: null,
      p_before_id: null,
      p_limit: 20,
    },
    true,
  );
  check(
    discovered.runs.some(
      (entry: Record<string, unknown>) =>
        entry.id === run && entry.scope === "consult_scoped",
    ),
    "Server run discovery recovers browser-pointer loss",
  );
  // Advance only this owned synthetic consult cooldown; preserve production pacing code.
  sql(
    `update public.ezyvet_import_runs set retry_after=clock_timestamp()-interval '1 second' where id=${quote(consultRun)};`,
  );
  consultDescription = "Synthetic changed outside consult";
  const changedConsultRun = randomUUID();
  ids.push(changedConsultRun);
  const changedConsultResponse = await post(changedConsultRun, "consult");
  const changedConsultResult = await changedConsultResponse.json();
  check(
    changedConsultResponse.status === 200,
    "Later scoped consult observation advances its source head: " +
      String(changedConsultResult.error ?? changedConsultResponse.status),
  );
  const staleCandidates = await rpc(
    "list_ezyvet_vaccination_candidates",
    {
      p_animal_link_id: mapping,
      p_before_at: null,
      p_before_id: null,
      p_limit: 20,
    },
    true,
  );
  check(
    staleCandidates.candidates.length === 2 &&
      staleCandidates.candidates.every(
        (candidate: Record<string, unknown>) =>
          candidate.consult_snapshot_id === consult.id &&
          candidate.consult_is_current === false &&
          candidate.eligible_for_review === false,
      ),
    "Changed consult retains frozen vaccination association with stale eligibility",
  );
  calls = upstreamCalls;
  check(
    (await post(run, "vaccination")).status === 200 && upstreamCalls === calls,
    "Exact terminal recovery precedes mutable consult freshness",
  );
  assert.ok(committedVaccinationPage);
  const committedReplay = await rpc(
    "stage_ezyvet_import_page",
    committedVaccinationPage,
  );
  check(
    committedReplay.id === run && committedReplay.status === "review_ready",
    "Committed exact page replays without lease after consult becomes stale",
  );
  let alteredReplayDenied = false;
  try {
    await rpc("stage_ezyvet_import_page", {
      ...committedVaccinationPage,
      p_complete: false,
    });
  } catch {
    alteredReplayDenied = true;
  }
  check(
    alteredReplayDenied,
    "Committed page cannot change completion flag on recovery",
  );
  const anonymous = {
    apikey: local.ANON_KEY,
    "Content-Type": "application/json",
  };
  for (const table of [
    "ezyvet_vaccination_runs",
    "ezyvet_vaccination_pages",
    "ezyvet_vaccination_page_observations",
  ]) {
    for (const headers of [anonymous, staffHeaders, serviceHeaders]) {
      const response = await fetch(
        local.API_URL + "/rest/v1/" + table + "?select=*&limit=1",
        { headers },
      );
      check(
        !response.ok,
        "Direct vaccination receipt table access denied to API role",
      );
    }
  }
  let denied = false;
  try {
    await api(
      "/rest/v1/rpc/recover_ezyvet_vaccination_run",
      recoveryArgs,
      anonymous,
    );
  } catch {
    denied = true;
  }
  check(denied, "Anonymous recovery RPC denied");
  sql(
    `delete from public.user_roles where user_id=${quote(actor)} and role='ADMIN';`,
  );
  denied = false;
  try {
    await rpc("recover_ezyvet_vaccination_run", recoveryArgs, true);
  } catch {
    denied = true;
  }
  check(
    denied,
    "Authenticated user without ADMIN cannot recover vaccination run",
  );
  sql(
    `insert into public.user_roles(user_id,role) values(${quote(actor)},'ADMIN');`,
  );
  denied = false;
  try {
    await rpc("claim_ezyvet_import", {
      p_id: randomUUID(),
      p_actor: actor,
      p_site_uid: site,
      p_resource: "vaccination",
      p_source_origin: "https://api.trial.ezyvet.com",
    });
  } catch {
    denied = true;
  }
  check(denied, "Generic vaccination claim denied through actual PostgREST");
  const legacy = randomUUID();
  ids.push(legacy);
  sql(
    `insert into public.ezyvet_import_runs(id,source_origin,source_site_uid,resource,requested_by,status) values(${quote(legacy)},'https://api.trial.ezyvet.com',${quote(site)},'vaccination',${quote(actor)},'review_ready');`,
  );
  calls = upstreamCalls;
  check(
    (await post(legacy, "vaccination")).status !== 200 &&
      upstreamCalls === calls,
    "Legacy generic terminal UUID cannot acquire scoped context",
  );
  check(
    sideEffects() === beforeEffects,
    "Vaccination intake changes no treatments, billing, certificates, reminders, outbox or encounters",
  );
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
    if (actor) {
      check(
        (
          await fetch(local.API_URL + "/auth/v1/admin/users/" + actor, {
            method: "DELETE",
            headers: serviceHeaders,
          })
        ).ok,
        "Synthetic Auth user cleaned",
      );
      const absent = await fetch(
        local.API_URL + "/auth/v1/admin/users/" + actor,
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
    "Vaccination local integration failed: " +
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
  `Vaccination import HTTP/Auth/PostgREST: ${assertions} checks passed. Synthetic upstream only; no ezyVet requests.`,
);
