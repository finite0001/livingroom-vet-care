import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createEstimateDecisionGrantHandler} from '../../supabase/functions/_shared/estimate-decision-grant-http.ts';
import {estimateDecisionConfig,materializeEstimateDecision} from '../../supabase/functions/_shared/estimate-decision-capability.ts';
const id=(n:number)=>`ad530000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const hash='a'.repeat(64),time='2026-09-16T12:00:00.000000Z';
const sha=(v:string)=>createHash('sha256').update(v).digest('hex');
async function setup(){
 const config=estimateDecisionConfig({origin:'https://thelivingroom.vet',activeKeyVersion:'v2',keys:JSON.stringify({v1:Buffer.alloc(32,9).toString('base64'),v2:Buffer.alloc(32,8).toString('base64')}),issuanceEnabled:'true'});
 const html='<!doctype html><h1>Exact captured estimate</h1>';
 const binding={target:{estimate_id:id(3),client_id:id(4),pet_id:id(5)},publication_id:id(6),content_hash:hash,artifact_hash:sha(html)};
 const head={event_id:id(6),version:1,record_hash:hash};
 const ctx={domain:'lrv-estimate-decision/v1',context_version:1,grant_id:id(1),actor_id:id(2),binding,expires_at:'2099-10-01T06:00:00.000000Z',origin:config.origin,key_version:'v1'};
 const text=JSON.stringify(ctx);const flat={id:id(1),actor_id:id(2),binding,expires_at:ctx.expires_at,origin:ctx.origin,key_version:'v1',capability_context:text,context_hash:sha(text)};
 const material=await materializeEstimateDecision(flat,config);
 const request={binding,expected_publication_head:head,expires_at:ctx.expires_at,recipient_label:'Owner',purpose:'Review estimate',attest_recipient_authority:true};
 const issued={version:1,id:id(1),actor_id:id(2),request,request_hash:hash,created_at:time,capability:null,capture:null,head:{...head,event_id:id(1)},state:'preparing',activation:null,revocation:null};
 const receipt={version:1,id:id(1),actor_id:id(2),mutation:{kind:'issue',request},request_hash:hash,result:issued,created_at:time};
 const grant={...issued,capability:{origin:ctx.origin,key_version:'v1',context_hash:flat.context_hash},capture:{token_hash:material.token_hash,captured_at:time},state:'active',activation:{id:id(8),actor_id:id(2),created_at:time}};
 const context={grant,capability_context:text,context_hash:flat.context_hash,captured:true};
 const review={version:1,grant_id:id(1),binding,publication_head:head,publication_status:'open',decision:null,review:{practice:{name:'The Living Room Veterinary Care',address:'2619 Spruce Street, Boulder, CO',domain:'thelivingroom.vet'},household_name:'Synthetic household',patient:{name:'Juniper',species:'Dog',breed:null},title:'Visit estimate',total_cents:'1250',currency:'usd',accept_by:'2099-10-31',expires_at:'2099-11-01T06:00:00.000000Z',acknowledgment_version:1,scope:'entire_exact_revision',not_clinical_consent:true,not_payment:true},artifact:{filename:`estimate-${id(3)}-draft-1-publication-${id(7)}.html`,mime_type:'text/html; charset=utf-8',byte_length:Buffer.byteLength(html),sha256:sha(html),renderer_version:1},content_base64:Buffer.from(html).toString('base64')};
 const state={actor:id(2),missing:false,deny:false,calls:[] as {name:string;args:Record<string,unknown>}[],context:context as unknown,receipt:receipt as unknown};
 const db={rpc:async(name:string,args:Record<string,unknown>)=>{state.calls.push({name,args});if(state.deny)return{error:new Error('SECRET'),data:null};return{error:null,data:name==='native_estimate_decision_grant_capture_context'?state.context:name==='retrieve_native_estimate_decision'?review:state.missing?null:state.receipt};}};
 const dependencies={config,authenticate:async()=>({actorId:state.actor,db}),service:db};
 const handler=(mode:'prepare'|'recover'='recover')=>createEstimateDecisionGrantHandler(dependencies,mode);
 const req=(input:unknown={id:id(1),request})=>new Request('https://edge.test',{method:'POST',headers:{Authorization:'Bearer actual-auth-test', 'Content-Type':'application/json',Origin:config.origin},body:JSON.stringify(input)});
 return{config,request,receipt,grant,context,review,material,state,dependencies,handler,req};
}
test('creator recovery keeps immutable issue receipt and materializes exact frozen old key after rotation',async()=>{
 const f=await setup(),r=await f.handler()(f.req());assert.equal(r.status,200);
 const output=await r.json();assert.deepEqual(output.receipt,f.receipt);assert.equal(output.link.url,f.material.url);assert.equal(output.grant.capture.token_hash,undefined);
 assert.ok(!JSON.stringify(output).includes('capability_context'));assert.ok(!JSON.stringify(output).includes('token_hash'));
 assert.deepEqual(f.state.calls.map(c=>c.name),['recover_native_estimate_decision_grant','native_estimate_decision_grant_capture_context','retrieve_native_estimate_decision']);
 assert.equal(f.state.calls.at(-1)?.args.p_key_version,'v1');assert.equal(r.headers.get('cache-control'),'no-store, private');
});
test('issuance default off denies preparation and returns token-free historical recovery',async()=>{
 const f=await setup();f.config.issuanceEnabled=false;
 assert.equal((await f.handler('prepare')(f.req())).status,404);assert.equal(f.state.calls.length,0);
 const r=await f.handler()(f.req());assert.equal(r.status,200);assert.equal((await r.json()).link,null);assert.equal(f.state.calls.length,2);
});
test('absent recovery never records or captures and is only point-in-time absence',async()=>{
 const f=await setup();f.state.missing=true;
 assert.deepEqual(await(await f.handler()(f.req())).json(),{version:1,receipt:null,grant:null,link:null});assert.equal(f.state.calls.length,1);
});
test('changed request, creator, private proof, and unknown body fields fail without usable links',async()=>{
 for(const change of ['request','actor','proof','body','old-key']){
  const f=await setup();let input:unknown={id:id(1),request:f.request};
  if(change==='request')input={id:id(1),request:{...f.request,purpose:'Different'}};
  if(change==='actor')f.state.actor=id(99);
  if(change==='proof')f.grant.capture.token_hash='b'.repeat(64);
  if(change==='body')input={id:id(1),request:f.request,origin:'https://evil.test'};
  if(change==='old-key')delete f.config.keys.v1;
  const r=await f.handler()(f.req(input));assert.equal(r.status,404,change);assert.deepEqual(await r.json(),{error:'Estimate grant unavailable'});
 }
});
test('captured and revoked grants recover metadata without releasing token or requiring old key',async()=>{
 for(const state of ['captured','revoked']){
  const f=await setup();f.grant.state=state;
  if(state==='captured')Object.assign(f.grant,{activation:null});
  else Object.assign(f.grant,{revocation:{id:id(99),actor_id:id(2),created_at:time,reason:'Stop'}});
  delete f.config.keys.v1;
  const r=await f.handler()(f.req());assert.equal(r.status,200);assert.equal((await r.json()).link,null);assert.equal(f.state.calls.length,2);
 }
});
test('final service denial and oversized/invalid UTF8 requests remain unavailable',async()=>{
 const f=await setup();f.dependencies.service={rpc:async(name,args)=>name==='retrieve_native_estimate_decision'?{data:null,error:new Error('SECRET')}:f.dependencies.authenticate('').then(a=>a.db.rpc(name,args))};
 assert.equal((await f.handler()(f.req())).status,404);
 const large=f.req({id:id(1),request:f.request,extra:'x'.repeat(20000)});assert.equal((await f.handler()(large)).status,404);
 const invalid=new Request('https://edge.test',{method:'POST',headers:{Authorization:'Bearer token','Content-Type':'application/json'},body:new Uint8Array([255])});assert.equal((await f.handler()(invalid)).status,404);
});
test('prepare and recovery finish only missing capture with same grant ID, never activate or expose preparing token',async()=>{
 for(const mode of ['prepare','recover'] as const){
  const f=await setup();f.config.activeKeyVersion='v1';
  f.state.context={...f.context,captured:false,grant:f.receipt.result};
  const db=f.dependencies.service;
  f.dependencies.service={rpc:async(name,args)=>{
   if(name!=='capture_native_estimate_decision_grant')return db.rpc(name,args);
   f.state.calls.push({name,args});assert.equal(args.p_grant_id,id(1));assert.equal(args.p_actor_id,id(2));assert.equal(args.p_token_hash,f.material.token_hash);
   const grant={...f.grant,state:'captured',activation:null};
   f.state.context={...f.context,grant};
   return{error:null,data:{...grant,capture:{captured_at:time}}};
  }};
  const r=await f.handler(mode)(f.req());assert.equal(r.status,200);
  const output=await r.json();assert.equal(output.grant.state,'captured');assert.equal(output.link,null);assert.deepEqual(output.receipt,f.receipt);
  assert.deepEqual(f.state.calls.map(c=>c.name),[mode==='prepare'?'record_native_estimate_decision_grant':'recover_native_estimate_decision_grant','native_estimate_decision_grant_capture_context','capture_native_estimate_decision_grant','native_estimate_decision_grant_capture_context']);
 }
});
test('lost capture response is recoverable with original exact ID without another capture',async()=>{
 const f=await setup();f.config.activeKeyVersion='v1';f.state.context={...f.context,captured:false,grant:f.receipt.result};
 const db=f.dependencies.service;
 f.dependencies.service={rpc:async(name,args)=>{
  if(name!=='capture_native_estimate_decision_grant')return db.rpc(name,args);
  f.state.calls.push({name,args});f.state.context={...f.context,grant:{...f.grant,state:'captured',activation:null}};
  throw new Error('Lost response');
 }};
 assert.equal((await f.handler('prepare')(f.req())).status,404);
 const recovered=await f.handler()(f.req());assert.equal(recovered.status,200);assert.equal((await recovered.json()).grant.state,'captured');
 assert.equal(f.state.calls.filter(c=>c.name==='capture_native_estimate_decision_grant').length,1);
});
test('unauthenticated and foreign-origin staff requests cannot reach SQL',async()=>{
 const f=await setup();
 const noAuth=new Request('https://edge.test',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:id(1),request:f.request})});
 assert.equal((await f.handler()(noAuth)).status,401);
 const foreign=f.req();foreign.headers.set('Origin','https://evil.test');assert.equal((await f.handler()(foreign)).status,404);
 assert.equal(f.state.calls.length,0);
 const rejected=createEstimateDecisionGrantHandler({...f.dependencies,authenticate:async()=>null},'recover');
 assert.equal((await rejected(f.req())).status,401);assert.equal(f.state.calls.length,0);
});
