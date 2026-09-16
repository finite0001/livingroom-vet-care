/** Real Auth/PostgREST acceptance. Requires an explicitly owned disposable runtime.
 * Does not start/reset/stop databases, contact providers, or erase signed history.
 * The owning harness must destroy its disposable runtime after this script exits. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createPrescriptionApi } from '../../src/hub/features/prescriptions/prescription-api.ts';
import { renderNativePrescription } from '../../supabase/functions/_shared/native-prescription-renderer.ts';
const project = process.env.NATIVE_PRESCRIPTION_TEST_PROJECT;
assert.ok(project, 'Explicit owned disposable project required');
const projectId = readFileSync(`${project}/supabase/config.toml`, 'utf8').match(/^project_id\s*=\s*"([a-zA-Z0-9_-]+)"/m)?.[1];
assert.ok(projectId?.startsWith('lrv-prescription-'), 'Only a named lrv-prescription-* disposable runtime is allowed');
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
  const value = await response.json();
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
const client = await rpc('save_client', { p_actor_id: doctor.id, p_client_id: null, p_expected_version: null, p_first_name: 'Synthetic', p_last_name: 'Native prescription household', p_primary_phone: null, p_primary_email: 'native-rx@example.test', p_preferred_channel: 'EMAIL', p_mailing_address: 'Synthetic address', p_housecall_address: null });
const patient = await rpc('save_patient', { p_id: null, p_client_id: client.id, p_expected_version: null, p_name: 'Synthetic native patient', p_species: 'Dog', p_breed: null, p_dob: null, p_birth_date_precision: 'unknown', p_color: null, p_sex: 'unknown', p_neuter_status: 'unknown', p_microchip_id: null, p_archived_at: null, p_deceased_at: null });
const adapter = (headers: Record<string, string>) => ({ rpc: async (name: string, args: Record<string, unknown>) => {
  const response = await post(`/rest/v1/rpc/${name}`, args, headers);
  return { data: response.ok ? response.value : null, error: response.ok ? null : response.value };
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
const fields = { encounter_id: null, medication: { name: 'Synthetic medication', strength: 'Synthetic strength', form: 'Synthetic form', directions: 'Synthetic directions only; not clinical instructions.', route: 'Synthetic route' }, quantity_per_fill: '30', unit: 'synthetic units', refills_authorized: 2, fulfillment_mode: 'external_pharmacy', product_id: null, starts_on: start, expires_on: end };
const draftId = randomUUID(), saveId = randomUUID();
const saveRequest = { draft_id: draftId, pet_id: patient.id, client_id: client.id, expected_version: null, fields };
const beforeEffects = sql('select jsonb_build_object(\'stock\',(select count(*) from public.inventory_movements),\'charges\',(select count(*) from public.billing_invoice_items),\'treatments\',(select count(*) from public.patient_treatments),\'outbox\',(select count(*) from public.communication_outbox))::text');
const saved = await rpc('save_native_prescription_draft', { p_id: saveId, p_request: saveRequest }, staff.headers);
check(saved.actor_id === staff.id && saved.pet_id === patient.id && saved.result.id === draftId && saved.result.version === 1 && saved.result.status === 'draft', 'Staff draft has no clinical authorization');
assert.deepEqual(await staffApi.recover({ id: saveId, kind: 'save_draft', payload: saveRequest }), saved); checks++;
check(await rpc('recover_native_prescription_operation', { p_id: saveId }) === null, 'Other actor cannot recover private operation');
check(await rpc('read_native_prescription_draft', { p_id: draftId, p_pet_id: randomUUID() }) === null, 'Wrong patient cannot read draft');
await denied('save_native_prescription_draft', { p_id: saveId, p_request: { ...saveRequest, fields: { ...fields, quantity_per_fill: '31' } } }, '23514', staff.headers);
await denied('preview_native_prescription_sign', { p_draft_id: draftId, p_expected_version: 1 }, '42501', staff.headers);
const strictDraft = await doctorApi.readDraft(draftId);
check(strictDraft !== null, 'Strict frontend adapter reads saved draft');
const preview = await doctorApi.preview(strictDraft!);
check(preview.actor_id === doctor.id && preview.pet_id === patient.id && preview.context.draft.id === draftId && preview.context.prescriber.user_id === doctor.id, 'Signing preview binds native patient, DVM and exact draft');
const signId = randomUUID();
const signRequest = { draft_id: draftId, pet_id: patient.id, expected_version: 1, expected_context_hash: preview.context_hash, signature_name: preview.context.prescriber.name, attest_review: true };
await denied('sign_native_prescription', { p_id: randomUUID(), p_request: { ...signRequest, expected_context_hash: '0'.repeat(64) } }, '40001');
await denied('sign_native_prescription', { p_id: randomUUID(), p_request: signRequest }, '42501', staff.headers);
const signed = await rpc('sign_native_prescription', { p_id: signId, p_request: signRequest });
check(signed.id === signId && signed.actor_id === doctor.id && signed.operation === 'sign' && signed.pet_id === patient.id && signed.result.id === signId && signed.result.signed_by === doctor.id, 'Signed authorization and operation identity bound');
assert.deepEqual(await rpc('sign_native_prescription', { p_id: signId, p_request: signRequest }), signed); checks++;
assert.deepEqual(await doctorApi.recover({ id: signId, kind: 'sign', payload: signRequest }), signed); checks++;
assert.deepEqual(await doctorApi.readAuthorization(signId), signed.result); checks++;
check(await rpc('read_native_prescription_authorization', { p_id: signId, p_pet_id: randomUUID() }) === null, 'Historical authorization read is patient scoped');
await denied('save_native_prescription_draft', { p_id: randomUUID(), p_request: { ...saveRequest, expected_version: 1 } }, '23514', staff.headers);
const listing = await doctorApi.listDrafts();
check(listing.version === 1 && listing.pet_id === patient.id && listing.drafts.length === 1 && listing.drafts[0].authorization_id === signId && !listing.has_more && listing.next_cursor === null, 'Patient listing exposes signed draft without losing its history');
const afterEffects = sql('select jsonb_build_object(\'stock\',(select count(*) from public.inventory_movements),\'charges\',(select count(*) from public.billing_invoice_items),\'treatments\',(select count(*) from public.patient_treatments),\'outbox\',(select count(*) from public.communication_outbox))::text');
check(beforeEffects === afterEffects, 'Draft/sign/retry produce no stock, billing, treatment or delivery effects');
// This pure-renderer assertion uses a synthetic status marker, not a live eligibility claim.
const artifact = signed.result.artifact;
const html = renderNativePrescription(artifact, { authorization_id: signId, authorization_hash: signed.result.authorization_hash, checked_at: new Date().toISOString(), state: 'active', reason: null, replacement_id: null });
check(html.includes('Signed prescription order copy') && html.includes('External pharmacy — fulfillment not confirmed'), 'Real stored artifact renders without fabricating dispensing');
await denied('recover_native_prescription_operation', { p_id: signId }, '42501', anonymous);
await denied('recover_native_prescription_operation', { p_id: signId }, '42501', service);
console.log(JSON.stringify({ synthetic_only: true, suite: 'native-prescription-lifecycle-http', checks_passed: checks, provider_requests: 0, project_id: projectId, cleanup: 'Owned runtime must be removed by caller; signed fixtures intentionally retained until then.' }));
