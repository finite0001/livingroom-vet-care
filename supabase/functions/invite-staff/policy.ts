export interface Invitation {
  email: string;
  first_name: string;
  last_name: string;
}

export function parseInvitation(input: unknown): Invitation {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid invitation");
  const values = input as Record<string, unknown>;
  if (Object.keys(values).some((key) => !["email", "first_name", "last_name"].includes(key))) throw new Error("Unexpected invitation field");
  const result = {} as Invitation;
  for (const key of ["email", "first_name", "last_name"] as const) {
    if (typeof values[key] !== "string") throw new Error(`Invalid ${key}`);
    result[key] = values[key].trim();
    if (!result[key] || result[key].length > (key === "email" ? 254 : 100) || Array.from(result[key]).some((character) => character.charCodeAt(0) < 32)) throw new Error(`Invalid ${key}`);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.email)) throw new Error("Invalid email");
  result.email = result.email.toLowerCase();
  return result;
}

export function invitationRedirect(appUrl: string | undefined): string {
  if (!appUrl) throw new Error("APP_URL is required");
  const url = new URL(appUrl);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("APP_URL must be an origin");
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) throw new Error("APP_URL must use HTTPS");
  return `${url.origin}/hub/reset-password`;
}

export function canInvite(profile: { is_active: boolean } | null, roles: { role: string }[]): boolean {
  return profile?.is_active === true && roles.some(({ role }) => role === "ADMIN");
}

export function isInvitationOriginAllowed(origin: string | null, redirectTo: string): boolean {
  // Origin-less trusted API clients must still pass the same token/admin checks.
  return origin === null || origin === new URL(redirectTo).origin;
}
