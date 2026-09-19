import { test, expect, type Page } from "@playwright/test";

const backend = "http://127.0.0.1:54321";
const staffId = "11111111-1111-4111-8111-111111111111";
const petId = "22222222-2222-4222-8222-222222222222";
const clientId = "33333333-3333-4333-8333-333333333333";
const user = {
  id: staffId,
  aud: "authenticated",
  role: "authenticated",
  email: "synthetic@example.test",
  app_metadata: { provider: "email", providers: ["email"] },
  user_metadata: {},
  created_at: "2026-01-01T00:00:00Z",
};
const profile = {
  id: staffId,
  first_name: "Synthetic",
  last_name: "Staff",
  full_name: "Synthetic Staff",
  role: "STAFF",
  is_active: true,
};
const patient = {
  id: petId,
  client_id: clientId,
  name: "Synthetic Juniper",
  species: "Dog",
  breed: null,
  dob: "2020-09-12",
  birth_date_precision: "exact",
  color: "Black",
  microchip_id: null,
  sex: "female",
  neuter_status: "neutered",
  archived_at: null,
  deceased_at: null,
  weight_lbs: null,
  allergies: null,
  version: 1,
};
async function fixture(page: Page) {
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const payload = Buffer.from(
    JSON.stringify({
      sub: staffId,
      exp: expires,
      role: "authenticated",
      aud: "authenticated",
    }),
  ).toString("base64url");
  const session = {
    access_token: `eyJhbGciOiJIUzI1NiJ9.${payload}.synthetic`,
    refresh_token: "synthetic",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: expires,
    user,
  };
  await page.addInitScript(
    (value) => localStorage.setItem("sb-127-auth-token", JSON.stringify(value)),
    session,
  );
 const state={row:null as Record<string,unknown>|null,revisions:[] as Record<string,unknown>[],addenda:[] as Record<string,unknown>[],failNext:false,saves:0};
 await page.route('**/*',route=>new URL(route.request().url()).origin==='http://127.0.0.1:8080'?route.continue():route.abort());
 await page.route(`${backend}/**`,async route=>{
  const url=new URL(route.request().url());const path=url.pathname;
  if(path==='/auth/v1/token')return route.fulfill({json:session});
  if(path==='/auth/v1/user')return route.fulfill({json:user});
  if(path==='/rest/v1/profiles')return route.fulfill({json:[profile]});
  if(path==='/rest/v1/user_roles')return route.fulfill({json:[{role:'STAFF'}]});
  if(path==='/rest/v1/pets')return route.fulfill({json:[patient]});
  if(path==='/rest/v1/clients')return route.fulfill({json:{id:clientId,full_name:'Synthetic Household'}});
  if(path==='/rest/v1/patient_anesthesia_records')return route.fulfill({json:url.searchParams.has('id')?state.row:state.row?[state.row]:[]});
  if(path==='/rest/v1/anesthesia_record_revisions')return route.fulfill({json:state.revisions});
  if(path==='/rest/v1/anesthesia_record_addenda')return route.fulfill({json:state.addenda});
  if(path==='/rest/v1/patient_documents') {
   if(url.searchParams.get('select')!=='id,file_name')return route.fulfill({json:[]});
   expect(url.searchParams.get('pet_id')).toBe(`eq.${petId}`);expect(url.searchParams.get('status')).toBe('eq.ready');
   return route.fulfill({json:[{id:'55555555-5555-4555-8555-555555555555',file_name:'Original synthetic anesthesia.pdf'}]});
  }
  if(path==='/rest/v1/rpc/save_patient_anesthesia_record') {
   const body=route.request().postDataJSON();state.saves++;expect(body.p_pet_id).toBe(petId);
   if(state.failNext){state.failNext=false;state.row={...state.row!,version:Number(state.row!.version)+1,plan:'Remote saved plan'};return route.fulfill({status:409,json:{code:'40001',message:'Anesthesia record version conflict'}});}
   state.row={...body.p_values,id:body.p_id,pet_id:petId,status:'draft',version:Number(state.row?.version||0)+1,created_by:staffId,updated_by:staffId,created_at:'2026-01-02T17:00:00Z',updated_at:'2026-01-02T17:00:00Z',signed_by:null,signed_at:null};
   state.revisions.push({id:state.revisions.length+1,record_id:body.p_id,version:state.row.version,snapshot:{...state.row},actor_id:staffId,recorded_at:'2026-01-02T17:00:00Z'});
   return route.fulfill({json:state.row});
  }
  if(path==='/rest/v1/rpc/sign_patient_anesthesia_record') {
   const body=route.request().postDataJSON();expect(body.p_pet_id).toBe(petId);expect(body.p_expected_version).toBe(state.row?.version);
   state.row={...state.row!,status:'signed',version:Number(state.row!.version)+1,signed_by:staffId,signed_at:'2026-01-02T18:00:00Z'};
   state.revisions.push({id:state.revisions.length+1,record_id:state.row.id,version:state.row.version,snapshot:{...state.row},actor_id:staffId,recorded_at:'2026-01-02T18:00:00Z'});return route.fulfill({json:state.row});
  }
  if(path==='/rest/v1/rpc/add_anesthesia_record_addendum') {
   const body=route.request().postDataJSON();expect(body.p_pet_id).toBe(petId);const row={id:body.p_id,record_id:body.p_record_id,content:body.p_content,actor_id:staffId,recorded_at:'2026-01-02T19:00:00Z'};state.addenda.push(row);return route.fulfill({json:row});
  }
  return route.fulfill({json:[]});
 });return state;
}
async function basicDraft(page:Page){
 await page.getByRole('button',{name:'New anesthesia record',exact:true}).click();
 await page.getByLabel('Anesthesia procedure',{exact:true}).fill('Synthetic dental procedure');
 await page.getByLabel('Procedure team / roles').fill('Synthetic clinician and technician');
 await page.getByLabel('Procedure start (Denver)').fill('2026-01-01T09:00');
 await page.getByLabel('Procedure end (Denver)').fill('2026-01-01T09:30');
 await page.getByLabel('Preanesthetic assessment notes').fill('Documented preanesthetic assessment');
 await page.getByLabel('Anesthesia plan notes').fill('Documented procedure plan');
}
test('anesthesia monitoring reopens, retains concurrent edits, signs and appends corrections',async({page})=>{
 const state=await fixture(page);await page.goto(`/hub/patient/${petId}`);await basicDraft(page);
 await page.getByRole('button',{name:'Add monitoring observation',exact:true}).click();
 await expect(page.getByLabel('Recorded value 1',{exact:true})).toHaveValue('');
 await page.getByLabel('Observation time (Denver) 1',{exact:true}).fill('2026-01-01T09:02');
 await page.getByLabel('Observed parameter 1',{exact:true}).fill('Recorded parameter');
 await page.getByLabel('Recorded value 1',{exact:true}).fill('90');
 await page.getByLabel('Recorded unit 1',{exact:true}).fill('bpm');
 await page.getByRole('button',{name:'Add documentary event',exact:true}).click();
 await page.getByLabel('Event time (Denver) 1',{exact:true}).fill('2026-01-01T09:03');
 await page.getByLabel('Event description 1',{exact:true}).fill('Procedure event documented');
 await page.getByRole('button',{name:'Save anesthesia draft',exact:true}).click();
 await expect(page.getByRole('status').filter({hasText:'Anesthesia draft saved.'})).toBeVisible();
 await page.reload();await page.getByRole('button',{name:'Open anesthesia record',exact:true}).click();
 await expect(page.getByLabel('Recorded value 1',{exact:true})).toHaveValue('90');
 await expect(page.getByLabel('Recorded unit 1',{exact:true})).toHaveValue('bpm');
 await page.getByLabel('Anesthesia plan notes').fill('Local concurrent plan');state.failNext=true;
 await page.getByRole('button',{name:'Save anesthesia draft',exact:true}).click();
 await expect(page.getByRole('alert').filter({hasText:'Your draft is retained'})).toBeVisible();
 await expect(page.getByLabel('Anesthesia plan notes')).toHaveValue('Local concurrent plan');
 page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Reload saved anesthesia record',exact:true}).click();
 await expect(page.getByLabel('Anesthesia plan notes')).toHaveValue('Remote saved plan');
 await page.getByRole('button',{name:'Review and sign anesthesia record',exact:true}).click();
 await page.getByRole('button',{name:'Sign saved anesthesia record',exact:true}).click();
 await expect(page.getByRole('status').filter({hasText:'Anesthesia record signed.'})).toBeVisible();
 await expect(page.getByLabel('Recorded value 1',{exact:true})).toBeDisabled();
 await page.getByLabel('Anesthesia correction / addendum').fill('Reviewed source clarification');
 await page.getByRole('button',{name:'Save anesthesia addendum',exact:true}).click();
 await expect(page.getByText('Reviewed source clarification',{exact:true})).toBeVisible();
 await page.getByText('Anesthesia version history',{exact:true}).click();
 await expect(page.getByText('Documented procedure plan',{exact:true})).toBeVisible();
 expect(state.addenda).toHaveLength(1);
});
test('mobile manual transcription links a private source without claiming automatic import',async({page})=>{
 await page.setViewportSize({width:390,height:844});const state=await fixture(page);await page.goto(`/hub/patient/${petId}`);await basicDraft(page);
 await page.getByLabel('Record source',{exact:true}).selectOption('transcribed_from_document');
 await page.getByLabel('Source / transcription detail').fill('Manually transcribed original paper chart');
 await page.getByLabel('Original anesthesia file (private)').selectOption('55555555-5555-4555-8555-555555555555');
 await page.getByRole('button',{name:'Save anesthesia draft',exact:true}).click();
 await expect(page.getByRole('status').filter({hasText:'Anesthesia draft saved.'})).toBeVisible();
 expect(state.row?.source).toBe('transcribed_from_document');expect(state.row?.original_document_id).toBe('55555555-5555-4555-8555-555555555555');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await expect(page.getByText(/Automatic vendor import is not configured/)).toBeVisible();
});
