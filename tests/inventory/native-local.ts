import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { inventoryBrowserProof } from "./native-browser.ts";
import { parseOwnedRuntimeStatus } from "../../tests/estimates/owned-runtime-status.ts";
import { identityEntrySchema, identityPageSchema, identityHistorySchema, identityReceiptSchema, identityReviewSchema, identifierMatchesSchema, verifyIdentityReceipt, parseIdentityRequest, type IdentityActionMetadata } from "../../src/hub/features/inventory/supplier-imports/package-model.ts";
const project=process.env.INVENTORY_TEST_PROJECT;
assert.ok(project&&process.env.INVENTORY_RUN_SYNTHETIC_LOCAL==="true","Explicit owned local inventory proof required");
const config=readFileSync(project+"/supabase/config.toml","utf8");
const identity=config.match(/^project_id\s*=\s*"([a-zA-Z0-9_-]+)"/m)?.[1];assert.ok(identity?.startsWith("lrv-identity-")||identity?.startsWith("lrv-catalog-"));
const container="supabase_db_"+identity;
const labels=JSON.parse(execFileSync("docker",["inspect",container],{encoding:"utf8"}))[0].Config.Labels;
assert.equal(labels["com.supabase.cli.project"],identity);assert.equal(realpathSync(labels["com.supabase.cli.workdir"]),realpathSync(project));
const status=parseOwnedRuntimeStatus(execFileSync("supabase",["status","--workdir",project,"--output","json","--agent","no"],{encoding:"utf8",stdio:["ignore","pipe","pipe"]}));
const apiPort=config.split("[api]")[1]?.split("[")[0].match(/^port\s*=\s*(\d+)/m)?.[1];assert.ok(apiPort);assert.equal(new URL(status.API_URL).origin,"http://127.0.0.1:"+apiPort);
const meta={work:project};
const options={auth:{persistSession:false,autoRefreshToken:false}},service=createClient(status.API_URL,status.SERVICE_ROLE_KEY,options),anon=createClient(status.API_URL,status.ANON_KEY,options);
function sql(query:string):string{return execFileSync("docker",["exec","-i",container,"psql","-X","-qAt","-U","postgres","-d","postgres","-v","ON_ERROR_STOP=1"],{input:query,encoding:"utf8",stdio:["pipe","pipe","pipe"]}).trim();}
interface Actor{id:string;db:SupabaseClient}
const actors:Actor[]=[];let checks=0,failed:unknown=null,browser:Awaited<ReturnType<typeof inventoryBrowserProof>>|null=null;
const receipt=(value:unknown,expected:unknown)=>{assert.deepEqual(value,expected);checks++;};
async function rpc(db:SupabaseClient,name:string,args:Record<string,unknown>={}){const{data,error}=await db.rpc(name,args);if(error)throw Object.assign(new Error(name+": "+error.message),{code:error.code});return data;}
async function actor(role:"DVM"|"STAFF"){
 const email="synthetic-identity-"+randomUUID()+"@example.test",password=randomUUID()+randomUUID();const{data,error}=await service.auth.admin.createUser({email,password,email_confirm:true});if(error)throw error;assert.ok(data.user);const id=data.user.id,db=createClient(status.API_URL,status.ANON_KEY,options);actors.push({id,db});writeFileSync(meta.work+"/api-fixture-ids.json",JSON.stringify({actors:actors.map(a=>a.id)}),{mode:0o600});
 sql(`update profiles set is_active=true,full_name='Synthetic inventory ${role}'where id='${id}';insert into user_roles(user_id,role)values('${id}','${role}')on conflict do nothing;`);
 const signed=await db.auth.signInWithPassword({email,password});if(signed.error)throw signed.error;return actors.at(-1)!;
}
const uid=()=>randomUUID();const namespace=uid(),packageId=uid(),productId=uid();
const initialEntries=Number(sql("select count(*)from inventory_identity_entries;"));
const payload="00"+(BigInt("0x"+productId.split("-").join("").slice(0,10))%100000000000n).toString().padStart(11,"0");let sum=0;for(let i=12,w=3;i>=0;i--,w=4-w)sum+=Number(payload[i])*w;const fixtureGtin=payload+((10-sum%10)%10).toString();
const packet=(id:string,definition:unknown,expected_version:number|null=null)=>({id,definition,expected_version,review_note:"Synthetic genuine API metadata review",attest_review:true});
async function apply(owner:Actor,operation:"namespace"|"package",request:unknown){
 const action:IdentityActionMetadata={id:uid(),actor_id:owner.id,operation};const checked=parseIdentityRequest(operation,request);
 const args={p_actor_id:owner.id,p_action_id:action.id};const prepared=identityReviewSchema.parse(await rpc(owner.db,"prepare_inventory_identity_review",{...args,p_operation:operation,p_request:checked}));receipt(prepared.state,"prepared");
 const saved=verifyIdentityReceipt(action,checked,await rpc(owner.db,"execute_inventory_identity_review",args));receipt(await rpc(owner.db,"execute_inventory_identity_review",args),saved);
 const recovered=identityReviewSchema.parse(await rpc(owner.db,"read_inventory_identity_review",args));receipt(recovered.receipt,saved);return{action,request:checked,saved};
}
const baseline=sql("select jsonb_build_object('stock',(select count(*)from inventory_movements),'outbox',(select count(*)from communication_outbox),'invoices',(select count(*)from billing_invoices),'payments',(select count(*)from payment_provider_profiles),'generation',(select count(*)from operational_task_generation_policy where enabled))");
try{
 const vet=await actor("DVM"),staff=await actor("STAFF");
 for(const table of["inventory_identity_entries","inventory_identity_versions","inventory_identity_reviews","inventory_identity_actions","inventory_identity_cancellations","inventory_identity_bindings"]){for(const db of[anon,service,staff.db])receipt((await db.from(table).select("*")).error?.code,"42501");}
 receipt((await service.rpc("list_inventory_identities",{p_kind:"namespace"})).error?.code,"42501");
 const definition={supplier:"mwi",account_label:"Synthetic genuine MWI "+namespace.slice(0,8),catalog_scope:"Synthetic actual API list",active:true};
 receipt((await staff.db.rpc("prepare_inventory_identity_review",{p_actor_id:staff.id,p_action_id:uid(),p_operation:"namespace",p_request:packet(namespace,definition)})).error?.code,"42501");
 const ns=await apply(vet,"namespace",packet(namespace,definition));
 receipt(identityPageSchema.parse(await rpc(staff.db,"list_inventory_identities",{p_kind:"namespace"})).items.some(item=>item.id===namespace),true);
 const product=await rpc(vet.db,"create_inventory_product",{p_id:productId,p_name:"Synthetic genuine vial",p_kind:"medication",p_manufacturer:"Synthetic genuine manufacturer",p_unit:"mL",p_unit_price_cents:100});receipt(product.id,productId);
 const packageDefinition={product_id:productId,product_version:1,stock_unit:"mL",label:"Synthetic genuine ten mL vial",manufacturer:"Synthetic genuine manufacturer",strength:"10mg/mL",form:"injectable",purchase_unit:"vial",conversion:{stock_units_numerator:"10",purchase_units_denominator:"1"},identifiers:[{kind:"supplier_sku",namespace_id:namespace,namespace_version_id:ns.saved.entry.version_id,value:"000123",raw_source:"000123"},{kind:"gtin",namespace_id:null,namespace_version_id:null,value:fixtureGtin,raw_source:fixtureGtin}],active:true};
 const pkg=await apply(vet,"package",packet(packageId,packageDefinition));
 const found=identifierMatchesSchema.parse(await rpc(staff.db,"lookup_inventory_identifier",{p_kind:"supplier_sku",p_value:"000123",p_namespace_id:namespace}));receipt(found.items.some(item=>item.id===packageId),true);
 const history=identityHistorySchema.parse(await rpc(vet.db,"read_inventory_identity",{p_id:packageId,p_limit:1}));receipt(history.entry,pkg.saved.entry);receipt(history.current_product?.id,productId);
 receipt((await staff.db.rpc("read_inventory_identity_review",{p_actor_id:staff.id,p_action_id:pkg.action.id})).error?.code,"42501");
 receipt((await vet.db.rpc("prepare_inventory_identity_review",{p_actor_id:vet.id,p_action_id:pkg.action.id,p_operation:"package",p_request:{...pkg.request,review_note:"Different immutable request"}})).error?.code,"23505");
 receipt(identityEntrySchema.parse(pkg.saved.entry).version,1);receipt(identityReceiptSchema.parse(pkg.saved).operation,"package");
 receipt(sql("select count(*)from inventory_identity_entries;"),String(initialEntries+2));
 browser=await inventoryBrowserProof({status,vet,staff,productId,sql,fixtureDirectory:meta.work,gtin:fixtureGtin});
}catch(cause){failed=cause;}finally{
 for(const owner of actors){try{sql(`update profiles set is_active=false where id='${owner.id}';update auth.sessions set not_after=clock_timestamp()where user_id='${owner.id}';delete from auth.refresh_tokens where user_id='${owner.id}';`);const result=await owner.db.auth.signOut();if(result.error)failed??=result.error;}catch(cause){failed??=cause;}}
}
receipt(sql("select jsonb_build_object('stock',(select count(*)from inventory_movements),'outbox',(select count(*)from communication_outbox),'invoices',(select count(*)from billing_invoices),'payments',(select count(*)from payment_provider_profiles),'generation',(select count(*)from operational_task_generation_policy where enabled))"),baseline);
receipt(sql("select count(*)from profiles where is_active;"),"0");
if(failed)throw failed;
const proof={api_checks:checks,genuine_auth_postgrest:true,private_tables_denied:true,exact_receipt_replay:true,owned_actors_retired:true,baseline_unchanged:true,provider_requests:0,browser};writeFileSync(meta.work+"/identity-api-proof.json",JSON.stringify(proof,null,2),{mode:0o600});console.log(JSON.stringify(proof));
