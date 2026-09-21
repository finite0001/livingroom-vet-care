/** Real local HTTP/Auth/PostgREST with a local synthetic ezyVet upstream only. */
import { createServer } from "node:http";
import type { RequestListener } from "node:http";
import { createHandler } from "../../supabase/functions/ezyvet-import/handler.ts";
import type { ImportRun } from "../../supabase/functions/ezyvet-import/handler.ts";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
let project = process.env.PAYMENT_TEST_PROJECT ||
  "/tmp/livingroom-vet-foundation";
let temporaryProject = "";
// The existing containers may outlive their /tmp configuration. This config is
// used for status only; this runner never starts, resets, or stops Supabase.
if (
  !process.env.PAYMENT_TEST_PROJECT &&
  !existsSync(`${project}/supabase/config.toml`)
) {
  temporaryProject = mkdtempSync(join(tmpdir(), "lrv-payment-local-"));
  project = temporaryProject;
  mkdirSync(join(project, "supabase"));
  writeFileSync(
    join(project, "supabase/config.toml"),
    'project_id = "livingroom-vet-foundation"\n[api]\nport = 56321\n[db]\nport = 56322\nshadow_port = 56320\n',
  );
  process.once(
    "exit",
    () => rmSync(temporaryProject, { recursive: true, force: true }),
  );
}
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
    const problem = await response.json().catch(() => ({}));
    throw { code: problem.code, message: problem.message };
  }
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}
const rpc = (name: string, args: Record<string, unknown>, staff = false) =>
  api("/rest/v1/rpc/" + name, args, staff ? staffHeaders : serviceHeaders);
const origin = "https://thelivingroom.vet";
let upstreamCalls = 0, mixed = false, loseAck = false;
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
  const email = `clinical-import-${randomUUID()}@example.test`,
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
    },'ADMIN') on conflict do nothing;`,
  );
  client = (await rpc("save_client", {
    p_actor_id: actor,
    p_client_id: null,
    p_expected_version: null,
    p_first_name: "Synthetic",
    p_last_name: "Clinical source",
    p_primary_phone: null,
    p_primary_email: null,
    p_preferred_channel: "EMAIL",
    p_mailing_address: null,
    p_housecall_address: null,
  }, true)).id;
  ids.push(client);
  const pet = (await rpc("save_patient", {
    p_id: null,
    p_client_id: client,
    p_expected_version: null,
    p_name: "Synthetic clinical import",
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
  }, true)).id;
  ids.push(pet);
  const snapshot = randomUUID(),
    mapping = randomUUID(),
    otherMapping = randomUUID(),
    siteId = randomUUID(),
    site = "Synthetic-" + siteId;
  ids.push(snapshot, mapping, otherMapping, siteId);
  sql(
    `insert into public.ezyvet_import_snapshots(id,source_origin,source_site_uid,resource,external_id,payload,payload_hash,first_seen_by) values(${
      quote(snapshot)
    },'https://api.trial.ezyvet.com',${
      quote(site)
    },'animal','77','{"id":77,"contact_id":8}','synthetic-hash',${
      quote(actor)
    });
 insert into public.ezyvet_import_snapshots(id,source_origin,source_site_uid,resource,external_id,payload,payload_hash,first_seen_by) values(${
      quote(otherMapping)
    },'https://api.trial.ezyvet.com',${
      quote(site)
    },'animal','78','{"id":78,"contact_id":8}','synthetic-other-hash',${
      quote(actor)
    });
 insert into public.ezyvet_record_links(id,request_id,request_hash,source_origin,source_site_uid,resource,external_id,snapshot_id,head_version,client_id,pet_id,local_version,action,reason,approved_by) select x,x,'synthetic-link','https://api.trial.ezyvet.com',${
      quote(site)
    },'animal',case when x=${
      quote(mapping)
    }::uuid then '77' else '78' end,case when x=${quote(mapping)}::uuid then ${
      quote(snapshot)
    }::uuid else ${quote(otherMapping)}::uuid end,1,${quote(client)},${
      quote(pet)
    },1,'link','SYNTHETIC TEST ONLY',${quote(actor)} from unnest(array[${
      quote(mapping)
    }::uuid,${quote(otherMapping)}::uuid]) x;`,
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
    assert.ok(["/v1/consult", "/v1/history"].includes(url.pathname));
    assert.equal(req.method, "GET");
    assert.equal(url.searchParams.get("animal_id"), "77");
    assert.equal(url.searchParams.get("limit"), "10");
    assert.deepEqual([...url.searchParams.keys()].sort(), [
      "animal_id",
      "limit",
      "page",
    ]);
    const resource = url.pathname.slice(4),
      page = Number(url.searchParams.get("page"));
    const payload = {
      id: String(page),
      animal_id: "77",
      consult_id: "1",
      comments: "<script>untrusted synthetic history</script>",
      description: "Synthetic outside consultation",
      history_system: "opaque",
      chain: "opaque",
      timestamp: "1700000000",
      vet_id: "9",
    };
    res.end(
      JSON.stringify({
        meta: { items_page: page, items_page_total: 2 },
        items: [
          { [resource]: payload },
          ...(mixed
            ? [{ [resource]: { ...payload, id: "99", animal_id: "999" } }]
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
    EZYVET_PARTNER_ID: "synthetic",
    EZYVET_CLIENT_ID: "synthetic",
    EZYVET_CLIENT_SECRET: "synthetic",
    EZYVET_READ_RESOURCES: "consult,history",
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
      stage: async (run, actor, page) => {
        const result = await rpc("stage_ezyvet_import_page", {
          p_id: run.id,
          p_actor: actor,
          p_lease_id: run.lease_id,
          p_page: page.page,
          p_complete: page.complete,
          p_items: page.items,
        });
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
        ...extra,
      }),
    });
  const runIds = { consult: randomUUID(), history: randomUUID() };
  ids.push(...Object.values(runIds));
  check(
    (await post(runIds.consult, "consult", {}, false)).status === 401,
    "Actual HTTP anonymous request denied",
  );
  env.EZYVET_IMPORT_MODE = "disabled";
  check(
    (await post(runIds.consult, "consult")).status === 503 &&
      upstreamCalls === 0,
    "Disabled mode makes no upstream request",
  );
  env.EZYVET_IMPORT_MODE = "staging";
  check(
    (await post(runIds.consult, "consult", { animal_id: "999" })).status ===
      400,
    "Caller cannot inject animal filter",
  );
  for (const resource of ["consult", "history"] as const) {
    const run = runIds[resource];
    mixed = true;
    const rejected = await post(run, resource);
    check(
      rejected.status === 503 &&
        (await rejected.json()).error === "SOURCE_PATIENT_MISMATCH",
      "Mixed-patient upstream page rejected before staging",
    );
    check(
      sql(
        `select next_page from public.ezyvet_import_runs where id=${
          quote(run)
        };`,
      ) === "1",
      "Rejected page leaves durable cursor unchanged",
    );
    check(
      sql(
        `select count(*) from public.ezyvet_import_snapshots where source_site_uid=${
          quote(site)
        } and resource=${quote(resource)};`,
      ) === "0",
      "Rejected page leaves no source snapshots",
    );
    mixed = false;
    // Only this synthetic run's cooldown is advanced; no general worker or source policy changes.
    sql(
      `update public.ezyvet_import_runs set retry_after=clock_timestamp()-interval '1 second' where id=${
        quote(run)
      };`,
    );
    loseAck = true;
    check(
      (await post(run, resource)).status === 503,
      "Lost committed stage acknowledgment stays unconfirmed",
    );
    check(
      sql(
        `select next_page from public.ezyvet_import_runs where id=${
          quote(run)
        };`,
      ) === "2",
      "Lost acknowledgment retains committed cursor",
    );
    sql(
      `update public.ezyvet_import_runs set retry_after=clock_timestamp()-interval '1 second' where id=${
        quote(run)
      };`,
    );
    const completed = await post(run, resource);
    check(
      completed.status === 200 &&
        (await completed.json()).status === "review_ready",
      "Same UUID continues from durable next page",
    );
    const calls = upstreamCalls;
    const recovered = await post(run, resource);
    check(
      recovered.status === 200 && upstreamCalls === calls,
      "Terminal exact retry makes no upstream request",
    );
    check(
      (await post(run, resource, { animal_link_id: otherMapping })).status !==
          200 && upstreamCalls === calls,
      "Changed mapping cannot recover terminal run as success",
    );
    check(
      sql(
        `select count(*) from public.ezyvet_import_snapshots where source_site_uid=${
          quote(site)
        } and resource=${quote(resource)};`,
      ) === "2",
      "Two source pages are stored once despite lost acknowledgment",
    );
    const durable = await rpc("recover_ezyvet_clinical_run", {
      p_id: run,
      p_animal_link_id: mapping,
      p_resource: resource,
    }, true);
    check(
      durable.id === run && durable.animal_link_id === mapping &&
        durable.resource === resource && durable.status === "review_ready" &&
        !JSON.stringify(durable).includes("lease_id"),
      "Actual actor recovery exposes safe exact run identity",
    );
    const candidates = await rpc("list_ezyvet_clinical_candidates", {
      p_animal_link_id: mapping,
      p_resource: resource,
      p_before_at: null,
      p_before_id: null,
      p_limit: 20,
    }, true);
    check(
      candidates.animal_link_id === mapping &&
        candidates.resource === resource &&
        candidates.candidates.length === 2 &&
        candidates.candidates.every((candidate: Record<string, unknown>) =>
          candidate.pet_id === pet && candidate.animal_link_id === mapping &&
          candidate.current_head_scoped === true &&
          typeof candidate.payload_hash === "string"
        ) && !candidates.has_more,
      "Real administrator discovery retains validated scoped observations only",
    );
  }
  const legacy = randomUUID();
  ids.push(legacy);
  sql(
    `insert into public.ezyvet_import_runs(id,source_origin,source_site_uid,resource,requested_by,status) values(${
      quote(legacy)
    },'https://api.trial.ezyvet.com',${quote(site)},'history',${
      quote(actor)
    },'review_ready');`,
  );
  const callsBeforeLegacy = upstreamCalls;
  const legacyResponse = await post(legacy, "history");
  check(
    legacyResponse.status === 409 &&
      (await legacyResponse.json()).error ===
        "CLINICAL_RUN_REQUIRES_NEW_MAPPING" &&
      upstreamCalls === callsBeforeLegacy,
    "Legacy terminal UUID cannot acquire mapped clinical context or call upstream",
  );
  check(
    sql(
      `select count(*) from public.clinical_encounters where pet_id=${
        quote(pet)
      };`,
    ) === "0",
    "Staging creates no native clinical encounter",
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
        (await fetch(local.API_URL + "/auth/v1/admin/users/" + actor, {
          method: "DELETE",
          headers: serviceHeaders,
        })).ok,
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
    "Clinical local integration failed: " +
      failures.map((e) =>
        e instanceof Error
          ? e.message
          : typeof e === "object" && e && "code" in e
          ? String(e.code)
          : "unknown"
      ).join(", "),
  );
}
console.log(
  `Clinical import HTTP/Auth/PostgREST: ${assertions} checks passed. Synthetic upstream only; no ezyVet requests.`,
);
