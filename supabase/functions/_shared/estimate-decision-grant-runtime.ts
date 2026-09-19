import { estimateDecisionConfig } from './estimate-decision-capability.ts';
import { createEstimateDecisionGrantHandler } from './estimate-decision-grant-http.ts';
import { estimatePublicationRuntime } from './estimate-publication-runtime.ts';

export function estimateDecisionGrantRuntime(mode:'prepare'|'recover'):(request:Request)=>Promise<Response>{
  try{
    const config=estimateDecisionConfig({origin:Deno.env.get('ESTIMATE_DECISION_ORIGIN'),activeKeyVersion:Deno.env.get('ESTIMATE_DECISION_ACTIVE_KEY_VERSION'),keys:Deno.env.get('ESTIMATE_DECISION_KEYS'),publicEnabled:Deno.env.get('ESTIMATE_DECISION_PUBLIC_ENABLED'),issuanceEnabled:Deno.env.get('ESTIMATE_DECISION_ISSUANCE_ENABLED')});
    // getUser verifies the supplied JWT with actual Auth; actor never comes from JSON.
    return createEstimateDecisionGrantHandler({...estimatePublicationRuntime(),config},mode);
  }catch{
    return async()=>new Response(JSON.stringify({error:'Estimate grant unavailable'}),{status:404,headers:{'Content-Type':'application/json','Cache-Control':'no-store, private','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}});
  }
}
