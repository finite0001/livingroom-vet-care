/** Real localhost webhook/Auth/PostgREST workflow; provider GET transport is synthetic. */
import {execFileSync} from "node:child_process";
import {readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {randomUUID} from "node:crypto";
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {Webhook} from "svix";
import {createClient} from "@supabase/supabase-js";
import {receiveResend} from "../../supabase/functions/_shared/inbound/handlers.ts";
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
const verifier=new Webhook(`whsec_${Buffer.from(randomUUID()).toString("base64")}`);
const receiving=`care-${randomUUID()}@example.test`;
let lastWebhookError="";
const server=createServer(async(req,res)=>{
 try{
  const chunks:Buffer[]=[];
  for await(const chunk of req)chunks.push(Buffer.from(chunk));
  const headers=new Headers();
  for(const [name,value] of Object.entries(req.headers))if(value)headers.set(name,Array.isArray(value)?value.join(","):value);
  await receiveResend(new Request("http://127.0.0.1/webhook",{method:req.method,headers,body:Buffer.concat(chunks)}),service,{RESEND_INBOUND_ADDRESSES:receiving},(body,proof)=>verifier.verify(body,proof));
  res.writeHead(204).end();
 }catch(error){lastWebhookError=error instanceof WebhookError?error.message:error instanceof Error?`${error.name}: ${error.message}`:"Unexpected handler failure";res.writeHead(error instanceof WebhookError?error.status:503).end();}
});
let listening=false;
try{
 check(sql("select count(*) from public.communication_provider_events where state in ('pending','claimed');")==="0","No unrelated inbound queue work exists before fixture");
 const email=`inbound-staff-${randomUUID()}@example.test`,password=`Synthetic-${randomUUID()}-Aa1!`;
 actor=(await api("/auth/v1/admin/users",{email,password,email_confirm:true})).id;ids.push(actor);
 const auth=await api("/auth/v1/token?grant_type=password",{email,password},{apikey:local.ANON_KEY,"Content-Type":"application/json"});
 staffHeaders={apikey:local.ANON_KEY,Authorization:`Bearer ${auth.access_token}`,"Content-Type":"application/json"};
 const sender=`family-${randomUUID()}@example.test`;
 client=(await rpc("save_client",{p_actor_id:actor,p_client_id:null,p_expected_version:null,p_first_name:"Synthetic",p_last_name:"Inbound",p_primary_phone:null,p_primary_email:sender,p_preferred_channel:"EMAIL",p_mailing_address:null,p_housecall_address:null},true)).id;ids.push(client);
 await new Promise<void>((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",resolve);});listening=true;
 const address=server.address();assert.ok(address&&typeof address!=="string");
 const endpoint=`http://127.0.0.1:${address.port}/webhook`;
 const resource=randomUUID(),eventId=`synthetic-${randomUUID()}`;ids.push(resource);
 const created=new Date().toISOString();
 const event={type:"email.received",created_at:created,data:{email_id:resource,from:sender,to:[receiving]}};
 async function post(value:unknown,id=eventId,forged=false){
  const body=JSON.stringify(value),date=new Date();
  return fetch(endpoint,{method:"POST",body,headers:{"content-type":"application/json","svix-id":id,"svix-timestamp":String(Math.floor(date.getTime()/1000)),"svix-signature":forged?"v1,invalid":verifier.sign(id,date,body)}});
 }
 check((await post(event,eventId,true)).status===401,"Forged HTTP signature denied");
 check(sql(`select count(*) from public.communication_provider_events where resource_id=${quote(resource)};`)==="0","Forged event produced no durable receipt");
 const signedResponse=await post(event);
 check(signedResponse.status===204,`Signed HTTP webhook persisted receipt (HTTP ${signedResponse.status}: ${lastWebhookError})`);
 check((await post(event)).status===204,"Duplicate signed webhook recovers original receipt");
 check(sql(`select count(*) from public.communication_provider_events where resource_id=${quote(resource)};`)==="1","Webhook replay produces exactly one receipt");
 check((await post({...event,data:{...event.data,from:"changed@example.test"}})).status===503,"Changed signed metadata cannot reuse original event ID");
 const failed=await processOneInbound(service,{RESEND_API_KEY:"synthetic-never-sent"},async()=>{throw new Error("Synthetic transport failure");});
 check(failed.retry_pending===true,"Provider read failure retains retryable durable work");
 check(sql(`select count(*) from public.communication_inbound where resource_id=${quote(resource)};`)==="0","Failed provider read created no partial inbox original");
 sql(`update public.communication_provider_events set available_at=now() where resource_id=${quote(resource)};`);
 let fetched=0;
 const providerRead:typeof fetch=async(url,options)=>{
  fetched++;check(String(url)===`https://api.resend.com/emails/receiving/${resource}`&&options?.redirect==="error","Processor constructs exact provider resource GET without redirects");
  return Response.json({id:resource,from:sender,to:[receiving],text:"Synthetic reply: please confirm the visit.",html:"<p>Synthetic reply</p>",subject:"Synthetic visit",created_at:created,message_id:`<${resource}@example.test>`,attachments:[{id:"synthetic-attachment",filename:"report.pdf",content_type:"application/pdf",size:20,download_url:"https://never-fetch.example.test/private"}]});
 };
 check((await processOneInbound(service,{RESEND_API_KEY:"synthetic-never-sent"},providerRead)).processed===true,"Actual database processing completes known-household message");
 const inbound=JSON.parse(sql(`select row_to_json(r) from public.communication_inbound r where resource_id=${quote(resource)};`));
 ids.push(inbound.id,inbound.conversation_id,inbound.message_id);
 check(inbound.client_id===client&&Boolean(inbound.message_id),"Known sender links to actual household and conversation message");
 check(inbound.body==="Synthetic reply: please confirm the visit.","Inbox retains fetched plain text");
 check(!JSON.stringify(inbound.attachment_metadata).includes("never-fetch")&&inbound.attachment_metadata.length===1,"Attachment descriptors retain metadata without provider download URL");
 check(fetched===1,"No attachment URL was fetched");
 const inbox=await rpc("list_communication_inbox",{},true);
 check(inbox.some((row:{conversation_id:string;unread_count:number})=>row.conversation_id===inbound.conversation_id&&row.unread_count===1),"Actual authenticated inbox sees one unread reply");
 await rpc("mark_conversation_read",{p_actor_id:actor,p_conversation_id:inbound.conversation_id,p_message_id:inbound.message_id},true);
 const read=await rpc("list_communication_inbox",{},true);
 check(read.some((row:{conversation_id:string;unread_count:number})=>row.conversation_id===inbound.conversation_id&&row.unread_count===0),"Read cursor advances only after explicit staff read");
 await post(event);
 check((await processOneInbound(service,{RESEND_API_KEY:"synthetic-never-sent"},providerRead)).processed===false,"Processed webhook replay cannot create or fetch another message");
 check(sql(`select count(*) from public.messages where conversation_id=${quote(inbound.conversation_id)};`)==="1","One actual conversation message survives replay");
 const unknown=randomUUID();ids.push(unknown);
 const unknownEvent={...event,data:{...event.data,email_id:unknown,from:`unknown-${unknown}@example.test`}};
 check((await post(unknownEvent,`synthetic-${unknown}`)).status===204,"Unknown sender still gets a durable verified receipt");
 await processOneInbound(service,{RESEND_API_KEY:"synthetic-never-sent"},async()=>Response.json({id:unknown,from:unknownEvent.data.from,to:[receiving],text:"Synthetic unmatched reply",created_at:created}));
 const review=JSON.parse(sql(`select row_to_json(r) from public.communication_inbound r where resource_id=${quote(unknown)};`));ids.push(review.id);
 check(review.client_id===null&&review.message_id===null&&Boolean(review.review_reason),"Unknown sender stays in review without fabricated household");
 await rpc("assign_inbound_communication",{p_actor_id:actor,p_id:review.id,p_expected_version:review.version,p_client_id:client,p_conversation_id:inbound.conversation_id,p_reason:"Synthetic staff verified sender identity"},true);
 check(sql(`select count(*) from public.communication_inbound_assignments where inbound_id=${quote(review.id)} and assigned_by=${quote(actor)};`)==="1","Explicit staff assignment records durable identity-review evidence");
 check(sql(`select count(*) from public.messages where conversation_id=${quote(inbound.conversation_id)};`)==="2","Reviewed unmatched reply creates exactly one additional message");
}catch(error){failures.push(error);}finally{
 if(listening)await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
 try{
  // Discover committed children even if an assertion failed before their IDs
  // reached the test's local variables. Never delete a parent and orphan them.
  if(client){
   const children=JSON.parse(sql(`select coalesce(json_agg(id),'[]'::json) from (select id from public.conversations where client_id=${quote(client)} union select m.id from public.messages m join public.conversations c on c.id=m.conversation_id where c.client_id=${quote(client)}) owned;`));
   ids.push(...children);
  }
  if(ids.length){const patterns=ids.filter(Boolean).map(value=>quote(`%${value}%`)).join(',');sql(`begin;set local session_replication_role=replica;do $cleanup$ declare t record;begin for t in select schemaname,tablename from pg_tables where schemaname='public' loop execute format('delete from %I.%I r where to_jsonb(r)::text like any ($1)',t.schemaname,t.tablename) using array[${patterns}];end loop;end $cleanup$;commit;`);
   sql(`do $verify$ declare t record;n bigint;begin for t in select schemaname,tablename from pg_tables where schemaname='public' loop execute format('select count(*) from %I.%I r where to_jsonb(r)::text like any ($1)',t.schemaname,t.tablename) into n using array[${patterns}];if n<>0 then raise exception 'Synthetic fixture cleanup incomplete';end if;end loop;end $verify$;`);
   check(true,"Synthetic application records and committed children cleaned");
  }
  if(actor)check((await fetch(local.API_URL+"/auth/v1/admin/users/"+actor,{method:"DELETE",headers:serviceHeaders})).ok,"Synthetic Auth identity cleaned");
 }catch(error){failures.push(error);}
}
if(failures.length)throw new AggregateError(failures,"Local inbound workflow or cleanup failed");
console.log(`Local inbound HTTP/signature/Auth/PostgREST workflow: ${assertions} checks passed. Provider GETs synthetic; no external messages.`);
