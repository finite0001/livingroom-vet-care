import { test, expect, type Page, type Route } from '@playwright/test';

const backend = 'http://127.0.0.1:54321';
const currentId = '11111111-1111-4111-8111-111111111111';
const linkedId = '22222222-2222-4222-8222-222222222222';
function user(id: string) { return { id, email: id === currentId ? 'current-staff@example.test' : 'linked-staff@example.test', aud: 'authenticated', role: 'authenticated', app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' }; }
function session(id: string, lifetime = 3600) {
  const exp = Math.floor(Date.now() / 1000) + lifetime;
  const payload = Buffer.from(JSON.stringify({ sub: id, exp, role: 'authenticated', aud: 'authenticated' })).toString('base64url');
  return { access_token: `eyJhbGciOiJIUzI1NiJ9.${payload}.c3ludGhldGlj`, refresh_token: `synthetic_refresh_${id}`, token_type: 'bearer', expires_in: 3600, expires_at: exp, user: user(id) };
}
test('a link cannot silently replace the current staff session', async ({ page }) => {
  const existing = session(currentId), linked = session(linkedId);
  await page.addInitScript(value => localStorage.setItem('sb-127-auth-token', JSON.stringify(value)), existing);
  await page.route('**/*', route => new URL(route.request().url()).origin === new URL(test.info().project.use.baseURL!).origin ? route.continue() : route.abort());
  await page.route(`${backend}/**`, route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/auth/v1/user') return route.fulfill({ json: user(linkedId) });
    if (url.pathname === '/rest/v1/profiles') return route.fulfill({ json: [{ id: currentId, first_name: 'Current', last_name: 'Staff', is_active: true }] });
    if (url.pathname === '/rest/v1/user_roles') return route.fulfill({ json: [{ role: 'STAFF' }] });
    return route.fulfill({ json: [] });
  });
  const hash = new URLSearchParams({ access_token: linked.access_token, refresh_token: linked.refresh_token, expires_in: '3600', token_type: 'bearer', type: 'recovery' });
  await page.goto(`/hub/reset-password#${hash}`);
  await expect(page.getByRole('heading', { name: 'Set your password' })).toBeVisible();
  await expect(page.getByLabel('New password', { exact: true })).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('sb-127-auth-token')!).user.id);
  expect(saved).toBe(currentId);
});

async function fixture(page: Page, linked = session(linkedId), options: { pauseUser?: boolean; pauseRefresh?: boolean; failWrite?: boolean } = {}) {
  const existing = session(currentId);
  await page.addInitScript(value => localStorage.setItem('sb-127-auth-token', JSON.stringify(value)), existing);
  const writes: { actor: string | undefined; password: string }[] = [];
  let held: Route | null = null;
  await page.route('**/*', route => new URL(route.request().url()).origin === new URL(test.info().project.use.baseURL!).origin ? route.continue() : route.abort());
  await page.route(`${backend}/**`, async route => {
    const url = new URL(route.request().url());
    const token = route.request().headers().authorization;
    const actor = token === `Bearer ${linked.access_token}` ? linkedId : currentId;
    if (url.pathname === '/auth/v1/token') {
      if (options.pauseRefresh) { held = route; return; }
      return route.fulfill({ json: session(linkedId) });
    }
    if (url.pathname === '/auth/v1/user' && route.request().method() === 'PUT') {
      writes.push({ actor: token, password: route.request().postDataJSON().password });
      return route.fulfill({ status: options.failWrite ? 422 : 200, json: options.failWrite ? { message: 'Provider private detail should not appear' } : user(linkedId) });
    }
    if (url.pathname === '/auth/v1/user') {
      if (options.pauseUser) { held = route; return; }
      return route.fulfill({ json: user(actor) });
    }
    if (url.pathname === '/rest/v1/profiles') return route.fulfill({ json: [{ id: actor, first_name: 'Synthetic', last_name: 'Staff', is_active: true }] });
    if (url.pathname === '/rest/v1/user_roles') return route.fulfill({ json: [{ role: 'STAFF' }] });
    return route.fulfill({ json: [] });
  });
  return {
    linked, writes,
    waitHeld: () => expect.poll(() => Boolean(held)).toBe(true),
    release: async () => { const route = held!; held = null; options.pauseUser = false; options.pauseRefresh = false; await route.fulfill({ json: route.request().url().includes('/token') ? session(linkedId) : user(linkedId) }); },
    saved: () => page.evaluate(() => JSON.parse(localStorage.getItem('sb-127-auth-token')!).user.id),
  };
}
function link(value = session(linkedId), purpose = 'recovery', pathname = '/hub/reset-password') {
  return `${pathname}#${new URLSearchParams({ access_token: value.access_token, refresh_token: value.refresh_token, expires_in: '3600', token_type: 'bearer', type: purpose })}`;
}
for (const width of [390, 1440]) for (const purpose of ['recovery', 'invite']) {
  test(`${purpose} saves only the displayed linked account at ${width}px and preserves staff storage`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const f = await fixture(page);
    await page.goto(link(f.linked, purpose));
    await expect(page.getByText('linked-staff@example.test', { exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/hub\/reset-password$/);
    expect(await f.saved()).toBe(currentId);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByLabel('New password', { exact: true }).fill('synthetic-new-password');
    await page.keyboard.press('Tab'); await page.keyboard.type('synthetic-new-password');
    await page.keyboard.press('Tab'); await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Password saved' })).toBeVisible();
    expect(f.writes).toEqual([{ actor: `Bearer ${f.linked.access_token}`, password: 'synthetic-new-password' }]);
    expect(await f.saved()).toBe(currentId);
    await page.screenshot({ path: testInfo.outputPath(`password-setup-${purpose}-${width}.png`), fullPage: true });
    await page.getByRole('link', { name: 'Return to sign in' }).click();
    await expect(page).toHaveURL(/\/hub\/login$/);
  });
}
test('unsupported callback on login never establishes a staff session', async ({ page }) => {
  const f = await fixture(page); await page.goto(link(f.linked, 'magiclink', '/hub/login'));
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/hub\/login$/); expect(await f.saved()).toBe(currentId); expect(f.writes).toEqual([]);
});
test('cancelled delayed validation never opens the form or changes the staff session', async ({ page }) => {
  const f = await fixture(page, session(linkedId), { pauseUser: true }); await page.goto(link(f.linked)); await f.waitHeld();
  await page.getByRole('link', { name: 'Back to sign in' }).click(); await f.release();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  expect(await f.saved()).toBe(currentId); expect(f.writes).toEqual([]);
});
test('cancelling while the isolated credential refreshes prevents the delayed password PUT', async ({ page }) => {
  const f = await fixture(page, session(linkedId, 45), { pauseRefresh: true }); await page.goto(link(f.linked));
  await expect(page.getByText('linked-staff@example.test', { exact: true })).toBeVisible();
  await page.getByLabel('New password', { exact: true }).fill('synthetic-new-password');
  await page.getByLabel('Confirm password', { exact: true }).fill('synthetic-new-password');
  await page.getByRole('button', { name: 'Save password' }).click(); await f.waitHeld();
  await page.getByRole('link', { name: 'Back to sign in' }).click(); await f.release();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  await page.waitForTimeout(100); expect(f.writes).toEqual([]); expect(await f.saved()).toBe(currentId);
});
test('provider rejection does not expose its payload or change the shared staff session', async ({ page }) => {
  const options = { failWrite: true };
  const f = await fixture(page, session(linkedId), options); await page.goto(link(f.linked));
  await page.getByLabel('New password', { exact: true }).fill('synthetic-new-password');
  await page.getByLabel('Confirm password', { exact: true }).fill('synthetic-new-password');
  await page.getByRole('button', { name: 'Save password' }).click();
  await expect(page.getByRole('alert')).toContainText('Password could not be saved');
  await expect(page.getByText('Provider private detail should not appear')).toHaveCount(0);
  options.failWrite = false;
  await page.getByLabel('New password', { exact: true }).fill('different-synthetic-password');
  await page.getByLabel('Confirm password', { exact: true }).fill('different-synthetic-password');
  await page.getByRole('button', { name: 'Save password' }).click();
  await expect(page.getByRole('heading', { name: 'Password saved' })).toBeVisible();
  expect(f.writes).toHaveLength(2);
  expect(await f.saved()).toBe(currentId);
});
