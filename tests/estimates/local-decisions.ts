import { readOwnedRuntimeStatus } from "./owned-runtime-status.ts";
/** Real Auth/PostgREST acceptance. Requires an explicitly owned disposable runtime.
 * Does not start/reset/stop databases, contact providers, or erase signed history.
 * The owning harness must destroy its disposable runtime after this script exits. */
import assert from 'node:assert/strict';
import { createEstimateDecisionGrantHandler, estimateGrantPreparationResultSchema } from '../../supabase/functions/_shared/estimate-decision-grant-http.ts';
import { createEstimateDecisionHandler } from '../../supabase/functions/_shared/estimate-decision-http.ts';
import { estimateDecisionConfig, materializeEstimateDecision } from '../../supabase/functions/_shared/estimate-decision-capability.ts';
import { estimateWitnessedDecisionRequestSchema } from '../../supabase/functions/_shared/estimate-decision-contract.ts';
import { createEstimateDraftApi } from '../../src/hub/features/estimates/estimate-api.ts';
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { createEstimatePublicationHandler, estimatePublicationPreparationSchema } from '../../supabase/functions/_shared/estimate-publication-http.ts';
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
const staff = await user('decision-staff'), other = await user('decision-other');
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
const config=estimateDecisionConfig({origin:'http://127.0.0.1:8080',activeKeyVersion:'synthetic-v1',keys:JSON.stringify({'synthetic-v1':Buffer.alloc(32,81).toString('base64')}),publicEnabled:'true',issuanceEnabled:'true'});
const publicHandler=createEstimateDecisionHandler({db:transport(service),config,rateLimit:async()=>true});
const staffGrantHandlers={prepare:createEstimateDecisionGrantHandler({...deps,config},'prepare'),recover:createEstimateDecisionGrantHandler({...deps,config},'recover')};
const disabledGrantHandlers={prepare:createEstimateDecisionGrantHandler({...deps,config:{...config,issuanceEnabled:false}},'prepare'),recover:createEstimateDecisionGrantHandler({...deps,config:{...config,issuanceEnabled:false}},'recover')};
async function staffGrantHttp(mode:'prepare'|'recover',body:unknown,headers=staff.headers,disabled=false){
 return (disabled?disabledGrantHandlers:staffGrantHandlers)[mode](new Request(`http://127.0.0.1/estimate-grant/${mode}`,{method:'POST',headers:{...headers,Origin:config.origin},body:JSON.stringify(body)}));
}
let staffGrantLifecycleChecks=false;
async function publication(label:string){
 const estimateId=randomUUID();
 const draft=await createEstimateDraftApi(transport(staff.headers),staff.id,client.id).save({id:randomUUID(),kind:'save_estimate_draft',payload:{estimate_id:estimateId,client_id:client.id,pet_id:patient.id,expected_version:null,fields:{title:`Synthetic decision ${label}`,notes:'Synthetic acceptance only',terms:'Entire exact proposal. Not clinical consent or payment.',accept_by:'2099-12-31',lines:[{id:randomUUID(),product_id:product.id,product_version:product.version,description:'Reviewed visit',kind:'service',unit:product.unit,quantity:'1.5',pricing:{kind:'unit',unit_price_cents:'125'},pricing_reason:null}]}}});
 check(draft.result.total_cents==='188','Exact draft pricing retained');
 const preview=await rpc('preview_native_estimate_publication',{p_estimate_id:estimateId,p_client_id:client.id,p_draft_version:1});
 const p=estimatePublicationPreparationSchema.parse((await jsonHttp('prepare',{id:randomUUID(),request:{target:preview.context.target,draft_version:1,expected_source_hash:preview.source_hash,expected_publication_head:preview.context.publication_head,replaces_publication_id:null}})).preparation);
 const receipt=await rpc('publish_native_estimate',{p_id:randomUUID(),p_request:{target:p.snapshot.target,preparation_id:p.id,expected_draft_version:1,expected_publication_head:p.context.publication_head,expected_content_hash:p.content_hash,expected_artifact_hash:p.artifact!.sha256,replaces_publication_id:null,attest_document_review:true,attest_pricing_review:true,attest_terms_review:true}});
 const publication=receipt.result.publication;
 const grantPreview=await rpc('preview_native_estimate_decision_grant',{p_publication_id:publication.id,p_client_id:client.id});
 return {p,publication,preview:grantPreview};
}
async function grantFor(p:Awaited<ReturnType<typeof publication>>,expiresAt='2099-12-30T00:00:00.000000Z'){
 const id=randomUUID();
 const request={binding:p.preview.binding,expected_publication_head:p.preview.publication_head,expires_at:expiresAt,recipient_label:'Synthetic owner',purpose:'Review exact published estimate',attest_recipient_authority:true};
 const intent={id,request};
 if(!staffGrantLifecycleChecks){
  const blockedId=randomUUID();
  check(!(await staffGrantHttp('prepare',{id:blockedId,request},staff.headers,true)).ok,'Default-off issuance rejects staff prepare');
  check(sql(`select count(*) from native_estimate_decision_grants where id=${quote(blockedId)}`)==='0','Disabled preparation creates no grant');
 }
 const preparedResponse=await staffGrantHttp('prepare',intent);
 check(preparedResponse.ok,'Actual Auth staff Edge issues and captures exact grant');
 check(preparedResponse.headers.get('Cache-Control')?.includes('no-store'),'Staff grant response is not cacheable');
 const prepared=estimateGrantPreparationResultSchema.parse(await preparedResponse.clone().json());
 check(prepared.grant?.state==='captured'&&prepared.link===null,'Preparing/captured grant never exposes a usable URL');
 check(prepared.receipt?.result.state==='preparing','Original immutable issue receipt remains preparing after capture');
 // Simulate loss to the caller by discarding the successful body. Recovery below
 // invokes the actual handler/Auth/PostgREST, without replacing any RPC result.
 await preparedResponse.body?.cancel();
 const recoveredResponse=await staffGrantHttp('recover',intent);
 check(recoveredResponse.ok,'Discarded prepare response recovers original exact operation');
 const recovered=estimateGrantPreparationResultSchema.parse(await recoveredResponse.json());
 assert.deepEqual(recovered,prepared);checks++;
 check(sql(`select count(*) from native_estimate_decision_grants where id=${quote(id)}`)==='1','Recovery does not issue a replacement grant');
 check(sql(`select count(*) from native_estimate_decision_grant_captures where grant_id=${quote(id)}`)==='1','Exact capture is retained once');
 assert.ok(recovered.receipt&&recovered.grant?.capability);
 const issue=recovered.receipt;
 const context=await rpc('native_estimate_decision_grant_capture_context',{p_grant_id:id,p_actor_id:staff.id,p_origin:config.origin,p_key_version:config.activeKeyVersion},service);
 const flat={id,actor_id:staff.id,binding:issue.result.request.binding,expires_at:issue.result.request.expires_at,origin:config.origin,key_version:config.activeKeyVersion,capability_context:context.capability_context,context_hash:context.context_hash};
 const capability=await materializeEstimateDecision(flat,config);
 const active=await rpc('record_native_estimate_decision_grant',{p_id:randomUUID(),p_mutation:{kind:'activate',request:{grant_id:id,expected_grant_head:recovered.grant.head,expected_publication_head:p.preview.publication_head,expected_context_hash:context.context_hash,attest_review:true}}});
 check(active.result.state==='active','Captured grant explicitly activated through separate staff SQL operation');
 const activeResponse=await staffGrantHttp('recover',intent);
 check(activeResponse.ok,'Active grant materializes after actual final SQL authorization');
 const activeRecovery=estimateGrantPreparationResultSchema.parse(await activeResponse.json());
 check(activeRecovery.link?.url===capability.url&&activeRecovery.link?.expires_at===expiresAt,'Staff recovery returns exact frozen capability URL and expiry');
 assert.deepEqual(activeRecovery.receipt,issue);checks++;
 check(!JSON.stringify(activeRecovery).includes('token_hash')&&!JSON.stringify(activeRecovery).includes('capability_context'),'Staff HTTP omits private token hash and capability context');
 if(!staffGrantLifecycleChecks){
  check(!(await staffGrantHttp('recover',intent,other.headers)).ok,'Actual other Auth actor cannot materialize creator grant');
  check(!(await staffGrantHttp('recover',{id,request:{...request,purpose:'Changed uncertain request'}})).ok,'Recovery rejects changed original request');
  const disabledResponse=await staffGrantHttp('recover',intent,staff.headers,true);
  check(disabledResponse.ok,'Issuance disabled still permits creator metadata recovery');
  const disabled=estimateGrantPreparationResultSchema.parse(await disabledResponse.json());
  check(disabled.grant?.state==='active'&&disabled.link===null,'Disabled issuance never materializes active URL');
  assert.deepEqual(disabled.receipt,issue);checks++;
  staffGrantLifecycleChecks=true;
 }
 return {id,capability,active};
}
function decisionRequest(p:Awaited<ReturnType<typeof publication>>,grantId:string|null,choice:'accept'|'decline'='accept'){
 return {binding:p.preview.binding,grant_id:grantId,expected_publication_head:p.preview.publication_head,choice,signer_name:'Synthetic client',signer_relationship:'owner',comment:null,acknowledgment_version:1,attest_document_review:true,attest_authority:true,attest_choice:true};
}
async function publicCall(g:Awaited<ReturnType<typeof grantFor>>,body:unknown){
 return publicHandler(new Request('http://127.0.0.1/estimate-decision',{method:'POST',headers:{Origin:config.origin,'Content-Type':'application/json','X-Estimate-Capability':g.capability.token},body:JSON.stringify(body)}));
}
const accepted=await publication('accepted'),g1=await grantFor(accepted),g2=await grantFor(accepted);
const read=await publicCall(g1,{action:'read',grant_id:g1.id});check(read.ok,'Real capability reads exact published review');
const review=await read.json();
const original=await rpc('read_native_estimate_publication_artifact',{p_preparation_id:accepted.p.id,p_client_id:client.id,p_expected_artifact_hash:accepted.p.artifact!.sha256});
check(review.content_base64===original.content_base64,'Public artifact equals actual stored byte serialization');
check(createHash('sha256').update(Buffer.from(review.content_base64,'base64')).digest('hex')===review.artifact.sha256,'Public stored byte SHA256 verified');
check(!('actor_id' in review)&&!('snapshot' in review)&&!JSON.stringify(review).includes(staff.id),'Public review excludes private actor and full snapshot');
const operation=randomUUID(),q=decisionRequest(accepted,g1.id);
const lost=await publicCall(g1,{action:'record',id:operation,request:q});check(lost.ok,'Public accept committed through real handler and PostgREST');
// Deliberately ignore successful response bytes, then recover the same saved identity.
await lost.body?.cancel();
const recovery=await publicCall(g1,{action:'recover',id:operation,request:q});check(recovery.ok,'Lost-response recovery succeeds');
const recovered=await recovery.json();check(recovered.status==='recorded'&&recovered.receipt.id===operation,'Exact original acceptance recovered');
check(recovered.receipt.result.attribution==='link_holder','Bearer attribution is honest');
const retry=await publicCall(g1,{action:'record',id:operation,request:q});assert.deepEqual(await retry.json(),recovered.receipt);checks++;
check(!(await publicCall(g2,{action:'record',id:randomUUID(),request:decisionRequest(accepted,g2.id,'decline')})).ok,'Opposing decision from sibling grant cannot replace acceptance');
check(!(await publicCall(g2,{action:'recover',id:operation,request:{...q,grant_id:g2.id}})).ok,'Another grant cannot adopt exact operation');
check(sql(`select count(*) from native_estimate_decisions where publication_id=${quote(accepted.publication.id)}`)==='1','One decision per publication');
const revocation=await rpc('record_native_estimate_decision_grant',{p_id:randomUUID(),p_mutation:{kind:'revoke',request:{grant_id:g1.id,expected_grant_head:g1.active.result.head,reason:'Synthetic revoked link',attest_review:true}}});
check(revocation.result.state==='revoked','Revocation is recorded');
check(!(await publicCall(g1,{action:'recover',id:operation,request:q})).ok,'Revoked capability cannot recover bearer evidence');
const reconciled=await rpc('reconcile_native_estimate_client_decision',{p_id:operation,p_request:q,p_close_unrecorded:false,p_reason:'Synthetic exact lost-response reconciliation'});
check(reconciled.status==='recorded'&&reconciled.receipt.result.id===operation,'Staff can reconcile recorded original after revocation');
const pendingId=randomUUID(),pending={...q,choice:'decline'};
const closed=await rpc('reconcile_native_estimate_client_decision',{p_id:pendingId,p_request:pending,p_close_unrecorded:true,p_reason:'Synthetic cancellation of uncertain original intent'});
check(closed.status==='closed_unrecorded'&&closed.closure.principal.kind==='grant'&&closed.closure.closed_by.kind==='staff','Staff closure preserves original grant principal and distinct closer');
assert.deepEqual(await rpc('reconcile_native_estimate_client_decision',{p_id:pendingId,p_request:pending,p_close_unrecorded:true,p_reason:'Repeated inspection by another active staff'},other.headers),closed);checks++;
const witness=await publication('witnessed'),witnessId=randomUUID();
// Publication v1 returns a PostgreSQL UTC offset; decision requests require Z.
// Preserve all six fractional digits: Date.toISOString() can round the occurrence below publication.
const occurredAt=String(witness.publication.published_at).replace(/\+00:00$/, 'Z');
const witnessRequest=estimateWitnessedDecisionRequestSchema.parse({decision:decisionRequest(witness,null,'decline'),witness:{channel:'telephone',occurred_at:occurredAt,note:'Synthetic direct instruction from reported owner',attest_direct_client_instruction:true}});
const witnessed=await rpc('record_native_estimate_witnessed_decision',{p_id:witnessId,p_request:witnessRequest});
check(witnessed.result.provenance.kind==='staff_witness'&&witnessed.result.provenance.actor_id===staff.id,'Witness decision has distinct staff provenance');
assert.deepEqual(await rpc('recover_native_estimate_witnessed_decision',{p_id:witnessId}),witnessed);checks++;
const closing=await publication('public closure'),cg=await grantFor(closing),closeId=randomUUID(),cq=decisionRequest(closing,cg.id);
const absent=await publicCall(cg,{action:'recover',id:closeId,request:cq});check((await absent.json()).status==='unrecorded','Authorized recovery absence is explicitly nonterminal');
const terminal=await publicCall(cg,{action:'close',id:closeId,request:cq});check(terminal.ok,'Public close succeeds under same operation gate');
const terminalBody=await terminal.json();check(terminalBody.status==='closed_unrecorded','Public close produces durable tombstone');
check(!(await publicCall(cg,{action:'record',id:closeId,request:cq})).ok,'Closed original cannot later submit');
const terminalRetry=await publicCall(cg,{action:'close',id:closeId,request:cq});assert.deepEqual(await terminalRetry.json(),terminalBody);checks++;
const expiring=await publication('expiry');
const expiry=sql("select to_char(clock_timestamp()+interval '15 seconds','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')");
const eg=await grantFor(expiring,expiry);
check((await publicCall(eg,{action:'read',grant_id:eg.id})).ok,'Short-lived grant readable before its real expiry');
const expires=Date.parse(expiry),deadline=Date.now()+20000;
while(Date.now()<=expires){assert.ok(Date.now()<deadline,'Bounded real expiry wait');await new Promise(resolve=>setTimeout(resolve,250));}
check(!(await publicCall(eg,{action:'read',grant_id:eg.id})).ok,'Naturally expired grant becomes unavailable');
check(!(await publicCall(eg,{action:'recover',id:randomUUID(),request:decisionRequest(expiring,eg.id)})).ok,'Expired recovery does not report unrecorded');
const tables=['native_estimate_decision_grants','native_estimate_decision_grant_captures','native_estimate_decision_grant_events','native_estimate_decisions','native_estimate_decision_operations','native_estimate_decision_closures'];
for(const table of tables)for(const headers of [anonymous,staff.headers,service]){
 const result=await fetch(`${local.API_URL}/rest/v1/${table}?select=*`,{headers,signal:AbortSignal.timeout(15000)});check(!result.ok,`Raw ${table} access denied`);
}
for(const headers of [anonymous,staff.headers])await denied('native_estimate_decision_access_context',{p_grant_id:g1.id},'42501',headers);
check(effects()===originalEffects,'Decisions create no clinical, stock, invoice, payment, document-link or outbox effects');
console.log(JSON.stringify({synthetic_only:true,suite:'native-estimate-decisions-local-auth-http',checks_passed:checks,provider_requests:0,project_id:projectId,publication_capture_calls:captureCalls,populated:{grants:4,decisions:2,closures:2},cleanup:'Populated fixtures retained; owning harness controls runtime cleanup'}));
