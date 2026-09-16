import { z } from 'zod';
import { estimateDecisionBindingSchema, estimateDecisionHeadSchema, sameEstimateDecisionEvidence as equal } from './estimate-decision-contract.ts';
import { materializeEstimateDecision, validEstimateDecisionCapability, type EstimateDecisionConfig } from './estimate-decision-capability.ts';
import { validateEstimatePublicReview } from './estimate-decision-http.ts';
import type { EstimatePublicationDependencies } from './estimate-publication-http.ts';

const uuid=z.string().uuid().refine(v=>v===v.toLowerCase());
const hash=z.string().regex(/^[a-f0-9]{64}$/);
const instant=z.string().datetime().refine(v=>Number.isFinite(Date.parse(v))&&!/\.\d{7}/.test(v));
const text=(max:number)=>z.string().refine(v=>v===v.trim()&&Array.from(v).length>=1&&Array.from(v).length<=max&&!/[\uD800-\uDFFF]/u.test(v)&&!Array.from(v).some(c=>{const n=c.charCodeAt(0);return n===127||(n<32&&n!==9&&n!==10);}));
export const estimateGrantIssueRequestSchema=z.object({binding:estimateDecisionBindingSchema,expected_publication_head:estimateDecisionHeadSchema,expires_at:instant,recipient_label:text(200),purpose:text(500),attest_recipient_authority:z.literal(true)}).strict();
const activation=z.object({id:uuid,actor_id:uuid,created_at:instant}).strict();
const fields={version:z.literal(1),id:uuid,actor_id:uuid,request:estimateGrantIssueRequestSchema,request_hash:hash,created_at:instant,
  capability:z.object({origin:z.string().max(2048),key_version:z.string().regex(/^[A-Za-z0-9_-]{1,40}$/),context_hash:hash}).strict().nullable(),
  capture:z.object({captured_at:instant}).strict().nullable(),head:estimateDecisionHeadSchema,state:z.enum(['preparing','captured','active','revoked']),activation:activation.nullable(),revocation:activation.extend({reason:text(2000)}).strict().nullable()};
function stateValid(g:{state:string;capability:unknown;capture:unknown;activation:unknown;revocation:unknown;head:{version:number}}):boolean {
  return g.head.version>0 && (!g.activation||!!g.capture) && (g.capability===null)===(g.capture===null) &&
    (g.state==='preparing'?g.capture===null&&!g.activation&&!g.revocation:
      g.state==='captured'?!!g.capture&&!g.activation&&!g.revocation:
      g.state==='active'?!!g.capture&&!!g.activation&&!g.revocation:!!g.revocation);
}
export const estimateGrantViewSchema=z.object(fields).strict().refine(stateValid);
const privateGrant=z.object({...fields,capture:z.object({token_hash:hash,captured_at:instant}).strict().nullable()}).strict().refine(stateValid);
export const estimateGrantIssueReceiptSchema=z.object({version:z.literal(1),id:uuid,actor_id:uuid,mutation:z.object({kind:z.literal('issue'),request:estimateGrantIssueRequestSchema}).strict(),request_hash:hash,result:estimateGrantViewSchema,created_at:instant}).strict().refine(v=>v.id===v.result.id&&v.actor_id===v.result.actor_id&&v.request_hash===v.result.request_hash&&v.created_at===v.result.created_at&&equal(v.mutation.request,v.result.request)&&v.result.state==='preparing'&&v.result.head.version===1&&v.result.head.event_id===v.id);
// A null recovery receipt is point-in-time absence, never durable closure.
const requestSchema=z.object({id:uuid,request:estimateGrantIssueRequestSchema}).strict();
const contextSchema=z.object({grant:privateGrant,capability_context:z.string().max(8192),context_hash:hash,captured:z.boolean()}).strict().refine(v=>v.captured===(v.grant.capture!==null)&&(!v.grant.capability||v.grant.capability.context_hash===v.context_hash));
export const estimateGrantPreparationResultSchema=z.object({version:z.literal(1),receipt:estimateGrantIssueReceiptSchema.nullable(),grant:estimateGrantViewSchema.nullable(),link:z.object({url:z.string().max(4096),expires_at:instant}).strict().nullable()}).strict().refine(v=>v.receipt===null?v.grant===null&&v.link===null:!!v.grant&&v.grant.id===v.receipt.id&&v.grant.actor_id===v.receipt.actor_id&&equal(v.grant.request,v.receipt.mutation.request)&&(!v.link||(v.grant.state==='active'&&v.link.expires_at===v.grant.request.expires_at))).refine(v=>{
  if(!v.link||!v.grant?.capability)return v.link===null;
  try{const url=new URL(v.link.url);return url.origin===v.grant.capability.origin&&url.pathname===`/estimate/${v.grant.id}`&&!url.search&&!url.username&&!url.password&&validEstimateDecisionCapability(url.hash.slice(1));}catch{return false;}
});
export interface EstimateDecisionGrantDependencies extends EstimatePublicationDependencies { config:EstimateDecisionConfig }
async function body(req:Request){
  if(req.headers.get('content-type')?.split(';')[0].trim()!=='application/json')throw new Error('Invalid body');
  const reader=req.body?.getReader();if(!reader)throw new Error('Missing body');
  let size=0;const chunks:Uint8Array[]=[];
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>16384)throw new Error('Body too large');chunks.push(value);}}
  catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const part of chunks){bytes.set(part,offset);offset+=part.length;}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
}
export function createEstimateDecisionGrantHandler(deps:EstimateDecisionGrantDependencies,mode:'prepare'|'recover'){
  const headers={'Content-Type':'application/json','Cache-Control':'no-store, private',Pragma:'no-cache','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Access-Control-Allow-Origin':deps.config.origin,'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS',Vary:'Origin'};
  const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers});
  const unavailable=(status=404)=>json({error:'Estimate grant unavailable'},status);
  return async(req:Request):Promise<Response>=>{
    if(req.headers.has('origin')&&req.headers.get('origin')!==deps.config.origin)return unavailable();
    if(req.method==='OPTIONS')return new Response(null,{headers});
    if(req.method!=='POST')return unavailable(405);
    const authHeader=req.headers.get('authorization');if(!authHeader?.startsWith('Bearer ')||!authHeader.slice(7).trim())return unavailable(401);
    try{
      const auth=await deps.authenticate(authHeader.slice(7));if(!auth||!uuid.safeParse(auth.actorId).success)return unavailable(401);
      const request=requestSchema.parse(await body(req));
      if(mode==='prepare'&&!deps.config.issuanceEnabled)return unavailable();
      const call=async(db:EstimatePublicationDependencies['service'],name:string,args:Record<string,unknown>)=>{const {data,error}=await db.rpc(name,args);if(error)throw error;return data;};
      const original=await call(auth.db,mode==='prepare'?'record_native_estimate_decision_grant':'recover_native_estimate_decision_grant',{p_id:request.id,...(mode==='prepare'?{p_mutation:{kind:'issue',request:request.request}}:{})});
      if(original===null&&mode==='recover')return json({version:1,receipt:null,grant:null,link:null});
      const receipt=estimateGrantIssueReceiptSchema.parse(original);
      if(receipt.id!==request.id||receipt.actor_id!==auth.actorId||!equal(receipt.mutation.request,request.request))throw new Error('Issue receipt differs');
      const contextArgs={p_grant_id:request.id,p_actor_id:auth.actorId,p_origin:deps.config.origin,p_key_version:deps.config.activeKeyVersion};
      const context=()=>call(deps.service,'native_estimate_decision_grant_capture_context',contextArgs);
      const validate=(value:unknown)=>{const c=contextSchema.parse(value);if(c.grant.id!==request.id||c.grant.actor_id!==auth.actorId||!equal(c.grant.request,request.request)||c.grant.request_hash!==receipt.request_hash||c.grant.created_at!==receipt.created_at)throw new Error('Grant scope differs');return c;};
      let current=validate(await context());
      const flat=(c:typeof current)=>({id:c.grant.id,actor_id:c.grant.actor_id,binding:c.grant.request.binding,expires_at:c.grant.request.expires_at,origin:c.grant.capability?.origin??deps.config.origin,key_version:c.grant.capability?.key_version??deps.config.activeKeyVersion,capability_context:c.capability_context,context_hash:c.context_hash});
      const view=(c:typeof current)=>estimateGrantViewSchema.parse({...c.grant,capture:c.grant.capture?{captured_at:c.grant.capture.captured_at}:null});
      if(!current.captured&&deps.config.issuanceEnabled){
        const frozen=flat(current),material=await materializeEstimateDecision(frozen,deps.config);
        const captured=estimateGrantViewSchema.parse(await call(deps.service,'capture_native_estimate_decision_grant',{p_grant_id:request.id,p_actor_id:auth.actorId,p_origin:frozen.origin,p_key_version:frozen.key_version,p_context_hash:frozen.context_hash,p_token_hash:material.token_hash}));
        if(captured.id!==request.id||captured.actor_id!==auth.actorId||!equal(captured.request,request.request)||captured.request_hash!==receipt.request_hash||!equal(captured.capability,{origin:frozen.origin,key_version:frozen.key_version,context_hash:frozen.context_hash})||!captured.capture)throw new Error('Capture differs');
        current=validate(await context());
        if(!current.captured||current.grant.capture?.token_hash!==material.token_hash||current.context_hash!==frozen.context_hash)throw new Error('Capture recovery differs');
      }
      let link:null|{url:string;expires_at:string}=null;
      if(deps.config.issuanceEnabled&&current.grant.state==='active'&&Date.parse(current.grant.request.expires_at)>Date.now()){
        const frozen=flat(current),material=await materializeEstimateDecision(frozen,deps.config);
        if(current.grant.capture?.token_hash!==material.token_hash)throw new Error('Token digest differs');
        await validateEstimatePublicReview(await call(deps.service,'retrieve_native_estimate_decision',{p_grant_id:request.id,p_token_hash:material.token_hash,p_origin:frozen.origin,p_key_version:frozen.key_version}),frozen);
        link={url:material.url,expires_at:frozen.expires_at};
      }
      return json(estimateGrantPreparationResultSchema.parse({version:1,receipt,grant:view(current),link}));
    }catch{return unavailable();}
  };
}
