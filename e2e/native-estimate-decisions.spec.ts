import { test, expect, type Page } from '@playwright/test';
import { publicationFixture, actor, client, pet, estimate, hash, id } from '../tests/estimates/publication-browser-fixture';
import type { EstimateWitnessOperation, EstimateWitnessReceipt } from '../src/hub/features/estimates/decision-staff-api';

// Real staff component, strict adapter and session state with synthetic RPC transport.
// DB authorization, race and restore guarantees are tested by the owned runtime suites.
const target = { estimate_id: estimate, client_id: client, pet_id: pet };
const confirmed = 'The exact witnessed decision operation is confirmed in history.';
const storageKey = `lrv:estimate-witness:mutation:v1:${actor}:${estimate}:${client}:${pet}`;
const emptyHead = { event_id: null, version: 0, record_hash: null };
const region = (page: Page) => page.getByRole('region', { name: 'Estimate decisions and witness record', exact: true });
async function saved(page: Page) { return page.evaluate((key) => sessionStorage.getItem(key), storageKey); }

async function witnessFixture(page: Page) {
  const publication = await publicationFixture(page);
  const receipts = new Map<string, EstimateWitnessReceipt>();
  const closures = new Map<string, unknown>();
  const decisions: EstimateWitnessReceipt['result'][] = [];
  const state = { loseWrite: false, rejectWrite: false, loseClose: false, holdWrite: false,
    release: null as (() => void) | null,
    writes: [] as { id: string; request: EstimateWitnessOperation['payload'] }[],
    recovers: [] as string[], closes: [] as { id: string; request: EstimateWitnessOperation['payload'] }[],
    retainedAtWrite: null as string | null };
  function publicationHead() {
    const event = publication.events.at(-1);
    return event ? { event_id: event.id, version: event.version, record_hash: event.record_hash } : emptyHead;
  }
  function decisionHead() {
    const decision = decisions.at(-1);
    return decision ? { event_id: decision.id, version: decision.sequence, record_hash: decision.record_hash } : emptyHead;
  }
  await page.route('**/rest/v1/rpc/*', async (route) => {
    const name = new URL(route.request().url()).pathname.split('/').at(-1)!;
    const names = ['read_native_estimate_decision_state', 'read_native_estimate_decisions', 'preview_native_estimate_decision_grant',
      'record_native_estimate_witnessed_decision', 'recover_native_estimate_witnessed_decision', 'close_native_estimate_witnessed_decision'];
    if (!names.includes(name)) return route.fallback();
    const args = route.request().postDataJSON();
    const current = publication.events.at(-1)?.publication ?? null;
    let response: unknown;
    if (name === 'read_native_estimate_decision_state') response = {
      version: 1, target, publication_head: publicationHead(), decision_head: decisionHead(), current_publication_id: current?.id ?? null,
      current_decision: decisions.find((d) => d.binding.publication_id === current?.id) ?? null,
    };
    else if (name === 'read_native_estimate_decisions') response = {
      version: 1, target, head: decisionHead(), items: [...decisions].reverse(), next_before_sequence: null, has_more: false,
    };
    else if (name === 'preview_native_estimate_decision_grant') {
      if (!current || current.id !== args.p_publication_id) return route.fulfill({ status: 400, json: { code: '40001', message: 'Publication changed' } });
      response = { version: 1, binding: { target, publication_id: current.id, content_hash: current.content_hash, artifact_hash: current.artifact.sha256 },
        publication_head: publicationHead(), expires_at: current.expires_at, decision: null };
    } else if (name === 'record_native_estimate_witnessed_decision') {
      state.writes.push({ id: args.p_id, request: args.p_request }); state.retainedAtWrite = await saved(page);
      if (state.rejectWrite) return route.fulfill({ status: 400, json: { code: '40001', message: 'Reviewed publication changed' } });
      if (!receipts.has(args.p_id)) {
        const request = args.p_request as EstimateWitnessOperation['payload'];
        const created_at = '2026-09-16T12:01:00.123456Z';
        const result: EstimateWitnessReceipt['result'] = {
          version: 1, id: args.p_id, sequence: decisions.length + 1, binding: request.decision.binding,
          choice: request.decision.choice, signer_name: request.decision.signer_name, signer_relationship: request.decision.signer_relationship,
          comment: request.decision.comment, acknowledgment_version: 1,
          provenance: { kind: 'staff_witness', actor_id: publication.state.actor, witness: request.witness },
          publication_head: request.decision.expected_publication_head, decision_head: decisionHead(), recorded_at: created_at, record_hash: hash,
        };
        receipts.set(args.p_id, { version: 1, id: args.p_id, principal: { kind: 'staff', id: publication.state.actor },
          mutation: { kind: 'witnessed_decision', request }, request_hash: hash, result, created_at });
        decisions.push(result);
      }
      if (state.holdWrite) await new Promise<void>((resolve) => { state.release = resolve; });
      if (state.loseWrite) return route.abort('failed');
      response = receipts.get(args.p_id);
    } else if (name === 'recover_native_estimate_witnessed_decision') {
      state.recovers.push(args.p_id); response = receipts.get(args.p_id) ?? null;
    } else {
      state.closes.push({ id: args.p_id, request: args.p_request });
      if (receipts.has(args.p_id)) response = { version: 1, status: 'recorded', receipt: receipts.get(args.p_id) };
      else {
        if (!closures.has(args.p_id)) closures.set(args.p_id, { version: 1, status: 'closed_unrecorded', closure: {
          version: 1, id: args.p_id, principal: { kind: 'staff', id: publication.state.actor },
          mutation: { kind: 'witnessed_decision', request: args.p_request }, request_hash: hash,
          closed_by: { kind: 'staff', id: publication.state.actor }, reason: null, closed_at: '2026-09-16T12:01:00.123456Z', record_hash: hash,
        } });
        response = closures.get(args.p_id);
      }
      if (state.loseClose) return route.abort('failed');
    }
    await route.fulfill({ json: response });
  });
  await publication.mount();
  // Produce and capture the exact document through the existing browser fixture.
  await page.getByRole('button', { name: 'Prepare saved draft 1 for review', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Estimate publication', exact: true }).locator('iframe')).toBeVisible();
  await page.getByRole('checkbox', { name: /I reviewed the exact document/ }).check();
  await page.getByRole('checkbox', { name: /I reviewed quantities/ }).check();
  await page.getByRole('checkbox', { name: /I reviewed the terms/ }).check();
  await page.getByRole('button', { name: 'Publish reviewed document', exact: true }).click();
  await expect(page.getByText('The exact publication operation is confirmed in history.', { exact: true })).toBeVisible();
  await region(page).getByRole('button', { name: 'Refresh decision history', exact: true }).click();
  return { publication, state, receipts, decisions, closures };
}
async function reviewDocument(page: Page) {
  await region(page).getByRole('button', { name: 'Review current published estimate', exact: true }).click();
  await expect(region(page).locator('iframe')).toBeVisible();
  await expect(page.frameLocator('iframe[title="Published estimate for witnessed decision"]').getByRole('heading', { name: 'Housecall care proposal', exact: true })).toBeVisible();
}
async function fill(page: Page, choice: 'accept' | 'decline' = 'accept') {
  const scope = region(page);
  await scope.getByLabel('Respondent name', { exact: true }).fill('Synthetic Owner');
  await scope.getByRole('combobox', { name: 'Respondent relationship', exact: true }).selectOption('owner');
  await scope.getByRole('combobox', { name: 'Client decision', exact: true }).selectOption(choice);
  await scope.getByRole('combobox', { name: 'Instruction channel', exact: true }).selectOption('telephone');
  await scope.getByLabel('Earlier instruction date and time (Mountain Time)', { exact: true }).fill('2026-09-16T06:01');
  await scope.getByRole('textbox', { name: 'Witness note', exact: true }).fill('Owner directly communicated this decision by telephone.');
}
async function submit(page: Page, choice: 'accept' | 'decline' = 'accept') {
  await fill(page, choice);
  await region(page).getByRole('checkbox', { name: /I reviewed these exact published terms/ }).check();
  await region(page).getByRole('button', { name: 'Record witnessed decision', exact: true }).click();
}

for (const choice of ['accept', 'decline'] as const) {
  test(`staff reviews exact published bytes and records witnessed ${choice} with distinct provenance`, async ({ page }) => {
    const w = await witnessFixture(page); await reviewDocument(page); await fill(page, choice);
    const scope = region(page);
    await expect(scope.locator('iframe')).toHaveAttribute('sandbox', '');
    await expect(scope.locator('iframe')).toHaveAttribute('referrerpolicy', 'no-referrer');
    await expect(scope.getByRole('button', { name: 'Record witnessed decision', exact: true })).toBeDisabled();
    const downloading = page.waitForEvent('download');
    await scope.getByRole('link', { name: 'Download reviewed published estimate', exact: true }).click();
    const download = await downloading; const published = w.publication.events[0].publication!;
    expect(download.suggestedFilename()).toBe(published.artifact.filename);
    const chunks: Buffer[] = []; for await (const chunk of (await download.createReadStream())!) chunks.push(chunk);
    expect(Buffer.concat(chunks).toString('utf8')).toBe(w.publication.htmls.get(published.preparation_id));
    await scope.getByRole('checkbox', { name: /I reviewed these exact published terms/ }).check();
    await scope.getByRole('button', { name: 'Record witnessed decision', exact: true }).click();
    await expect(scope.getByText(confirmed, { exact: true })).toBeVisible();
    expect(w.state.writes).toHaveLength(1);
    const request = w.state.writes[0]; const original = JSON.parse(w.state.retainedAtWrite!);
    expect(original.operation.id).toBe(request.id); expect(original.operation.payload).toEqual(request.request);
    expect(request.request.witness.occurred_at).toBe('2026-09-16T12:01:00.000Z');
    expect(request.request.decision.grant_id).toBeNull(); expect(request.request.decision.choice).toBe(choice);
    expect(request.request.decision.binding.artifact_hash).toBe(published.artifact.sha256);
    expect(w.decisions[0].provenance).toEqual({ kind: 'staff_witness', actor_id: actor, witness: request.request.witness });
    await expect(scope.getByText(/Recorded by staff from direct client instruction/)).toBeVisible();
    expect(await saved(page)).toBeNull();
  });
}

test('lost witnessed response survives reload and recovers the original exact request', async ({ page }) => {
  const w = await witnessFixture(page); await reviewDocument(page); w.state.loseWrite = true; await submit(page);
  await expect(region(page).getByRole('button', { name: 'Recover original witnessed decision', exact: true })).toBeEnabled();
  const original = w.state.writes[0]; const retained = await saved(page); expect(retained).not.toBeNull();
  await w.publication.mount();
  expect(await saved(page)).toBe(retained);
  await region(page).getByRole('button', { name: 'Recover original witnessed decision', exact: true }).click();
  await expect(region(page).getByText(confirmed, { exact: true })).toBeVisible();
  expect(w.state.recovers).toEqual([original.id]); expect(w.state.writes).toEqual([original]); expect(w.decisions).toHaveLength(1);
  expect(await saved(page)).toBeNull();
});

test('stale rejection and absent recovery retain intent; durable closure resets document attestation', async ({ page }) => {
  const w = await witnessFixture(page); await reviewDocument(page); w.state.rejectWrite = true; await submit(page);
  const scope = region(page);
  await expect(scope.getByRole('button', { name: 'Recover original witnessed decision', exact: true })).toBeEnabled();
  const original = w.state.writes[0]; const retained = await saved(page);
  await scope.getByRole('button', { name: 'Recover original witnessed decision', exact: true }).click();
  await expect.poll(() => w.state.recovers.length).toBe(1);
  expect(await saved(page)).toBe(retained);
  await expect(page.getByRole('button', { name: 'Close publication workspace', exact: true })).toBeDisabled();
  await scope.getByRole('button', { name: 'Resolve or close original witnessed request', exact: true }).click();
  await expect(scope.getByText('The original request is permanently closed without recording an operation. You can review current evidence again.', { exact: true })).toBeVisible();
  expect(w.state.closes).toEqual([original]); expect(await saved(page)).toBeNull(); expect(w.decisions).toHaveLength(0);
  await expect(scope.locator('iframe')).toHaveCount(0);
  await reviewDocument(page);
  await expect(scope.getByRole('checkbox', { name: /I reviewed these exact published terms/ })).not.toBeChecked();
  await expect(scope.getByRole('button', { name: 'Record witnessed decision', exact: true })).toBeDisabled();
});

test('lost terminal closure response retains original ID across reload', async ({ page }) => {
  const w = await witnessFixture(page); await reviewDocument(page); w.state.rejectWrite = true; await submit(page);
  await expect(region(page).getByRole('button', { name: 'Resolve or close original witnessed request', exact: true })).toBeEnabled();
  w.state.loseClose = true;
  await region(page).getByRole('button', { name: 'Resolve or close original witnessed request', exact: true }).click();
  await expect.poll(() => w.state.closes.length).toBe(1);
  await w.publication.mount(); w.state.loseClose = false;
  await region(page).getByRole('button', { name: 'Resolve or close original witnessed request', exact: true }).click();
  await expect(region(page).getByText(/The original request is permanently closed/)).toBeVisible();
  expect(w.state.closes).toHaveLength(2); expect(w.state.closes[0]).toEqual(w.state.closes[1]);
  expect(w.state.closes[0]).toEqual(w.state.writes[0]); expect(await saved(page)).toBeNull();
});

test('unsaved witness review blocks household close and navigation until explicitly discarded', async ({ page }) => {
  await witnessFixture(page); await reviewDocument(page); await fill(page);
  await expect(page.getByRole('button', { name: 'Close publication workspace', exact: true })).toBeDisabled();
  await page.getByRole('link', { name: 'Leave estimate household', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Unfinished household work' })).toBeVisible();
  await page.getByRole('button', { name: 'Stay and reconcile', exact: true }).click();
  await expect(region(page).locator('iframe')).toBeVisible();
  await region(page).getByRole('button', { name: 'Discard unsaved witness form', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Close publication workspace', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Close publication workspace', exact: true }).click();
  await expect(region(page)).toHaveCount(0);
});

test('late successful response cannot clear another actor’s pending witness identity', async ({ page }) => {
  const w = await witnessFixture(page); await reviewDocument(page); w.state.holdWrite = true; await submit(page);
  await expect.poll(() => Boolean(w.state.release)).toBe(true);
  const original = await saved(page); expect(original).not.toBeNull();
  await w.publication.switchActor(id(99));
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('sb-127-auth-token')!).user.id)).toBe(id(99));
  w.state.release!();
  await expect(region(page).getByText(confirmed, { exact: true })).toHaveCount(0);
  expect(await saved(page)).toBe(original); expect(w.decisions[0].provenance).toMatchObject({ actor_id: actor });
});

test('mobile witnessed review preserves readable layout and Mountain Time field focus', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await witnessFixture(page); await reviewDocument(page); await fill(page, 'decline');
  const occurred = region(page).getByLabel('Earlier instruction date and time (Mountain Time)', { exact: true });
  await occurred.focus(); await expect(occurred).toBeFocused(); await expect(occurred).toHaveValue('2026-09-16T06:01');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('staff-estimate-witness-mobile.png'), fullPage: true });
});

test('changing any witnessed instruction field requires a fresh attestation', async ({ page }) => {
  const w = await witnessFixture(page); await reviewDocument(page); await fill(page);
  const scope = region(page), checkbox = scope.getByRole('checkbox', { name: /I reviewed these exact published terms/ });
  const edits = [
    () => scope.getByLabel('Respondent name', { exact: true }).fill('Revised reported owner'),
    () => scope.getByRole('combobox', { name: 'Respondent relationship', exact: true }).selectOption('authorized_agent'),
    () => scope.getByRole('combobox', { name: 'Instruction channel', exact: true }).selectOption('written'),
    () => scope.getByRole('textbox', { name: 'Witness note', exact: true }).fill('Different direct instruction evidence.'),
    () => scope.getByRole('textbox', { name: 'Client comment (optional)', exact: true }).fill('Please discuss timing first.'),
    () => scope.getByRole('combobox', { name: 'Client decision', exact: true }).selectOption('decline'),
    () => scope.getByLabel('Earlier instruction date and time (Mountain Time)', { exact: true }).fill('2026-09-16T06:02'),
    () => scope.getByRole('button', { name: 'Instruction received now', exact: true }).click(),
  ];
  for (const edit of edits) {
    await checkbox.check(); await expect(checkbox).toBeChecked();
    await edit(); await expect(checkbox).not.toBeChecked();
    await expect(scope.getByRole('button', { name: 'Record witnessed decision', exact: true })).toBeDisabled();
  }
  expect(w.state.writes).toHaveLength(0);
});

test('account change during token acquisition prevents dispatch under another staff identity', async ({ page }) => {
  const w = await witnessFixture(page); await reviewDocument(page); await fill(page);
  await region(page).getByRole('checkbox', { name: /I reviewed these exact published terms/ }).check();
  await page.evaluate(async () => {
    const path = '/src/integrations/supabase/client.ts';
    const { supabase } = await import(path);
    const original = supabase.auth.getSession.bind(supabase.auth);
    const state = window as unknown as { __witnessTokenWait?: boolean; __releaseWitnessToken?: () => void };
    supabase.auth.getSession = async () => {
      // Hold just the next dispatch lookup; normal AuthProvider changes remain free.
      supabase.auth.getSession = original;
      state.__witnessTokenWait = true;
      await new Promise<void>((resolve) => { state.__releaseWitnessToken = resolve; });
      return original();
    };
  });
  await region(page).getByRole('button', { name: 'Record witnessed decision', exact: true }).click();
  await expect.poll(() => page.evaluate(() => Boolean((window as unknown as { __witnessTokenWait?: boolean }).__witnessTokenWait))).toBe(true);
  const original = await saved(page); expect(original).not.toBeNull();
  await w.publication.switchActor(id(99));
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('sb-127-auth-token')!).user.id)).toBe(id(99));
  await page.evaluate(() => (window as unknown as { __releaseWitnessToken: () => void }).__releaseWitnessToken());
  // Drain the released promise and its rejection handling without a timing sleep.
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  expect(w.state.writes).toHaveLength(0); expect(w.decisions).toHaveLength(0);
  expect(await saved(page)).toBe(original);
  await expect(region(page).getByText(confirmed, { exact: true })).toHaveCount(0);
});
