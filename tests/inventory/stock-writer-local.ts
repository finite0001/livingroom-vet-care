/** Genuine local Auth/PostgREST proof of the shared clinical stock boundary. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { parseOwnedRuntimeStatus } from "../estimates/owned-runtime-status.ts";

const environment = z.object({
  STOCK_TEST_PROJECT: z.string().min(1),
  STOCK_RUN_SYNTHETIC_LOCAL: z.literal("true"),
}).parse(process.env);
const project = environment.STOCK_TEST_PROJECT;
const config = readFileSync(project + "/supabase/config.toml", "utf8");
const identity = config.match(/^project_id\s*=\s*"([a-zA-Z0-9_-]+)"/m)?.[1];
assert.ok(identity?.startsWith("lrv-prescription-") || identity?.startsWith("lrv-catalog-stock-"));
const container = "supabase_db_" + identity;
const labels = JSON.parse(execFileSync("docker", ["inspect", container], { encoding: "utf8" }))[0].Config.Labels;
assert.equal(labels["com.supabase.cli.project"], identity);
assert.equal(realpathSync(labels["com.supabase.cli.workdir"]), realpathSync(project));
const status = parseOwnedRuntimeStatus(execFileSync("supabase", ["status", "--workdir", project, "--output", "json", "--agent", "no"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
const apiPort = config.split("[api]")[1]?.split("[")[0].match(/^port\s*=\s*(\d+)/m)?.[1];
assert.equal(new URL(status.API_URL).origin, "http://127.0.0.1:" + apiPort);
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(status.API_URL, status.SERVICE_ROLE_KEY, options);
const staff = createClient(status.API_URL, status.ANON_KEY, options);
const anonymous = createClient(status.API_URL, status.ANON_KEY, options);
const uuid = z.string().uuid();
const row = z.object({ id: uuid }).passthrough();
const movement = row.extend({ quantity: z.number(), created_by: uuid, lot_id: uuid, kind: z.string() });
let actor = "", checks = 0, failure: unknown = null;
const lot = randomUUID(), product = randomUUID(), invoice = randomUUID();
function check(actual: unknown, expected: unknown) { assert.deepEqual(actual, expected); checks++; }
function sql(query: string) {
  return execFileSync("docker", ["exec", "-i", container, "psql", "-X", "-qAt", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"], { input: query, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 30000 }).trim();
}
async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await staff.rpc(name, args);
  if (error) throw Object.assign(new Error(name + ": " + error.message), { code: error.code });
  return data as unknown;
}
const baseline = sql("select jsonb_build_object('outbox',(select count(*)from communication_outbox),'payments',(select count(*)from payment_provider_profiles),'generation',(select count(*)from operational_task_generation_policy where enabled),'reconciliation',(select count(*)from operational_reconciliation_policy where enabled));");
try {
  check(sql("select count(*)from supabase_migrations.schema_migrations;"), "205");
  check(sql("select max(version)from supabase_migrations.schema_migrations;"), "20261020151157");
  const email = "synthetic-stock-" + randomUUID() + "@example.test", password = randomUUID() + randomUUID();
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  actor = uuid.parse(created.data.user?.id);
  writeFileSync(project + "/stock-api-fixture.json", JSON.stringify({ actor, lot, product, invoice }), { mode: 0o600 });
  sql(`update profiles set is_active=true,full_name='Synthetic stock API'where id='${actor}';insert into user_roles(user_id,role)values('${actor}','DVM'),('${actor}','ADMIN')on conflict do nothing;`);
  const signed = await staff.auth.signInWithPassword({ email, password });
  if (signed.error) throw signed.error;
  assert.ok(signed.data.user && signed.data.session);
  check(signed.data.user.id, actor);
  const session = z.object({ session_id: uuid }).passthrough().parse(JSON.parse(Buffer.from(signed.data.session.access_token.split(".")[1], "base64url").toString()));
  check(sql(`select count(*)from auth.sessions where id='${session.session_id}'and user_id='${actor}'and(not_after is null or not_after>clock_timestamp());`), "1");
  for (const table of ["stock_writer_manifests", "stock_writer_admissions", "stock_movement_sources", "stock_custody_sources", "stock_discrepancy_sources", "stock_pickup_sources", "stock_correction_sources"]) {
    check((await staff.from(table).select("*")).error?.code, "42501");
  }
  for (const db of [staff, service, anonymous]) {
    const attempted = await db.rpc("stock_writer_enter", { p_writer: "receive_inventory", p_source_id: randomUUID() });
    assert.ok(attempted.error && ["42501", "PGRST202"].includes(attempted.error.code));
    check(attempted.data, null);
  }
  for (const db of [staff, service, anonymous]) {
    for (const helper of ["stock_handoff_guard", "stock_handoff_consistency"]) {
      const attempted = await db.rpc(helper, {});
      assert.ok(attempted.error && ["42501", "PGRST202"].includes(attempted.error.code));
      check(attempted.data, null);
    }
  }
  const client = row.parse(await rpc("save_client", { p_actor_id: actor, p_client_id: null, p_expected_version: null, p_first_name: "Synthetic", p_last_name: "Stock source", p_primary_phone: "+13035550193", p_primary_email: email, p_preferred_channel: "EMAIL", p_mailing_address: "Synthetic address", p_housecall_address: null }));
  const patient = row.parse(await rpc("save_patient", { p_id: null, p_client_id: client.id, p_expected_version: null, p_name: "Synthetic source patient", p_species: "Dog", p_breed: null, p_dob: null, p_birth_date_precision: "unknown", p_color: null, p_sex: "unknown", p_neuter_status: "unknown", p_microchip_id: null, p_archived_at: null, p_deceased_at: null }));
  check(row.parse(await rpc("create_inventory_product", { p_id: product, p_name: "Synthetic source medication", p_kind: "medication", p_manufacturer: "Synthetic manufacturer", p_unit: "mL", p_unit_price_cents: 100 })).id, product);
  check(row.parse(await rpc("create_billing_invoice", { p_id: invoice, p_client_id: client.id })).id, invoice);
  const receiving = { p_id: randomUUID(), p_lot_id: lot, p_product_id: product, p_lot_number: "SYNTHETIC-SOURCE", p_expires_on: "2099-12-31", p_location: "Synthetic clinic", p_quantity: 10, p_reason: "Synthetic physical receipt" };
  const received = movement.parse(await rpc("receive_inventory", receiving));
  check(received.quantity, 10);
  check(movement.parse(await rpc("receive_inventory", receiving)), received);
  const adjusting = { p_id: randomUUID(), p_lot_id: lot, p_quantity: -0.125, p_reason: "Synthetic stock correction" };
  const adjusted = movement.parse(await rpc("adjust_inventory", adjusting));
  check(adjusted.quantity, -0.125);
  check(movement.parse(await rpc("adjust_inventory", adjusting)), adjusted);
  const alerts = () => rpc("read_patient_treatment_alerts", { p_pet_id: patient.id }).then(data => z.object({ source_hash: z.string().length(64) }).passthrough().parse(data));
  const treatment = { p_id: randomUUID(), p_request: { pet_id: patient.id, lot_id: lot, invoice_id: invoice, quantity: 0.25, dose: "Synthetic observed dose", route: "IV", site: "", veterinarian: "Synthetic veterinarian", veterinarian_license: "SYNTHETIC", administered_at: new Date().toISOString(), next_due_on: null, alert_review: { source_hash: (await alerts()).source_hash, acknowledged: true } } };
  const treated = row.parse(await rpc("record_patient_treatment", treatment));
  check(treated.id, treatment.p_id);
  check(row.parse(await rpc("record_patient_treatment", treatment)), treated);
  const record = randomUUID();
  check(row.parse(await rpc("save_patient_anesthesia_record", { p_id: record, p_pet_id: patient.id, p_expected_version: null, p_values: { procedure_name: "Synthetic procedure", started_at: new Date(Date.now() - 3600000).toISOString(), team: "Synthetic team", source: "manual", assessment: "Synthetic assessment", plan: "Synthetic plan" } })).id, record);
  const anesthesia = { p_id: randomUUID(), p_record_id: record, p_pet_id: patient.id, p_request: { lot_id: lot, invoice_id: invoice, quantity: 1.5, dose: "Synthetic recorded dose", route: "IV", site: "", veterinarian: "Synthetic veterinarian", veterinarian_license: "SYNTHETIC", administered_at: new Date().toISOString(), alert_review: { source_hash: (await alerts()).source_hash, acknowledged: true } } };
  const administered = row.parse(await rpc("record_anesthesia_drug_administration", anesthesia));
  check(administered.id, anesthesia.p_id);
  check(row.parse(await rpc("record_anesthesia_drug_administration", anesthesia)), administered);
  check(sql(`select sum(quantity)::text from inventory_movements where lot_id='${lot}';`), "8.125");
  check(sql(`select count(*)from billing_invoice_items where invoice_id='${invoice}';`), "2");
  check(sql(`select count(*)from stock_movement_sources s join inventory_movements m on m.id=s.movement_id where m.lot_id='${lot}';`), "4");
  check(sql(`select writer from stock_movement_sources where movement_id='${anesthesia.p_id}';`), "record_anesthesia_drug_administration");
  check(sql(`select count(*)from anesthesia_drug_administrations where id='${anesthesia.p_id}';`), "1");
  sql(`select stock_source_validate_movement(id)from inventory_movements where lot_id='${lot}';`);
  sql(`update profiles set is_active=false where id='${actor}';`);
  check((await staff.rpc("adjust_inventory", { p_id: randomUUID(), p_lot_id: lot, p_quantity: -0.001, p_reason: "Inactive actor attempt" })).error?.code, "42501");
  check(sql(`select sum(quantity)::text from inventory_movements where lot_id='${lot}';`), "8.125");
} catch (cause) {
  failure = cause;
} finally {
  if (actor) {
    try {
      sql(`update profiles set is_active=false where id='${actor}';update auth.sessions set not_after=clock_timestamp()where user_id='${actor}';delete from auth.refresh_tokens where user_id='${actor}';`);
      const signedOut = await staff.auth.signOut();
      if (signedOut.error) failure ??= signedOut.error;
    } catch (cause) { failure ??= cause; }
  }
}
check(sql("select jsonb_build_object('outbox',(select count(*)from communication_outbox),'payments',(select count(*)from payment_provider_profiles),'generation',(select count(*)from operational_task_generation_policy where enabled),'reconciliation',(select count(*)from operational_reconciliation_policy where enabled));"), baseline);
if (actor) {
  check(sql(`select count(*)from profiles where is_active and id='${actor}';`), "0");
  check(sql(`select count(*)from auth.sessions where user_id='${actor}'and(not_after is null or not_after>clock_timestamp());`), "0");
}
if (failure) throw failure;
const proof = { api_checks: checks, genuine_auth_postgrest: true, actual_live_session: true, source_tables_and_helpers_denied: true, canonical_receipt_replay: true, anesthesia_one_debit_one_source: true, exact_fractional_stock: true, inactive_actor_denied: true, owned_actor_and_sessions_retired: true, non_stock_baselines_unchanged: true, provider_requests: 0 };
writeFileSync(project + "/stock-writer-api-proof.json", JSON.stringify(proof, null, 2), { mode: 0o600 });
console.log(JSON.stringify(proof));
