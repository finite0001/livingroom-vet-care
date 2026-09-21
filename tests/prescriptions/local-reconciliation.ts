import { readOwnedRuntimeStatus } from "../estimates/owned-runtime-status.ts";
/** Real Auth/PostgREST acceptance. Requires an explicitly owned disposable runtime.
 * Does not start/reset/stop databases, contact providers, or erase signed history.
 * The owning harness must destroy its disposable runtime after this script exits. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createNativeReturnPolicyApi } from '../../src/hub/features/prescriptions/fulfillment-returns-api.ts';
import { createFulfillmentApi } from '../../src/hub/features/prescriptions/fulfillment-api.ts';
import { createPrescriptionApi } from '../../src/hub/features/prescriptions/prescription-api.ts';
import { renderReviewedPrescriptionCopy } from '../../src/hub/features/prescriptions/prescription-print.ts';
import { createNativeReconciliationApi, createNativeReturnDiscrepancyApi, reconciliationAttestations } from '../../src/hub/features/prescriptions/fulfillment-reconciliation-api.ts';
import type { ReconciliationIntent, ReturnDiscrepancyIntent } from '../../supabase/functions/_shared/native-return-reconciliation-contract.ts';
import { renderRecordRelease } from '../../supabase/functions/_shared/record-release-renderer.ts';
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
const returns = createNativeReconciliationApi(adapter(doctor.headers), doctor.id, returnTarget);
const staffReturns = createNativeReconciliationApi(adapter(staff.headers), staff.id, returnTarget);
const discrepancies = createNativeReturnDiscrepancyApi(adapter(doctor.headers), doctor.id, returnTarget);
const state = await returns.read(); assert.ok(state);
const allocationId = state.allocations[0].allocation_id;
const immutable = () => sql(`select jsonb_build_object('dispense',(select document from native_dispenses where id=${quote(dispenseId)}),'negative',(select jsonb_agg(to_jsonb(m) order by id) from inventory_movements m where kind='dispense'),'items',(select jsonb_agg(to_jsonb(i) order by id) from billing_invoice_items i),'slots',(select jsonb_agg(to_jsonb(s) order by id) from native_fill_slots s),'payments',(select count(*) from invoice_payments),'credits',(select count(*) from billing_credits))::text`);
const original = immutable();
function intent(action: ReconciliationIntent['action'], quantity: string, intake: string | null = null, source: { id: string; record_hash: string } | null = null): ReconciliationIntent {
 return { target: returnTarget, action, intake_id: intake, correction_target: source ? { event_id: source.id, record_hash: source.record_hash } : null, discrepancy_id: null, allocations: [{ allocation_id: allocationId, quantity }], custody: action === 'intake' ? 'clinic_retained' : null, package_condition: action === 'intake' ? 'sealed_intact' : null, storage_history: action === 'intake' ? 'controlled' : null, reason: 'Synthetic reviewed physical reconciliation', note: 'Synthetic attributed correction for client disclosure' };
}
async function append(i: ReconciliationIntent, api = returns) {
 const preview = await api.preview(i); check(preview.allowed, 'Actual reviewed reconciliation allowed');
 const operation = { id: randomUUID(), kind: 'record_return_v2' as const, payload: { intent: i, expected_context_hash: preview.context_hash, expected_head: preview.context.head, expected_discrepancy_head: preview.context.discrepancy_head, attest_review: true, attest_restock: i.action === 'restock', physical_attestations: reconciliationAttestations(i.action) } };
 const receipt = await api.execute(operation);
 assert.deepEqual(await api.recover(operation), receipt); checks++;
 return { operation, receipt };
}
const intake = await append(intent('intake', '0.750'), staffReturns);
const disposal = await append(intent('dispose', '0.250', intake.receipt.id), staffReturns);
const returnPolicy = createNativeReturnPolicyApi(adapter(doctor.headers), doctor.id);
const policyBefore = await returnPolicy.read();
await returnPolicy.execute({ id: randomUUID(), kind: 'configure_return_policy', payload: { expected_version: policyBefore.version, enabled: true, review_reference: 'Synthetic disposable restock commissioning only', attest_review: true } });
const restock = await append(intent('restock', '0.500', intake.receipt.id));
const retractStock = await append(intent('retract_restock', '0.250', intake.receipt.id, restock.receipt.result));
const negative = retractStock.receipt.result.allocations[0].movement_id; assert.ok(negative);
const stock = JSON.parse(sql(`select to_jsonb(m) from inventory_movements m where id=${quote(negative)}`));
check(Number(stock.quantity) === -0.25 && stock.lot_id === lots[0], 'Actual retraction inserts exact negative source-lot compensation');
const retractDisposalIntent = intent('retract_disposal', '0.125', intake.receipt.id, disposal.receipt.result);
const dvmPreview = await returns.preview(retractDisposalIntent);
await denied('record_native_dispense_return_v2', { p_id: randomUUID(), p_request: { intent: retractDisposalIntent, expected_context_hash: dvmPreview.context_hash, expected_head: dvmPreview.context.head, expected_discrepancy_head: dvmPreview.context.discrepancy_head, attest_review: true, attest_restock: false, physical_attestations: reconciliationAttestations('retract_disposal') } }, '42501', staff.headers);
await append(retractDisposalIntent);
const retractIntake = await append(intent('retract_intake', '0.125', intake.receipt.id, intake.receipt.result));
assert.deepEqual(await returns.execute(retractIntake.operation), retractIntake.receipt); checks++;
await denied('preview_native_dispense_return_v2', { p_intent: intent('retract_disposal', '0.126', intake.receipt.id, disposal.receipt.result) }, '23514');
const wrong = await rpc('read_native_dispense_returns_v2', { p_authorization_id: authorization.id, p_pet_id: randomUUID(), p_dispense_id: dispenseId });
check(wrong === null, 'Wrong patient cannot read return reconciliation');
const page = await returns.history(null, 2); check(page.events.length === 2 && page.next_before_version !== null, 'Strict API accepts actual bounded mixed action history');
const intakeRead = await returns.readIntake(intake.receipt.id); check(intakeRead?.intake.id === intake.receipt.id, 'Strict current intake read binds original intake');
const selection = { native_prescription_ids: [authorization.id], native_dispense_ids: [dispenseId] };
const releaseArgs = { p_pet_id: patient.id, p_client_id: client.id, p_channel: 'EMAIL', p_recipient: client.primary_email, p_selection: selection };
const preview13 = await rpc('preview_record_release_v13', releaseArgs);
check(renderRecordRelease({ preview: preview13 }).includes('Synthetic attributed correction'), 'Actual schema13 clinical renderer accepts compensation disclosure');
policy(12);
const confirmArgs = { ...releaseArgs, p_id: randomUUID(), p_reviewed_snapshot: preview13.snapshot, p_reviewed_hash: preview13.source_hash, p_attest_review: true };
await denied('confirm_record_release', confirmArgs, '42501');
policy(13); const saved = await rpc('confirm_record_release', confirmArgs);
const reportIntent: ReturnDiscrepancyIntent = { target: returnTarget, action: 'report', case_id: null, source: { event_id: disposal.receipt.id, record_hash: disposal.receipt.result.record_hash }, allocations: [{ allocation_id: allocationId, quantity: '0.125' }], observation: 'Synthetic unresolved physical discrepancy', correction_ids: [] };
async function decide(i: ReturnDiscrepancyIntent) {
 const p = await discrepancies.preview(i); check(p.allowed, 'Reviewed discrepancy decision allowed');
 const operation = { id: randomUUID(), kind: 'record_return_discrepancy' as const, payload: { intent: i, expected_context_hash: p.context_hash, expected_return_head: p.context.return_head, expected_discrepancy_head: p.context.discrepancy_head, attest_physical_review: true, attest_original_quantities_custody_and_stock_accurate: i.action === 'resolve_confirmed_original' } };
 const receipt = await discrepancies.execute(operation); assert.deepEqual(await discrepancies.recover(operation), receipt); checks++;
 return { operation, receipt };
}
const report = await decide(reportIntent);
check((await returns.read())?.discrepancies.open_case_count === 1, 'Actual report exposes open discrepancy');
check((await rpc('read_record_release', { p_id: saved.id })).eligible === false, 'Discrepancy invalidates previously saved schema13');
assert.deepEqual(await rpc('confirm_record_release', confirmArgs), saved); checks++;
const openSlot = await api.read(); assert.ok(openSlot?.open_slot);
const heldTarget = { ...target, expected_slot_version: openSlot.open_slot.version };
const heldPreview = await api.previewDispense(heldTarget);
await denied('record_native_dispense', { p_id: randomUUID(), p_request: { ...heldTarget, expected_context_hash: heldPreview.context_hash, reason: 'Synthetic held-lot denial', attest_alert_review: true, attest_dispense_review: true } }, '23514', staff.headers);
await decide({ ...reportIntent, action: 'note', case_id: report.receipt.id, observation: 'Synthetic additional physical review' });
await decide({ ...reportIntent, action: 'resolve_confirmed_original', case_id: report.receipt.id, observation: 'Synthetic DVM confirmed original remaining quantity and custody' });
check((await returns.read())?.discrepancies.open_case_count === 0, 'Explicit DVM resolution clears open case without erasing report');
const available = await api.previewDispense({ ...target, expected_slot_version: openSlot.open_slot.version });
check(!!available.context_hash, 'Resolved discrepancy releases lot for a fresh dispensing review');
const print = await rpc('read_native_prescription_print_v4', { p_authorization_id: authorization.id, p_dispense_id: dispenseId });
check(renderReviewedPrescriptionCopy(print, { authorizationId: authorization.id, patientId: patient.id, dispenseId }).includes('Synthetic unresolved physical discrepancy'), 'Actual print4 preserves resolved discrepancy history');
await denied('read_native_prescription_print_v3', { p_authorization_id: authorization.id, p_dispense_id: dispenseId }, '23514');
await denied('preview_record_release_v12', releaseArgs, '23514');
const stockCaseIntent = { ...reportIntent, source: { event_id: restock.receipt.id, record_hash: restock.receipt.result.record_hash }, observation: 'Synthetic restock discrepancy requiring actual compensation' };
const stockCase = await decide(stockCaseIntent);
const linkedCorrection = await append({ ...intent('retract_restock', '0.125', intake.receipt.id, restock.receipt.result), discrepancy_id: stockCase.receipt.id });
await decide({ ...stockCaseIntent, action: 'resolve_corrected', case_id: stockCase.receipt.id, correction_ids: [linkedCorrection.receipt.id], observation: 'Synthetic resolution linked to actual exact compensation' });
await decide({ ...reportIntent, source: { event_id: intake.receipt.id, record_hash: intake.receipt.result.record_hash }, observation: 'Synthetic unresolved intake discrepancy retained for restore verification' });
check((await returns.read())?.discrepancies.open_case_count === 1, 'Retained unresolved case provides actual lot-hold restore evidence');
check(immutable() === original, 'Reconciliation preserves signed dispense, original negative movements, billing and allowance');
for (const headers of [anonymous, service]) await denied('native_reconciliation_disclosure', { p_authorization_id: authorization.id, p_pet_id: patient.id, p_dispense_id: dispenseId }, '42501', headers);
console.log(JSON.stringify({ synthetic_only: true, suite: 'native-reconciliation-local-auth', checks_passed: checks, provider_requests: 0, project_id: projectId, cleanup: 'Owned runtime must be destroyed by parent harness' }));
