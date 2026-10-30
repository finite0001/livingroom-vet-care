import { z } from "zod";
import { decodeExactJson, ExactJsonNumber, protocolInteger, validUnicode, type ExactJson } from "../record-review/exact-json.ts";

const uuid = z.string().regex(/^(?!00000000-0000-0000-0000-000000000000$)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
const timestamp = z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$/)
  .refine(value => value.slice(0, 4) !== "0000" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === `${value.slice(0, 23)}Z`);
const label = z.string().min(1).refine(value => validUnicode(value) && !value.includes("\0") && [...value].length <= 200 && value.trim().length > 0 && new TextEncoder().encode(value).length <= 800);
const cursor = z.object({ captured_at: timestamp, count_id: uuid }).strict();
const requestSchema = z.object({ schema_version: z.literal(1), actor_id: uuid, product_id: uuid, site_id: uuid,
  cursor: cursor.nullable(), page_size: z.number().int().min(1).max(100) }).strict();
const capabilitySchema = z.object({ observe: z.boolean(), manage: z.boolean(), reconciliation_prepare: z.boolean(),
  reconciliation_approve: z.boolean(), reconciliation_execute: z.boolean(), reconciliation_confirm: z.boolean(), cause_resolve: z.boolean() }).strict();
const actionSchema = z.enum(["start", "statement", "finalize", "cancel", "read", "recover", "operation_closure", "discovery",
  "reconciliation_prepare", "reconciliation_approve", "reconciliation_execute", "reconciliation_confirm", "cause_resolve", "management_read", "management_recover"]);
const participantSchema = z.object({ slot: z.enum(["A", "B"]), id: uuid, name: label, submitted: z.boolean() }).strict();
const entrySchema = z.object({ count_id: uuid, captured_at: timestamp,
  history_state: z.enum(["open", "agreement", "variance", "stale", "cancelled"]), participants: z.array(participantSchema).length(2) }).strict();
const replySchema = z.object({ schema_version: z.literal(1), product_id: uuid, site_id: uuid, capabilities: capabilitySchema,
  available_actions: z.array(actionSchema).max(15), observers: z.array(z.object({ id: uuid, name: label }).strict()).max(256),
  counts: z.array(entrySchema).max(100), next_cursor: cursor.nullable(), has_more: z.boolean() }).strict();

export interface CountDiscoveryCursor { readonly captured_at: string; readonly count_id: string }
export interface CountDiscoveryRequest {
  readonly schema_version: 1; readonly actor_id: string; readonly product_id: string; readonly site_id: string;
  readonly cursor: CountDiscoveryCursor | null; readonly page_size: number;
}
export interface CountDiscoveryParticipant { readonly slot: "A" | "B"; readonly id: string; readonly name: string; readonly submitted: boolean }
export interface CountDiscoveryEntry {
  readonly count_id: string; readonly captured_at: string; readonly history_state: "open" | "agreement" | "variance" | "stale" | "cancelled";
  readonly participants: readonly CountDiscoveryParticipant[];
}
export interface CountDiscoveryReply {
  readonly schema_version: 1; readonly product_id: string; readonly site_id: string;
  readonly capabilities: Readonly<z.infer<typeof capabilitySchema>>;
  readonly available_actions: readonly z.infer<typeof actionSchema>[];
  readonly observers: readonly Readonly<{ id: string; name: string }>[];
  readonly counts: readonly CountDiscoveryEntry[]; readonly next_cursor: CountDiscoveryCursor | null; readonly has_more: boolean;
}
function invalid(): never { throw new Error("The count list could not be verified. Refresh before continuing."); }
function freeze<T>(input: T): T {
  if (input && typeof input === "object") { Object.values(input).forEach(freeze); Object.freeze(input); }
  return input;
}
/** Only enumerable data fields reach Zod; callers cannot execute accessors. */
function snapshot(input: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!input || typeof input !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) invalid();
  const actual = Reflect.ownKeys(input);
  if (actual.length !== keys.length || actual.some(key => typeof key !== "string" || !keys.includes(key))) invalid();
  const value: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) invalid();
    value[key] = key === "cursor" && descriptor.value !== null ? snapshot(descriptor.value, ["captured_at", "count_id"]) : descriptor.value;
  }
  return value;
}
export function parseCountDiscoveryRequest(input: unknown): CountDiscoveryRequest {
  const parsed = requestSchema.safeParse(snapshot(input, ["schema_version", "actor_id", "product_id", "site_id", "cursor", "page_size"]));
  if (!parsed.success) invalid();
  return freeze(parsed.data) as CountDiscoveryRequest;
}
function ordinary(value: ExactJson): unknown {
  if (value instanceof ExactJsonNumber) return protocolInteger(value, 1, 1);
  if (Array.isArray(value)) return value.map(ordinary);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, ordinary(child)]));
  return value;
}
function compare(a: CountDiscoveryCursor, b: CountDiscoveryCursor): number {
  return a.captured_at < b.captured_at ? -1 : a.captured_at > b.captured_at ? 1 : a.count_id < b.count_id ? -1 : a.count_id > b.count_id ? 1 : 0;
}
/** Public list, never quantities. Authentication and current authority remain server checks. */
export function parseCountDiscoveryReply(raw: Uint8Array, input: unknown): CountDiscoveryReply {
  const request = parseCountDiscoveryRequest(input);
  const intrinsic = Object.getPrototypeOf(Uint8Array.prototype);
  const length = Object.getOwnPropertyDescriptor(intrinsic, "byteLength")!.get!.call(raw) as number;
  if (Object.getOwnPropertyDescriptor(intrinsic, Symbol.toStringTag)!.get!.call(raw) !== "Uint8Array" || length > 2 * 1024 * 1024) invalid();
  const copy = new Uint8Array(length); Uint8Array.prototype.set.call(copy, raw);
  const parsed = replySchema.safeParse(ordinary(decodeExactJson(copy)));
  if (!parsed.success) invalid();
  const reply = parsed.data as CountDiscoveryReply;
  if (reply.product_id !== request.product_id || reply.site_id !== request.site_id || reply.counts.length > request.page_size ||
    new Set(reply.available_actions).size !== reply.available_actions.length || new Set(reply.observers.map(observer => observer.id)).size !== reply.observers.length ||
    new Set(reply.counts.map(count => count.count_id)).size !== reply.counts.length || (!reply.capabilities.observe && reply.observers.length > 0)) invalid();
  let previous = request.cursor;
  for (const count of reply.counts) {
    if (previous && compare(count, previous) >= 0) invalid();
    if (count.participants[0].slot !== "A" || count.participants[1].slot !== "B" || count.participants[0].id === count.participants[1].id) invalid();
    previous = count;
  }
  if (reply.has_more ? !reply.next_cursor || !reply.counts.length || compare(reply.next_cursor, reply.counts.at(-1)!) !== 0 : reply.next_cursor !== null) invalid();
  return freeze(reply);
}
