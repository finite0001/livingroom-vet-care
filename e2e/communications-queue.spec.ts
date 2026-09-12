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
  if(path==='/rest/v1/rpc/current_sms_consent')return route.fulfill({json:{client_id:client,opted_in:true,can_message:true,phone_number:'+13035550123',updated_at:null}});
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
test('consent records server version and preserves stale entry without bypassing suppression',async({page})=>{
 await fixture(page,'rejected');
 let version='2026-09-12T12:00:00Z';let conflict=true;let saved:Record<string,unknown>|null=null;
 await page.route(`${backend}/rest/v1/rpc/current_sms_consent`,route=>route.fulfill({json:{id:'consent',client_id:client,phone_number:'+13035550123',opted_in:true,can_message:false,updated_at:version,consent_details:'Existing synthetic record'}}));
 await page.route(`${backend}/rest/v1/rpc/record_sms_consent`,route=>{
  const args=route.request().postDataJSON();
  if(conflict){conflict=false;version='2026-09-12T13:00:00Z';return route.fulfill({status:409,json:{code:'40001',message:'Consent changed; reload before saving'}});}
  saved=args;return route.fulfill({json:{id:'consent',updated_at:'2026-09-12T14:00:00Z'}});
 });
 await page.goto(`/hub/client/${client}`);
 const panel=page.getByRole('region',{name:'SMS consent'});
 await expect(panel).toContainText('SMS is blocked');
 await panel.getByRole('button',{name:'Record consent or withdrawal'}).click();
 await panel.getByLabel('Preference',{exact:true}).selectOption('yes');
 await panel.getByLabel('Consent evidence',{exact:true}).fill('Synthetic written preference, reviewed today');
 await panel.getByRole('button',{name:'Save consent record'}).click();
 await expect(panel.getByRole('alert')).toContainText('Your entry is preserved');
 await expect(panel.getByLabel('Consent evidence',{exact:true})).toHaveValue('Synthetic written preference, reviewed today');
 page.once('dialog',dialog=>dialog.accept());await panel.getByRole('button',{name:'Discard and reload'}).click();
 await panel.getByRole('button',{name:'Record consent or withdrawal'}).click();
 await panel.getByLabel('Preference',{exact:true}).selectOption('yes');
 await panel.getByLabel('Consent evidence',{exact:true}).fill('Synthetic reviewed replacement evidence');
 await panel.getByRole('button',{name:'Save consent record'}).click();
 await expect(panel.getByRole('status')).toContainText('Consent record saved');
 expect(saved).toMatchObject({p_actor_id:staff,p_client_id:client,p_expected_updated_at:'2026-09-12T13:00:00Z',p_opted_in:true});
 await expect(panel).toContainText('SMS is blocked');
});
for (const mobile of [false,true]) test(`older messages preserve position and unread visibility on ${mobile?'mobile':'desktop'}`,async({page})=>{
 if(mobile)await page.setViewportSize({width:390,height:844});
 await fixture(page,'rejected');
 const row=(index:number)=>({id:`55555555-5555-4555-8555-${String(index).padStart(12,'0')}`,conversation_id:conversation,type:'EMAIL',sender_type:'CLIENT',content:`Synthetic history ${index}`,is_internal:false,created_at:new Date(Date.UTC(2026,8,12,12,0,index)).toISOString()});
 const latest=Array.from({length:50},(_,index)=>row(50-index));
 const reads:string[]=[];const cursors:string[]=[];
 await page.route(`${backend}/rest/v1/conversation_read_cursors*`,route=>route.fulfill({json:null}));
 await page.route(`${backend}/rest/v1/conversation_unread_flags*`,route=>route.fulfill({json:{forced:true}}));
 await page.route(`${backend}/rest/v1/rpc/mark_conversation_read`,route=>{const body=route.request().postDataJSON();expect(body.p_actor_id).toBe(staff);reads.push(body.p_message_id);return route.fulfill({json:null});});
 await page.route(`${backend}/rest/v1/messages*`,route=>{
  const url=new URL(route.request().url());
  if(route.request().method()==='HEAD')return route.fulfill({headers:{'content-range':'0-0/1'},body:''});
  if(url.searchParams.get('limit')==='1')return route.fulfill({json:[latest[0]]});
  expect(url.searchParams.get('limit')).toBe('50');
  const cursor=url.searchParams.get('or');if(cursor)cursors.push(cursor);
  return route.fulfill({json:cursor?[row(0)]:latest.slice(0,50)});
 });
 await page.goto(`/hub/conversation/${conversation}`);
 await expect.poll(()=>reads).toContain(row(50).id);
 await expect(page.getByRole('button',{name:'Send message',exact:true})).toBeInViewport();
 const history=page.getByRole('region',{name:'Conversation messages'});
 await history.evaluate(element=>{element.scrollTop=0;});
 await page.getByRole('button',{name:'Load older messages'}).click();
 await expect(history.getByText('Synthetic history 0',{exact:true})).toBeAttached();
 expect(cursors[0]).toContain(row(1).id);
 const remaining=await history.evaluate(element=>element.scrollHeight-element.scrollTop-element.clientHeight);
 expect(remaining).toBeGreaterThan(300);
 latest.unshift(row(51));
 // Polling observes the arrival without simulating a user reading the bottom.
 await expect(history.getByText('Synthetic history 51',{exact:true})).toBeAttached({timeout:22000});
 expect(reads).not.toContain(row(51).id);
 await history.evaluate(element=>{element.scrollTop=element.scrollHeight;});
 await expect.poll(()=>reads).toContain(row(51).id);
});
