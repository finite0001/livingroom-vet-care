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
async function fixture(page: Page, admin=false) {
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
 const productId='55555555-5555-4555-8555-555555555555';
 const template={id:'44444444-4444-4444-8444-444444444444',group_key:'reviewed-group',name:'Reviewed synthetic group',product_ids:[productId],interval_days:30,version:1,active:true,review_note:'Clinical review'};
 const state={row:null as Record<string,unknown>|null,revisions:[] as Record<string,unknown>[],failNext:false,settings:[] as Record<string,unknown>[],saves:[] as string[],jobs:[] as Record<string,unknown>[],links:[] as Record<string,unknown>[],outcomes:[] as Record<string,unknown>[]};
 await page.route('**/*',route=>new URL(route.request().url()).origin==='http://127.0.0.1:8080'?route.continue():route.abort());
 await page.route(`${backend}/**`,async route=>{
  const url=new URL(route.request().url());const path=url.pathname;
  if(path==='/auth/v1/token')return route.fulfill({json:session});if(path==='/auth/v1/user')return route.fulfill({json:user});
  if(path==='/rest/v1/profiles')return route.fulfill({json:[{...profile,role:admin?'ADMIN':'STAFF'}]});
  if(path==='/rest/v1/user_roles')return route.fulfill({json:[{role:admin?'ADMIN':'STAFF'}]});
  if(path==='/rest/v1/pets')return route.fulfill({json:[patient]});
  if(path==='/rest/v1/clients')return route.fulfill({json:{id:clientId,full_name:'Synthetic Household'}});
  if(path==='/rest/v1/vaccine_due_templates')return route.fulfill({json:[template]});
  if(path==='/rest/v1/catalog_products')return route.fulfill({json:[{id:productId,name:'Explicitly mapped vaccine',kind:'vaccine'},{id:'66666666-6666-4666-8666-666666666666',name:'Unmapped similar vaccine',kind:'vaccine'}]});
  if(path==='/rest/v1/patient_vaccine_due_plans')return route.fulfill({json:url.searchParams.has('id')?state.row:state.row?[state.row]:[]});
  if(path==='/rest/v1/care_plan_revisions')return route.fulfill({json:state.revisions});
  if(path==='/rest/v1/care_reminder_jobs')return route.fulfill({json:state.jobs});
  if(path==='/rest/v1/reminder_outbox_links')return route.fulfill({json:state.links});
  if(path==='/rest/v1/communication_outbox')return route.fulfill({json:state.outcomes});
  if(path==='/rest/v1/care_message_templates')return route.fulfill({json:state.settings});
  if(path==='/rest/v1/rpc/save_patient_vaccine_due_plan'){
   const b=route.request().postDataJSON();expect(b.p_pet_id).toBe(petId);state.saves.push(b.p_id);
   if(state.failNext){state.failNext=false;state.row={...state.row!,version:Number(state.row!.version)+1,review_note:'Remote reviewed correction'};return route.fulfill({status:409,json:{code:'40001',message:'Due plan version conflict'}});}
   state.row={id:b.p_id,pet_id:petId,version:Number(state.row?.version||0)+1,template_id:b.p_template_id,template_version:b.p_template_version,template_snapshot:template,group_key:template.group_key,product_id:b.p_product_id,treatment_id:b.p_treatment_id,last_administered_on:b.p_last_administered_on,anchor_source:b.p_anchor_source,interval_days:b.p_interval_days,proposed_due_on:'2026-01-31',current_due_on:b.p_current_due_on,status:b.p_status,reminders_enabled:b.p_reminders_enabled,override_reason:b.p_override_reason,review_note:b.p_review_note,created_by:staffId,updated_by:staffId,created_at:'2026-01-02T17:00:00Z',updated_at:'2026-01-02T17:00:00Z'};
   state.revisions.push({id:state.revisions.length+1,entity:'vaccine_plan',entity_id:b.p_id,version:state.row.version,snapshot:{...state.row},actor_id:staffId,recorded_at:'2026-01-02T17:00:00Z'});return route.fulfill({json:state.row});
  }
  if(path==='/rest/v1/rpc/save_care_message_template'){
   const b=route.request().postDataJSON();const row={id:b.p_id,name:b.p_name,channel:b.p_channel,days_before:b.p_days_before,body:b.p_body,active:b.p_active,version:1,review_note:b.p_review_note};state.settings.push(row);return route.fulfill({json:row});
  }
  return route.fulfill({json:[]});
 });return state;
}
test('reviewed patient vaccine plan only offers explicitly mapped products, preserves overrides and stale drafts',async({page})=>{
 const state=await fixture(page);await page.goto(`/hub/patient/${petId}`);
 await page.getByRole('button',{name:'New vaccine due plan',exact:true}).click();
 await expect(page.getByLabel('Reviewed patient next due date',{exact:true})).toHaveValue('');
 await page.getByLabel('Reviewed vaccine group template').selectOption('44444444-4444-4444-8444-444444444444');
 await expect(page.getByLabel('Explicitly mapped vaccine product').locator('option')).toHaveCount(2);
 await expect(page.getByLabel('Explicitly mapped vaccine product').getByText('Unmapped similar vaccine')).toHaveCount(0);
 await page.getByLabel('Explicitly mapped vaccine product').selectOption('55555555-5555-4555-8555-555555555555');
 await page.getByLabel('Last administered date (Denver)').fill('2026-01-01');
 await page.getByLabel('Anchor provenance / source').fill('Reviewed original historical vaccine record');
 await page.getByLabel('Patient interval in days').fill('14');
 await page.getByRole('button',{name:'Calculate proposed patient due date',exact:true}).click();
 await expect(page.getByLabel('Reviewed patient next due date',{exact:true})).toHaveValue('2026-01-15');
 await page.getByLabel('Patient interval / due override reason').fill('Clinician selected patient-specific interval');
 await page.getByLabel('Plan status',{exact:true}).selectOption('current');
 await page.getByLabel('Enable reminder eligibility for this plan').check();
 await page.getByLabel('Plan review / correction rationale').fill('Reviewed patient plan');
 await page.getByRole('link',{name:'Synthetic Household',exact:true}).click();
 await expect(page.getByRole('alertdialog')).toHaveCount(1);
 await page.getByRole('button',{name:'Keep editing',exact:true}).click();
 await expect(page.getByLabel('Reviewed patient next due date',{exact:true})).toHaveValue('2026-01-15');
 await page.getByRole('button',{name:'Save vaccine due plan',exact:true}).click();
 await expect(page.getByRole('status').filter({hasText:'Reviewed vaccine due plan saved.'})).toBeVisible();
 await page.reload();await page.getByRole('button',{name:'Open vaccine due plan',exact:true}).click();
 await expect(page.getByLabel('Reviewed patient next due date',{exact:true})).toHaveValue('2026-01-15');
 await expect(page.getByText(/Saved standard-template proposal: 2026-01-31/)).toBeVisible();
 await page.getByLabel('Plan review / correction rationale').fill('Local correction');state.failNext=true;
 await page.getByRole('button',{name:'Save vaccine due plan',exact:true}).click();
 await expect(page.getByRole('alert').filter({hasText:'Your plan draft is retained'})).toBeVisible();
 await expect(page.getByLabel('Plan review / correction rationale')).toHaveValue('Local correction');
 page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Reload vaccine due plan',exact:true}).click();
 await expect(page.getByLabel('Plan review / correction rationale')).toHaveValue('Remote reviewed correction');
 expect(new Set(state.saves).size).toBe(1);
});
test('mobile administrator approves wording without enabling provider dispatch',async({page})=>{
 await page.setViewportSize({width:390,height:844});const state=await fixture(page,true);await page.goto(`/hub/patient/${petId}`);
 await page.getByRole('button',{name:'More',exact:true}).click();
 await page.getByRole('button',{name:'Care reminders',exact:true}).click();
 await expect(page).toHaveURL(/\/hub\/tools\/care-reminders$/);
 await page.getByRole('button',{name:'New reviewed reminder wording',exact:true}).click();
 await page.getByLabel('Reviewed setting name').fill('Synthetic follow-up wording');
 await expect(page.getByLabel('Reviewed days before due date')).toHaveValue('');
 await page.getByLabel('Reviewed days before due date').fill('7');
 await page.getByLabel('Approved plain-text reminder wording').fill('{{patient_name}}: {{care_name}} is due {{due_date}}.');
 await page.getByLabel('Clinical reviewer / approval rationale').fill('Reviewed by synthetic practice administrator');
 await page.getByRole('button',{name:'Save reviewed care settings',exact:true}).click();
 await expect(page.getByRole('status').filter({hasText:'Reviewed care settings saved.'})).toBeVisible();
 expect(state.settings).toHaveLength(1);expect(state.settings[0].days_before).toBe(7);
 await expect(page.getByText(/provider acceptance is distinct from delivery/)).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});

test('prepared job displays provider acceptance separately from delivery',async({page})=>{
 const state=await fixture(page);
 state.jobs=[{id:'77777777-7777-4777-8777-777777777777',source_kind:'lab',channel:'email',status:'pending',scheduled_on:'2026-01-01',due_on:'2026-01-02',rendered_body:'Synthetic approved reminder'}];
 state.links=[{job_kind:'care',job_id:'77777777-7777-4777-8777-777777777777',outbox_id:'88888888-8888-4888-8888-888888888888',state:'queued'}];
 state.outcomes=[{id:'88888888-8888-4888-8888-888888888888',state:'accepted'}];
 await page.goto('/hub/tools/care-reminders');
 await expect(page.getByText('Provider accepted; delivery unconfirmed',{exact:true})).toBeVisible();
 await expect(page.getByText('Delivered',{exact:true})).toHaveCount(0);
});
