import test from 'node:test';import assert from 'node:assert/strict';
import {createEstimateDecisionStaffApi} from '../../src/hub/features/estimates/decision-staff-api.ts';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,actor=id(1),hash='a'.repeat(64),time='2026-09-16T12:00:00.123456Z';
const target={estimate_id:id(2),client_id:id(3),pet_id:id(4)},head={event_id:id(5),version:1,record_hash:hash};
const binding={target,publication_id:id(5),content_hash:hash,artifact_hash:hash};
const decision={binding,grant_id:null,expected_publication_head:head,choice:'decline',signer_name:'Owner',signer_relationship:'owner',comment:null,acknowledgment_version:1,attest_document_review:true,attest_authority:true,attest_choice:true};
const witness={channel:'telephone',occurred_at:time,note:'Direct instruction',attest_direct_client_instruction:true},request={decision,witness};
const op={id:id(6),kind:'record_witnessed_estimate_decision',payload:request};
const result={version:1,id:op.id,sequence:1,binding,choice:'decline',signer_name:'Owner',signer_relationship:'owner',comment:null,acknowledgment_version:1,provenance:{kind:'staff_witness',actor_id:actor,witness},publication_head:head,decision_head:{event_id:null,version:0,record_hash:null},recorded_at:time,record_hash:hash};
const receipt={version:1,id:op.id,principal:{kind:'staff',id:actor},mutation:{kind:'witnessed_decision',request},request_hash:hash,result,created_at:time};
const closure={version:1,id:op.id,principal:{kind:'staff',id:actor},mutation:receipt.mutation,request_hash:hash,closed_by:{kind:'staff',id:actor},reason:null,closed_at:time,record_hash:hash};
const api=(data:unknown)=>createEstimateDecisionStaffApi({rpc:async()=>({data,error:null})},actor,target);
test('witness saves and recovers exact actor-scoped immutable receipt with microseconds',async()=>{assert.deepEqual(await api(receipt).execute(op),receipt);assert.deepEqual(await api(receipt).recover(op),receipt);assert.equal(await api(null).recover(op),null);});
test('witness adapter rejects substituted actor, request, patient and one-microsecond chronology regression',async()=>{
 for(const value of [{...receipt,principal:{kind:'staff',id:id(9)}},{...receipt,result:{...result,provenance:{...result.provenance,actor_id:id(9)}}},{...receipt,result:{...result,binding:{...binding,target:{...target,pet_id:id(9)}}}},{...receipt,mutation:{...receipt.mutation,request:{...request,witness:{...witness,note:'changed'}}}},{...receipt,created_at:'2026-09-16T12:00:00.123455Z',result:{...result,recorded_at:'2026-09-16T12:00:00.123455Z'}}])await assert.rejects(api(value).execute(op));
});
test('closure requires original ID, exact request, same staff closer and no unrecorded shortcut',async()=>{
 const complete={version:1,status:'closed_unrecorded',closure};assert.deepEqual(await api(complete).close(op),complete);
 for(const value of [{version:1,status:'unrecorded'},{...complete,closure:{...closure,id:id(9)}},{...complete,closure:{...closure,closed_by:{kind:'staff',id:id(9)}}}])await assert.rejects(api(value).close(op));
 assert.deepEqual(await api({version:1,status:'recorded',receipt}).close(op),{version:1,status:'recorded',receipt});
});
