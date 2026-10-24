import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
export async function runStaffSessionProviderControls(root) {
    assert.equal(typeof root, 'string');
    assert.ok(path.isAbsolute(root), 'Exact absolute checkout root required');
    const require = createRequire(root + '/package.json');
    const ts = require('typescript');
    const brokerModule = await import(pathToFileURL(root + '/src/hub/features/controlled-drugs/record-review/staff-session.ts'));
    const requestModule = await import(pathToFileURL(root + '/src/hub/contexts/auth-request-state.ts'));
    const compiled = ts.transpileModule(fs.readFileSync(root + '/src/hub/contexts/AuthContext.tsx', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
    const actor = '10000000-0000-4000-8000-000000000001', sid = '10000000-0000-4000-8000-000000000002';
    const session = { user: { id: actor }, access_token: 'e30.' + Buffer.from(JSON.stringify({ sub: actor, session_id: sid, exp: 253402300798, role: 'authenticated' })).toString('base64url') + '.c3ludGFjdGlj' };
    const tick = () => new Promise(resolve => setTimeout(resolve, 0));
    function deferred() { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; }
    function mount() {
        const signins = [], signouts = [], states = [], cleanups = [];
        let callback;
        let broker;
        const supabase = { auth: { onAuthStateChange(cb) { callback = cb; return { data: { subscription: { unsubscribe() { } } } }; }, signInWithPassword() { const d = deferred(); signins.push(d); return d.promise; }, signOut() { const d = deferred(); signouts.push(d); return d.promise; } }, from(name) { return { select() { return { eq() { return name === 'profiles' ? { maybeSingle: async () => ({ data: { id: actor, is_active: true }, error: null }) } : Promise.resolve({ data: [{ role: 'DVM' }], error: null }); } }; } }; } };
        const react = { useState(init) { const i = states.length; states.push(typeof init === 'function' ? init() : init); return [states[i], v => states[i] = typeof v === 'function' ? v(states[i]) : v]; }, useRef(value) { return { current: value }; }, useCallback(fn) { return fn; }, useEffect(fn) { cleanups.push(fn()); } };
        const imports = { 'react': react, 'react/jsx-runtime': { jsx: (type, props) => ({ type, props }) }, '@tanstack/react-query': { useQueryClient: () => ({ clear() { } }) }, '@/integrations/supabase/client': { supabase }, './session-draft-retention': { clearInvoiceEmailSession() { } }, './auth-request-state': requestModule, './auth-context': { AuthContext: { Provider: 'AuthProvider' } }, '../features/controlled-drugs/record-review/staff-session': { createReviewStaffSessions(...args) { broker = brokerModule.createReviewStaffSessions(...args); return broker; } }, '../features/controlled-drugs/record-review/staff-session-context': { ReviewStaffSessionContext: { Provider: 'ReviewProvider' } } };
        const exports = {};
        new Function('require', 'exports', compiled)(name => { assert.ok(name in imports, 'unadmitted import ' + name); return imports[name]; }, exports);
        const rendered = exports.AuthProvider({ children: null });
        return { auth: rendered.props.children.props.value, broker, states, signins, signouts, emit: s => callback('SIGNED_IN', s), cleanup() { for (const fn of cleanups)
                fn(); broker.clear(); } };
    }
    const outcomes = [];
    async function control(name, fn) { try {
        await fn();
        outcomes.push({ name, passed: true });
    }
    catch (error) {
        outcomes.push({ name, passed: false, error: String(error) });
    } }
    await control('prior sign-in completion cannot resume after logout intent', async () => { const m = mount(); try {
        const signing = m.auth.signIn('synthetic', 'synthetic');
        const leaving = m.auth.signOut();
        m.signouts[0].resolve({ error: null });
        await leaving;
        m.signins[0].resolve({ data: { session }, error: null });
        await signing;
        await tick();
        assert.equal(await m.broker.source.current(), null);
    }
    finally {
        m.cleanup();
    } });
    await control('prior sign-out completion cannot clear newer successful login state', async () => { const m = mount(); try {
        const leaving = m.auth.signOut();
        const signing = m.auth.signIn('synthetic', 'synthetic');
        m.emit(session);
        m.signins[0].resolve({ data: { session }, error: null });
        await signing;
        await tick();
        assert.equal(m.states[2]?.id, actor);
        m.signouts[0].resolve({ error: null });
        await leaving;
        assert.equal(m.states[2]?.id, actor);
    }
    finally {
        m.cleanup();
    } });
    await control('unmounted provider cannot revive broker via pending sign-in', async () => { const m = mount(); try {
        const signing = m.auth.signIn('synthetic', 'synthetic');
        m.cleanup();
        m.signins[0].resolve({ data: { session }, error: null });
        await signing;
        await tick();
        assert.equal(await m.broker.source.current(), null);
    }
    finally {
        m.cleanup();
    } });
    await control('newer sign-in supersedes earlier success without reviving old session', async () => { const m = mount(); try {
        const one = m.auth.signIn('first', 'synthetic');
        const two = m.auth.signIn('second', 'synthetic');
        const newer = { ...session, user: { id: '10000000-0000-4000-8000-000000000003' }, access_token: 'e30.' + Buffer.from(JSON.stringify({ sub: '10000000-0000-4000-8000-000000000003', session_id: sid, exp: 253402300798, role: 'authenticated' })).toString('base64url') + '.c3ludGFjdGlj' };
        m.emit(newer);
        m.signins[1].resolve({ data: { session: newer }, error: null });
        await two;
        await tick();
        assert.equal((await m.broker.source.current())?.actorId, newer.user.id);
        m.signins[0].resolve({ data: { session }, error: null });
        await one;
        await tick();
        assert.equal((await m.broker.source.current())?.actorId, newer.user.id);
    }
    finally {
        m.cleanup();
    } });
    await control('sign-in response mismatching latest observed SDK token remains suspended', async () => { const m = mount(); try {
        const pending = m.auth.signIn('synthetic', 'synthetic');
        m.emit({ ...session, access_token: session.access_token + 'other' });
        m.signins[0].resolve({ data: { session }, error: null });
        const result = await pending;
        await tick();
        assert.ok(result.error);
        assert.equal(await m.broker.source.current(), null);
    }
    finally {
        m.cleanup();
    } });
    await control('identical SDK event preserves verified identity; explicit revalidation hides it', async () => { const b = brokerModule.createReviewStaffSessions({ now: () => 0 }); try {
        const id = b.offer(session);
        assert.equal(b.allow(id, true), true);
        assert.equal(b.offer(session), id);
        assert.equal(b.source.getSnapshot(), id);
        b.allow(id, false);
        const denied = b.offer(session);
        assert.notEqual(denied.generation, id.generation);
        assert.equal(b.source.getSnapshot(), null);
        assert.equal(b.allow(id, true), false);
        assert.notEqual(b.revalidate().generation, denied.generation);
        assert.equal(b.allow(denied, true), false);
    }
    finally {
        b.clear();
    } });
    await control('stale earlier SDK callback cannot enable actor after newer sign-in success', async () => { const m = mount(); try {
        const one = m.auth.signIn('first', 'synthetic');
        const two = m.auth.signIn('second', 'synthetic');
        const newer = { ...session, user: { id: '10000000-0000-4000-8000-000000000003' }, access_token: 'e30.' + Buffer.from(JSON.stringify({ sub: '10000000-0000-4000-8000-000000000003', session_id: sid, exp: 253402300798, role: 'authenticated' })).toString('base64url') + '.c3ludGFjdGlj' };
        m.emit(newer);
        m.signins[1].resolve({ data: { session: newer }, error: null });
        await two;
        await tick();
        assert.equal((await m.broker.source.current())?.actorId, newer.user.id);
        m.emit(session);
        m.signins[0].resolve({ data: { session }, error: null });
        await one;
        await tick();
        await tick();
        assert.equal(await m.broker.source.current(), null);
    }
    finally {
        m.cleanup();
    } });
    assert.deepEqual(outcomes.filter(item => !item.passed).map(item => item.name), [], 'Actual provider synthetic regression cases must all pass');
    return Object.freeze({ scope: 'Inert SDK/React harness executes real provider, broker and request state; no services or genuine Auth proof', passed: outcomes.length });
}
