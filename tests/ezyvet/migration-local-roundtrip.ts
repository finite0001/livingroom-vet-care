import { createMigrationVaccinationApi } from "../../src/hub/features/imports/migration-vaccination-api.ts";
import { createMigrationHistoryApi } from "../../src/hub/features/imports/migration-history-api.ts";
import { createMigrationResumeApi } from "../../src/hub/features/imports/migration-resume-api.ts";
import { createClient } from "@supabase/supabase-js";
import { createMigrationSelectionApi } from "../../src/hub/features/imports/migration-selection-api.ts";
/** Actual local Auth/PostgREST acceptance; no provider or outbound delivery. */
import assert from "node:assert/strict";
import { createMigrationCaptureApi } from "../../src/hub/features/imports/migration-capture-api.ts";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createMigrationRunApi, parseMigrationManifest, parseMigrationBinding } from "../../src/hub/features/imports/migration-run-api.ts";
import type { MigrationRequest, MigrationBindingRequest } from "../../src/hub/features/imports/migration-run-api.ts";

const project = process.env.PAYMENT_TEST_PROJECT;
assert.ok(project, "Explicit owned local project required");
const projectId = readFileSync(`${project}/supabase/config.toml`, "utf8").match(/^project_id\s*=\s*"([a-zA-Z0-9_-]+)"/m)?.[1];
assert.match(projectId ?? "", /^lrv-attachment-[a-f0-9]{12}$/);
const local = JSON.parse(execFileSync("supabase", ["status", "--workdir", project, "--output", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
const apiPort = Number(process.env.PAYMENT_TEST_API_PORT ?? "62421");
assert.ok(Number.isInteger(apiPort) && apiPort >= 1025 && apiPort <= 65532);
assert.equal(local.API_URL, `http://127.0.0.1:${apiPort}`);
const sql = (query: string) => execFileSync("docker", ["exec", "-i", `supabase_db_${projectId}`, "psql", "-U", "postgres", "-d", "postgres", "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"], { input: query, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
const headers = (token: string) => ({ apikey: local.ANON_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" });
const service = headers(local.SERVICE_ROLE_KEY);
let checks = 0;
const check = (value: unknown, message: string) => { assert.ok(value, message); checks++; };
async function request(path: string, body: unknown, auth = service) {
  const response = await fetch(local.API_URL + path, { method: "POST", headers: auth, body: JSON.stringify(body) });
  const text = await response.text();
  const value = text ? JSON.parse(text) : null;
  if (!response.ok) throw { code: value?.code, message: value?.message };
  return value;
}
async function account() {
  const email = `migration-${randomUUID()}@example.test`, password = `Synthetic-${randomUUID()}-Aa1!`;
  const user = await request("/auth/v1/admin/users", { email, password, email_confirm: true });
  const login = await request("/auth/v1/token?grant_type=password", { email, password }, headers(local.ANON_KEY));
  sql(`insert into user_roles(user_id,role) values(${quote(user.id)},'ADMIN');`);
  return { id: user.id as string, auth: headers(login.access_token) };
}
const owner = await account(), other = await account();
const transport = (auth: Record<string, string>) => ({
  async rpc(name: string, args: Record<string, unknown>) {
    try { return { data: await request("/rest/v1/rpc/" + name, args, auth), error: null }; }
    catch (error) { return { data: null, error }; }
  },
});
const ownerTransport = transport(owner.auth);
const api = createMigrationRunApi(ownerTransport, owner.id);
const otherApi = createMigrationRunApi(transport(other.auth), other.id);
const staffRpc = async (name: string, args: Record<string, unknown>) => {
  const { data, error } = await ownerTransport.rpc(name, args); if (error) throw error; return data;
};
const client = (await staffRpc("save_client", { p_actor_id: owner.id, p_client_id: null, p_expected_version: null, p_first_name: "Synthetic", p_last_name: "Migration", p_primary_phone: null, p_primary_email: null, p_preferred_channel: "EMAIL", p_mailing_address: null, p_housecall_address: null })).id;
const pet = (await staffRpc("save_patient", { p_id: null, p_client_id: client, p_expected_version: null, p_name: "Synthetic migration patient", p_species: "Dog", p_breed: null, p_dob: null, p_birth_date_precision: "unknown", p_color: null, p_sex: "unknown", p_neuter_status: "unknown", p_microchip_id: null, p_archived_at: null, p_deceased_at: null })).id;
const origin = "https://api.trial.ezyvet.com", site = "Synthetic-Migration-" + randomUUID();
const animalRun = randomUUID(), mapping = randomUUID();
const claimed = await request("/rest/v1/rpc/claim_ezyvet_import", { p_id: animalRun, p_actor: owner.id, p_site_uid: site, p_resource: "animal", p_source_origin: origin });
await request("/rest/v1/rpc/stage_ezyvet_import_page", { p_id: animalRun, p_actor: owner.id, p_lease_id: claimed.lease_id, p_page: 1, p_complete: true, p_items: [{ external_id: "77", payload: { id: 77 } }] });
const snapshot = sql(`select id from ezyvet_import_snapshots where source_site_uid=${quote(site)} and resource='animal';`);
sql(`insert into ezyvet_record_links(id,request_id,request_hash,source_origin,source_site_uid,resource,external_id,snapshot_id,head_version,client_id,pet_id,local_version,action,reason,approved_by)
 values(${quote(mapping)},${quote(mapping)},'synthetic-review',${quote(origin)},${quote(site)},'animal','77',${quote(snapshot)},1,${quote(client)},${quote(pet)},1,'link','SYNTHETIC REVIEWED MAPPING',${quote(owner.id)});`);
const effects = () => sql("select jsonb_build_array((select count(*) from patient_documents),(select count(*) from patient_treatments),(select count(*) from billing_invoices),(select count(*) from inventory_movements),(select count(*) from communication_outbox),(select count(*) from storage.objects),(select count(*) from vaccine_certificates),(select count(*) from patient_vaccine_due_plans),(select count(*) from care_reminder_jobs));");
const beforeEffects = effects();
const selector = createMigrationSelectionApi(createClient(local.API_URL, local.ANON_KEY, { global: { headers: owner.auth }, auth: { persistSession: false, autoRefreshToken: false } }), owner.id);
let mappingPage = 0, mapped = await selector.mappings();
while (!mapped.rows.some(m => m.id === mapping) && mapped.has_more && mappingPage < 20) mapped = await selector.mappings(++mappingPage);
const selectedMapping = mapped.rows.find(m => m.id === mapping);
check(selectedMapping?.patient_name === "Synthetic migration patient" && selectedMapping?.household_name === "Synthetic Migration", "Real RLS mapping selector resolves exact patient and household names");
const selectedParents = await selector.parents(selectedMapping!, "attachment");
check(selectedParents.rows.some(p => p.id === snapshot && p.version === 1 && p.external_id === "77"), "Real parent selector matches source head and exact mapped identity");
await assert.rejects(() => selector.mappings(-1)); checks++;

// Actual clinical history receipt read through authenticated PostgREST.
const historyRun = randomUUID();
const historyClaim = await request("/rest/v1/rpc/claim_ezyvet_clinical_import", { p_id: historyRun, p_actor: owner.id, p_site_uid: site, p_resource: "history", p_source_origin: origin, p_animal_link_id: mapping });
await request("/rest/v1/rpc/stage_ezyvet_import_page", { p_id: historyRun, p_actor: owner.id, p_lease_id: historyClaim.lease_id, p_page: 1, p_complete: true, p_items: [{ external_id: "101", payload: { id: 101, animal_id: 77, comments: "Synthetic outside history" } }] });
const candidate = (await staffRpc("list_ezyvet_clinical_candidates", { p_animal_link_id: mapping, p_resource: "history" })).candidates[0];
const historyApproval = randomUUID();
const preparedHistory = await staffRpc("prepare_ezyvet_history_approval", { p_id: historyApproval, p_pet_id: pet, p_payload: { animal_link_id: mapping, snapshot_id: candidate.id, payload_hash: candidate.payload_hash, observed_head_version: candidate.head_version,
  patient_version: 1, consult_mode: "not_referenced", consult_snapshot_id: null, consult_payload_hash: null, consult_head_version: null, reason: "Synthetic history review" } });
await staffRpc("approve_ezyvet_history", { p_id: historyApproval, p_pet_id: pet, p_expected_hash: preparedHistory.request.request_hash, p_confirmed: true });
const historyManifest = await api.prepare({ id: randomUUID(), source_origin: origin, source_site_uid: site, scopes: [{ id: randomUUID(), mapping_id: mapping, resource: "history", parent_type: "animal", parent_snapshot_id: snapshot, parent_head_version: 1, disposition: "required", reason: "Synthetic history selection" }] });
const historyBinding = await api.bind({ id: randomUUID(), scope_id: historyManifest.scopes[0].id, child_run_id: historyRun, reason: "Synthetic scoped history", replaces_id: null });
const historyItems = await api.items(historyManifest, historyBinding);
const historyApi = createMigrationHistoryApi(ownerTransport, owner.id);
const histories = await historyApi.list(historyBinding, historyItems.items[0]);
check(histories.approvals.length === 1 && histories.approvals[0].id === historyApproval && histories.approvals[0].relationship === "exact_source_version", "Actual history approval matches exact observed evidence over HTTP");
check(histories.approvals[0].source_current && histories.approvals[0].extraction_receipts === 0 && !histories.complete_coverage_verified, "Approved outside history does not imply extracted diagnosis or accepted coverage");
check((await historyApi.list(historyBinding, historyItems.items[0], 1)).approvals.length === 0, "History version cursor is terminal over HTTP");
await assert.rejects(() => historyApi.list(historyBinding, { ...historyItems.items[0], evidence_hash: "f".repeat(64) })); checks++;
await assert.rejects(() => request("/rest/v1/rpc/list_ezyvet_migration_history_evidence", { p_binding_id: historyBinding.id, p_page: 1, p_snapshot_id: candidate.id, p_evidence_hash: historyItems.items[0].evidence_hash }, other.auth)); checks++;
sql(`update ezyvet_identity_heads set version=version+2 where source_site_uid=${quote(site)} and resource='history';`);
check(!(await historyApi.list(historyBinding, historyItems.items[0])).approvals[0].source_current, "Actual history currentness detects same-payload later source head");

const manifestRequest: MigrationRequest = { id: randomUUID(), source_origin: origin, source_site_uid: site, scopes: [{ id: randomUUID(), mapping_id: mapping, resource: "attachment", parent_type: "animal", parent_snapshot_id: snapshot, parent_head_version: 1, disposition: "required", reason: "Synthetic supervised selection" }] };
const uncertain = createMigrationRunApi({ async rpc(name, args) {
  const result = await ownerTransport.rpc(name, args);
  if (result.error) return result;
  return { data: null, error: new Error("Simulated reply loss after server commit") };
} }, owner.id);
await assert.rejects(() => uncertain.prepare(manifestRequest), /Simulated reply loss/); checks++;
const saved = await api.read(manifestRequest.id);
check(saved?.run.actor_id === owner.id && saved.scopes[0].pet_id === pet, "Actual HTTP recovery binds owner and patient");
check(saved.scope_manifest_version === 1 && /^[a-f0-9]{64}$/.test(saved.scope_manifest_hash), "Resolved scope has a versioned digest over HTTP");
assert.deepEqual(await api.prepare(manifestRequest), saved); checks++;
check((await api.list()).runs.some(row => row.id === manifestRequest.id), "Server list restores lost browser pointer");
check(await otherApi.read(manifestRequest.id) === null, "Other actual signed-in administrator cannot read manifest");
check((await otherApi.list()).runs.length === 0, "Other actual administrator cannot discover owner manifests");
await assert.rejects(() => api.prepare({ ...manifestRequest, source_site_uid: "changed-site" })); checks++;
const child = randomUUID();
await request("/rest/v1/rpc/claim_ezyvet_attachment_import", { p_id: child, p_actor: owner.id, p_site_uid: site, p_source_origin: origin, p_animal_link_id: mapping });
const childBefore = sql(`select to_jsonb(r) from ezyvet_import_runs r where id=${quote(child)};`);
const bindingRequest: MigrationBindingRequest = { id: randomUUID(), scope_id: manifestRequest.scopes[0].id, child_run_id: child, reason: "Explicit existing attempt", replaces_id: null };
await assert.rejects(() => uncertain.bind(bindingRequest), /Simulated reply loss/); checks++;
const bound = await api.readBinding(bindingRequest.id, bindingRequest.scope_id);
const selectedRuns = await selector.runs((await api.read(manifestRequest.id))!, (await api.read(manifestRequest.id))!.scopes[0]);
check(selectedRuns.rows.some(r => r.id === child) && selectedRuns.rows.every(r => r.requested_by === owner.id && r.source_site_uid === site && r.resource === "attachment"), "Real run selector enforces owner, source and resource filters");

check(bound?.child_run_id === child && bound.child_context.parent_evidence === "exact_parent_version", "Lost binding reply recovers exact child context");
const initialProgress = await api.progress(saved, bound);
check(initialProgress?.observations.occurrences === 0 && initialProgress.scan.status === "running" && !initialProgress.scan.traversal_ended, "Unfetched child is not completed coverage");
check(initialProgress.scan.provider_total === null && !initialProgress.scan.complete_coverage_verified && initialProgress.clinical_review.approved_local_outcomes === null, "HTTP progress preserves unknown totals and review outcomes");
check(initialProgress.parent_current && initialProgress.household_current, "Saved exact context is currently valid");
assert.deepEqual(await api.bind(bindingRequest), bound); checks++;
check((await api.listBindings(bindingRequest.scope_id)).bindings[0].id === bindingRequest.id, "Binding discovery uses real owner API");
check(await otherApi.readBinding(bindingRequest.id, bindingRequest.scope_id) === null, "Other administrator cannot recover binding");
await assert.rejects(() => otherApi.listBindings(bindingRequest.scope_id)); checks++;
await assert.rejects(() => otherApi.bind(bindingRequest)); checks++;
check(sql(`select to_jsonb(r) from ezyvet_import_runs r where id=${quote(child)};`) === childBefore, "HTTP binding leaves child lease, owner and cursor untouched");
let resumeInvocations = 0;
const resumeApi = createMigrationResumeApi({ ...ownerTransport, async readGenericRun() { throw new Error("Owned attachment recovery required"); }, async invoke() { resumeInvocations++; throw new Error("No importer invocation permitted in this blocked-runtime fixture"); } }, owner.id);
const resumeIdentity = { manifest_id: saved.run.id, scope_id: bound.scope_id, binding_id: bound.id };
const leasedResume = await resumeApi.recover(resumeIdentity);
check(leasedResume.lease_active && leasedResume.blockers.length > 0, "Actual owned recovery exposes active lease and blocks migration resume");
await assert.rejects(() => resumeApi.resume(leasedResume)); checks++;
const firstLease = JSON.parse(childBefore).lease_id;
await request("/rest/v1/rpc/fail_ezyvet_import_page", { p_id: child, p_actor: owner.id, p_lease_id: firstLease, p_code: "UPSTREAM_TIMEOUT", p_retry_seconds: 1 });
sql(`update ezyvet_import_runs set retry_after=now()+interval '1 hour' where id=${quote(child)};`);
check((await resumeApi.recover(resumeIdentity)).blockers.some(b => b.includes("cooling down")), "Actual cooldown blocks migration continuation");
sql(`update ezyvet_import_runs set retry_after=null where id=${quote(child)};`);
const retry = await request("/rest/v1/rpc/claim_ezyvet_attachment_import", { p_id: child, p_actor: owner.id, p_site_uid: site, p_source_origin: origin, p_animal_link_id: mapping });
const attemptPage = await api.attempts(bound, null, 2);
check(attemptPage.events.length === 2 && attemptPage.has_more && attemptPage.events[0].kind === "claimed" && attemptPage.events[1].error_code === "UPSTREAM_TIMEOUT", "HTTP history retains failure after retry clears latest error");
const earlierAttempts = await api.attempts(bound, attemptPage.next_sequence, 2);
check(!earlierAttempts.has_more && earlierAttempts.events[1].history_origin === "run_created", "Sequence cursor reaches the actual tracking origin");
check(!JSON.stringify(attemptPage).includes(retry.lease_id) && !JSON.stringify(earlierAttempts).includes(firstLease), "History exposes no raw lease token");
const emptyItems = await api.items(saved, bound);
check(emptyItems.items.length === 0 && !emptyItems.has_more && !emptyItems.complete_coverage_verified, "Empty HTTP item list does not claim coverage");
const retryProgress = await api.progress(saved, bound);
check(retryProgress.attempt_history.claims === 2 && retryProgress.attempt_history.failed_pages === 1 && retryProgress.attempt_history.complete_since_run_creation, "Progress counts durable attempts independently from source observations");
await assert.rejects(() => otherApi.attempts(bound)); checks++;
await assert.rejects(() => request("/rest/v1/rpc/list_ezyvet_migration_attempt_events", { p_binding_id: bound.id }, other.auth)); checks++;
const observation = { external_id: "701", file_id: "42", metadata: { id: "701", file_id: "42", record_type: "Animal", record_id: "77", name: "Synthetic report", mime_type: "application/pdf", notes: null }, raw_record_sha256: "a".repeat(64), stable_metadata_sha256: "b".repeat(64), file_sha256: null };
await request("/rest/v1/rpc/stage_ezyvet_attachment_page", { p_run_id: child, p_actor: owner.id, p_lease_id: retry.lease_id, p_page: {
  contract_version: "ezyvet_animal_attachment_metadata_v1", parent: { record_type: "Animal", record_id: "77" }, page: 1, complete: true,
  pagination: { items_page: 1, items_page_total: 1, items_page_size: 10, items_total: 2 }, observations: [observation, { ...observation, raw_record_sha256: "c".repeat(64) }], page_sha256: "d".repeat(64) } });
const completedResume = await resumeApi.recover(resumeIdentity);
check(completedResume.status === "review_ready" && completedResume.blockers.some(b => b.includes("Traversal has ended")), "Actual completed run stays recoverable but cannot resume");
await assert.rejects(() => resumeApi.resume(completedResume)); checks++;
check(resumeInvocations === 0, "Blocked real runtime states never invoke the importer");
const firstItems = await api.items(saved, bound, null, 1);
const secondItems = await api.items(saved, bound, firstItems.next_cursor, 1);
check(firstItems.has_more && !secondItems.has_more && firstItems.items[0].ordinal === 1 && secondItems.items[0].ordinal === 2, "HTTP item cursor retains distinct duplicate occurrences");
check(firstItems.items[0].snapshot_id === secondItems.items[0].snapshot_id && firstItems.items[0].evidence_hash !== secondItems.items[0].evidence_hash, "HTTP hashes distinguish occurrence evidence from deduplicated snapshots");
check(firstItems.mapping_source_current && firstItems.items[0].exact_source_current && !firstItems.review_reconciled, "HTTP source currentness is separate from clinical review");
await assert.rejects(() => request("/rest/v1/rpc/list_ezyvet_migration_items", { p_binding_id: bound.id }, other.auth)); checks++;
const captureApi = createMigrationCaptureApi(ownerTransport, owner.id), captureItem = firstItems.items[0];
check((await captureApi.list(bound, captureItem)).captures.length === 0, "Uncaptured metadata has no fabricated capture receipt");
const captureId = randomUUID();
await staffRpc("prepare_ezyvet_attachment_capture", { p_id: captureId, p_animal_link_id: mapping, p_run_id: child, p_page: captureItem.page, p_ordinal: captureItem.ordinal, p_snapshot_id: captureItem.snapshot_id, p_observed_head_version: captureItem.observed_head_version, p_stable_metadata_sha256: captureItem.stable_metadata_sha256 });
const capturedEvidence = await captureApi.list(bound, captureItem);
check(capturedEvidence.captures.length === 1 && capturedEvidence.captures[0].request_id === captureId && capturedEvidence.captures[0].status === "prepared" && capturedEvidence.captures[0].capture === null, "Actual HTTP evidence distinguishes prepared capture from verified original");
check((await captureApi.list(bound, secondItems.items[0])).captures[0].relationship === "same_source_version", "Duplicate occurrence finds the same owned source-version request");
await assert.rejects(() => captureApi.list(bound, { ...captureItem, evidence_hash: "f".repeat(64) })); checks++;
await assert.rejects(() => request("/rest/v1/rpc/list_ezyvet_migration_capture_evidence", { p_binding_id: bound.id, p_page: captureItem.page, p_ordinal: captureItem.ordinal, p_snapshot_id: captureItem.snapshot_id, p_evidence_hash: captureItem.evidence_hash }, other.auth)); checks++;

for (let i = 0; i < 2; i++) await api.prepare({ ...manifestRequest, id: randomUUID(), scopes: manifestRequest.scopes.map(scope => ({ ...scope, id: randomUUID() })) });
const first = await api.list(null, 2);
check(first.runs.length === 2 && first.has_more && first.next_cursor, "HTTP history returns bounded first page");
const last = await api.list(first.next_cursor, 2);
check(last.runs.length === 2 && last.runs[0].id === manifestRequest.id && last.runs[1].id === historyManifest.run.id && !last.has_more && !last.next_cursor, "HTTP history cursor recovers original and earlier clinical request");
for (const auth of [owner.auth, headers(local.ANON_KEY), service]) {
  for (const table of ["ezyvet_migration_runs", "ezyvet_migration_scopes", "ezyvet_migration_bindings", "ezyvet_migration_attempt_events"]) {
    const response = await fetch(`${local.API_URL}/rest/v1/${table}?select=id`, { headers: auth });
    check(response.status === 401 || response.status === 403, "Private ledger table cannot be read over HTTP");
  }
}
for (const auth of [headers(local.ANON_KEY), service]) {
  await assert.rejects(() => request("/rest/v1/rpc/read_ezyvet_migration_run", { p_id: manifestRequest.id }, auth)); checks++;
  await assert.rejects(() => request("/rest/v1/rpc/bind_ezyvet_migration_child", { p_id: randomUUID(), p_scope_id: bindingRequest.scope_id, p_child_run_id: child, p_reason: "Unauthorized", p_replaces_id: null }, auth)); checks++;
  await assert.rejects(() => request("/rest/v1/rpc/list_ezyvet_migration_attempt_events", { p_binding_id: bound.id }, auth)); checks++;
  await assert.rejects(() => request("/rest/v1/rpc/list_ezyvet_migration_items", { p_binding_id: bound.id }, auth)); checks++;
}
// Vaccination review is separate from administration and uses exact Consult context.
const consultRun = randomUUID(), vaccineRun = randomUUID();
const consultClaim = await request("/rest/v1/rpc/claim_ezyvet_clinical_import", { p_id: consultRun, p_actor: owner.id, p_site_uid: site, p_resource: "consult", p_source_origin: origin, p_animal_link_id: mapping });
await request("/rest/v1/rpc/stage_ezyvet_import_page", { p_id: consultRun, p_actor: owner.id, p_lease_id: consultClaim.lease_id, p_page: 1, p_complete: true, p_items: [{ external_id: "801", payload: { id: 801, animal_id: 77 } }] });
const consultCandidate = (await staffRpc("list_ezyvet_clinical_candidates", { p_animal_link_id: mapping, p_resource: "consult" })).candidates[0];
const vaccineClaim = await request("/rest/v1/rpc/claim_ezyvet_vaccination_import", { p_id: vaccineRun, p_actor: owner.id, p_site_uid: site, p_resource: "vaccination", p_source_origin: origin, p_animal_link_id: mapping,
  p_consult_snapshot_id: consultCandidate.id, p_consult_payload_hash: consultCandidate.payload_hash, p_consult_observed_head_version: consultCandidate.observed_head_version });
await request("/rest/v1/rpc/stage_ezyvet_import_page", { p_id: vaccineRun, p_actor: owner.id, p_lease_id: vaccineClaim.lease_id, p_page: 1, p_complete: true, p_items: [{ external_id: "501", payload: { id: 501, consult_id: 801, product_id: null, date_of_administration: null, date_of_next_administration: "unknown" } }] });
const vaccineManifest = await api.prepare({ id: randomUUID(), source_origin: origin, source_site_uid: site, scopes: [{ id: randomUUID(), mapping_id: mapping, resource: "vaccination", parent_type: "consult", parent_snapshot_id: consultCandidate.id, parent_head_version: consultCandidate.observed_head_version, disposition: "required", reason: "Synthetic outside vaccination scope" }] });
const vaccineBinding = await api.bind({ id: randomUUID(), scope_id: vaccineManifest.scopes[0].id, child_run_id: vaccineRun, reason: "Synthetic consultation-bound vaccination", replaces_id: null });
const vaccineItems = await api.items(vaccineManifest, vaccineBinding);
const vaccineApi = createMigrationVaccinationApi(ownerTransport, owner.id);
check((await vaccineApi.list(vaccineBinding, vaccineItems.items[0])).approvals.length === 0, "Staged vaccination is not approved outside history over HTTP");
const vc = (await staffRpc("list_ezyvet_vaccination_candidates", { p_animal_link_id: mapping })).candidates[0];
const vaccineApproval = randomUUID();
const vaccinePayload = { animal_link_id: mapping, patient_version: 1, snapshot_id: vc.id, payload_hash: vc.payload_hash, observed_head_version: vc.observed_head_version,
  consult_snapshot_id: vc.consult_snapshot_id, consult_payload_hash: vc.consult_payload_hash, consult_observed_head_version: vc.consult_observed_head_version,
  product_id: null, product_version: null, administered_on: null, administration_date_status: "unknown", source_next_due_on: null, next_date_status: "uninterpreted", status: "unknown", outside_author: null,
  reason: "Synthetic explicit outside vaccination interpretation", replaces_id: null, expected_predecessor_hash: null };
await assert.rejects(() => staffRpc("prepare_ezyvet_vaccination_review", { p_id: vaccineApproval, p_pet_id: pet, p_payload: vaccinePayload })); checks++;
sql(`insert into user_roles(user_id,role) values(${quote(owner.id)},'DVM');`);
const vaccinePrepared = await staffRpc("prepare_ezyvet_vaccination_review", { p_id: vaccineApproval, p_pet_id: pet, p_payload: vaccinePayload });
check((await vaccineApi.list(vaccineBinding, vaccineItems.items[0])).approvals.length === 0, "Prepared veterinarian review is not an approval receipt");
await staffRpc("approve_ezyvet_vaccination_review", { p_id: vaccineApproval, p_pet_id: pet, p_expected_hash: vaccinePrepared.request.request_hash, p_confirmed: true });
const vaccineEvidence = await vaccineApi.list(vaccineBinding, vaccineItems.items[0]);
check(vaccineEvidence.approvals[0].id === vaccineApproval && vaccineEvidence.approvals[0].relationship === "exact_source_version" && vaccineEvidence.approvals[0].source_current, "Approved vaccination matches exact saved vaccination and consultation over HTTP");
check(vaccineEvidence.approvals[0].outside_status === "unknown" && !vaccineEvidence.local_administration_verified && !vaccineEvidence.due_plan_adoption_verified, "Unknown interpretation never establishes native administration or active due plan");
check((await vaccineApi.list(vaccineBinding, vaccineItems.items[0], 1)).approvals.length === 0, "Vaccination version cursor terminates over HTTP");
await assert.rejects(() => vaccineApi.list(vaccineBinding, { ...vaccineItems.items[0], evidence_hash: "f".repeat(64) })); checks++;
await assert.rejects(() => request("/rest/v1/rpc/list_ezyvet_migration_vaccination_evidence", { p_binding_id: vaccineBinding.id, p_page: 1, p_snapshot_id: vc.id, p_evidence_hash: vaccineItems.items[0].evidence_hash }, other.auth)); checks++;
sql(`update ezyvet_identity_heads set version=version+2 where source_site_uid=${quote(site)} and resource='consult' and external_id='801';`);
check(!(await vaccineApi.list(vaccineBinding, vaccineItems.items[0])).approvals[0].source_current, "Actual consultation source reversion invalidates vaccination context");

sql(`update ezyvet_identity_heads set version=version+1 where source_site_uid=${quote(site)} and resource='animal';`);
assert.deepEqual(await api.prepare(manifestRequest), saved); checks++;
assert.deepEqual(await api.bind(bindingRequest), bound); checks++;
check(!(await api.progress(saved, bound)).parent_current, "HTTP progress exposes source drift without changing saved digest");
const driftedItems = await api.items(saved, bound, null, 1);
check(!driftedItems.mapping_source_current && !driftedItems.parent_current && driftedItems.items[0].evidence_hash === firstItems.items[0].evidence_hash, "HTTP mapping drift preserves occurrence evidence hash");
await assert.rejects(() => api.prepare({ ...manifestRequest, id: randomUUID(), scopes: manifestRequest.scopes.map(scope => ({ ...scope, id: randomUUID() })) })); checks++;
assert.throws(() => parseMigrationManifest({ ...saved, run: { ...saved!.run, actor_id: other.id } }, owner.id, manifestRequest.id)); checks++;
assert.throws(() => parseMigrationManifest({ ...saved, scopes: [] }, owner.id, manifestRequest.id)); checks++;
assert.throws(() => parseMigrationBinding({ ...bound, child_run_id: randomUUID() }, owner.id, bindingRequest.scope_id)); checks++;
const corruptPage = createMigrationRunApi({ async rpc() { return { data: { runs: [first.runs[0], first.runs[0]], has_more: false }, error: null }; } }, owner.id);
await assert.rejects(() => corruptPage.list(), /cursor differs/); checks++;
sql(`update profiles set is_active=false where id=${quote(owner.id)};`);
await assert.rejects(() => api.read(manifestRequest.id)); checks++;
await assert.rejects(() => api.list()); checks++;
await assert.rejects(() => api.bind(bindingRequest)); checks++;
await assert.rejects(() => api.readBinding(bindingRequest.id, bindingRequest.scope_id)); checks++;
await assert.rejects(() => api.listBindings(bindingRequest.scope_id)); checks++;
await assert.rejects(() => api.progress(saved, bound)); checks++;
await assert.rejects(() => api.attempts(bound)); checks++;
await assert.rejects(() => api.items(saved, bound)); checks++;
await assert.rejects(() => captureApi.list(bound, captureItem)); checks++;
await assert.rejects(() => vaccineApi.list(vaccineBinding, vaccineItems.items[0])); checks++;
check(effects() === beforeEffects, "Migration operations cause no native treatment, vaccine certificate, due-plan, reminder, invoice, stock, Storage or delivery mutations");
console.log(`Migration manifest HTTP/Auth/PostgREST: ${checks} checks passed. Synthetic upstream only; no ezyVet requests.`);
