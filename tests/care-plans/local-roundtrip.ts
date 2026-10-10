/** Explicitly owned localhost only; genuine Auth/PostgREST, no provider requests. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { parseOwnedRuntimeStatus } from "../estimates/owned-runtime-status.ts";
import { templateSchema, templatePageSchema, planSchema, planPageSchema, displaySchema, previewSchema, sourcePageSchema, historyPageSchema, completionReceiptSchema, policyReceiptSchema, duePageSchema } from "../../src/hub/features/care-plans/model.ts";
import { calendarDue } from "../../src/hub/features/care-plans/calendar.ts";
const project = process.env.CARE_TEST_PROJECT;
assert.ok(project && process.env.CARE_RUN_SYNTHETIC_LOCAL === "true", "Explicit synthetic local project required");
const projectId = readFileSync(`${project}/supabase/config.toml`, "utf8").match(/^project_id\s*=\s*"([a-zA-Z0-9_-]+)"/m)?.[1];assert.ok(projectId);
const container = `supabase_db_${projectId}`;
const labels = JSON.parse(execFileSync("docker", ["inspect", container], { encoding: "utf8" }))[0].Config.Labels;
assert.equal(labels["com.supabase.cli.project"], projectId);assert.equal(realpathSync(labels["com.supabase.cli.workdir"]), realpathSync(project));
const status = parseOwnedRuntimeStatus(execFileSync("supabase", ["status", "--workdir", project, "--output", "json", "--agent", "no"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
const sql = (query: string) => execFileSync("docker", ["exec", "-i", container, "psql", "-X", "-qAt", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"], { input: query, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(status.API_URL, status.SERVICE_ROLE_KEY, options);
interface Actor { id: string; db: SupabaseClient }
const actors: Actor[] = [];
async function actor(role: "DVM" | "STAFF" | "ADMIN") {
 const email = `synthetic-care-${randomUUID()}@example.test`, password = randomUUID() + randomUUID();
 const created = await service.auth.admin.createUser({ email, password, email_confirm: true });if (created.error) throw created.error;
 const id = created.data.user!.id;
 const db = createClient(status.API_URL, status.ANON_KEY, options);const value = { id, db };actors.push(value);
 sql(`update profiles set is_active=true,full_name='Synthetic ${role} reviewer' where id='${id}';insert into user_roles(user_id,role) values('${id}','${role}') on conflict do nothing;`);
 const login = await db.auth.signInWithPassword({ email, password });if (login.error) throw login.error;return value;
}
async function rpc(db: SupabaseClient, name: string, args: Record<string, unknown> = {}) {
 const { data, error } = await db.rpc(name, args);if (error) throw error;return data;
}
async function denied(db: SupabaseClient, name: string, args: Record<string, unknown>, code: string) {
 const { error } = await db.rpc(name, args);assert.equal(error?.code, code);
}
let checks = 0;
const cleanupErrors: unknown[] = [];
try {
 const dvm = await actor("DVM"), staff = await actor("STAFF"), admin = await actor("ADMIN");
 const templateId = randomUUID(), templateAction = randomUUID();
 const values = { care_key: `synthetic-${templateId}`, name: "Synthetic recurring wellness", care_kind: "wellness", interval_amount: 3, interval_unit: "months", anchor_mode: "completed_care", month_end: "clamp", active: true, review_note: "Synthetic quarterly review" };
 const templateArgs = { p_action_id: templateAction, p_id: templateId, p_expected_version: null, p_request: values };
 await denied(admin.db, "save_recurring_care_template", templateArgs, "42501");checks++;
 await denied(staff.db, "save_recurring_care_template", templateArgs, "42501");checks++;
 const template = templateSchema.parse(await rpc(dvm.db, "save_recurring_care_template", templateArgs));assert.equal(template.approved_by, dvm.id);checks++;
 assert.deepEqual(templateSchema.parse(await rpc(dvm.db, "save_recurring_care_template", templateArgs)), template);checks++;
 assert.deepEqual(templateSchema.parse(await rpc(staff.db, "read_recurring_care_template", { p_id: templateId })), template);checks++;
 const templates = templatePageSchema.parse(await rpc(staff.db, "list_recurring_care_templates", { p_limit: 1 }));assert.equal(templates.rows.length, 1);checks++;
 const client = await rpc(staff.db, "save_client", { p_actor_id: staff.id, p_client_id: null, p_expected_version: null, p_first_name: "Synthetic", p_last_name: "Care Auth", p_primary_phone: "+12025550177", p_primary_email: "synthetic-care-auth@example.test", p_preferred_channel: "EMAIL", p_mailing_address: null, p_housecall_address: null });
 const patientArgs = { p_id: null, p_client_id: client.id, p_expected_version: null, p_name: "Synthetic care Auth patient", p_species: "Dog", p_breed: null, p_dob: null, p_birth_date_precision: "unknown", p_color: null, p_sex: "unknown", p_neuter_status: "unknown", p_microchip_id: null, p_archived_at: null, p_deceased_at: null };
 const pet = await rpc(staff.db, "save_patient", patientArgs), sibling = await rpc(staff.db, "save_patient", { ...patientArgs, p_name: "Synthetic care Auth sibling" });
 const planId = randomUUID(), planAction = randomUUID();
 const planValues = { template_id: template.id, template_version: template.version, name: template.name, interval_amount: 3, interval_unit: "months", anchor_mode: "completed_care", month_end: "clamp", anchor_on: "2026-01-31", due_on: "2026-04-30", status: "proposed", reminders_enabled: false, override_reason: "", review_note: "Synthetic proposal", replace_anchor_evidence: false };
 const planArgs = { p_action_id: planAction, p_id: planId, p_pet_id: pet.id, p_expected_version: null, p_request: planValues };
 const proposed = planSchema.parse(await rpc(staff.db, "save_patient_care_plan", planArgs));assert.equal(proposed.status, "proposed");assert.equal(proposed.approved_by, null);checks+=2;
 const approvedArgs = { ...planArgs, p_action_id: randomUUID(), p_expected_version: 1, p_request: { ...planValues, status: "current", reminders_enabled: true, review_note: "Synthetic DVM review" } };
 await denied(admin.db, "save_patient_care_plan", approvedArgs, "42501");checks++;
 const approved = planSchema.parse(await rpc(dvm.db, "save_patient_care_plan", approvedArgs));assert.equal(approved.approved_by, dvm.id);checks++;
 const detail = displaySchema.parse(await rpc(staff.db, "read_patient_care_plan", { p_plan_id: planId, p_pet_id: pet.id }));assert.equal(detail.plan.version, 2);checks++;
 assert.equal(await rpc(staff.db, "read_patient_care_plan", { p_plan_id: planId, p_pet_id: sibling.id }), null);checks++;
 const page = planPageSchema.parse(await rpc(staff.db, "list_patient_care_plans", { p_pet_id: pet.id }));assert.equal(page.rows[0].plan.id, planId);checks++;
 const history = historyPageSchema.parse(await rpc(staff.db, "list_care_plan_history", { p_plan_id: planId, p_pet_id: pet.id, p_limit: 1 }));assert.equal(history.next, 2);checks++;
 const older = historyPageSchema.parse(await rpc(staff.db, "list_care_plan_history", { p_plan_id: planId, p_pet_id: pet.id, p_before_version: history.next, p_limit: 1 }));assert.equal(older.rows[0].version, 1);checks++;
 duePageSchema.parse(await rpc(staff.db, "list_recurring_care_due", { p_filter: "all", p_limit: 1 }));checks++;
 const sourceId = randomUUID(), encounterId = randomUUID(), productId = randomUUID();
 sql(`begin;select set_config('request.jwt.claims','{"sub":"${dvm.id}","role":"authenticated"}',true);insert into clinical_encounters(id,pet_id,visit_at,visit_type,created_by,updated_by) values('${encounterId}','${pet.id}','2026-03-31T18:00Z','clinic','${dvm.id}','${dvm.id}');insert into catalog_products(id,name,kind,unit,unit_price_cents,created_by) values('${productId}','Synthetic actual wellness','service','visit',100,'${dvm.id}');commit;`);
 await rpc(dvm.db, "record_patient_service", { p_id: sourceId, p_request: { pet_id: pet.id, encounter_id: encounterId, product_id: productId, clinician_id: dvm.id, performed_at: "2026-03-31T18:00:00Z", notes: "Synthetic recorded wellness", invoice_id: null } });
 const sources = sourcePageSchema.parse(await rpc(dvm.db, "list_care_completion_sources", { p_pet_id: pet.id, p_plan_id: planId, p_source_kind: "service", p_limit: 1 }));assert.equal(sources.rows[0].id, sourceId);checks++;
 const previewArgs = { p_plan_id: planId, p_pet_id: pet.id, p_expected_version: 2, p_source_kind: "service", p_source_id: sourceId, p_source_version: 1 };
 await denied(staff.db, "preview_care_plan_completion", previewArgs, "42501");checks++;
 const preview = previewSchema.parse(await rpc(dvm.db, "preview_care_plan_completion", previewArgs));assert.equal(preview.next_due_on, calendarDue("2026-03-31", { interval_amount: 3, interval_unit: "months", anchor_mode: "completed_care", month_end: "clamp" }));checks++;
 const completionArgs = { p_action_id: randomUUID(), p_plan_id: planId, p_pet_id: pet.id, p_expected_version: 2, p_request: { source_kind: "service", source_id: sourceId, source_version: 1, review_note: "Synthetic reviewed actual service" } };
 const completed = completionReceiptSchema.parse(await rpc(dvm.db, "complete_patient_care_plan", completionArgs));assert.equal(completed.plan.due_on, preview.next_due_on);checks++;
 assert.deepEqual(completionReceiptSchema.parse(await rpc(dvm.db, "complete_patient_care_plan", completionArgs)), completed);checks++;
 assert.deepEqual(completionReceiptSchema.parse(await rpc(dvm.db, "read_care_workflow_action", { p_action_id: completionArgs.p_action_id, p_kind: "completion", p_entity_id: planId, p_pet_id: pet.id, p_request: { expected_version: 2, values: completionArgs.p_request } })), completed);checks++;
 assert.equal(sourcePageSchema.parse(await rpc(dvm.db, "list_care_completion_sources", { p_pet_id: pet.id, p_plan_id: planId })).rows.length, 0);checks++;
 const wordingId = randomUUID();await rpc(admin.db, "save_care_message_template", { p_id: wordingId, p_expected_version: null, p_name: "Synthetic Auth wording", p_channel: "email", p_days_before: 0, p_body: "{{patient_name}} {{care_name}} {{due_date}}", p_active: true, p_review_note: "Synthetic review" });
 const existingRaw = sql("select to_jsonb(p) from reminder_automation_policies p where source_kind='care_plan' and channel='EMAIL';");
 const existingPolicy = existingRaw ? JSON.parse(existingRaw) : null;
 const policyId = existingPolicy?.id ?? randomUUID(), policyVersion = existingPolicy?.version ?? null;
 const policyArgs = { p_action_id: randomUUID(), p_id: policyId, p_expected_version: policyVersion, p_request: { channel: "EMAIL", message_template_id: existingPolicy?.message_template_id ?? wordingId, message_template_version: existingPolicy?.message_template_version ?? 1, subject: existingPolicy?.subject ?? "Synthetic care", enabled: false, review_note: "Synthetic disabled policy", start_minute: 480, end_minute: 1200 } };
 await denied(dvm.db, "save_care_plan_delivery_policy", policyArgs, "42501");checks++;
 policyReceiptSchema.parse(await rpc(admin.db, "save_care_plan_delivery_policy", policyArgs));checks++;
 const dead = await rpc(staff.db, "save_patient", { ...patientArgs, p_id: pet.id, p_expected_version: pet.version, p_deceased_at: "2026-10-01" });
 const stopped = displaySchema.parse(await rpc(staff.db, "read_patient_care_plan", { p_plan_id: planId, p_pet_id: pet.id }));assert.equal(stopped.patient_inactive, true);assert.equal(stopped.plan.status, "proposed");checks+=2;
 await denied(dvm.db, "save_patient_care_plan", { ...approvedArgs, p_action_id: randomUUID(), p_expected_version: stopped.plan.version }, "23514");checks++;
 assert.deepEqual(completionReceiptSchema.parse(await rpc(dvm.db, "complete_patient_care_plan", completionArgs)), completed);checks++;
 await rpc(staff.db, "save_patient", { ...patientArgs, p_id: pet.id, p_expected_version: dead.version });
 assert.equal(displaySchema.parse(await rpc(staff.db, "read_patient_care_plan", { p_plan_id: planId, p_pet_id: pet.id })).plan.status, "proposed");checks++;
 assert.equal(sql(`select count(*) from communication_outbox where client_id='${client.id}';`), "0");checks++;
 const anon = createClient(status.API_URL, status.ANON_KEY, options);await denied(anon, "list_patient_care_plans", { p_pet_id: pet.id }, "42501");checks++;
 sql(`update profiles set is_active=false where id='${staff.id}';`);await denied(staff.db, "list_patient_care_plans", { p_pet_id: pet.id }, "42501");checks++;
 console.log(`Genuine local care Auth/PostgREST passed: ${checks} assertions; no outbox messages or provider requests.`);
} finally {
 for (const value of actors) {
  try {
  sql(`update profiles set is_active=false where id='${value.id}';`);
  const ban = await service.auth.admin.updateUserById(value.id, { ban_duration: "876000h" });if (ban.error) cleanupErrors.push(ban.error);
  const signout = await value.db.auth.signOut();if (signout.error) cleanupErrors.push(signout.error);
  } catch (error) { cleanupErrors.push(error); }
 }
}
if (cleanupErrors.length) throw new AggregateError(cleanupErrors, "Synthetic actor offboarding failed");
