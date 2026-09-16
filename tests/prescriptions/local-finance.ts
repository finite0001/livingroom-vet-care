/** Real Auth/PostgREST acceptance. Requires an explicitly owned disposable runtime.
 * Does not start/reset/stop databases, contact providers, or erase signed history.
 * The owning harness must destroy its disposable runtime after this script exits. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createFulfillmentApi } from '../../src/hub/features/prescriptions/fulfillment-api.ts';
import { createPrescriptionApi } from '../../src/hub/features/prescriptions/prescription-api.ts';
import { createNativeDispenseFinanceApi } from '../../src/hub/features/prescriptions/dispense-finance-api.ts';
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
const target = { authorization_id: authorization.id, pet_id: patient.id, slot_index: 0, expected_slot_version: null, invoice_id: invoiceId, quantity: '1', allocations: [{ lot_id: lots[0], quantity: '1' }], refill: null };
const dispensePreview = await api.previewDispense(target);
const dispenseId = randomUUID();
await api.execute({ id: dispenseId, kind: 'dispense', payload: { ...target, expected_context_hash: dispensePreview.context_hash, reason: 'Synthetic release fixture partial', attest_alert_review: true, attest_dispense_review: true } });
const financeTarget = { authorization_id: authorization.id, pet_id: patient.id, dispense_id: dispenseId };

// Only the owned disposable database receives synthetic payment evidence. No
// checkout URL is opened and no Stripe request or client message is dispatched.
await rpc('issue_billing_invoice', { p_id: invoiceId, p_expected_version: Number(sql(`select version from billing_invoices where id=${quote(invoiceId)}`)) }, staff.headers);
const existingProfiles = JSON.parse(sql('select coalesce(jsonb_agg(to_jsonb(p)),\'[]\') from payment_provider_profiles p'));
check(existingProfiles.length <= 1 && existingProfiles.every((p: { livemode: boolean }) => p.livemode === false), 'Disposable runtime contains only a synthetic sandbox profile');
const profile = existingProfiles[0] ?? await rpc('configure_payment_provider', {
  p_account_id: `acct_Synthetic${randomUUID().replaceAll('-', '')}`,
  p_livemode: false,
  p_return_origin: 'https://synthetic.example.test',
}, service);
const checkoutState = await rpc('read_invoice_payment_state', { p_invoice_id: invoiceId, p_client_id: client.id }, staff.headers);
const checkoutId = randomUUID();
const providerPaymentId = `pi_Synthetic${randomUUID().replaceAll('-', '')}`;
await rpc('prepare_invoice_checkout', {
  p_request_id: checkoutId, p_invoice_id: invoiceId, p_client_id: client.id,
  p_source_hash: checkoutState.source_hash, p_amount_cents: 125,
  p_account_id: profile.account_id, p_livemode: false,
  p_success_url: `${profile.return_origin}/payment/return`,
  p_cancel_url: `${profile.return_origin}/payment/cancel`,
}, staff.headers);
const paidEvidence = await rpc('apply_checkout_evidence', {
  p_event_id: `evt_Synthetic${randomUUID().replaceAll('-', '')}`,
  p_request_id: checkoutId, p_account_id: profile.account_id, p_livemode: false,
  p_kind: 'payment_succeeded', p_session_id: `cs_test_Synthetic${checkoutId.replaceAll('-', '')}`,
  p_payment_id: providerPaymentId, p_amount_cents: 125, p_currency: 'usd',
  p_source_hash: checkoutState.source_hash,
}, service);
check(paidEvidence.disposition === 'accepted', 'Synthetic accepted evidence records captured cash through the existing ledger');
const payment = JSON.parse(sql(`select to_jsonb(p) from invoice_payments p where invoice_id=${quote(invoiceId)}`));
check(payment.amount_cents === 125, 'Exact original charge is captured in the disposable fixture');
const immutable = () => sql(`select jsonb_build_object('dispense',(select document from native_dispenses where id=${quote(dispenseId)}),'items',(select jsonb_agg(to_jsonb(i) order by id) from billing_invoice_items i where invoice_id=${quote(invoiceId)}),'stock',(select jsonb_agg(to_jsonb(m) order by id) from inventory_movements m where lot_id in (${lots.map(quote).join(',')})),'slots',(select jsonb_agg(to_jsonb(s) order by id) from native_fill_slots s where authorization_id=${quote(authorization.id)}))::text`);
const original = immutable();
const finance = createNativeDispenseFinanceApi(adapter(staff.headers), staff.id, financeTarget);
const readFinance = () => finance.read();
interface FinanceIntent {
  target: typeof financeTarget;
  action: 'credit' | 'refund';
  amount_cents: string;
  reason: string;
  credit_id: string | null;
  payment_id: string | null;
}
const creditIntent = (amount = '60'): FinanceIntent => ({ target: financeTarget, action: 'credit', amount_cents: amount, reason: 'Synthetic reviewed accounting adjustment', credit_id: null, payment_id: null });
const previewFinance = (intent: FinanceIntent) => finance.preview(intent);
const review = async (intent: FinanceIntent) => {
  const preview = await previewFinance(intent);
  check(preview.allowed, 'Actual reviewed financial adjustment is allowed');
  return { intent, expected_context_hash: preview.context_hash, attest_review: true as const };
};
const record = async (request: Awaited<ReturnType<typeof review>>, id = randomUUID()) => {
  const operation = { id, kind: 'record_native_dispense_finance' as const, payload: request };
  const receipt = await finance.execute(operation);
  assert.deepEqual(await finance.recover(operation), receipt); checks++;
  assert.deepEqual(await finance.execute(operation), receipt); checks++;
  return receipt;
};
const initial = await readFinance();
check(initial.snapshot.capacity.credit_capacity_cents === '125', 'Native item initially has exact original charge capacity');
const staleCredit = await review(creditIntent());
const abandonedOperation = { id: randomUUID(), kind: 'record_native_dispense_finance', payload: staleCredit };
const genericCreditId = randomUUID();
await rpc('credit_billing_invoice', { p_id: genericCreditId, p_invoice_id: invoiceId, p_amount_cents: 10, p_reason: '  Synthetic unallocated invoice credit  ' }, staff.headers);
await denied('record_native_dispense_finance', { p_id: randomUUID(), p_request: staleCredit }, '40001', staff.headers);
check(await finance.recover(abandonedOperation) === null, 'Lost-before-write request has no recorded receipt');
const closed = await finance.close(abandonedOperation);
check(closed.status === 'closed_unrecorded' && closed.closure.id === abandonedOperation.id, 'Stale request closes through actual Auth with exact immutable evidence');
assert.deepEqual(await finance.close(abandonedOperation), closed); checks++;
await denied('record_native_dispense_finance', { p_id: abandonedOperation.id, p_request: staleCredit }, '23514', staff.headers);
await denied('close_native_dispense_finance', { p_id: abandonedOperation.id, p_request: staleCredit }, '42501', doctor.headers);
await denied('close_native_dispense_finance', { p_id: abandonedOperation.id, p_request: { ...staleCredit, intent: { ...staleCredit.intent, amount_cents: '61' } } }, '23514', staff.headers);
const afterGeneric = await readFinance();
check(afterGeneric.snapshot.capacity.credit_capacity_cents === '115' && afterGeneric.snapshot.capacity.unallocated_credit_cents === '10', 'Unallocated invoice credit conservatively consumes potential item capacity');
const nativeCredit = await record(await review(creditIntent()));
const recordedResolution = await finance.close({ id: nativeCredit.id, kind: 'record_native_dispense_finance', payload: nativeCredit.request });
check(recordedResolution.status === 'recorded', 'Resolution finds an already committed operation instead of closing it');
if (recordedResolution.status === 'recorded') { assert.deepEqual(recordedResolution.receipt, nativeCredit); checks++; }
check(nativeCredit.result.credit_id === nativeCredit.id && nativeCredit.result.refund_request_id === null, 'Accounting credit has exact native attribution and creates no refund');
const afterCredit = await readFinance();
check(afterCredit.snapshot.capacity.credit_capacity_cents === '55', 'Partial native credit leaves exact remaining item capacity');
check(afterCredit.snapshot.balance.paid_cents === '125' && afterCredit.snapshot.balance.refunded_cents === '0', 'Credit changes obligation without returning cash');
check(afterCredit.snapshot.credits.find((row: { id: string }) => row.id === genericCreditId).dispense_id === null, 'Generic credit remains explicitly unallocated');
check(afterCredit.snapshot.credits.find((row: { id: string }) => row.id === genericCreditId).reason === '  Synthetic unallocated invoice credit  ', 'Existing generic reason is preserved without imposing new native normalization');
await denied('record_native_dispense_finance', { p_id: nativeCredit.id, p_request: { ...nativeCredit.request, intent: { ...nativeCredit.request.intent, amount_cents: '61' } } }, '23514', staff.headers);
await denied('recover_native_dispense_finance', { p_id: nativeCredit.id }, '42501', doctor.headers);
await denied('read_native_dispense_finance', { p_authorization_id: authorization.id, p_pet_id: randomUUID(), p_dispense_id: dispenseId }, '23514', staff.headers);
const overCredit = await previewFinance(creditIntent('56'));
check(!overCredit.allowed && overCredit.blockers.includes('credit_capacity_exceeded'), 'Preview explains excess item credit without writing');
const refundIntent = (amount: string): FinanceIntent => ({ target: financeTarget, action: 'refund', amount_cents: amount, reason: 'Synthetic reviewed refund reservation', credit_id: nativeCredit.id, payment_id: payment.id });
const failedRequest = await record(await review(refundIntent('25')));
check(failedRequest.result.refund_request_id === failedRequest.id && failedRequest.result.credit_id === nativeCredit.id, 'Refund reservation links the exact credit and payment');
check((await readFinance()).snapshot.balance.refunded_cents === '0', 'Reservation alone does not post refunded cash');
const settle = async (requestId: string, amount: number, status: 'pending' | 'failed' | 'succeeded') => {
  const result = await rpc('apply_refund_evidence', {
    p_event_id: `evt_Synthetic${randomUUID().replaceAll('-', '')}`, p_request_id: requestId,
    p_account_id: profile.account_id, p_livemode: false,
    p_refund_id: `re_Synthetic${requestId.replaceAll('-', '')}`, p_provider_payment_id: providerPaymentId,
    p_amount_cents: amount, p_currency: 'usd', p_status: status,
  }, service);
  check(result.disposition === 'accepted', 'Synthetic refund evidence matches original reservation');
};
await settle(failedRequest.id, 25, 'failed');
check((await previewFinance(refundIntent('60'))).context.eligible_amount_cents === '60', 'Confirmed failed reservation releases linked credit capacity');
const successfulRequest = await record(await review(refundIntent('20')));
await settle(successfulRequest.id, 20, 'succeeded');
const pendingRequest = await record(await review(refundIntent('10')));
const finalRead = await readFinance();
check(finalRead.snapshot.balance.refunded_cents === '20' && finalRead.snapshot.balance.pending_refund_cents === '10', 'Settled cash and pending reservations are counted separately');
check((await previewFinance(refundIntent('30'))).context.eligible_amount_cents === '30', 'Settled and pending linked requests each consume credit capacity once');
check(!((await previewFinance(refundIntent('31'))).allowed), 'Additional refund cannot exceed remaining attributed credit');
check(finalRead.snapshot.refunds.find((row: { id: string }) => row.id === pendingRequest.id).state === 'pending', 'Unsent reservation remains pending without provider execution');
assert.deepEqual(await rpc('recover_native_dispense_finance', { p_id: nativeCredit.id }, staff.headers), nativeCredit); checks++;
assert.deepEqual(await rpc('recover_native_dispense_finance', { p_id: successfulRequest.id }, staff.headers), successfulRequest); checks++;
check(immutable() === original, 'Financial adjustments preserve original dispense, item, stock and allowance');
for (const headers of [anonymous, service]) await denied('record_native_dispense_finance', { p_id: randomUUID(), p_request: nativeCredit.request }, '42501', headers);
for (const headers of [anonymous, service]) await denied('close_native_dispense_finance', { p_id: abandonedOperation.id, p_request: staleCredit }, '42501', headers);
console.log(JSON.stringify({ synthetic_only: true, suite: 'native-finance-local-auth', checks_passed: checks, provider_requests: 0, project_id: projectId, cleanup: 'Owned runtime must be destroyed by parent harness' }));
