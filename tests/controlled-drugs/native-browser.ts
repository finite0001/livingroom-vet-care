import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { chromium } from "playwright";
import type { SupabaseClient } from "@supabase/supabase-js";
interface Input {
 status: { API_URL: string; ANON_KEY: string }; vet: { id: string; db: SupabaseClient }; staff: { id: string; db: SupabaseClient };
 productId: string; productName: string; sql(query: string): string; fixtureDirectory: string;
}
export async function controlledBrowserProof({status,vet,staff,productId,productName,sql,fixtureDirectory}:Input){
 const origin="http://127.0.0.1:47681",storageKey=`sb-${new URL(status.API_URL).hostname.split(".")[0]}-auth-token`;let checks=0,discardConfirmations=0;
 const vite=spawn(process.execPath,["node_modules/vite/bin/vite.js","--host","127.0.0.1","--port","47681","--strictPort"],{cwd:process.cwd(),stdio:"ignore",env:{...process.env,VITE_SUPABASE_URL:status.API_URL,VITE_SUPABASE_PUBLISHABLE_KEY:status.ANON_KEY}});
 let browser:Awaited<ReturnType<typeof chromium.launch>>|null=null;const errors:string[]=[];
 async function token(db:SupabaseClient){const{data,error}=await db.auth.getSession();if(error)throw error;assert.ok(data.session);return data.session;}
 try{
  for(let i=0;i<400;i++){if(vite.exitCode!==null)throw new Error("Owned controlled draft app exited");try{if((await fetch(origin)).ok)break;}catch{/*Owned loopback startup*/}if(i===399)throw new Error("Owned controlled draft app unavailable");await new Promise(r=>setTimeout(r,25));}
  browser=await chromium.launch({headless:true});
  const context=await browser.newContext({viewport:{width:1280,height:900}});
  await context.addInitScript(({value,key})=>{if(!localStorage.getItem("synthetic:draft-boot")){localStorage.setItem(key,JSON.stringify(value));localStorage.setItem("synthetic:draft-boot","true");}},{value:await token(vet.db),key:storageKey});
  await context.route("**/*",route=>[origin,status.API_URL].includes(new URL(route.request().url()).origin)?route.continue():route.abort());
  const page=await context.newPage();page.setDefaultTimeout(30000);page.on("pageerror",error=>errors.push(error.message));page.on("dialog",dialog=>{if(dialog.type()==="confirm"&&dialog.message()==="Discard this unsaved controlled-drug draft?")discardConfirmations++;void dialog.accept();});
  await page.goto(origin+"/hub/inventory");await page.getByRole("button",{name:"Open controlled-drug drafts",exact:true}).click();
  await page.getByRole("button",{name:"New medication draft",exact:true}).click();checks++;
  await page.getByLabel("Find medication for draft",{exact:true}).fill(productName);await page.getByLabel("Draft stock medication",{exact:true}).selectOption(productId);
  assert.equal(await page.getByLabel("Proposed controlled schedule",{exact:true}).inputValue(),"");checks++;
  await page.getByLabel("Generic drug name",{exact:true}).fill("Synthetic browser controlled substance");await page.getByLabel("Proposed controlled schedule",{exact:true}).selectOption("III");
  await page.getByLabel("Reviewed strength or concentration",{exact:true}).fill("10 mg/mL");await page.getByLabel("Concentration source",{exact:true}).fill("Synthetic physical label fixture");
  await page.getByLabel("Classification source",{exact:true}).fill("Synthetic classification fixture");await page.getByLabel("Draft configuration note",{exact:true}).fill("Synthetic browser: draft only, register inactive");await page.getByLabel("Draft review note",{exact:true}).fill("Synthetic lost acknowledgement review");
  await page.getByRole("checkbox",{name:/I reviewed this proposed medication/}).check();
  let dropped=false,drop=true;
  await page.route(status.API_URL+"/rest/v1/rpc/execute_controlled_draft_review",async route=>{const response=await route.fetch();if(drop&&response.ok()){await response.body();dropped=true;await route.abort("failed");}else await route.fulfill({response});});
  await page.getByRole("button",{name:"Save draft configuration",exact:true}).click();await page.getByRole("button",{name:"Check saved controlled-drug draft",exact:true}).waitFor();assert.equal(dropped,true);drop=false;checks++;
  await page.reload();await page.getByRole("button",{name:"Open controlled-drug drafts",exact:true}).click();const recovery=page.getByRole("region",{name:"Controlled-drug draft recovery",exact:true});await recovery.getByRole("button",{name:"Check saved controlled-drug draft",exact:true}).waitFor();checks++;
  let writes=0;const count=(request:import("playwright").Request)=>{if(/\/rpc\/(prepare|execute)_controlled_draft_review$/.test(new URL(request.url()).pathname))writes++;};page.on("request",count);
  await recovery.getByRole("button",{name:"Check saved controlled-drug draft",exact:true}).click();await recovery.waitFor({state:"hidden"});page.off("request",count);assert.equal(writes,0);checks++;
  assert.equal(sql(`select count(*)from controlled_draft_versions v join controlled_draft_entries e on e.id=v.entry_id where e.product_id='${productId}';`),"1");checks++;
  await page.getByLabel("Search medication drafts",{exact:true}).fill(productName);await page.getByText("Synthetic browser controlled substance · proposed Schedule III",{exact:true}).waitFor();checks++;
  await page.getByRole("button",{name:"View medication draft history",exact:true}).click();await page.getByRole("region",{name:"Medication draft history",exact:true}).getByText("Classification source: Synthetic classification fixture",{exact:true}).waitFor();checks++;
  await page.getByRole("button",{name:"Close draft history",exact:true}).click();
  await page.getByRole("button",{name:"Review medication draft revision",exact:true}).click();await page.getByLabel("Draft configuration note",{exact:true}).fill("Unsaved browser draft");await page.getByRole("button",{name:"Close controlled-drug draft",exact:true}).click();await page.getByRole("dialog").waitFor({state:"hidden"});assert.equal(discardConfirmations,1);checks++;
  await page.setViewportSize({width:375,height:812});await page.getByRole("button",{name:"Review medication draft revision",exact:true}).click();
  assert.equal(await page.getByRole("dialog").evaluate(element=>element.scrollWidth<=element.clientWidth),true);checks++;
  await page.waitForFunction(()=>[...document.querySelectorAll('[role="dialog"] button')].every(button=>button.getBoundingClientRect().height>=43.99));checks++;
  await page.screenshot({path:fixtureDirectory+"/controlled-draft-mobile.png",fullPage:true});await page.getByRole("button",{name:"Close controlled-drug draft",exact:true}).click();await page.getByRole("dialog").waitFor({state:"hidden"});
  const staffContext=await browser.newContext({viewport:{width:375,height:812}});await staffContext.addInitScript(({value,key})=>localStorage.setItem(key,JSON.stringify(value)),{value:await token(staff.db),key:storageKey});await staffContext.route("**/*",route=>[origin,status.API_URL].includes(new URL(route.request().url()).origin)?route.continue():route.abort());
  const staffPage=await staffContext.newPage();staffPage.on("pageerror",error=>errors.push(error.message));await staffPage.goto(origin+"/hub/inventory");await staffPage.getByRole("button",{name:"Open controlled-drug drafts",exact:true}).click();await staffPage.getByLabel("Search medication drafts",{exact:true}).fill(productName);
  await staffPage.getByText("Synthetic browser controlled substance · proposed Schedule III",{exact:true}).waitFor();assert.equal(await staffPage.getByRole("button",{name:"New medication draft",exact:true}).count(),0);assert.equal(await staffPage.getByRole("button",{name:"Review medication draft revision",exact:true}).count(),0);checks++;
  assert.equal(await staffPage.locator("#controlled-drug-drafts").evaluate(element=>element.scrollWidth<=element.clientWidth),true);checks++;
  assert.deepEqual(errors,[]);checks++;
  return{browser_checks:checks,genuine_staff_api:true,committed_ack_loss_recovered:true,reload_readonly_recovery:true,draft_only:true,no_default_schedule:true,mobile_overflow_checked:true,touch_targets_checked:true,dirty_close_confirmed:true,staff_read_only:true,provider_requests:0};
 }catch(cause){writeFileSync(fixtureDirectory+"/controlled-browser-errors.json",JSON.stringify({errors}),{mode:0o600});throw cause;}
 finally{await browser?.close();vite.kill("SIGTERM");}
}
