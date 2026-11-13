import { createClient } from '@supabase/supabase-js';
import type { PasswordSetupLink } from './password-setup-link';

export class PasswordSetupPolicyError extends Error {}

export interface PasswordSetupSession {
  email: string;
  save(password: string): Promise<void>;
}

export async function preparePasswordSetup(link: PasswordSetupLink, isCurrent: () => boolean): Promise<PasswordSetupSession> {
  // Deliberately bypass both local staff storage and Lovable's preview broker.
  // This client never emits a shared SIGNED_IN, clears staff caches, or switches
  // the actor behind an open clinical draft.
  const isolated = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: `password-setup-${crypto.randomUUID()}` },
  });
  const { data: sessionData, error: sessionError } = await isolated.auth.setSession({ access_token: link.accessToken, refresh_token: link.refreshToken });
  if (sessionError) throw sessionError;
  if (!sessionData.session || !isCurrent()) throw new Error('Password setup was cancelled.');
  const { data, error } = await isolated.auth.getUser(sessionData.session.access_token);
  if (error) throw error;
  if (!data.user.email || data.user.id !== sessionData.session.user.id || !isCurrent()) throw new Error('This password setup link is unavailable.');
  let used = false;
  return {
    email: data.user.email,
    async save(password: string) {
      if (used || !isCurrent()) throw new Error('Password setup was cancelled. Request a new link.');
      if (password.length < 12) throw new Error('Use at least 12 characters.');
      used = true;
      // Resolve session/expiry before the final intent fence. updateUser may
      // otherwise await a refresh and only then send a password mutation after
      // this page has been cancelled. An explicit bearer pins the exact account.
      const { data: fresh, error: refreshError } = await isolated.auth.getSession();
      if (refreshError) throw refreshError;
      if (!fresh.session || fresh.session.user.id !== data.user.id || !isCurrent()) throw new Error('Password setup was cancelled. Request a new link.');
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/auth/v1/user`, {
        method: 'PUT', redirect: 'error',
        headers: { apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${fresh.session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      // Do not echo provider payloads, passwords, URL tokens, or JWTs into UI/logs.
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 422) {
          used = false;
          throw new PasswordSetupPolicyError("Password could not be saved. Choose a different password that meets your account security requirements.");
        }
        throw new Error('Password could not be saved. It may not meet the account security requirements. Request a new link and try again.');
      }
      await response.body?.cancel();
    },
  };
}
