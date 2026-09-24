/** Real signed SMS HTTP/Auth/PostgREST workflow; provider GET transport is synthetic. */
import {execFileSync} from "node:child_process";
import {readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {randomUUID} from "node:crypto";
import assert from "node:assert/strict";
import {createServer} from "node:http";
import twilio from "twilio";
import {createClient} from "@supabase/supabase-js";
import {receiveTwilio} from "../../supabase/functions/_shared/inbound/handlers.ts";
import {WebhookError} from "../../supabase/functions/_shared/inbound/verification.ts";
import {processOneInbound} from "../../supabase/functions/_shared/inbound/process.ts";
let project = process.env.PAYMENT_TEST_PROJECT || "/tmp/livingroom-vet-foundation";
let temporaryProject = "";
// The existing containers may outlive their /tmp configuration. This config is
// used for status only; this runner never starts, resets, or stops Supabase.
if (!process.env.PAYMENT_TEST_PROJECT && !existsSync(`${project}/supabase/config.toml`)) {
  temporaryProject = mkdtempSync(join(tmpdir(), "lrv-payment-local-"));
  project = temporaryProject;
  mkdirSync(join(project, "supabase"));
  writeFileSync(join(project, "supabase/config.toml"), 'project_id = "livingroom-vet-foundation"\n[api]\nport = 56321\n[db]\nport = 56322\nshadow_port = 56320\n');
  process.once("exit", () => rmSync(temporaryProject, {recursive: true, force: true}));
}
const projectId = readFileSync(`${project}/supabase/config.toml`, "utf8").match(/^project_id\s*=\s*"([a-zA-Z0-9_-]+)"/m)?.[1];
assert.ok(projectId, "Explicit local project required");
const local = JSON.parse(execFileSync("supabase", ["status", "--workdir", project, "--output", "json"], {encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]}));
assert.match(local.API_URL, /^http:\/\/127\.0\.0\.1:\d+$/);
const sql = (query: string) => execFileSync("docker", ["exec", "-i", `supabase_db_${projectId}`, "psql", "-U", "postgres", "-d", "postgres", "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"], {input: query, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"]}).trim();
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;

const ids:string[]=[];let actor="",client="";
let assertions=0;
const failures:unknown[]=[];
const check=(value:unknown,message:string)=>{assert.ok(value,message);assertions++;};
const serviceHeaders={apikey:local.ANON_KEY,Authorization:`Bearer ${local.SERVICE_ROLE_KEY}`,"Content-Type":"application/json"};
let staffHeaders:Record<string,string>={};
async function api(path:string,args:unknown,headers=serviceHeaders){
 const response=await fetch(local.API_URL+path,{method:"POST",headers,body:JSON.stringify(args)});
 if(!response.ok)throw new Error(`Local fixture ${path} failed: HTTP ${response.status}`);
 const text=await response.text();return text?JSON.parse(text):null;
}
const rpc=(name:string,args:Record<string,unknown>,staff=false)=>api("/rest/v1/rpc/"+name,args,staff?staffHeaders:serviceHeaders);

const service=createClient(local.API_URL,local.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const account=`AC${randomUUID().replaceAll("-","")}`,token=randomUUID();
const canonical="https://hooks.example.test/twilio";
const phone=`+1999${String(BigInt(`0x${randomUUID().replaceAll("-","").slice(0,10)}`)).padStart(12,"0").slice(-10)}`;
const practicePhone="+15005550006";
const resources:string[]=[];
const server=createServer(async(req,res)=>{
 try{
  const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));
  const headers=new Headers();for(const [name,value] of Object.entries(req.headers))if(value)headers.set(name,Array.isArray(value)?value.join(","):value);
  await receiveTwilio(new Request(`http://127.0.0.1${req.url}`,{method:req.method,headers,body:Buffer.concat(chunks)}),service,{TWILIO_WEBHOOK_URL:canonical,TWILIO_ACCOUNT_SID:account,TWILIO_FROM_NUMBER:practicePhone},(signature,url,params)=>twilio.validateRequest(token,signature,url,params));
  res.writeHead(204).end();
 }catch(error){res.writeHead(error instanceof WebhookError?error.status:503).end();}
});
let listening=false;
try{
 check(sql("select count(*) from public.communication_provider_events where state in ('pending','claimed');")==="0","No unrelated pending inbound work before fixture");
 check(sql(`select count(*) from public.clients where primary_phone=${quote(phone)};`)==="0","Synthetic phone has no existing household");ids.push(phone);
 const email=`sms-staff-${randomUUID()}@example.test`,password=`Synthetic-${randomUUID()}-Aa1!`;
 actor=(await api("/auth/v1/admin/users",{email,password,email_confirm:true})).id;ids.push(actor);
 // A1 (#164): handle_new_user no longer activates a new auth user, so a fixture
 // that needs an active synthetic staff member must activate it explicitly.
 sql(`insert into public.user_roles(user_id,role) values(${quote(actor)},'STAFF') on conflict do nothing; update public.profiles set is_active=true where id=${quote(actor)};`);
 const auth=await api("/auth/v1/token?grant_type=password",{email,password},{apikey:local.ANON_KEY,"Content-Type":"application/json"});
 staffHeaders={apikey:local.ANON_KEY,Authorization:`Bearer ${auth.access_token}`,"Content-Type":"application/json"};
 client=(await rpc("save_client",{p_actor_id:actor,p_client_id:null,p_expected_version:null,p_first_name:"Synthetic",p_last_name:"SMS",p_primary_phone:phone,p_primary_email:null,p_preferred_channel:"SMS",p_mailing_address:null,p_housecall_address:null},true)).id;ids.push(client);
 const suppressed=()=>sql(`select public.communication_is_suppressed('SMS',${quote(phone)},${quote(client)});`)==="t";
 const values=(body:string)=>{const sid=`SM${randomUUID().replaceAll("-","")}`;resources.push(sid);ids.push(sid);return {AccountSid:account,MessageSid:sid,MessageStatus:"received",From:phone,To:practicePhone,Body:body,OptOutType:body};};
 await new Promise<void>((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",resolve);});listening=true;
 const address=server.address();assert.ok(address&&typeof address!=="string");const endpoint=`http://127.0.0.1:${address.port}`;
 const post=(params:Record<string,string>,bad=false,path="/twilio")=>fetch(endpoint+path,{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded","x-twilio-signature":bad?"invalid":twilio.getExpectedTwilioSignature(token,canonical,params)},body:new URLSearchParams(params).toString()});
 const stop=values("STOP");
 check((await post(stop,true)).status===401,"Forged STOP signature denied");
 check((await post(stop,false,"/wrong-path")).status===401,"Signature cannot be replayed at a different webhook path");
 check(sql(`select count(*) from public.communication_provider_events where resource_id=${quote(stop.MessageSid)};`)==="0","Invalid proof/path produced no receipt");
 check((await post(stop)).status===204,"Signed STOP durably accepted");
 check(suppressed(),"Pending signed STOP immediately suppresses outbound eligibility before body fetch");
 check((await post(stop)).status===204,"Duplicate signed STOP reuses receipt");
 check(sql(`select count(*) from public.communication_provider_events where resource_id=${quote(stop.MessageSid)};`)==="1","One durable STOP receipt after replay");
 const env={TWILIO_ACCOUNT_SID:account,TWILIO_AUTH_TOKEN:token};
 check((await processOneInbound(service,env,async()=>{throw new Error("Synthetic provider unavailable");})).retry_pending===true,"Failed provider GET preserves retryable work");
 check(suppressed(),"STOP suppression survives failed provider retrieval");
 sql(`update public.communication_provider_events set available_at=now() where resource_id=${quote(stop.MessageSid)};`);
 const stopTime=new Date(Date.now()-1000).toISOString();
 const process=(params:Record<string,string>,when:string)=>processOneInbound(service,env,async(url,options)=>{
  check(String(url)===`https://api.twilio.com/2010-04-01/Accounts/${account}/Messages/${params.MessageSid}.json`&&options?.redirect==="error","Exact provider/account resource GET constructed with redirects denied");
  return Response.json({sid:params.MessageSid,account_sid:account,direction:"inbound",from:phone,to:practicePhone,body:params.Body,date_created:when,num_media:"0"});
 });
 check((await process(stop,stopTime)).processed===true,"Verified STOP body processed into actual inbox");
 check(suppressed(),"Processed STOP remains suppressed");
 check(sql(`select opted_in from public.communication_phone_preferences where phone=${quote(phone)};`)==="f","Provider-timestamped opt-out persisted");
 const oldStart=values("START");await post(oldStart);
 await process(oldStart,new Date(Date.parse(stopTime)-60000).toISOString());
 check(suppressed(),"Older START arriving later cannot reverse newer STOP");
 check(sql(`select opted_in from public.communication_phone_preferences where phone=${quote(phone)};`)==="f","Older START preserves opt-out preference");
 const newStart=values("START");await post(newStart);
 await process(newStart,new Date().toISOString());
 check(!suppressed(),"Newer verified START removes only provider opt-out suppression");
 check(sql(`select opted_in from public.communication_phone_preferences where phone=${quote(phone)};`)==="t","Newer START persists affirmative preference");
 check(sql(`select bool_and(opted_in) from public.sms_consent where client_id=${quote(client)} and phone_number=${quote(phone)};`)==="t","Unique household consent reflects verified newer START");
 const inbox=await rpc("list_communication_inbox",{},true);
 check(inbox.some((row:{client_id:string;unread_count:number})=>row.client_id===client&&row.unread_count===3),"Authenticated inbox contains three unique consent messages");
 await post(stop);await post(oldStart);await post(newStart);
 check((await processOneInbound(service,env,async()=>{throw new Error("Processed replay must not fetch");})).processed===false,"Replayed processed messages trigger no new retrieval");
 check(!suppressed(),"Old STOP receipt replay cannot reverse the later verified START");
 check(sql(`select count(*) from public.communication_inbound where resource_id=any(array[${resources.map(quote).join(',')}]);`)==="3","No duplicate inbound originals after all receipt replays");
}catch(error){failures.push(error);}finally{
 if(listening)await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
 try{
  if(resources.length)ids.push(...JSON.parse(sql(`select coalesce(json_agg(id),'[]'::json) from public.communication_provider_events where provider='twilio' and resource_id=any(array[${resources.map(quote).join(',')}]);`)));
  if(client)ids.push(...JSON.parse(sql(`select coalesce(json_agg(id),'[]'::json) from (select id from public.conversations where client_id=${quote(client)} union select m.id from public.messages m join public.conversations c on c.id=m.conversation_id where c.client_id=${quote(client)}) owned;`)));
  if(ids.length){const patterns=ids.filter(Boolean).map(value=>quote(`%${value}%`)).join(',');sql(`begin;set local session_replication_role=replica;do $cleanup$ declare t record;begin for t in select schemaname,tablename from pg_tables where schemaname='public' loop execute format('delete from %I.%I r where to_jsonb(r)::text like any ($1)',t.schemaname,t.tablename) using array[${patterns}];end loop;end $cleanup$;commit;`);
   sql(`do $verify$ declare t record;n bigint;begin for t in select schemaname,tablename from pg_tables where schemaname='public' loop execute format('select count(*) from %I.%I r where to_jsonb(r)::text like any ($1)',t.schemaname,t.tablename) into n using array[${patterns}];if n<>0 then raise exception 'Synthetic SMS cleanup incomplete';end if;end loop;end $verify$;`);check(true,"Synthetic SMS records and committed children cleaned");
  }
  if(actor)check((await fetch(local.API_URL+"/auth/v1/admin/users/"+actor,{method:"DELETE",headers:serviceHeaders})).ok,"Synthetic Auth identity cleaned");
 }catch(error){failures.push(error);}
}
if(failures.length)throw new AggregateError(failures,"Local SMS workflow or cleanup failed");
console.log(`Local signed SMS HTTP/Auth/PostgREST workflow: ${assertions} checks passed. Provider GETs synthetic; no external messages.`);
