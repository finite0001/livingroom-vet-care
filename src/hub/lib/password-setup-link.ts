/** Password setup capabilities remain in memory and never enter staff storage. */
export interface PasswordSetupLink {
  accessToken: string;
  refreshToken: string;
  purpose: 'invite' | 'recovery';
}
interface CallbackBrowser {
  location: { pathname: string; search: string; hash: string };
  history: { replaceState(data: unknown, unused: string, url: string): void };
}
let pending: PasswordSetupLink | null = null;

export function parsePasswordSetupLink(location: CallbackBrowser['location']): PasswordSetupLink | null {
  if (location.pathname !== '/hub/reset-password') return null;
  const params = new URLSearchParams(location.hash.slice(1));
  if (params.has('error') || new URLSearchParams(location.search).has('error')) return null;
  const purpose = params.get('type');
  const accessToken = params.get('access_token') ?? '';
  const refreshToken = params.get('refresh_token') ?? '';
  if ((purpose !== 'invite' && purpose !== 'recovery') || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(accessToken)
    || !/^[A-Za-z0-9_-]{8,512}$/.test(refreshToken)) return null;
  return { accessToken, refreshToken, purpose };
}

/** Called before importing App/auth/marketing. Unsupported callbacks are scrubbed
 * too, but cannot establish a staff session on an arbitrary application route. */
export function capturePasswordSetupLink(browser: CallbackBrowser): void {
  pending = parsePasswordSetupLink(browser.location);
  const query = new URLSearchParams(browser.location.search);
  const fragment = new URLSearchParams(browser.location.hash.slice(1));
  const authKeys = ['access_token', 'refresh_token', 'token_hash', 'token_type', 'expires_in', 'expires_at', 'type', 'error', 'error_code', 'error_description'];
  const hasAuth = ['access_token', 'refresh_token', 'token_hash', 'error', 'error_description'].some(key => query.has(key) || fragment.has(key));
  if (!hasAuth) return;
  for (const key of authKeys) query.delete(key);
  const search = query.size ? `?${query}` : '';
  browser.history.replaceState(null, '', browser.location.pathname + search);
}

export function takePasswordSetupLink(): PasswordSetupLink | null {
  const link = pending;
  pending = null;
  return link;
}
