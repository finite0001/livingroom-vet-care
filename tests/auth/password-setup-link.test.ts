import test from 'node:test';
import assert from 'node:assert/strict';
import { capturePasswordSetupLink, parsePasswordSetupLink, takePasswordSetupLink } from '../../src/hub/lib/password-setup-link.ts';
const fragment = '#access_token=header.payload.signature&refresh_token=synthetic_refresh&type=recovery';
const location = { pathname: '/hub/reset-password', search: '', hash: fragment };

test('only supported invite/recovery fragments on the exact password setup route are admitted', () => {
  assert.equal(parsePasswordSetupLink(location)?.purpose, 'recovery');
  assert.equal(parsePasswordSetupLink({ ...location, hash: fragment.replace('recovery', 'invite') })?.purpose, 'invite');
  for (const invalid of [
    { ...location, pathname: '/hub' }, { ...location, pathname: '/hub/login' },
    { ...location, hash: fragment.replace('recovery', 'magiclink') },
    { ...location, hash: fragment.replace('header.payload.signature', 'malformed') },
    { ...location, search: '?error=expired' }, { ...location, hash: fragment + '&error=expired' },
    { ...location, hash: fragment.replace('synthetic_refresh', 'short') },
  ]) assert.equal(parsePasswordSetupLink(invalid), null);
});
test('credentials and provider errors are removed before rendering; the capability is consumed only once', () => {
  let replaced = '';
  capturePasswordSetupLink({ location: { ...location, search: '?access_token=also-secret&next=stay' }, history: { replaceState: (_data, _title, url) => { replaced = url; } } });
  assert.equal(replaced, '/hub/reset-password?next=stay');
  assert.deepEqual(takePasswordSetupLink(), { accessToken: 'header.payload.signature', refreshToken: 'synthetic_refresh', purpose: 'recovery' });
  assert.equal(takePasswordSetupLink(), null);
  capturePasswordSetupLink({ location: { ...location, pathname: '/hub/login' }, history: { replaceState: (_data, _title, url) => { replaced = url; } } });
  assert.equal(replaced, '/hub/login'); assert.equal(takePasswordSetupLink(), null);
});
test('ordinary anchors and query parameters are preserved', () => {
  let writes = 0;
  capturePasswordSetupLink({ location: { pathname: '/contact', hash: '#contact-form', search: '?campaign=welcome' }, history: { replaceState: () => { writes++; } } });
  assert.equal(writes, 0); assert.equal(takePasswordSetupLink(), null);
});
