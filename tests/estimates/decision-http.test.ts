import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createEstimateDecisionHandler} from '../../supabase/functions/_shared/estimate-decision-http.ts';
import {estimateDecisionConfig,materializeEstimateDecision} from '../../supabase/functions/_shared/estimate-decision-capability.ts';
const id=(n:number)=>`ad530000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const hash='a'.repeat(64),time='2026-09-16T12:00:00.000000Z';
const sha=(v:string)=>createHash('sha256').update(v).digest('hex');
async function setup(htmlOverride?:string){
 const config=estimateDecisionConfig({origin:'https://thelivingroom.vet',activeKeyVersion:'v1',keys:JSON.stringify({v1:Buffer.alloc(32,9).toString('base64')}),publicEnabled:'true'});
 const html=htmlOverride??'<!doctype html><h1>Exact captured estimate</h1>';
 const binding={target:{estimate_id:id(3),client_id:id(4),pet_id:id(5)},publication_id:id(6),content_hash:hash,artifact_hash:sha(html)};
 const head={event_id:id(6),version:1,record_hash:hash};
 const ctx={domain:'lrv-estimate-decision/v1',context_version:1,grant_id:id(1),actor_id:id(2),binding,expires_at:'2026-10-01T06:00:00.000000Z',origin:config.origin,key_version:'v1'};
 const text=JSON.stringify(ctx);const flat={id:id(1),actor_id:id(2),binding,expires_at:ctx.expires_at,origin:ctx.origin,key_version:'v1',capability_context:text,context_hash:sha(text)};
 const material=await materializeEstimateDecision(flat,config);
 const grant={version:1,id:id(1),actor_id:id(2),request:{binding,expected_publication_head:head,expires_at:ctx.expires_at,recipient_label:'Owner',purpose:'Review estimate',attest_recipient_authority:true},request_hash:hash,created_at:time,capability:{origin:ctx.origin,key_version:'v1',context_hash:flat.context_hash},capture:{token_hash:material.token_hash,captured_at:time},head,state:'active',activation:{id:id(8),actor_id:id(2),created_at:time},revocation:null};
 const access={grant,capability_context:text,context_hash:flat.context_hash,captured:true};
 const request={binding,grant_id:id(1),expected_publication_head:head,choice:'accept',signer_name:'Synthetic Owner',signer_relationship:'owner',comment:null,acknowledgment_version:1,attest_document_review:true,attest_authority:true,attest_choice:true};
 const decision={version:1,id:id(9),sequence:1,binding,choice:'accept',signer_name:request.signer_name,signer_relationship:'owner',comment:null,acknowledgment_version:1,attribution:'link_holder',recorded_at:time,record_hash:hash};
 const receipt={version:1,id:id(9),grant_id:id(1),request,request_hash:hash,result:decision,created_at:time};
 const closure={version:1,id:id(9),grant_id:id(1),request,request_hash:hash,closed_at:time,record_hash:hash,closed_by:'link_holder'};
 const review={version:1,grant_id:id(1),binding,publication_head:head,publication_status:'open',decision:null,review:{practice:{name:'The Living Room Veterinary Care',address:'2619 Spruce Street, Boulder, CO',domain:'thelivingroom.vet'},household_name:'Synthetic household',patient:{name:'Juniper',species:'Dog',breed:null},title:'Visit estimate',total_cents:'1250',currency:'usd',accept_by:'2026-10-31',expires_at:'2026-11-01T06:00:00.000000Z',acknowledgment_version:1,scope:'entire_exact_revision',not_clinical_consent:true,not_payment:true},artifact:{filename:`estimate-${id(3)}-draft-1-publication-${id(7)}.html`,mime_type:'text/html; charset=utf-8',byte_length:Buffer.byteLength(html),sha256:sha(html),renderer_version:1},content_base64:Buffer.from(html).toString('base64')};
 const state={allow:true,error:false,output:null as unknown,calls:[] as {name:string;args:Record<string,unknown>}[]};
 const handler=createEstimateDecisionHandler({config,rateLimit:async()=>state.allow,db:{rpc:async(name,args)=>{state.calls.push({name,args});return {error:state.error?{message:'PRIVATE DATABASE ERROR token-secret'}:null,data:name==='native_estimate_decision_access_context'?access:state.output??(name==='retrieve_native_estimate_decision'?review:name==='record_native_estimate_client_decision'?receipt:{version:1,status:'unrecorded'})};}}});
 const req=(body:unknown={action:'read',grant_id:id(1)},headers:Record<string,string>={})=>new Request('https://backend.test/functions/v1/estimate-decision',{method:'POST',headers:{Origin:config.origin,'Content-Type':'application/json','X-Estimate-Capability':material.token,...headers},body:JSON.stringify(body)});
 return {config,handler,req,state,access,review,receipt,closure,request,material};
}
test('read returns exact captured bytes with private headers and no internal grant context',async()=>{
 const f=await setup(),r=await f.handler(f.req());assert.equal(r.status,200);assert.deepEqual(await r.json(),f.review);assert.equal(r.headers.get('access-control-allow-origin'),f.config.origin);assert.equal(r.headers.get('cache-control'),'no-store, private');assert.equal(f.state.calls.length,2);assert.equal(f.state.calls[1].args.p_token_hash,f.material.token_hash);assert.ok(!JSON.stringify(f.state.calls).includes(f.material.token));
});
test('gate, Origin, authorization, token and rate limiter reject before privileged retrieval',async()=>{
 for(const headers of ([{Origin:'https://evil.test'},{Authorization:'Bearer staff'},{Cookie:'staff=1'},{'X-Estimate-Capability':'bad'}] as Record<string,string>[])){const f=await setup();assert.equal((await f.handler(f.req(undefined,headers))).status,404);assert.equal(f.state.calls.length,0);}
 const f=await setup();f.config.publicEnabled=false;assert.equal((await f.handler(f.req())).status,404);assert.equal(f.state.calls.length,0);
 const g=await setup();g.state.allow=false;assert.equal((await g.handler(g.req())).status,429);assert.equal(g.state.calls.length,0);
 const h=await setup();assert.equal((await h.handler(f.req(undefined,{'X-Estimate-Capability':'e1.'+'A'.repeat(43)}))).status,404);assert.equal(h.state.calls.length,1);
});
test('closed body validation and streaming size bounds fail without database calls',async()=>{
 for(const body of [{action:'read',grant_id:id(1),token:'secret'},{action:'delete',grant_id:id(1)},{action:'read',grant_id:'bad'},{action:'record',id:id(9),request:{}},'x'.repeat(65537)]){const f=await setup();assert.equal((await f.handler(f.req(body))).status,404);assert.equal(f.state.calls.length,0);}
 const f=await setup();assert.equal((await f.handler(f.req(undefined,{'Content-Type':'text/plain'}))).status,404);
});
test('access binding, stored token hash and response bytes are verified without fallback',async()=>{
 for(const mutate of [(f:Awaited<ReturnType<typeof setup>>)=>{f.access.grant.id=id(11);},(f:Awaited<ReturnType<typeof setup>>)=>{f.access.grant.capture.token_hash='b'.repeat(64);},(f:Awaited<ReturnType<typeof setup>>)=>{f.review.binding={...f.review.binding,publication_id:id(11)};},(f:Awaited<ReturnType<typeof setup>>)=>{f.review.content_base64=Buffer.from('corrupted').toString('base64');},(f:Awaited<ReturnType<typeof setup>>)=>{f.review.artifact.filename=`estimate-${id(12)}-draft-1-publication-${id(7)}.html`;},(f:Awaited<ReturnType<typeof setup>>)=>{f.review.content_base64+='\n';},(f:Awaited<ReturnType<typeof setup>>)=>{f.review.review.expires_at='2026-11-01T07:00:00Z';}]){const f=await setup();mutate(f);assert.equal((await f.handler(f.req())).status,404);}
 const f=await setup();f.state.output={...f.review,actor_id:id(2)};assert.equal((await f.handler(f.req())).status,404);
});
test('record, recover and terminal closure stay bound to exact original request',async()=>{
 const f=await setup();const input={action:'record',id:id(9),request:f.request};assert.equal((await f.handler(f.req(input))).status,200);
 f.state.output={version:1,status:'recorded',receipt:f.receipt};assert.equal((await f.handler(f.req({...input,action:'recover'}))).status,200);
 f.state.output={version:1,status:'closed_unrecorded',closure:f.closure};assert.equal((await f.handler(f.req({...input,action:'close'}))).status,200);
 f.state.output={version:1,status:'unrecorded'};assert.equal((await f.handler(f.req({...input,action:'recover'}))).status,200);assert.equal((await f.handler(f.req({...input,action:'close'}))).status,404);
 for(const receipt of [{...f.receipt,id:id(12)},{...f.receipt,request:{...f.request,signer_name:'Substituted'}},{...f.receipt,grant_id:id(12)}]){f.state.output=receipt;assert.equal((await f.handler(f.req(input))).status,404);}
 const other={...f.request,binding:{...f.request.binding,publication_id:id(12)}};assert.equal((await f.handler(f.req({...input,request:other}))).status,404);
});
test('expired or revoked SQL denial remains unavailable, never an absent receipt or leaked error',async()=>{
 const f=await setup();f.state.error=true;const r=await f.handler(f.req({action:'recover',id:id(9),request:f.request}));assert.equal(r.status,404);assert.deepEqual(await r.json(),{error:'Estimate access unavailable'});
});

test('near-2 MiB captured artifact passes the actual handler without regexp recursion',async()=>{
 const html='<!doctype html><p>'+ 'x'.repeat(2097000)+'</p>';
 const f=await setup(html), r=await f.handler(f.req());
 assert.equal(r.status,200);const body=await r.json();
 assert.equal(Buffer.from(body.content_base64,'base64').toString('utf8'),html);
 assert.equal(body.artifact.byte_length,Buffer.byteLength(html));
});
test('private grant recipient and purpose use exact codepoint bounds',async()=>{
 const valid=await setup();valid.access.grant.request.recipient_label='😀'.repeat(200);valid.access.grant.request.purpose='😀'.repeat(500);
 assert.equal((await valid.handler(valid.req())).status,200);
 for(const [field,value] of [['recipient_label','😀'.repeat(201)],['purpose','x'.repeat(501)],['recipient_label',' padded'],['purpose','bad\rvalue']]){
   const f=await setup();Object.assign(f.access.grant.request,{[field]:value});
   assert.equal((await f.handler(f.req())).status,404);
 }
});
