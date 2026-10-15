import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { controlledBrowserProof } from "./native-browser.ts";
import { parseOwnedRuntimeStatus } from "../estimates/owned-runtime-status.ts";
import { draftPageSchema, draftHistorySchema, draftReviewSchema, verifyDraftReceipt, parseDraftRequest, type DraftActionMetadata } from "../../src/hub/features/controlled-drugs/draft-model.ts";
const project=process.env.CONTROLLED_TEST_PROJECT;
assert.ok(project&&process.env.CONTROLLED_RUN_SYNTHETIC_LOCAL==="true","Explicit owned local controlled-draft proof required");
const config=readFileSync(project+"/supabase/config.toml","utf8");
const identity=config.match(/^project_id\s*=\s*"([a-zA-Z0-9_-]+)"/m)?.[1];assert.ok((identity?.startsWith("lrv-controlled-")||identity?.startsWith("lrv-catalog-")));
const container="supabase_db_"+identity;
const labels=JSON.parse(execFileSync("docker",["inspect",container],{encoding:"utf8"}))[0].Config.Labels;
assert.equal(labels["com.supabase.cli.project"],identity);assert.equal(realpathSync(labels["com.supabase.cli.workdir"]),realpathSync(project));
const status=parseOwnedRuntimeStatus(execFileSync("supabase",["status","--workdir",project,"--output","json","--agent","no"],{encoding:"utf8",stdio:["ignore","pipe","pipe"]}));
const apiPort=config.split("[api]")[1]?.split("[")[0].match(/^port\s*=\s*(\d+)/m)?.[1];assert.ok(apiPort);assert.equal(new URL(status.API_URL).origin,"http://127.0.0.1:"+apiPort);
const meta={work:project};
const options={auth:{persistSession:false,autoRefreshToken:false}},service=createClient(status.API_URL,status.SERVICE_ROLE_KEY,options),anon=createClient(status.API_URL,status.ANON_KEY,options);
function sql(query:string):string{return execFileSync("docker",["exec","-i",container,"psql","-X","-qAt","-U","postgres","-d","postgres","-v","ON_ERROR_STOP=1"],{input:query,encoding:"utf8",stdio:["pipe","pipe","pipe"]}).trim();}
interface Actor{id:string;db:SupabaseClient}
const actors:Actor[]=[];let checks=0,failed:unknown=null,browser:Awaited<ReturnType<typeof controlledBrowserProof>>|null=null;
const receipt=(value:unknown,expected:unknown)=>{assert.deepEqual(value,expected);checks++;};
async function rpc(db:SupabaseClient,name:string,args:Record<string,unknown>={}){const{data,error}=await db.rpc(name,args);if(error)throw Object.assign(new Error(name+": "+error.message),{code:error.code});return data;}
async function actor(role:"DVM"|"STAFF"){
 const email="synthetic-identity-"+randomUUID()+"@example.test",password=randomUUID()+randomUUID();const{data,error}=await service.auth.admin.createUser({email,password,email_confirm:true});if(error)throw error;assert.ok(data.user);const id=data.user.id,db=createClient(status.API_URL,status.ANON_KEY,options);actors.push({id,db});writeFileSync(meta.work+"/api-fixture-ids.json",JSON.stringify({actors:actors.map(a=>a.id)}),{mode:0o600});
 sql(`update profiles set is_active=true,full_name='Synthetic controlled draft ${role}'where id='${id}';insert into user_roles(user_id,role)values('${id}','${role}')on conflict do nothing;`);
 const signed=await db.auth.signInWithPassword({email,password});if(signed.error)throw signed.error;return actors.at(-1)!;
}
const uid=()=>randomUUID();const productId=uid(),product2=uid(),entryId=uid();
const packet=(product:string,id=entryId,expected:number|null=null,version=1)=>({id,expected_version:expected,definition:{product_id:product,product_version:version,stock_unit:"mL",generic_name:"Synthetic controlled substance",brand_name:null,schedule:"II",concentration:"10 mg/mL",concentration_source:"Synthetic label; not a real drug",classification_source:"Synthetic reviewed source; no actual schedule claim",configuration_note:"Draft metadata only; register not active"},review_note:"Synthetic genuine draft review",attest_review:true});
const baseline=sql("select jsonb_build_object('stock',(select count(*)from inventory_movements),'outbox',(select count(*)from communication_outbox),'invoices',(select count(*)from billing_invoices),'payments',(select count(*)from payment_provider_profiles),'generation',(select count(*)from operational_task_generation_policy where enabled))");
try{
 receipt(sql("select count(*)from supabase_migrations.schema_migrations;"),"189");
 const vet=await actor("DVM"),staff=await actor("STAFF");
 receipt((await service.rpc("list_controlled_drafts")).error?.code,"42501");receipt((await anon.rpc("list_controlled_drafts")).error?.code,"42501");
 for(const table of ["controlled_draft_entries","controlled_draft_reviews","controlled_draft_versions","controlled_draft_actions","controlled_draft_cancellations"]){receipt((await staff.db.from(table).select("*")).error?.code,"42501");}
 const product=await rpc(vet.db,"create_inventory_product",{p_id:productId,p_name:"Synthetic API draft medication "+productId.slice(0,8),p_kind:"medication",p_manufacturer:"Synthetic manufacturer",p_unit:"mL",p_unit_price_cents:100});receipt(product.id,productId);
 const second=await rpc(vet.db,"create_inventory_product",{p_id:product2,p_name:"Synthetic browser draft medication "+product2.slice(0,8),p_kind:"medication",p_manufacturer:"Synthetic manufacturer",p_unit:"mL",p_unit_price_cents:100});receipt(second.id,product2);
 const action:DraftActionMetadata={id:uid(),actor_id:vet.id,operation:"draft_configuration"},args={p_actor_id:vet.id,p_action_id:action.id},request=parseDraftRequest("draft_configuration",packet(productId));
 receipt((await staff.db.rpc("prepare_controlled_draft_review",{p_actor_id:staff.id,p_action_id:uid(),p_operation:action.operation,p_request:request})).error?.code,"42501");
 receipt((await vet.db.rpc("prepare_controlled_draft_review",{p_actor_id:staff.id,p_action_id:uid(),p_operation:action.operation,p_request:request})).error?.code,"42501");
 const prepared=draftReviewSchema.parse(await rpc(vet.db,"prepare_controlled_draft_review",{...args,p_operation:action.operation,p_request:request}));receipt(prepared.state,"prepared");
 const saved=verifyDraftReceipt(action,request,await rpc(vet.db,"execute_controlled_draft_review",args));receipt(saved.entry.state,"draft");
 receipt(await rpc(vet.db,"execute_controlled_draft_review",args),saved);receipt(draftReviewSchema.parse(await rpc(vet.db,"read_controlled_draft_review",args)).receipt,saved);
 receipt(draftPageSchema.parse(await rpc(staff.db,"list_controlled_drafts",{p_search:product.name})).items.some(row=>row.id===entryId),true);
 receipt(draftHistorySchema.parse(await rpc(staff.db,"read_controlled_draft",{p_id:entryId})).entry,saved.entry);
 receipt((await staff.db.rpc("read_controlled_draft_review",{p_actor_id:staff.id,p_action_id:action.id})).error?.code,"42501");
 receipt((await vet.db.rpc("prepare_controlled_draft_review",{...args,p_operation:action.operation,p_request:{...request,review_note:"Changed original"}})).error?.code,"23505");
 const duplicate=uid();receipt((await vet.db.rpc("prepare_controlled_draft_review",{p_actor_id:vet.id,p_action_id:duplicate,p_operation:action.operation,p_request:packet(productId,uid())})).error?.code,"23505");
 const cancelled=uid(),cancelArgs={p_actor_id:vet.id,p_action_id:cancelled};receipt((await rpc(vet.db,"cancel_controlled_draft_review",cancelArgs)).cancelled,true);
 receipt(draftReviewSchema.parse(await rpc(vet.db,"read_controlled_draft_review",cancelArgs)).state,"cancelled");
 receipt((await vet.db.rpc("prepare_controlled_draft_review",{...cancelArgs,p_operation:action.operation,p_request:packet(product2,uid())})).error?.code,"PT409");
 receipt((await rpc(vet.db,"cancel_controlled_draft_review",args)).receipt,saved);
 browser=await controlledBrowserProof({status,vet,staff,productId:product2,productName:second.name,sql,fixtureDirectory:meta.work});
}catch(cause){failed=cause;}finally{
 for(const owner of actors){try{sql(`update profiles set is_active=false where id='${owner.id}';update auth.sessions set not_after=clock_timestamp()where user_id='${owner.id}';delete from auth.refresh_tokens where user_id='${owner.id}';`);const result=await owner.db.auth.signOut();if(result.error)failed??=result.error;}catch(cause){failed??=cause;}}
}
receipt(sql("select jsonb_build_object('stock',(select count(*)from inventory_movements),'outbox',(select count(*)from communication_outbox),'invoices',(select count(*)from billing_invoices),'payments',(select count(*)from payment_provider_profiles),'generation',(select count(*)from operational_task_generation_policy where enabled))"),baseline);
const ids=actors.map(actor=>"'"+actor.id+"'").join(",")||"null";
receipt(sql("select count(*)from profiles where is_active and id in("+ids+");"),"0");
receipt(sql("select count(*)from auth.sessions where user_id in("+ids+")and(not_after is null or not_after>clock_timestamp());"),"0");
if(failed)throw failed;
const proof={api_checks:checks,genuine_auth_postgrest:true,private_tables_denied:true,exact_receipt_replay:true,owned_actors_retired:true,owned_sessions_retired:true,baseline_unchanged:true,draft_only:true,provider_requests:0,browser};writeFileSync(meta.work+"/controlled-api-proof.json",JSON.stringify(proof,null,2),{mode:0o600});console.log(JSON.stringify(proof));
