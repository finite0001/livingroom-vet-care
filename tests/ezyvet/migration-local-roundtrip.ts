import { createMigrationWeightApi } from "../../src/hub/features/imports/migration-weight-api.ts";
import { createMigrationIdentityApi } from "../../src/hub/features/imports/migration-identity-api.ts";
import { createMigrationPrescriptionItemApi } from "../../src/hub/features/imports/migration-prescription-item-api.ts";
import { createMigrationPrescriptionApi } from "../../src/hub/features/imports/migration-prescription-api.ts";
import { createMigrationVaccinationApi } from "../../src/hub/features/imports/migration-vaccination-api.ts";
import { createMigrationHistoryApi } from "../../src/hub/features/imports/migration-history-api.ts";
import { createMigrationResumeApi } from "../../src/hub/features/imports/migration-resume-api.ts";
import { createClient } from "@supabase/supabase-js";
import { createMigrationSelectionApi } from "../../src/hub/features/imports/migration-selection-api.ts";
/** Actual local Auth/PostgREST acceptance; no provider or outbound delivery. */
import assert from "node:assert/strict";
import { createMigrationCaptureApi } from "../../src/hub/features/imports/migration-capture-api.ts";
import { execFileSync, spawn } from "node:child_process";
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
let operation = "setup";
process.on("uncaughtExceptionMonitor", (error: unknown) => {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "none";
  const sqlstate = /^[A-Z0-9]{5}$/.test(code) ? code : "none";
  // Only fixed operation names, aggregate counts and SQLSTATE may reach CI output.
  console.error(`LRV_MIGRATION_FAILURE checks=${checks} operation=${operation} sqlstate=${sqlstate}`);
});
const check = (value: unknown, message: string) => { assert.ok(value, message); checks++; };
async function request(path: string, body: unknown, auth = service) {
  operation = path.match(/^\/rest\/v1\/rpc\/([a-z_]+)$/)?.[1] ?? "auth";
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
// A different patient's historical mapping must not block valid new choices.
// Keep the mapping immutable, matching the persisted drift in the originals fixture.
const movedClient = (await staffRpc("save_client", { p_actor_id: owner.id, p_client_id: null, p_expected_version: null, p_first_name: "Synthetic", p_last_name: "Other household", p_primary_phone: null, p_primary_email: null, p_preferred_channel: "EMAIL", p_mailing_address: null, p_housecall_address: null })).id;
const movedPet = (await staffRpc("save_patient", { p_id: null, p_client_id: client, p_expected_version: null, p_name: "Synthetic moved migration patient", p_species: "Dog", p_breed: null, p_dob: null, p_birth_date_precision: "unknown", p_color: null, p_sex: "unknown", p_neuter_status: "unknown", p_microchip_id: null, p_archived_at: null, p_deceased_at: null })).id;
const movedMapping = randomUUID(), movedSnapshot = randomUUID();
sql(`insert into ezyvet_import_snapshots(id,source_origin,source_site_uid,resource,external_id,payload,payload_hash,first_seen_by)
 values(${quote(movedSnapshot)},${quote(origin)},${quote(site)},'animal','78','{"id":78}',encode(sha256(convert_to('{"id":78}','UTF8')),'hex'),${quote(owner.id)});
 insert into ezyvet_record_links(id,request_id,request_hash,source_origin,source_site_uid,resource,external_id,snapshot_id,head_version,client_id,pet_id,local_version,action,reason,approved_by)
 values(${quote(movedMapping)},${quote(movedMapping)},'synthetic-moved-review',${quote(origin)},${quote(site)},'animal','78',${quote(movedSnapshot)},1,${quote(client)},${quote(movedPet)},1,'link','SYNTHETIC HISTORICAL MAPPING',${quote(owner.id)});
 begin; alter table pets disable trigger pets_version; update pets set client_id=${quote(movedClient)} where id=${quote(movedPet)}; alter table pets enable trigger pets_version; commit;`);
operation = "mapping_selection";
const selector = createMigrationSelectionApi(createClient(local.API_URL, local.ANON_KEY, { global: { headers: owner.auth }, auth: { persistSession: false, autoRefreshToken: false } }), owner.id);
let mappingPage = 0, mapped = await selector.mappings();
while (!mapped.rows.some(m => m.id === mapping) && mapped.has_more && mappingPage < 20) mapped = await selector.mappings(++mappingPage);
const selectedMapping = mapped.rows.find(m => m.id === mapping);
check(selectedMapping?.patient_name === "Synthetic migration patient" && selectedMapping?.household_name === "Synthetic Migration", "Real RLS mapping selector resolves exact patient and household names");
let choicePage = await selector.mappings(), choicePageNumber = 0, unavailable = choicePage.unavailable_count;
const visibleMappingIds = choicePage.rows.map(row => row.id);
while (choicePage.has_more && choicePageNumber < 20) {
  choicePage = await selector.mappings(++choicePageNumber);
  unavailable += choicePage.unavailable_count;
  visibleMappingIds.push(...choicePage.rows.map(row => row.id));
}
check(!choicePage.has_more && unavailable >= 1 && !visibleMappingIds.includes(movedMapping) && visibleMappingIds.includes(mapping), "Actual historical household drift is excluded without hiding unrelated valid choices across pages");
check(sql(`select client_id=${quote(client)}::uuid and pet_id=${quote(movedPet)}::uuid from ezyvet_record_links where id=${quote(movedMapping)};`) === "t", "Mapping discovery preserves immutable historical household evidence");
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

// Outside prescription header receipts expose partial evidence without local prescribing.
const prescriptionRun = randomUUID(), itemRun = randomUUID(), prescriptionApproval = randomUUID();
const prescriptionClaim = await request("/rest/v1/rpc/claim_ezyvet_prescription_import", { p_id: prescriptionRun, p_actor: owner.id, p_site_uid: site, p_resource: "prescription", p_source_origin: origin, p_animal_link_id: mapping });
await request("/rest/v1/rpc/stage_ezyvet_import_page", { p_id: prescriptionRun, p_actor: owner.id, p_lease_id: prescriptionClaim.lease_id, p_page: 1, p_complete: true, p_items: [{ external_id: "901", payload: { id: 901, animal_id: 77, prescription_item_list: [902, 903, 903] } }] });
const pc = (await staffRpc("list_ezyvet_prescription_candidates", { p_animal_link_id: mapping, p_resource: "prescription" })).candidates[0];
const itemClaim = await request("/rest/v1/rpc/claim_ezyvet_prescriptionitem_import", { p_id: itemRun, p_actor: owner.id, p_site_uid: site, p_resource: "prescriptionitem", p_source_origin: origin, p_animal_link_id: mapping,
  p_prescription_snapshot_id: pc.id, p_prescription_payload_hash: pc.payload_hash, p_prescription_observed_head_version: pc.observed_head_version });
await request("/rest/v1/rpc/stage_ezyvet_import_page", { p_id: itemRun, p_actor: owner.id, p_lease_id: itemClaim.lease_id, p_page: 1, p_complete: true, p_items: [{ external_id: "902", payload: { id: 902, prescription_id: 901 } }] });
const prescriptionManifest = await api.prepare({ id: randomUUID(), source_origin: origin, source_site_uid: site, scopes: [{ id: randomUUID(), mapping_id: mapping, resource: "prescription", parent_type: "animal", parent_snapshot_id: snapshot, parent_head_version: 1, disposition: "required", reason: "Synthetic outside prescription scope" }] });
const prescriptionBinding = await api.bind({ id: randomUUID(), scope_id: prescriptionManifest.scopes[0].id, child_run_id: prescriptionRun, reason: "Synthetic prescription header evidence", replaces_id: null });
const prescriptionItems = await api.items(prescriptionManifest, prescriptionBinding);
const prescriptionApi = createMigrationPrescriptionApi(ownerTransport, owner.id);
check((await prescriptionApi.list(prescriptionBinding, prescriptionItems.items[0])).approvals.length === 0, "Staged prescription header is not approval over HTTP");
const medicationManifest = await api.prepare({ id: randomUUID(), source_origin: origin, source_site_uid: site, scopes: [{ id: randomUUID(), mapping_id: mapping, resource: "prescriptionitem", parent_type: "prescription", parent_snapshot_id: pc.id, parent_head_version: pc.observed_head_version, disposition: "required", reason: "Synthetic medication item scope" }] });
const medicationBinding = await api.bind({ id: randomUUID(), scope_id: medicationManifest.scopes[0].id, child_run_id: itemRun, reason: "Synthetic item evidence", replaces_id: null });
const medicationItem = (await api.items(medicationManifest, medicationBinding)).items[0];
const medicationApi = createMigrationPrescriptionItemApi(ownerTransport, owner.id);
check((await medicationApi.list(medicationBinding, medicationItem)).approvals.length === 0, "Staged item is not approved over HTTP");
const prescriptionPayload = { item_run_id: itemRun, patient_version: 1, interpretation: { reason: "Synthetic outside history review", outside_author: null, prescribed_on: null, prescription_date_status: "unknown", status: "unknown", completeness: "partial", partial_reason: "Source item references incomplete; observed item not selected", items: [], replaces_id: null, expected_predecessor_hash: null } };
const prescriptionPrepared = await staffRpc("prepare_ezyvet_prescription_review", { p_id: prescriptionApproval, p_pet_id: pet, p_payload: prescriptionPayload });
check((await prescriptionApi.list(prescriptionBinding, prescriptionItems.items[0])).approvals.length === 0, "Prepared prescription is not approved over HTTP");
check((await medicationApi.list(medicationBinding, medicationItem)).approvals.length === 0, "Prepared item is not approved over HTTP");
await staffRpc("approve_ezyvet_prescription_review", { p_id: prescriptionApproval, p_pet_id: pet, p_expected_hash: prescriptionPrepared.request.request_hash, p_confirmed: true });
const prescriptionEvidence = await prescriptionApi.list(prescriptionBinding, prescriptionItems.items[0]);
const pr = prescriptionEvidence.approvals[0];
check(pr.id === prescriptionApproval && pr.relationship === "exact_source_version" && pr.source_current, "Approved prescription matches exact observed header over HTTP");
check(pr.completeness === "partial" && pr.selected_items === 0 && pr.omitted_items === 1, "Partial approval preserves omitted observation count over HTTP");
check(pr.expected_items === 2 && pr.observed_items === 1 && pr.missing_items === 1 && pr.duplicate_source_ids === 1 && pr.reference_status === "unresolved", "Missing and duplicate source references survive approved receipt projection");
check(!prescriptionEvidence.local_prescribing_verified && !prescriptionEvidence.item_coverage_verified && !prescriptionEvidence.complete_coverage_verified, "Outside prescription does not infer local prescribing or item coverage");
check((await prescriptionApi.list(prescriptionBinding, prescriptionItems.items[0], 1)).approvals.length === 0, "Prescription version cursor terminates over HTTP");
await assert.rejects(() => prescriptionApi.list(prescriptionBinding, { ...prescriptionItems.items[0], evidence_hash: "f".repeat(64) })); checks++;
await assert.rejects(() => request("/rest/v1/rpc/list_ezyvet_migration_prescription_evidence", { p_binding_id: prescriptionBinding.id, p_page: 1, p_snapshot_id: pc.id, p_evidence_hash: prescriptionItems.items[0].evidence_hash }, other.auth)); checks++;
const omittedMedication = (await medicationApi.list(medicationBinding, medicationItem)).approvals[0];
check(omittedMedication.disposition === "omitted" && omittedMedication.catalog_matched === null && omittedMedication.start_date_status === null, "Omission does not infer interpretation or catalog match over HTTP");
check(omittedMedication.parent_matches && omittedMedication.exact_occurrence && omittedMedication.matching_source_observations === 1, "Exact item parent and occurrence survive HTTP serialization");
const medicationCorrection = randomUUID();
const medicationPayload = { ...prescriptionPayload, interpretation: { ...prescriptionPayload.interpretation, reason: "Reviewed selection correction", replaces_id: prescriptionApproval, expected_predecessor_hash: pr.version_hash, items: [{ snapshot_id: medicationItem.snapshot_id, start_on: null, start_date_status: "uninterpreted", product_id: null, product_version: null, note: null }] } };
const medicationPrepared = await staffRpc("prepare_ezyvet_prescription_review", { p_id: medicationCorrection, p_pet_id: pet, p_payload: medicationPayload });
await staffRpc("approve_ezyvet_prescription_review", { p_id: medicationCorrection, p_pet_id: pet, p_expected_hash: medicationPrepared.request.request_hash, p_confirmed: true });
const selectedMedication = await medicationApi.list(medicationBinding, medicationItem, null, 1);
check(selectedMedication.approvals[0].disposition === "selected" && selectedMedication.approvals[0].start_date_status === "uninterpreted" && selectedMedication.approvals[0].catalog_matched === false, "Uninterpreted date and unmatched catalog survive actual API validation");
check(selectedMedication.has_more && selectedMedication.next_before_version === 2, "Item version pagination exposes predecessor over HTTP");
const olderMedication = await medicationApi.list(medicationBinding, medicationItem, 2, 1);
check(olderMedication.approvals[0].disposition === "omitted" && olderMedication.approvals[0].superseded && !olderMedication.has_more, "Omission history retained after selection correction");
await assert.rejects(() => medicationApi.list(medicationBinding, { ...medicationItem, evidence_hash: "f".repeat(64) })); checks++;
await assert.rejects(() => request("/rest/v1/rpc/list_ezyvet_migration_prescription_item_evidence", { p_binding_id: medicationBinding.id, p_page: medicationItem.page, p_snapshot_id: medicationItem.snapshot_id, p_evidence_hash: medicationItem.evidence_hash }, other.auth)); checks++;
sql(`update ezyvet_identity_heads set version=version+2 where source_site_uid=${quote(site)} and resource='prescriptionitem' and external_id='902';`);
check(!(await prescriptionApi.list(prescriptionBinding, prescriptionItems.items[0])).approvals[0].source_current, "Omitted item source reversion invalidates prescription context over HTTP");
check(!(await medicationApi.list(medicationBinding, medicationItem)).approvals[0].source_current, "Item source reversion invalidates item receipt context over HTTP");

const weightRun = randomUUID();
const weightClaim = await request("/rest/v1/rpc/claim_ezyvet_weight_import", { p_id: weightRun, p_actor: owner.id, p_site_uid: site, p_source_origin: origin, p_animal_link_id: mapping });
await request("/rest/v1/rpc/stage_ezyvet_import_page", { p_id: weightRun, p_actor: owner.id, p_lease_id: weightClaim.lease_id, p_page: 1, p_complete: true, p_items: [{external_id:"1001",payload:{id:1001,animal_id:77,active:true,weight:12.3,weight_unit:"kg"}}] });
const weightManifest = await api.prepare({id:randomUUID(),source_origin:origin,source_site_uid:site,scopes:[{id:randomUUID(),mapping_id:mapping,resource:"healthstatus",parent_type:"animal",parent_snapshot_id:snapshot,parent_head_version:1,disposition:"required",reason:"Synthetic weight reconciliation"}]});
const weightBinding = await api.bind({id:randomUUID(),scope_id:weightManifest.scopes[0].id,child_run_id:weightRun,reason:"Synthetic weight source",replaces_id:null});
const weightItem = (await api.items(weightManifest,weightBinding)).items[0];
const weightApi = createMigrationWeightApi(ownerTransport,owner.id);
check((await weightApi.read(weightBinding,weightItem)).approval===null,"Unapproved weight remains unapproved through actual HTTP");
const weightRequest=randomUUID();
const weightPayload={snapshot_id:weightItem.snapshot_id,expected_hash:weightItem.payload_hash,head_version:1,animal_link_id:mapping,patient_version:Number(sql(`select version from pets where id=${quote(pet)}`)),action:"create",weight_id:null,weight:12.3,unit:"kg",measured_at:"2026-09-01",reason:"Synthetic reviewed historical weight"};
await staffRpc("prepare_ezyvet_weight_request",{p_request_id:weightRequest,p_snapshot_id:weightItem.snapshot_id,p_payload:weightPayload});
const approvedWeight=await staffRpc("approve_ezyvet_weight",{p_request_id:weightRequest,p_actor_id:owner.id,p_confirmed:true,...Object.fromEntries(Object.entries(weightPayload).map(([k,v])=>["p_"+k,v]))});
const weightEvidence=await weightApi.read(weightBinding,weightItem);
check(weightEvidence.approval?.id===weightRequest && weightEvidence.approval.weight_id===approvedWeight.weight_id,"HTTP approval references exact created local weight");
check(weightEvidence.approval.local_weight_matches_review && !weightEvidence.exact_source_version_verified,"Local match never invents observed version");
sql(`update ezyvet_identity_heads set version=version+1 where source_site_uid=${quote(site)} and resource='healthstatus' and external_id='1001'`);
await staffRpc("review_ezyvet_weight_change",{p_request_id:randomUUID(),p_approval_id:weightRequest,p_snapshot_id:weightItem.snapshot_id,p_head_version:2,p_reason:"Synthetic source recurrence acknowledgment"});
const acknowledgedWeight=await weightApi.read(weightBinding,weightItem);
check(!acknowledgedWeight.approval?.source_current && acknowledgedWeight.source_reviews[0].source_current,"HTTP source acknowledgment is distinct from stale original approval");
check(!acknowledgedWeight.source_reviews[0].promotes_local_weight && acknowledgedWeight.approval?.weight_id===approvedWeight.weight_id,"Acknowledgment does not replace approved weight");
await assert.rejects(()=>weightApi.read(weightBinding,{...weightItem,evidence_hash:"f".repeat(64)}));checks++;
await assert.rejects(()=>request("/rest/v1/rpc/read_ezyvet_migration_weight_evidence",{p_binding_id:weightBinding.id,p_page:weightItem.page,p_snapshot_id:weightItem.snapshot_id,p_evidence_hash:weightItem.evidence_hash},other.auth));checks++;
const identityManifest = await api.prepare({ id: randomUUID(), source_origin: origin, source_site_uid: site, scopes: [{ id: randomUUID(), mapping_id: mapping, resource: "animal", parent_type: "animal", parent_snapshot_id: snapshot, parent_head_version: 1, disposition: "required", reason: "Synthetic identity scope" }] });
const identityBinding = await api.bind({ id: randomUUID(), scope_id: identityManifest.scopes[0].id, child_run_id: animalRun, reason: "Selected identity in generic run", replaces_id: null });
const identityItem = (await api.items(identityManifest, identityBinding)).items[0];
const identityApi = createMigrationIdentityApi(ownerTransport, owner.id);
const identityEvidence = await identityApi.read(identityBinding, identityItem);
check(identityEvidence.approval.id === mapping && identityEvidence.approval.action === "link", "Exact approved identity mapping through HTTP");
check(identityEvidence.approval.relationship === "same_snapshot_unknown_observed_head" && !identityEvidence.observation_head_available && !identityEvidence.exact_source_version_verified, "Actual legacy identity cannot claim observed head version");
check(identityEvidence.approval.source_current && identityEvidence.approval.local_record_unchanged && identityEvidence.approval.household_current, "Initial identity currentness facts remain separate");
await assert.rejects(() => identityApi.read(identityBinding, { ...identityItem, evidence_hash: "f".repeat(64) })); checks++;
await assert.rejects(() => request("/rest/v1/rpc/read_ezyvet_migration_identity_evidence", { p_binding_id: identityBinding.id, p_page: 1, p_snapshot_id: identityItem.snapshot_id, p_evidence_hash: identityItem.evidence_hash }, other.auth)); checks++;
// Internal summary helpers are deliberately not exposed over HTTP. Exercise them
// with explicit authenticated actor claims after the canonical HTTP approvals.
const standardReceipts = (manifest: string) => JSON.parse(sql(`select set_config('request.jwt.claims',${quote(JSON.stringify({sub:owner.id,role:"authenticated"}))},false); select coalesce(jsonb_agg(to_jsonb(t)),'[]') from ezyvet_migration_terminal_standard_receipts(${quote(manifest)}) t;`).split("\n").at(-1)!);
const historySummary=standardReceipts(historyManifest.run.id);
check(historySummary.some(r=>r.receipt_id===historyApproval && r.relationship==="exact_source_version" && !r.source_current),"Internal history receipt retains exact observation despite later source drift");
const vaccineSummary=standardReceipts(vaccineManifest.run.id);
check(vaccineSummary.some(r=>r.receipt_id===vaccineApproval && r.native_id===null && !r.source_current),"Vaccination summary does not infer native administration");
const prescriptionSummary=standardReceipts(prescriptionManifest.run.id);
check(prescriptionSummary.some(r=>r.receipt_id===prescriptionApproval && r.superseded) && prescriptionSummary.some(r=>r.receipt_id===medicationCorrection && !r.superseded),"Prescription summary preserves corrections and predecessor independently");
check(prescriptionSummary.every(r=>r.native_id===null),"Outside prescription approvals cannot count as native prescriptions");
const contextReceipts = (manifest: string) => JSON.parse(sql(`select set_config('request.jwt.claims',${quote(JSON.stringify({sub:owner.id,role:"authenticated"}))},false); select coalesce(jsonb_agg(to_jsonb(t)),'[]') from ezyvet_migration_terminal_context_receipts(${quote(manifest)}) t;`).split("\n").at(-1)!);
const itemSummary=contextReceipts(medicationManifest.run.id);
check(itemSummary.some(r=>r.receipt_id===prescriptionApproval && r.facets.disposition==="omitted" && r.facets.superseded),"Item summary retains omitted predecessor");
check(itemSummary.some(r=>r.receipt_id===medicationCorrection && r.facets.disposition==="selected" && r.facets.parent_matches),"Item summary matches selected correction and exact parent");
check(itemSummary.every(r=>r.facets.native_prescribing===false),"Item selection adds no native prescribing credit");
const attachmentSummary=contextReceipts(saved.run.id);
check(attachmentSummary.some(r=>r.receipt_id===captureId && r.receipt_kind==="attachment_capture_request" && r.facets.status==="prepared"),"Prepared capture remains a request in global evidence");
check(!attachmentSummary.some(r=>r.receipt_kind==="attachment_captured_bytes" || r.receipt_kind==="attachment_original_approval"),"Pending capture adds neither byte nor approval credit");
const reviewTotals = (manifest: string) => JSON.parse(sql(`select set_config('request.jwt.claims',${quote(JSON.stringify({sub:owner.id,role:"authenticated"}))},false); select ezyvet_migration_review_totals(${quote(manifest)});`).split("\n").at(-1)!);
const pendingAttachmentReview = reviewTotals(saved.run.id).resources[0];
check(pendingAttachmentReview.observed_occurrences===2 && pendingAttachmentReview.occurrences_without_approval===2,"Prepared capture does not hide unapproved observations");
const weightReviewTotals = reviewTotals(weightManifest.run.id).resources[0];
check(weightReviewTotals.occurrences_without_approval===0 && weightReviewTotals.occurrences_with_snapshot_only_approval===1 && weightReviewTotals.occurrences_with_exact_approval===0,"Weight snapshot match stays distinct from exact observed-version approval");
check(weightReviewTotals.occurrences_with_current_latest_exact_approval===0,"Current source acknowledgment cannot upgrade stale weight approval");
const historyReviewTotals = reviewTotals(historyManifest.run.id).resources[0];
check(historyReviewTotals.occurrences_with_exact_approval===1 && historyReviewTotals.occurrences_with_current_latest_exact_approval===0,"Historical exact approval remains visible after source drift without current credit");
const itemReviewTotals = reviewTotals(medicationManifest.run.id).resources[0];
check(itemReviewTotals.observed_occurrences===1 && itemReviewTotals.occurrences_with_exact_approval===1,"Multiple prescription revisions do not multiply reviewed item observations");
const consultManifest = await api.prepare({id:randomUUID(),source_origin:origin,source_site_uid:site,scopes:[{...historyManifest.run.intent.scopes[0],id:randomUUID(),resource:"consult"}]});
const consultReviewTotals = reviewTotals(consultManifest.run.id).resources[0];
check(consultReviewTotals.approval_applicability==="not_applicable" && consultReviewTotals.occurrences_without_approval===null,"Unbound consultation scope never fabricates pending standalone approvals");
// Bind the same source runs into one mixed manifest to exercise global deduplication.
const combinedManifest = await api.prepare({ id: randomUUID(), source_origin: origin, source_site_uid: site, scopes: [
  { ...prescriptionManifest.run.intent.scopes[0], id: randomUUID() },
  { ...medicationManifest.run.intent.scopes[0], id: randomUUID() },
] });
for (const scope of combinedManifest.scopes) {
  await api.bind({ id: randomUUID(), scope_id: scope.id, child_run_id: scope.resource === "prescription" ? prescriptionRun : itemRun, reason: "Synthetic combined header and item coverage", replaces_id: null });
}
const outcomeTotals = (manifest: string, actor = owner.id) => JSON.parse(sql(`select set_config('request.jwt.claims',${quote(JSON.stringify({sub:actor,role:"authenticated"}))},false); select coalesce(ezyvet_migration_outcome_totals(${quote(manifest)}),'null'::jsonb);`).split("\n").at(-1)!);
const combinedTotals = outcomeTotals(combinedManifest.run.id);
check(combinedTotals.receipts.imported_prescription.versions === 2, "Header and item share two approval revisions, not four");
check(combinedTotals.receipts.imported_prescription.latest_versions === 1, "Combined summary retains one latest prescription revision");
check(combinedTotals.receipts.imported_prescription.source_stale_versions === 2, "Item drift invalidates both shared prescription revisions");
check(combinedTotals.prescription_item_relations.omitted === 1 && combinedTotals.prescription_item_relations.selected === 1, "Combined summary distinguishes predecessor omission from corrected selection");
check(Object.keys(combinedTotals.native_outcomes).length === 0, "Mixed prescription summary creates no native prescribing credit");
check(outcomeTotals(combinedManifest.run.id, other.id) === null, "Other administrator cannot aggregate an owned manifest");
const prescriptionGaps=combinedTotals.prescription_review_gaps;
check(prescriptionGaps.reviewed_versions===2 && prescriptionGaps.partial_versions===2 && prescriptionGaps.latest_partial_versions===1,"Partial approved revisions remain visible without header/item duplication");
check(prescriptionGaps.missing_item_versions===2 && prescriptionGaps.unresolved_reference_versions===2,"Approvals retain missing-item and unresolved-source gaps");
check(prescriptionGaps.duplicate_source_reference_versions===2 && prescriptionGaps.duplicate_observation_versions===0,"Duplicate provider references remain distinct from repeated observations");
check(prescriptionGaps.unknown_date_versions===2 && prescriptionGaps.unknown_status_versions===2,"Outside prescription interpretation uncertainties remain visible");
check(prescriptionGaps.unfinished_scan_versions===0 && prescriptionGaps.absent_source_list_versions===0,"Finished traversal with a source list does not erase missing references");
check(!JSON.stringify(prescriptionGaps).includes("Synthetic") && !JSON.stringify(prescriptionGaps).includes("partial_reason"),"Reference gap summary omits clinical prose and reasons");

function preparedVersioned(manifest:string,binding:string) {
  const preparation=randomUUID();
  const claims=quote(JSON.stringify({sub:owner.id,role:"authenticated"}));
  sql(`select set_config('request.jwt.claims',${claims},false); select prepare_ezyvet_migration_projection(${quote(preparation)},${quote(manifest)}); select prepare_ezyvet_migration_source_chunk(${quote(preparation)},${quote(binding)},1);`);
  return (before:number|null=null)=>JSON.parse(sql(`select set_config('request.jwt.claims',${claims},false); select read_ezyvet_migration_prepared_versioned_evidence(${quote(preparation)},${quote(binding)},1,1,${before===null?'null':before},1);`).split("\n").at(-1)!);
}
const preparedVaccine=preparedVersioned(vaccineManifest.run.id,vaccineBinding.id)();
assert.deepEqual(preparedVaccine.approvals,(await vaccineApi.list(vaccineBinding,vaccineItems.items[0],null,1)).approvals);checks++;
check(!preparedVaccine.local_administration_verified && !preparedVaccine.approvals[0].source_current,"Prepared vaccination preserves source drift without native administration credit");
const preparedPrescriptionRead=preparedVersioned(prescriptionManifest.run.id,prescriptionBinding.id);
const preparedPrescription=preparedPrescriptionRead();
assert.deepEqual(preparedPrescription.approvals,(await prescriptionApi.list(prescriptionBinding,prescriptionItems.items[0],null,1)).approvals);checks++;
check(preparedPrescription.approvals[0].missing_items===1 && preparedPrescription.approvals[0].completeness==="partial","Prepared prescription retains missing references and partial approval");
check(preparedPrescriptionRead(2).approvals[0].id===prescriptionApproval && !preparedPrescription.local_prescribing_verified,"Prepared prescription cursor preserves predecessor without local prescribing");
const preparedMedicationRead=preparedVersioned(medicationManifest.run.id,medicationBinding.id);
assert.deepEqual(preparedMedicationRead().approvals,(await medicationApi.list(medicationBinding,medicationItem,null,1)).approvals);checks++;
check(preparedMedicationRead().approvals[0].disposition==="selected" && preparedMedicationRead(2).approvals[0].disposition==="omitted","Prepared item reader preserves corrected selection and prior omission");
check(!preparedMedicationRead().dependency_consistency_verified && !preparedMedicationRead().report_ready,"Versioned preparation adapter does not claim assembled consistent report");
function preparedSupplement(manifest:string,binding:string,kind:"identity"|"timed") {
  const preparation=randomUUID();
  const claims=quote(JSON.stringify({sub:owner.id,role:"authenticated"}));
  sql(`select set_config('request.jwt.claims',${claims},false); select prepare_ezyvet_migration_projection(${quote(preparation)},${quote(manifest)}); select prepare_ezyvet_migration_source_chunk(${quote(preparation)},${quote(binding)},1);`);
  const result=JSON.parse(sql(`select set_config('request.jwt.claims',${claims},false); select read_ezyvet_migration_prepared_${kind}_evidence(${quote(preparation)},${quote(binding)},1,1);`).split("\n").at(-1)!);
  return result;
}
const preparedIdentity=preparedSupplement(identityManifest.run.id,identityBinding.id,"identity");
assert.deepEqual(preparedIdentity.approval,(await identityApi.read(identityBinding,identityItem)).approval);checks++;
check(!preparedIdentity.exact_source_version_verified && !preparedIdentity.report_ready,"Prepared identity preserves unknown observed version and incomplete report");
const preparedWeight=preparedSupplement(weightManifest.run.id,weightBinding.id,"timed");
assert.deepEqual(preparedWeight.approval,(await weightApi.read(weightBinding,weightItem)).approval);checks++;
assert.deepEqual(preparedWeight.source_reviews,(await weightApi.read(weightBinding,weightItem)).source_reviews);checks++;
check(!preparedWeight.dependency_consistency_verified && !preparedWeight.report_ready,"Weight approval does not establish cross-chunk consistency");
const preparedCapture=preparedSupplement(saved.run.id,bound.id,"timed");
assert.deepEqual(preparedCapture.captures,(await captureApi.list(bound,captureItem)).captures);checks++;
check(preparedCapture.captures[0].status==="prepared" && preparedCapture.captures[0].capture===null,"Prepared capture request cannot become an approved original");
for (const [manifest,binding,kind,before] of [
  [identityManifest.run.id,identityBinding.id,"identity",null],
  [weightManifest.run.id,weightBinding.id,"timed",null],
  [saved.run.id,bound.id,"timed",null],
  [historyManifest.run.id,historyBinding.id,"versioned",null],
  [vaccineManifest.run.id,vaccineBinding.id,"versioned",null],
  [prescriptionManifest.run.id,prescriptionBinding.id,"versioned",2],
  [medicationManifest.run.id,medicationBinding.id,"versioned",2],
] as const) {
  const preparation=randomUUID(),pageId=randomUUID();
  const claims=quote(JSON.stringify({sub:owner.id,role:"authenticated"}));
  sql(`select set_config('request.jwt.claims',${claims},false); select prepare_ezyvet_migration_projection(${quote(preparation)},${quote(manifest)}); select prepare_ezyvet_migration_source_chunk(${quote(preparation)},${quote(binding)},1);`);
  const args=`${quote(preparation)},${quote(binding)},1,1`;
  const readArgs=kind==="versioned"?`${args},${before===null?'null':before},20`:args;
  const direct=JSON.parse(sql(`select set_config('request.jwt.claims',${claims},false); select read_ezyvet_migration_prepared_${kind}_evidence(${readArgs});`).split("\n").at(-1)!);
  const command=`select set_config('request.jwt.claims',${claims},false); select prepare_ezyvet_migration_review_page(${quote(pageId)},${args},${quote(kind)},${before===null?'null':before});`;
  const persisted=JSON.parse(sql(command).split("\n").at(-1)!);
  const replay=JSON.parse(sql(command).split("\n").at(-1)!);
  assert.deepEqual(replay,persisted);checks++;
  assert.deepEqual(persisted.input_cursor,before===null?{}:{before_version:before});checks++;
  check(persisted.has_more===Boolean(direct.has_more) && (persisted.continuation_cursor!==null)===persisted.has_more,"Saved page retains continuation state");
  delete direct.observed_at;
  const evidence={...persisted.evidence};delete evidence.observed_at;
  assert.deepEqual(evidence,direct);checks++;
  if (before===null) {
    const linkId=randomUUID();
    sql(`select set_config('request.jwt.claims',${claims},false); select append_ezyvet_migration_review_chain(${quote(linkId)},${quote(pageId)}); select aggregate_ezyvet_migration_native_page(${quote(linkId)}); select aggregate_ezyvet_migration_native_page(${quote(linkId)});`);
    const count=Number(sql(`select coalesce(sum(records),0) from ezyvet_migration_native_counts where preparation_id=${quote(preparation)} and metric='records';`));
    check(count===(kind==="identity" || binding===weightBinding.id?1:0),"Native aggregation respects resource approval boundaries and retries");
    if (binding!==bound.id) {
      check(!persisted.has_more,"Coverage comparison consumes complete review fixture");
      sql(`select set_config('request.jwt.claims',${claims},false); select aggregate_ezyvet_migration_source_chunk(${quote(preparation)},${quote(binding)},1); select aggregate_ezyvet_migration_approval_page(${quote(linkId)}); select aggregate_ezyvet_migration_approval_page(${quote(linkId)});`);
      for (const expected of reviewTotals(manifest).resources) {
        const actual=JSON.parse(sql(`select coalesce(jsonb_object_agg(metric,records),'{}'::jsonb) from ezyvet_migration_coverage_counts where preparation_id=${quote(preparation)} and resource=${quote(expected.resource)};`));
        for (const metric of ['observed_occurrences','occurrences_with_exact_approval','occurrences_with_snapshot_only_approval','occurrences_with_current_latest_exact_approval']) {
          check((actual[metric]??0)===expected[metric],`Incremental ${expected.resource} coverage ${metric} equals full canonical review`);
        }
        check((actual.observed_occurrences??0)-(actual.occurrences_with_approval??0)===expected.occurrences_without_approval,`Incremental ${expected.resource} unapproved count equals full canonical review`);
      }
    }
    if (binding===weightBinding.id) {
      sql(`select set_config('request.jwt.claims',${claims},false); select aggregate_ezyvet_migration_approval_page(${quote(linkId)}); select aggregate_ezyvet_migration_approval_page(${quote(linkId)});`);
      const counters=JSON.parse(sql(`select jsonb_object_agg(receipt_kind,metrics) from (select receipt_kind,jsonb_object_agg(metric,records) metrics from ezyvet_migration_approval_counts where preparation_id=${quote(preparation)} group by receipt_kind) c;`));
      for (const receiptKind of ["weight_approval","weight_source_acknowledgment"]) for (const [metric,expected] of Object.entries(outcomeTotals(weightManifest.run.id).receipts[receiptKind])) {
        check((counters[receiptKind]?.[metric]??0)===expected,`Incremental ${receiptKind} ${metric} matches canonical outcome`);
      }
    }
  }
}
const sharedIdentityRun = randomUUID();
const identityClaimArgs = {p_id:sharedIdentityRun,p_actor:owner.id,p_site_uid:site,p_resource:"animal",p_source_origin:origin};
const failedIdentityClaim = await request("/rest/v1/rpc/claim_ezyvet_import",identityClaimArgs);
await request("/rest/v1/rpc/fail_ezyvet_import_page",{p_id:sharedIdentityRun,p_actor:owner.id,p_lease_id:failedIdentityClaim.lease_id,p_code:"UPSTREAM_TIMEOUT",p_retry_seconds:1});
for (let page=1;page<=2;page++) {
  sql(`update ezyvet_import_runs set retry_after=null where id=${quote(sharedIdentityRun)};`);
  const claim = await request("/rest/v1/rpc/claim_ezyvet_import",identityClaimArgs);
  await request("/rest/v1/rpc/stage_ezyvet_import_page",{p_id:sharedIdentityRun,p_actor:owner.id,p_lease_id:claim.lease_id,p_page:page,p_complete:page===2,
    p_items:Array.from({length:50},(_,index)=>({external_id:String(2000+(page-1)*50+index),payload:{id:2000+(page-1)*50+index}}))});
}
// Synthetic approved links share a local patient, as explicit legacy identity links may.
sql(`insert into ezyvet_record_links(id,request_id,request_hash,source_origin,source_site_uid,resource,external_id,snapshot_id,head_version,client_id,pet_id,local_version,action,reason,approved_by)
 select gen_random_uuid(),gen_random_uuid(),'synthetic-overlap',s.source_origin,s.source_site_uid,s.resource,s.external_id,s.id,1,${quote(client)},${quote(pet)},1,'link','SYNTHETIC IDENTITY LINK',${quote(owner.id)} from ezyvet_import_snapshots s where s.source_site_uid=${quote(site)} and s.resource='animal' and s.external_id ~ '^20[0-9]{2}$';`);
const overlapMappings = JSON.parse(sql(`select jsonb_agg(jsonb_build_object('mapping_id',id,'parent_snapshot_id',snapshot_id) order by external_id) from ezyvet_record_links where source_site_uid=${quote(site)} and resource='animal' and external_id ~ '^20[0-9]{2}$';`));
const overlapManifest = await api.prepare({id:randomUUID(),source_origin:origin,source_site_uid:site,
  scopes:overlapMappings.map((m,index)=>({...m,id:randomUUID(),resource:"animal",parent_type:"animal",parent_head_version:1,
    disposition:index===98?"excluded":index===99?"unsupported":"required",reason:`Synthetic distinct identity scope ${index}`}))});
for (const scope of overlapManifest.scopes.filter(scope=>scope.disposition==="required").slice(0,96))
  await api.bind({id:randomUUID(),scope_id:scope.id,child_run_id:sharedIdentityRun,reason:"Synthetic shared identity scan",replaces_id:null});
const aggregateStarted = performance.now();
const overlapTotals = JSON.parse(sql(`select set_config('request.jwt.claims',${quote(JSON.stringify({sub:owner.id,role:"authenticated"}))},false); select jsonb_build_object('source',ezyvet_migration_source_totals(${quote(overlapManifest.run.id)}),'scan',ezyvet_migration_scan_totals(${quote(overlapManifest.run.id)}),'outcomes',ezyvet_migration_outcome_totals(${quote(overlapManifest.run.id)}));`).split("\n").at(-1)!);
check(performance.now()-aggregateStarted<5000,"Sparse maximum-scope manifest aggregates within five seconds including command overhead");
check(overlapTotals.source.resources[0].scopes===100 && overlapTotals.source.resources[0].unbound_required_scopes===2,"Unbound scopes remain in maximum manifest denominator");
check(overlapTotals.source.resources[0].excluded_scopes===1 && overlapTotals.source.resources[0].unsupported_scopes===1,"Excluded and unsupported scopes remain visible");
check(overlapTotals.source.resources[0].observation_memberships===96 && overlapTotals.source.resources[0].observed_occurrences===96,"Each selected identity counts once without leaking unrelated scan identities");
check(overlapTotals.scan.scans.distinct_child_runs===1 && overlapTotals.scan.pages_observed===2,"Ninety-six bindings share one scan and two pages");
check(overlapTotals.scan.attempt_history.failed_pages===1 && overlapTotals.scan.attempt_history.claims===3,"Shared scan counts failure and retry history once");
check(overlapTotals.scan.bound_required_scopes===96 && overlapTotals.scan.scans.traversal_ended===1,"Scope denominator stays separate from ended traversal");
check(overlapTotals.outcomes.receipts.identity_mapping.versions===96 && overlapTotals.outcomes.native_outcomes.pet.records===1,"Distinct linked source identities do not multiply local patient");
check(!overlapTotals.source.complete_coverage_verified && !overlapTotals.scan.complete_coverage_verified && !overlapTotals.outcomes.cutover_accepted,"Maximum manifest does not imply acceptance");
const combinedStarted=performance.now();
const maximumCombined=JSON.parse(sql(`select set_config('request.jwt.claims',${quote(JSON.stringify({sub:owner.id,role:"authenticated"}))},false); select ezyvet_migration_global_projection(${quote(overlapManifest.run.id)});`).split("\n").at(-1)!);
check(performance.now()-combinedStarted<5000 && maximumCombined.review.resources[0].observed_occurrences===96,"Full combined projection meets sparse maximum-scope bound including review gaps");
// Bulk seed only the owned disposable fixture to the canonical per-run page limit.
// These rows test summary scale, not provider traversal or delivery acceptance.
sql(`insert into ezyvet_import_pages(run_id,page,item_count) select ${quote(sharedIdentityRun)},p,50 from generate_series(3,1000) p;
 insert into ezyvet_import_page_items(run_id,page,snapshot_id)
 select ${quote(sharedIdentityRun)},p,s.id from generate_series(3,1000) p
 join ezyvet_import_snapshots s on s.source_site_uid=${quote(site)} and s.resource='animal' and s.external_id ~ '^20[0-9]{2}$'
 where (s.external_id::integer-2000)/50=(p-1)%2;
 analyze ezyvet_import_pages; analyze ezyvet_import_page_items; analyze ezyvet_import_snapshots;`);
const denseStarted=performance.now();
const denseTotals=JSON.parse(sql(`set statement_timeout='10s'; select set_config('request.jwt.claims',${quote(JSON.stringify({sub:owner.id,role:"authenticated"}))},false); select ezyvet_migration_global_projection(${quote(overlapManifest.run.id)});`).split("\n").at(-1)!);
check(performance.now()-denseStarted<10000,"Full single-scan volume aggregate stays within ten-second local budget");
check(denseTotals.scan.pages_observed===1000 && denseTotals.source.resources[0].observed_occurrences===48000,"Full run retains all selected observations without truncation");
check(denseTotals.outcomes.receipts.identity_mapping.versions===96 && denseTotals.outcomes.native_outcomes.pet.records===1,"Fifty thousand source rows do not multiply approvals or patient identity");
check(denseTotals.review.resources[0].occurrences_with_snapshot_only_approval===48000 && denseTotals.review.resources[0].occurrences_with_exact_approval===0,"Large repeated source population preserves unknown-head evidence fidelity");
const sharedApprovalPreparation=randomUUID();
const sharedApprovalClaims=quote(JSON.stringify({sub:owner.id,role:"authenticated"}));
sql(`select set_config('request.jwt.claims',${sharedApprovalClaims},false); select prepare_ezyvet_migration_projection(${quote(sharedApprovalPreparation)},${quote(combinedManifest.run.id)});`);
const sharedApprovalBindings=JSON.parse(sql(`select jsonb_agg(x->>'binding_id') from ezyvet_migration_preparations p cross join lateral jsonb_array_elements(p.plan) x where p.id=${quote(sharedApprovalPreparation)};`));
const sharedApprovalRows=[];
for (const binding of sharedApprovalBindings) {
  const page=randomUUID(),link=randomUUID();
  sql(`select set_config('request.jwt.claims',${sharedApprovalClaims},false); select prepare_ezyvet_migration_source_chunk(${quote(sharedApprovalPreparation)},${quote(binding)},1); select prepare_ezyvet_migration_review_page(${quote(page)},${quote(sharedApprovalPreparation)},${quote(binding)},1,1,'versioned'); select append_ezyvet_migration_review_chain(${quote(link)},${quote(page)});`);
  sharedApprovalRows.push(...JSON.parse(sql(`select set_config('request.jwt.claims',${sharedApprovalClaims},false); select jsonb_agg(to_jsonb(r)) from ezyvet_migration_selected_approvals(${quote(link)}) r;`).split("\n").at(-1)!));
  sql(`select set_config('request.jwt.claims',${sharedApprovalClaims},false); select aggregate_ezyvet_migration_approval_page(${quote(link)}); select aggregate_ezyvet_migration_approval_page(${quote(link)});`);
}
check(sharedApprovalRows.length===4 && new Set(sharedApprovalRows.map(row=>row.receipt_id)).size===2,"Header and item normalization share two approval identities across four references");
check(sharedApprovalRows.every(row=>row.receipt_kind==="imported_prescription" && row.facets.source_current===false),"Shared prescription normalization retains stale-source status");
const expectedApprovalMatches=standardReceipts(combinedManifest.run.id).filter(row=>row.receipt_kind==="imported_prescription" && row.relationship==="exact_source_version").length
  +contextReceipts(combinedManifest.run.id).filter(row=>row.receipt_kind==="imported_prescription" && row.facets.parent_matches && ["selected","omitted"].includes(row.facets.disposition)).length;
check(sharedApprovalRows.filter(row=>row.facets.exact_match).length===expectedApprovalMatches,"Selected approval relationships match the complete canonical projection");
const sharedApprovalCounts=JSON.parse(sql(`select jsonb_object_agg(metric,records) from ezyvet_migration_approval_counts where preparation_id=${quote(sharedApprovalPreparation)} and receipt_kind='imported_prescription';`));
for (const [metric,expected] of Object.entries(outcomeTotals(combinedManifest.run.id).receipts.imported_prescription)) {
  check((sharedApprovalCounts[metric]??0)===expected,`Incremental shared prescription ${metric} equals full canonical projection`);
}
for (const [metric,expected] of Object.entries(outcomeTotals(combinedManifest.run.id).prescription_review_gaps)) {
  check((sharedApprovalCounts[`gap_${metric}`]??0)===expected,`Incremental prescription gap ${metric} equals full canonical projection across shared references and retries`);
}
check(sql(`select count(*) from ezyvet_migration_approval_states where preparation_id=${quote(sharedApprovalPreparation)};`)==="2","Four references and retries preserve two distinct approval states");
for (const binding of sharedApprovalBindings) {
  sql(`select set_config('request.jwt.claims',${sharedApprovalClaims},false); select aggregate_ezyvet_migration_source_chunk(${quote(sharedApprovalPreparation)},${quote(binding)},1); select aggregate_ezyvet_migration_source_chunk(${quote(sharedApprovalPreparation)},${quote(binding)},1);`);
}
for (const expected of reviewTotals(combinedManifest.run.id).resources) {
  const actual=JSON.parse(sql(`select coalesce(jsonb_object_agg(metric,records),'{}'::jsonb) from ezyvet_migration_coverage_counts where preparation_id=${quote(sharedApprovalPreparation)} and resource=${quote(expected.resource)};`));
  for (const metric of ['observed_occurrences','occurrences_with_exact_approval','occurrences_with_snapshot_only_approval','occurrences_with_current_latest_exact_approval']) {
    check((actual[metric]??0)===expected[metric],`Incremental ${expected.resource} review coverage ${metric} matches full projection`);
  }
  check((actual.observed_occurrences??0)-(actual.occurrences_with_approval??0)===expected.occurrences_without_approval,`Incremental ${expected.resource} unapproved observation count matches full projection`);
}
const expectedItemRelations=outcomeTotals(combinedManifest.run.id).prescription_item_relations;
const actualItemRelations=JSON.parse(sql(`select coalesce(jsonb_object_agg(disposition,records),'{}'::jsonb) from ezyvet_migration_item_relation_counts where preparation_id=${quote(sharedApprovalPreparation)};`));
check(JSON.stringify(actualItemRelations)===JSON.stringify(expectedItemRelations),"Incremental item dispositions equal the canonical full report after shared approval retries");
check(actualItemRelations.selected===1 && actualItemRelations.omitted===1,"Selected and omitted prescription revisions remain separately visible");
check(sql(`select count(*) from ezyvet_migration_item_relation_keys where preparation_id=${quote(sharedApprovalPreparation)};`)==="2","Header pages and repeated aggregation add no duplicate item relations");
check(sql(`select count(*) from information_schema.role_table_grants where table_schema='public' and table_name in ('ezyvet_migration_item_relation_keys','ezyvet_migration_item_relation_counts') and grantee in ('anon','authenticated','service_role','PUBLIC');`)==="0","Partial item relation ledgers remain private");
// Two canonical source windows repeat one selected identity across different pages.
const aggregatePreparation=randomUUID();
const aggregateClaims=quote(JSON.stringify({sub:owner.id,role:"authenticated"}));
sql(`select set_config('request.jwt.claims',${aggregateClaims},false); select prepare_ezyvet_migration_projection(${quote(aggregatePreparation)},${quote(overlapManifest.run.id)});`);
const aggregateBinding=sql(`select x->>'binding_id' from ezyvet_migration_preparations p cross join lateral jsonb_array_elements(p.plan) x where p.id=${quote(aggregatePreparation)} and x->>'binding_id' is not null order by x->>'binding_id' limit 1;`);
for (const firstPage of [1,21]) {
  sql(`select set_config('request.jwt.claims',${aggregateClaims},false); select prepare_ezyvet_migration_source_chunk(${quote(aggregatePreparation)},${quote(aggregateBinding)},${firstPage}); select aggregate_ezyvet_migration_source_chunk(${quote(aggregatePreparation)},${quote(aggregateBinding)},${firstPage});`);
}
const sourceCounters=()=>JSON.parse(sql(`select jsonb_object_agg(metric,records) from ezyvet_migration_source_counts where preparation_id=${quote(aggregatePreparation)};`));
const overlapSourceCounts=sourceCounters();
check(overlapSourceCounts.observation_memberships===20 && overlapSourceCounts.observed_occurrences===20,"Two windows preserve twenty selected physical occurrences");
check(overlapSourceCounts.source_identities===1 && overlapSourceCounts.source_snapshots===1,"Source identity and snapshot deduplicate across chunk boundaries");
check(overlapSourceCounts.occurrences_without_observed_head===20 && !overlapSourceCounts.recorded_source_versions,"Aggregated legacy identity retains unknown observed versions");
sql(`select set_config('request.jwt.claims',${aggregateClaims},false); select aggregate_ezyvet_migration_source_chunk(${quote(aggregatePreparation)},${quote(aggregateBinding)},1); select aggregate_ezyvet_migration_source_chunk(${quote(aggregatePreparation)},${quote(aggregateBinding)},21);`);
assert.deepEqual(sourceCounters(),overlapSourceCounts);checks++;
check(sql(`select count(*) from ezyvet_migration_source_aggregations where preparation_id=${quote(aggregatePreparation)};`)==="2","Replayed source aggregation retains exactly two processed chunks");
// A real blocked statement establishes its snapshot before a concurrent source update.
function sqlSession() {
  const process = spawn("docker",["exec","-i",`supabase_db_${projectId}`,"psql","-U","postgres","-d","postgres","-X","-q","-t","-A","-v","ON_ERROR_STOP=1"],{stdio:["pipe","pipe","pipe"]});
  let output="";
  process.stdout.on("data",chunk=>{output+=chunk.toString();});
  let diagnostic="";
  process.stderr.on("data",chunk=>{diagnostic+=chunk.toString();});
  const done = new Promise<string>((resolve,reject)=>{
    process.on("error",()=>reject(new Error("Synthetic SQL session could not start")));
    process.on("close",code=>code===0?resolve(output):reject(new Error(/ERROR:\s+Active administrator required/.test(diagnostic)?"Active administrator required":/ERROR:\s+Prepared dependencies changed/.test(diagnostic)?"Prepared dependencies changed":"Synthetic SQL session failed")));
  });
  return {process,done,output:()=>output};
}
async function waitForSql(condition:()=>boolean) {
  const deadline=Date.now()+10000;
  while(!condition()) {
    assert.ok(Date.now()<deadline,"Synthetic database barrier timed out");
    await new Promise(resolve=>setTimeout(resolve,25));
  }
}
// Two real connections request the same complete calculation freeze concurrently.
const freezeClaims=quote(JSON.stringify({sub:owner.id,role:"authenticated"}));
function prepareCalculationFixture() {
  const freezePreparation=randomUUID();
sql(`select set_config('request.jwt.claims',${freezeClaims},false); select prepare_ezyvet_migration_projection(${quote(freezePreparation)},${quote(combinedManifest.run.id)});`);
for (const binding of sharedApprovalBindings) {
  const page=randomUUID(),link=randomUUID();
  sql(`select set_config('request.jwt.claims',${freezeClaims},false); select prepare_ezyvet_migration_source_chunk(${quote(freezePreparation)},${quote(binding)},1); select aggregate_ezyvet_migration_source_chunk(${quote(freezePreparation)},${quote(binding)},1); select prepare_ezyvet_migration_review_page(${quote(page)},${quote(freezePreparation)},${quote(binding)},1,1,'versioned'); select append_ezyvet_migration_review_chain(${quote(link)},${quote(page)}); select complete_ezyvet_migration_chunk_reviews(${quote(freezePreparation)},${quote(binding)},1);`);
}
sql(`select set_config('request.jwt.claims',${freezeClaims},false); select process_ezyvet_migration_aggregation_work(${quote(freezePreparation)},null,10);`);
  const history=JSON.parse(sql(`select set_config('request.jwt.claims',${freezeClaims},false); select read_ezyvet_migration_attempt_progress(${quote(freezePreparation)});`).split("\n").at(-1)!);
  for (const child of history.children) {
    let previous=null;
    while (true) {
      const page=JSON.parse(sql(`select set_config('request.jwt.claims',${freezeClaims},false); select prepare_ezyvet_migration_attempt_page(${quote(randomUUID())},${quote(freezePreparation)},${quote(child.binding_id)},${previous?quote(previous):'null'},2);`).split("\n").at(-1)!);
      if (!page.has_more) break;
      previous=page.id;
    }
  }
  return freezePreparation;
}
const freezePreparation=prepareCalculationFixture();
{
  const hold=sqlSession(),writers:ReturnType<typeof sqlSession>[]=[];
  try {
    hold.process.stdin.write(`begin; select pg_advisory_xact_lock(hashtextextended(${quote(`migration-calculation-freeze:${freezePreparation}`)},0)); select 'FREEZE_READY';\n`);
    await waitForSql(()=>hold.output().includes("FREEZE_READY"));
    for(let index=0;index<2;index++) {
      const writer=sqlSession();writers.push(writer);
      writer.process.stdin.end(`select set_config('request.jwt.claims',${freezeClaims},false); select freeze_ezyvet_migration_calculations(${quote(freezePreparation)});`);
    }
    const results=Promise.allSettled(writers.map(writer=>writer.done));
    await waitForSql(()=>sql(`select count(*) from pg_stat_activity where datname='postgres' and wait_event='advisory' and query like ${quote('%'+freezePreparation+'%')};`)==="2");
    hold.process.stdin.end("commit;\n");await hold.done;
    const completed=await results;
    check(completed.every(r=>r.status==="fulfilled"),"Concurrent freeze callers both succeed");
    const payloads=completed.map(r=>r.status==="fulfilled"?JSON.parse(r.value.trim().split("\n").at(-1)!):null);
    assert.deepEqual(payloads[0],payloads[1]);checks++;
    const frozenView=JSON.parse(sql(`select set_config('request.jwt.claims',${freezeClaims},false); select read_ezyvet_migration_calculation_snapshot(${quote(freezePreparation)});`).split("\n").at(-1)!);
    assert.deepEqual(frozenView.outcomes,outcomeTotals(combinedManifest.run.id));checks++;
    assert.deepEqual(frozenView.review,reviewTotals(combinedManifest.run.id));checks++;
    const expectedScan=JSON.parse(sql(`select set_config('request.jwt.claims',${freezeClaims},false); select ezyvet_migration_scan_totals(${quote(combinedManifest.run.id)});`).split("\n").at(-1)!);
    assert.deepEqual(frozenView.scan,expectedScan);checks++;


    check(sql(`select count(*) from ezyvet_migration_calculation_snapshots where preparation_id=${quote(freezePreparation)};`)==="1","Concurrent freeze stores exactly one immutable snapshot");
  } finally {
    hold.process.stdin.end();for(const writer of writers) writer.process.stdin.end();
    await Promise.allSettled([hold.done,...writers.map(writer=>writer.done)]);
  }
}
// Natural expiry during a lock wait must use snapshot assembly time, without a source edit.
{
  const childId=sql(`select child_run_id from ezyvet_migration_bindings where id=${quote(sharedApprovalBindings[0])};`);
  sql(`update ezyvet_import_runs set retry_after=clock_timestamp()+interval '20 seconds',lease_until=clock_timestamp()+interval '20 seconds' where id=${quote(childId)};`);
  const preparation=prepareCalculationFixture();
  const hold=sqlSession();let freezer:ReturnType<typeof sqlSession>|null=null;
  try {
    hold.process.stdin.write(`begin; select pg_advisory_xact_lock(hashtextextended(${quote(`migration-calculation-freeze:${preparation}`)},0)); select 'EXPIRY_FREEZE_READY';\n`);
    await waitForSql(()=>hold.output().includes("EXPIRY_FREEZE_READY"));
    freezer=sqlSession();
    freezer.process.stdin.end(`select set_config('request.jwt.claims',${freezeClaims},false); select freeze_ezyvet_migration_calculations(${quote(preparation)});`);
    const completion=Promise.allSettled([freezer.done]);
    await waitForSql(()=>sql(`select count(*) from pg_stat_activity where datname='postgres' and wait_event='advisory' and query like ${quote('%'+preparation+'%')};`)==="1");
    check(sql(`select retry_after>clock_timestamp() and lease_until>clock_timestamp() from ezyvet_import_runs where id=${quote(childId)};`)==="t","Expiry fixture is active while freeze waits");
    hold.process.stdin.end(`select pg_sleep(greatest(0,extract(epoch from (select greatest(retry_after,lease_until) from ezyvet_import_runs where id=${quote(childId)})-clock_timestamp()))+0.1); commit;\n`);
    await hold.done;
    const [result]=await completion;
    check(result.status==="fulfilled","Natural expiry does not invalidate prepared dependencies");
    const view=JSON.parse(sql(`select set_config('request.jwt.claims',${freezeClaims},false); select read_ezyvet_migration_calculation_snapshot(${quote(preparation)});`).split("\n").at(-1)!);
    check(view.scan.scans.cooling_down===0 && view.scan.scans.active_leases===0,"Frozen scan excludes cooldowns and leases that expired during lock wait");
  } finally {
    hold.process.stdin.end();freezer?.process.stdin.end();
    await Promise.allSettled([hold.done,...(freezer?[freezer.done]:[])]);
    sql(`update ezyvet_import_runs set retry_after=null,lease_until=null where id=${quote(childId)};`);
  }
}
// A freeze waiting on its lock must observe committed changes, but ignore rollbacks.
for (const commitChange of [true,false]) {
  const preparation=prepareCalculationFixture();
  const hold=sqlSession();let freezer:ReturnType<typeof sqlSession>|null=null;
  try {
    hold.process.stdin.write(`begin; select pg_advisory_xact_lock(hashtextextended(${quote(`migration-calculation-freeze:${preparation}`)},0)); select 'MUTATION_FREEZE_READY';\n`);
    await waitForSql(()=>hold.output().includes("MUTATION_FREEZE_READY"));
    freezer=sqlSession();
    freezer.process.stdin.end(`select set_config('request.jwt.claims',${freezeClaims},false); select freeze_ezyvet_migration_calculations(${quote(preparation)});`);
    const completion=Promise.allSettled([freezer.done]);
    await waitForSql(()=>sql(`select count(*) from pg_stat_activity where datname='postgres' and wait_event='advisory' and query like ${quote('%'+preparation+'%')};`)==="1");
    sql(`begin; update pets set version=version+1 where id=${quote(pet)}; ${commitChange?'commit':'rollback'};`);
    hold.process.stdin.end("commit;\n");await hold.done;
    const [result]=await completion;
    check(result.status===(commitChange?"rejected":"fulfilled"),"Freeze waits for fresh dependency state and distinguishes commit from rollback");
    if (commitChange) check(result.status==="rejected" && result.reason.message==="Prepared dependencies changed","Committed patient edit rejects freeze for the dependency reason");
    check(sql(`select count(*) from ezyvet_migration_calculation_snapshots where preparation_id=${quote(preparation)};`)===String(commitChange?0:1),"Stale freeze saves no snapshot; rollback permits one snapshot");
  } finally {
    hold.process.stdin.end();freezer?.process.stdin.end();
    await Promise.allSettled([hold.done,...(freezer?[freezer.done]:[])]);
  }
}
// A lower journal ID can commit AFTER a baseline containing a higher ID.
async function checkDependencyCommitOrder(commit:boolean) {
  const writer=sqlSession();
  const preparation=randomUUID();
  const claims=quote(JSON.stringify({sub:owner.id,role:"authenticated"}));
  const readState=()=>JSON.parse(sql(`select set_config('request.jwt.claims',${claims},false); select read_ezyvet_migration_dependency_state(${quote(preparation)});`).split("\n").at(-1)!);
  try {
    writer.process.stdin.write("begin; update patient_problems set version=version where false; select 'DEPENDENCY_PENDING';\n");
    await waitForSql(()=>writer.output().includes("DEPENDENCY_PENDING"));
    // Empty statements deliberately journal conservatively, without chart changes.
    sql("update patient_weights set weight=weight where false;");
    sql(`select set_config('request.jwt.claims',${claims},false); select prepare_ezyvet_migration_projection(${quote(preparation)},${quote(saved.run.id)});`);
    check(readState().dependencies_unchanged,"Baseline includes committed higher journal entry but not pending transaction");
    writer.process.stdin.end(commit?"commit;\n":"rollback;\n");
    await writer.done;
    const state=readState();
    check(state.dependencies_unchanged===!commit,"Dependency state follows commit visibility, not sequence allocation order");
    assert.deepEqual(state.changed_tables,commit?["patient_problems"]:[]);checks++;
    const fresh=randomUUID();
    sql(`select set_config('request.jwt.claims',${claims},false); select prepare_ezyvet_migration_projection(${quote(fresh)},${quote(saved.run.id)});`);
    const refreshed=JSON.parse(sql(`select set_config('request.jwt.claims',${claims},false); select read_ezyvet_migration_dependency_state(${quote(fresh)});`).split("\n").at(-1)!);
    check(refreshed.dependencies_unchanged,"Fresh preparation absorbs completed transaction history");
  } finally {
    writer.process.stdin.end();
    await Promise.allSettled([writer.done]);
  }
}
await checkDependencyCommitOrder(true);
await checkDependencyCommitOrder(false);
let concurrentPreparation=randomUUID();
const ownerClaims=quote(JSON.stringify({sub:owner.id,role:"authenticated"}));
sql(`select set_config('request.jwt.claims',${ownerClaims},false); select prepare_ezyvet_migration_projection(${quote(concurrentPreparation)},${quote(saved.run.id)});`);
let chunkLock=`hashtextextended(${quote(`migration-chunk:${concurrentPreparation}:${bound.id}:1`)},0)`;
async function raceChunkWriters(revoke:boolean) {
  const hold=sqlSession();
  const writers:ReturnType<typeof sqlSession>[]=[];
  let results:Promise<PromiseSettledResult<string>[]>|null=null;
  try {
    hold.process.stdin.write(`begin; select pg_advisory_xact_lock(${chunkLock}); select 'LOCK_READY';\n`);
    await waitForSql(()=>hold.output().includes("LOCK_READY"));
    for(let index=0;index<2;index++) {
      const writer=sqlSession();writers.push(writer);
      writer.process.stdin.end(`select set_config('request.jwt.claims',${ownerClaims},false); select prepare_ezyvet_migration_source_chunk(${quote(concurrentPreparation)},${quote(bound.id)},1);`);
    }
    results=Promise.allSettled(writers.map(writer=>writer.done));
    await waitForSql(()=>sql(`select count(*) from pg_stat_activity where datname='postgres' and wait_event='advisory' and query like ${quote('%'+concurrentPreparation+'%')};`)==="2");
    if(revoke) sql(`update profiles set is_active=false where id=${quote(owner.id)};`);
    hold.process.stdin.end("commit;\n");
    await hold.done;
    return await results;
  } finally {
    hold.process.stdin.end();
    for(const writer of writers) writer.process.stdin.end();
    await Promise.allSettled([hold.done,...writers.map(writer=>writer.done)]);
    if(revoke) sql(`update profiles set is_active=true where id=${quote(owner.id)};`);
  }
}
const deniedWriters=await raceChunkWriters(true);
check(deniedWriters.every(result=>result.status==="rejected" && result.reason.message==="Active administrator required"),"Both waiting chunk writers recheck revoked administrator access");
check(sql(`select count(*) from ezyvet_migration_source_chunks where preparation_id=${quote(concurrentPreparation)};`)==="0","Revoked concurrent writes persist no chunk");
// Revocation/restoration changed the old dependency baseline; start a fresh preparation.
concurrentPreparation=randomUUID();
chunkLock=`hashtextextended(${quote(`migration-chunk:${concurrentPreparation}:${bound.id}:1`)},0)`;
sql(`select set_config('request.jwt.claims',${ownerClaims},false); select prepare_ezyvet_migration_projection(${quote(concurrentPreparation)},${quote(saved.run.id)});`);
const replayWriters=await raceChunkWriters(false);
check(replayWriters.every(result=>result.status==="fulfilled"),"Both authorized concurrent chunk requests recover successfully");
const replayReceipts=replayWriters.map(result=>JSON.parse((result as PromiseFulfilledResult<string>).value.trim().split("\n").at(-1)!));
check(JSON.stringify(replayReceipts[0])===JSON.stringify(replayReceipts[1]),"Concurrent retries return the identical saved chunk receipt");
check(sql(`select count(*) from ezyvet_migration_source_chunks where preparation_id=${quote(concurrentPreparation)};`)==="1","Concurrent chunk requests commit exactly once");
const gateKey=873619;
const blocker=sqlSession();
let reader:ReturnType<typeof sqlSession>|null=null;
try {
  blocker.process.stdin.write(`begin; select pg_advisory_xact_lock(${gateKey}); select 'LOCK_READY';\n`);
  await waitForSql(()=>blocker.output().includes("LOCK_READY"));
  reader=sqlSession();
  reader.process.stdin.end(`select set_config('request.jwt.claims',${quote(JSON.stringify({sub:owner.id,role:"authenticated"}))},false);
    with gate as materialized(select pg_advisory_xact_lock(${gateKey})) select ezyvet_migration_global_projection(${quote(identityManifest.run.id)}) from gate;`);
  await waitForSql(()=>sql(`select exists(select 1 from pg_locks where locktype='advisory' and objid=${gateKey} and not granted);`)==="t");
  sql(`update ezyvet_identity_heads set version=version+1 where source_site_uid=${quote(site)} and resource='animal';`);
  blocker.process.stdin.end("commit;\n");
  const [,heldOutput]=await Promise.all([blocker.done,reader.done]);
  const held=JSON.parse(heldOutput.trim().split("\n").at(-1)!);
  const fresh=JSON.parse(sql(`select set_config('request.jwt.claims',${quote(JSON.stringify({sub:owner.id,role:"authenticated"}))},false); select ezyvet_migration_global_projection(${quote(identityManifest.run.id)});`).split("\n").at(-1)!);
  check(held.intent_hash===identityManifest.run.intent_hash && !("scope_manifest_hash" in held),"Combined read identifies request intent without mislabeling resolved scope digest");
  check(held.outcomes.receipts.identity_mapping.source_current_versions===1 && held.scan.stale_parent_scopes===0,"Blocked combined read keeps one consistent pre-change snapshot");
  check(fresh.outcomes.receipts.identity_mapping.source_stale_versions===1 && fresh.scan.stale_parent_scopes===1,"Fresh combined read sees source change consistently");
  check(held.source.resources[0].observed_occurrences===fresh.source.resources[0].observed_occurrences && held.review.resources[0].occurrences_with_snapshot_only_approval===1,"Concurrent source change preserves observed evidence and unknown-head relationship");
} finally {
  blocker.process.stdin.end();
  reader?.process.stdin.end();
  await Promise.allSettled([blocker.done,...(reader?[reader.done]:[])]);
}

const driftedIdentity = await identityApi.read(identityBinding, identityItem);
check(!driftedIdentity.approval.source_current && driftedIdentity.approval.relationship === "same_snapshot_unknown_observed_head", "Source reversion does not manufacture exact identity observation credit");
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
await assert.rejects(() => prescriptionApi.list(prescriptionBinding, prescriptionItems.items[0])); checks++;
await assert.rejects(() => medicationApi.list(medicationBinding, medicationItem)); checks++;
await assert.rejects(() => identityApi.read(identityBinding, identityItem)); checks++;
await assert.rejects(() => weightApi.read(weightBinding, weightItem)); checks++;
check(effects() === beforeEffects, "Migration operations cause no native treatment, vaccine certificate, due-plan, reminder, invoice, stock, Storage or delivery mutations");
console.log(`Migration manifest HTTP/Auth/PostgREST: ${checks} checks passed. Synthetic upstream only; no ezyVet requests.`);
