import { test, expect, type Page, type Request } from '@playwright/test';
import { createHash } from 'node:crypto';

// These tests use the real isolated route, page and strict adapter with mocked HTTP.
// They do not claim to establish database authorization or concurrency guarantees.
const grant = 'a5510000-0000-4000-8000-000000000001';
const estimate = 'a5510000-0000-4000-8000-000000000002';
const publication = 'a5510000-0000-4000-8000-000000000003';
const preparation = 'a5510000-0000-4000-8000-000000000004';
const client = 'a5510000-0000-4000-8000-000000000005';
const pet = 'a5510000-0000-4000-8000-000000000006';
const token = 'e1.' + Buffer.alloc(32, 1).toString('base64url');
const endpoint = 'http://127.0.0.1:54321/functions/v1/estimate-decision';
const pendingKey = `lrv-estimate-decision:v1:${grant}`;
const filename = `estimate-${estimate}-draft-1-publication-${preparation}.html`;
const html = Buffer.from(`<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"></head><body><h1>Exact care proposal</h1><p>Examination: $125.00</p><script>parent.document.title='unsafe execution'</script><img src="https://example.test/estimate-leak"></body></html>`);
const artifactHash = createHash('sha256').update(html).digest('hex');
const binding = { target: { estimate_id: estimate, client_id: client, pet_id: pet }, publication_id: publication, content_hash: 'b'.repeat(64), artifact_hash: artifactHash };
const head = { event_id: publication, version: 1, record_hash: 'c'.repeat(64) };
const review = {
  version: 1, grant_id: grant, binding, publication_head: head, publication_status: 'open', decision: null,
  review: { practice: { name: 'The Living Room Veterinary Care', address: '2619 Spruce Street, Boulder, CO', domain: 'thelivingroom.vet' },
    household_name: 'Synthetic household', patient: { name: 'Juniper', species: 'Dog', breed: null }, title: 'Juniper’s care proposal', total_cents: '12500', currency: 'usd',
    accept_by: '2099-12-31', expires_at: '2100-01-01T07:00:00.000000Z', acknowledgment_version: 1, scope: 'entire_exact_revision', not_clinical_consent: true, not_payment: true },
  artifact: { filename, mime_type: 'text/html; charset=utf-8', byte_length: html.length, sha256: artifactHash, renderer_version: 1 },
  content_base64: html.toString('base64'),
};
interface DecisionRequest {
  binding: typeof binding; grant_id: string; expected_publication_head: typeof head;
  choice: 'accept' | 'decline'; signer_name: string; signer_relationship: string; comment: string | null;
  acknowledgment_version: number; attest_document_review: boolean; attest_authority: boolean; attest_choice: boolean;
}
function receipt(id: string, request: DecisionRequest) {
  const created_at = '2026-09-16T15:00:00.123456Z';
  return { version: 1, id, grant_id: grant, request, request_hash: 'd'.repeat(64), created_at,
    result: { version: 1, id, sequence: 1, binding, choice: request.choice, signer_name: request.signer_name,
      signer_relationship: request.signer_relationship, comment: request.comment, acknowledgment_version: 1,
      attribution: 'link_holder', recorded_at: created_at, record_hash: 'e'.repeat(64) } };
}
async function pending(page: Page) { return page.evaluate((key) => sessionStorage.getItem(key), pendingKey); }
async function fixture(page: Page) {
  const state = {
    calls: [] as Request[], requests: [] as string[], external: [] as string[],
    denied: false, corrupted: false, recordMode: 'success' as 'success' | 'lost' | 'commit-lost',
    saved: null as ReturnType<typeof receipt> | null, existingDecision: null as ReturnType<typeof receipt>['result'] | null, beforeWrite: null as string | null,
    holdAction: null as string | null, release: null as (() => void) | null,
  };
  await page.addInitScript(() => {
    const original = Storage.prototype.getItem;
    const reads: string[] = [];
    Object.defineProperty(window, '__estimateStorageReads', { value: reads });
    Storage.prototype.getItem = function (key: string) { reads.push(key); return original.call(this, key); };
  });
  page.on('request', (request) => state.requests.push(request.url()));
  await page.route('**/*', (route) => {
    if (new URL(route.request().url()).origin === 'http://127.0.0.1:8080') return route.continue();
    state.external.push(route.request().url()); return route.abort();
  });
  await page.route(endpoint, async (route) => {
    const request = route.request(); state.calls.push(request);
    const body = request.postDataJSON();
    if (body.action === 'record') state.beforeWrite = await pending(page);
    if (state.holdAction === body.action) await new Promise<void>((resolve) => { state.release = resolve; });
    if (state.denied) return route.fulfill({ status: 404, json: { error: 'Estimate access unavailable' } }).catch(() => {});
    if (body.action === 'read') return route.fulfill({ json: { ...review, decision: state.existingDecision, ...(state.corrupted ? { content_base64: Buffer.from('changed').toString('base64') } : {}) } }).catch(() => {});
    if (body.action === 'record') {
      if (state.recordMode !== 'lost') state.saved = receipt(body.id, body.request);
      if (state.recordMode !== 'success') return route.abort('failed').catch(() => {});
      return route.fulfill({ json: state.saved }).catch(() => {});
    }
    if (body.action === 'recover') return route.fulfill({ json: state.saved
      ? { version: 1, status: 'recorded', receipt: state.saved }
      : { version: 1, status: 'unrecorded' } }).catch(() => {});
    if (body.action === 'close') return route.fulfill({ json: state.saved
      ? { version: 1, status: 'recorded', receipt: state.saved }
      : { version: 1, status: 'closed_unrecorded', closure: { version: 1, id: body.id, grant_id: grant, request: body.request,
        request_hash: 'd'.repeat(64), closed_at: '2026-09-16T15:01:00.123456Z', record_hash: 'f'.repeat(64), closed_by: 'link_holder' } } }).catch(() => {});
    throw new Error('Unexpected synthetic estimate action');
  });
  return state;
}
async function open(page: Page) {
  await page.goto(`/estimate/${grant}#${token}`);
  await page.getByRole('button', { name: 'Open estimate', exact: true }).click();
  await expect(page.frameLocator('iframe').getByRole('heading', { name: 'Exact care proposal' })).toBeVisible();
}
async function choose(page: Page, choice: 'accept' | 'decline' = 'accept') {
  await page.getByLabel('Your name', { exact: true }).fill('Synthetic Owner');
  await page.getByRole('combobox', { name: 'Your relationship', exact: true }).selectOption('owner');
  await page.getByRole('radio', { name: choice === 'accept' ? 'Accept this estimate' : 'Decline this estimate', exact: true }).check();
  await page.getByRole('checkbox', { name: 'I reviewed the exact estimate document and its terms.', exact: true }).check();
  await page.getByRole('checkbox', { name: 'I am the owner or authorized to decide for this patient.', exact: true }).check();
  await page.getByRole('checkbox', { name: 'I confirm my selected decision for the entire estimate.', exact: true }).check();
}
async function submit(page: Page, choice: 'accept' | 'decline' = 'accept') {
  await choose(page, choice);
  await page.getByRole('button', { name: choice === 'accept' ? 'Confirm acceptance' : 'Confirm decline', exact: true }).click();
}
async function reopenOriginal(page: Page) {
  // Force a document navigation. Merely changing the hash retires current access.
  await page.goto('/estimate');
  await page.goto(`/estimate/${grant}#${token}`);
}

test('public estimate isolates the token and requires explicit exact document review', async ({ page }) => {
  const state = await fixture(page);
  await page.goto(`/estimate/${grant}#${token}`);
  await expect(page.getByRole('button', { name: 'Open estimate', exact: true })).toBeVisible();
  expect(page.url()).toBe(`http://127.0.0.1:8080/estimate/${grant}`);
  expect(state.calls).toHaveLength(0);
  await page.getByRole('button', { name: 'Open estimate', exact: true }).click();
  await expect(page.frameLocator('iframe').getByRole('heading', { name: 'Exact care proposal' })).toBeVisible();
  expect(await page.locator('iframe').getAttribute('sandbox')).toBe('');
  expect(await page.locator('iframe').getAttribute('referrerpolicy')).toBe('no-referrer');
  expect(await page.title()).not.toBe('unsafe execution');
  expect(state.external.some((url) => url.includes('estimate-leak'))).toBe(false);
  expect(state.calls[0].postDataJSON()).toEqual({ action: 'read', grant_id: grant });
  const headers = state.calls[0].headers();
  expect(headers['x-estimate-capability']).toBe(token);
  for (const key of ['authorization', 'cookie', 'referer']) expect(headers[key]).toBeUndefined();
  expect(state.calls[0].postData()).not.toContain(token);
  expect(state.requests.some((url) => /App\.tsx|AuthContext|\/auth\/|fonts\.google/.test(url))).toBe(false);
  expect(state.requests.some((url) => url.includes(token))).toBe(false);
  expect(await page.evaluate(() => [JSON.stringify(localStorage), JSON.stringify(sessionStorage)])).toEqual(['{}', '{}']);
  expect(await page.evaluate(() => (window as unknown as { __estimateStorageReads: string[] }).__estimateStorageReads.some((key) => /auth-token|supabase|sb-/.test(key)))).toBe(false);
  await expect(page.getByRole('radio', { name: 'Accept this estimate', exact: true })).not.toBeChecked();
  await expect(page.getByRole('radio', { name: 'Decline this estimate', exact: true })).not.toBeChecked();
  const downloading = page.waitForEvent('download');
  await page.getByText('Download exact estimate', { exact: true }).click();
  const download = await downloading; expect(download.suggestedFilename()).toBe(filename);
  const chunks: Buffer[] = []; for await (const chunk of (await download.createReadStream())!) chunks.push(chunk);
  expect(Buffer.concat(chunks)).toEqual(html);
});

for (const path of ['/estimate', '/estimate/not-a-grant', `/estimate/${grant}/extra`, `/estimate/${grant}?token=${token}`, `/estimate/${grant}%2Fextra`]) {
  test(`invalid estimate path stays isolated: ${path.split('?')[0]}`, async ({ page }) => {
    const state = await fixture(page); await page.goto(`${path}#${token}`);
    await expect(page.getByRole('heading', { name: 'Your estimate', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open estimate', exact: true })).toHaveCount(0);
    await expect.poll(() => new URL(page.url()).hash + new URL(page.url()).search).toBe('');
    expect(state.calls).toHaveLength(0);
    expect(state.requests.some((url) => /App\.tsx|AuthContext|\/auth\/|fonts\.google/.test(url))).toBe(false);
  });
}

for (const choice of ['accept', 'decline'] as const) {
  test(`explicit ${choice} persists original request before submission and clears only exact receipt`, async ({ page }) => {
    const state = await fixture(page); await open(page); await submit(page, choice);
    await expect(page.getByRole('heading', { name: 'Decision recorded', exact: true })).toBeVisible();
    const call = state.calls.find((request) => request.postDataJSON().action === 'record')!;
    const body = call.postDataJSON(); const retained = JSON.parse(state.beforeWrite!);
    expect(retained.id).toBe(body.id); expect(retained.request).toEqual(body.request);
    expect(retained.grant_id).toBe(grant); expect(retained.publication_id).toBe(publication);
    expect(body.request.choice).toBe(choice); expect(body.request.binding).toEqual(binding);
    expect(state.beforeWrite).not.toContain(token);
    expect(state.beforeWrite).not.toContain('content_base64');
    expect(await pending(page)).toBeNull();
    expect(state.calls.map((request) => request.postDataJSON().action)).toEqual(['read', 'record']);
  });
}

test('lost committed response survives reload without token; original-link recovery uses the same identity', async ({ page }) => {
  const state = await fixture(page); state.recordMode = 'commit-lost'; await open(page); await submit(page);
  await expect(page.getByRole('button', { name: 'Recover original decision', exact: true })).toBeVisible();
  const original = await pending(page); expect(original).not.toBeNull();
  const callsBeforeReload = state.calls.length; await page.reload();
  await expect(page.getByRole('button', { name: 'Open estimate', exact: true })).toHaveCount(0);
  expect(await pending(page)).toBe(original); expect(state.calls).toHaveLength(callsBeforeReload);
  await reopenOriginal(page);
  await page.getByRole('button', { name: 'Open estimate', exact: true }).click();
  await page.getByRole('button', { name: 'Recover original decision', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Decision recorded', exact: true })).toBeVisible();
  const recovery = state.calls.find((request) => request.postDataJSON().action === 'recover')!.postDataJSON();
  expect(recovery.id).toBe(JSON.parse(original!).id); expect(recovery.request).toEqual(JSON.parse(original!).request);
  expect(await pending(page)).toBeNull();
});

test('unavailable recovery keeps uncertain intent and cannot enable an opposite new decision', async ({ page }) => {
  const state = await fixture(page); state.recordMode = 'lost'; await open(page); await submit(page);
  await expect(page.getByRole('button', { name: 'Recover original decision', exact: true })).toBeVisible();
  const original = await pending(page); state.denied = true;
  await page.getByRole('button', { name: 'Recover original decision', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  expect(await pending(page)).toBe(original);
  await expect(page.getByRole('button', { name: 'Confirm decline', exact: true })).toHaveCount(0);
  expect(state.calls.filter((request) => request.postDataJSON().action === 'record')).toHaveLength(1);
});

test('unrecorded recovery is nonterminal; durable close clears pending and resets review', async ({ page }) => {
  const state = await fixture(page); state.recordMode = 'lost'; await open(page); await submit(page);
  await expect(page.getByRole('button', { name: 'Recover original decision', exact: true })).toBeVisible();
  const original = await pending(page);
  await page.getByRole('button', { name: 'Recover original decision', exact: true }).click();
  await expect.poll(() => state.calls.filter((r) => r.postDataJSON().action === 'recover').length).toBe(1);
  expect(await pending(page)).toBe(original);
  await page.getByRole('button', { name: 'Resolve or close original request', exact: true }).click();
  await expect(page.getByText('The original request was closed without recording a decision. Open the estimate again before starting another request.', { exact: true })).toBeVisible();
  expect(await pending(page)).toBeNull();
  await expect(page.locator('iframe')).toHaveCount(0);
  await page.getByRole('button', { name: 'Open estimate', exact: true }).click();
  await expect(page.frameLocator('iframe').getByRole('heading', { name: 'Exact care proposal' })).toBeVisible();
  for (const checkbox of await page.getByRole('checkbox').all()) await expect(checkbox).not.toBeChecked();
  expect(state.calls.find((r) => r.postDataJSON().action === 'close')!.postDataJSON().id).toBe(JSON.parse(original!).id);
});

test('storage failure prevents a write', async ({ page }) => {
  const state = await fixture(page);
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key.startsWith('lrv-estimate-decision:')) throw new DOMException('Synthetic blocked storage', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  await open(page); await submit(page);
  await expect(page.getByRole('alert')).toBeVisible();
  expect(state.calls.filter((r) => r.postDataJSON().action === 'record')).toHaveLength(0);
});

for (const event of ['hashchange', 'pagehide'] as const) {
  test(`${event} retires in-flight access and a late response cannot restore private details`, async ({ page }) => {
    const state = await fixture(page); state.holdAction = 'read';
    await page.goto(`/estimate/${grant}#${token}`);
    await page.getByRole('button', { name: 'Open estimate', exact: true }).click();
    await expect.poll(() => Boolean(state.release)).toBe(true);
    if (event === 'hashchange') await page.evaluate(() => { location.hash = 'e1.' + 'A'.repeat(43); });
    else await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
    state.release!();
    await expect(page.locator('iframe')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Open estimate', exact: true })).toHaveCount(0);
    expect(state.calls).toHaveLength(1);
    expect(await pending(page)).toBeNull();
  });
}

test('corrupt artifact is rejected before review; mobile layout and keyboard review remain usable', async ({ page }, testInfo) => {
  const state = await fixture(page); state.corrupted = true;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/estimate/${grant}#${token}`);
  const opening = page.getByRole('button', { name: 'Open estimate', exact: true });
  await opening.focus(); await expect(opening).toBeFocused(); await page.keyboard.press('Enter');
  await expect(page.getByRole('alert')).toBeVisible(); await expect(page.locator('iframe')).toHaveCount(0);
  expect(state.calls.filter((r) => r.postDataJSON().action === 'record')).toHaveLength(0);
  state.corrupted = false; await reopenOriginal(page);
  await page.getByRole('button', { name: 'Open estimate', exact: true }).click();
  await expect(page.frameLocator('iframe').getByRole('heading', { name: 'Exact care proposal' })).toBeVisible();
  await page.getByLabel('Your name', { exact: true }).focus(); await expect(page.getByLabel('Your name', { exact: true })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('estimate-decision-mobile.png'), fullPage: true });
});

test('corrupt saved intent blocks new submission without erasing the recovery record', async ({ page }) => {
  const state = await fixture(page);
  await page.addInitScript(({ key }) => sessionStorage.setItem(key, '{"corrupt":true}'), { key: pendingKey });
  await page.goto(`/estimate/${grant}#${token}`);
  await page.getByRole('button', { name: 'Open estimate', exact: true }).click();
  await expect(page.getByText('This tab’s saved request could not be read. Do not clear its storage or submit another decision. Contact the practice for reconciliation.', { exact: true })).toBeVisible();
  expect(await pending(page)).toBe('{"corrupt":true}');
  expect(state.calls).toHaveLength(0);
  await expect(page.getByRole('button', { name: 'Open estimate', exact: true })).toBeDisabled();
  await expect(page.getByRole('form', { name: 'Your estimate decision' })).toHaveCount(0);
});

test('retiring an in-flight decision preserves exact pending intent despite a late committed response', async ({ page }) => {
  const state = await fixture(page); state.holdAction = 'record'; await open(page); await submit(page);
  await expect.poll(() => Boolean(state.release)).toBe(true);
  const original = await pending(page); expect(original).not.toBeNull();
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
  state.release!();
  await expect(page.getByRole('heading', { name: 'Open the original link from the practice', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Decision recorded', exact: true })).toHaveCount(0);
  await expect(page.locator('iframe')).toHaveCount(0);
  expect(await pending(page)).toBe(original);
});


test('a denied refresh clears a previously displayed recorded status', async ({ page }) => {
  const state = await fixture(page);
  state.existingDecision = receipt('a5510000-0000-4000-8000-000000000007', {
    binding, grant_id: grant, expected_publication_head: head, choice: 'accept', signer_name: 'Synthetic Owner',
    signer_relationship: 'owner', comment: null, acknowledgment_version: 1,
    attest_document_review: true, attest_authority: true, attest_choice: true,
  }).result;
  await open(page);
  await expect(page.getByRole('heading', { name: 'Decision recorded', exact: true })).toBeVisible();
  state.denied = true;
  await page.getByRole('button', { name: 'Open estimate', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Decision recorded', exact: true })).toHaveCount(0);
  await expect(page.locator('iframe')).toHaveCount(0);
});
