import { readOwnedRuntimeStatus } from "./owned-runtime-status.ts";
/** Real Auth/PostgREST acceptance. Requires an explicitly owned disposable runtime.
 * Does not start/reset/stop databases, contact providers, or erase signed history.
 * The owning harness must destroy its disposable runtime after this script exits. */
import assert from 'node:assert/strict';
import { createEstimateDraftApi } from '../../src/hub/features/estimates/estimate-api.ts';
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { createEstimatePublicationHandler, estimatePublicationPreparationSchema } from '../../supabase/functions/_shared/estimate-publication-http.ts';
import { estimatePublicationArtifact } from '../../supabase/functions/_shared/estimate-publication-document.ts';
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
  // that needs an active synthetic staff member must activate it explicitly. This
  // restores the exact baseline every harness in this file relied on before A1.
  sql(`insert into public.user_roles(user_id,role) values(${quote(created.value.id)},'STAFF') on conflict do nothing; update public.profiles set is_active=true where id=${quote(created.value.id)};`);
  const signed = await post('/auth/v1/token?grant_type=password', { email, password }, anonymous);
  check(signed.ok && typeof signed.value.access_token === 'string', 'Synthetic staff signed in using actual Auth');
  return { id: created.value.id as string, headers: { ...anonymous, Authorization: `Bearer ${signed.value.access_token}` } };
}
const staff = await user('publication-staff'), other = await user('publication-other');
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
// These are the real Edge handlers with real local Auth and PostgREST dependencies.
// No renderer, capture implementation, RPC result or Auth response is substituted.
let captureCalls = 0;
const deps = {
  authenticate: async (token: string) => {
    const headers = { ...anonymous, Authorization: `Bearer ${token}` };
    const response = await fetch(`${local.API_URL}/auth/v1/user`, { headers, signal: AbortSignal.timeout(15000) });
    if (!response.ok) return null;
    const result = await response.json();
    return typeof result.id === 'string' ? { actorId: result.id, db: transport(headers) } : null;
  },
  service: { rpc: async (name: string, args: Record<string, unknown>) => {
    if (name === 'capture_native_estimate_publication_artifact') captureCalls++;
    return transport(service).rpc(name, args);
  } },
};
const handlers = {
  prepare: createEstimatePublicationHandler(deps, 'prepare'),
  recover: createEstimatePublicationHandler(deps, 'recover'),
  read: createEstimatePublicationHandler(deps, 'read'),
};
async function http(mode: keyof typeof handlers, body: unknown, headers: Record<string, string> = staff.headers) {
  return handlers[mode](new Request(`http://127.0.0.1/estimate-publication/${mode}`, {
    method: 'POST', headers, body: JSON.stringify(body),
  }));
}
async function jsonHttp(mode: 'prepare' | 'recover', body: unknown, headers = staff.headers) {
  const response = await http(mode, body, headers);
  check(response.ok, `Real ${mode} handler accepts verified staff operation`);
  check(response.headers.get('Cache-Control')?.includes('no-store'), 'Sensitive preparation response is not cacheable');
  return response.json();
}
const client = await rpc('save_client', {
  p_actor_id: staff.id, p_client_id: null, p_expected_version: null, p_first_name: 'Synthetic', p_last_name: `Publication ${randomUUID()}`,
  p_primary_phone: null, p_primary_email: 'publication@example.test', p_preferred_channel: 'EMAIL', p_mailing_address: '2619 Synthetic Street', p_housecall_address: null,
});
const patient = await rpc('save_patient', {
  p_id: null, p_client_id: client.id, p_expected_version: null, p_name: 'Synthetic publication patient', p_species: 'Dog', p_breed: 'Synthetic breed',
  p_dob: null, p_birth_date_precision: 'unknown', p_color: null, p_sex: 'unknown', p_neuter_status: 'unknown', p_microchip_id: null, p_archived_at: null, p_deceased_at: null,
});
const product = await rpc('save_catalog_product', {
  p_id: null, p_expected_version: null, p_name: 'Synthetic publication service', p_kind: 'service', p_manufacturer: '', p_unit: 'visit', p_unit_price_cents: 125, p_active: true,
});
const effects = () => {
  const tables = ['patient_treatments', 'native_prescription_authorizations', 'native_dispenses', 'inventory_movements', 'inventory_lots',
    'billing_invoices', 'billing_invoice_items', 'billing_credits', 'invoice_payments', 'invoice_refund_requests', 'communication_outbox', 'document_link_grants'];
  return sql(`select jsonb_build_object(${tables.map(table => `${quote(table)},(select count(*) from public.${table})`).join(',')})::text`);
};
const originalEffects = effects();
const estimateId = randomUUID();
const request = {
  estimate_id: estimateId, client_id: client.id, pet_id: patient.id, expected_version: null,
  fields: {
    title: 'Synthetic proposal <script>text only</script>', notes: 'No treatment, invoice or delivery is created.',
    terms: 'Entire exact proposal only. Acceptance is not clinical consent or payment.', accept_by: '2099-12-31',
    lines: [{ id: randomUUID(), product_id: product.id, product_version: product.version, description: 'Chosen service description', kind: 'service' as const,
      unit: product.unit, quantity: '1.5', pricing: { kind: 'unit' as const, unit_price_cents: '125' }, pricing_reason: null },
    { id: randomUUID(), product_id: product.id, product_version: product.version, description: 'Included service', kind: 'service' as const,
      unit: product.unit, quantity: '1', pricing: { kind: 'allocated' as const, amount_cents: '0' },
      pricing_reason: '<a href="javascript:alert(1)">special</a> <img src=x onerror="bad"> @import url(text)' }],
  },
};
const drafts = createEstimateDraftApi(transport(staff.headers), staff.id, client.id);
const initialDraft = await drafts.save({ id: randomUUID(), kind: 'save_estimate_draft', payload: request });
check(initialDraft.result.total_cents === '188', 'Prepared proposal uses exact half-up price and explicit allocated zero');
async function preparationRequest(version: number) {
  const preview = await rpc('preview_native_estimate_publication', { p_estimate_id: estimateId, p_client_id: client.id, p_draft_version: version });
  return {
    target: preview.context.target, draft_version: version, expected_source_hash: preview.source_hash,
    expected_publication_head: preview.context.publication_head, replaces_publication_id: preview.context.current_publication_id,
  };
}
const prepId = randomUUID(), prepRequest = await preparationRequest(1);
const preparedReply = await jsonHttp('prepare', { id: prepId, request: prepRequest });
const prepared = estimatePublicationPreparationSchema.parse(preparedReply.preparation);
check(prepared.artifact !== null && prepared.id === prepId && prepared.actor_id === staff.id, 'Real handler renders and captures exact creator preparation');
check(captureCalls === 1, 'First handler call performs one real artifact capture');
assert.deepEqual((await jsonHttp('prepare', { id: prepId, request: prepRequest })).preparation, prepared); checks++;
assert.deepEqual((await jsonHttp('recover', { id: prepId })).preparation, prepared); checks++;
check(captureCalls === 1, 'Captured retries never call renderer/capture again');
check((await jsonHttp('recover', { id: randomUUID() })).preparation === null, 'Unknown preparation recovery explicitly absent');
const artifact = prepared.artifact!;
const readBody = { preparation_id: prepId, client_id: client.id, expected_artifact_hash: artifact.sha256 };
const downloaded = await http('read', readBody);
check(downloaded.ok, 'Creator can read unpublished captured bytes');
check(downloaded.headers.get('Content-Type') === artifact.mime_type && downloaded.headers.get('Referrer-Policy') === 'no-referrer', 'Artifact response has strict content and referrer policy');
check(downloaded.headers.get('Content-Security-Policy')?.includes('sandbox'), 'Artifact response remains sandboxed');
const bytes = new Uint8Array(await downloaded.arrayBuffer());
check(bytes.byteLength === artifact.byte_length && createHash('sha256').update(bytes).digest('hex') === artifact.sha256, 'Actual downloaded bytes exactly match persisted digest and size');
const deterministic = await estimatePublicationArtifact(prepared.snapshot);
assert.equal(new TextDecoder().decode(bytes), deterministic.html); checks++;
assert.deepEqual(artifact, deterministic.artifact); checks++;
check(deterministic.html.includes('&lt;script&gt;') && !deterministic.html.includes('<script>') && deterministic.html.includes('javascript:alert(1)'), 'Hostile prose preserved as escaped inert text');
for (const headers of [anonymous, service, other.headers]) {
  const response = await http('read', readBody, headers);
  check(!response.ok, 'Anonymous, service-token and noncreator cannot read unpublished artifact');
}
check(!(await http('read', { ...readBody, client_id: randomUUID() })).ok, 'Artifact read binds exact household');
check(!(await http('read', { ...readBody, expected_artifact_hash: '0'.repeat(64) })).ok, 'Artifact read refuses mismatched digest');
check(!(await http('prepare', { id: prepId, request: prepRequest, actor_id: other.id })).ok, 'HTTP body cannot inject actor authority');
await denied('native_estimate_capture_context', { p_id: prepId, p_actor_id: staff.id }, '42501');
await denied('capture_native_estimate_publication_artifact', { p_id: prepId, p_actor_id: staff.id, p_content_hash: prepared.content_hash, p_renderer_version: 1, p_html_utf8_base64: Buffer.from(bytes).toString('base64') }, '42501');
await denied('native_estimate_capture_context', { p_id: prepId, p_actor_id: other.id }, '42501', service);
function publishRequest(p: typeof prepared) {
  assert.ok(p.artifact);
  return {
    target: p.request.target, preparation_id: p.id, expected_draft_version: p.request.draft_version, expected_publication_head: p.request.expected_publication_head,
    expected_content_hash: p.content_hash, expected_artifact_hash: p.artifact.sha256, replaces_publication_id: p.request.replaces_publication_id,
    attest_document_review: true, attest_pricing_review: true, attest_terms_review: true,
  };
}
const publishId = randomUUID(), publish = publishRequest(prepared);
await denied('publish_native_estimate', { p_id: randomUUID(), p_request: publish }, '42501', other.headers);
await denied('publish_native_estimate', { p_id: randomUUID(), p_request: publish }, '42501', service);
await denied('publish_native_estimate', { p_id: randomUUID(), p_request: { ...publish, expected_artifact_hash: '0'.repeat(64) } }, '23514');
const publication = await rpc('publish_native_estimate', { p_id: publishId, p_request: publish });
check(publication.result.publication.artifact.sha256 === artifact.sha256 && publication.result.publication.id === publishId, 'Publication binds exact captured bytes and operation ID');
assert.deepEqual(await rpc('publish_native_estimate', { p_id: publishId, p_request: publish }), publication); checks++;
assert.deepEqual(await rpc('recover_native_estimate_publication_operation', { p_id: publishId }), publication); checks++;
const recordedClose = await rpc('close_native_estimate_publication_operation', { p_id: publishId, p_mutation: { kind: 'publish', request: publish } });
check(recordedClose.status === 'recorded', 'Serialized close recovers committed publication');
assert.deepEqual(recordedClose.receipt, publication); checks++;
check((await http('read', readBody, other.headers)).ok, 'Other active staff may read published historical bytes');
await denied('recover_native_estimate_publication_operation', { p_id: publishId }, '42501', other.headers);
const getCurrent = () => rpc('read_native_estimate_publication', { p_estimate_id: estimateId, p_client_id: client.id });
check((await getCurrent()).current.id === publishId, 'Published revision is current');
// New draft does not replace publication or alter already captured bytes.
await drafts.save({ id: randomUUID(), kind: 'save_estimate_draft', payload: { ...request, expected_version: 1, fields: { ...request.fields, title: 'Revised synthetic draft' } } });
check((await getCurrent()).current.draft_version === 1, 'Draft edit independent from published revision');
const secondPreparation = estimatePublicationPreparationSchema.parse((await jsonHttp('prepare', { id: randomUUID(), request: await preparationRequest(2) })).preparation);
const stalePublish = publishRequest(secondPreparation), abandonedId = randomUUID();
// Contact update invalidates an unpublished review but cannot rewrite historical bytes.
await rpc('save_client', { p_actor_id: staff.id, p_client_id: client.id, p_expected_version: client.version,
  p_first_name: 'Changed', p_last_name: client.last_name, p_primary_phone: null, p_primary_email: 'publication@example.test', p_preferred_channel: 'EMAIL', p_mailing_address: 'New synthetic address', p_housecall_address: null });
await denied('publish_native_estimate', { p_id: abandonedId, p_request: stalePublish }, '40001');
const closeMutation = { kind: 'publish', request: stalePublish };
check(await rpc('recover_native_estimate_publication_operation', { p_id: abandonedId }) === null, 'Uncommitted stale publication has no receipt');
const closure = await rpc('close_native_estimate_publication_operation', { p_id: abandonedId, p_mutation: closeMutation });
check(closure.status === 'closed_unrecorded' && closure.closure.id === abandonedId && closure.closure.actor_id === staff.id, 'Stale uncertain operation is durably closed for exact creator');
assert.deepEqual(await rpc('close_native_estimate_publication_operation', { p_id: abandonedId, p_mutation: closeMutation }), closure); checks++;
await denied('publish_native_estimate', { p_id: abandonedId, p_request: stalePublish }, '23514');
await denied('close_native_estimate_publication_operation', { p_id: abandonedId, p_mutation: closeMutation }, '42501', other.headers);
await denied('close_native_estimate_publication_operation', { p_id: abandonedId, p_mutation: { ...closeMutation, request: { ...stalePublish, expected_content_hash: '0'.repeat(64) } } }, '23514');
const thirdPreparation = estimatePublicationPreparationSchema.parse((await jsonHttp('prepare', { id: randomUUID(), request: await preparationRequest(2) })).preparation);
check(thirdPreparation.request.replaces_publication_id === publishId, 'Replacement impact explicitly reviewed');
const replacementId = randomUUID();
const replacement = await rpc('publish_native_estimate', { p_id: replacementId, p_request: publishRequest(thirdPreparation) });
check((await getCurrent()).current.id === replacementId, 'Replacement atomically advances current publication');
const oldDetail = await rpc('read_native_estimate_published_revision', { p_publication_id: publishId, p_client_id: client.id });
check(oldDetail.status === 'superseded' && oldDetail.snapshot.client.name === prepared.snapshot.client.name, 'Old publication preserves frozen household display');
const again = await http('read', readBody);
assert.deepEqual(new Uint8Array(await again.arrayBuffer()), bytes); checks++;
assert.deepEqual(await rpc('recover_native_estimate_publication_operation', { p_id: publishId }), publication); checks++;
const history = await rpc('read_native_estimate_publication_history', { p_estimate_id: estimateId, p_client_id: client.id, p_before_version: null, p_limit: 1 });
check(history.has_more && history.events.length === 1 && history.events[0].id === replacementId && history.next_before_version === 2, 'Lifecycle history has explicit newest-first cursor');
const previous = await rpc('read_native_estimate_publication_history', { p_estimate_id: estimateId, p_client_id: client.id, p_before_version: history.next_before_version, p_limit: 1 });
check(!previous.has_more && previous.next_before_version === null && previous.events[0].id === publishId, 'Lifecycle history preserves complete first publication');
const withdrawalId = randomUUID(), state = await getCurrent();
const withdrawal = { target: state.target, publication_id: replacementId, expected_publication_head: state.head, reason: 'Synthetic withdrawal, no financial reversal', attest_review: true };
const withdrawn = await rpc('withdraw_native_estimate', { p_id: withdrawalId, p_request: withdrawal });
assert.deepEqual(await rpc('withdraw_native_estimate', { p_id: withdrawalId, p_request: withdrawal }), withdrawn); checks++;
check((await getCurrent()).current_status === 'withdrawn' && (await getCurrent()).current === null, 'Withdrawal leaves historical publication and no active current slot');
check((await rpc('read_native_estimate_published_revision', { p_publication_id: replacementId, p_client_id: client.id })).status === 'withdrawn', 'Staff detail distinguishes withdrawal from replacement');
await denied('withdraw_native_estimate', { p_id: randomUUID(), p_request: withdrawal }, '40001');
// Current catalog can change; history and real HTTP recovery still return exact captures.
await rpc('save_catalog_product', { p_id: product.id, p_expected_version: product.version, p_name: product.name, p_kind: product.kind, p_manufacturer: '', p_unit: product.unit, p_unit_price_cents: 999, p_active: false });
assert.deepEqual((await jsonHttp('recover', { id: prepId })).preparation, prepared); checks++;
check((await http('read', readBody, other.headers)).ok, 'Historical bytes survive withdrawal and catalog change');
const missingCaptureId = randomUUID();
// SQL-only preparation simulates the process disappearing before rendering/capture.
const missingCaptureRequest = await preparationRequest(2);
await rpc('prepare_native_estimate_publication', { p_id: missingCaptureId, p_request: missingCaptureRequest });
const beforeRecoverCapture = captureCalls;
const resumed = await jsonHttp('recover', { id: missingCaptureId });
check(resumed.preparation.artifact !== null && captureCalls === beforeRecoverCapture + 1, 'Real recovery completes a missing capture without a replacement preparation');
const rawTables = ['native_estimate_publication_preparations', 'native_estimate_publication_artifacts', 'native_estimate_publication_events', 'native_estimate_publication_closures'];
for (const table of rawTables) {
  const result = await fetch(`${local.API_URL}/rest/v1/${table}?select=*`, { headers: staff.headers, signal: AbortSignal.timeout(15000) });
  check(!result.ok, `Raw ${table} rows are not exposed`);
}
for (const headers of [anonymous, service]) {
  await denied('read_native_estimate_publication', { p_estimate_id: estimateId, p_client_id: client.id }, '42501', headers);
  await denied('close_native_estimate_publication_operation', { p_id: abandonedId, p_mutation: closeMutation }, '42501', headers);
}
await denied('read_native_estimate_publication', { p_estimate_id: estimateId, p_client_id: randomUUID() }, '23514');
sql(`update public.profiles set is_active=false where id=${quote(other.id)};`);
check(!(await http('read', readBody, other.headers)).ok, 'Inactive staff token cannot fetch historical bytes');
check(effects() === originalEffects, 'Publication lifecycle creates no clinical, stock, invoice, payment, grant or outbox effects');
console.log(JSON.stringify({ synthetic_only: true, suite: 'native-estimate-publications-local-auth-http', checks_passed: checks,
  provider_requests: 0, real_http_capture_calls: captureCalls, project_id: projectId, cleanup: 'Populated fixtures retained; owned runtime cleanup belongs to parent harness' }));
