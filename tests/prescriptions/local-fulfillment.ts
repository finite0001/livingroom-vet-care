import { readOwnedRuntimeStatus } from "../estimates/owned-runtime-status.ts";
/** Real Auth/PostgREST acceptance. Requires an explicitly owned disposable runtime.
 * Does not start/reset/stop databases, contact providers, or erase signed history.
 * The owning harness must destroy its disposable runtime after this script exits. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createFulfillmentApi } from '../../src/hub/features/prescriptions/fulfillment-api.ts';
import { createNativeRefillApi } from '../../src/hub/features/refills/refill-api.ts';
import { createPrescriptionApi } from '../../src/hub/features/prescriptions/prescription-api.ts';
import { renderReviewedPrescriptionCopy } from '../../src/hub/features/prescriptions/prescription-print.ts';
const project = process.env.NATIVE_PRESCRIPTION_TEST_PROJECT;
assert.ok(project, 'Explicit owned disposable project required');
const projectId = readFileSync(`${project}/supabase/config.toml`, 'utf8').match(/^project_id\s*=\s*"([a-zA-Z0-9_-]+)"/m)?.[1];
assert.ok(projectId?.startsWith('lrv-prescription-'), 'Only a named lrv-prescription-* disposable runtime is allowed');
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
  const value = await response.json();
  return { ok: response.ok, status: response.status, value };
}
async function user(label: string) {
  const email = `native-rx-${label}-${randomUUID()}@example.test`, password = `Synthetic-${randomUUID()}-Aa1!`;
  const created = await post('/auth/v1/admin/users', { email, password, email_confirm: true, user_metadata: { full_name: `Synthetic ${label}` } }, service);
  check(created.ok && typeof created.value.id === 'string', 'Synthetic Auth user created');
  // A1 (#164): handle_new_user no longer activates a new auth user, so a fixture
  // that needs an active synthetic staff member must activate it explicitly.
  sql(`insert into public.user_roles(user_id,role) values(${quote(created.value.id)},'STAFF') on conflict do nothing; update public.profiles set is_active=true where id=${quote(created.value.id)};`);
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
const client = await rpc('save_client', { p_actor_id: doctor.id, p_client_id: null, p_expected_version: null, p_first_name: 'Synthetic', p_last_name: 'Native prescription household', p_primary_phone: null, p_primary_email: 'native-rx@example.test', p_preferred_channel: 'EMAIL', p_mailing_address: 'Synthetic address', p_housecall_address: null });
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
const initial = await api.read();
check(initial?.usage.version === 2 && initial.usage.used_fill_slots === 0 && initial.usage.remaining_quantity === '6.000', 'Current native usage starts at full explicit allowance');
const staleCancel = await doctorApi.previewCancel(authorization);
const refillApi = createNativeRefillApi(adapter(staff.headers), staff.id), refillId = randomUUID();
await refillApi.execute({ id: randomUUID(), kind: 'create_refill', payload: { refill_id: refillId, pet_id: patient.id, client_id: client.id, medication_requested: 'Synthetic native fulfillment', requester_note: null, channel: 'phone', reason: 'Synthetic intake' } });
const intake = await refillApi.read(refillId, patient.id); assert.ok(intake);
const link = await refillApi.previewLink(intake.refill, authorization.id);
await refillApi.execute({ id: randomUUID(), kind: 'transition_refill', payload: { refill_id: refillId, pet_id: patient.id, expected_version: 1, action: 'link', reason: 'Synthetic exact order link', assigned_to: null, authorization_id: authorization.id, expected_link_context_hash: link.context_hash } });
const target = { authorization_id: authorization.id, pet_id: patient.id, slot_index: 0, expected_slot_version: null, invoice_id: invoiceId, quantity: '2', allocations: [{ lot_id: lots[0], quantity: '1.250' }, { lot_id: lots[1], quantity: '0.750' }], refill: { id: refillId, expected_version: 2 } };
const untouched = sql("select jsonb_build_object('treatments',(select count(*) from patient_treatments),'due',(select count(*) from patient_vaccine_due_plans),'outbox',(select count(*) from communication_outbox))::text");
const review = await api.previewDispense(target);
check(review.context.charge.amount_cents === '250' && review.context.lots.length === 2, 'Review charges once for exact multi-lot sum');
const payload = { ...target, expected_context_hash: review.context_hash, reason: 'Synthetic partial dispensing', attest_alert_review: true, attest_dispense_review: true };
await denied('record_native_dispense', { p_id: randomUUID(), p_request: { ...payload, forged_actor: staff.id } }, '23514', staff.headers);
await denied('record_native_dispense', { p_id: randomUUID(), p_request: { ...payload, allocations: [...target.allocations].reverse() } }, '23514', staff.headers);
await denied('record_native_dispense', { p_id: randomUUID(), p_request: { ...payload, quantity: '2.0001' } }, '23514', staff.headers);
await denied('record_native_dispense', { p_id: randomUUID(), p_request: payload }, '42501', service);
await denied('record_native_dispense', { p_id: randomUUID(), p_request: payload }, '42501', anonymous);
const operation = { id: randomUUID(), kind: 'dispense', payload };
const first = await api.execute(operation); assert.equal(first.operation, 'dispense');
assert.deepEqual(await api.execute(operation), first); checks++;
assert.deepEqual(await api.recover(operation), first); checks++;
check(await rpc('recover_native_fulfillment_operation', { p_id: operation.id }) === null, 'Other active actor cannot recover fulfillment receipt');
await denied('record_native_dispense', { p_id: operation.id, p_request: { ...payload, reason: 'Changed retry' } }, '23514', staff.headers);
check(first.result.slot.remaining_quantity === '1.000' && first.result.slot.version === 1 && first.result.refill_event?.action === 'dispense' && first.result.refill_event.version === 2, 'Partial fill and linked V2 event commit together');
check(first.result.dispense.allocations.length === 2 && new Set(first.result.dispense.allocations.map(a => a.movement_id)).size === 2, 'Two immutable lot movements bind one actual dispense');
check(sql(`select count(*) from billing_invoice_items where invoice_id=${quote(invoiceId)}`) === '1', 'Multi-lot dispensing creates one charge');
check(sql(`select sum(quantity)::text from inventory_movements where lot_id in (${lots.map(quote).join(',')})`) === '18.000', 'Exact retry does not debit stock again');
await denied('cancel_native_prescription', { p_id: randomUUID(), p_request: { authorization_id: authorization.id, pet_id: patient.id, expected_event_id: staleCancel.context.head.id, expected_context_hash: staleCancel.context_hash, reason: 'Stale reviewed cancellation', attest_review: true } }, '40001');
const queue = await refillApi.read(refillId, patient.id);
check(queue?.authorization_usage?.version === 2 && queue.authorization_usage.dispensed_quantity === '2.000' && queue.refill.version === 3, 'Refill snapshot exposes actual native usage and exact linked revision');
const remaining = { ...target, expected_slot_version: 1, quantity: '1', allocations: [{ lot_id: lots[0], quantity: '1' }], refill: null };
const remainingReview = await api.previewDispense(remaining);
const finalPartial = await api.execute({ id: randomUUID(), kind: 'dispense', payload: { ...remaining, expected_context_hash: remainingReview.context_hash, reason: 'Synthetic final partial', attest_alert_review: true, attest_dispense_review: true } });
assert.equal(finalPartial.operation, 'dispense');
check(finalPartial.result.slot.state === 'closed' && finalPartial.result.slot.closure_kind === 'filled' && finalPartial.result.slot.version === 2, 'Reaching exact maximum closes initial slot');
await denied('preview_native_dispense', { p_target: remaining }, '40001', staff.headers);
const next = { ...target, slot_index: 1, expected_slot_version: null, quantity: '0.500', allocations: [{ lot_id: lots[1], quantity: '0.500' }], refill: null };
const nextReview = await api.previewDispense(next);
check(nextReview.context.charge.amount_cents === '63', 'Half-cent rounds once at dispense level');
const third = await api.execute({ id: randomUUID(), kind: 'dispense', payload: { ...next, expected_context_hash: nextReview.context_hash, reason: 'Synthetic second-slot partial', attest_alert_review: true, attest_dispense_review: true } });
assert.equal(third.operation, 'dispense');
const closureReview = await api.previewClose(1);
const closureOp = { id: randomUUID(), kind: 'close_slot', payload: { authorization_id: authorization.id, pet_id: patient.id, slot_index: 1, expected_slot_version: 1, expected_context_hash: closureReview.context_hash, reason: 'Synthetic explicit remainder forfeiture', attest_forfeit: true } };
const closure = await api.execute(closureOp); assert.equal(closure.operation, 'close_slot');
check(closure.result.forfeited_quantity === '2.500' && closure.result.after.remaining_quantity === '0.000', 'Forfeiture records remainder without creating available allowance');
assert.deepEqual(await api.recover(closureOp), closure); checks++;
const usage = await api.read();
check(usage?.usage.dispensed_quantity === '3.500' && usage.usage.forfeited_quantity === '2.500' && usage.usage.remaining_quantity === '0.000' && usage.usage.fulfillment_head.version === 4, 'Native allowance conservation includes full, partial and forfeited quantities');
await denied('preview_native_dispense', { p_target: { ...next, slot_index: 2 } }, '23514', staff.headers);
const slots = await api.slots(null, 1);
check(slots.has_more && slots.next_index === 0 && slots.slots.length === 1, 'Slot history provides real continuation');
const slots2 = await api.slots(slots.next_index, 1);
check(!slots2.has_more && slots2.slots[0].index === 1, 'Slot continuation does not omit final slot');
const history = await api.history('dispenses', null, 1);
check(history.has_more && history.next_cursor !== null, 'Dispense history supplies bounded continuation');
const older = await api.history('dispenses', history.next_cursor, 2);
check(!older.has_more && (older.dispenses as unknown[]).length === 2, 'Dispense continuation returns both earlier partials');
check((await api.history('closures')).closures.length === 1, 'Explicit forfeiture appears in immutable history');
const cancel = await doctorApi.previewCancel(authorization);
await doctorApi.execute({ id: randomUUID(), kind: 'cancel', payload: { authorization_id: authorization.id, pet_id: patient.id, expected_event_id: cancel.context.head.id, expected_context_hash: cancel.context_hash, reason: 'Synthetic cancellation after fulfillment', attest_review: true } });
assert.deepEqual(await api.recover(operation), first); checks++;
const closeRefill = { id: refillId, expected_version: 3, reason: 'Synthetic request closed after handoff' };
const handoff = await api.previewPickup(first.id, closeRefill);
check(handoff.context.authorization.state === 'cancelled', 'Historical pickup review explicitly discloses cancellation');
const pickupOp = { id: randomUUID(), kind: 'pickup', payload: { authorization_id: authorization.id, pet_id: patient.id, dispense_id: first.id, expected_context_hash: handoff.context_hash, recipient_name: 'Synthetic recipient', recipient_relationship: 'Synthetic household contact', reason: 'Synthetic historical handoff acknowledgement', attest_handoff: true, refill_close: closeRefill } };
const pickup = await api.execute(pickupOp); assert.equal(pickup.operation, 'pickup');
assert.deepEqual(await api.execute(pickupOp), pickup); checks++;
assert.deepEqual(await api.recover(pickupOp), pickup); checks++;
check((await refillApi.read(refillId, patient.id))?.refill.state === 'closed', 'Pickup atomically closes only its linked request');
check((await api.history('pickups')).pickups.length === 1 && (await api.read())?.usage.fulfillment_head.version === 4, 'Pickup is one handoff, not another allowance event');
await denied('record_native_pickup', { p_id: randomUUID(), p_request: pickupOp.payload }, '23514', staff.headers);
const printable = await rpc('read_native_prescription_print', { p_authorization_id: authorization.id, p_dispense_id: first.id }, staff.headers);
check(renderReviewedPrescriptionCopy(printable, { patientId: patient.id, authorizationId: authorization.id, dispenseId: first.id }).includes('Synthetic cancellation after fulfillment'), 'Actual dispensing copy retains fresh cancellation warning');
assert.deepEqual(printable.dispense, first.result.dispense.artifact); checks++;
check(sql(`select count(*) from billing_invoice_items where invoice_id=${quote(invoiceId)}`) === '3' && sql(`select sum(amount_cents)::text from billing_invoice_items where invoice_id=${quote(invoiceId)}`) === '438', 'Three dispenses produce exactly three charges, no pickup/print/retry charges');
check(sql(`select sum(quantity)::text from inventory_movements where lot_id in (${lots.map(quote).join(',')})`) === '16.500', 'Stock balance equals exact actual dispensing quantity');
check(untouched === sql("select jsonb_build_object('treatments',(select count(*) from patient_treatments),'due',(select count(*) from patient_vaccine_due_plans),'outbox',(select count(*) from communication_outbox))::text"), 'Dispensing never creates administration, due-plan or delivery records');
check(await rpc('read_native_fulfillment', { p_authorization_id: authorization.id, p_pet_id: randomUUID() }, staff.headers) === null, 'Fulfillment read cannot cross patient boundary');
for (const endpoint of ['read_native_fulfillment','list_native_fill_slots','list_native_dispenses','list_native_slot_closures','list_native_pickups']) await denied(endpoint, { p_authorization_id: authorization.id, p_pet_id: patient.id }, '42501', service);
for (const table of ['native_fill_slots', 'native_dispenses', 'native_dispense_allocations', 'native_slot_closures', 'native_pickups', 'native_fulfillment_events', 'native_fulfillment_operations']) {
  for (const headers of [staff.headers, service]) {
    const response = await fetch(`${local.API_URL}/rest/v1/${table}?limit=1`, { headers, signal: AbortSignal.timeout(15000) });
    check(response.status === 403 && (await response.json()).code === '42501', `${table} raw reads denied; staff use scoped RPCs`);
    const inserted = await post(`/rest/v1/${table}`, { id: randomUUID() }, headers);
    check(!inserted.ok && inserted.value.code === '42501', `${table} direct inserts denied`);
  }
}
sql(`update profiles set is_active=false where id=${quote(staff.id)};`);
await denied('recover_native_fulfillment_operation', { p_id: operation.id }, '42501', staff.headers);
console.log(JSON.stringify({ synthetic_only: true, suite: 'native-fulfillment-http', checks_passed: checks, provider_requests: 0, project_id: projectId, cleanup: 'Owned runtime must be removed by caller.' }));
