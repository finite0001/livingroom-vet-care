import {
  materializePaymentAccess,
  paymentGrantFromContext,
  type PaymentAccessConfig,
} from "./payment-access-capability.ts";
export interface PaymentStaffDatabase {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: unknown }>;
}
export interface PaymentStaffDependencies {
  enabled: boolean;
  origin: string | null;
  service: PaymentStaffDatabase;
  authenticate: (
    token: string,
  ) => Promise<{ actorId: string; db: PaymentStaffDatabase } | null>;
  config: () => PaymentAccessConfig;
}
interface StaffBody {
  p_request_id?: string;
  p_invoice_id: string;
  p_client_id?: string;
  p_source_hash?: string;
  p_amount_cents?: number;
  p_expires_at?: string;
}
const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  hash = /^[a-f0-9]{64}$/;
const unavailable = () => new Error("Payment collection unavailable");
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function text(value: unknown, pattern: RegExp): string {
  if (typeof value !== "string" || !pattern.test(value)) throw unavailable();
  return value;
}
function timestamp(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)))
    throw unavailable();
  return value;
}
function exact(value: Record<string, unknown>, keys: string[]) {
  if (Object.keys(value).sort().join(",") !== [...keys].sort().join(","))
    throw unavailable();
}
async function digest(value: string) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
  ]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
}
/** Project known staff fields only. Never forward service token hashes or unrestricted event text. */
export async function safePaymentCollection(
  value: unknown,
  actor: string,
  invoice: string,
  requestId?: string,
  clientId?: string,
) {
  if (value === null) return null;
  if (!object(value) || !object(value.grant)) throw unavailable();
  const raw = value.grant;
  const grant = {
    id: text(raw.id, uuid),
    invoice_id: text(raw.invoice_id, uuid),
    client_id: text(raw.client_id, uuid),
    actor_id: text(raw.actor_id, uuid),
    source_hash: text(raw.source_hash, hash),
    amount_cents: text(raw.amount_cents, /^[1-9][0-9]{0,7}$/),
    currency: raw.currency,
    created_at: timestamp(raw.created_at),
    expires_at: timestamp(raw.expires_at),
    status_expires_at: timestamp(raw.status_expires_at),
    state: text(raw.state, /^(preparing|captured|reviewed|revoked)$/),
    origin: null as string | null,
    key_version: null as string | null,
  };
  if (
    grant.actor_id !== actor ||
    grant.invoice_id !== invoice ||
    (requestId && grant.id !== requestId) ||
    (clientId && grant.client_id !== clientId) ||
    grant.currency !== "usd" ||
    BigInt(grant.amount_cents) < 50n
  )
    throw unavailable();
  const {
    state: _state,
    origin: _origin,
    key_version: _key,
    ...immutable
  } = grant;
  let capture: null | {
    grant_id: string;
    origin: string;
    key_version: string;
    context_version: number;
    capability_context: string;
    context_hash: string;
    created_at?: string;
  } = null;
  if (value.capture !== null) {
    if (!object(value.capture)) throw unavailable();
    const c = value.capture;
    const origin = text(c.origin, /^https:\/\/[a-z0-9.-]+(:[0-9]+)?$/),
      version = text(c.key_version, /^[A-Za-z0-9_-]{1,40}$/);
    if (
      c.grant_id !== grant.id ||
      c.context_version !== 2 ||
      typeof c.capability_context !== "string" ||
      c.capability_context.length > 8192 ||
      (await digest(c.capability_context)) !== text(c.context_hash, hash)
    )
      throw unavailable();
    const context: unknown = JSON.parse(c.capability_context);
    if (!object(context) || !object(context.grant)) throw unavailable();
    exact(context, [
      "domain",
      "context_version",
      "origin",
      "key_version",
      "grant",
    ]);
    exact(context.grant, Object.keys(immutable));
    if (
      context.domain !== "lrv-payment-collection/v2" ||
      context.context_version !== 2 ||
      context.origin !== origin ||
      context.key_version !== version
    )
      throw unavailable();
    for (const [key, expected] of Object.entries(immutable)) {
      const found = context.grant[key];
      if (["created_at", "expires_at", "status_expires_at"].includes(key)) {
        if (Date.parse(timestamp(found)) !== Date.parse(String(expected)))
          throw unavailable();
      } else if (found !== expected) throw unavailable();
    }
    capture = {
      grant_id: grant.id,
      origin,
      key_version: version,
      context_version: 2,
      capability_context: c.capability_context,
      context_hash: c.context_hash as string,
      ...(c.created_at === undefined
        ? {}
        : { created_at: timestamp(c.created_at) }),
    };
    grant.origin = origin;
    grant.key_version = version;
  }
  if (grant.state !== "preparing" && grant.state !== "revoked" && !capture)
    throw unavailable();
  if (!Array.isArray(value.events) || !Array.isArray(value.attempts))
    throw unavailable();
  const events = value.events.map((event) => {
    if (!object(event) || event.grant_id !== grant.id) throw unavailable();
    return {
      id: text(event.id, uuid),
      grant_id: grant.id,
      actor_id: text(event.actor_id, uuid),
      kind: text(event.kind, /^(reviewed|revoked)$/),
      context_hash:
        event.context_hash === null ? null : text(event.context_hash, hash),
      created_at: timestamp(event.created_at),
    };
  });
  const attempts = value.attempts.map((attempt) => {
    if (!object(attempt)) throw unavailable();
    return {
      request_id: text(attempt.request_id, uuid),
      state: text(
        attempt.state,
        /^(prepared|open|expired|paid|reconciliation)$/,
      ),
      created_at: timestamp(attempt.created_at),
    };
  });
  return { grant, capture, events, attempts, receipt: null };
}
async function rpc(
  db: PaymentStaffDatabase,
  name: string,
  args: Record<string, unknown>,
) {
  const result = await db.rpc(name, args);
  if (result.error) throw result.error;
  return result.data;
}
async function body(
  request: Request,
  mode: "prepare" | "recover",
): Promise<StaffBody> {
  const reader = request.body?.getReader();
  if (!reader) throw unavailable();
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      if (size > 2048) {
        await reader.cancel();
        throw unavailable();
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  const value: unknown = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes),
  );
  if (!object(value)) throw unavailable();
  if (mode === "prepare")
    exact(value, [
      "p_request_id",
      "p_invoice_id",
      "p_client_id",
      "p_source_hash",
      "p_amount_cents",
      "p_expires_at",
    ]);
  else if (
    Object.keys(value).some(
      (k) => !["p_invoice_id", "p_request_id"].includes(k),
    )
  )
    throw unavailable();
  text(value.p_invoice_id, uuid);
  if (mode === "prepare" || value.p_request_id !== undefined)
    text(value.p_request_id, uuid);
  if (mode === "prepare") {
    text(value.p_client_id, uuid);
    text(value.p_source_hash, hash);
    timestamp(value.p_expires_at);
    if (
      typeof value.p_amount_cents !== "number" ||
      !Number.isInteger(value.p_amount_cents) ||
      value.p_amount_cents < 50 ||
      value.p_amount_cents > 99999999
    )
      throw unavailable();
  }
  return value as unknown as StaffBody;
}
export function createStaffPaymentAccessHandler(
  deps: PaymentStaffDependencies,
  mode: "prepare" | "recover",
) {
  return async (request: Request): Promise<Response> => {
    const headers = {
      "Content-Type": "application/json",
      "Cache-Control": "no-store, private",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      Vary: "Origin",
      ...(deps.origin ? { "Access-Control-Allow-Origin": deps.origin } : {}),
      "Access-Control-Allow-Headers":
        "authorization,apikey,content-type,x-client-info",
      "Access-Control-Allow-Methods": "POST",
    };
    const reply = (status: number, value: unknown) =>
      new Response(JSON.stringify(value), { status, headers });
    const denied = (status: number) =>
      reply(status, { error: "Payment collection unavailable" });
    if (!deps.enabled || !deps.origin) return denied(503);
    if (
      request.headers.get("Origin") &&
      request.headers.get("Origin") !== deps.origin
    )
      return denied(403);
    if (request.method === "OPTIONS")
      return new Response(null, { status: 204, headers });
    if (request.method !== "POST") return denied(405);
    const bearer = request.headers
      .get("Authorization")
      ?.match(/^Bearer (\S+)$/)?.[1];
    if (!bearer) return denied(401);
    let auth: Awaited<ReturnType<PaymentStaffDependencies["authenticate"]>>;
    try {
      auth = await deps.authenticate(bearer);
    } catch {
      return denied(503);
    }
    if (!auth) return denied(401);
    let args: StaffBody;
    try {
      args = await body(request, mode);
    } catch {
      return denied(400);
    }
    const recover = async () =>
      safePaymentCollection(
        await rpc(auth!.db, "recover_payment_collection", {
          p_invoice_id: args.p_invoice_id,
          ...(args.p_request_id ? { p_request_id: args.p_request_id } : {}),
        }),
        auth!.actorId,
        args.p_invoice_id,
        args.p_request_id,
        args.p_client_id,
      );
    let saved: Awaited<ReturnType<typeof safePaymentCollection>>;
    try {
      saved = await recover();
    } catch {
      return denied(404);
    }
    if (mode === "recover") return reply(200, saved);
    let config: PaymentAccessConfig | undefined;
    if (!saved) {
      try {
        config = deps.config();
      } catch {
        return denied(503);
      }
    }
    let prepared = false;
    try {
      saved = await safePaymentCollection(
        await rpc(auth.db, "prepare_payment_collection", { ...args }),
        auth.actorId,
        args.p_invoice_id,
        args.p_request_id,
        args.p_client_id,
      );
      if (!saved) throw unavailable();
      prepared = true;
      if (saved.capture || saved.grant.state === "revoked")
        return reply(200, saved);
      config ??= deps.config();
      const context = await rpc(
        deps.service,
        "payment_collection_capture_context",
        {
          p_request_id: saved.grant.id,
          p_actor_id: auth.actorId,
          p_origin: config.origin,
          p_key_version: config.activeKeyVersion,
        },
      );
      const envelope = await safePaymentCollection(
        context,
        auth.actorId,
        args.p_invoice_id,
        args.p_request_id,
        args.p_client_id,
      );
      if (!envelope?.capture) throw unavailable();
      const frozen = paymentGrantFromContext(envelope);
      const capability = await materializePaymentAccess(frozen, config);
      await rpc(deps.service, "capture_payment_collection", {
        p_request_id: frozen.id,
        p_actor_id: auth.actorId,
        p_origin: frozen.origin,
        p_key_version: frozen.key_version,
        p_collection_token_hash: capability.collection_token_hash,
        p_status_token_hash: capability.status_token_hash,
      });
      const captured = await recover();
      if (!captured?.capture) throw unavailable();
      return reply(200, captured);
    } catch (error) {
      if (!prepared) {
        // Only SQL can confirm exact timestamp/intent equality, including microseconds.
        const code = object(error) ? error.code : undefined;
        if (["23505", "23514", "22023", "40001"].includes(String(code)))
          return denied(409);
        if (code === "42501") return denied(404);
      } else {
        // Preparation acknowledged this exact intent. Capture may have committed
        // before a lost acknowledgement, or another capture of that intent won.
        try {
          const recovered = await recover();
          if (recovered && (recovered.capture || recovered.grant.state === "revoked"))
            return reply(200, recovered);
        } catch {
          /* Keep the same request until its acknowledged intent is recoverable. */
        }
      }
      return reply(202, {
        error: "Payment collection preparation unconfirmed",
        retry_requires_recovery: true,
        request_id: args.p_request_id,
      });
    }
  };
}
