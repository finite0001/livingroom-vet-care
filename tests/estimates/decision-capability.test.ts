import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,createHmac} from 'node:crypto';
import {estimateDecisionConfig,materializeEstimateDecision,verifyEstimateDecisionCapability,validateEstimateDecisionContext,validEstimateDecisionCapability,estimateDecisionCapabilityHash,type EstimateDecisionCapabilityGrant} from '../../supabase/functions/_shared/estimate-decision-capability.ts';
const id=(n:number)=>`ab530000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const key=Buffer.alloc(32,19).toString('base64');
const values={origin:'https://thelivingroom.vet',activeKeyVersion:'v1',keys:JSON.stringify({v1:key})};
const sha=(v:string)=>createHash('sha256').update(v).digest('hex');
function fixture() {
  const c={domain:'lrv-estimate-decision/v1',context_version:1,grant_id:id(1),actor_id:id(2),binding:{target:{estimate_id:id(3),client_id:id(4),pet_id:id(5)},publication_id:id(6),content_hash:'a'.repeat(64),artifact_hash:'b'.repeat(64)},expires_at:'2026-10-01T18:00:00.123456Z',origin:values.origin,key_version:'v1'};
  // SQL spacing/order is deliberately retained, rather than recreated by JS.
  const text=JSON.stringify(c,null,1);
  const grant:EstimateDecisionCapabilityGrant={id:c.grant_id,actor_id:c.actor_id,binding:c.binding,expires_at:c.expires_at,origin:c.origin,key_version:c.key_version,capability_context:text,context_hash:sha(text)};
  return {c,grant,config:estimateDecisionConfig(values)};
}
test('defaults gates disabled and accepts only exact trusted origins and canonical keys',()=>{
  assert.equal(estimateDecisionConfig(values).publicEnabled,false);
  assert.equal(estimateDecisionConfig({...values,issuanceEnabled:'true'}).issuanceEnabled,true);
  for(const origin of ['http://thelivingroom.vet','https://thelivingroom.vet/','https://user:pass@thelivingroom.vet','https://thelivingroom.vet?q=1','https://thelivingroom.vet#x','not-url']) assert.throws(()=>estimateDecisionConfig({...values,origin}));
  assert.equal(estimateDecisionConfig({...values,origin:'http://127.0.0.1:8080'}).origin,'http://127.0.0.1:8080');
  for(const keys of ['null','[]','{}','{','{"v1":"short"}',JSON.stringify({v1:Buffer.alloc(31).toString('base64')}),JSON.stringify({v1:Buffer.alloc(65).toString('base64')}),JSON.stringify({v1:key.replace(/=$/,'')})]) assert.throws(()=>estimateDecisionConfig({...values,keys}));
  assert.throws(()=>estimateDecisionConfig({...values,activeKeyVersion:'x y'}));
  assert.throws(()=>estimateDecisionConfig({...values,publicEnabled:'TRUE'}));
  assert.throws(()=>estimateDecisionConfig({...values,keys:JSON.stringify(Object.fromEntries(Array.from({length:17},(_,i)=>[`v${i}`,key])))}));
});
test('signs the exact SQL context bytes with the estimate-specific domain and verifies hash',async()=>{
  const {grant,config}=fixture();
  const r=await materializeEstimateDecision(grant,config);
  const expected='e1.'+createHmac('sha256',Buffer.from(key,'base64')).update(JSON.stringify(['living-room-vet.estimate-decision.v1',grant.capability_context])).digest('base64url');
  assert.equal(r.token,expected);assert.equal(r.token_hash,sha(r.token));
  assert.equal(r.url,`${values.origin}/estimate/${grant.id}#${expected}`);
  assert.equal(await verifyEstimateDecisionCapability(r.token,grant,config),r.token_hash);
  assert.equal(await estimateDecisionCapabilityHash(r.token),r.token_hash);
  const reordered={...grant,capability_context:JSON.stringify(JSON.parse(grant.capability_context))};
  reordered.context_hash=sha(reordered.capability_context);
  assert.notEqual((await materializeEstimateDecision(reordered,config)).token,r.token);
  assert.notEqual(r.token.slice(3),createHmac('sha256',Buffer.from(key,'base64')).update(JSON.stringify(['living-room-vet.payment-collection.v1',grant.capability_context])).digest('base64url'));
});
test('rotation retains the frozen old key/context and missing old key fails closed',async()=>{
  const {grant,config}=fixture(), original=await materializeEstimateDecision(grant,config);
  const rotated=estimateDecisionConfig({...values,activeKeyVersion:'v2',keys:JSON.stringify({v1:key,v2:Buffer.alloc(32,20).toString('base64')})});
  assert.deepEqual(await materializeEstimateDecision(grant,rotated),original);
  await assert.rejects(materializeEstimateDecision(grant,estimateDecisionConfig({...values,activeKeyVersion:'v2',keys:JSON.stringify({v2:key})})));
  await assert.rejects(verifyEstimateDecisionCapability(original.token,grant,estimateDecisionConfig({...values,keys:JSON.stringify({v1:Buffer.alloc(32,20).toString('base64')})})));
});
test('closed context rejects substitution, extra fields and malformed immutable evidence',async()=>{
  const {grant,config,c}=fixture();
  for(const patch of [{grant_id:id(9)},{actor_id:id(9)},{expires_at:'2026-10-02T18:00:00.123456Z'},{origin:'https://other.test'},{key_version:'v2'},{domain:'lrv-payment-collection/v2'},{context_version:2},{extra:true},{binding:{...c.binding,publication_id:id(9)}},{binding:{...c.binding,target:{...c.binding.target,pet_id:id(9)}}},{binding:{...c.binding,extra:true}}]) {
    const text=JSON.stringify({...c,...patch});
    await assert.rejects(validateEstimateDecisionContext({...grant,capability_context:text,context_hash:sha(text)},config));
  }
  for(const patch of [{id:grant.id.toUpperCase()},{actor_id:'bad'},{expires_at:'2026-02-30T00:00:00Z'},{expires_at:'2026-10-01T18:00:00+00:00'},{context_hash:'f'.repeat(64)},{extra:1}]) await assert.rejects(validateEstimateDecisionContext({...grant,...patch},config));
  for(const text of ['null','[]','{',grant.capability_context+'\ud800',' '.repeat(8193),JSON.stringify({...c,expires_at:'\\ud800'})]) await assert.rejects(validateEstimateDecisionContext({...grant,capability_context:text,context_hash:sha(text)},config));
});
test('wrong tokens and noncanonical base64url encodings fail; crypto is not a live eligibility check',async()=>{
  const {grant,config}=fixture();
  const r=await materializeEstimateDecision(grant,config);
  for(const t of ['',r.token.replace('e1.','v1.'),r.token+'=',null,'e1.'+'A'.repeat(42)+'B','e1.'+'A'.repeat(43)]) {
    if(t!==r.token) await assert.rejects(verifyEstimateDecisionCapability(t,grant,config));
  }
  assert.equal(validEstimateDecisionCapability(r.token),true);
  assert.equal(validEstimateDecisionCapability('e1.'+'A'.repeat(42)+'B'),false);
  const past={...grant,expires_at:'2000-01-01T00:00:00Z'};
  const context={...JSON.parse(grant.capability_context),expires_at:past.expires_at};
  past.capability_context=JSON.stringify(context);past.context_hash=sha(past.capability_context);
  // SQL/HTTP must deny expired access; deterministic historical proof never changes with wall time.
  assert.equal(validEstimateDecisionCapability((await materializeEstimateDecision(past,config)).token),true);
});
