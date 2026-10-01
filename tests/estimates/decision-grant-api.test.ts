import test from 'node:test';
import assert from 'node:assert/strict';
import {createEstimateDecisionGrantApi,createEstimateDecisionGrantEdge,EstimateGrantUnavailableError,type EstimateGrantIntent} from '../../src/hub/features/estimates/decision-grant-api.ts';
import {createActorPinnedEstimateDecisionRpc} from '../../src/hub/features/estimates/decision-staff-transport.ts';
const id=(n:number)=>`ad540000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const hash='a'.repeat(64),time='2026-09-30T12:00:00.000000Z',actor=id(2);
const target={estimate_id:id(3),client_id:id(4),pet_id:id(5)};
const binding={target,publication_id:id(6),content_hash:hash,artifact_hash:hash};
const head={event_id:id(6),version:1,record_hash:hash};
const preview={binding,publication_head:head,expires_at:'2099-11-01T06:00:00.000000Z'};
const token=`e1.${'A'.repeat(43)}`;
function fixture(){
 const calls:{name:string;args:Record<string,unknown>}[]=[],posts:{mode:string;body:EstimateGrantIntent}[]=[];
 let state:'preparing'|'captured'|'active'='captured',issuance=true,unavailable=false;
 const grantFor=(intent:EstimateGrantIntent)=>{
  const base={version:1,id:intent.id,actor_id:actor,request:intent.request,request_hash:hash,created_at:time,head:{event_id:intent.id,version:state==='active'?3:2,record_hash:hash},revocation:null};
  const captured={capability:{origin:'https://thelivingroom.vet',key_version:'v1',context_hash:hash},capture:{captured_at:time}};
  return state==='preparing'?{...base,capability:null,capture:null,state,activation:null}
   :state==='captured'?{...base,...captured,state,activation:null}
   :{...base,...captured,state,activation:{id:id(90),actor_id:actor,created_at:time}};
 };
 const edge={async post(mode:'prepare'|'recover',body:EstimateGrantIntent){
  posts.push({mode,body});if(unavailable)throw new EstimateGrantUnavailableError();
  const issued={version:1,id:body.id,actor_id:actor,request:body.request,request_hash:hash,created_at:time,capability:null,capture:null,head:{event_id:body.id,version:1,record_hash:hash},state:'preparing',activation:null,revocation:null};
  const receipt={version:1,id:body.id,actor_id:actor,mutation:{kind:'issue',request:body.request},request_hash:hash,result:issued,created_at:time};
  const grant=grantFor(body);
  const link=state==='active'&&issuance?{url:`https://thelivingroom.vet/estimate/${body.id}#${token}`,expires_at:body.request.expires_at}:null;
  return {version:1,receipt,grant,link};
 }};
 const db={rpc:async(name:string,args:Record<string,unknown>)=>{
  calls.push({name,args});
  if(name==='record_native_estimate_decision_grant'){
   const mutation=args.p_mutation as {request:{grant_id:string}};
   state='active';
   const request=posts[0]!.body.request;
   const result=grantFor({id:mutation.request.grant_id,request});
   return {data:{version:1,id:args.p_id,actor_id:actor,mutation:args.p_mutation,request_hash:hash,result,created_at:time},error:null};
  }
  return {data:null,error:new Error('unexpected')};
 }};
 const api=createEstimateDecisionGrantApi(edge,db,actor,target);
 return {api,calls,posts,set:(next:{state?:typeof state;issuance?:boolean;unavailable?:boolean})=>{state=next.state??state;issuance=next.issuance??issuance;unavailable=next.unavailable??unavailable;}};
}
const fields={recipient_label:' Jane Doe (owner) ',purpose:'Review estimate',expires_at:'2099-10-01T06:00:00.000Z',attest_recipient_authority:true};

test('issue builds the exact request, prepares, activates separately and materializes the creator link',async()=>{
 const f=fixture();
 const intent=f.api.intent(preview,fields);
 assert.equal(intent.request.recipient_label,'Jane Doe (owner)');
 assert.deepEqual(intent.request.binding,binding);assert.deepEqual(intent.request.expected_publication_head,head);
 const prepared=await f.api.prepare(intent);
 assert.equal(prepared.status,'not_active');
 assert.ok(prepared.status==='not_active');
 const activated=await f.api.activate(prepared.grant,head);
 assert.equal(activated.state,'active');
 const mutation=f.calls[0].args.p_mutation as {kind:string;request:Record<string,unknown>};
 assert.equal(f.calls[0].name,'record_native_estimate_decision_grant');assert.equal(mutation.kind,'activate');
 assert.deepEqual(mutation.request,{grant_id:intent.id,expected_grant_head:prepared.grant.head,expected_publication_head:head,expected_context_hash:hash,attest_review:true});
 const recovered=await f.api.recover(intent);
 assert.equal(recovered.status,'link');
 assert.ok(recovered.status==='link'&&recovered.url.endsWith(`/estimate/${intent.id}#${token}`));
 assert.deepEqual(f.posts.map(p=>p.mode),['prepare','recover']);
});
test('active grant without a link is reported as issuance switched off',async()=>{
 const f=fixture();f.set({state:'active',issuance:false});
 const outcome=await f.api.recover(f.api.intent(preview,fields));
 assert.equal(outcome.status,'issuance_disabled');
});
test('refused preparation surfaces the unavailable state without retrying or activating',async()=>{
 const f=fixture();f.set({unavailable:true});
 await assert.rejects(f.api.prepare(f.api.intent(preview,fields)),error=>error instanceof EstimateGrantUnavailableError&&/ESTIMATE_DECISION_ISSUANCE_ENABLED/.test(error.message));
 assert.equal(f.posts.length,1);assert.equal(f.calls.length,0);
});
test('requests outside this estimate or past the acceptance deadline are refused before sending',async()=>{
 const f=fixture();
 assert.throws(()=>f.api.intent(preview,{...fields,expires_at:'2099-12-01T06:00:00.000Z'}),/deadline/);
 assert.throws(()=>f.api.intent({...preview,binding:{...binding,target:{...target,pet_id:id(99)}}},fields));
 assert.throws(()=>f.api.intent(preview,{...fields,attest_recipient_authority:false}));
 assert.throws(()=>f.api.intent(preview,{...fields,recipient_label:'   '}));
 assert.equal(f.posts.length,0);
});
test('a substituted receipt from the edge is rejected',async()=>{
 const f=fixture();const intent=f.api.intent(preview,fields);
 const edge={post:async()=>({version:1,receipt:{version:1,id:id(77),actor_id:actor,mutation:{kind:'issue',request:intent.request},request_hash:hash,result:{version:1,id:id(77),actor_id:actor,request:intent.request,request_hash:hash,created_at:time,capability:null,capture:null,head:{event_id:id(77),version:1,record_hash:hash},state:'preparing',activation:null,revocation:null},created_at:time},grant:{version:1,id:id(77),actor_id:actor,request:intent.request,request_hash:hash,created_at:time,capability:null,capture:null,head:{event_id:id(77),version:1,record_hash:hash},state:'preparing',activation:null,revocation:null},link:null})};
 await assert.rejects(createEstimateDecisionGrantApi(edge,{rpc:async()=>({data:null,error:null})},actor,target).recover(intent));
});
test('issued lists only this staff member\'s issue events with their original request',async()=>{
 const intent=fixture().api.intent(preview,fields);
 const event=(n:number,kind:string,actorId:string)=>({id:kind==='issued'?intent.id:id(n),grant_id:intent.id,target,sequence:n,grant_version:1,previous_hash:null,kind,actor_id:actorId,created_at:time,request:kind==='issued'?intent.request:{grant_id:intent.id},record_hash:hash,eligibility:'active'});
 const page={version:1,target,items:[event(3,'activated',actor),event(2,'issued',id(55)),event(1,'issued',actor)],next_before_sequence:null,has_more:false};
 const calls:unknown[]=[];
 const api=createEstimateDecisionGrantApi({post:async()=>{throw new Error('unused');}},{rpc:async(name,args)=>{calls.push({name,args});return {data:page,error:null};}},actor,target);
 const issued=await api.issued();
 assert.equal(issued.length,1);assert.deepEqual(issued[0].intent,intent);assert.equal(issued[0].eligibility,'active');
 assert.deepEqual(calls,[{name:'read_native_estimate_decision_grants',args:{p_estimate_id:target.estimate_id,p_client_id:target.client_id,p_before_sequence:null,p_limit:50}}]);
 const foreign=createEstimateDecisionGrantApi({post:async()=>null},{rpc:async()=>({data:{...page,target:{...target,client_id:id(9)}},error:null})},actor,target);
 await assert.rejects(foreign.issued());
});
test('edge client posts to the exact function with staff JWT and maps 404 to unavailable',async()=>{
 const seen:{url:string;init:RequestInit}[]=[];
 let status=200;
 const edge=createEstimateDecisionGrantEdge('https://backend.test',async()=>'staff-jwt','public',async(url,init)=>{seen.push({url:String(url),init:init!});return new Response(JSON.stringify({ok:true}),{status,headers:{'Content-Type':'application/json'}});});
 const intent=fixture().api.intent(preview,fields);
 assert.deepEqual(await edge.post('prepare',intent),{ok:true});
 assert.equal(seen[0].url,'https://backend.test/functions/v1/prepare-estimate-decision-grant');
 assert.equal((seen[0].init.headers as Record<string,string>).Authorization,'Bearer staff-jwt');
 assert.equal(seen[0].init.credentials,'omit');assert.equal(seen[0].init.redirect,'error');
 status=404;await assert.rejects(edge.post('recover',intent),EstimateGrantUnavailableError);
 assert.equal(seen[1].url,'https://backend.test/functions/v1/recover-estimate-decision-grant');
 status=500;await assert.rejects(edge.post('recover',intent),error=>!(error instanceof EstimateGrantUnavailableError));
 assert.throws(()=>createEstimateDecisionGrantEdge('http://evil.test','x' as never,'public'));
});
test('actor-pinned transport allows the grant history read and activation RPCs',async()=>{
 const names:string[]=[];
 const db=createActorPinnedEstimateDecisionRpc({baseUrl:'https://backend.test',publishableKey:'public',actorId:actor,getSession:async()=>({user:{id:actor},access_token:'jwt'}),fetcher:async url=>{names.push(String(url));return new Response('null',{headers:{'Content-Type':'application/json'}});}});
 for(const name of ['read_native_estimate_decision_grants','record_native_estimate_decision_grant'])assert.deepEqual(await db.rpc(name,{}),{data:null,error:null});
 assert.deepEqual(names,['https://backend.test/rest/v1/rpc/read_native_estimate_decision_grants','https://backend.test/rest/v1/rpc/record_native_estimate_decision_grant']);
});
