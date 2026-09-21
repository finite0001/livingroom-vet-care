/** Prescription intake and clinical review through actual local Auth/PostgREST. */
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
  mixed = false,
  loseAck = false;
let prescriptionSelection: Record<string, unknown> = {};
let prescriptionDescription = "Synthetic outside prescription";
let committedPrescriptionItemPage: Record<string, unknown> | null = null;
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
  // A1 (#164): handle_new_user no longer activates a new auth user, so a fixture
  // that needs an active synthetic staff member must activate it explicitly.
  sql(`insert into public.user_roles(user_id,role) values(${quote(actor)},'STAFF') on conflict do nothing; update public.profiles set is_active=true where id=${quote(actor)};`);
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
    assert.ok(
      ["/v1/prescription", "/v1/prescriptionitem"].includes(url.pathname),
    );
    assert.equal(req.method, "GET");
    const resource = url.pathname.slice(4);
    const scope =
      resource === "prescriptionitem" ? "prescription_id" : "animal_id";
    assert.equal(
      url.searchParams.get(scope),
      resource === "prescriptionitem" ? "1" : "77",
    );
    assert.equal(url.searchParams.get("limit"), "10");
    assert.deepEqual(
      [...url.searchParams.keys()].sort(),
      [scope, "limit", "page"].sort(),
    );
    const page = Number(url.searchParams.get("page"));
    const payload =
      resource === "prescriptionitem"
        ? {
            id: String(page),
            prescription_id: "1",
            product_id: "42",
            qty: null,
            date_start: "1700000000",
            remaining: null,
            serial_number: "9",
            instructions: "<script>untrusted source item</script>",
          }
        : {
            id: "1",
            animal_id: "77",
            description: prescriptionDescription,
          };
    res.end(
      JSON.stringify({
        meta: {
          items_page: page,
          items_page_total: resource === "prescription" ? 1 : 2,
        },
        items: [
          { [resource]: payload },
          ...(mixed
            ? [{ [resource]: { ...payload, id: "99", prescription_id: "999" } }]
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
    EZYVET_READ_RESOURCES: "prescription,prescriptionitem",
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
      claimPrescription: async (id, actor, site, sourceOrigin, animalLinkId) =>
        rpc("claim_ezyvet_prescription_import", {
          p_id: id,
          p_actor: actor,
          p_site_uid: site,
          p_resource: "prescription",
          p_source_origin: sourceOrigin,
          p_animal_link_id: animalLinkId,
        }),
      claimPrescriptionItem: async (
        id,
        actor,
        site,
        sourceOrigin,
        animalLinkId,
        prescriptionSnapshotId,
        prescriptionPayloadHash,
        prescriptionHeadVersion,
      ) =>
        rpc("claim_ezyvet_prescriptionitem_import", {
          p_id: id,
          p_actor: actor,
          p_site_uid: site,
          p_resource: "prescriptionitem",
          p_source_origin: sourceOrigin,
          p_animal_link_id: animalLinkId,
          p_prescription_snapshot_id: prescriptionSnapshotId,
          p_prescription_payload_hash: prescriptionPayloadHash,
          p_prescription_observed_head_version: prescriptionHeadVersion,
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
        if (run.resource === "prescriptionitem") {
          committedPrescriptionItemPage = {
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
        ...(resource === "prescriptionitem" ? prescriptionSelection : {}),
        ...extra,
      }),
    });
  const prescriptionRun = randomUUID(),
    run = randomUUID();
  ids.push(prescriptionRun, run);
  const prescriptionResponse = await post(prescriptionRun, "prescription");
  check(
    prescriptionResponse.status === 200,
    "Actual scoped prescription stages successfully",
  );
  const prescriptions = await rpc(
    "list_ezyvet_prescription_candidates",
    {
      p_animal_link_id: mapping,
      p_resource: "prescription",
      p_before_at: null,
      p_before_id: null,
      p_limit: 20,
    },
    true,
  );
  const prescription = prescriptions.candidates[0];
  check(
    prescription?.current_head_scoped === true,
    "PrescriptionItem selection originates in validated scoped prescription",
  );
  prescriptionSelection = {
    prescription_snapshot_id: prescription.id,
    prescription_payload_hash: prescription.payload_hash,
    prescription_observed_head_version: prescription.observed_head_version,
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
    (await post(run, "prescriptionitem", {}, false)).status === 401,
    "Actual HTTP anonymous request denied",
  );
  env.EZYVET_IMPORT_MODE = "disabled";
  check(
    (await post(run, "prescriptionitem")).status === 503 &&
      upstreamCalls === calls,
    "Disabled prescriptionitem import makes no upstream request",
  );
  env.EZYVET_IMPORT_MODE = "staging";
  check(
    (await post(run, "prescriptionitem", { prescription_id: "999" })).status ===
      400 && upstreamCalls === calls,
    "Caller cannot inject upstream prescription filter",
  );
  mixed = true;
  const rejected = await post(run, "prescriptionitem");
  check(
    rejected.status === 503 &&
      (await rejected.json()).error === "SOURCE_PRESCRIPTION_MISMATCH",
    "Mixed-prescription upstream page rejected before staging",
  );
  check(
    sql(
      `select next_page from public.ezyvet_import_runs where id=${quote(run)};`,
    ) === "1",
    "Rejected mixed page leaves durable cursor unchanged",
  );
  check(
    sql(
      `select count(*) from public.ezyvet_import_snapshots where source_site_uid=${quote(site)} and resource='prescriptionitem';`,
    ) === "0",
    "Mixed page stores no partial prescriptionitem evidence",
  );
  mixed = false;
  const advanceCooldown = () =>
    sql(
      `update public.ezyvet_import_runs set retry_after=clock_timestamp()-interval '1 second' where id=${quote(run)};`,
    );
  advanceCooldown();
  const sqlClaim = await rpc("claim_ezyvet_prescriptionitem_import", {
    p_id: run,
    p_actor: actor,
    p_site_uid: site,
    p_resource: "prescriptionitem",
    p_source_origin: "https://api.trial.ezyvet.com",
    p_animal_link_id: mapping,
    p_prescription_snapshot_id: prescription.id,
    p_prescription_payload_hash: prescription.payload_hash,
    p_prescription_observed_head_version: prescription.observed_head_version,
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
          payload: { id: "400", prescription_id: "1", product_id: "42" },
        },
        {
          external_id: "401",
          payload: { id: "401", prescription_id: "999", product_id: "42" },
        },
      ],
    });
  } catch {
    stageDenied = true;
  }
  check(
    stageDenied,
    "Direct PostgREST mixed-prescription stage rejected independently of handler",
  );
  check(
    sql(
      `select count(*) from public.ezyvet_import_snapshots where source_site_uid=${quote(site)} and resource='prescriptionitem';`,
    ) === "0" &&
      sql(
        `select next_page from public.ezyvet_import_runs where id=${quote(run)};`,
      ) === "1",
    "SQL wrong-prescription page is atomic including snapshots and cursor",
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
    (await post(run, "prescriptionitem")).status === 503,
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
    p_prescription_snapshot_id: prescription.id,
    p_prescription_payload_hash: prescription.payload_hash,
    p_prescription_observed_head_version: prescription.observed_head_version,
  };
  const recoveredPartial = await rpc(
    "recover_ezyvet_prescriptionitem_run",
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
  const completed = await post(run, "prescriptionitem");
  check(
    completed.status === 200 &&
      (await completed.json()).status === "review_ready",
    "Same prescriptionitem UUID resumes from committed page",
  );
  calls = upstreamCalls;
  check(
    (await post(run, "prescriptionitem")).status === 200 &&
      upstreamCalls === calls,
    "Terminal exact retry avoids upstream request",
  );
  check(
    (await post(run, "prescriptionitem", { animal_link_id: otherMapping }))
      .status !== 200 && upstreamCalls === calls,
    "Terminal UUID cannot be rebound to a different mapping",
  );
  check(
    sql(
      `select count(*) from public.ezyvet_import_snapshots where source_site_uid=${quote(site)} and resource='prescriptionitem';`,
    ) === "2",
    "Two pages persist once after acknowledgement loss",
  );
  const candidates = await rpc(
    "list_ezyvet_prescriptionitem_candidates",
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
    "Administrator discovers both durable prescriptionitem candidates",
  );
  check(
    candidates.candidates.every(
      (candidate: Record<string, unknown>) =>
        candidate.pet_id === pet &&
        candidate.animal_link_id === mapping &&
        typeof candidate.payload_hash === "string" &&
        candidate.prescription_snapshot_id === prescription.id &&
        candidate.prescription_external_id === "1" &&
        candidate.prescription_is_current === true &&
        candidate.eligible_for_review === true,
    ),
    "Candidate patient identity follows original approved mapping",
  );
  check(
    candidates.candidates.every(
      (candidate: { payload: Record<string, unknown> }) =>
        candidate.payload.date_start === "1700000000" &&
        candidate.payload.remaining === null &&
        candidate.payload.qty === null &&
        candidate.payload.product_id === "42" &&
        candidate.payload.instructions ===
          "<script>untrusted source item</script>",
    ),
    "Raw date, null quantity, product reference and untrusted text remain unmodified evidence",
  );
  const discovered = await rpc(
    "list_ezyvet_prescriptionitem_runs",
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
        entry.id === run && entry.scope === "prescription_scoped",
    ),
    "Server run discovery recovers browser-pointer loss",
  );

  const expectDenied = async (
    operation: () => Promise<unknown>,
    message: string,
    code?: string,
  ) => {
    let rejected = false;
    try {
      await operation();
    } catch (error) {
      rejected =
        !code ||
        (typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === code);
    }
    check(rejected, message);
  };
  const reviewId = randomUUID();
  ids.push(reviewId);
  const reviewPayload = {
    item_run_id: run,
    patient_version: Number(
      sql(`select version from public.pets where id=${quote(pet)};`),
    ),
    interpretation: {
      prescribed_on: null,
      prescription_date_status: "uninterpreted",
      status: "unknown",
      outside_author: null,
      reason: "Reviewed synthetic outside prescription evidence",
      completeness: "partial",
      partial_reason: "The original prescription has no item list",
      replaces_id: null,
      expected_predecessor_hash: null,
      items: candidates.candidates.map((candidate: { id: string }) => ({
        snapshot_id: candidate.id,
        start_on: null,
        start_date_status: "uninterpreted",
        product_id: null,
        product_version: null,
        note: null,
      })),
    },
  };
  const prepareArgs = {
    p_id: reviewId,
    p_pet_id: pet,
    p_payload: reviewPayload,
  };
  await expectDenied(
    () => rpc("prepare_ezyvet_prescription_review", prepareArgs, true),
    "Actual HTTP denies clinical preparation to ADMIN without DVM",
    "42501",
  );
  sql(
    `insert into public.user_roles(user_id,role) values(${quote(actor)},'DVM');`,
  );
  await expectDenied(
    () => rpc("prepare_ezyvet_prescription_review", prepareArgs),
    "Service API cannot impersonate a reviewing veterinarian",
  );
  const reviewAnonymous = {
    apikey: local.ANON_KEY,
    "Content-Type": "application/json",
  };
  await expectDenied(
    () =>
      api(
        "/rest/v1/rpc/prepare_ezyvet_prescription_review",
        prepareArgs,
        reviewAnonymous,
      ),
    "Anonymous HTTP cannot prepare clinical history",
  );
  await expectDenied(
    () =>
      rpc(
        "prepare_ezyvet_prescription_review",
        {
          ...prepareArgs,
          p_id: randomUUID(),
          p_payload: {
            ...reviewPayload,
            interpretation: {
              ...reviewPayload.interpretation,
              completeness: "complete",
              partial_reason: null,
            },
          },
        },
        true,
      ),
    "HTTP review cannot call an unresolved source list complete",
    "23514",
  );
  // Discard the response after an actual committed HTTP preparation; use the
  // retained operation UUID to recover the server's exact saved interpretation.
  await rpc("prepare_ezyvet_prescription_review", prepareArgs, true);
  const reviewCandidates = await rpc(
    "list_ezyvet_prescription_review_candidates",
    { p_pet_id: pet },
    true,
  );
  check(
    reviewCandidates.candidates.some(
      (candidate: { id: string }) => candidate.id === run,
    ),
    "Actual HTTP DVM discovery finds patient-scoped intake",
  );
  const reviewSourcePreview = await rpc(
    "get_ezyvet_prescription_review_candidate",
    { p_pet_id: pet, p_item_run_id: run },
    true,
  );
  check(
    reviewSourcePreview.eligible_for_review === true &&
      reviewSourcePreview.source_context.items.length === 2 &&
      reviewSourcePreview.source_context.parent.snapshot_id === prescription.id,
    "Actual HTTP preview preserves exact parent and both observed items",
  );
  await expectDenied(
    () =>
      rpc(
        "get_ezyvet_prescription_review_candidate",
        { p_pet_id: randomUUID(), p_item_run_id: run },
        true,
      ),
    "HTTP preview denies a different patient",
    "42501",
  );
  await expectDenied(
    () =>
      rpc("get_ezyvet_prescription_review_candidate", {
        p_pet_id: pet,
        p_item_run_id: run,
      }),
    "Service API cannot inspect a DVM source preview",
  );
  const preparedReview = await rpc(
    "recover_ezyvet_prescription_review",
    { p_id: reviewId, p_pet_id: pet },
    true,
  );
  check(
    preparedReview.request.status === "prepared" &&
      preparedReview.request.payload.item_run_id === run,
    "Discarded prepare response recovers durable clinical intent through HTTP",
  );
  check(
    preparedReview.request.review_context.selected_items.length === 2 &&
      preparedReview.request.review_context.selected_items.every(
        (item: {
          source: { original: { instructions: string; qty: unknown } };
        }) =>
          item.source.original.instructions ===
            "<script>untrusted source item</script>" &&
          item.source.original.qty === null,
      ),
    "HTTP preparation freezes both raw source items without dose conversion",
  );
  await expectDenied(
    () =>
      rpc(
        "prepare_ezyvet_prescription_review",
        {
          ...prepareArgs,
          p_payload: {
            ...reviewPayload,
            interpretation: {
              ...reviewPayload.interpretation,
              reason: "Changed after lost response",
            },
          },
        },
        true,
      ),
    "HTTP retry cannot overwrite saved interpretation",
    "42501",
  );
  const requestList = await rpc(
    "list_ezyvet_prescription_review_requests",
    { p_pet_id: pet },
    true,
  );
  check(
    requestList.requests.some(
      (entry: { request: { id: string } }) => entry.request.id === reviewId,
    ),
    "HTTP discovery finds clinician request after browser pointer loss",
  );
  const otherEmail = `prescription-review-${randomUUID()}@example.test`;
  const otherPassword = `Synthetic-${randomUUID()}-Aa1!`;
  const otherActor = (
    await api("/auth/v1/admin/users", {
      email: otherEmail,
      password: otherPassword,
      email_confirm: true,
    })
  ).id;
  // A1 (#164): handle_new_user no longer activates a new auth user, so a fixture
  // that needs an active synthetic staff member must activate it explicitly.
  sql(`insert into public.user_roles(user_id,role) values(${quote(otherActor)},'STAFF') on conflict do nothing; update public.profiles set is_active=true where id=${quote(otherActor)};`);
  ids.push(otherActor);
  additionalActors.push(otherActor);
  const otherAuth = await api(
    "/auth/v1/token?grant_type=password",
    { email: otherEmail, password: otherPassword },
    reviewAnonymous,
  );
  const otherHeaders = {
    ...reviewAnonymous,
    Authorization: `Bearer ${otherAuth.access_token}`,
  };
  sql(
    `insert into public.user_roles(user_id,role) values(${quote(otherActor)},'DVM');`,
  );
  const otherCandidates = await api(
    "/rest/v1/rpc/list_ezyvet_prescription_review_candidates",
    { p_pet_id: pet },
    otherHeaders,
  );
  check(
    otherCandidates.candidates.some(
      (candidate: { id: string }) => candidate.id === run,
    ),
    "Non-admin DVM session discovers another operator intake",
  );
  const otherPreview = await api(
    "/rest/v1/rpc/get_ezyvet_prescription_review_candidate",
    { p_pet_id: pet, p_item_run_id: run },
    otherHeaders,
  );
  check(
    otherPreview.eligible_for_review && otherPreview.run.pet_id === pet,
    "Non-admin DVM reads scoped source through actual Auth session",
  );
  const approveArgs = {
    p_id: reviewId,
    p_pet_id: pet,
    p_expected_hash: preparedReview.request.request_hash,
    p_confirmed: true,
  };
  await expectDenied(
    () =>
      api(
        "/rest/v1/rpc/approve_ezyvet_prescription_review",
        approveArgs,
        otherHeaders,
      ),
    "Second real Auth session cannot approve another veterinarian's draft",
    "42501",
  );
  await expectDenied(
    () =>
      rpc(
        "approve_ezyvet_prescription_review",
        { ...approveArgs, p_confirmed: false },
        true,
      ),
    "HTTP approval requires explicit clinician confirmation",
    "23514",
  );
  await expectDenied(
    () =>
      rpc(
        "approve_ezyvet_prescription_review",
        { ...approveArgs, p_expected_hash: "wrong" },
        true,
      ),
    "HTTP approval binds exact prepared review hash",
    "42501",
  );
  await rpc("approve_ezyvet_prescription_review", approveArgs, true);
  const approvedReview = await rpc(
    "recover_ezyvet_prescription_review",
    { p_id: reviewId, p_pet_id: pet },
    true,
  );
  check(
    approvedReview.request.status === "approved" &&
      approvedReview.receipt.id === reviewId &&
      approvedReview.receipt.items.length === 2,
    "Discarded approval response recovers approved header and both item receipts",
  );
  const repeatedApproval = await rpc(
    "approve_ezyvet_prescription_review",
    approveArgs,
    true,
  );
  check(
    repeatedApproval.receipt.version_hash ===
      approvedReview.receipt.version_hash,
    "HTTP approval retry returns same immutable version",
  );
  const duplicateId = randomUUID();
  ids.push(duplicateId);
  const duplicate = await rpc(
    "prepare_ezyvet_prescription_review",
    { ...prepareArgs, p_id: duplicateId },
    true,
  );
  const duplicateApproval = await rpc(
    "approve_ezyvet_prescription_review",
    {
      ...approveArgs,
      p_id: duplicateId,
      p_expected_hash: duplicate.request.request_hash,
    },
    true,
  );
  check(
    duplicateApproval.receipt.id === reviewId,
    "Equivalent HTTP request does not duplicate historical prescription",
  );
  const correctionId = randomUUID();
  ids.push(correctionId);
  const correctionPayload = {
    ...reviewPayload,
    interpretation: {
      ...reviewPayload.interpretation,
      outside_author: "Synthetic outside clinician",
      reason: "Reviewed outside prescriber correction",
      replaces_id: approvedReview.receipt.id,
      expected_predecessor_hash: approvedReview.receipt.version_hash,
    },
  };
  const correction = await rpc(
    "prepare_ezyvet_prescription_review",
    { ...prepareArgs, p_id: correctionId, p_payload: correctionPayload },
    true,
  );
  const correctionArgs = {
    ...approveArgs,
    p_id: correctionId,
    p_expected_hash: correction.request.request_hash,
  };
  const corrected = await rpc(
    "approve_ezyvet_prescription_review",
    correctionArgs,
    true,
  );
  check(
    corrected.receipt.version === 2 &&
      corrected.receipt.replaces_id === reviewId &&
      corrected.receipt.correction_history.length === 2,
    "HTTP correction appends a linked version and preserves predecessor history",
  );
  const chart = await rpc(
    "list_patient_imported_prescriptions",
    { p_pet_id: pet, p_limit: 1 },
    true,
  );
  check(
    chart.has_more &&
      chart.prescriptions.length === 1 &&
      chart.prescriptions[0].id === correctionId,
    "Actual HTTP patient chart discovers latest approved history and cursor",
  );
  const nextChart = await rpc(
    "list_patient_imported_prescriptions",
    {
      p_pet_id: pet,
      p_limit: 1,
      p_before_at: chart.next_cursor.before_at,
      p_before_id: chart.next_cursor.before_id,
    },
    true,
  );
  check(
    nextChart.prescriptions.length === 1 &&
      nextChart.prescriptions[0].id === reviewId &&
      !nextChart.has_more,
    "Chart cursor returns prior version once without duplication",
  );
  const pendingReviewId = randomUUID();
  ids.push(pendingReviewId);
  const pendingReview = await rpc(
    "prepare_ezyvet_prescription_review",
    { ...prepareArgs, p_id: pendingReviewId, p_payload: correctionPayload },
    true,
  );
  const pendingReviewArgs = {
    ...approveArgs,
    p_id: pendingReviewId,
    p_expected_hash: pendingReview.request.request_hash,
  };
  const abandonedId = randomUUID();
  ids.push(abandonedId);
  await rpc(
    "abandon_ezyvet_prescription_review",
    { p_id: abandonedId, p_pet_id: pet, p_confirmed: true },
    true,
  );
  await expectDenied(
    () =>
      rpc(
        "prepare_ezyvet_prescription_review",
        { ...prepareArgs, p_id: abandonedId },
        true,
      ),
    "HTTP abandonment tombstone prevents delayed preparation",
    "42501",
  );

  // Advance only this owned synthetic prescription cooldown; preserve production pacing code.
  sql(
    `update public.ezyvet_import_runs set retry_after=clock_timestamp()-interval '1 second' where id=${quote(prescriptionRun)};`,
  );
  prescriptionDescription = "Synthetic changed outside prescription";
  const changedPrescriptionRun = randomUUID();
  ids.push(changedPrescriptionRun);
  const changedPrescriptionResponse = await post(
    changedPrescriptionRun,
    "prescription",
  );
  const changedPrescriptionResult = await changedPrescriptionResponse.json();
  check(
    changedPrescriptionResponse.status === 200,
    "Later scoped prescription observation advances its source head: " +
      String(
        changedPrescriptionResult.error ?? changedPrescriptionResponse.status,
      ),
  );

  await expectDenied(
    () => rpc("approve_ezyvet_prescription_review", pendingReviewArgs, true),
    "Actual upstream header revision invalidates pending HTTP review",
    "40001",
  );
  const stalePreview = await rpc(
    "get_ezyvet_prescription_review_candidate",
    { p_pet_id: pet, p_item_run_id: run },
    true,
  );
  check(
    stalePreview.eligible_for_review === false &&
      stalePreview.unavailable_reason === "SOURCE_CONTEXT_CHANGED" &&
      stalePreview.source_context.parent.original.description ===
        reviewSourcePreview.source_context.parent.original.description &&
      stalePreview.source_context.items.length === 2,
    "Stale HTTP preview disables preparation while retaining original header and items",
  );
  const oldReceipt = await rpc(
    "approve_ezyvet_prescription_review",
    correctionArgs,
    true,
  );
  check(
    oldReceipt.receipt.id === correctionId &&
      oldReceipt.receipt.current.is_current === false,
    "Committed HTTP approval recovers after source change with visible stale status",
  );
  sql(
    `delete from public.user_roles where user_id=${quote(actor)} and role='DVM';`,
  );
  await expectDenied(
    () =>
      rpc(
        "recover_ezyvet_prescription_review",
        { p_id: correctionId, p_pet_id: pet },
        true,
      ),
    "Real HTTP session loses private review recovery after DVM role removal",
    "42501",
  );
  const staffChart = await rpc(
    "list_patient_imported_prescriptions",
    { p_pet_id: pet },
    true,
  );
  check(
    staffChart.prescriptions.length === 2,
    "Active non-DVM staff retains read-only HTTP chart access",
  );

  const staleCandidates = await rpc(
    "list_ezyvet_prescriptionitem_candidates",
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
          candidate.prescription_snapshot_id === prescription.id &&
          candidate.prescription_is_current === false &&
          candidate.eligible_for_review === false,
      ),
    "Changed prescription retains frozen prescriptionitem association with stale eligibility",
  );
  calls = upstreamCalls;
  check(
    (await post(run, "prescriptionitem")).status === 200 &&
      upstreamCalls === calls,
    "Exact terminal recovery precedes mutable prescription freshness",
  );
  assert.ok(committedPrescriptionItemPage);
  const committedReplay = await rpc(
    "stage_ezyvet_import_page",
    committedPrescriptionItemPage,
  );
  check(
    committedReplay.id === run && committedReplay.status === "review_ready",
    "Committed exact page replays without lease after prescription becomes stale",
  );
  let alteredReplayDenied = false;
  try {
    await rpc("stage_ezyvet_import_page", {
      ...committedPrescriptionItemPage,
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
    "ezyvet_prescriptionitem_runs",
    "ezyvet_prescriptionitem_pages",
    "ezyvet_prescriptionitem_page_observations",
    "ezyvet_prescription_review_requests",
    "ezyvet_imported_prescriptions",
    "ezyvet_imported_prescription_items",
  ]) {
    for (const headers of [anonymous, staffHeaders, serviceHeaders]) {
      const response = await fetch(
        local.API_URL + "/rest/v1/" + table + "?select=*&limit=1",
        { headers },
      );
      check(
        !response.ok,
        "Direct prescriptionitem receipt table access denied to API role",
      );
    }
  }
  let denied = false;
  try {
    await api(
      "/rest/v1/rpc/recover_ezyvet_prescriptionitem_run",
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
    await rpc("recover_ezyvet_prescriptionitem_run", recoveryArgs, true);
  } catch {
    denied = true;
  }
  check(
    denied,
    "Authenticated user without ADMIN cannot recover prescriptionitem run",
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
      p_resource: "prescriptionitem",
      p_source_origin: "https://api.trial.ezyvet.com",
    });
  } catch {
    denied = true;
  }
  check(
    denied,
    "Generic prescriptionitem claim denied through actual PostgREST",
  );
  const legacy = randomUUID();
  ids.push(legacy);
  sql(
    `insert into public.ezyvet_import_runs(id,source_origin,source_site_uid,resource,requested_by,status) values(${quote(legacy)},'https://api.trial.ezyvet.com',${quote(site)},'prescriptionitem',${quote(actor)},'review_ready');`,
  );
  calls = upstreamCalls;
  check(
    (await post(legacy, "prescriptionitem")).status !== 200 &&
      upstreamCalls === calls,
    "Legacy generic terminal UUID cannot acquire scoped context",
  );
  check(
    sideEffects() === beforeEffects,
    "Prescription intake, approval and corrections change no native treatments, billing, stock, delivery or encounters",
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
    "PrescriptionItem local integration failed: " +
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
  `Prescription intake and review HTTP/Auth/PostgREST: ${assertions} checks passed. Synthetic upstream only; no ezyVet requests.`,
);
