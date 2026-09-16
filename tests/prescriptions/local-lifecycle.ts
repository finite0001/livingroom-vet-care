/** Real Auth/PostgREST acceptance. Requires an explicitly owned disposable runtime.
 * Does not start/reset/stop databases, contact providers, or erase signed history.
 * The owning harness must destroy its disposable runtime after this script exits. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createNativeRefillApi } from '../../src/hub/features/refills/refill-api.ts';
import { createPrescriptionApi } from '../../src/hub/features/prescriptions/prescription-api.ts';
import { renderReviewedPrescriptionCopy } from '../../src/hub/features/prescriptions/prescription-print.ts';
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
// Real authorized printing reads a current status separately from the immutable order.
const printTarget = { patientId: patient.id, authorizationId: signId, dispenseId: null };
const originalBundle = await doctorApi.readPrint(signed.result);
check(renderReviewedPrescriptionCopy(originalBundle, printTarget).includes('Signed prescription order copy'), 'Current authorized order copy renders');
assert.deepEqual(originalBundle.prescription, signed.result.artifact); checks++;
await denied('read_native_prescription_print', { p_authorization_id: signId, p_dispense_id: randomUUID() }, '23514');
check(await rpc('read_native_prescription_status', { p_authorization_id: signId, p_pet_id: randomUUID() }) === null, 'Status cannot cross patient boundary');
const nextDraftId = randomUUID();
await rpc('save_native_prescription_draft', { p_id: randomUUID(), p_request: { ...saveRequest, draft_id: nextDraftId, fields: { ...fields, quantity_per_fill: '15', refills_authorized: 0 } } }, staff.headers);
const nextDraft = await doctorApi.readDraft(nextDraftId);
assert.ok(nextDraft);
const replacementPreview = await doctorApi.previewReplacement(signed.result, nextDraft);
check(replacementPreview.context.prior.usage.remaining_quantity === null && replacementPreview.context.prior.usage.external_fulfillment === 'unknown', 'Unavailable usage is never reported as unused allowance');
const replaceId = randomUUID();
const replacementRequest = {
  authorization_id: signId, pet_id: patient.id,
  expected_event_id: replacementPreview.context.prior.head.id,
  expected_context_hash: replacementPreview.context_hash,
  reason: 'Synthetic independently reviewed replacement.', attest_review: true,
  draft_id: nextDraftId, expected_version: 1,
  signature_name: replacementPreview.context.new_sign.prescriber.name,
  reconciliation: { native_use_note: 'Synthetic review: native fill accounting unavailable.', external_use_status: 'reconciled', external_use_note: 'Synthetic manual reconciliation only; no pharmacy contacted.', remaining_allowance_note: 'Synthetic new allowance deliberately authored as 15 with no refills.', attest_review: true },
};
await denied('replace_native_prescription', { p_id: randomUUID(), p_request: { ...replacementRequest, reconciliation: { ...replacementRequest.reconciliation, external_use_status: 'unknown' } } }, '23514');
await denied('replace_native_prescription', { p_id: randomUUID(), p_request: replacementRequest }, '42501', staff.headers);
const replaced = await rpc('replace_native_prescription', { p_id: replaceId, p_request: replacementRequest });
check(replaced.operation === 'replace' && replaced.result.authorization.id === replaceId && replaced.result.event.replacement_id === replaceId && replaced.result.event.authorization_id === signId, 'Replacement receipt atomically binds both authorizations');
assert.deepEqual(await rpc('replace_native_prescription', { p_id: replaceId, p_request: replacementRequest }), replaced); checks++;
assert.deepEqual(await doctorApi.readAuthorization(signId), signed.result); checks++;
assert.deepEqual(await doctorApi.recover({ id: replaceId, kind: 'replace', payload: replacementRequest }), replaced); checks++;
const oldStatus = await doctorApi.readStatus(signed.result);
assert.ok(oldStatus);
check(oldStatus.status.state === 'replaced' && oldStatus.status.replacement_id === replaceId && oldStatus.head_version === 1, 'Original order has one terminal replacement event');
const oldBundle = await doctorApi.readPrint(signed.result);
assert.deepEqual(oldBundle.prescription, originalBundle.prescription); checks++;
check(oldBundle.status.state === 'replaced' && renderReviewedPrescriptionCopy(oldBundle, printTarget).includes('Synthetic independently reviewed replacement.'), 'Historical copy preserves instructions and includes current replacement reason');
const cancelPreview = await doctorApi.previewCancel(replaced.result.authorization);
const cancelId = randomUUID();
const cancelRequest = { authorization_id: replaceId, pet_id: patient.id, expected_event_id: cancelPreview.context.head.id, expected_context_hash: cancelPreview.context_hash, reason: 'Synthetic cancellation after replacement.', attest_review: true };
await denied('cancel_native_prescription', { p_id: randomUUID(), p_request: cancelRequest }, '42501', staff.headers);
const cancelled = await rpc('cancel_native_prescription', { p_id: cancelId, p_request: cancelRequest });
check(cancelled.operation === 'cancel' && cancelled.result.authorization_id === replaceId && cancelled.result.replacement_id === null, 'Cancellation targets the new order and creates no successor');
assert.deepEqual(await rpc('cancel_native_prescription', { p_id: cancelId, p_request: cancelRequest }), cancelled); checks++;
assert.deepEqual(await rpc('replace_native_prescription', { p_id: replaceId, p_request: replacementRequest }), replaced); checks++;
await denied('cancel_native_prescription', { p_id: cancelId, p_request: { ...cancelRequest, reason: 'Changed reuse is forbidden.' } }, '23514');
assert.deepEqual(await doctorApi.recover({ id: cancelId, kind: 'cancel', payload: cancelRequest }), cancelled); checks++;
const cancelledBundle = await doctorApi.readPrint(replaced.result.authorization);
check(cancelledBundle.status.state === 'cancelled' && renderReviewedPrescriptionCopy(cancelledBundle, { ...printTarget, authorizationId: replaceId }).includes(cancelRequest.reason), 'Fresh print discloses cancelled status');
const events = await doctorApi.listEvents(replaced.result.authorization);
check(events.events.length === 1 && events.events[0].id === cancelId && events.has_more === false && events.next_cursor === null, 'Event history preserves exact terminal receipt');
check(beforeEffects === sql('select jsonb_build_object(\'stock\',(select count(*) from public.inventory_movements),\'charges\',(select count(*) from public.billing_invoice_items),\'treatments\',(select count(*) from public.patient_treatments),\'outbox\',(select count(*) from public.communication_outbox))::text'), 'Replacement/cancellation/printing have no stock, charge, treatment or sending effects');
await denied('recover_native_prescription_operation', { p_id: signId }, '42501', anonymous);
await denied('recover_native_prescription_operation', { p_id: signId }, '42501', service);
// Native refill intake is operational only, with its own immutable receipts.
const refillApi = createNativeRefillApi(adapter(staff.headers), staff.id);
const refillId = randomUUID(), refillCreateId = randomUUID();
const refillCreate = { refill_id: refillId, pet_id: patient.id, client_id: client.id, medication_requested: 'Synthetic refill request', requester_note: 'Synthetic intake, not clinical authorization.', channel: 'phone', reason: 'Synthetic staff intake.' };
const refillCreated = await refillApi.execute({ id: refillCreateId, kind: 'create_refill', payload: refillCreate });
check(refillCreated.actor_id === staff.id && refillCreated.result.action === 'create' && refillCreated.result.after.state === 'open' && refillCreated.result.after.authorization_id === null, 'Staff intake creates unlinked operational request only');
assert.deepEqual(await rpc('create_native_refill', { p_id: refillCreateId, p_request: refillCreate }, staff.headers), refillCreated); checks++;
assert.deepEqual(await refillApi.recover({ id: refillCreateId, kind: 'create_refill', payload: refillCreate }), refillCreated); checks++;
check(await rpc('recover_native_refill_operation', { p_id: refillCreateId }) === null, 'Other actor cannot recover refill receipt');
await denied('create_native_refill', { p_id: refillCreateId, p_request: { ...refillCreate, medication_requested: 'Changed UUID reuse' } }, '23514', staff.headers);
check(await rpc('read_native_refill', { p_refill_id: refillId, p_pet_id: randomUUID() }) === null, 'Refill read enforces exact patient');
const refillAssign = { refill_id: refillId, pet_id: patient.id, expected_version: 1, action: 'assign', reason: 'Synthetic staff assignment.', assigned_to: doctor.id, authorization_id: null, expected_link_context_hash: null };
const refillAssignId = randomUUID();
const refillAssigned = await refillApi.execute({ id: refillAssignId, kind: 'transition_refill', payload: refillAssign });
check(refillAssigned.result.after.version === 2 && refillAssigned.result.after.assigned_to === doctor.id && refillAssigned.result.before.version === 1, 'Assignment records exact before/after revision');
await denied('transition_native_refill', { p_id: randomUUID(), p_request: refillAssign }, '40001', staff.headers);
// New exact order: linking cannot reuse or silently follow the replaced/cancelled orders above.
const refillDraftId = randomUUID(), refillSignId = randomUUID();
await rpc('save_native_prescription_draft', { p_id: randomUUID(), p_request: { ...saveRequest, draft_id: refillDraftId } }, staff.headers);
const refillSignPreview = await rpc('preview_native_prescription_sign', { p_draft_id: refillDraftId, p_expected_version: 1 });
await rpc('sign_native_prescription', { p_id: refillSignId, p_request: { ...signRequest, draft_id: refillDraftId, expected_context_hash: refillSignPreview.context_hash } });
const refillLinkPreview = await refillApi.previewLink(refillAssigned.result.after, refillSignId);
const refillLink = { ...refillAssign, expected_version: 2, action: 'link', reason: 'Synthetic exact order link; not dispensing approval.', assigned_to: null, authorization_id: refillSignId, expected_link_context_hash: refillLinkPreview.context_hash };
const refillLinkId = randomUUID();
const refillLinked = await refillApi.execute({ id: refillLinkId, kind: 'transition_refill', payload: refillLink });
check(refillLinked.result.after.authorization_id === refillSignId && refillLinked.result.after.version === 3 && refillLinked.result.link_context.authorization_id === refillSignId, 'Link receipt binds reviewed exact authorization and request revision');
const linkedRead = await refillApi.read(refillId, patient.id);
assert.ok(linkedRead);
check(linkedRead.operational_only === true && linkedRead.authorization_status.state === 'active' && linkedRead.household_matches === true, 'Queue separately discloses current linked status');
const linkedCancelPreview = await rpc('preview_native_prescription_cancel', { p_authorization_id: refillSignId, p_pet_id: patient.id });
await rpc('cancel_native_prescription', { p_id: randomUUID(), p_request: { ...cancelRequest, authorization_id: refillSignId, expected_event_id: linkedCancelPreview.context.head.id, expected_context_hash: linkedCancelPreview.context_hash } });
const terminalLinkedRead = await refillApi.read(refillId, patient.id);
assert.ok(terminalLinkedRead);
check(terminalLinkedRead.refill.authorization_id === refillSignId && terminalLinkedRead.authorization_status.state === 'cancelled' && terminalLinkedRead.refill.state === 'open', 'Cancellation is disclosed without changing or replacing linked intake');
assert.deepEqual(await refillApi.recover({ id: refillLinkId, kind: 'transition_refill', payload: refillLink }), refillLinked); checks++;
const refillClose = { ...refillAssign, expected_version: 3, action: 'close', reason: 'Synthetic operational closure.', assigned_to: null };
const refillCloseId = randomUUID();
const refillClosed = await refillApi.execute({ id: refillCloseId, kind: 'transition_refill', payload: refillClose });
check(refillClosed.result.after.state === 'closed' && refillClosed.result.after.version === 4, 'Operational closure retains linked historical order');
assert.deepEqual(await rpc('transition_native_refill', { p_id: refillCloseId, p_request: refillClose }, staff.headers), refillClosed); checks++;
const refillHistory = await refillApi.history(refillClosed.result.after, null, 2);
check(refillHistory.events.length === 2 && refillHistory.has_more && refillHistory.next_cursor !== null, 'Refill event history advertises additional pages');
const refillHistoryNext = await refillApi.history(refillClosed.result.after, refillHistory.next_cursor, 2);
check(refillHistoryNext.events.length === 2 && !refillHistoryNext.has_more && !refillHistoryNext.events.some((event: { id: string }) => refillHistory.events.some((prior: { id: string }) => prior.id === event.id)), 'Exact event cursor avoids omissions and duplicates');
const refillQueue = await refillApi.list(null, patient.id);
check(refillQueue.refills.length === 1 && refillQueue.refills[0].refill.id === refillId, 'Native queue can be scoped to exact patient');
for (const headers of [staff.headers, service]) {
  const rawInsert = await post('/rest/v1/refill_requests', { client_id: client.id, pet_id: patient.id, medication_name: 'Forbidden legacy write' }, headers);
  check(!rawInsert.ok && rawInsert.value.code === '42501', 'Legacy direct insert denied to staff/service through real PostgREST');
}
const legacyPage = await refillApi.legacy();
check(legacyPage.records.every(row => row.read_only === true && row.clinical_authority === 'unverified'), 'Strict legacy API labels every preserved row non-authorizing');
const legacyTarget = legacyPage.records[0]?.record;
if (legacyTarget) {
  for (const headers of [staff.headers, service]) {
    for (const method of ['PATCH', 'DELETE']) {
      const response = await fetch(`${local.API_URL}/rest/v1/refill_requests?id=eq.${legacyTarget.id}`, { method, headers, ...(method === 'PATCH' ? { body: JSON.stringify({ status: 'APPROVED' }) } : {}), signal: AbortSignal.timeout(15000) });
      const value = await response.json();
      check(!response.ok && value.code === '42501', `Legacy ${method} rejected for authenticated/service role`);
    }
  }
}
await denied('create_native_refill', { p_id: randomUUID(), p_request: refillCreate }, '42501', anonymous);
await denied('create_native_refill', { p_id: randomUUID(), p_request: refillCreate }, '42501', service);
check(beforeEffects === sql('select jsonb_build_object(\'stock\',(select count(*) from public.inventory_movements),\'charges\',(select count(*) from public.billing_invoice_items),\'treatments\',(select count(*) from public.patient_treatments),\'outbox\',(select count(*) from public.communication_outbox))::text'), 'Native intake/link/close have no inventory, billing, treatment or outbound effects');
console.log(JSON.stringify({ synthetic_only: true, suite: 'native-prescription-lifecycle-http', checks_passed: checks, provider_requests: 0, project_id: projectId, cleanup: 'Owned runtime must be removed by caller; signed fixtures intentionally retained until then.' }));
