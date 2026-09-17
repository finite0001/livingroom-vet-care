import type { PrescriptionRpc } from '../prescriptions/prescription-api.ts';
export interface EstimateDecisionStaffSession {user:{id:string};access_token:string}
export interface EstimateDecisionStaffTransportOptions {
  baseUrl:string;
  publishableKey:string;
  actorId:string;
  getSession:()=>Promise<EstimateDecisionStaffSession|null>;
  fetcher?:typeof fetch;
}
const procedures=new Set(['read_native_estimate_decision_state','read_native_estimate_decisions','preview_native_estimate_decision_grant','record_native_estimate_witnessed_decision','recover_native_estimate_witnessed_decision','close_native_estimate_witnessed_decision']);
const unavailable=()=>new Error('Staff decision access could not be verified. Return to the original account to recover its saved request.');
/** Capture one verified actor JWT before dispatch; never delegate writes to mutable global auth. */
export function createActorPinnedEstimateDecisionRpc(options:EstimateDecisionStaffTransportOptions):PrescriptionRpc {
  const base=new URL(options.baseUrl);
  if(base.origin!==options.baseUrl||(base.protocol!=='https:'&&!(base.protocol==='http:'&&['localhost','127.0.0.1'].includes(base.hostname)))||!options.publishableKey||!/^[a-f0-9-]{36}$/.test(options.actorId))throw unavailable();
  return {async rpc(name,args){
    const controller=new AbortController(),deadline=setTimeout(()=>controller.abort(),15000);
    try{
      if(!procedures.has(name))throw unavailable();
      const session=await options.getSession();
      if(!session||session.user.id!==options.actorId||typeof session.access_token!=='string'||!session.access_token||controller.signal.aborted)throw unavailable();
      // String value is captured now. A later global-session update cannot replace this header.
      const jwt=session.access_token;
      const encoded=JSON.stringify(args);if(new TextEncoder().encode(encoded).length>65536)throw unavailable();
      const response=await (options.fetcher??fetch)(`${base.origin}/rest/v1/rpc/${name}`,{method:'POST',headers:{apikey:options.publishableKey,Authorization:`Bearer ${jwt}`,'Content-Type':'application/json'},body:encoded,credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',signal:controller.signal});
      if(!response.ok||response.redirected||response.headers.get('content-type')?.split(';')[0].trim()!=='application/json')throw unavailable();
      const reader=response.body?.getReader();if(!reader)throw unavailable();
      const chunks:Uint8Array[]=[];let size=0;
      try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2*1024*1024)throw unavailable();chunks.push(value);}}
      catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
      if(controller.signal.aborted)throw unavailable();
      const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
      return {data:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)),error:null};
    }catch{return {data:null,error:unavailable()};}finally{clearTimeout(deadline);}
  }};
}
