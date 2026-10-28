/** Real SDK login and original operational UI; fixed120s including30s cleanup. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { constants, openSync, closeSync, fstatSync, readFileSync, writeFileSync, lstatSync, realpathSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react-swc';
import { chromium, expect } from '@playwright/test';
import { z } from 'zod';
import { narcoticsFinalizeBrowserInputSchema, narcoticsBrowserPublicInput } from './narcotics-finalize-browser-input.ts';
import { recoveryPointer } from '../../src/hub/features/controlled-drugs/recovery/schema.ts';
import { recoveryStorageKey } from '../../src/hub/features/controlled-drugs/recovery/operation-controller.ts';
import { parseRegisterPointer } from '../../src/hub/features/controlled-drugs/register/schema.ts';
import { registerStorageKey } from '../../src/hub/features/controlled-drugs/register/operation-controller.ts';

process.umask(0o077);
const root = fileURLToPath(new URL('../../', import.meta.url)), origin = 'http://127.0.0.1:64902';
const started = performance.now(), deadline = started + 120000, sha = bytes => createHash('sha256').update(bytes).digest('hex');
function remaining(cap = 15000) { const value = deadline - performance.now() - 30000; if (value <= 0) throw Error('Original browser cleanup reserve reached'); return Math.min(cap, value); }
function regular(path, cap, privateFile = false) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try { const a = fstatSync(fd); assert(a.isFile() && a.uid === process.getuid() && a.size <= cap); if (privateFile) assert.equal(a.mode & 0o077, 0);
    const bytes = readFileSync(fd), b = fstatSync(fd); assert.equal(bytes.length, a.size); assert.deepEqual([a.dev,a.ino,a.size,a.mtimeMs], [b.dev,b.ino,b.size,b.mtimeMs]); return bytes;
  } finally { closeSync(fd); }
}
assert.equal(process.argv.length, 3);
const folder = resolve(process.argv[2]), parent = dirname(folder);
assert.equal(basename(folder), 'operational-browser-proof'); assert.match(basename(parent), /^lrv-operational-browser-[A-Za-z0-9_-]+$/);
assert(new Set([realpathSync(tmpdir()), realpathSync('/tmp')]).has(dirname(realpathSync(parent))));
for (const path of [folder, parent]) { const value = lstatSync(path); assert(value.isDirectory() && !value.isSymbolicLink() && value.uid === process.getuid() && (value.mode & 0o077) === 0); }
assert.deepEqual(readdirSync(folder).sort(), ['input.json', 'original-form.pdf']);
const schema = z.object({ login: narcoticsFinalizeBrowserInputSchema, sources: z.record(z.string(), z.object({ bytes: z.number().int().nonnegative().max(2097152), sha256: z.string().regex(/^[0-9a-f]{64}$/) }).strict()),
  original_form_sha256: z.string().regex(/^[0-9a-f]{64}$/) }).strict();
const input = schema.parse(JSON.parse(regular(resolve(folder, 'input.json'), 2097152, true).toString('utf8')));
const publicInput = narcoticsBrowserPublicInput(input.login), recoveryKey = recoveryStorageKey('abcdefghijklmnopqrst', input.login.actorId), registerKey = registerStorageKey('abcdefghijklmnopqrst', input.login.actorId), document = regular(resolve(folder, 'original-form.pdf'), 2097152, true);
assert.equal(sha(document), input.original_form_sha256);
function sources() { assert(Object.keys(input.sources).length >= 146); for (const [name, wanted] of Object.entries(input.sources)) {
  assert(!name.startsWith('/') && !name.split('/').some(part => part === '..' || !part));
  const raw = regular(resolve(root, name), 2097152); assert.equal(raw.length, wanted.bytes); assert.equal(sha(raw), wanted.sha256);
} }
sources();
function output(name, value) { writeFileSync(resolve(folder, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); }
function original(name, raw) { assert(raw.length <= 8388608); writeFileSync(resolve(folder, name), raw, { flag: 'wx', mode: 0o600 }); return { file: name, bytes: raw.length, sha256: sha(raw) }; }
async function barrier() { output('auth-ready.json', { kind: 'actual-operational-SDK-login-v1', auth, profiles }); while (!existsSync(resolve(folder, 'auth-continue.json'))) await new Promise(done => setTimeout(done, remaining(100))); assert.deepEqual(JSON.parse(regular(resolve(folder, 'auth-continue.json'), 1024, true)), { passed: true }); }
const methods = new Set(['list_controlled_count_scopes_v1','narcotics_recovery_status_v1','narcotics_recovery_preflight_v1','narcotics_recovery_arm_v1','narcotics_recovery_source_resume_v1','narcotics_recovery_read_operation_v1',
  'list_narcotics_registers_v1','create_narcotics_register_v1','preserve_narcotics_form_v1','read_narcotics_form_operation_v1','download_narcotics_form_v1']);
let vite, server, browser, context, page, auth, failure = false, released = false, lost = false, lostForm = false, browserClosed = false, viteClosed = false;
const calls = [], profiles = [], downloads = [], blocked = []; let options = 0, devSockets = 0, armReload = false, formReload = false, pointersCleared = false;
let phase = 'setup'; const diagnostics = [];
function note(error, where) { if (diagnostics.length >= 8) return; const match = /run-local-operational-browser\.mjs:(\d+):(\d+)/.exec(error?.stack ?? ''); const item = { phase: where, driver_line: match ? Number(match[1]) : null }; if (Number.isInteger(error?.actual) && error.actual >= 0 && error.actual <= 599) item.actual_integer = error.actual; if (Number.isInteger(error?.expected) && error.expected >= 0 && error.expected <= 599) item.expected_integer = error.expected; diagnostics.push(item); }
const workCutoff = setTimeout(() => { failure = true; if (context) void context.close().catch(() => {}); else if (server) void server.kill().catch(() => {}); }, Math.max(0, deadline-performance.now()-30000));
const headers = supplied => Object.fromEntries(Object.entries(supplied).filter(([key]) => !['content-length','content-encoding','transfer-encoding','connection'].includes(key.toLowerCase())));
async function closeWithin(task, ms) { let timer; try { return await Promise.race([task(), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Owned browser cleanup failed')), ms); })]); } finally { clearTimeout(timer); } }
try {
  vite = await createServer({ root, configFile: false, envFile: false, logLevel: 'silent', plugins: [react()], cacheDir: resolve(folder, 'vite-cache'),
    define: { 'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(publicInput.origin), 'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify(publicInput.anonKey) },
    resolve: { alias: { '@': resolve(root, 'src') } }, server: { host: '127.0.0.1', port: 64902, strictPort: true, hmr: false, open: false,
      fs: { strict: true, allow: [root, resolve(folder, 'vite-cache')], deny: ['**/.env','**/.env.*','**/input.json','**/*-private.json'] } } });
  await vite.listen(); remaining();
  server = await chromium.launchServer({ headless: true, host: '127.0.0.1', executablePath: chromium.executablePath(), timeout: remaining(20000) });
  output('browser-owner.json', { node_pid: process.pid, browser_pid: server.process().pid, executable: chromium.executablePath() });
  assert.equal(new URL(server.wsEndpoint()).hostname, '127.0.0.1');
  browser = await chromium.connect(server.wsEndpoint(), { timeout: remaining() }); context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, serviceWorkers: 'block' });
  const dev = new URL(origin.replace(/^http:/, 'ws:') + '/'); dev.searchParams.set('token', vite.config.webSocketToken);
  await context.routeWebSocket('**/*', socket => { if (socket.url() === dev.href && ++devSockets <= 2) { socket.close(); return; } blocked.push('unexpected-websocket'); failure = true; socket.close(); });
  await context.addInitScript(value => { window.__LRV_OPERATIONAL_LOCAL_INPUT__ = value; }, publicInput);
  await context.route('**/*', async route => {
    try {
      remaining(); const request = route.request(), url = new URL(request.url()), method = request.method(), h = request.headers();
      if (url.origin === origin) { assert(['GET','HEAD'].includes(method)); await route.continue(); return; }
      assert.equal(url.origin, publicInput.origin); assert.equal(url.hash, '');
      const relation = ['/rest/v1/profiles','/rest/v1/user_roles'].includes(url.pathname), token = url.pathname === '/auth/v1/token';
      const rpc = /^\/rest\/v1\/rpc\/([a-z0-9_]+)$/.exec(url.pathname)?.[1]; assert(relation || token || methods.has(rpc));
      if (method === 'OPTIONS') assert(++options <= 24); else assert.equal(h.apikey, publicInput.anonKey);
      if (method !== 'OPTIONS' && token) { assert.equal(method,'POST'); assert.equal(url.search,'?grant_type=password'); assert(!auth); const q = request.postDataJSON(); assert.equal(q.email,input.login.login.email); assert.equal(q.password,input.login.login.password); }
      if (method !== 'OPTIONS' && !token) { assert(auth); assert.equal(h.authorization, 'Bearer ' + auth.token); }
      if (method !== 'OPTIONS' && relation) {
        assert.equal(method, 'GET');
        assert.deepEqual([...url.searchParams], url.pathname === '/rest/v1/profiles'
          ? [['select','id,first_name,last_name,full_name,role,is_active'],['id',`eq.${publicInput.actorId}`]]
          : [['select','role'],['user_id',`eq.${publicInput.actorId}`]]);
      }
      if (method !== 'OPTIONS' && rpc) { assert.equal(method,'POST'); assert.equal(url.search,''); if (!released) { assert.equal(rpc,'narcotics_recovery_status_v1'); await barrier(); released = true; } assert(calls.length < 36); }
      const response = await route.fetch({ maxRedirects: 0, maxRetries: 0, timeout: remaining() }), raw = await response.body(); remaining(); assert(raw.length <= 8388608);
      if (method === 'OPTIONS') { assert([200,204].includes(response.status())); }
      else if (token) { assert.equal(response.status(),200); const signed = JSON.parse(raw); assert.equal(signed.user.id, publicInput.actorId);
        auth = { token: signed.access_token, response: original('auth-response-private.json',raw) }; }
      else if (relation) { assert.equal(response.status(),200); profiles.push({ relation: url.pathname, response: original('profile-' + profiles.length + '.json',raw) }); assert(profiles.length <= 12); }
      else { assert.equal(response.status(),200); const index = calls.length; calls.push({ rpc, request: original('rpc-' + index + '-request.json', request.postDataBuffer()), response: original('rpc-' + index + '-response.json',raw), status: 200 });
        if (rpc === 'narcotics_recovery_arm_v1' || rpc === 'preserve_narcotics_form_v1') { const field = rpc === 'narcotics_recovery_arm_v1' ? lost : lostForm; assert(!field); if (rpc === 'narcotics_recovery_arm_v1') lost = true; else lostForm = true; await route.abort('connectionfailed'); return; } }
      await route.fulfill({ status: response.status(), headers: headers(response.headers()), body: raw });
    } catch (error) { note(error,'route'); failure = true; await route.abort('blockedbyclient').catch(() => {}); }
  });
  page = await context.newPage(); page.setDefaultTimeout(15000); page.on('pageerror', error => { note(error,'page'); failure = true; });
  phase = 'login';
  await page.goto(origin + '/tests/controlled-drugs/operational-authenticated-fixture.html', { timeout: remaining(20000) });
  await page.getByLabel('Email', { exact: true }).fill(input.login.login.email, { timeout: remaining() });
  await page.getByLabel('Password', { exact: true }).fill(input.login.login.password); await page.getByRole('button', { name: /sign in/i }).click();
  phase = 'backup';
  await expect(page.getByRole('heading', { name: 'Prepare a protected backup' })).toBeVisible({ timeout: remaining(30000) });
  await page.getByRole('button', { name: 'Check backup readiness' }).click();
  await page.getByLabel('I am ready to pause normal recording while this backup is prepared.').check();
  await page.getByRole('button', { name: 'Pause recording and arm backup' }).click();
  await expect(page.getByRole('heading', { name: 'Check the original action' })).toBeVisible({ timeout: remaining() });
  const armRaw = await page.evaluate(key => localStorage.getItem(key), recoveryKey); assert(armRaw && armRaw.length <= 1024);
  const armPointer = recoveryPointer.parse(JSON.parse(armRaw));
  const armRequest = JSON.parse(regular(resolve(folder,calls.find(call => call.rpc === 'narcotics_recovery_arm_v1').request.file),8388608,true)).p_request;
  assert.deepEqual(armPointer,{schema_version:1,actor_id:publicInput.actorId,operation_id:armRequest.operation_id,action:'arm'});
  await page.reload({ timeout: remaining() }); await expect(page.getByRole('heading', { name: 'Check the original action' })).toBeVisible({ timeout: remaining() });
  assert.equal(await page.evaluate(key => localStorage.getItem(key), recoveryKey),armRaw); armReload = true;
  await page.getByRole('button', { name: 'Check original result' }).click();
  await expect(page.getByRole('heading', { name: 'Saved recovery receipt' })).toBeVisible({ timeout: remaining() });
  await expect.poll(() => page.evaluate(key => localStorage.getItem(key), recoveryKey), { timeout: remaining() }).toBeNull();
  await expect(page.getByRole('heading', { name: 'On the original server' })).toBeVisible({ timeout: remaining() });
  assert.deepEqual(JSON.parse(regular(resolve(folder,calls.find(call => call.rpc === 'narcotics_recovery_read_operation_v1').request.file),8388608,true)).p_request,armPointer);
  await page.getByRole('button', { name: 'Resume unchanged original server' }).click();
  await expect(page.getByRole('heading', { name: 'Prepare a protected backup' })).toBeVisible({ timeout: remaining() });
  phase = 'report';
  await page.getByRole('link', { name: 'Reports and files' }).click();
  await page.getByRole('button', { name: 'Load medications and sites' }).click(); await page.getByRole('button', { name: 'Open medication' }).click();
  await page.getByRole('button', { name: 'Create and verify report' }).click(); await expect(page.getByRole('button', { name: 'Download verified CSV' })).toBeVisible({ timeout: remaining() });
  const csvEvent = page.waitForEvent('download', { timeout: remaining() }); await page.getByRole('button', { name: 'Download verified CSV' }).click();
  const csv = await csvEvent; const csvPath = resolve(folder, 'actual-register.csv'); await csv.saveAs(csvPath); downloads.push({ kind: 'csv', bytes: regular(csvPath, 8388608).length, sha256: sha(regular(csvPath,8388608)) });
  phase = 'form';
  await page.getByLabel('Title', { exact: true }).fill('Synthetic original supplier form'); await page.getByLabel('Original PDF, PNG or JPEG (up to 2 MiB)').setInputFiles({ name: 'synthetic-original.pdf', mimeType: 'application/pdf', buffer: document });
  await page.getByRole('button', { name: 'Preserve original file' }).click(); await expect(page.getByRole('heading', { name: 'An earlier save needs recovery' })).toBeVisible({ timeout: remaining() });
  const formRaw = await page.evaluate(key => localStorage.getItem(key), registerKey); assert(formRaw && formRaw.length <= 1024);
  const formPointer = parseRegisterPointer(JSON.parse(formRaw));
  const formRequest = JSON.parse(regular(resolve(folder,calls.find(call => call.rpc === 'preserve_narcotics_form_v1').request.file),8388608,true)).p_request;
  assert.deepEqual(formPointer,{schema_version:1,actor_id:publicInput.actorId,operation_id:formRequest.operation_id,product_id:publicInput.scope.product_id,site_id:publicInput.scope.site_id,kind:'form'});
  await page.reload({ timeout: remaining() }); await page.getByRole('link', { name: 'Reports and files' }).click();
  await page.getByRole('button', { name: 'Load medications and sites' }).click(); await page.getByRole('button', { name: 'Open medication' }).click();
  await expect(page.getByRole('heading', { name: 'An earlier save needs recovery' })).toBeVisible({ timeout: remaining() });
  assert.equal(await page.evaluate(key => localStorage.getItem(key), registerKey),formRaw); formReload = true;
  await page.getByRole('button', { name: 'Check original result' }).click(); await expect(page.getByText(/Original file saved: synthetic-original.pdf/)).toBeVisible({ timeout: remaining() });
  assert.equal(await page.evaluate(key => localStorage.getItem(key), registerKey),null);
  assert.deepEqual(JSON.parse(regular(resolve(folder,calls.find(call => call.rpc === 'read_narcotics_form_operation_v1').request.file),8388608,true)).p_request,formPointer); pointersCleared = true;
  await page.getByRole('button', { name: 'Create and verify report' }).click();
  const fileEvent = page.waitForEvent('download', { timeout: remaining() }); await page.getByRole('button', { name: 'Synthetic original supplier form · synthetic-original.pdf' }).click();
  const file = await fileEvent, filePath = resolve(folder, 'downloaded-original.pdf'); await file.saveAs(filePath); assert.equal(sha(regular(filePath,2097152)),input.original_form_sha256);
  downloads.push({ kind: 'original', bytes: document.length, sha256: input.original_form_sha256 });
  await page.screenshot({ path: resolve(folder, 'actual-operational-workspace.png'), fullPage: true }); remaining();
} catch (error) { note(error,phase); failure = true; }
finally {
  clearTimeout(workCutoff);
  try { if (context) await closeWithin(() => context.close(),4000); if (browser) await closeWithin(() => browser.close(),4000); if (server) { await closeWithin(() => server.close(),5000); assert(server.process().exitCode !== null || server.process().signalCode !== null); } browserClosed = true; } catch { failure = true; }
  try { if (vite) { await closeWithin(() => vite.close(),5000); assert.equal(vite.httpServer.listening,false); } viteClosed = true; } catch { failure = true; }
  try { sources(); } catch { failure = true; }
  if (performance.now() >= deadline || !released || !lost || !lostForm || !armReload || !formReload || !pointersCleared || downloads.length !== 2 || blocked.length || calls.filter(call => call.rpc === 'narcotics_recovery_arm_v1').length !== 1 || calls.filter(call => call.rpc === 'preserve_narcotics_form_v1').length !== 1) failure = true;
  output('result.json', { kind: 'actual-operational-SDK-browser-v1', failure_diagnostics: diagnostics, passed: !failure && browserClosed && viteClosed, calls, downloads, actual_SDK_password_grants: auth ? 1 : 0, original_arm_and_form_responses_lost_once: lost && lostForm, arm_ID_pointer_survived_reload: armReload, form_ID_pointer_survived_reload: formReload, verified_original_pointers_cleared: pointersCleared, no_stock_mutation_requested: true, normal_browser_cleanup: browserClosed, normal_vite_cleanup: viteClosed, elapsed_seconds: (performance.now()-started)/1000 });
}
if (failure) throw Error('Actual operational browser failed; private evidence retained');
