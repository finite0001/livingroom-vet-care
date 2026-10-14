import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
import type { SupabaseClient } from "@supabase/supabase-js";
interface Input {
  status: { API_URL: string; ANON_KEY: string };
  vet: { id: string; db: SupabaseClient }; staff: { id: string; db: SupabaseClient };
  productId: string; sql: (query: string) => string;
}
export async function inventoryBrowserProof({status,vet,staff,productId,sql}:Input){
 const origin="http://127.0.0.1:47681",storageKey=`sb-${new URL(status.API_URL).hostname.split(".")[0]}-auth-token`;let checks=0;
 const vite=spawn(process.execPath,["node_modules/vite/bin/vite.js","--host","127.0.0.1","--port","47681","--strictPort"],{cwd:process.cwd(),stdio:"ignore",env:{...process.env,VITE_SUPABASE_URL:status.API_URL,VITE_SUPABASE_PUBLISHABLE_KEY:status.ANON_KEY}});
 let browser:Awaited<ReturnType<typeof chromium.launch>>|null=null;
 async function token(db:SupabaseClient){const{data,error}=await db.auth.getSession();if(error)throw error;assert.ok(data.session);return data.session;}
 try{
  for(let i=0;i<400;i++){if(vite.exitCode!==null)throw new Error("Owned inventory app exited");try{if((await fetch(origin)).ok)break;}catch{/*Own local startup*/}if(i===399)throw new Error("Owned inventory app unavailable");await new Promise(r=>setTimeout(r,25));}
  browser=await chromium.launch({headless:true});
  const context=await browser.newContext({viewport:{width:1280,height:900}});
  await context.addInitScript(({value,key})=>{if(!localStorage.getItem("synthetic:identity-boot")){localStorage.setItem(key,JSON.stringify(value));localStorage.setItem("synthetic:identity-boot","true");}},{value:await token(vet.db),key:storageKey});
  await context.route("**/*",route=>[origin,status.API_URL].includes(new URL(route.request().url()).origin)?route.continue():route.abort());
  const page=await context.newPage(),errors:string[]=[];page.setDefaultTimeout(30000);page.on("pageerror",e=>errors.push(e.message));page.on("dialog",dialog=>void dialog.accept());
  await page.goto(origin+"/hub/inventory");await page.getByRole("button",{name:"Open supplier products",exact:true}).click();
  await page.getByRole("button",{name:"New supplier scope",exact:true}).waitFor();checks++;
  const suffix=randomUUID().slice(0,8),account="Browser supplier "+suffix,packageName="Browser vial "+suffix;
  await page.getByRole("button",{name:"New supplier scope",exact:true}).click();
  await page.getByLabel("Purchasing account label",{exact:true}).fill(account);await page.getByLabel("Catalog scope",{exact:true}).fill("Browser validated list");
  await page.getByRole("checkbox",{name:"Make supplier codes available for lookup",exact:true}).check();
  await page.getByLabel("Supplier review note",{exact:true}).fill("Synthetic browser supplier review");await page.getByRole("checkbox",{name:/I reviewed the supplier scope/}).check();
  await page.getByRole("button",{name:"Save supplier review",exact:true}).click();await page.getByRole("dialog").waitFor({state:"hidden"});checks++;
  const scopeId=sql(`select e.id from inventory_identity_entries e join inventory_identity_versions v on v.id=e.head_id where v.definition->>'account_label'='${account}';`);assert.match(scopeId,/^[0-9a-f-]{36}$/);checks++;
  await page.getByRole("button",{name:"New product package",exact:true}).click();
  await page.getByRole("dialog").getByLabel("Stock product",{exact:true}).selectOption(productId);
  await page.getByRole("dialog").getByLabel("Package label",{exact:true}).fill(packageName);await page.getByRole("dialog").getByLabel("Strength or concentration",{exact:true}).fill("10mg/mL");await page.getByRole("dialog").getByLabel("Dosage form",{exact:true}).fill("injectable");await page.getByRole("dialog").getByLabel("Purchase unit",{exact:true}).fill("vial");
  await page.getByRole("dialog").getByLabel("Stock units in conversion",{exact:true}).fill("10");await page.getByRole("dialog").getByLabel("Purchase units in conversion",{exact:true}).fill("1");
  await page.getByText("1 vial = 10.000 mL",{exact:true}).waitFor();checks++;
  await page.getByRole("button",{name:"Add package identifier",exact:true}).click();await page.getByRole("dialog").getByLabel("Identifier 1 supplier scope",{exact:true}).selectOption(scopeId);await page.getByRole("dialog").getByLabel("Identifier 1 original code",{exact:true}).fill("000987");
  await page.getByRole("checkbox",{name:"Make reviewed package available for lookup",exact:true}).check();await page.getByLabel("Supplier review note",{exact:true}).fill("Synthetic browser package with lost committed response");await page.getByRole("checkbox",{name:/I reviewed the supplier scope/}).check();
  let dropped=false,dropAcknowledgement=true;
  await page.route(status.API_URL+"/rest/v1/rpc/execute_inventory_identity_review",async route=>{const response=await route.fetch();if(dropAcknowledgement&&response.ok()){await response.body();dropped=true;await route.abort("failed");}else await route.fulfill({response});});
  await page.getByRole("button",{name:"Save supplier review",exact:true}).click();await page.getByRole("button",{name:"Check saved supplier review",exact:true}).waitFor();assert.equal(dropped,true);dropAcknowledgement=false;checks++;
  await page.reload();
  await page.getByRole("button",{name:"Open supplier products",exact:true}).click();
  const recovery=page.getByRole("region",{name:"Product package recovery",exact:true});
  await recovery.getByRole("button",{name:"Check saved supplier review",exact:true}).waitFor();checks++;
  let recoveryWrites=0;
  const countRecoveryWrites=(request: import("playwright").Request)=>{if(/\/rpc\/(prepare|execute)_inventory_identity_review$/.test(new URL(request.url()).pathname))recoveryWrites++;};
  page.on("request",countRecoveryWrites);
  await recovery.getByRole("button",{name:"Check saved supplier review",exact:true}).click();await recovery.waitFor({state:"hidden"});
  page.off("request",countRecoveryWrites);assert.equal(recoveryWrites,0);checks++;
  assert.equal(sql(`select count(*)from inventory_identity_versions where definition->>'label'='${packageName}';`),"1");checks++;
  await page.getByLabel("Supplier code or barcode",{exact:true}).fill("000987");await page.getByLabel("Lookup supplier scope",{exact:true}).selectOption(scopeId);await page.getByRole("button",{name:"Look up reviewed code",exact:true}).click();await page.getByRole("region",{name:"Supplier product lookup",exact:true}).getByText(packageName,{exact:true}).waitFor();checks++;
  await page.getByRole("button",{name:"New supplier scope",exact:true}).click();await page.getByLabel("Purchasing account label",{exact:true}).fill("Unsaved browser draft");await page.getByRole("button",{name:"Close supplier review",exact:true}).click();await page.getByRole("dialog").waitFor({state:"hidden"});checks++;
  await page.setViewportSize({width:375,height:812});await page.getByRole("button",{name:"New product package",exact:true}).click();
  assert.equal(await page.getByRole("dialog").evaluate(element=>element.scrollWidth<=element.clientWidth),true);checks++;
  await page.waitForFunction(() => [...document.querySelectorAll('[role="dialog"] button')].every(button => button.getBoundingClientRect().height >= 43.99), undefined, { timeout: 5000 });
  const targets=await page.getByRole("dialog").locator("button").evaluateAll(buttons=>buttons.every(button=>button.getBoundingClientRect().height>=43.99));assert.equal(targets,true);checks++;
  await page.getByRole("button",{name:"Close supplier review",exact:true}).click();await page.getByRole("dialog").waitFor({state:"hidden"});
  assert.deepEqual(errors,[]);checks++;
  const staffContext=await browser.newContext({viewport:{width:1280,height:900}});await staffContext.addInitScript(({value,key})=>localStorage.setItem(key,JSON.stringify(value)),{value:await token(staff.db),key:storageKey});await staffContext.route("**/*",route=>[origin,status.API_URL].includes(new URL(route.request().url()).origin)?route.continue():route.abort());
  const staffPage=await staffContext.newPage();await staffPage.goto(origin+"/hub/inventory");await staffPage.getByRole("button",{name:"Open supplier products",exact:true}).click();assert.equal(await staffPage.getByRole("button",{name:"New supplier scope",exact:true}).count(),0);checks++;
  await staffPage.getByLabel("Supplier code or barcode",{exact:true}).fill("000987");await staffPage.getByLabel("Lookup supplier scope",{exact:true}).selectOption(scopeId);await staffPage.getByRole("button",{name:"Look up reviewed code",exact:true}).click();await staffPage.getByRole("region",{name:"Supplier product lookup",exact:true}).getByText(packageName,{exact:true}).waitFor();checks++;
  return{browser_checks:checks,genuine_staff_api:true,committed_ack_loss_recovered:true,reload_readonly_recovery:true,mobile_overflow_checked:true,touch_targets_checked:true,staff_lookup_only:true,provider_requests:0};
 }finally{await browser?.close();vite.kill("SIGTERM");}
}
