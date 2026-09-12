export const resources = [
  "contact",
  "contactdetail",
  "address",
  "animal",
  "species",
  "breed",
  "sex",
  "animalcolour",
  "appointment",
  "consult",
  "history",
  "vaccination",
  "diagnostic",
] as const;
export type Resource = (typeof resources)[number];
export interface EzyVetConfig {
  baseUrl: string;
  siteUid: string;
  partnerId: string;
  clientId: string;
  clientSecret: string;
  readResources: Resource[];
}
export interface StagedEntity {
  external_id: string;
  payload: Record<string, unknown>;
}
export interface PageResult {
  items: StagedEntity[];
  complete: boolean;
  page: number;
}
export class ImportError extends Error {
  code: string;
  retryAfter: number;
  constructor(code: string, retryAfter = 0) {
    super(code);
    this.code = code;
    this.retryAfter = retryAfter;
  }
}
export function configuration(
  env: (key: string) => string | undefined,
): EzyVetConfig {
  if (env("EZYVET_IMPORT_MODE") !== "staging" || env("APP_ENV") !== "staging")
    throw new ImportError("IMPORT_DISABLED");
  const baseUrl = env("EZYVET_API_URL") || "https://api.trial.ezyvet.com";
  if (
    !["https://api.trial.ezyvet.com", "https://api.ezyvet.com"].includes(
      baseUrl,
    )
  )
    throw new ImportError("INVALID_API_HOST");
  if (
    baseUrl === "https://api.ezyvet.com" &&
    env("EZYVET_ALLOW_PRODUCTION_SOURCE") !== "true"
  )
    throw new ImportError("PRODUCTION_SOURCE_DISABLED");
  const fields = [
    "EZYVET_SITE_UID",
    "EZYVET_PARTNER_ID",
    "EZYVET_CLIENT_ID",
    "EZYVET_CLIENT_SECRET",
  ];
  const values = fields.map((key) => env(key));
  if (
    values.some(
      (value) => !value || value.length > 4096 || /[\r\n]/.test(value),
    )
  )
    throw new ImportError("MISSING_CONFIGURATION");
  const readResources = (
    env("EZYVET_READ_RESOURCES") || "contact,animal"
  ).split(",");
  if (
    readResources.length === 0 ||
    readResources.some((value) => !resources.includes(value as Resource)) ||
    new Set(readResources).size !== readResources.length
  )
    throw new ImportError("INVALID_READ_SCOPES");
  return {
    readResources: readResources as Resource[],
    baseUrl,
    siteUid: values[0]!,
    partnerId: values[1]!,
    clientId: values[2]!,
    clientSecret: values[3]!,
  };
}
function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function integer(value: unknown): number {
  const number =
    typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  return typeof number === "number" && Number.isSafeInteger(number)
    ? number
    : NaN;
}
const excluded =
  /^(access_token|refresh_token|authorization|password|client_secret|partner_secret|driver_license_number|driver_license_issuer|driver_license_expiry)$/i;
function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 20) throw new ImportError("INVALID_UPSTREAM_SHAPE");
  if (Array.isArray(value))
    return value.map((item) => sanitize(item, depth + 1));
  if (record(value))
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !excluded.test(key))
        .map(([key, item]) => [key, sanitize(item, depth + 1)]),
    );
  return value;
}
export function parsePage(
  body: unknown,
  resource: Resource,
  page: number,
): PageResult {
  if (
    !record(body) ||
    !Array.isArray(body.items) ||
    !record(body.meta) ||
    body.items.length > 50
  )
    throw new ImportError("INVALID_UPSTREAM_SHAPE");
  const current = integer(body.meta.items_page);
  const total = integer(body.meta.items_page_total);
  if (
    current !== page ||
    !Number.isFinite(total) ||
    total < 0 ||
    (total < page && !(page === 1 && total === 0 && body.items.length === 0))
  )
    throw new ImportError("INVALID_UPSTREAM_CURSOR");
  if (page < total && body.items.length === 0)
    throw new ImportError("EMPTY_INTERMEDIATE_PAGE");
  const ids = new Set<string>();
  const items = body.items.map((item) => {
    if (!record(item) || !record(item[resource]))
      throw new ImportError("INVALID_UPSTREAM_SHAPE");
    const payload = item[resource] as Record<string, unknown>;
    const id =
      typeof payload.id === "string"
        ? payload.id
        : Number.isSafeInteger(payload.id)
          ? String(payload.id)
          : "";
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(id) || ids.has(id))
      throw new ImportError("DUPLICATE_OR_INVALID_EXTERNAL_ID");
    ids.add(id);
    return {
      external_id: id,
      payload: sanitize(
        resource === "contact"
          ? Object.fromEntries(
              Object.entries(payload).filter(
                ([key]) => key !== "date_of_birth",
              ),
            )
          : payload,
      ) as Record<string, unknown>,
    };
  });
  return { page, complete: total <= page, items };
}
export interface AdapterDependencies {
  fetch: typeof fetch;
  sleep: (milliseconds: number) => Promise<void>;
  now: () => number;
}
export function createAdapter(
  config: EzyVetConfig,
  dependencies: AdapterDependencies,
) {
  let token: { value: string; expiresAt: number } | null = null;
  async function request(url: string, init: RequestInit): Promise<Response> {
    for (let attempt = 0; attempt < 3; attempt++) {
      let response: Response;
      try {
        response = await dependencies.fetch(url, {
          ...init,
          redirect: "error",
          signal: AbortSignal.timeout(5000),
        });
      } catch {
        if (attempt === 2) throw new ImportError("UPSTREAM_UNAVAILABLE");
        await dependencies.sleep(250 * 2 ** attempt);
        continue;
      }
      if (response.status === 429) {
        const raw = Number(
          response.headers.get("retry-after") ||
            response.headers.get("x-ratelimit-reset") ||
            "60",
        );
        await response.body?.cancel();
        throw new ImportError(
          "RATE_LIMITED",
          Number.isFinite(raw) ? Math.max(1, Math.min(3600, raw)) : 60,
        );
      }
      if (response.status >= 500 && attempt < 2) {
        await response.body?.cancel();
        await dependencies.sleep(250 * 2 ** attempt);
        continue;
      }
      return response;
    }
    throw new ImportError("UPSTREAM_UNAVAILABLE");
  }
  async function json(response: Response): Promise<unknown> {
    // Enforce the bound while streaming, including chunked responses without Content-Length.
    if (!response.body) throw new ImportError("INVALID_UPSTREAM_JSON");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.length;
        if (bytes > 2 * 1024 * 1024) {
          await reader.cancel();
          throw new ImportError("UPSTREAM_RESPONSE_TOO_LARGE");
        }
        chunks.push(chunk.value);
      }
    } finally {
      reader.releaseLock();
    }
    const body = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.length;
    }
    try {
      return JSON.parse(new TextDecoder().decode(body));
    } catch {
      throw new ImportError("INVALID_UPSTREAM_JSON");
    }
  }
  async function accessToken(): Promise<string> {
    if (token && token.expiresAt > dependencies.now() + 60_000)
      return token.value;
    const response = await request(`${config.baseUrl}/v1/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        partner_id: config.partnerId,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        site_uid: config.siteUid,
        grant_type: "client_credentials",
        scope: config.readResources
          .map((resource) => `read-${resource}`)
          .join(" "),
      }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new ImportError("UPSTREAM_AUTH_FAILED");
    }
    const body = await json(response);
    if (
      !record(body) ||
      typeof body.access_token !== "string" ||
      !body.access_token ||
      body.access_token.length > 16384
    )
      throw new ImportError("INVALID_TOKEN_RESPONSE");
    // Vendor documentation describes both a TTL and epoch expiry; handle either, capped at 12h.
    const expiry = integer(body.expires_in);
    const now = dependencies.now();
    const ttl = expiry > now / 1000 ? expiry * 1000 - now : expiry * 1000;
    if (!Number.isFinite(ttl) || ttl <= 60_000)
      throw new ImportError("INVALID_TOKEN_RESPONSE");
    token = {
      value: body.access_token,
      expiresAt: now + Math.min(ttl, 12 * 60 * 60 * 1000),
    };
    return token.value;
  }
  return {
    async page(resource: Resource, page: number): Promise<PageResult> {
      if (
        !config.readResources.includes(resource) ||
        !Number.isInteger(page) ||
        page < 1 ||
        page > 1000
      )
        throw new ImportError("INVALID_PAGE_REQUEST");
      for (let attempt = 0; attempt < 2; attempt++) {
        const bearer = await accessToken();
        const response = await request(
          `${config.baseUrl}/v1/${resource}?page=${page}&limit=50`,
          { method: "GET", headers: { Authorization: `Bearer ${bearer}` } },
        );
        if (response.status === 401 && attempt === 0) {
          await response.body?.cancel();
          token = null;
          continue;
        }
        if (!response.ok) {
          await response.body?.cancel();
          throw new ImportError(
            response.status === 403
              ? "UPSTREAM_SCOPE_DENIED"
              : "UPSTREAM_REQUEST_FAILED",
          );
        }
        return parsePage(await json(response), resource, page);
      }
      throw new ImportError("UPSTREAM_AUTH_FAILED");
    },
  };
}
