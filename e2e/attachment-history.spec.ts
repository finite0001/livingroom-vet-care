import { test, expect, type Page } from '@playwright/test';
const uid=(n:number)=>`de700000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const actor=uid(1),pet=uid(2),link=uid(3),run=uid(4),snapshot=uid(5),at='2026-09-13T12:00:00.123456+00:00';
async function fixture(page:Page,admin=true){
 const user={id:actor,aud:'authenticated',role:'authenticated',email:'synthetic@example.test',app_metadata:{provider:'email',providers:['email']},user_metadata:{},created_at:at};
 const exp=Math.floor(Date.now()/1000)+3600;
 const session={access_token:`eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({sub:actor,exp,role:'authenticated',aud:'authenticated'})).toString('base64url')}.synthetic`,refresh_token:'synthetic',token_type:'bearer',expires_in:3600,expires_at:exp,user};
 await page.addInitScript(s=>localStorage.setItem('sb-127-auth-token',JSON.stringify(s)),session);
 const mapping={link_id:link,pet_id:pet,patient_name:'Synthetic Juniper',household_name:'Synthetic Family',source_origin:'https://api.trial.ezyvet.com',source_site_uid:'synthetic-site',external_id:'77',patient_version:1};
 const parent={animal_link_id:link,pet_id:pet,client_id:uid(6),animal_external_id:'77',source_origin:mapping.source_origin,source_site_uid:mapping.source_site_uid,parent_type:'Animal',parent_external_id:'77',parent_snapshot_id:uid(7),parent_payload_hash:'a'.repeat(64),parent_observed_head_version:1};
 const state={stale:false,wrong:false,empty:false,more:false,calls:[] as Array<{path:string;body:Record<string,unknown>}>};
 await page.route('**/*',r=>new URL(r.request().url()).origin==='http://127.0.0.1:8080'?r.continue():r.abort());
 await page.route('http://127.0.0.1:54321/**',async r=>{
  const path=new URL(r.request().url()).pathname,body=r.request().method()==='POST'?r.request().postDataJSON():{};
  if(path==='/auth/v1/token')return r.fulfill({json:session});
  if(path==='/auth/v1/user')return r.fulfill({json:user});
  if(path==='/rest/v1/profiles')return r.fulfill({json:[{id:actor,first_name:'Synthetic',last_name:'Admin',full_name:'Synthetic Admin',role:admin?'ADMIN':'STAFF',is_active:true}]});
  if(path==='/rest/v1/user_roles')return r.fulfill({json:[{role:admin?'ADMIN':'STAFF'}]});
  state.calls.push({path,body});
  if(path.endsWith('search_ezyvet_mapped_patients'))return r.fulfill({json:[mapping,{...mapping,link_id:uid(30),pet_id:uid(31),patient_name:'Synthetic Other'}]});
  if(path.endsWith('list_ezyvet_attachment_runs'))return r.fulfill({json:{runs:state.empty||body.p_animal_link_id!==link?[]:[{id:run,requested_by:actor,resource:'attachment',source_origin:mapping.source_origin,source_site_uid:mapping.source_site_uid,status:'review_ready',next_page:3,retry_after:null,last_error_code:null,created_at:at,updated_at:at,lease_active:false,scope:'parent_scoped',parent_context:parent}],has_more:false,next_cursor:null}});
  if(path.endsWith('list_ezyvet_attachment_observations')){
   const second=body.p_after_page!==null;
   return r.fulfill({json:{run_id:run,pet_id:state.wrong?uid(99):pet,parent_context:parent,parent_is_current:!state.stale,observations:[{run_id:run,pet_id:pet,page:second?2:1,snapshot_id:second?uid(8):snapshot,payload_hash:'b'.repeat(64),observed_head_version:1,external_id:second?'702':'701',current_snapshot_id:second?uid(8):snapshot,current_head_version:state.stale?2:1,is_current:!state.stale,metadata:{name:second?'Other source file':'Original report',mime_type:second?'text/plain':'application/pdf',file_id:null,notes:second?'Retained source notes':'<script>not executable</script>',notes_truncated:second,name_truncated:false}}],has_more:state.more&&!second,next_cursor:state.more&&!second?{after_page:1,after_snapshot_id:snapshot}:null}});
  }
  return r.fulfill({json:[]});
 });
 await page.goto('/hub/tools/ezyvet');
 const section=page.getByRole('region',{name:'Attachment scan history',exact:true});
 const select=async()=>{await section.getByLabel('Find attachment history patient').fill('Juniper');await section.getByRole('button',{name:'Synthetic Juniper · Synthetic Family',exact:true}).click();};
 const open=async()=>{await select();await section.getByRole('button',{name:`View files from scan ${run.slice(0,8)}`}).click();await expect(section.getByRole('heading',{name:'Original report'})).toBeVisible();};
 return {state,section,select,open};
}
test('operator finds scoped scan and sees escaped source metadata without file links',async({page})=>{const f=await fixture(page);await f.open();await expect(f.section.getByText('<script>not executable</script>',{exact:true})).toBeVisible();await expect(f.section.getByText('Latest observed file revision',{exact:true})).toBeVisible();await expect(f.section.locator('a')).toHaveCount(0);expect(f.state.calls.some(c=>c.path.startsWith('/functions/'))).toBe(false);});
test('changed source retains original observation and explains both stale states',async({page})=>{const f=await fixture(page);await f.open();f.state.stale=true;await f.section.getByRole('button',{name:'Recheck observed files'}).click();await expect(f.section.getByText('File source changed',{exact:true})).toBeVisible();await expect(f.section.getByText(/patient or consultation source has changed/)).toBeVisible();await expect(f.section.getByRole('heading',{name:'Original report'})).toBeVisible();});
test('file pagination preserves exact cursor and exposes unsupported file coverage',async({page})=>{const f=await fixture(page);f.state.more=true;await f.open();await f.section.getByRole('button',{name:'Next file page'}).click();await expect(f.section.getByRole('heading',{name:'Other source file'})).toBeVisible();await expect(f.section.getByText(/not supported by the current file capture/)).toBeVisible();await expect(f.section.getByText(/Notes preview shortened/)).toBeVisible();expect(f.state.calls.some(c=>c.body.p_after_page===1&&c.body.p_after_snapshot_id===snapshot)).toBe(true);await f.section.getByRole('button',{name:'First file page'}).click();await expect(f.section.getByRole('heading',{name:'Original report'})).toBeVisible();});
test('wrong-patient response hides cached evidence and exposes a recoverable error',async({page})=>{const f=await fixture(page);await f.open();f.state.wrong=true;await f.section.getByRole('button',{name:'Recheck observed files'}).click();await expect(f.section.getByRole('alert')).toContainText('File evidence is unavailable');await expect(f.section.getByRole('heading',{name:'Original report'})).toHaveCount(0);});
test('changing mapped patient clears selected scan without losing original history',async({page})=>{const f=await fixture(page);await f.open();await f.section.getByRole('button',{name:'Synthetic Other · Synthetic Family',exact:true}).click();await expect(f.section.getByText('No saved attachment scans on this page.')).toBeVisible();await expect(f.section.getByRole('heading',{name:'Original report'})).toHaveCount(0);});
test('non-administrator cannot see attachment discovery controls',async({page})=>{const f=await fixture(page,false);await expect(f.section).toHaveCount(0);expect(f.state.calls.some(c=>c.path.includes('list_ezyvet_attachment'))).toBe(false);});
test('attachment history wraps on a narrow viewport',async({page})=>{await page.setViewportSize({width:375,height:812});const f=await fixture(page);await f.open();expect(await f.section.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);});
