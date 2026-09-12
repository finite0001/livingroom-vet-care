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
 const state = { row: null as Record<string,unknown>|null, revisions: [] as Record<string,unknown>[], failNext: false, saves: [] as string[] };
 await page.route('**/*',route=>new URL(route.request().url()).origin==='http://127.0.0.1:8080'?route.continue():route.abort());
 await page.route(`${backend}/**`,async route=>{
  const url=new URL(route.request().url());const path=url.pathname;
  if(path==='/auth/v1/token')return route.fulfill({json:session});
  if(path==='/auth/v1/user')return route.fulfill({json:user});
  if(path==='/rest/v1/profiles')return route.fulfill({json:[profile]});
  if(path==='/rest/v1/user_roles')return route.fulfill({json:[{role:'STAFF'}]});
  if(path==='/rest/v1/pets')return route.fulfill({json:[patient]});
  if(path==='/rest/v1/clients')return route.fulfill({json:{id:clientId,full_name:'Synthetic Household'}});
  if(path==='/rest/v1/patient_lab_orders')return route.fulfill({json:url.searchParams.has('id')?state.row:state.row?[state.row]:[]});
  if(path==='/rest/v1/lab_work_revisions')return route.fulfill({json:state.revisions});
  if(path==='/rest/v1/lab_due_templates')return route.fulfill({json:[{id:'44444444-4444-4444-8444-444444444444',name:'Clinician reviewed synthetic interval',interval_days:30,version:1,active:true}]});
  if(path==='/rest/v1/patient_documents') {
   if(url.searchParams.get('select')!=='id,file_name')return route.fulfill({json:[]});
   expect(url.searchParams.get('pet_id')).toBe(`eq.${petId}`);expect(url.searchParams.get('status')).toBe('eq.ready');
   return route.fulfill({json:[{id:'55555555-5555-4555-8555-555555555555',file_name:'Private synthetic lab.pdf'}]});
  }
  if(path==='/rest/v1/rpc/save_patient_lab_order') {
   const body=route.request().postDataJSON();state.saves.push(body.p_id);expect(body.p_pet_id).toBe(petId);
   if(state.failNext){state.failNext=false;return route.fulfill({status:409,json:{code:'40001',message:'Lab order version conflict'}});}
   state.row={...body.p_values,id:body.p_id,pet_id:petId,version:Number(state.row?.version||0)+1,created_by:staffId,updated_by:staffId,created_at:'2026-01-02T17:00:00Z',updated_at:'2026-01-02T17:00:00Z'};
   state.revisions.push({id:state.revisions.length+1,entity:'order',entity_id:body.p_id,version:state.row.version,snapshot:{...state.row},reason:body.p_correction_reason,actor_id:staffId,recorded_at:'2026-01-02T17:00:00Z'});
   return route.fulfill({json:state.row});
  }
  return route.fulfill({json:[]});
 });return state;
}
test('lab results reopen with private document link, failed edits retained, and explicit correction history',async({page})=>{
 const state=await fixture(page);await page.goto(`/hub/patient/${petId}`);
 await expect(page.getByText(/Antech selected · connection not configured/)).toBeVisible();
 await page.getByRole('button',{name:'New lab order',exact:true}).click();
 await page.getByLabel('Test name',{exact:true}).fill('Synthetic chemistry');
 await page.getByLabel('Lab status',{exact:true}).selectOption('resulted');
 await page.getByLabel('Collection date',{exact:true}).fill('2026-01-01');
 await page.getByLabel('Result date',{exact:true}).fill('2026-01-02');
 await page.getByLabel('Ready private result document (optional)').selectOption('55555555-5555-4555-8555-555555555555');
 await page.getByLabel('Lab observations / notes').fill('Original source observation');
 await page.getByRole('button',{name:'Save lab work',exact:true}).click();
 await expect(page.getByRole('status').filter({hasText:'Lab work saved.'})).toBeVisible();
 await page.reload();await page.getByRole('button',{name:'Open lab order',exact:true}).click();
 await expect(page.getByLabel('Lab observations / notes')).toHaveValue('Original source observation');
 await page.getByLabel('Lab observations / notes').fill('Corrected source observation');
 await expect(page.getByRole('button',{name:'Save lab work',exact:true})).toBeDisabled();
 await page.getByLabel('Lab correction reason').fill('Reviewed original report');state.failNext=true;
 await page.getByRole('button',{name:'Save lab work',exact:true}).click();
 await expect(page.getByRole('alert').filter({hasText:'Your draft is retained'})).toBeVisible();
 await expect(page.getByLabel('Lab observations / notes')).toHaveValue('Corrected source observation');
 await page.getByRole('button',{name:'Save lab work',exact:true}).click();
 await expect(page.getByRole('status').filter({hasText:'Lab work saved.'})).toBeVisible();
 await page.getByText('Lab version history',{exact:true}).click();
 await expect(page.getByText('Reviewed original report',{exact:true})).toBeVisible();
 await expect(page.locator('pre').filter({hasText:'Original source observation'})).toBeVisible();
 expect(new Set(state.saves).size).toBe(1);expect(state.revisions).toHaveLength(2);
});
test('mobile lab due plan uses reviewed template with explicit patient override',async({page})=>{
 await page.setViewportSize({width:390,height:844});const state=await fixture(page);await page.goto(`/hub/patient/${petId}`);
 await page.getByRole('button',{name:'New lab order',exact:true}).click();
 await expect(page.getByLabel('Lab due date',{exact:true})).toHaveValue('');
 await page.getByLabel('Test name',{exact:true}).fill('Reviewed follow-up');
 await page.getByLabel('Reviewed interval template (optional)').selectOption('44444444-4444-4444-8444-444444444444');
 await page.getByLabel('Patient interval in days').fill('14');await page.getByLabel('Interval anchor date').fill('2026-03-07');
 await page.getByLabel('Patient interval override reason').fill('Clinician selected patient-specific follow-up');
 await page.getByRole('button',{name:'Calculate reviewed due date',exact:true}).click();await expect(page.getByLabel('Lab due date',{exact:true})).toHaveValue('2026-03-21');
 await page.getByRole('button',{name:'Save lab work',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'Lab work saved.'})).toBeVisible();
 expect(state.row?.template_version).toBe(1);expect(state.row?.interval_days).toBe(14);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await expect(page.getByText('Reviewed standard lab intervals',{exact:true})).toHaveCount(0);
});
