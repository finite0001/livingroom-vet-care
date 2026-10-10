// Bounded synthetic acceptance. Never accepts a production project argument.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeFileSync, readFileSync, existsSync, unlinkSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
const project = "kothoqicubowyhwfsrte";
const artifact = "/tmp/lrv-whogot-staging-fixture.json";
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const raw = JSON.parse(
  execFileSync(
    "supabase",
    [
      "projects",
      "api-keys",
      "--project-ref",
      project,
      "--reveal",
      "--output",
      "json",
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ),
);
const keys = Array.isArray(raw) ? raw : raw.rows;
const secret =
  keys.find((k) => k.name === "service_role")?.api_key ||
  keys.find((k) => k.type === "secret" && k.api_key?.startsWith("sb_secret_"))
    ?.api_key;
const publicKey =
  keys.find((k) => k.name === "anon")?.api_key ||
  keys.find((k) => k.type === "publishable")?.api_key;
assert.ok(secret && publicKey, "Expected existing keys");
const service = createClient(`https://${project}.supabase.co`, secret, options);
const staff = createClient(
  `https://${project}.supabase.co`,
  publicKey,
  options,
);
const sql = (query) => {
  execFileSync(
    "supabase",
    [
      "db",
      "query",
      "--linked",
      "--project-ref",
      project,
      query,
      "--output-format",
      "json",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
};
async function rpc(name, args = {}) {
  const r = await staff.rpc(name, args);
  if (r.error) throw r.error;
  return r.data;
}
if (process.argv.includes("--cleanup")) {
  assert.ok(existsSync(artifact), "Fixture receipt required");
  const fx = JSON.parse(readFileSync(artifact, "utf8"));
  assert.equal(fx.project, project);
  const logged = await staff.auth.signInWithPassword({
    email: fx.email,
    password: fx.password,
  });
  if (logged.error) throw logged.error;
  const p = await rpc("save_patient", {
    p_id: fx.pet.id,
    p_client_id: fx.client.id,
    p_expected_version: fx.pet.version,
    p_name: fx.pet.name,
    p_species: fx.pet.species,
    p_breed: null,
    p_dob: null,
    p_birth_date_precision: "unknown",
    p_color: null,
    p_sex: "unknown",
    p_neuter_status: "unknown",
    p_microchip_id: null,
    p_archived_at: new Date().toISOString(),
    p_deceased_at: null,
  });
  assert.ok(p.archived_at);
  await rpc("save_catalog_product", {
    p_id: fx.product.id,
    p_expected_version: fx.product.version,
    p_name: fx.product.name,
    p_kind: "service",
    p_manufacturer: "",
    p_unit: "visit",
    p_unit_price_cents: 1000,
    p_active: false,
  });
  sql(
    `update public.profiles set is_active=false where id='${fx.actor}'::uuid;`,
  );
  const ban = await service.auth.admin.updateUserById(fx.actor, {
    ban_duration: "876000h",
  });
  if (ban.error) throw ban.error;
  unlinkSync(artifact);
  console.log(
    JSON.stringify({
      cleanup: true,
      patient_archived: true,
      service_inactive: true,
      actor_inactive_banned: true,
      immutable_history_retained: true,
    }),
  );
  process.exit(0);
}
const prior = existsSync(artifact)
  ? JSON.parse(readFileSync(artifact, "utf8"))
  : null;
assert.ok(!prior?.client, "Completed fixture must be cleaned first");
assert.ok(!prior || prior.project === project);
const email = prior?.email || `synthetic-whogot-${randomUUID()}@example.test`,
  password = prior?.password || randomUUID() + randomUUID();
let actor = prior?.actor;
if (!actor) {
  const created = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (created.error) throw created.error;
  actor = created.data.user.id;
}
writeFileSync(artifact, JSON.stringify({ project, actor, email, password }), {
  mode: 0o600,
});
sql(
  `insert into public.user_roles(user_id,role) values('${actor}'::uuid,'ADMIN') on conflict do nothing;update public.profiles set is_active=true,full_name='Synthetic Whogot acceptance' where id='${actor}'::uuid;`,
);
const login = await staff.auth.signInWithPassword({ email, password });
if (login.error) throw login.error;
const client = await rpc("save_client", {
  p_actor_id: actor,
  p_client_id: null,
  p_expected_version: null,
  p_first_name: "SYNTHETIC WHOGOT",
  p_last_name: "ACCEPTANCE",
  p_primary_phone: "+12025550130",
  p_primary_email: email,
  p_preferred_channel: "EMAIL",
  p_mailing_address: null,
  p_housecall_address: null,
});
const pet = await rpc("save_patient", {
  p_id: null,
  p_client_id: client.id,
  p_expected_version: null,
  p_name: "Synthetic Whogot Dog",
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
  p_name: "Synthetic Whogot Exam",
  p_kind: "service",
  p_manufacturer: "",
  p_unit: "visit",
  p_unit_price_cents: 1000,
  p_active: true,
});
writeFileSync(
  artifact,
  JSON.stringify({
    project,
    actor,
    email,
    password,
    client,
    pet,
    encounter,
    product,
  }),
  { mode: 0o600 },
);
let checks = 0;
assert.equal(
  (await rpc("search_whogot", { p_product_id: product.id })).rows.length,
  0,
);
checks++;
const id = randomUUID(),
  request = {
    pet_id: pet.id,
    encounter_id: encounter.id,
    product_id: product.id,
    clinician_id: actor,
    performed_at: new Date(Date.now() - 60000).toISOString(),
    notes: "Synthetic completed service only",
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
const page = await rpc("search_whogot", { p_product_id: product.id });
assert.equal(page.rows.length, 1);
assert.equal(page.rows[0].event_type, "performed");
checks += 2;
assert.equal(
  (await rpc("search_whogot", { p_product_id: product.id, p_species: "Cat" }))
    .rows.length,
  0,
);
checks++;
assert.equal(
  (
    await rpc("search_whogot", {
      p_product_id: product.id,
      p_event_type: "administered",
    })
  ).rows.length,
  0,
);
checks++;
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
const correction = randomUUID();
const args = {
  p_id: correction,
  p_pet_id: pet.id,
  p_event_id: id,
  p_reason: "Synthetic error correction",
  p_replacement_id: null,
};
const corrected = await rpc("correct_patient_service", args);
assert.deepEqual(await rpc("correct_patient_service", args), corrected);
checks++;
assert.equal(
  (await rpc("search_whogot", { p_product_id: product.id })).rows.length,
  0,
);
checks++;
assert.equal(
  (
    await rpc("search_whogot", {
      p_product_id: product.id,
      p_include_corrected: true,
    })
  ).rows.length,
  1,
);
checks++;
assert.equal(
  (
    await rpc("search_whogot", {
      p_product_id: product.id,
      p_as_of: page.as_of,
    })
  ).rows.length,
  1,
);
checks++;
assert.equal(
  (await rpc("list_patient_services", { p_pet_id: pet.id })).length,
  1,
);
checks++;
const anon = createClient(`https://${project}.supabase.co`, publicKey, options);
assert.equal((await anon.rpc("search_whogot")).error.code, "42501");
checks++;
const record = {
  ...JSON.parse(readFileSync(artifact, "utf8")),
  eventId: id,
  checks,
};
writeFileSync(artifact, JSON.stringify(record), { mode: 0o600 });
console.log(
  JSON.stringify({
    project,
    checks,
    synthetic_only: true,
    real_auth_postgrest: true,
    provider_requests: 0,
    fixture_pending_ui_and_cleanup: true,
  }),
);
