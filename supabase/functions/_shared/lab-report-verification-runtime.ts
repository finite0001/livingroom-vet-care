import {createClient} from "https://esm.sh/@supabase/supabase-js@2.110.3";
import {createLabReportVerificationHandler} from "./lab-report-verification.ts";
export function labReportVerificationRuntime(){
 const client=(token?:string)=>createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get(token?"SUPABASE_ANON_KEY":"SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false,autoRefreshToken:false},...(token?{global:{headers:{Authorization:`Bearer ${token}`}}}:{})});
 let origin:string|null=null;try{const configured=Deno.env.get("APP_URL"),url=new URL(configured??"");if(url.origin===configured&&(url.protocol==="https:"||(url.protocol==="http:"&&["localhost","127.0.0.1"].includes(url.hostname))))origin=url.origin;}catch{/* Missing origin fails closed. */}
 return createLabReportVerificationHandler({enabled:Deno.env.get("LAB_REPORT_VERIFICATION_ENABLED")==="true",origin,
 authenticate:async token=>{const {data,error}=await client().auth.getUser(token);if(error||!data.user)return null;return {actorId:data.user.id,db:client(token)};},
 service:{rpc:async(name,args)=>{const {data,error}=await client().rpc(name,args);if(error)throw error;return {data,error:null};}},
 download:async document=>{
  const base=new URL(Deno.env.get("SUPABASE_URL")??"");
  if(base.username||base.password||base.search||base.hash||base.pathname!=="/"||(base.protocol!=="https:"&&!(base.protocol==="http:"&&["127.0.0.1","localhost"].includes(base.hostname))))throw new Error("Private storage unavailable");
  const target=new URL(`/storage/v1/object/authenticated/patient-documents/${document.file_path.split("/").map(encodeURIComponent).join("/")}`,base);
  const key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return fetch(target,{headers:{apikey:key,Authorization:`Bearer ${key}`,Accept:document.mime_type,"Accept-Encoding":"identity"},redirect:"error",signal:AbortSignal.timeout(20000)});
 },
 });
}
