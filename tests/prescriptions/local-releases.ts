/** Real Auth/PostgREST acceptance. Requires an explicitly owned disposable runtime.
 * Does not start/reset/stop databases, contact providers, or erase signed history.
 * The owning harness must destroy its disposable runtime after this script exits. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createFulfillmentApi } from '../../src/hub/features/prescriptions/fulfillment-api.ts';
import { createPrescriptionApi } from '../../src/hub/features/prescriptions/prescription-api.ts';
import { buildReleaseEmailPayload } from '../../supabase/functions/_shared/release-email-payload.ts';
import { buildDocumentLinkArtifacts } from '../../supabase/functions/_shared/document-link-artifacts.ts';
import { documentLinkConfig, materializeDocumentLink } from '../../supabase/functions/_shared/document-link-capability.ts';
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
const effects = () => sql(`select jsonb_build_object('movements',(select count(*) from inventory_movements),'items',(select count(*) from billing_invoice_items),'fulfillment',(select count(*) from native_fulfillment_events),'outbox',(select count(*) from communication_outbox))::text`);
const baseline = effects();
const selection = { native_prescription_ids: [authorization.id], native_dispense_ids: [dispenseId] };
async function preview(selected: Record<string, unknown>, channel = 'EMAIL') {
  return rpc('preview_record_release_v10', { p_pet_id: patient.id, p_client_id: client.id, p_channel: channel, p_recipient: channel === 'EMAIL' ? client.primary_email : client.primary_phone, p_selection: selected });
}
function confirmArgs(p: { snapshot: unknown; source_hash: string }, selected: Record<string, unknown>, channel = 'EMAIL') {
  return { p_id: randomUUID(), p_pet_id: patient.id, p_client_id: client.id, p_channel: channel, p_recipient: channel === 'EMAIL' ? client.primary_email : client.primary_phone, p_selection: selected, p_reviewed_snapshot: p.snapshot, p_reviewed_hash: p.source_hash, p_attest_review: true };
}
const orderOnly = await preview({ native_prescription_ids: [authorization.id], native_dispense_ids: [] });
check(orderOnly.snapshot.schema_version === 10 && orderOnly.snapshot.native_prescriptions.length === 1 && orderOnly.snapshot.native_dispenses.length === 0, 'Native-only order preview does not manufacture inherited selections');
check(renderRecordRelease({ preview: orderOnly }).includes('Selected signed prescription'), 'Actual native-only RPC snapshot renders');
const reviewed = await preview(selection);
assert.deepEqual(await preview(selection), reviewed); checks++;
const html = renderRecordRelease({ preview: reviewed });
check(html.includes('Selected recorded dispense') && html.includes('1.000') && !html.includes(invoiceId), 'Actual mixed native order/fill snapshot renders clinical evidence without invoice identity');
check(!Object.hasOwn(reviewed.snapshot.native_dispenses[0].artifact, 'invoice_id'), 'Financial field absent from actual release projection');
const args = confirmArgs(reviewed, selection);
policy(9);
await denied('confirm_record_release', args, '42501');
policy(10);
const saved = await rpc('confirm_record_release', args);
assert.deepEqual(await rpc('confirm_record_release', args), saved); checks++;
const read = await rpc('read_record_release', { p_id: saved.id });
check(read.eligible === true && read.release.source_hash === reviewed.source_hash, 'Confirmed release is eligible and bound to reviewed hash');
assert.deepEqual(read.release.snapshot, reviewed.snapshot); checks++;
check(Number(sql(`select count(*) from record_release_sources where release_id=${quote(saved.id)} and source_kind in('native_prescription','native_dispense')`)) === 2, 'Both explicit native source dependencies registered');
await denied('confirm_record_release', args, '23514', staff.headers);
// Old schema9 remains its own format, not rewritten into10.
const oldSelection = { patient_summary_ids: [patient.id] };
const old = await rpc('preview_record_release_v9', { p_pet_id: patient.id, p_client_id: client.id, p_channel: 'EMAIL', p_recipient: client.primary_email, p_selection: oldSelection });
const oldArgs = confirmArgs(old, oldSelection);
policy(9);
const oldSaved = await rpc('confirm_record_release', oldArgs);
assert.deepEqual((await rpc('read_record_release', { p_id: oldSaved.id })).release.snapshot, old.snapshot); checks++;
policy(10);
assert.deepEqual(await rpc('confirm_record_release', oldArgs), oldSaved); checks++;
const mixed = await preview({ ...selection, ...oldSelection });
check(renderRecordRelease({ preview: mixed }).includes('Selected recorded dispense'), 'Inherited patient summary plus native evidence renders');
const sms = await preview(selection, 'SMS');
const smsArgs = confirmArgs(sms, selection, 'SMS');
const smsSaved = await rpc('confirm_record_release', smsArgs);
check((await rpc('read_record_release', { p_id: smsSaved.id })).eligible === true, 'Independent SMS reviewed package remains eligible');
const discovery = await rpc('list_record_release_sources_v10', { p_pet_id: patient.id, p_offset: 0 });
check(discovery.native_prescription_ids.some((v: { id: string }) => v.id === authorization.id) && discovery.native_dispense_ids.some((v: { id: string }) => v.id === dispenseId) && discovery.policy_v10_accepted, 'Actual discovery lists only saved native evidence with policy10');
const all = await rpc('select_all_record_release_sources_v10', { p_pet_id: patient.id });
check(all.selection.native_prescription_ids.includes(authorization.id) && all.selection.native_dispense_ids.includes(dispenseId), 'Bounded select-all includes native families explicitly');
// These helpers must remain unavailable even to workers; no provider is invoked.
for (const headers of [anonymous, service, staff.headers]) {
  for (const [name, params] of [
    ['release_native_prescription', { p_id: authorization.id, p_pet_id: patient.id, p_client_id: client.id }],
    ['release_preview_v10_internal', { p_pet_id: patient.id, p_client_id: client.id, p_channel: 'EMAIL', p_recipient: client.primary_email, p_selection: selection }],
  ] as const) {
    const deniedCall = await post(`/rest/v1/rpc/${name}`, params, headers);
    check(!deniedCall.ok && [401, 403, 404].includes(deniedCall.status), 'Private release helper is not exposed to caller or worker');
  }
}
check(effects() === baseline, 'Preview/confirmation/discovery/rendering have no stock, billing or sending effects');
// Actual provider-free preparation and worker capture use both separate transports.
const conversation = randomUUID();
sql(`insert into conversations(id,client_id) values(${quote(conversation)},${quote(client.id)});`);
await rpc('record_sms_consent', { p_actor_id: doctor.id, p_client_id: client.id, p_phone: client.primary_phone, p_opted_in: true, p_method: 'WRITTEN', p_details: 'Synthetic local consent only', p_expected_updated_at: null });
const noDownload = async (): Promise<Uint8Array> => { throw new Error('Native-only fixture must not download any original'); };
async function prepareTransports(version: 9 | 10) {
  const selected = version === 10 ? selection : oldSelection;
  const packages = [];
  for (const channel of ['EMAIL', 'SMS']) {
    const p = await rpc(`preview_record_release_v${version}`, { p_pet_id: patient.id, p_client_id: client.id, p_channel: channel, p_recipient: channel === 'EMAIL' ? client.primary_email : client.primary_phone, p_selection: selected });
    const record = await rpc('confirm_record_release', confirmArgs(p, selected, channel));
    packages.push(await rpc('read_record_release', { p_id: record.id }));
  }
  const [emailBundle, smsBundle] = packages;
  const emailId = randomUUID(), linkId = randomUUID();
  await rpc('prepare_release_email', { p_request_id: emailId, p_release_id: emailBundle.release.id, p_conversation_id: conversation, p_subject: 'Synthetic reviewed native records', p_body: 'Synthetic local capture only', p_release_hash: emailBundle.release.source_hash });
  const emailContextArgs = { p_request_id: emailId, p_actor_id: doctor.id };
  const emailContext = await rpc('release_email_capture_context', emailContextArgs, service);
  const frozenEmail = await buildReleaseEmailPayload(emailContext.request, emailContext.bundle, { from: 'Synthetic <records@example.test>', replyTo: 'records@example.test' }, noDownload);
  const linkPreview = await rpc('preview_document_link', { p_family: 'record_release', p_source_id: smsBundle.release.id, p_client_id: client.id });
  await rpc('prepare_document_link', { p_request_id: linkId, p_family: 'record_release', p_source_id: smsBundle.release.id, p_client_id: client.id, p_conversation_id: conversation, p_recipient: client.primary_phone, p_source_hash: linkPreview.source_hash, p_expires_at: new Date(Date.now() + 86400000).toISOString(), p_message_template: 'Synthetic records: {{document_link}}', p_origin: 'https://thelivingroom.vet', p_key_version: 'synthetic' });
  const linkContextArgs = { p_id: linkId, p_actor_id: doctor.id };
  const linkContext = await rpc('document_link_capture_context', linkContextArgs, service);
  const capability = await materializeDocumentLink(linkContext.grant, documentLinkConfig({ origin: 'https://thelivingroom.vet', activeKeyVersion: 'synthetic', keys: JSON.stringify({ synthetic: Buffer.from('synthetic-local-secret-00000000000').toString('base64') }), publicEnabled: 'true' }));
  const frozenLink = await buildDocumentLinkArtifacts(linkContext.grant, { name: 'Synthetic', address: 'Synthetic', domain: null }, noDownload);
  return { emailId, linkId, emailContextArgs, linkContextArgs, emailCapture: { ...emailContextArgs, p_payload_text: frozenEmail.payload_text }, linkCapture: { ...linkContextArgs, p_payload_text: frozenLink.payload_text, p_token_hash: capability.token_hash, p_message_hash: capability.message_hash } };
}
async function captureTransports(t: Awaited<ReturnType<typeof prepareTransports>>) {
  await rpc('capture_release_email_payload', t.emailCapture, service);
  await rpc('capture_document_link', t.linkCapture, service);
  check(sql(`select count(*) from release_email_payloads where request_id=${quote(t.emailId)}`) === '1', 'Actual reviewed HTML email captured exactly once without sending');
  check(sql(`select count(*) from document_link_payloads where grant_id=${quote(t.linkId)}`) === '1', 'Actual reviewed HTML document link captured exactly once without delivering');
}
const transports = await prepareTransports(10);
policy(9);
await denied('release_email_capture_context', transports.emailContextArgs, '42501', service);
await denied('document_link_capture_context', transports.linkContextArgs, '42501', service);
await denied('capture_release_email_payload', transports.emailCapture, '42501', service);
await denied('capture_document_link', transports.linkCapture, '42501', service);
const legacyTransports = await prepareTransports(9);
await captureTransports(legacyTransports);
policy(10);
await captureTransports(transports);
const staleTransports = await prepareTransports(10);
sql(`update profiles set is_active=false where id=${quote(doctor.id)};`);
try {
  await denied('release_email_capture_context', staleTransports.emailContextArgs, '42501', service);
  await denied('document_link_capture_context', staleTransports.linkContextArgs, '42501', service);
  await denied('capture_release_email_payload', staleTransports.emailCapture, '42501', service);
  await denied('capture_document_link', staleTransports.linkCapture, '42501', service);
} finally { sql(`update profiles set is_active=true where id=${quote(doctor.id)};`); }

const stalePickup = confirmArgs(reviewed, selection);
const handoff = await api.previewPickup(dispenseId, null);
await api.execute({ id: randomUUID(), kind: 'pickup', payload: { authorization_id: authorization.id, pet_id: patient.id, dispense_id: dispenseId, expected_context_hash: handoff.context_hash, recipient_name: 'Synthetic recipient', recipient_relationship: 'Synthetic household', reason: 'Synthetic handoff', attest_handoff: true, refill_close: null } });
await denied('confirm_record_release', stalePickup, '40001');
await denied('capture_release_email_payload', staleTransports.emailCapture, '42501', service);
await denied('capture_document_link', staleTransports.linkCapture, '42501', service);
check(sql(`select count(*) from release_email_payloads where request_id=${quote(staleTransports.emailId)}`) === '0' && sql(`select count(*) from document_link_payloads where grant_id=${quote(staleTransports.linkId)}`) === '0', 'Source change before capture saves no stale email or link artifacts');
const invalidated = await rpc('read_record_release', { p_id: saved.id });
check(invalidated.eligible === false && invalidated.events.length > 0, 'Selected pickup invalidates prior package eligibility');
assert.deepEqual(invalidated.release.snapshot, reviewed.snapshot); checks++;
assert.deepEqual(await rpc('confirm_record_release', args), saved); checks++;
const afterPickup = await preview(selection);
check(afterPickup.snapshot.native_dispenses[0].pickup.recipient_name === 'Synthetic recipient', 'Fresh review includes exact saved pickup projection');
const cancelArgs = confirmArgs(afterPickup, selection);
const beforeCancelSaved = await rpc('confirm_record_release', cancelArgs);
const cancel = await doctorApi.previewCancel(authorization);
await doctorApi.execute({ id: randomUUID(), kind: 'cancel', payload: { authorization_id: authorization.id, pet_id: patient.id, expected_event_id: cancel.context.head.id, expected_context_hash: cancel.context_hash, reason: 'Synthetic release invalidation', attest_review: true } });
check((await rpc('read_record_release', { p_id: beforeCancelSaved.id })).eligible === false, 'Cancellation invalidates selected authorization and nested dispense context');
await denied('confirm_record_release', { ...cancelArgs, p_id: randomUUID() }, '40001');
const cancelled = await preview(selection);
check(cancelled.snapshot.native_prescriptions[0].status.state === 'cancelled' && renderRecordRelease({ preview: cancelled }).includes('cancelled'), 'Fresh historical package clearly discloses cancellation');
check(effects() === baseline, 'Pickup/cancellation and release workflows do not debit stock, bill or send again');
console.log(JSON.stringify({ synthetic_only: true, suite: 'native-release-local-auth', checks_passed: checks, provider_requests: 0, project_id: projectId, cleanup: 'Owned runtime must be destroyed by parent harness' }));
