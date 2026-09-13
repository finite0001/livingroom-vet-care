/** Actual local HTTP/Auth/SQL roundtrip with synthetic provider responses only. */
import {execFileSync, spawn} from "node:child_process";
import {readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {randomUUID} from "node:crypto";
import assert from "node:assert/strict";
import {materializePaymentAccess,paymentAccessConfig,paymentGrantFromContext} from "../../supabase/functions/_shared/payment-access-capability.ts";
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
const origin="https://thelivingroom.vet",root="http://127.0.0.1:56501";
const key=btoa(randomUUID().replaceAll("-",""));
const config=paymentAccessConfig({origin,activeKeyVersion:"local-v1",keys:JSON.stringify({"local-v1":key}),collectionEnabled:"true",statusEnabled:"true"});
const ids:string[]=[];let actor="",client="",product="",account="",createdProfile=false;
let server:ReturnType<typeof spawn>|null=null,assertions=0;
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
try{
 const profiles=JSON.parse(sql("select coalesce(jsonb_agg(to_jsonb(p)),'[]') from public.payment_provider_profiles p;"));
 check(!profiles.length || (profiles.length===1 && profiles[0].return_origin===origin && profiles[0].livemode===false),"Only compatible local test provider profile reused");
 if(profiles.length)account=profiles[0].account_id;else{account="acct_Local"+randomUUID().replaceAll("-","");await rpc("configure_payment_provider",{p_account_id:account,p_livemode:false,p_return_origin:origin});createdProfile=true;}
 const email=`payment-roundtrip-${randomUUID()}@example.test`,password=`Synthetic-${randomUUID()}-Aa1!`;
 const user=await api("/auth/v1/admin/users",{email,password,email_confirm:true});actor=user.id;ids.push(actor);
 const auth=await api("/auth/v1/token?grant_type=password",{email,password},{apikey:local.ANON_KEY,"Content-Type":"application/json"});
 staffHeaders={apikey:local.ANON_KEY,Authorization:`Bearer ${auth.access_token}`,"Content-Type":"application/json"};
 const c=await rpc("save_client",{p_actor_id:actor,p_client_id:null,p_expected_version:null,p_first_name:"Synthetic",p_last_name:"Payment roundtrip",p_primary_phone:null,p_primary_email:"delivery@example.test",p_preferred_channel:"EMAIL",p_mailing_address:null,p_housecall_address:null},true);client=c.id;ids.push(client);
 const p=await rpc("save_catalog_product",{p_id:null,p_expected_version:null,p_name:"Synthetic visit",p_kind:"service",p_manufacturer:"",p_unit:"visit",p_unit_price_cents:10000,p_active:true},true);product=p.id;ids.push(product);
 server=spawn("deno",["run","--cached-only","--allow-env","--allow-net=127.0.0.1","tests/payment-access/delivery-local-server.ts"],{env:{...process.env,SUPABASE_URL:local.API_URL,SUPABASE_SERVICE_ROLE_KEY:local.SERVICE_ROLE_KEY,SUPABASE_ANON_KEY:local.ANON_KEY,APP_URL:origin,PAYMENT_DELIVERY_STAFF_ENABLED:"true",PAYMENT_ACCESS_ORIGIN:origin,PAYMENT_ACCESS_ACTIVE_KEY_VERSION:"local-v1",PAYMENT_ACCESS_KEYS:JSON.stringify({"local-v1":key}),PAYMENT_COLLECTION_ENABLED:"true",PAYMENT_STATUS_ENABLED:"true",RESEND_FROM:"billing@thelivingroom.vet",RESEND_REPLY_TO:"care@thelivingroom.vet",RESEND_API_KEY:"",TWILIO_AUTH_TOKEN:""},stdio:"ignore"});
 let ready=false;for(let i=0;i<80;i++){if(server.exitCode!==null)throw new Error("Local Deno handler failed to boot");try{ready=await(await fetch(root+"/health")).text()==="ready";if(ready)break;}catch{/* Boot pending. */}await new Promise(resolve=>setTimeout(resolve,100));}
 check(ready,"Actual localhost Deno HTTP server booted with external network denied");
 const post=(args:unknown,authenticated=true)=>fetch(root+"/prepare",{method:"POST",headers:{Origin:origin,...(authenticated?staffHeaders:{"Content-Type":"application/json"})},body:JSON.stringify(args)});
 const invoice=randomUUID(),grantId=randomUUID(),delivery=randomUUID(),conversation=randomUUID();ids.push(invoice,grantId,delivery,conversation);
 await rpc("create_billing_invoice",{p_id:invoice,p_client_id:client},true);
 await rpc("add_invoice_service",{p_id:randomUUID(),p_invoice_id:invoice,p_pet_id:null,p_product_id:product,p_quantity:1},true);
 await rpc("issue_billing_invoice",{p_id:invoice,p_expected_version:Number(sql(`select version from public.billing_invoices where id=${quote(invoice)};`))},true);
 const state=await rpc("read_invoice_payment_state",{p_invoice_id:invoice,p_client_id:client},true);
 await rpc("prepare_payment_collection",{p_request_id:grantId,p_invoice_id:invoice,p_client_id:client,p_source_hash:state.source_hash,p_amount_cents:10000,p_expires_at:new Date(Date.now()+6*86400000).toISOString()},true);
 const context=await rpc("payment_collection_capture_context",{p_request_id:grantId,p_actor_id:actor,p_origin:origin,p_key_version:"local-v1"});
 const access=await materializePaymentAccess(paymentGrantFromContext(context),config);
 const captured=await rpc("capture_payment_collection",{p_request_id:grantId,p_actor_id:actor,p_origin:origin,p_key_version:"local-v1",p_collection_token_hash:access.collection_token_hash,p_status_token_hash:access.status_token_hash});
 await rpc("attest_payment_collection",{p_request_id:grantId,p_reviewed_context_hash:captured.capture.context_hash,p_attest:true},true);
 sql(`insert into public.conversations(id,client_id) values(${quote(conversation)},${quote(client)});`);
 const args={action:"prepare",p_request_id:delivery,p_grant_id:grantId,p_conversation_id:conversation,p_channel:"EMAIL",p_recipient:"delivery@example.test",p_subject:"Your invoice",p_body_template:"Review and pay: {{payment_link}}",p_invoice_email_request_id:null,p_invoice_payload_hash:null};
 check((await post(args,false)).status===401,"Actual delivery HTTP denies unauthenticated caller");
 const preparedResponse=await post(args);check(preparedResponse.status===200,"Production runtime captures reviewed delivery via Auth/PostgREST");
 const prepared=await preparedResponse.json();check(prepared.delivery.request.id===delivery && !!prepared.delivery.capture,"Real capture retains exact request identity");
 check(!JSON.stringify(prepared).includes(access.collection_token),"Preparation returns no usable capability");
 check((await post({...args,p_subject:"Changed"})).status===409,"SQL rejects changed intent on existing delivery");
 const reviewResponse=await post({action:"review",p_request_id:delivery});check(reviewResponse.status===200 && reviewResponse.headers.get("Cache-Control")==="no-store","Transient review is explicitly uncached");
 const review=await reviewResponse.json();check(review.preview.message.endsWith(access.collection_url) && review.preview.attachment===null,"Review reproduces exact captured collection URL");
 check(sql(`select count(*) from public.payment_delivery_outbox_links where request_id=${quote(delivery)};`)==="0","Preparation and review never enqueue or send");
 check((await post(args)).status===200,"Exact captured preparation retry succeeds");
 const persisted=sql(`select to_jsonb(r) from public.payment_delivery_requests r where id=${quote(delivery)};select to_jsonb(c) from public.payment_delivery_captures c where request_id=${quote(delivery)};`);
 check(!persisted.includes(access.collection_token) && !persisted.includes(access.status_token),"Only templates and hashes enter durable delivery rows");
 await rpc("revoke_payment_collection",{p_request_id:grantId,p_reason:"Synthetic local revocation"},true);
 check((await post({action:"review",p_request_id:delivery})).status===404,"Revoked grant blocks fresh capability review");
 const recovered=await(await post({action:"recover",p_request_id:delivery})).json();check(recovered.delivery.capture.message_hash===prepared.delivery.capture.message_hash,"Revoked delivery still recovers immutable digest metadata");
}catch(error){failures.push(error);}finally{
 if(server){server.kill("SIGTERM");await new Promise<void>(resolve=>{if(server!.exitCode!==null || server!.signalCode!==null)resolve();else server!.once("exit",()=>resolve());});}
 try{
  if(ids.length || createdProfile){const patterns=ids.length?ids.map(id=>quote(`%${id}%`)).join(","):quote("%"+randomUUID()+"%");sql(`begin;set local session_replication_role=replica;do $cleanup$ declare t record;begin for t in select schemaname,tablename from pg_tables where schemaname='public' loop execute format('delete from %I.%I r where to_jsonb(r)::text like any ($1)',t.schemaname,t.tablename) using array[${patterns}];end loop;end $cleanup$;${createdProfile?`delete from public.payment_provider_profiles where account_id=${quote(account)};`:""}commit;`);}
  if(actor){const removed=await fetch(local.API_URL+"/auth/v1/admin/users/"+actor,{method:"DELETE",headers:serviceHeaders});check(removed.ok,"Synthetic Auth user cleanup succeeded");check(sql(`select count(*) from public.payment_collection_grants where actor_id=${quote(actor)};`)==="0","Synthetic grant cleanup verified");}
 }catch(error){failures.push(error);}
}
if(failures.length)throw new AggregateError(failures,"Local payment roundtrip or cleanup failed");
console.log(`Local delivery HTTP/Auth/SQL roundtrip: ${assertions} checks passed. No provider requests or messages sent.`);
