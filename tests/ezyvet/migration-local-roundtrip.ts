/** Actual local Auth/PostgREST acceptance; no provider or outbound delivery. */
import assert from "node:assert/strict";
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
assert.equal(local.API_URL, "http://127.0.0.1:62421");
const sql = (query: string) => execFileSync("docker", ["exec", "-i", `supabase_db_${projectId}`, "psql", "-U", "postgres", "-d", "postgres", "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"], { input: query, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
const headers = (token: string) => ({ apikey: local.ANON_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" });
const service = headers(local.SERVICE_ROLE_KEY);
let checks = 0;
const check = (value: unknown, message: string) => { assert.ok(value, message); checks++; };
async function request(path: string, body: unknown, auth = service) {
  const response = await fetch(local.API_URL + path, { method: "POST", headers: auth, body: JSON.stringify(body) });
  const value = await response.json();
  if (!response.ok) throw { code: value.code, message: value.message };
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
const effects = () => sql("select jsonb_build_array((select count(*) from patient_documents),(select count(*) from patient_treatments),(select count(*) from billing_invoices),(select count(*) from inventory_movements),(select count(*) from communication_outbox),(select count(*) from storage.objects));");
const beforeEffects = effects();
const manifestRequest: MigrationRequest = { id: randomUUID(), source_origin: origin, source_site_uid: site, scopes: [{ id: randomUUID(), mapping_id: mapping, resource: "attachment", parent_type: "animal", parent_snapshot_id: snapshot, parent_head_version: 1, disposition: "required", reason: "Synthetic supervised selection" }] };
const uncertain = createMigrationRunApi({ async rpc(name, args) {
  const result = await ownerTransport.rpc(name, args);
  if (result.error) return result;
  return { data: null, error: new Error("Simulated reply loss after server commit") };
} }, owner.id);
await assert.rejects(() => uncertain.prepare(manifestRequest), /Simulated reply loss/); checks++;
const saved = await api.read(manifestRequest.id);
check(saved?.run.actor_id === owner.id && saved.scopes[0].pet_id === pet, "Actual HTTP recovery binds owner and patient");
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
check(bound?.child_run_id === child && bound.child_context.parent_evidence === "exact_parent_version", "Lost binding reply recovers exact child context");
assert.deepEqual(await api.bind(bindingRequest), bound); checks++;
check((await api.listBindings(bindingRequest.scope_id)).bindings[0].id === bindingRequest.id, "Binding discovery uses real owner API");
check(await otherApi.readBinding(bindingRequest.id, bindingRequest.scope_id) === null, "Other administrator cannot recover binding");
await assert.rejects(() => otherApi.listBindings(bindingRequest.scope_id)); checks++;
await assert.rejects(() => otherApi.bind(bindingRequest)); checks++;
check(sql(`select to_jsonb(r) from ezyvet_import_runs r where id=${quote(child)};`) === childBefore, "HTTP binding leaves child lease, owner and cursor untouched");
for (let i = 0; i < 2; i++) await api.prepare({ ...manifestRequest, id: randomUUID(), scopes: manifestRequest.scopes.map(scope => ({ ...scope, id: randomUUID() })) });
const first = await api.list(null, 2);
check(first.runs.length === 2 && first.has_more && first.next_cursor, "HTTP history returns bounded first page");
const last = await api.list(first.next_cursor, 2);
check(last.runs.length === 1 && last.runs[0].id === manifestRequest.id && !last.has_more && !last.next_cursor, "HTTP history cursor recovers original request");
for (const auth of [owner.auth, headers(local.ANON_KEY), service]) {
  for (const table of ["ezyvet_migration_runs", "ezyvet_migration_scopes", "ezyvet_migration_bindings"]) {
    const response = await fetch(`${local.API_URL}/rest/v1/${table}?select=id`, { headers: auth });
    check(response.status === 401 || response.status === 403, "Private ledger table cannot be read over HTTP");
  }
}
for (const auth of [headers(local.ANON_KEY), service]) {
  await assert.rejects(() => request("/rest/v1/rpc/read_ezyvet_migration_run", { p_id: manifestRequest.id }, auth)); checks++;
  await assert.rejects(() => request("/rest/v1/rpc/bind_ezyvet_migration_child", { p_id: randomUUID(), p_scope_id: bindingRequest.scope_id, p_child_run_id: child, p_reason: "Unauthorized", p_replaces_id: null }, auth)); checks++;
}
sql(`update ezyvet_identity_heads set version=version+1 where source_site_uid=${quote(site)} and resource='animal';`);
assert.deepEqual(await api.prepare(manifestRequest), saved); checks++;
assert.deepEqual(await api.bind(bindingRequest), bound); checks++;
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
check(effects() === beforeEffects, "Migration operations cause no clinical, invoice, stock, Storage or delivery mutations");
console.log(`Migration manifest HTTP/Auth/PostgREST: ${checks} checks passed. Synthetic upstream only; no ezyVet requests.`);
