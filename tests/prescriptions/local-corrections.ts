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
const exactTarget = { p_authorization_id: authorization.id, p_pet_id: patient.id, p_dispense_id: dispenseId };
const handoff = await api.previewPickup(dispenseId, null);
const pickupId = randomUUID();
await api.execute({ id: pickupId, kind: 'pickup', payload: { authorization_id: authorization.id, pet_id: patient.id, dispense_id: dispenseId, expected_context_hash: handoff.context_hash, recipient_name: 'Synthetic original recipient', recipient_relationship: 'Synthetic contact', reason: 'Synthetic original pickup', attest_handoff: true, refill_close: null } });
const ledger = () => sql(`select jsonb_build_object('stock',(select coalesce(jsonb_agg(to_jsonb(m) order by id),'[]') from inventory_movements m),'items',(select coalesce(jsonb_agg(to_jsonb(i) order by id),'[]') from billing_invoice_items i),'slots',(select coalesce(jsonb_agg(to_jsonb(s) order by id),'[]') from native_fill_slots s),'refills',(select count(*) from native_refill_events),'payments',(select count(*) from invoice_payments),'refunds',(select count(*) from invoice_refund_requests),'outbox',(select count(*) from communication_outbox))::text`);
const original = () => sql(`select jsonb_build_object('dispense',(select document from native_dispenses where id=${quote(dispenseId)}),'pickup',(select document from native_pickups where id=${quote(pickupId)}))::text`);
const unchangedLedger = ledger(), unchangedOriginal = original();
const selected = { native_prescription_ids: [authorization.id], native_dispense_ids: [dispenseId] };
const releaseArgs = { p_pet_id: patient.id, p_client_id: client.id, p_channel: 'EMAIL', p_recipient: client.primary_email, p_selection: selected };
const before = await rpc('preview_record_release_v10', releaseArgs);
policy(10);
const oldArgs = { ...releaseArgs, p_id: randomUUID(), p_reviewed_snapshot: before.snapshot, p_reviewed_hash: before.source_hash, p_attest_review: true };
const oldRelease = await rpc('confirm_record_release', oldArgs);
const oldPrint = await rpc('read_native_prescription_print', { p_authorization_id: authorization.id, p_dispense_id: dispenseId });
check(oldPrint.prescription.authorization_id === authorization.id && oldPrint.dispense.id === dispenseId, 'Uncorrected original print endpoint returns immutable evidence before correction');
async function request(kind: string, amendment: unknown = null, amends: string | null = null, headers = staff.headers) {
  const preview = await rpc('preview_native_dispense_correction', exactTarget, headers);
  return { authorization_id: authorization.id, pet_id: patient.id, dispense_id: dispenseId, kind, expected_context_hash: preview.context_hash, expected_head: preview.context.head, reason: 'Synthetic explicit correction review', note: 'Synthetic client-shareable correction evidence', amends_event_id: amends, pickup_amendment: amendment, attest_review: true };
}
const operational = await request('operational_annotation');
const opId = randomUUID();
const first = await rpc('append_native_dispense_correction', { p_id: opId, p_request: operational }, staff.headers);
check(first.id === opId && first.actor_id === staff.id && first.result.sequence === 1 && first.result.actor.authority === 'active_staff', 'Actual staff annotation binds identity and first chain event');
assert.deepEqual(await rpc('append_native_dispense_correction', { p_id: opId, p_request: operational }, staff.headers), first); checks++;
assert.deepEqual(await rpc('recover_native_dispense_correction', { p_id: opId }, staff.headers), first); checks++;
await denied('recover_native_dispense_correction', { p_id: opId }, '42501');
await denied('append_native_dispense_correction', { p_id: opId, p_request: { ...operational, note: 'Changed synthetic content' } }, '23514', staff.headers);
await denied('append_native_dispense_correction', { p_id: randomUUID(), p_request: operational }, '40001', staff.headers);
const clinicalRequest = await request('clinical_annotation');
await denied('append_native_dispense_correction', { p_id: randomUUID(), p_request: clinicalRequest }, '42501', staff.headers);
const administrator = await user('admin-only');
sql(`insert into user_roles(user_id,role) values(${quote(administrator.id)},'ADMIN') on conflict do nothing;`);
await denied('append_native_dispense_correction', { p_id: randomUUID(), p_request: clinicalRequest }, '42501', administrator.headers);
const clinicalId = randomUUID();
const clinical = await rpc('append_native_dispense_correction', { p_id: clinicalId, p_request: clinicalRequest });
check(clinical.result.sequence === 2 && clinical.result.actor.authority === 'active_dvm' && clinical.result.prior_event_id === first.id, 'Clinical DVM annotation extends exact predecessor');
sql(`delete from user_roles where user_id=${quote(doctor.id)} and role='DVM';`);
try {
  assert.deepEqual(await rpc('recover_native_dispense_correction', { p_id: clinicalId }), clinical); checks++;
  await denied('append_native_dispense_correction', { p_id: randomUUID(), p_request: await request('clinical_annotation', null, null, doctor.headers) }, '42501');
} finally { sql(`insert into user_roles(user_id,role) values(${quote(doctor.id)},'DVM') on conflict do nothing;`); }
const errorPickup = await request('pickup_amendment', { original_pickup_id: pickupId, disposition: 'recorded_in_error', handoff: null });
const disputed = await rpc('append_native_dispense_correction', { p_id: randomUUID(), p_request: errorPickup }, staff.headers);
check(disputed.result.pickup_amendment.handoff === null && disputed.result.sequence === 3, 'Recorded-in-error amendment asserts no replacement handoff');
const correctedRequest = await request('pickup_amendment', { original_pickup_id: pickupId, disposition: 'corrected_handoff', handoff: { picked_up_at: handoff.context.dispense.dispensed_at, recipient_name: 'Synthetic corrected recipient', recipient_relationship: 'Synthetic corrected relationship' } }, disputed.id);
const corrected = await rpc('append_native_dispense_correction', { p_id: randomUUID(), p_request: correctedRequest }, staff.headers);
check(corrected.result.sequence === 4 && corrected.result.amends_event_id === disputed.id, 'Corrected handoff explicitly amends latest disputed assertion');
const current = await rpc('read_native_dispense_corrections', exactTarget, staff.headers);
check(current.context.head.version === 4 && current.context.latest_pickup_amendment.event_id === corrected.id, 'Stable current correction head includes latest pickup interpretation');
check(await rpc('read_native_dispense_corrections', { ...exactTarget, p_pet_id: randomUUID() }, staff.headers) === null, 'Wrong patient correction read returns no evidence');
const page = await rpc('list_native_dispense_corrections', { ...exactTarget, p_limit: 2, p_before_version: null }, staff.headers);
check(page.events.length === 2 && page.events[0].sequence === 4 && page.next_before_version === 3, 'First correction page uses descending exclusive sequence cursor');
const older = await rpc('list_native_dispense_corrections', { ...exactTarget, p_limit: 2, p_before_version: page.next_before_version }, staff.headers);
check(older.events[0].sequence === 2 && older.events[1].sequence === 1 && older.next_before_version === null, 'Older correction page retains full original chain');
assert.deepEqual(await rpc('recover_native_dispense_correction', { p_id: opId }, staff.headers), first); checks++;
check(original() === unchangedOriginal && ledger() === unchangedLedger, 'Annotations and pickup amendments never alter original evidence, stock, allowance, billing, refill or payment ledgers');
const oldRead = await rpc('read_record_release', { p_id: oldRelease.id });
check(oldRead.eligible === false && oldRead.release.source_hash === before.source_hash, 'Saved schema10 becomes ineligible with original hash retained');
assert.deepEqual(await rpc('confirm_record_release', oldArgs), oldRelease); checks++;
await denied('preview_record_release_v10', releaseArgs, '23514');
const fresh = await rpc('preview_record_release_v11', releaseArgs);
const disclosure = renderRecordRelease({ preview: fresh });
check(fresh.snapshot.schema_version === 11 && disclosure.includes('Synthetic corrected recipient') && disclosure.includes('Synthetic original recipient'), 'Actual schema11 renders original and amended pickup evidence');
check(fresh.snapshot.native_dispenses[0].corrections.events.length === 4 && fresh.snapshot.native_prescriptions[0].corrections.event_count === 4, 'Schema11 contains full bounded chain and authorization summary');
const freshArgs = { ...releaseArgs, p_id: randomUUID(), p_reviewed_snapshot: fresh.snapshot, p_reviewed_hash: fresh.source_hash, p_attest_review: true };
await denied('confirm_record_release', freshArgs, '42501');
policy(11);
const newRelease = await rpc('confirm_record_release', freshArgs);
check((await rpc('read_record_release', { p_id: newRelease.id })).eligible === true, 'Explicit policy11 permits corrected record release');
await denied('read_native_prescription_print', { p_authorization_id: authorization.id, p_dispense_id: dispenseId }, '23514');
const print = await rpc('read_native_prescription_print_v2', { p_authorization_id: authorization.id, p_dispense_id: dispenseId });
check(print.version === 2 && print.correction_summary.event_count === 4 && print.dispense_corrections.events.length === 4 && print.original_pickup.id === pickupId, 'Versioned print includes exact original pickup and complete correction disclosure');
assert.deepEqual(print.prescription, oldPrint.prescription); assert.deepEqual(print.dispense, oldPrint.dispense); checks += 2;
check(renderReviewedPrescriptionCopy(print, { authorizationId: authorization.id, patientId: patient.id, dispenseId }).includes('Synthetic corrected recipient'), 'Actual versioned print renderer discloses correction');
for (const headers of [anonymous, service]) {
  const rejected = await post('/rest/v1/rpc/append_native_dispense_correction', { p_id: randomUUID(), p_request: correctedRequest }, headers);
  check(!rejected.ok, 'Anonymous and service callers cannot append clinical/operational corrections');
}
check(original() === unchangedOriginal && ledger() === unchangedLedger, 'Printing/release work also leaves all original and financial effects unchanged');
console.log(JSON.stringify({ synthetic_only: true, suite: 'native-corrections-local-auth', checks_passed: checks, provider_requests: 0, project_id: projectId, cleanup: 'Owned runtime must be destroyed by parent harness' }));
