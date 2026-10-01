/**
 * Where to send staff after signing in. Only same-origin hub paths are
 * honoured (never the login page itself, protocol-relative URLs or anything
 * with a scheme), so a crafted `state.from` cannot bounce a user off-site.
 */
export const DEFAULT_HUB_PATH = "/hub";

const HUB_PATH = /^\/hub(?:[/?#]|$)/;

export function safeHubRedirect(from: unknown): string {
  if (typeof from !== "string") return DEFAULT_HUB_PATH;
  if (from.length > 2048) return DEFAULT_HUB_PATH;
  if (!HUB_PATH.test(from)) return DEFAULT_HUB_PATH;
  // Backslashes and control characters can be normalised into another origin.
  for (const char of from) {
    const code = char.charCodeAt(0);
    if (char === "\\" || code < 0x20 || code === 0x7f) return DEFAULT_HUB_PATH;
  }
  const path = from.split(/[?#]/, 1)[0];
  if (path.split("/").some((segment) => segment === "." || segment === "..")) return DEFAULT_HUB_PATH;
  if (path === "/hub/login" || path.startsWith("/hub/login/") || path === "/hub/reset-password") return DEFAULT_HUB_PATH;
  return from;
}

/** Location state ProtectedRoute hands to the login page. */
export interface LoginRedirectState {
  from?: string;
}

export function loginRedirectFrom(state: unknown): string {
  const from = state && typeof state === "object" ? (state as LoginRedirectState).from : undefined;
  return safeHubRedirect(from);
}
