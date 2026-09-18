import test from 'node:test';
import assert from 'node:assert/strict';
import { createEstimateDecisionStaffReads } from '../../src/hub/features/estimates/decision-staff-api.ts';
const id=(n:number)=>`00000000-0000-4000-8000-${n.toString().padStart(12,'0')}`;
const target={estimate_id:id(1),client_id:id(2),pet_id:id(3)};
const hash='a'.repeat(64),head={event_id:id(4),version:1,record_hash:hash};
const empty={event_id:null,version:0,record_hash:null};
const binding={target,publication_id:id(4),content_hash:hash,artifact_hash:hash};
const decision={version:1,id:id(5),sequence:1,binding,choice:'accept',signer_name:'Synthetic Owner',signer_relationship:'owner',comment:null,acknowledgment_version:1,provenance:{kind:'grant',grant_id:id(6)},publication_head:head,decision_head:empty,recorded_at:'2026-09-16T12:00:00.123456Z',record_hash:hash};
const decisionHead={event_id:id(5),version:1,record_hash:hash};
const state={version:1,target,publication_head:head,decision_head:decisionHead,current_publication_id:id(4),current_decision:decision};
const page={version:1,target,head:decisionHead,items:[decision],next_before_sequence:null,has_more:false};
const api=(value:unknown)=>createEstimateDecisionStaffReads({rpc:async()=>({data:value,error:null})},target);

test('staff reads retain exact grant versus witnessed attribution and caller scope',async()=>{
 const calls:unknown[]=[];
 const client=createEstimateDecisionStaffReads({rpc:async(name,args)=>{calls.push({name,args});return {data:state,error:null};}},target);
 assert.deepEqual(await client.state(),state);
 assert.deepEqual(calls,[{name:'read_native_estimate_decision_state',args:{p_estimate_id:target.estimate_id,p_client_id:target.client_id}}]);
 assert.deepEqual(await api(page).history(),page);
 const witnessed={...decision,provenance:{kind:'staff_witness',actor_id:id(7),witness:{channel:'telephone',occurred_at:'2026-09-16T11:59:00.123456Z',note:'Synthetic direct request',attest_direct_client_instruction:true}}};
 assert.deepEqual((await api({...state,current_decision:witnessed}).state()).current_decision,witnessed);
});
test('staff current state rejects cross-patient, substituted publication and head evidence',async()=>{
 for(const value of [
  {...state,target:{...target,pet_id:id(9)}},
  {...state,current_publication_id:id(9)},
  {...state,decision_head:{...decisionHead,event_id:id(9)}},
  {...state,current_decision:{...decision,unexpected:'private extra'}},
 ])await assert.rejects(api(value).state());
});
test('history rejects cursor loops, duplicates and foreign patient evidence',async()=>{
 for(const value of [
  {...page,items:[decision,decision]},
  {...page,has_more:true,next_before_sequence:1},
  {...page,next_before_sequence:1},
  {...page,items:[{...decision,binding:{...binding,target:{...target,client_id:id(9)}}}]},
 ])await assert.rejects(api(value).history());
 await assert.rejects(api(page).history(1));
 await assert.rejects(api(page).history(null,51));
 assert.deepEqual(await api({...page,has_more:true,next_before_sequence:1}).history(null,1),{...page,has_more:true,next_before_sequence:1});
});
test('preview requires exact current publication and errors never become empty history',async()=>{
 const preview={version:1,binding,publication_head:head,expires_at:'2026-09-17T06:00:00Z',decision:null};
 assert.deepEqual(await api(preview).preview(id(4)),preview);
 await assert.rejects(api(preview).preview(id(9)));
 const failure=new Error('Synthetic denied');
 const client=createEstimateDecisionStaffReads({rpc:async()=>({data:null,error:failure})},target);
 await assert.rejects(client.state(),error=>error===failure);
 await assert.rejects(client.history(),error=>error===failure);
});
