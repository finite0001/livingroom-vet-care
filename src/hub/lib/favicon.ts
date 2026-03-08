const PERSONAL_PROVIDERS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.uk", "ymail.com",
  "hotmail.com", "outlook.com", "live.com", "msn.com", "aol.com",
  "icloud.com", "me.com", "mac.com", "protonmail.com", "proton.me",
  "mail.com", "email.com", "zoho.com", "fastmail.com", "hey.com",
  "tutanota.com", "tuta.io", "gmx.com", "gmx.net", "yandex.com", "yandex.ru",
  "comcast.net", "verizon.net", "att.net", "sbcglobal.net",
  "cox.net", "charter.net", "earthlink.net",
]);

const MARKETING_DOMAINS = new Set([
  "ccsend.com", "shared1.ccsend.com", "mailchimpapp.com", "delighted.com",
  "promoboxx.com", "sendgrid.net", "mcsv.net", "mailgun.org",
  "amazonses.com", "mandrillapp.com",
]);

const MULTI_PART_TLDS = [
  "co.uk", "co.jp", "co.kr", "co.nz", "co.za", "co.in",
  "com.au", "com.br", "com.mx", "com.cn", "com.sg", "com.ar",
  "org.uk", "org.au", "net.au", "ac.uk",
];

export const FAVICON_MIN_SIZE = 8;

const _cache = new Map<string, string | null>();
const _urlFailed = new Set<string>();

function extractEmail(raw: string): string | null {
  if (!raw) return null;
  const match = raw.match(/<([^>]+)>/);
  if (match) return match[1].trim();
  return raw.trim();
}

function getRegistrableDomain(domain: string): string {
  const parts = domain.split(".");
  for (const tld of MULTI_PART_TLDS) {
    if (domain.endsWith(`.${tld}`) || domain === tld) {
      const tldParts = tld.split(".").length;
      if (parts.length > tldParts) return parts.slice(-(tldParts + 1)).join(".");
      return domain;
    }
  }
  if (parts.length > 2) return parts.slice(-2).join(".");
  return domain;
}

function resolveBrandDomain(email: string | null | undefined): string | null {
  if (!email) return null;
  const cleaned = extractEmail(email);
  if (!cleaned) return null;
  const atParts = cleaned.split("@");
  if (atParts.length !== 2) return null;
  const domain = atParts[1].toLowerCase().trim();
  if (!domain) return null;
  if (PERSONAL_PROVIDERS.has(domain)) return null;
  for (const md of MARKETING_DOMAINS) {
    if (domain === md || domain.endsWith(`.${md}`)) return null;
  }
  return getRegistrableDomain(domain);
}

export function getFaviconCandidates(email: string | null | undefined): string[] {
  const domain = resolveBrandDomain(email);
  if (!domain) return [];
  return [
    `https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://${encodeURIComponent(domain)}&size=128`,
    `https://icons.duckduckgo.com/ip3/${domain}.ico`,
  ];
}

export function markFaviconFailed(url: string) { _urlFailed.add(url); }
export function isFaviconFailed(url: string): boolean { return _urlFailed.has(url); }

export function getCachedFavicon(email: string | null | undefined): string | null | undefined {
  const domain = resolveBrandDomain(email);
  if (!domain) return null;
  if (_cache.has(domain)) return _cache.get(domain) ?? null;
  return undefined;
}

export function setCachedFavicon(email: string | null | undefined, url: string | null) {
  const domain = resolveBrandDomain(email);
  if (domain) _cache.set(domain, url);
}
