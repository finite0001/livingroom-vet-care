/** Actual local HTTP/Auth/SQL roundtrip with synthetic provider responses only. */
import {execFileSync, spawn} from "node:child_process";
import {readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {randomUUID,createHash} from "node:crypto";
import {dispatchOne,type OutboxEnvironment} from "../../supabase/functions/_shared/outbox-dispatch.ts";
import {buildInvoiceEmailPayload} from "../../supabase/functions/_shared/invoice-email-payload.ts";
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
 check(sql("select count(*) from public.communication_outbox where state in ('pending','claimed');") === "0", "No unrelated queued work before isolated dispatch test");
 const profiles=JSON.parse(sql("select coalesce(jsonb_agg(to_jsonb(p)),'[]') from public.payment_provider_profiles p;"));
 check(!profiles.length || (profiles.length===1 && profiles[0].return_origin===origin && profiles[0].livemode===false),"Only compatible local test provider profile reused");
 if(profiles.length)account=profiles[0].account_id;else{account="acct_Local"+randomUUID().replaceAll("-","");await rpc("configure_payment_provider",{p_account_id:account,p_livemode:false,p_return_origin:origin});createdProfile=true;}
 const email=`payment-roundtrip-${randomUUID()}@example.test`,password=`Synthetic-${randomUUID()}-Aa1!`;
 const user=await api("/auth/v1/admin/users",{email,password,email_confirm:true});actor=user.id;ids.push(actor);
 // A1 (#164): handle_new_user no longer activates a new auth user, so a fixture
 // that needs an active synthetic staff member must activate it explicitly.
 sql(`insert into public.user_roles(user_id,role) values(${quote(user.id)},'STAFF') on conflict do nothing; update public.profiles set is_active=true where id=${quote(user.id)};`);
 const auth=await api("/auth/v1/token?grant_type=password",{email,password},{apikey:local.ANON_KEY,"Content-Type":"application/json"});
 staffHeaders={apikey:local.ANON_KEY,Authorization:`Bearer ${auth.access_token}`,"Content-Type":"application/json"};
 const c=await rpc("save_client",{p_actor_id:actor,p_client_id:null,p_expected_version:null,p_first_name:"Synthetic",p_last_name:"Payment roundtrip",p_primary_phone:"+13035550102",p_primary_email:"delivery@example.test",p_preferred_channel:"EMAIL",p_mailing_address:null,p_housecall_address:null},true);client=c.id;ids.push(client);
 const p=await rpc("save_catalog_product",{p_id:null,p_expected_version:null,p_name:"Synthetic visit",p_kind:"service",p_manufacturer:"",p_unit:"visit",p_unit_price_cents:10000,p_active:true},true);product=p.id;ids.push(product);
 server=spawn("deno",["run","--cached-only","--allow-env","--allow-net=127.0.0.1","tests/payment-access/delivery-local-server.ts"],{env:{...process.env,SUPABASE_URL:local.API_URL,SUPABASE_SERVICE_ROLE_KEY:local.SERVICE_ROLE_KEY,SUPABASE_ANON_KEY:local.ANON_KEY,APP_URL:origin,PAYMENT_DELIVERY_STAFF_ENABLED:"true",PAYMENT_ACCESS_ORIGIN:origin,PAYMENT_ACCESS_ACTIVE_KEY_VERSION:"local-v1",PAYMENT_ACCESS_KEYS:JSON.stringify({"local-v1":key}),PAYMENT_COLLECTION_ENABLED:"true",PAYMENT_STATUS_ENABLED:"true",RESEND_FROM:"billing@thelivingroom.vet",RESEND_REPLY_TO:"care@thelivingroom.vet",RESEND_API_KEY:"",TWILIO_AUTH_TOKEN:"",TWILIO_FROM_NUMBER:"+13035550101",TWILIO_ACCOUNT_SID:"AC"+"a".repeat(32)},stdio:"ignore"});
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

 const workerEnv:OutboxEnvironment={APP_ENV:"staging",OUTBOUND_DELIVERY_MODE:"test",OUTBOUND_TEST_EMAILS:"delivery@example.test",OUTBOUND_TEST_PHONES:"+13035550102",RESEND_FROM:"billing@thelivingroom.vet",RESEND_REPLY_TO:"care@thelivingroom.vet",RESEND_API_KEY:"synthetic-never-transmitted",TWILIO_FROM_NUMBER:"+13035550101",TWILIO_ACCOUNT_SID:"AC"+"a".repeat(32),TWILIO_AUTH_TOKEN:"synthetic-never-transmitted",PAYMENT_DELIVERY_ENABLED:"true",PAYMENT_ACCESS_ORIGIN:origin,PAYMENT_ACCESS_ACTIVE_KEY_VERSION:"local-v1",PAYMENT_ACCESS_KEYS:JSON.stringify({"local-v1":key}),PAYMENT_COLLECTION_ENABLED:"true",PAYMENT_STATUS_ENABLED:"true"};
 const workerDb={rpc:async(name:string,args:Record<string,unknown>={})=>({data:await rpc(name,args),error:null})};
 let transports=0;
 interface ReviewedDelivery {delivery:{capture:{message_hash:string;payload_hash:string};request:{channel:string}};preview:{message:string}}
 async function sendReviewed(requestId:string,preview:ReviewedDelivery,expectedAttachment?:unknown,uncertain=false){
  const capture=preview.delivery.capture;
  const queued=await rpc("enqueue_payment_delivery",{p_request_id:requestId,p_reviewed_message_hash:capture.message_hash,p_reviewed_payload_hash:capture.payload_hash,p_attest:true},true);
  ids.push(queued.id,queued.message_id);
  const duplicate=await rpc("enqueue_payment_delivery",{p_request_id:requestId,p_reviewed_message_hash:capture.message_hash,p_reviewed_payload_hash:capture.payload_hash,p_attest:true},true);
  check(duplicate.id===queued.id,"Exact queue retry recovers one durable outbox receipt");
  const result=await dispatchOne(workerDb,workerEnv,(async(input:unknown,init:RequestInit)=>{
   transports++;const body=String(init.body);
   check(createHash("sha256").update(body).digest("hex")===capture.payload_hash,"Actual worker transport matches captured payload digest");
   const email=preview.delivery.request.channel==="EMAIL";
   check(String(input).startsWith(email?"https://api.resend.com/":"https://api.twilio.com/"),"Worker selects expected provider endpoint without contacting it");
   if(email){const payload=JSON.parse(body);check(payload.text===preview.preview.message,"Actual email matches staff review");if(expectedAttachment)check(JSON.stringify(payload.attachments[0])===JSON.stringify(expectedAttachment),"Actual worker preserves reviewed invoice attachment bytes");}
   else check(new URLSearchParams(body).get("Body")===preview.preview.message,"Actual SMS matches staff review");
   if(uncertain)throw new Error("Synthetic lost provider response");
   return new Response(JSON.stringify(email?{id:randomUUID()}:{sid:"SM"+"a".repeat(32)}),{status:200});
  }) as typeof fetch);
  check(result.outbox_id===queued.id && result.state===(uncertain?"uncertain":"accepted"),"Production dispatcher records real guarded attempt outcome");
  const recovery=await(await post({action:"recover",p_request_id:requestId})).json();
  check(recovery.delivery.receipt.outbox_id===queued.id && recovery.delivery.receipt.state===(uncertain?"uncertain":"accepted") && recovery.delivery.receipt.delivered===false,"Receipt recovery distinguishes acceptance/uncertainty from delivery");
  const stored=sql(`select to_jsonb(o) from public.communication_outbox o where id=${quote(queued.id)};`);
  check(!stored.includes(access.collection_token) && !stored.includes(access.status_token),"Provider attempt stores no usable payment capability");
 }
 await sendReviewed(delivery,review);
 const attachmentRequest=randomUUID(),attachedDelivery=randomUUID();ids.push(attachmentRequest,attachedDelivery);
 const invoicePreview=await rpc("read_invoice_email_preview",{p_invoice_id:invoice,p_client_id:client},true);
 await rpc("prepare_invoice_email",{p_request_id:attachmentRequest,p_invoice_id:invoice,p_client_id:client,p_conversation_id:conversation,p_recipient:args.p_recipient,p_subject:args.p_subject,p_body:args.p_body_template,p_invoice_hash:invoicePreview.source_hash},true);
 const invoiceContext=await rpc("invoice_email_capture_context",{p_request_id:attachmentRequest,p_actor_id:actor});
 const frozen=await buildInvoiceEmailPayload(invoiceContext.request,invoiceContext.bundle,{from:workerEnv.RESEND_FROM!,replyTo:workerEnv.RESEND_REPLY_TO!},{name:"The Living Room Vet",address:"2619 Spruce Street, Boulder, CO",domain:"thelivingroom.vet"});
 await rpc("capture_invoice_email_payload",{p_request_id:attachmentRequest,p_actor_id:actor,p_payload_text:frozen.payload_text});
 check((await post({...args,p_request_id:attachedDelivery,p_invoice_email_request_id:attachmentRequest,p_invoice_payload_hash:frozen.payload_hash})).status===200,"Actual preparation captures payment email with original renderer attachment");
 const attachedReview=await(await post({action:"review",p_request_id:attachedDelivery})).json();
 await sendReviewed(attachedDelivery,attachedReview,JSON.parse(frozen.payload_text).attachments[0]);
 await rpc("record_sms_consent",{p_actor_id:actor,p_client_id:client,p_phone:"+13035550102",p_opted_in:true,p_method:"WRITTEN",p_details:"Synthetic local test",p_expected_updated_at:null},true);
 const smsDelivery=randomUUID(),blockedDelivery=randomUUID();ids.push(smsDelivery,blockedDelivery);
 const smsArgs={...args,p_channel:"SMS",p_recipient:"+13035550102",p_subject:"",p_request_id:smsDelivery};
 check((await post(smsArgs)).status===200,"Actual SMS preparation validates current consent");
 const smsReview=await(await post({action:"review",p_request_id:smsDelivery})).json();
 await sendReviewed(smsDelivery,smsReview,undefined,true);
 const beforeRetry=transports;check((await dispatchOne(workerDb,workerEnv,(async()=>{transports++;throw new Error("Must not retry uncertainty");}) as typeof fetch)).processed===false && transports===beforeRetry,"Uncertain provider response never automatically resends");
 check((await post({...smsArgs,p_request_id:blockedDelivery})).status===200,"Prepare separate delivery for revoke-before-send check");
 const blockedReview=await(await post({action:"review",p_request_id:blockedDelivery})).json();
 const blockedOutbox=await rpc("enqueue_payment_delivery",{p_request_id:blockedDelivery,p_reviewed_message_hash:blockedReview.delivery.capture.message_hash,p_reviewed_payload_hash:blockedReview.delivery.capture.payload_hash,p_attest:true},true);ids.push(blockedOutbox.id,blockedOutbox.message_id);
 await rpc("revoke_payment_collection",{p_request_id:grantId,p_reason:"Synthetic local revocation"},true);
 const beforeBlocked=transports;
 await dispatchOne(workerDb,workerEnv,(async()=>{transports++;throw new Error("Revocation must block transport");}) as typeof fetch);
 check(transports===beforeBlocked,"Revoked queued grant stops production worker before provider transport");
 const receiptReview=await(await post({action:"review",p_request_id:delivery})).json();
 check(receiptReview.delivery.receipt && !receiptReview.preview,"Queued receipt recovery after revocation never rematerializes a link");
 const recovered=await(await post({action:"recover",p_request_id:delivery})).json();check(recovered.delivery.capture.message_hash===prepared.delivery.capture.message_hash,"Revoked delivery still recovers immutable digest metadata");
}catch(error){failures.push(error);}finally{
 if(server){server.kill("SIGTERM");await new Promise<void>(resolve=>{if(server!.exitCode!==null || server!.signalCode!==null)resolve();else server!.once("exit",()=>resolve());});}
 try{
  if(ids.length || createdProfile){const patterns=ids.length?ids.map(id=>quote(`%${id}%`)).join(","):quote("%"+randomUUID()+"%");sql(`begin;set local session_replication_role=replica;do $cleanup$ declare t record;begin for t in select schemaname,tablename from pg_tables where schemaname='public' loop execute format('delete from %I.%I r where to_jsonb(r)::text like any ($1)',t.schemaname,t.tablename) using array[${patterns}];end loop;end $cleanup$;${createdProfile?`delete from public.payment_provider_profiles where account_id=${quote(account)};`:""}commit;`);}
  if(actor){const removed=await fetch(local.API_URL+"/auth/v1/admin/users/"+actor,{method:"DELETE",headers:serviceHeaders});check(removed.ok,"Synthetic Auth user cleanup succeeded");check(sql(`select count(*) from public.payment_collection_grants where actor_id=${quote(actor)};`)==="0","Synthetic grant cleanup verified");}
 }catch(error){failures.push(error);}
}
if(failures.length)throw new AggregateError(failures,"Local payment roundtrip or cleanup failed");
console.log(`Local delivery HTTP/Auth/SQL roundtrip: ${assertions} checks passed. Provider transport simulated; no real provider requests or messages sent.`);
