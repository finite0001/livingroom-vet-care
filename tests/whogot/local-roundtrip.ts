/** Synthetic-only acceptance against an explicitly selected owned local Auth/PostgREST stack. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import {
  pageSchema,
  productsSchema,
} from "../../src/hub/features/whogot/model.ts";
const project = process.env.WHOGOT_TEST_PROJECT;
assert.ok(project, "Explicit disposable project required");
const projectId = readFileSync(`${project}/supabase/config.toml`, "utf8").match(
  /^project_id\s*=\s*"([a-zA-Z0-9_-]+)"/m,
)?.[1];
assert.ok(projectId);
const container = `supabase_db_${projectId}`;
const labels = JSON.parse(
  execFileSync("docker", ["inspect", container], { encoding: "utf8" }),
)[0].Config.Labels;
assert.equal(labels["com.supabase.cli.project"], projectId);
assert.equal(labels["com.supabase.cli.workdir"], project);
const status = JSON.parse(
  execFileSync(
    "supabase",
    ["status", "--workdir", project, "--output", "json"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ),
);
assert.match(status.API_URL, /^http:\/\/127\.0\.0\.1:\d+$/);
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
      "-qAt",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    { input: query, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
  ).trim();
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(status.API_URL, status.SERVICE_ROLE_KEY, options);
const email = `whogot-${randomUUID()}@example.test`,
  password = randomUUID() + randomUUID();
const created = await service.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
});
if (created.error) throw created.error;
const actor = created.data.user!.id;
sql(
  `insert into user_roles(user_id,role) values('${actor}','STAFF');update profiles set is_active=true,full_name='Synthetic Whogot clinician' where id='${actor}';`,
);
const staff = createClient(status.API_URL, status.ANON_KEY, options);
const login = await staff.auth.signInWithPassword({ email, password });
if (login.error) throw login.error;
async function rpc(name: string, args: Record<string, unknown> = {}) {
  const result = await staff.rpc(name, args);
  if (result.error) throw result.error;
  return result.data;
}
let checks = 0;
const client = await rpc("save_client", {
  p_actor_id: actor,
  p_client_id: null,
  p_expected_version: null,
  p_first_name: "Synthetic",
  p_last_name: "Whogot",
  p_primary_phone: "+13035550178",
  p_primary_email: "synthetic-whogot@example.test",
  p_preferred_channel: "EMAIL",
  p_mailing_address: null,
  p_housecall_address: null,
});
const pet = await rpc("save_patient", {
  p_id: null,
  p_client_id: client.id,
  p_expected_version: null,
  p_name: "Synthetic Whogot patient",
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
const encounter = await rpc("save_clinical_encounter", {
  p_id: null,
  p_pet_id: pet.id,
  p_expected_version: null,
  p_visit_at: new Date(Date.now() - 3600000).toISOString(),
  p_visit_type: "clinic",
  p_location: "",
  p_subjective: "",
  p_objective: "",
  p_assessment: "",
  p_plan: "",
});
const product = await rpc("save_catalog_product", {
  p_id: null,
  p_expected_version: null,
  p_name: "Synthetic original service",
  p_kind: "service",
  p_manufacturer: "",
  p_unit: "visit",
  p_unit_price_cents: 1000,
  p_active: true,
});
assert.ok(
  productsSchema
    .parse(
      await rpc("search_whogot_products", {
        p_search: "Synthetic original service",
      }),
    )
    .some((p) => p.id === product.id),
);
checks++;
assert.ok(
  (await rpc("list_service_clinicians")).some(
    (p: { id: string }) => p.id === actor,
  ),
);
checks++;
const id = randomUUID();
const request = {
  pet_id: pet.id,
  encounter_id: encounter.id,
  product_id: product.id,
  clinician_id: actor,
  performed_at: new Date(Date.now() - 60000).toISOString(),
  notes: "Synthetic completion",
  invoice_id: null,
};
const saved = await rpc("record_patient_service", {
  p_id: id,
  p_request: request,
});
assert.equal(saved.id, id);
checks++;
assert.deepEqual(
  await rpc("record_patient_service", { p_id: id, p_request: request }),
  saved,
);
checks++;
const page = pageSchema.parse(
  await rpc("search_whogot", { p_product_id: product.id }),
);
assert.equal(page.rows.length, 1);
assert.equal(page.rows[0].event_type, "performed");
checks += 2;
assert.equal(
  (
    await rpc("read_whogot_source", {
      p_pet_id: pet.id,
      p_event_type: "performed",
      p_id: id,
    })
  ).record.id,
  id,
);
checks++;
assert.equal(
  await rpc("read_whogot_source", {
    p_pet_id: randomUUID(),
    p_event_type: "performed",
    p_id: id,
  }),
  null,
);
checks++;
const correctionId = randomUUID();
const corrected = await rpc("correct_patient_service", {
  p_id: correctionId,
  p_pet_id: pet.id,
  p_event_id: id,
  p_reason: "Synthetic error",
  p_replacement_id: null,
});
assert.deepEqual(
  await rpc("correct_patient_service", {
    p_id: correctionId,
    p_pet_id: pet.id,
    p_event_id: id,
    p_reason: "Synthetic error",
    p_replacement_id: null,
  }),
  corrected,
);
checks++;
assert.equal(
  pageSchema.parse(await rpc("search_whogot", { p_product_id: product.id }))
    .rows.length,
  0,
);
checks++;
assert.equal(
  pageSchema.parse(
    await rpc("search_whogot", {
      p_product_id: product.id,
      p_as_of: page.as_of,
    }),
  ).rows.length,
  1,
);
checks++;
assert.equal(
  pageSchema.parse(
    await rpc("search_whogot", {
      p_product_id: product.id,
      p_include_corrected: true,
    }),
  ).rows[0].correction_status,
  "corrected",
);
checks++;
assert.equal(
  (await rpc("list_patient_services", { p_pet_id: pet.id }))[0].correction
    .reason,
  "Synthetic error",
);
checks++;
const anon = await createClient(status.API_URL, status.ANON_KEY, options).rpc(
  "search_whogot",
  {},
);
assert.ok(anon.error);
checks++;
sql(`update profiles set is_active=false where id='${actor}';`);
assert.ok((await staff.rpc("search_whogot", {})).error);
checks++;
assert.equal(
  sql(
    `select count(*) from patient_service_events where created_by='${actor}';`,
  ),
  "1",
);
checks++;
console.log(
  JSON.stringify({
    suite: "Whogot real local Auth/PostgREST",
    project_id: projectId,
    checks_passed: checks,
    synthetic_only: true,
    provider_requests: 0,
  }),
);
