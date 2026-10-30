import { z } from "zod";
import { decodeExactJson, ExactJsonNumber, protocolInteger, validUnicode, type ExactJson } from "../record-review/exact-json.ts";

const encoder = new TextEncoder();
const uuid = z.string().regex(/^(?!00000000-0000-0000-0000-000000000000$)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
const digest = z.string().regex(/^[0-9a-f]{64}$/);
const version = z.string().regex(/^[1-9][0-9]{0,18}$/).refine(value => /^[1-9][0-9]{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n);
const timestamp = z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$/)
  .refine(value => value.slice(0, 4) !== "0000" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === `${value.slice(0, 23)}Z`);
const blanks = new Set([9, 10, 11, 12, 13, 32, 133, 160, 5760, 8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199, 8200, 8201, 8202, 8203, 8232, 8233, 8239, 8287, 12288, 65279]);
function text(characters: number, bytes: number, requireNonblank: boolean) {
  return z.string().min(1).refine(value => {
    const points = [...value];
    return validUnicode(value) && !value.includes("\0") && points.length <= characters && encoder.encode(value).length <= bytes &&
      (!requireNonblank || points.some(point => !blanks.has(point.codePointAt(0)!)));
  });
}
export const countConfirmationTextSchema = text(2000, 8000, true);
export const countConfirmationVersionSchema = text(80, 320, true);
export const countPolicyRoles = ["ADMIN", "DVM", "STAFF", "TECH"] as const;
export type CountPolicyRole = typeof countPolicyRoles[number];
const roles = z.array(z.enum(countPolicyRoles)).max(4).refine(value => value.every((role, index) => index === 0 || value[index - 1] < role));
export const countPolicySettingsSchema = z.object({
  observation_enabled: z.boolean(), management_enabled: z.boolean(), read_enabled: z.boolean(), reconciliation_enabled: z.boolean(),
  methods: z.union([z.tuple([]), z.tuple([z.literal("manual_count")])]), observer_roles: roles, manager_roles: roles, reader_roles: roles,
  reconciliation_preparer_roles: roles, reconciliation_approver_roles: roles, reconciliation_executor_roles: roles, reconciliation_confirmer_roles: roles, reconciliation_resolver_roles: roles,
  max_observation_age_seconds: z.number().int().min(1).max(86400), max_reconciliation_preparation_age_seconds: z.number().int().min(1).max(900),
  max_reconciliation_approval_age_seconds: z.number().int().min(1).max(900), max_reconciliation_confirmation_age_seconds: z.number().int().min(1).max(900),
  meaning_text: countConfirmationTextSchema, meaning_version: countConfirmationVersionSchema, reconciliation_meaning_text: countConfirmationTextSchema, reconciliation_meaning_version: countConfirmationVersionSchema,
}).strict().superRefine((value, context) => {
  const pairs = [[value.observation_enabled, value.observer_roles], [value.management_enabled, value.manager_roles], [value.read_enabled, value.reader_roles],
    ...[value.reconciliation_preparer_roles, value.reconciliation_approver_roles, value.reconciliation_executor_roles, value.reconciliation_confirmer_roles, value.reconciliation_resolver_roles].map(set => [value.reconciliation_enabled, set] as const)] as const;
  if (pairs.some(([enabled, set]) => enabled && !set.length) || (value.observation_enabled && value.methods[0] !== "manual_count"))
    context.addIssue({ code: "custom", message: "Enabled actions need explicit eligible roles and observation method." });
});
export interface CountPolicySettings extends Required<z.infer<typeof countPolicySettingsSchema>> {}
const scopeCursor = z.object({ product_id: uuid, site_id: uuid }).strict();
const principal = { schema_version: z.literal(1), actor_id: uuid };
const scopePrincipal = { ...principal, product_id: uuid, site_id: uuid };
const scopeRequest = z.object({ ...principal, cursor: scopeCursor.nullable(), page_size: z.number().int().min(1).max(100) }).strict();
const capabilities = z.object({ configure: z.boolean(), read: z.boolean(), observe: z.boolean(), manage: z.boolean(), reconciliation_prepare: z.boolean(),
  reconciliation_approve: z.boolean(), reconciliation_execute: z.boolean(), reconciliation_confirm: z.boolean(), cause_resolve: z.boolean() }).strict();
const scopeItem = z.object({ product_id: uuid, product_name: text(2048, 2048, false), site_id: uuid, site_name: text(2048, 2048, false),
  policy_id: uuid.nullable(), policy_version: version.nullable(), capabilities }).strict().refine(value => (value.policy_id === null) === (value.policy_version === null));
const scopeReply = z.object({ schema_version: z.literal(1), items: z.array(scopeItem).max(100), next_cursor: scopeCursor.nullable(), has_more: z.boolean() }).strict();
const policyRequest = z.object(scopePrincipal).strict();
const policy = z.object({ policy_id: uuid, version, prior_policy_id: uuid.nullable(), recorded_at: timestamp,
  actor: z.object({ id: uuid, name: text(200, 800, false) }).strict(), settings: countPolicySettingsSchema }).strict()
  .refine(value => (value.version === "1") === (value.prior_policy_id === null));
const policyReply = z.object({ schema_version: z.literal(1), state: z.enum(["configured", "unconfigured"]),
  data: z.object({ product_id: uuid, site_id: uuid, policy: policy.nullable() }).strict() }).strict()
  .refine(value => (value.state === "unconfigured") === (value.data.policy === null));
const publishRequest = z.object({ ...scopePrincipal, operation_id: uuid, expected_prior_policy_id: uuid.nullable(), settings: countPolicySettingsSchema }).strict();
const publishReceipt = z.object({ ...scopePrincipal, action: z.literal("policy_publish"), operation_id: uuid, request_digest: digest,
  result_ref: z.object({ kind: z.literal("policy"), id: uuid, version }).strict(), receipt_digest: digest }).strict()
  .refine(value => value.operation_id === value.result_ref.id);
const policyClosureFields = { schema_version: z.literal(2), actor_id: uuid, operation_id: uuid, original_action: z.literal("policy_publish"), scope_id: uuid, product_id: uuid, site_id: uuid };
const policyClosureRequest = z.object(policyClosureFields).strict().refine(value => value.operation_id === value.scope_id);
const policyClosureReply = z.object({ ...policyClosureFields, action: z.literal("operation_closure"), state: z.enum(["pending", "saved", "abandoned"]),
  receipt: publishReceipt.nullable(), receipt_digest: digest }).strict().superRefine((value, context) => {
  const receipt = value.receipt;
  if (value.scope_id !== value.operation_id || (value.state === "saved" ? !receipt || receipt.actor_id !== value.actor_id || receipt.operation_id !== value.operation_id ||
    receipt.product_id !== value.product_id || receipt.site_id !== value.site_id : receipt !== null))
    context.addIssue({ code: "custom", message: "Policy closure does not match the original publication." });
});
export interface CountScopeCursor { readonly product_id: string; readonly site_id: string }
export interface CountScopeRequest { readonly schema_version: 1; readonly actor_id: string; readonly cursor: CountScopeCursor | null; readonly page_size: number }
export interface CountScopeItem extends CountScopeCursor {
  readonly product_name: string; readonly site_name: string; readonly policy_id: string | null; readonly policy_version: string | null;
  readonly capabilities: Readonly<Required<z.infer<typeof capabilities>>>;
}
export interface CountScopeReply { readonly schema_version: 1; readonly items: readonly CountScopeItem[]; readonly next_cursor: CountScopeCursor | null; readonly has_more: boolean }
export interface CountPolicyRequest extends CountScopeCursor { readonly schema_version: 1; readonly actor_id: string }
export interface CountConfiguredPolicy {
  readonly policy_id: string; readonly version: string; readonly prior_policy_id: string | null; readonly recorded_at: string;
  readonly actor: Readonly<{ id: string; name: string }>; readonly settings: CountPolicySettings;
}
export interface CountPolicyReply {
  readonly schema_version: 1; readonly state: "configured" | "unconfigured";
  readonly data: { readonly product_id: string; readonly site_id: string; readonly policy: CountConfiguredPolicy | null };
}
export interface CountPolicyPublishRequest extends CountPolicyRequest {
  readonly operation_id: string; readonly expected_prior_policy_id: string | null; readonly settings: CountPolicySettings;
}
export interface CountPolicyPublishReceipt extends CountPolicyRequest {
  readonly action: "policy_publish"; readonly operation_id: string; readonly request_digest: string; readonly receipt_digest: string;
  readonly result_ref: { readonly kind: "policy"; readonly id: string; readonly version: string };
}
export interface CountPolicyClosureRequest {
  readonly schema_version: 2; readonly actor_id: string; readonly operation_id: string; readonly original_action: "policy_publish";
  readonly scope_id: string; readonly product_id: string; readonly site_id: string;
}
export interface CountPolicyClosureReply extends CountPolicyClosureRequest {
  readonly action: "operation_closure"; readonly state: "pending" | "saved" | "abandoned";
  readonly receipt: CountPolicyPublishReceipt | null; readonly receipt_digest: string;
}
function invalid(): never { throw new Error("The count configuration could not be verified."); }
function freeze<T>(value: T): T {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function dataSnapshot(input: unknown): unknown {
  let nodes = 0;
  function visit(value: unknown, depth: number): unknown {
    if (++nodes > 512 || depth > 6) invalid();
    if (value === null || typeof value === "boolean" || typeof value === "number") return value;
    if (typeof value === "string") { if (encoder.encode(value).length > 8192) invalid(); return value; }
    if (!value || typeof value !== "object" || (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value)))) invalid();
    const keys = Reflect.ownKeys(value);
    if (keys.length > 40) invalid();
    const result: Record<string, unknown> = Object.create(null);
    if (Array.isArray(value)) {
      const length = Object.getOwnPropertyDescriptor(value, "length")?.value;
      if (!Number.isInteger(length) || length > 4 || keys.length !== length + 1) invalid();
      for (let index = 0; index < length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor?.enumerable || !("value" in descriptor)) invalid();
        result[index] = visit(descriptor.value, depth + 1);
      }
      return Array.from({ length }, (_, index) => result[index]);
    }
    for (const key of keys) {
      if (typeof key !== "string" || key.length > 128) invalid();
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !("value" in descriptor)) invalid();
      result[key] = visit(descriptor.value, depth + 1);
    }
    return result;
  }
  return visit(input, 0);
}
function parse<T>(schema: z.ZodType<T>, input: unknown, limit: number): T {
  const result = schema.safeParse(dataSnapshot(input));
  if (!result.success || encoder.encode(JSON.stringify(result.data)).length > limit) invalid();
  return freeze(result.data);
}
function rawValue(raw: Uint8Array, limit: number): unknown {
  const intrinsic = Object.getPrototypeOf(Uint8Array.prototype), length = Object.getOwnPropertyDescriptor(intrinsic, "byteLength")!.get!.call(raw) as number;
  if (Object.getOwnPropertyDescriptor(intrinsic, Symbol.toStringTag)!.get!.call(raw) !== "Uint8Array" || length > limit) invalid();
  const bytes = new Uint8Array(length); Uint8Array.prototype.set.call(bytes, raw);
  function ordinary(value: ExactJson): unknown {
    if (value instanceof ExactJsonNumber) return protocolInteger(value, 1, 86400);
    if (Array.isArray(value)) return value.map(ordinary);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, ordinary(child)]));
    return value;
  }
  return ordinary(decodeExactJson(bytes));
}
export function parseCountPolicySettings(input: unknown): CountPolicySettings { return parse(countPolicySettingsSchema, input, 60000) as CountPolicySettings; }
export function parseCountScopeRequest(input: unknown): CountScopeRequest { return parse(scopeRequest, input, 4096) as CountScopeRequest; }
export function parseCountPolicyRequest(input: unknown): CountPolicyRequest { return parse(policyRequest, input, 4096) as CountPolicyRequest; }
export function parseCountPolicyPublishRequest(input: unknown): CountPolicyPublishRequest { return parse(publishRequest, input, 65536) as CountPolicyPublishRequest; }
export function parseCountPolicyPublishReceipt(input: unknown): CountPolicyPublishReceipt { return parse(publishReceipt, input, 4096) as CountPolicyPublishReceipt; }
export function decodeCountPolicyPublishReceipt(raw: Uint8Array): CountPolicyPublishReceipt { return parseCountPolicyPublishReceipt(rawValue(raw, 4096)); }
export function parseCountPolicyClosureRequest(input: unknown): CountPolicyClosureRequest { return parse(policyClosureRequest, input, 4096) as CountPolicyClosureRequest; }
export function parseCountPolicyClosureReply(input: unknown): CountPolicyClosureReply { return parse(policyClosureReply, input, 8192) as CountPolicyClosureReply; }
export function decodeCountPolicyClosureReply(raw: Uint8Array): CountPolicyClosureReply { return parseCountPolicyClosureReply(rawValue(raw, 8192)); }
export function parseCountPolicyReply(raw: Uint8Array, input: unknown): CountPolicyReply {
  const request = parseCountPolicyRequest(input), result = policyReply.safeParse(rawValue(raw, 65536));
  if (!result.success || result.data.data.product_id !== request.product_id || result.data.data.site_id !== request.site_id) invalid();
  return freeze(result.data) as CountPolicyReply;
}
export function parseCountScopeReply(raw: Uint8Array, input: unknown): CountScopeReply {
  const request = parseCountScopeRequest(input), result = scopeReply.safeParse(rawValue(raw, 262144));
  if (!result.success || result.data.items.length > request.page_size) invalid();
  const value = result.data as CountScopeReply;
  const key = (item: CountScopeCursor) => `${item.product_id}:${item.site_id}`;
  let previous = request.cursor ? key(request.cursor) : "";
  for (const item of value.items) {
    if (key(item) <= previous || (!item.capabilities.configure && !item.capabilities.read) ||
      (item.policy_id === null && Object.entries(item.capabilities).some(([name, allowed]) => name !== "configure" && allowed))) invalid();
    previous = key(item);
  }
  if (value.has_more ? !value.items.length || !value.next_cursor || key(value.next_cursor) !== previous : value.next_cursor !== null) invalid();
  return freeze(value) as CountScopeReply;
}
