import {test,expect,type Page} from '@playwright/test';
const backend='http://127.0.0.1:54321';
const staff='11111111-1111-4111-8111-111111111111';
const client='22222222-2222-4222-8222-222222222222';
const conversation='33333333-3333-4333-8333-333333333333';
const message='44444444-4444-4444-8444-444444444444';
async function fixture(page:Page, mode:'lost'|'offline'|'rejected') {
 const user={id:staff,aud:'authenticated',role:'authenticated',email:'synthetic@example.test',app_metadata:{provider:'email',providers:['email']},user_metadata:{},created_at:'2026-01-01T00:00:00Z'};
 const expires=Math.floor(Date.now()/1000)+3600;
 const token=Buffer.from(JSON.stringify({sub:staff,exp:expires,role:'authenticated',aud:'authenticated'})).toString('base64url');
 const session={access_token:`eyJhbGciOiJIUzI1NiJ9.${token}.synthetic`,refresh_token:'synthetic',token_type:'bearer',expires_in:3600,expires_at:expires,user};
 await page.addInitScript(value=>localStorage.setItem('sb-127-auth-token',JSON.stringify(value)),session);
 const state={requests:[] as {request_id:string;body:string}[],stored:false,offline:mode==='offline',legacyCalls:0};
 await page.route('**/*',route=>new URL(route.request().url()).origin==='http://127.0.0.1:8080'?route.continue():route.abort());
 await page.route(`${backend}/**`,async route=>{
  const url=new URL(route.request().url()); const path=url.pathname;
  if(path==='/auth/v1/token')return route.fulfill({json:session});
  if(path==='/auth/v1/user')return route.fulfill({json:user});
  if(path==='/rest/v1/profiles')return route.fulfill({json:{id:staff,full_name:'Synthetic Staff',first_name:'Synthetic',last_name:'Staff',is_active:true}});
  if(path==='/rest/v1/user_roles')return route.fulfill({json:[{role:'STAFF'}]});
  if(path==='/rest/v1/conversations')return route.fulfill({json:{id:conversation,client_id:client,status:'ACTIVE',is_read:true,priority:'NORMAL',tags:[],last_message_at:'2026-09-12T12:00:00Z'}});
  if(path==='/rest/v1/clients')return route.fulfill({json:{id:client,full_name:'Synthetic Household',first_name:'Synthetic',last_name:'Household',primary_email:'synthetic@example.test',primary_phone:'+13035550123',preferred_channel:'EMAIL'}});
  if(path==='/rest/v1/sms_consent')return route.fulfill({json:{opted_in:true,phone_number:'+13035550123'}});
  if(path==='/functions/v1/send-email'||path==='/functions/v1/send-sms'){state.legacyCalls++;return route.fulfill({status:500,json:{error:'Legacy bypass'}});}
  if(path==='/functions/v1/enqueue-message'){
   const payload=route.request().postDataJSON();state.requests.push(payload);
   if(mode==='rejected')return route.fulfill({status:403,json:{error:'Delivery disabled in this environment',queue_rejected:true}});
   if(state.offline)return route.abort();
   state.stored=true;
   if(mode==='lost')return route.abort();
   return route.fulfill({status:202,json:{success:true,queued:true,outbox_id:'queue',message_id:message,state:'pending'}});
  }
  if(path==='/rest/v1/communication_outbox'){
   const row={id:'queue',message_id:message,state:'pending',last_error:null};
   return route.fulfill({json:url.searchParams.has('request_id')?(state.stored?row:null):(state.stored?[row]:[])});
  }
  if(path==='/rest/v1/messages')return route.fulfill({json:state.stored?[{id:message,conversation_id:conversation,type:'EMAIL',sender_type:'STAFF',content:'Synthetic queue test',is_internal:false,created_at:'2026-09-12T12:00:00Z'}]:[]});
  return route.fulfill({json:[]});
 });
 return state;
}
async function compose(page:Page) {
 await page.goto(`/hub/conversation/${conversation}`);
 await page.getByRole('tab',{name:'Email',exact:true}).click();
 await page.getByPlaceholder('Subject',{exact:true}).fill('Synthetic subject');
 await page.getByPlaceholder('Send EMAIL...').fill('Synthetic queue test');
}
test('lost response recovers durable queue and shows queued rather than delivered',async({page})=>{
 const state=await fixture(page,'lost');await compose(page);
 await page.getByRole('button',{name:'Send message',exact:true}).click();
 await expect(page.getByPlaceholder('Send EMAIL...')).toHaveValue('');
 await expect(page.getByRole('status').filter({hasText:/^Queued$/})).toBeVisible();
 expect(state.requests).toHaveLength(1);expect(state.legacyCalls).toBe(0);
});
test('offline retry preserves draft and request UUID; editing cannot create a new intent',async({page})=>{
 const state=await fixture(page,'offline');await compose(page);
 await page.getByRole('button',{name:'Send message',exact:true}).click();
 await expect(page.getByText(/Queue confirmation was lost/)).toBeVisible();
 await expect(page.getByPlaceholder('Send EMAIL...')).toHaveValue('Synthetic queue test');
 await page.getByPlaceholder('Send EMAIL...').fill('Changed draft');
 await page.getByRole('button',{name:'Send message',exact:true}).click();
 await expect(page.getByText(/earlier queue request is unresolved/)).toBeVisible();
 expect(state.requests).toHaveLength(1);
 await page.getByPlaceholder('Send EMAIL...').fill('Synthetic queue test');state.offline=false;
 await page.getByRole('button',{name:'Send message',exact:true}).click();
 await expect(page.getByPlaceholder('Send EMAIL...')).toHaveValue('');
 expect(state.requests).toHaveLength(2);expect(state.requests[0].request_id).toBe(state.requests[1].request_id);expect(state.legacyCalls).toBe(0);
});
test('disabled delivery leaves the draft and never claims queued',async({page})=>{
 const state=await fixture(page,'rejected');await compose(page);
 await page.getByRole('button',{name:'Send message',exact:true}).click();
 await expect(page.getByText('Delivery disabled in this environment')).toBeVisible();
 await expect(page.getByPlaceholder('Send EMAIL...')).toHaveValue('Synthetic queue test');
 expect(state.stored).toBe(false);expect(state.legacyCalls).toBe(0);
});
