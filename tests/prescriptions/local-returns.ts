/** Real Auth/PostgREST acceptance. Requires an explicitly owned disposable runtime.
 * Does not start/reset/stop databases, contact providers, or erase signed history.
 * The owning harness must destroy its disposable runtime after this script exits. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createFulfillmentApi } from '../../src/hub/features/prescriptions/fulfillment-api.ts';
import { createPrescriptionApi } from '../../src/hub/features/prescriptions/prescription-api.ts';
import { renderReviewedPrescriptionCopy } from '../../src/hub/features/prescriptions/prescription-print.ts';
import type { ReturnIntent, ReturnPreview } from '../../supabase/functions/_shared/native-dispense-returns.ts';
import { renderRecordRelease } from '../../supabase/functions/_shared/record-release-renderer.ts';
const project = process.env.NATIVE_PRESCRIPTION_TEST_PROJECT;
assert.ok(project, 'Explicit owned disposable project required');
const projectId = readFileSync(`${project}/supabase/config.toml`, 'utf8').match(/^project_id\s*=\s*"([a-zA-Z0-9_-]+)"/m)?.[1];
assert.ok(projectId?.startsWith('lrv-prescription-'), 'Only a named lrv-prescription-* disposable runtime is allowed');
const labels = JSON.parse(execFileSync('docker', ['inspect', `supabase_db_${projectId}`], { encoding: 'utf8', stdio: ['ignore','pipe','pipe'], timeout: 30000 }))[0]?.Config?.Labels;
assert.equal(labels?.['com.supabase.cli.project'], projectId);
assert.equal(realpathSync(labels?.['com.supabase.cli.workdir']), realpathSync(project));
const local = (() => {
  try { return JSON.parse(execFileSync('supabase', ['status', '--workdir', project, '--output', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 })); }
  catch { throw new Error('Could not read the owned local Supabase runtime status.'); }
})();
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
const doctor = await user('DVM'), staff = await user('staff');
sql(`insert into public.user_roles(user_id,role) values(${quote(doctor.id)},'DVM'),(${quote(doctor.id)},'ADMIN') on conflict do nothing; update public.profiles set full_name='Synthetic DVM',is_active=true where id=${quote(doctor.id)};`);
sql(`update public.profiles set full_name='Synthetic dispensing staff' where id=${quote(staff.id)};`);
async function rpc(name: string, args: Record<string, unknown>, headers: Record<string, string> = doctor.headers) {
  const r = await post(`/rest/v1/rpc/${name}`, args, headers);
  if (!r.ok) throw new Error(`Local synthetic RPC ${name} failed: HTTP ${r.status}, code ${String(r.value?.code || 'unknown')}`);
  return r.value;
}
async function denied(name: string, args: Record<string, unknown>, code: string, headers: Record<string, string> = doctor.headers) {
  const r = await post(`/rest/v1/rpc/${name}`, args, headers);
  check(!r.ok && r.value?.code === code, `${name} denied with ${code}`);
}
const start = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
const end = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
// Retained failed/successful runs must not share a household SMS number.
const syntheticPhone = sql("select '+13035550'||lpad(n::text,3,'0') from generate_series(100,199) n where not exists(select 1 from clients where communication_recipient('SMS',primary_phone)='+13035550'||lpad(n::text,3,'0')) order by n limit 1");
assert.match(syntheticPhone, /^\+130355501[0-9]{2}$/);
const client = await rpc('save_client', { p_actor_id: doctor.id, p_client_id: null, p_expected_version: null, p_first_name: 'Synthetic', p_last_name: 'Native prescription household', p_primary_phone: syntheticPhone, p_primary_email: 'native-rx@example.test', p_preferred_channel: 'EMAIL', p_mailing_address: 'Synthetic address', p_housecall_address: null });
const patient = await rpc('save_patient', { p_id: null, p_client_id: client.id, p_expected_version: null, p_name: 'Synthetic native patient', p_species: 'Dog', p_breed: null, p_dob: null, p_birth_date_precision: 'unknown', p_color: null, p_sex: 'unknown', p_neuter_status: 'unknown', p_microchip_id: null, p_archived_at: null, p_deceased_at: null });
const adapter = (headers: Record<string, string>) => ({ rpc: async (name: string, args: Record<string, unknown>) => {
  const response = await post(`/rest/v1/rpc/${name}`, args, headers);
  return { data: response.ok ? response.value : null, error: response.ok ? null : new Error(`Synthetic RPC ${name}: ${response.value?.code} ${response.value?.message}`) };
} });
const doctorApi = createPrescriptionApi(adapter(doctor.headers), doctor.id, patient.id);
const staffApi = createPrescriptionApi(adapter(staff.headers), staff.id, patient.id);
const configId = randomUUID();
const configRequest = { user_id: doctor.id, expected_version: null, fields: { active: true, license_number: 'SYNTHETIC-ONLY', license_state: 'CO', license_expires_on: end, practice_name: 'Synthetic practice', practice_address: 'Synthetic location', practice_phone: null, clinical_review_note: 'Synthetic fixture configuration only; no production clinical approval.' }, attest_review: true };
await denied('configure_native_prescriber', { p_id: randomUUID(), p_request: configRequest }, '42501', staff.headers);
const configured = await rpc('configure_native_prescriber', { p_id: configId, p_request: configRequest });
check(configured.actor_id === doctor.id && configured.operation === 'configure_prescriber' && configured.result.user_id === doctor.id && configured.pet_id === null, 'Configuration receipt binds actual administrator and target');
assert.deepEqual(await rpc('configure_native_prescriber', { p_id: configId, p_request: configRequest }), configured); checks++;
assert.deepEqual(await doctorApi.recover({ id: configId, kind: 'configure_prescriber', payload: configRequest }), configured); checks++;
const directory = await doctorApi.listPrescribers(null, 100);
check(directory.version === 1 && directory.entries.some((entry: { user_id: string; eligible: boolean }) => entry.user_id === doctor.id && entry.eligible), 'Prescriber directory reports configured DVM');
// All quantities and directions below are synthetic test data, never clinical advice.
const product = await rpc('save_catalog_product', { p_id: null, p_expected_version: null, p_name: 'Synthetic dispensing stock', p_kind: 'medication', p_manufacturer: '', p_unit: 'tablet', p_unit_price_cents: 125, p_active: true }, staff.headers);
const lots = [randomUUID(), randomUUID()].sort();
for (const lot of lots) await rpc('receive_inventory', { p_id: randomUUID(), p_lot_id: lot, p_product_id: product.id, p_lot_number: `SYNTHETIC-${lot}`, p_expires_on: end, p_location: 'Synthetic shelf', p_quantity: 10, p_reason: 'Synthetic stock receipt' }, staff.headers);
const invoiceId = randomUUID();
await rpc('create_billing_invoice', { p_id: invoiceId, p_client_id: client.id }, staff.headers);
const fields = { encounter_id: null, medication: { name: 'Synthetic medication', strength: 'Synthetic strength', form: 'Synthetic form', directions: 'Synthetic directions; not clinical instructions.', route: 'Synthetic route' }, quantity_per_fill: '3', unit: 'tablet', refills_authorized: 1, fulfillment_mode: 'practice_stock', product_id: product.id, starts_on: start, expires_on: end };
const draftId = randomUUID();
await staffApi.execute({ id: randomUUID(), kind: 'save_draft', payload: { draft_id: draftId, pet_id: patient.id, client_id: client.id, expected_version: null, fields } });
const draft = await doctorApi.readDraft(draftId); assert.ok(draft);
const signing = await doctorApi.preview(draft);
const signedReceipt = await doctorApi.execute({ id: randomUUID(), kind: 'sign', payload: { draft_id: draftId, pet_id: patient.id, expected_version: 1, expected_context_hash: signing.context_hash, signature_name: signing.context.prescriber.name, attest_review: true } });
assert.equal(signedReceipt.operation, 'sign');
const authorization = await doctorApi.readAuthorization(signedReceipt.id); assert.ok(authorization);
const api = createFulfillmentApi(adapter(staff.headers), staff.id, authorization);
// Policy setup is local synthetic commissioning, never production approval.
function policy(version: number) {
  sql(`insert into public.record_release_policy(id,enabled,accepted_by,accepted_at,acceptance_reference,accepted_schema_version) values(true,true,'Synthetic local reviewer',now(),'Disposable acceptance only',${version}) on conflict(id) do update set enabled=true,accepted_by=excluded.accepted_by,accepted_at=excluded.accepted_at,acceptance_reference=excluded.acceptance_reference,accepted_schema_version=excluded.accepted_schema_version;`);
}
const target = { authorization_id: authorization.id, pet_id: patient.id, slot_index: 0, expected_slot_version: null, invoice_id: invoiceId, quantity: '1', allocations: [{ lot_id: lots[0], quantity: '1' }], refill: null };
const dispensePreview = await api.previewDispense(target);
const dispenseId = randomUUID();
await api.execute({ id: dispenseId, kind: 'dispense', payload: { ...target, expected_context_hash: dispensePreview.context_hash, reason: 'Synthetic release fixture partial', attest_alert_review: true, attest_dispense_review: true } });
const returnTarget = { authorization_id: authorization.id, pet_id: patient.id, dispense_id: dispenseId };
const targetArgs = { p_authorization_id: authorization.id, p_pet_id: patient.id, p_dispense_id: dispenseId };
const source = await rpc('read_native_dispense_returns', targetArgs);
check(source.head.version === 0 && source.allocations.length === 1, 'New dispense has zero return head and exact original allocations');
const allocationId = source.allocations[0].allocation_id;
const original = () => sql(`select jsonb_build_object('dispense',(select document from native_dispenses where id=${quote(dispenseId)}),'negative',(select jsonb_agg(to_jsonb(m) order by id) from inventory_movements m where kind='dispense'),'items',(select jsonb_agg(to_jsonb(i) order by id) from billing_invoice_items i),'slots',(select jsonb_agg(to_jsonb(s) order by id) from native_fill_slots s),'refills',(select count(*) from native_refill_events),'outbox',(select count(*) from communication_outbox),'credits',(select count(*) from billing_credits),'payments',(select count(*) from invoice_payments))::text`);
const beforeOriginal = original();
const selected = { native_prescription_ids: [authorization.id], native_dispense_ids: [dispenseId] };
const releaseArgs = { p_pet_id: patient.id, p_client_id: client.id, p_channel: 'EMAIL', p_recipient: client.primary_email, p_selection: selected };
policy(11);
const oldPreview = await rpc('preview_record_release_v11', releaseArgs);
const oldArgs = { ...releaseArgs, p_id: randomUUID(), p_reviewed_snapshot: oldPreview.snapshot, p_reviewed_hash: oldPreview.source_hash, p_attest_review: true };
const oldRelease = await rpc('confirm_record_release', oldArgs);
const beforePrint = await rpc('read_native_prescription_print_v2', { p_authorization_id: authorization.id, p_dispense_id: dispenseId });
function intent(action: ReturnIntent['action'], quantity: string, intakeId: string | null = null): ReturnIntent {
  return { target: returnTarget, action, intake_id: intakeId, allocations: [{ allocation_id: allocationId, quantity }], custody: action === 'intake' ? 'clinic_retained' : null, package_condition: action === 'intake' ? 'sealed_intact' : null, storage_history: action === 'intake' ? 'controlled' : null, reason: 'Synthetic explicitly reviewed physical disposition', note: 'Synthetic client-shareable return evidence' };
}
async function review(i: ReturnIntent, headers = staff.headers): Promise<ReturnPreview> {
  return rpc('preview_native_dispense_return', { p_intent: i }, headers);
}
function request(p: ReturnPreview) {
  return { intent: p.context.intent, expected_context_hash: p.context_hash, expected_head: p.context.head, attest_review: true, attest_restock: p.context.intent.action === 'restock' };
}
async function append(i: ReturnIntent, headers = staff.headers) {
  const p = await review(i, headers); check(p.allowed, 'Reviewed return action is allowed');
  const args = { p_id: randomUUID(), p_request: request(p) };
  return { args, receipt: await rpc('record_native_dispense_return', args, headers) };
}
const intake = await append(intent('intake', '0.750'));
assert.deepEqual(await rpc('record_native_dispense_return', intake.args, staff.headers), intake.receipt); checks++;
assert.deepEqual(await rpc('recover_native_dispense_return', { p_id: intake.args.p_id }, staff.headers), intake.receipt); checks++;
await denied('record_native_dispense_return', { ...intake.args, p_request: { ...intake.args.p_request, intent: { ...intake.args.p_request.intent, note: 'Changed note' } } }, '23514', staff.headers);
const wrongActor = await post('/rest/v1/rpc/recover_native_dispense_return', { p_id: intake.args.p_id }, doctor.headers);
check(!wrongActor.ok || wrongActor.value === null, 'Other actor cannot disclose saved return request');
await denied('preview_native_dispense_return', { p_intent: intent('intake', '0.251') }, '23514', staff.headers);
const disposal = await append(intent('dispose', '0.250', intake.receipt.id));
check(disposal.receipt.result.allocations.every((a: { movement_id: string | null }) => a.movement_id === null), 'Disposal creates no available inventory');
const restockIntent = intent('restock', '0.500', intake.receipt.id);
let policyBefore = await rpc('read_native_return_policy', {});
if (policyBefore.enabled) {
  await rpc('configure_native_return_policy', { p_id: randomUUID(), p_request: { expected_version: policyBefore.version, enabled: false, review_reference: 'Synthetic local disabled-policy baseline', attest_review: true } });
  policyBefore = await rpc('read_native_return_policy', {});
}
const policyRequest = { expected_version: policyBefore.version, enabled: true, review_reference: 'Synthetic local commissioning only; no live clinical approval', attest_review: true };
await denied('configure_native_return_policy', { p_id: randomUUID(), p_request: policyRequest }, '42501', staff.headers);
const admin = await user('returns-admin-only');
sql(`insert into user_roles(user_id,role) values(${quote(admin.id)},'ADMIN') on conflict do nothing;`);
await denied('configure_native_return_policy', { p_id: randomUUID(), p_request: policyRequest }, '42501', admin.headers);
if (!policyBefore.enabled) {
  const blocked = await review(restockIntent);
  check(!blocked.allowed && blocked.blockers.includes('policy_disabled') && blocked.blockers.includes('dvm_required'), 'Restock discloses disabled policy and missing DVM');
}
const policyId = randomUUID();
const configuredPolicy = await rpc('configure_native_return_policy', { p_id: policyId, p_request: policyRequest });
assert.deepEqual(await rpc('configure_native_return_policy', { p_id: policyId, p_request: policyRequest }), configuredPolicy); checks++;
assert.deepEqual(await rpc('recover_native_return_policy', { p_id: policyId }), configuredPolicy); checks++;
const noDvm = await review(restockIntent);
check(!noDvm.allowed && noDvm.blockers.includes('dvm_required'), 'Staff cannot restock under enabled policy');
const restock = await append(restockIntent, doctor.headers);
check(restock.receipt.result.actor.authority === 'active_dvm' && restock.receipt.result.allocations.length === 1, 'Restock freezes DVM authority and exact source attribution');
const movementId = restock.receipt.result.allocations[0].movement_id;
check(typeof movementId === 'string', 'Restock links positive inventory movement');
const movement = JSON.parse(sql(`select to_jsonb(m) from inventory_movements m where id=${quote(movementId)}`));
check(movement.kind === 'native_return' && Number(movement.quantity) === 0.5 && movement.lot_id === lots[0] && movement.created_by === doctor.id, 'Dedicated positive movement matches original lot, quantity and actor');
await denied('preview_native_dispense_return', { p_intent: restockIntent }, '23514');
await denied('preview_native_dispense_return', { p_intent: intent('intake', '0.251') }, '23514', staff.headers);
sql(`delete from user_roles where user_id=${quote(doctor.id)} and role='DVM';`);
try { assert.deepEqual(await rpc('recover_native_dispense_return', { p_id: restock.args.p_id }), restock.receipt); checks++; }
finally { sql(`insert into user_roles(user_id,role) values(${quote(doctor.id)},'DVM') on conflict do nothing;`); }
const unsafe = await append({ ...intent('intake', '0.250'), custody: 'unknown', package_condition: 'opened', storage_history: 'unknown' });
const unsafeIntent = intent('restock', '0.250', unsafe.receipt.id);
const unsafeReview = await review(unsafeIntent, doctor.headers);
check(!unsafeReview.allowed && ['custody_not_retained','package_not_sealed','storage_not_controlled'].every(code => unsafeReview.blockers.includes(code)), 'Unknown custody/storage and open packaging disclose all blockers');
const handoff = await api.previewPickup(dispenseId, null);
await api.execute({ id: randomUUID(), kind: 'pickup', payload: { authorization_id: authorization.id, pet_id: patient.id, dispense_id: dispenseId, expected_context_hash: handoff.context_hash, recipient_name: 'Synthetic pickup', recipient_relationship: 'Synthetic household', reason: 'Synthetic blocker fixture', attest_handoff: true, refill_close: null } });
const withPickup = await review(unsafeIntent, doctor.headers);
check(withPickup.blockers.includes('original_pickup_exists'), 'Original pickup blocks any return to available stock');
const inactiveProduct = await rpc('save_catalog_product', { p_id: product.id, p_expected_version: product.version, p_name: product.name, p_kind: product.kind, p_manufacturer: product.manufacturer, p_unit: product.unit, p_unit_price_cents: product.unit_price_cents, p_active: false });
check((await review(unsafeIntent, doctor.headers)).blockers.includes('product_inactive'), 'Inactive product disclosed as independent blocker');
await rpc('save_catalog_product', { p_id: product.id, p_expected_version: inactiveProduct.version, p_name: product.name, p_kind: product.kind, p_manufacturer: product.manufacturer, p_unit: product.unit, p_unit_price_cents: product.unit_price_cents, p_active: true });
const balances = await rpc('read_native_dispense_returns', targetArgs);
check(balances.allocations[0].returned_quantity === '1.000' && balances.allocations[0].remaining_returnable_quantity === '0.000' && balances.allocations[0].restocked_quantity === '0.500' && balances.allocations[0].disposed_quantity === '0.250' && balances.allocations[0].held_quantity === '0.250', 'Exact cumulative accounting never restores intake allowance after disposition');
const page = await rpc('list_native_dispense_returns', { ...targetArgs, p_limit: 2, p_before_version: null });
check(page.events.length === 2 && page.next_before_version !== null, 'Return history is bounded and paginated');
const older = await rpc('list_native_dispense_returns', { ...targetArgs, p_limit: 2, p_before_version: page.next_before_version });
check(older.events.length === 2 && older.next_before_version === null, 'Older return chain remains available');
check((await rpc('read_record_release', { p_id: oldRelease.id })).eligible === false, 'Returns invalidate existing schema11 release');
assert.deepEqual(await rpc('confirm_record_release', oldArgs), oldRelease); checks++;
await denied('preview_record_release_v11', releaseArgs, '23514');
const release = await rpc('preview_record_release_v12', releaseArgs);
check(release.snapshot.schema_version === 12 && renderRecordRelease({ preview: release }).includes('Synthetic client-shareable return evidence'), 'Actual schema12 renderer discloses complete return chain');
const newArgs = { ...releaseArgs, p_id: randomUUID(), p_reviewed_snapshot: release.snapshot, p_reviewed_hash: release.source_hash, p_attest_review: true };
await denied('confirm_record_release', newArgs, '42501');
policy(12);
const newRelease = await rpc('confirm_record_release', newArgs);
check((await rpc('read_record_release', { p_id: newRelease.id })).eligible === true, 'Explicit policy12 permits current disclosure');
await denied('read_native_prescription_print_v2', { p_authorization_id: authorization.id, p_dispense_id: dispenseId }, '23514');
await denied('read_native_prescription_print', { p_authorization_id: authorization.id, p_dispense_id: dispenseId }, '23514');
const print = await rpc('read_native_prescription_print_v3', { p_authorization_id: authorization.id, p_dispense_id: dispenseId });
check(print.version === 3 && print.dispense_returns.events.length === 4, 'Print3 includes complete return disclosure');
assert.deepEqual(print.dispense, beforePrint.dispense); checks++;
check(renderReviewedPrescriptionCopy(print, { authorizationId: authorization.id, patientId: patient.id, dispenseId }).includes('Synthetic client-shareable return evidence'), 'Actual print3 renderer includes return explanation');
check(original() === beforeOriginal, 'Original dispensing/negative movements/allowance/billing/refills/payments remain unchanged');
console.log(JSON.stringify({ synthetic_only: true, suite: 'native-returns-local-auth', checks_passed: checks, provider_requests: 0, project_id: projectId, unexercised_blockers: ['unit_changed','lot_expired'], cleanup: 'Owned runtime must be destroyed by parent harness' }));
