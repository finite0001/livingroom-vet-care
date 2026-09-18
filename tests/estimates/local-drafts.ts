import { readOwnedRuntimeStatus } from "./owned-runtime-status.ts";
/** Real Auth/PostgREST acceptance. Requires an explicitly owned disposable runtime.
 * Does not start/reset/stop databases, contact providers, or erase signed history.
 * The owning harness must destroy its disposable runtime after this script exits. */
import assert from 'node:assert/strict';
import { createEstimateDraftApi } from '../../src/hub/features/estimates/estimate-api.ts';
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
const project = process.env.NATIVE_PRESCRIPTION_TEST_PROJECT;
assert.ok(project, 'Explicit owned disposable project required');
const projectId = readFileSync(`${project}/supabase/config.toml`, 'utf8').match(/^project_id\s*=\s*"([a-zA-Z0-9_-]+)"/m)?.[1];
assert.ok(projectId?.startsWith('lrv-prescription-'), 'Only a named lrv-prescription-* disposable runtime is allowed');
const labels = JSON.parse(execFileSync('docker', ['inspect', `supabase_db_${projectId}`], { encoding: 'utf8', stdio: ['ignore','pipe','pipe'], timeout: 30000 }))[0]?.Config?.Labels;
assert.equal(labels?.['com.supabase.cli.project'], projectId);
assert.equal(realpathSync(labels?.['com.supabase.cli.workdir']), realpathSync(project));
const local = readOwnedRuntimeStatus(project);
assert.match(local.API_URL, /^http:\/\/127\.0\.0\.1:\d+$/);
const sql = (query: string) => execFileSync('docker', ['exec', '-i', `supabase_db_${projectId}`, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], { input: query, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 30000 }).trim();
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
let checks = 0;
const check = (condition: unknown, message: string) => { assert.ok(condition, message); checks++; };
const anonymous = { apikey: local.ANON_KEY, 'Content-Type': 'application/json' };
const service = { ...anonymous, Authorization: `Bearer ${local.SERVICE_ROLE_KEY}` };
async function post(path: string, body: unknown, headers: Record<string, string>) {
  const response = await fetch(`${local.API_URL}${path}`, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  const bodyText = await response.text();
  const value = bodyText.trim() === "" ? null : JSON.parse(bodyText);
  return { ok: response.ok, status: response.status, value };
}
async function user(label: string) {
  const email = `native-rx-${label}-${randomUUID()}@example.test`, password = `Synthetic-${randomUUID()}-Aa1!`;
  const created = await post('/auth/v1/admin/users', { email, password, email_confirm: true, user_metadata: { full_name: `Synthetic ${label}` } }, service);
  check(created.ok && typeof created.value.id === 'string', 'Synthetic Auth user created');
  const signed = await post('/auth/v1/token?grant_type=password', { email, password }, anonymous);
  check(signed.ok && typeof signed.value.access_token === 'string', 'Synthetic staff signed in using actual Auth');
  return { id: created.value.id as string, headers: { ...anonymous, Authorization: `Bearer ${signed.value.access_token}` } };
}
const staff = await user('estimate-staff'), other = await user('estimate-other');
async function rpc(name: string, args: Record<string, unknown>, headers = staff.headers) {
  const result = await post(`/rest/v1/rpc/${name}`, args, headers);
  if (!result.ok) throw new Error(`Synthetic estimate RPC ${name}: HTTP ${result.status}, code ${String(result.value?.code || 'unknown')}`);
  return result.value;
}
async function denied(name: string, args: Record<string, unknown>, code: string, headers: Record<string, string> = staff.headers) {
  const result = await post(`/rest/v1/rpc/${name}`, args, headers);
  check(!result.ok && result.value?.code === code, `${name} rejects with ${code}`);
}
const transport = (headers: Record<string, string>) => ({ rpc: async (name: string, args: Record<string, unknown>) => {
  const response = await post(`/rest/v1/rpc/${name}`, args, headers);
  return { data: response.ok ? response.value : null, error: response.ok ? null : Object.assign(new Error(`Synthetic ${name} failed`), { code: response.value?.code }) };
} });
const client = await rpc('save_client', { p_actor_id: staff.id, p_client_id: null, p_expected_version: null, p_first_name: 'Synthetic', p_last_name: `Estimate ${randomUUID()}`, p_primary_phone: null, p_primary_email: 'estimate@example.test', p_preferred_channel: 'EMAIL', p_mailing_address: 'Synthetic estimate address', p_housecall_address: null });
const patient = await rpc('save_patient', { p_id: null, p_client_id: client.id, p_expected_version: null, p_name: 'Synthetic estimate patient', p_species: 'Dog', p_breed: null, p_dob: null, p_birth_date_precision: 'unknown', p_color: null, p_sex: 'unknown', p_neuter_status: 'unknown', p_microchip_id: null, p_archived_at: null, p_deceased_at: null });
const api = createEstimateDraftApi(transport(staff.headers), staff.id, client.id);
const otherApi = createEstimateDraftApi(transport(other.headers), other.id, client.id);
interface Product { id: string; version: number; name: string; kind: 'service' | 'medication' | 'vaccine'; unit: string }
const products: Product[] = [];
for (const kind of ['service', 'medication', 'vaccine'] as const) products.push(await rpc('save_catalog_product', {
  p_id: null, p_expected_version: null, p_name: `Synthetic estimate ${kind}`, p_kind: kind, p_manufacturer: '', p_unit: 'unit', p_unit_price_cents: 125, p_active: true,
}));
const effects = () => {
  const tables = ['patient_treatments', 'native_prescription_authorizations', 'native_dispenses', 'inventory_movements', 'inventory_lots', 'billing_invoices', 'billing_invoice_items', 'billing_credits', 'invoice_payments', 'invoice_refund_requests'];
  return sql(`select jsonb_build_object(${tables.map(table => `${quote(table)},(select count(*) from public.${table})`).join(',')})::text`);
};
const originalEffects = effects();
const fields = () => ({
  title: 'Synthetic full veterinary estimate', notes: 'Draft only, no clinical or billing action.', terms: 'Synthetic estimate terms; not an approved agreement.', accept_by: '2099-12-31',
  lines: products.map((product, i) => ({
    id: randomUUID(), product_id: product.id, product_version: product.version, description: `Synthetic chosen ${product.kind} description`, kind: product.kind, unit: product.unit,
    quantity: i === 0 ? '1.5' : '1',
    pricing: i === 1 ? { kind: 'allocated' as const, amount_cents: '99' } : { kind: 'unit' as const, unit_price_cents: '125' },
    pricing_reason: i === 1 ? 'Synthetic package allocation' : null,
  })),
});
const makeRequest = (estimateId = randomUUID(), expected: number | null = null) => ({ estimate_id: estimateId, client_id: client.id, pet_id: patient.id, expected_version: expected, fields: fields() });
const makeOperation = (payload: ReturnType<typeof makeRequest>, id = randomUUID()) => ({ id, kind: 'save_estimate_draft' as const, payload });
const op = makeOperation(makeRequest());
check(await api.recover(op) === null, 'New exact operation has no receipt before submission');
const saved = await api.save(op);
check(saved.result.version === 1 && saved.result.total_cents === '412', 'Unit half-up rounding and allocated pricing produce exact mixed-kind total');
assert.deepEqual(saved.request, op.payload); checks++;
assert.deepEqual(saved.result.fields, op.payload.fields); checks++;
assert.deepEqual(await api.save(op), saved); checks++;
// A fresh adapter simulates loss of the response/local process state.
const reloaded = createEstimateDraftApi(transport(staff.headers), staff.id, client.id);
assert.deepEqual(await reloaded.recover(JSON.parse(JSON.stringify(op))), saved); checks++;
const loaded = await api.read(op.payload.estimate_id);
check(loaded?.id === op.payload.estimate_id && loaded?.total_cents === '412', 'Actual Auth strict reader sees saved household draft');
const closeSaved = await api.close(op);
check(closeSaved.status === 'recorded', 'Closing committed save recovers recorded outcome');
if (closeSaved.status === 'recorded') { assert.deepEqual(closeSaved.receipt, saved); checks++; }
await denied('recover_native_estimate_draft', { p_id: op.id }, '42501', other.headers);
await denied('close_native_estimate_draft', { p_id: op.id, p_request: op.payload }, '42501', other.headers);
check((await otherApi.read(op.payload.estimate_id))?.id === op.payload.estimate_id, 'Other active staff can read household draft history without claiming creator recovery');
await denied('save_native_estimate_draft', { p_id: op.id, p_request: { ...op.payload, fields: { ...op.payload.fields, title: 'Changed identity' } } }, '23514');

const revised = makeOperation({ ...op.payload, expected_version: 1, fields: { ...op.payload.fields, title: 'Synthetic revised title' } });
const version2 = await api.save(revised);
check(version2.result.version === 2 && version2.result.updated_by === staff.id, 'Optimistic update records second complete revision');
assert.deepEqual(await api.recover(op), saved); checks++;
const stale = makeOperation({ ...op.payload, expected_version: 1 });
await denied('save_native_estimate_draft', { p_id: stale.id, p_request: stale.payload }, '40001');
const history1 = await api.history(op.payload.estimate_id, null, 1);
check(history1.revisions.length === 1 && history1.revisions[0].version === 2 && history1.has_more && history1.next_before_version === 2, 'History explicitly paginates newest version');
const history2 = await api.history(op.payload.estimate_id, history1.next_before_version, 1);
check(history2.revisions.length === 1 && history2.revisions[0].version === 1 && !history2.has_more && history2.next_before_version === null, 'History reaches exact original revision without truncation');

const absent = makeOperation(makeRequest());
const closed = await api.close(absent);
check(closed.status === 'closed_unrecorded', 'Never-recorded save receives serialized terminal closure');
if (closed.status === 'closed_unrecorded') {
  assert.deepEqual(closed.closure.request, absent.payload); checks++;
  check(closed.closure.actor_id === staff.id && closed.closure.id === absent.id, 'Closure binds session actor and exact operation');
}
assert.deepEqual(await reloaded.close(absent), closed); checks++;
await denied('save_native_estimate_draft', { p_id: absent.id, p_request: absent.payload }, '23514');
await denied('close_native_estimate_draft', { p_id: absent.id, p_request: absent.payload }, '42501', other.headers);
await denied('close_native_estimate_draft', { p_id: absent.id, p_request: { ...absent.payload, fields: { ...absent.payload.fields, title: 'Wrong closure request' } } }, '23514');
check((await api.read(absent.payload.estimate_id)) === null, 'Closing a request creates no draft');

for (let i = 0; i < 2; i++) await api.save(makeOperation(makeRequest()));
const seen = new Set<string>();
let cursor: { before_at: string; before_id: string } | null = null;
for (let page = 0; page < 10; page++) {
  const listed = await api.list(cursor, 1);
  for (const draft of listed.drafts) { check(!seen.has(draft.id), 'Cursor pages do not duplicate draft identities'); seen.add(draft.id); }
  if (!listed.has_more) { check(listed.next_cursor === null, 'Final list page declares completeness'); break; }
  check(listed.next_cursor !== null, 'Incomplete list page supplies exact cursor');
  cursor = listed.next_cursor;
  check(page < 9, 'Bounded synthetic pagination terminates');
}
check(seen.size === 3 && seen.has(op.payload.estimate_id), 'List contains all three created household drafts');

const catalogStale = makeOperation(makeRequest());
const p = products[0];
const updated = await rpc('save_catalog_product', { p_id: p.id, p_expected_version: p.version, p_name: p.name, p_kind: p.kind, p_manufacturer: '', p_unit: p.unit, p_unit_price_cents: 126, p_active: true });
await denied('save_native_estimate_draft', { p_id: catalogStale.id, p_request: catalogStale.payload }, '40001');
assert.deepEqual(await reloaded.recover(op), saved); checks++;
check((await api.read(op.payload.estimate_id))?.total_cents === '412', 'Catalog change does not rewrite historical draft amount or description');
const catalogClosed = await api.close(catalogStale);
check(catalogClosed.status === 'closed_unrecorded', 'Stale catalog intent can be terminally closed without current catalog acceptance');
products[0] = updated;
const raw = makeRequest();
await denied('save_native_estimate_draft', { p_id: randomUUID(), p_request: { ...raw, extra: true } }, '23514');
await denied('read_native_estimate_draft', { p_id: op.payload.estimate_id, p_client_id: randomUUID() }, '23514');
for (const headers of [anonymous, service]) {
  await denied('save_native_estimate_draft', { p_id: randomUUID(), p_request: raw }, '42501', headers);
  await denied('close_native_estimate_draft', { p_id: absent.id, p_request: absent.payload }, '42501', headers);
}
sql(`update public.profiles set is_active=false where id=${quote(other.id)};`);
await denied('read_native_estimate_draft', { p_id: op.payload.estimate_id, p_client_id: client.id }, '42501', other.headers);
check(effects() === originalEffects, 'All draft edits/closures leave clinical, stock, invoice and payment ledgers unchanged');
console.log(JSON.stringify({ synthetic_only: true, suite: 'native-estimate-drafts-local-auth', checks_passed: checks, provider_requests: 0, project_id: projectId, cleanup: 'Owned runtime must be destroyed by parent harness' }));
