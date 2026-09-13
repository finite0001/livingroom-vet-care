export interface CollectionIntent {
  p_request_id: string;
  p_invoice_id: string;
  p_client_id: string;
  p_source_hash: string;
  p_amount_cents: number;
  p_expires_at: string;
}
export interface CollectionGrant {
  id: string;
  invoice_id: string;
  client_id: string;
  actor_id: string;
  source_hash: string;
  amount_cents: string;
  currency: "usd";
  created_at: string;
  expires_at: string;
  status_expires_at: string;
  state: "preparing" | "captured" | "reviewed" | "revoked";
  contextHash: string | null;
}
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const hash = /^[a-f0-9]{64}$/;
const invalid = () =>
  new Error("Payment access metadata could not be verified.");
function object(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
function string(v: unknown, re: RegExp) {
  if (typeof v !== "string" || !re.test(v)) throw invalid();
  return v;
}
function date(v: unknown) {
  if (typeof v !== "string" || !Number.isFinite(Date.parse(v))) throw invalid();
  return v;
}
export function collectionIntent(
  value: unknown,
  invoice: string,
  client: string,
): CollectionIntent {
  if (
    !object(value) ||
    Object.keys(value).sort().join(",") !==
      [
        "p_request_id",
        "p_invoice_id",
        "p_client_id",
        "p_source_hash",
        "p_amount_cents",
        "p_expires_at",
      ]
        .sort()
        .join(",")
  )
    throw invalid();
  string(value.p_request_id, uuid);
  if (value.p_invoice_id !== invoice || value.p_client_id !== client)
    throw invalid();
  string(value.p_source_hash, hash);
  date(value.p_expires_at);
  if (
    typeof value.p_amount_cents !== "number" ||
    !Number.isInteger(value.p_amount_cents) ||
    value.p_amount_cents < 50 ||
    value.p_amount_cents > 99999999
  )
    throw invalid();
  return value as unknown as CollectionIntent;
}
export function matchesCollectionIntent(
  grant: CollectionGrant,
  intent: CollectionIntent,
) {
  return (
    grant.id === intent.p_request_id &&
    grant.invoice_id === intent.p_invoice_id &&
    grant.client_id === intent.p_client_id &&
    grant.source_hash === intent.p_source_hash &&
    grant.amount_cents === String(intent.p_amount_cents) &&
    Date.parse(grant.expires_at) === Date.parse(intent.p_expires_at)
  );
}
/** Keep only metadata the interface needs. Never retain raw RPC responses or canonical context. */
export async function parseCollection(
  value: unknown,
  actor: string,
  invoice: string,
  client: string,
  request?: string,
): Promise<CollectionGrant | null> {
  if (value === null) return null;
  if (!object(value) || !object(value.grant)) throw invalid();
  const g = value.grant;
  const row: CollectionGrant = {
    id: string(g.id, uuid),
    invoice_id: string(g.invoice_id, uuid),
    client_id: string(g.client_id, uuid),
    actor_id: string(g.actor_id, uuid),
    source_hash: string(g.source_hash, hash),
    amount_cents: string(g.amount_cents, /^[1-9][0-9]{0,7}$/),
    currency: "usd",
    created_at: date(g.created_at),
    expires_at: date(g.expires_at),
    status_expires_at: date(g.status_expires_at),
    state: string(
      g.state,
      /^(preparing|captured|reviewed|revoked)$/,
    ) as CollectionGrant["state"],
    contextHash: null,
  };
  if (
    row.actor_id !== actor ||
    row.invoice_id !== invoice ||
    row.client_id !== client ||
    (request && row.id !== request) ||
    g.currency !== "usd" ||
    BigInt(row.amount_cents) < 50n ||
    Date.parse(row.status_expires_at) - Date.parse(row.expires_at) !==
      30 * 86400000
  )
    throw invalid();
  if (value.capture !== null) {
    if (!object(value.capture)) throw invalid();
    const c = value.capture;
    if (
      c.grant_id !== row.id ||
      c.context_version !== 2 ||
      typeof c.capability_context !== "string" ||
      c.capability_context.length > 8192
    )
      throw invalid();
    const digest = [
      ...new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(c.capability_context),
        ),
      ),
    ]
      .map((v) => v.toString(16).padStart(2, "0"))
      .join("");
    if (digest !== string(c.context_hash, hash)) throw invalid();
    const ctx: unknown = JSON.parse(c.capability_context);
    if (
      !object(ctx) ||
      !object(ctx.grant) ||
      ctx.domain !== "lrv-payment-collection/v2" ||
      ctx.context_version !== 2 ||
      ctx.origin !== c.origin ||
      ctx.key_version !== c.key_version
    )
      throw invalid();
    for (const key of [
      "id",
      "invoice_id",
      "client_id",
      "actor_id",
      "source_hash",
      "amount_cents",
      "currency",
    ] as const)
      if (ctx.grant[key] !== row[key]) throw invalid();
    for (const key of [
      "created_at",
      "expires_at",
      "status_expires_at",
    ] as const)
      if (Date.parse(date(ctx.grant[key])) !== Date.parse(row[key]))
        throw invalid();
    row.contextHash = digest;
  }
  if (["captured", "reviewed"].includes(row.state) && !row.contextHash)
    throw invalid();
  return row;
}
export function collectionCurrent(
  grant: CollectionGrant,
  sourceHash: string,
  amount: string,
  now = Date.now(),
) {
  return (
    grant.source_hash === sourceHash &&
    grant.amount_cents === amount &&
    Date.parse(grant.expires_at) > now
  );
}
