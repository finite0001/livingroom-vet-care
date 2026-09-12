import { test, expect, type Page } from '@playwright/test';

const backend = 'http://127.0.0.1:54321';
const staffId = '11111111-1111-4111-8111-111111111111';
const petId = '22222222-2222-4222-8222-222222222222';
const clientId = '33333333-3333-4333-8333-333333333333';
const user = { id: staffId, aud: 'authenticated', role: 'authenticated', email: 'synthetic@example.test', app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' };
const profile = { id: staffId, first_name: 'Synthetic', last_name: 'Staff', full_name: 'Synthetic Staff', role: 'STAFF', is_active: true };
const patient = { id: petId, client_id: clientId, name: 'Synthetic Juniper', species: 'Dog', breed: null, dob: '2020-09-12', birth_date_precision: 'exact', color: 'Black', microchip_id: null, sex: 'female', neuter_status: 'neutered', archived_at: null, deceased_at: null, weight_lbs: null, allergies: null, version: 1 };
const problem = { id: 'problem-1', pet_id: petId, title: 'Historical vaccine reaction', notes: 'Synthetic test history', onset_date: '2025-01-01', status: 'resolved', importance: 'high', created_by: staffId, updated_by: staffId, created_at: '2026-09-12T15:00:00Z', updated_at: '2026-09-12T15:00:00Z', version: 1 };
interface Encounter { id: string; pet_id: string; visit_at: string; visit_type: string; location: string; subjective: string; objective: string; assessment: string; plan: string; status: string; version: number; created_by: string; updated_by: string; signed_by: string | null; signed_at: string | null; created_at: string; updated_at: string }

async function fixture(page: Page, inactive = false) {
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const payload = Buffer.from(JSON.stringify({ sub: staffId, exp: expires, role: 'authenticated', aud: 'authenticated' })).toString('base64url');
  const session = { access_token: `eyJhbGciOiJIUzI1NiJ9.${payload}.synthetic`, refresh_token: 'synthetic', token_type: 'bearer', expires_in: 3600, expires_at: expires, user };
  await page.addInitScript(value => localStorage.setItem('sb-127-auth-token', JSON.stringify(value)), session);
  const state: { row: Encounter | null; conflict: boolean; saves: number; addenda: { id: string; encounter_id: string; content: string; created_by: string; created_at: string }[] } = { row: null, conflict: false, saves: 0, addenda: [] };
  await page.route('**/*', route => new URL(route.request().url()).origin === 'http://127.0.0.1:8080' ? route.continue() : route.abort());
  await page.route(`${backend}/**`, async route => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path === '/auth/v1/token') return route.fulfill({ json: session });
    if (path === '/auth/v1/user') return route.fulfill({ json: user });
    if (path === '/rest/v1/profiles') return route.fulfill({ json: [profile] });
    if (path === '/rest/v1/user_roles') return route.fulfill({ json: [{ role: 'STAFF' }] });
    if (path === '/rest/v1/pets') return route.fulfill({ json: [{ ...patient, archived_at: inactive ? '2026-09-01T00:00:00Z' : null }] });
    if (path === '/rest/v1/clients') return route.fulfill({ json: { id: clientId, full_name: 'Synthetic Household', housecall_address: 'Synthetic address' } });
    if (path === '/rest/v1/patient_problems') return route.fulfill({ json: [problem] });
    if (path === '/rest/v1/clinical_addenda') return route.fulfill({ json: state.addenda });
    if (path === '/rest/v1/clinical_encounters') return route.fulfill({ json: url.searchParams.has('id') ? state.row : state.row ? [state.row] : [] });
    if (path === '/rest/v1/rpc/save_clinical_encounter') {
      state.saves++;
      if (state.conflict) { state.conflict = false; return route.fulfill({ status: 409, json: { code: '40001', message: 'Encounter version conflict' } }); }
      const body = route.request().postDataJSON();
      state.row = { id: body.p_id ?? '44444444-4444-4444-8444-444444444444', pet_id: petId, visit_at: body.p_visit_at, visit_type: body.p_visit_type, location: body.p_location, subjective: body.p_subjective, objective: body.p_objective, assessment: body.p_assessment, plan: body.p_plan, status: 'draft', version: (state.row?.version ?? 0) + 1, created_by: staffId, updated_by: staffId, signed_by: null, signed_at: null, created_at: '2026-09-12T15:00:00Z', updated_at: '2026-09-12T15:00:00Z' };
      return route.fulfill({ json: state.row });
    }
    if (path === '/rest/v1/rpc/sign_clinical_encounter') {
      expect(route.request().postDataJSON().p_expected_version).toBe(state.row!.version);
      state.row = { ...state.row!, status: 'signed', signed_by: staffId, signed_at: '2026-09-12T16:00:00Z', version: state.row!.version + 1 };
      return route.fulfill({ json: state.row });
    }
    if (path === '/rest/v1/rpc/add_clinical_addendum') {
      const row = { id: 'addendum-1', encounter_id: state.row!.id, content: route.request().postDataJSON().p_content, created_by: staffId, created_at: '2026-09-12T17:00:00Z' };
      state.addenda.push(row); return route.fulfill({ json: row });
    }
    return route.fulfill({ json: [] });
  });
  return state;
}

test('patient important history, SOAP conflict retention, signature and append-only addendum', async ({ page }, testInfo) => {
  const state = await fixture(page);
  await page.goto(`/hub/patient/${petId}`);
  await expect(page.getByRole('heading', { name: 'Synthetic Juniper' })).toBeVisible();
  await expect(page.getByLabel('Important patient history')).toContainText('Historical vaccine reaction (resolved)');
  await page.getByRole('button', { name: 'New encounter', exact: true }).click();
  await expect(page.getByLabel('Visit location')).toHaveValue('2619 Spruce Street, Boulder, CO');
  await page.getByLabel('Visit date and time').fill('2026-09-12T09:30');
  await page.getByLabel('Subjective', { exact: true }).fill('First saved note');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Draft saved' })).toBeVisible();
  expect(state.row?.visit_at).toBe('2026-09-12T15:30:00.000Z');
  state.conflict = true;
  await page.getByLabel('Subjective', { exact: true }).fill('Local conflicting draft');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Your draft is preserved' })).toBeVisible();
  await expect(page.getByLabel('Subjective', { exact: true })).toHaveValue('Local conflicting draft');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Reload latest saved record' }).click();
  await expect(page.getByLabel('Subjective', { exact: true })).toHaveValue('First saved note');
  await page.getByLabel('Subjective', { exact: true }).fill('Reviewed note');
  await page.getByLabel('Assessment', { exact: true }).fill('Synthetic assessment for this test.');
  await page.getByLabel('Plan', { exact: true }).fill('Synthetic documented plan.');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await page.getByRole('button', { name: 'Review and sign' }).click();
  await expect(page.getByRole('alertdialog')).toContainText('locked and attributed');
  await page.getByRole('button', { name: 'Sign saved encounter' }).click();
  await expect(page.getByText(/Signed by Synthetic Staff/)).toBeVisible();
  await expect(page.getByLabel('Subjective', { exact: true })).toHaveAttribute('readonly', '');
  await expect(page.getByLabel('Subjective', { exact: true })).toBeEnabled();
  await page.getByLabel('Append a correction or additional information').fill('Additional observation, original note retained.');
  await page.getByRole('button', { name: 'Save addendum' }).click();
  await expect(page.getByText('Additional observation, original note retained.', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Append a correction or additional information')).toHaveValue('');
  expect(state.saves).toBe(3);
  await page.screenshot({ path: testInfo.outputPath('signed-clinical-record.png'), fullPage: true, animations: 'disabled' });
});

test('unsaved SOAP text blocks route navigation until staff explicitly discards it', async ({ page }) => {
  await fixture(page);
  await page.goto(`/hub/patient/${petId}`);
  await page.getByRole('button', { name: 'New encounter', exact: true }).click();
  await page.getByLabel('Subjective', { exact: true }).fill('Do not lose this note');
  await page.getByRole('link', { name: 'Synthetic Household', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toContainText('Leave with unsaved changes?');
  await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await expect(page.getByLabel('Subjective', { exact: true })).toHaveValue('Do not lose this note');
  await page.getByRole('link', { name: 'Synthetic Household', exact: true }).click();
  await page.getByRole('button', { name: 'Discard and leave' }).click();
  await expect(page).toHaveURL(`/hub/client/${clientId}`);
});
