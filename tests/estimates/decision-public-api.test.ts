import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {bootstrapEstimateDecisionAccess,createEstimateDecisionPublicApi,isEstimateDecisionRoute} from '../../src/shared/estimate-decision-public-api.ts';
const id=(n:number)=>`ad530000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const hash='a'.repeat(64),token='e1.'+'A'.repeat(43),time='2026-09-16T12:00:00Z';
function fixture(path='/estimate/'+id(1),search=''){
 const events=new Map<string,()=>void>(),replaced:string[]=[];
 const env={location:{pathname:path,search,hash:'#'+token},history:{replaceState:(_a:unknown,_b:string,url:string)=>{replaced.push(url);}},addEventListener:(event:string,listener:()=>void)=>{events.set(event,listener);},removeEventListener:(event:string)=>{events.delete(event);}};
 const access=bootstrapEstimateDecisionAccess(env)!;
 const saved=new Map<string,string>();const storage={getItem:(k:string)=>saved.get(k)??null,setItem:(k:string,v:string)=>{saved.set(k,v);},removeItem:(k:string)=>{saved.delete(k);}};
 const binding={target:{estimate_id:id(3),client_id:id(4),pet_id:id(5)},publication_id:id(6),content_hash:hash,artifact_hash:hash};
 const request={binding,grant_id:id(1),expected_publication_head:{event_id:id(6),version:1,record_hash:hash},choice:'accept',signer_name:'Synthetic owner',signer_relationship:'owner',comment:null,acknowledgment_version:1,attest_document_review:true,attest_authority:true,attest_choice:true};
 const op={version:1,id:id(9),grant_id:id(1),publication_id:id(6),request};
 const receipt={version:1,id:id(9),grant_id:id(1),request,request_hash:hash,result:{version:1,id:id(9),sequence:1,binding,choice:'accept',signer_name:request.signer_name,signer_relationship:'owner',comment:null,acknowledgment_version:1,attribution:'link_holder',recorded_at:time,record_hash:hash},created_at:time};
 const closure={version:1,id:id(9),grant_id:id(1),request,request_hash:hash,closed_at:time,record_hash:hash,closed_by:'link_holder'};
 const calls:RequestInit[]=[];let output:unknown={version:1,status:'unrecorded'},status=200;
 const api=createEstimateDecisionPublicApi(access,{baseUrl:'https://backend.test',publishableKey:'public-key',storage,fetcher:async(_url,init)=>{assert.deepEqual(replaced,[path]);calls.push(init!);return new Response(JSON.stringify(output),{status,headers:{'Content-Type':'application/json'}});}});
 return {access,env,events,replaced,saved,storage,binding,op,receipt,closure,calls,api,setOutput:(v:unknown,s=200)=>{output=v;status=s;}};
}
test('bootstrap strips even malformed/query capabilities before any transport, hides secret and retires',()=>{
 const f=fixture();assert.equal(f.access.available(),true);assert.equal(JSON.stringify(f.access).includes(token),false);assert.deepEqual(f.replaced,['/estimate/'+id(1)]);
 f.events.get('hashchange')!();assert.equal(f.access.available(),false);assert.equal(f.events.size,0);
 assert.equal(fixture('/estimate/'+id(1),'?token=bad').access.available(),false);
 for(const p of ['/estimate','/estimate/bad','/estimate/'+id(1)+'/extra'])assert.equal(fixture(p).access.available(),false);
 assert.equal(isEstimateDecisionRoute('/estimate-other'),false);
});
test('retains token-free exact intent before POST and absence cannot discard it',async()=>{
 const f=fixture();const r=await f.api.recover(f.op);assert.equal(r.status,'unrecorded');assert.equal(f.saved.size,1);
 const call=f.calls[0];assert.equal(call.credentials,'omit');assert.equal(call.redirect,'error');assert.equal(call.referrerPolicy,'no-referrer');assert.equal(call.cache,'no-store');
 const headers=call.headers as Record<string,string>;assert.equal(headers['X-Estimate-Capability'],token);assert.equal(headers.Authorization,undefined);assert.equal(headers.Cookie,undefined);assert.equal(headers.apikey,'public-key');
 assert.ok(!String(call.body).includes(token));assert.ok(![...f.saved.values()].join('').includes(token));
 f.setOutput({error:'unavailable'},404);await assert.rejects(f.api.recover(f.op));assert.equal(f.saved.size,1);
 await assert.rejects(f.api.record({...f.op,id:id(10)}));assert.equal(f.calls.length,2);
});
test('only exact receipt or durable closure clears original pending request',async()=>{
 const f=fixture();f.setOutput({version:1,status:'recorded',receipt:f.receipt});assert.equal((await f.api.recover(f.op)).status,'recorded');assert.equal(f.saved.size,0);
 f.setOutput({version:1,status:'closed_unrecorded',closure:{...f.closure,id:id(10)}});await assert.rejects(f.api.close(f.op));assert.equal(f.saved.size,1);
 f.setOutput({version:1,status:'unrecorded'});await assert.rejects(f.api.close(f.op));assert.equal(f.saved.size,1);
 f.setOutput({version:1,status:'closed_unrecorded',closure:f.closure});assert.equal((await f.api.close(f.op)).status,'closed_unrecorded');assert.equal(f.saved.size,0);
});
test('storage failure blocks write; retirement ignores late successful responses without clearing intent',async()=>{
 const f=fixture();let calls=0,release:(v:Response)=>void=()=>{};
 const api=createEstimateDecisionPublicApi(f.access,{baseUrl:'https://backend.test',storage:f.storage,fetcher:async()=>{calls++;return new Promise(resolve=>{release=resolve;});}});
 const pending=api.recover(f.op);await Promise.resolve();assert.equal(calls,1);f.access.retire();release(new Response(JSON.stringify({version:1,status:'recorded',receipt:f.receipt}),{headers:{'Content-Type':'application/json'}}));await assert.rejects(pending);assert.equal(f.saved.size,1);
 const g=fixture();const blocked=createEstimateDecisionPublicApi(g.access,{baseUrl:'https://backend.test',storage:{...g.storage,setItem:()=>{throw new Error('full');}},fetcher:async()=>{throw new Error('must not fetch');}});await assert.rejects(blocked.recover(g.op));
});
test('read verifies large exact UTF8 bytes, closed public projection and artifact target',async()=>{
 const f=fixture(),html='<!doctype html><p>'+'x'.repeat(2097000)+'</p>',digest=createHash('sha256').update(html).digest('hex');
 const review={version:1,grant_id:id(1),binding:{...f.binding,artifact_hash:digest},publication_head:f.op.request.expected_publication_head,publication_status:'open',decision:null,review:{practice:{name:'The Living Room Veterinary Care',address:'2619 Spruce Street, Boulder, CO',domain:'thelivingroom.vet'},household_name:'Synthetic household',patient:{name:'Juniper',species:'Dog',breed:null},title:'Estimate',total_cents:'1250',currency:'usd',accept_by:'2026-10-31',expires_at:'2026-11-01T06:00:00Z',acknowledgment_version:1,scope:'entire_exact_revision',not_clinical_consent:true,not_payment:true},artifact:{filename:`estimate-${id(3)}-draft-1-publication-${id(7)}.html`,mime_type:'text/html; charset=utf-8',byte_length:Buffer.byteLength(html),sha256:digest,renderer_version:1},content_base64:Buffer.from(html).toString('base64')};
 f.setOutput(review);const result=await f.api.read();assert.equal(await result.document.text(),html);
 const reviewedOp={...f.op,request:{...f.op.request,binding:review.binding}};
 f.setOutput({...f.receipt,request:reviewedOp.request,result:{...f.receipt.result,binding:review.binding}});
 assert.equal((await f.api.record(reviewedOp)).status,'recorded');
 await assert.rejects(f.api.record({...reviewedOp,request:{...reviewedOp.request,expected_publication_head:{event_id:id(9),version:2,record_hash:hash}}}));
 f.setOutput({...review,actor_id:id(2)});await assert.rejects(f.api.read());
 f.setOutput({...review,content_base64:Buffer.from('bad').toString('base64')});await assert.rejects(f.api.read());
 f.setOutput({...review,artifact:{...review.artifact,filename:`estimate-${id(8)}-draft-1-publication-${id(7)}.html`}});await assert.rejects(f.api.read());
});
test('oversized streamed replies and backend origins fail without retiring pending intent',async()=>{
 const f=fixture();assert.throws(()=>createEstimateDecisionPublicApi(f.access,{baseUrl:'https://backend.test/path',storage:f.storage}));
 let canceled=false;
 const api=createEstimateDecisionPublicApi(f.access,{baseUrl:'https://backend.test',storage:f.storage,fetcher:async()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(65537));},cancel(){canceled=true;}}),{headers:{'Content-Type':'application/json'}})});
 await assert.rejects(api.recover(f.op));assert.equal(canceled,true);assert.equal(f.saved.size,1);
});

test('record requires a verified document review before retaining or sending a decision',async()=>{
 const f=fixture();await assert.rejects(f.api.record(f.op));assert.equal(f.calls.length,0);assert.equal(f.saved.size,0);
 // Historical recovery and terminal closure never require a new/current document.
 assert.equal((await f.api.recover(f.op)).status,'unrecorded');
 f.env.history.replaceState=()=>{throw new Error('history unavailable');};
 assert.doesNotThrow(()=>f.events.get('hashchange')!());assert.equal(f.access.available(),false);
});
