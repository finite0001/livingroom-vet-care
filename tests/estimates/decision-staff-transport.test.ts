import test from 'node:test';import assert from 'node:assert/strict';
import {createActorPinnedEstimateDecisionRpc} from '../../src/hub/features/estimates/decision-staff-transport.ts';
const actor='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002';
test('wrong or missing current actor produces zero dispatch for save and closure',async()=>{
 for(const session of [null,{user:{id:other},access_token:'other-secret'}]){
 let calls=0;const db=createActorPinnedEstimateDecisionRpc({baseUrl:'https://backend.test',publishableKey:'public',actorId:actor,getSession:async()=>session,fetcher:async()=>{calls++;throw new Error('must not dispatch');}});
 for(const name of ['record_native_estimate_witnessed_decision','close_native_estimate_witnessed_decision']){const result=await db.rpc(name,{});assert.ok(result.error);assert.equal(result.data,null);assert.ok(!String(result.error).includes('other-secret'));}assert.equal(calls,0);
 }
});
test('session switches after lookup cannot substitute the captured JWT',async()=>{
 const session={user:{id:actor},access_token:'original-secret'};
 const db=createActorPinnedEstimateDecisionRpc({baseUrl:'https://backend.test',publishableKey:'public',actorId:actor,getSession:async()=>session,fetcher:async(_url,init)=>{
 session.user.id=other;session.access_token='new-secret';
 assert.equal((init!.headers as Record<string,string>).Authorization,'Bearer original-secret');assert.equal(init!.credentials,'omit');assert.equal(init!.redirect,'error');
 return new Response('null',{headers:{'Content-Type':'application/json'}});
 }});
 assert.deepEqual(await db.rpc('recover_native_estimate_witnessed_decision',{p_id:actor}),{data:null,error:null});
 assert.ok((await db.rpc('record_native_estimate_witnessed_decision',{})).error);
});
test('unknown RPC and malformed/oversized response fail with generic errors',async()=>{
 let calls=0;const db=createActorPinnedEstimateDecisionRpc({baseUrl:'https://backend.test',publishableKey:'public',actorId:actor,getSession:async()=>({user:{id:actor},access_token:'secret'}),fetcher:async()=>{calls++;return new Response('private-secret',{headers:{'Content-Type':'application/json'}});}});
 assert.ok((await db.rpc('unrelated_rpc',{})).error);assert.equal(calls,0);
 const result=await db.rpc('read_native_estimate_decision_state',{});assert.ok(result.error);assert.ok(!String(result.error).includes('private-secret'));
});
