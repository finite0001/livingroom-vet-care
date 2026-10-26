import { z } from "zod";
import { decodeExactJson, ExactJsonNumber, protocolInteger, type ExactJson } from "../record-review/exact-json.ts";
import {
  parseCountPublicReceipt, parseCountRequest,
  type CountStatementReceipt, type CountStatementRequest,
} from "./count-request-schema.ts";
import { verifyCountSavedReply } from "./count-wire.ts";

export interface CountReadActor { readonly id: string; readonly name: string }
export interface CountReadProduct { readonly id: string; readonly name: string; readonly stock_unit: string }
export interface CountReadSite { readonly id: string; readonly label: string }
export interface CountReadLocation { readonly id: string; readonly kind: string; readonly label: string }
export interface CountReadLot { readonly id: string; readonly lot_number: string; readonly expires_on: string }
export interface CountReadContainer {
  readonly container_id: string; readonly kind: "stock" | "prepared"; readonly label: string; readonly stock_unit: string;
  readonly location_id: string; readonly custodian_id: string | null; readonly status: "onsite";
}
export interface CountReadUnit {
  readonly cell_id: string; readonly container_id: string; readonly lot_id: string;
  readonly channel: "available" | "prepared" | "return_held"; readonly dispense_id: string | null;
  readonly allocation_id: string | null; readonly intake_id: string | null; readonly stock_unit: string;
  readonly location_id: string; readonly custodian_id: string | null; readonly status: "onsite";
}
export interface CountReadParticipant { readonly slot: "A" | "B"; readonly id: string; readonly name: string; readonly submitted: boolean }
export interface CountReadPolicy { readonly id: string; readonly version: string; readonly meaning_version: string; readonly meaning_text: string }
export interface CountReadStatement {
  readonly slot: "A" | "B"; readonly actor: CountReadActor; readonly recorded_at: string; readonly request: CountStatementRequest;
}
export interface CountReadOwnStatement extends CountReadStatement { readonly receipt: CountStatementReceipt }
export interface CountReadExpected { readonly cell_id: string; readonly quantity: string; readonly stock_unit: string }
export interface CountReadQuantityComparison {
  readonly cell_id: string; readonly stock_unit: string; readonly expected_quantity: string;
  readonly actor_a_quantity: string; readonly actor_b_quantity: string;
  readonly actor_a_matches_expected: boolean; readonly actor_b_matches_expected: boolean; readonly statements_match: boolean;
}
export interface CountReadContainerComparison { readonly container_id: string; readonly actor_a_presence: "present" | "missing"; readonly actor_b_presence: "present" | "missing" }
export interface CountReadFindingCounts { readonly a: number; readonly b: number }
export interface CountReadComparison {
  readonly agreement: boolean; readonly quantity_comparison: readonly CountReadQuantityComparison[];
  readonly container_comparison: readonly CountReadContainerComparison[]; readonly finding_counts: CountReadFindingCounts;
}
export type CountReadHistory = "collecting" | "agreement" | "variance" | "stale" | "cancelled";
export interface CountReadTerminal {
  readonly kind: "outcome" | "cancellation"; readonly id: string; readonly history_state: Exclude<CountReadHistory, "collecting">;
  readonly recorded_at: string; readonly actor: CountReadActor; readonly reason: string | null;
}
export interface CountReadData {
  readonly count_id: string; readonly snapshot_id: string; readonly product: CountReadProduct; readonly site: CountReadSite;
  readonly locations: readonly CountReadLocation[]; readonly lots: readonly CountReadLot[]; readonly units: readonly CountReadUnit[];
  readonly containers: readonly CountReadContainer[]; readonly participants: readonly [CountReadParticipant, CountReadParticipant];
  readonly captured_policy: CountReadPolicy; readonly captured_at: string; readonly history_state: CountReadHistory;
  readonly current_boundary_state: "unchanged" | "changed"; readonly own_statement: CountReadOwnStatement | null;
  readonly statements: readonly [CountReadStatement, CountReadStatement] | null; readonly expected: readonly CountReadExpected[] | null;
  readonly comparison: CountReadComparison | null; readonly terminal: CountReadTerminal | null; readonly read_at: string;
}
export interface CountReadReply { readonly schema_version: 1; readonly state: "available"; readonly data: CountReadData }

const encoder = new TextEncoder();
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const actualByteLength = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteLength")!.get!;
const actualArrayName = Object.getOwnPropertyDescriptor(typedArrayPrototype, Symbol.toStringTag)!.get!;
const setBytes = Uint8Array.prototype.set;
const responseByteLimit = 2 * 1024 * 1024;
const uuid = z.string().regex(/^(?!00000000-0000-0000-0000-000000000000$)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
const quantity = z.string().regex(/^(0|[1-9][0-9]{0,10})\.[0-9]{3}$/);
const display = z.string().max(8192).refine(value => encoder.encode(JSON.stringify(value)).length <= 8192);
const version = z.string().regex(/^[1-9][0-9]{0,18}$/).refine(value => BigInt(value) <= 9223372036854775807n);
function nonblank(value: string): boolean {
  return [...value].some(character => {
    const code = character.codePointAt(0)!;
    return !((code >= 9 && code <= 13) || code === 0x20 || code === 0x85 || code === 0xa0 || code === 0x1680 ||
      (code >= 0x2000 && code <= 0x200b) || code === 0x2028 || code === 0x2029 || code === 0x202f ||
      code === 0x205f || code === 0x3000 || code === 0xfeff);
  });
}
const cancellationReason = z.string().max(1024).refine(value => encoder.encode(value).length <= 1024 && nonblank(value));
function microsecondUtc(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.\d{6}Z$/.exec(value);
  if (!match) return false;
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1] && hour <= 23 && minute <= 59 && second <= 59;
}
const time = z.string().refine(microsecondUtc);
const actor = z.object({ id: uuid, name: display }).strict();
const presence = z.enum(["present", "missing"]);
const statementRequest = z.unknown().transform<CountStatementRequest>((value, ctx) => {
  try { return parseCountRequest("statement", value); }
  catch { ctx.addIssue({ code: "custom", message: "Invalid original count statement" }); return z.NEVER; }
});
const statementReceipt = z.unknown().transform<CountStatementReceipt>((value, ctx) => {
  try { const result = parseCountPublicReceipt(value); if (result.action === "statement") return result; }
  catch { /* Return only the fixed public error below. */ }
  ctx.addIssue({ code: "custom", message: "Invalid original statement receipt" }); return z.NEVER;
});
const statement = z.object({ slot: z.enum(["A", "B"]), actor, recorded_at: time, request: statementRequest }).strict();
const terminalHistory = z.enum(["agreement", "variance", "stale", "cancelled"]);
const replySchema = z.object({
  schema_version: z.literal(1), state: z.literal("available"), data: z.object({
    count_id: uuid, snapshot_id: uuid,
    product: z.object({ id: uuid, name: display, stock_unit: display }).strict(),
    site: z.object({ id: uuid, label: display }).strict(),
    locations: z.array(z.object({ id: uuid, kind: display, label: display }).strict()).max(4096),
    // Expiry is retained display text, including PostgreSQL special date spellings.
    lots: z.array(z.object({ id: uuid, lot_number: display, expires_on: display }).strict()).max(512),
    units: z.array(z.object({ cell_id: uuid, container_id: uuid, lot_id: uuid, channel: z.enum(["available", "prepared", "return_held"]),
      dispense_id: uuid.nullable(), allocation_id: uuid.nullable(), intake_id: uuid.nullable(), stock_unit: display,
      location_id: uuid, custodian_id: uuid.nullable(), status: z.literal("onsite") }).strict()).max(512),
    containers: z.array(z.object({ container_id: uuid, kind: z.enum(["stock", "prepared"]), label: display, stock_unit: display,
      location_id: uuid, custodian_id: uuid.nullable(), status: z.literal("onsite") }).strict()).max(512),
    participants: z.tuple([
      z.object({ slot: z.literal("A"), id: uuid, name: display, submitted: z.boolean() }).strict(),
      z.object({ slot: z.literal("B"), id: uuid, name: display, submitted: z.boolean() }).strict(),
    ]),
    captured_policy: z.object({ id: uuid, version, meaning_version: display, meaning_text: display }).strict(),
    captured_at: time, history_state: z.enum(["collecting", "agreement", "variance", "stale", "cancelled"]),
    current_boundary_state: z.enum(["unchanged", "changed"]),
    own_statement: statement.extend({ receipt: statementReceipt }).strict().nullable(),
    statements: z.tuple([statement, statement]).nullable(),
    expected: z.array(z.object({ cell_id: uuid, quantity, stock_unit: display }).strict()).max(512).nullable(),
    comparison: z.object({ agreement: z.boolean(), quantity_comparison: z.array(z.object({ cell_id: uuid, stock_unit: display,
      expected_quantity: quantity, actor_a_quantity: quantity, actor_b_quantity: quantity,
      actor_a_matches_expected: z.boolean(), actor_b_matches_expected: z.boolean(), statements_match: z.boolean() }).strict()).max(512),
      container_comparison: z.array(z.object({ container_id: uuid, actor_a_presence: presence, actor_b_presence: presence }).strict()).max(512),
      finding_counts: z.object({ a: z.number().int().min(0).max(32), b: z.number().int().min(0).max(32) }).strict() }).strict().nullable(),
    terminal: z.object({ kind: z.enum(["outcome", "cancellation"]), id: uuid, history_state: terminalHistory,
      recorded_at: time, actor, reason: cancellationReason.nullable() }).strict().nullable(), read_at: time,
  }).strict(),
}).strict();

function invalid(): never { throw new Error("Count read response does not match the retained request"); }
function snapshotBytes(raw: Uint8Array): Uint8Array {
  if (actualArrayName.call(raw) !== "Uint8Array") invalid();
  const size = actualByteLength.call(raw) as number;
  if (!Number.isSafeInteger(size) || size < 1 || size > responseByteLimit) invalid();
  const copy = new Uint8Array(size);
  // Native typed-array copying uses actual internal length/offset, not own
  // byteLength/length/buffer properties, iterators or a subclass's species.
  setBytes.call(copy, raw);
  return copy;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || value instanceof ExactJsonNumber) invalid();
  return value as Record<string, unknown>;
}
function boundedArray(value: unknown, maximum: number): readonly unknown[] {
  if (!Array.isArray(value) || value.length > maximum) invalid();
  return value;
}
/** Check every potentially large array before Zod traverses its members. */
function preflight(value: ExactJson) {
  const d = object(object(value).data);
  for (const [key, maximum] of [["locations", 4096], ["lots", 512], ["units", 512], ["containers", 512], ["participants", 2]] as const)
    boundedArray(d[key], maximum);
  if (d.expected !== null) boundedArray(d.expected, 512);
  if (d.statements !== null) boundedArray(d.statements, 2);
  if (d.comparison !== null) {
    const comparison = object(d.comparison);
    boundedArray(comparison.quantity_comparison, 512); boundedArray(comparison.container_comparison, 512);
  }
}
function protocolNumbers(value: ExactJson): unknown {
  if (value instanceof ExactJsonNumber) return protocolInteger(value, 0, 32);
  if (Array.isArray(value)) return value.map(protocolNumbers);
  if (value && typeof value === "object") {
    const answer: Record<string, unknown> = Object.create(null);
    for (const [key, child] of Object.entries(value)) answer[key] = protocolNumbers(child);
    return answer;
  }
  return value;
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function ordered<T>(rows: readonly T[], identifier: (row: T) => string) {
  let previous: string | undefined;
  for (const row of rows) { const id = identifier(row); if (previous !== undefined && id <= previous) invalid(); previous = id; }
}
function sameStatement(a: CountReadStatement, b: CountReadStatement): boolean {
  // Both original requests have already passed the fixed canonical request parser.
  return a.slot === b.slot && a.actor.id === b.actor.id && a.actor.name === b.actor.name && a.recorded_at === b.recorded_at &&
    JSON.stringify(a.request) === JSON.stringify(b.request);
}
function checkRelations(reply: CountReadReply, viewer: string, count: string) {
  const d = reply.data, [a, b] = d.participants, both = a.submitted && b.submitted;
  if (d.count_id !== count || a.id === b.id || d.captured_at > d.read_at) invalid();
  ordered(d.locations, x => x.id); ordered(d.lots, x => x.id); ordered(d.units, x => x.cell_id); ordered(d.containers, x => x.container_id);
  const locations = new Set(d.locations.map(x => x.id)), containers = new Map(d.containers.map(x => [x.container_id, x]));
  const lotIds = new Set(d.units.map(x => x.lot_id));
  if (d.lots.length !== lotIds.size || d.lots.some(x => !lotIds.has(x.id))) invalid();
  for (const c of d.containers) if (!locations.has(c.location_id) || c.stock_unit !== d.product.stock_unit) invalid();
  for (const u of d.units) {
    const c = containers.get(u.container_id);
    if (!c || u.stock_unit !== c.stock_unit || u.location_id !== c.location_id || u.custodian_id !== c.custodian_id) invalid();
    if (u.channel === "available") {
      if (c.kind !== "stock" || u.dispense_id !== null || u.allocation_id !== null || u.intake_id !== null) invalid();
    } else if (c.kind !== "prepared" || u.dispense_id === null || u.allocation_id === null ||
      (u.channel === "prepared" ? u.intake_id !== null : u.intake_id === null)) invalid();
  }
  function checkStatement(s: CountReadStatement, p: CountReadParticipant) {
    const r = s.request;
    if (!p.submitted || s.slot !== p.slot || s.actor.id !== p.id || r.actor_id !== s.actor.id || r.count_id !== count || r.snapshot_id !== d.snapshot_id ||
      r.observed_at < d.captured_at || r.observed_at > s.recorded_at || s.recorded_at > d.read_at || r.quantities.length !== d.units.length ||
      r.container_checks.length !== d.containers.length) invalid();
    if (r.quantities.some((x, i) => x.cell_id !== d.units[i].cell_id) || r.container_checks.some((x, i) => x.container_id !== d.containers[i].container_id) ||
      r.findings.some(x => !locations.has(x.location_id))) invalid();
  }
  const ownParticipant = d.participants.find(p => p.id === viewer && p.submitted);
  if (!!d.own_statement !== !!ownParticipant) invalid();
  if (d.own_statement) checkStatement(d.own_statement, ownParticipant!);
  if (!both) {
    if (d.statements !== null || d.expected !== null || d.comparison !== null || (d.terminal !== null && d.terminal.reason !== null)) invalid();
  } else {
    if (!d.statements || !d.expected || !d.comparison) invalid();
    const [sa, sb] = d.statements, comparison = d.comparison;
    checkStatement(sa, a); checkStatement(sb, b);
    if (sa.request.operation_id === sb.request.operation_id || sa.request.statement_id === sb.request.statement_id) invalid();
    if (d.own_statement && !sameStatement(d.own_statement, viewer === a.id ? sa : sb)) invalid();
    if (d.expected.length !== d.units.length || comparison.quantity_comparison.length !== d.units.length ||
      comparison.container_comparison.length !== d.containers.length || comparison.finding_counts.a !== sa.request.findings.length ||
      comparison.finding_counts.b !== sb.request.findings.length) invalid();
    let agrees = sa.request.findings.length === 0 && sb.request.findings.length === 0;
    d.units.forEach((u, i) => {
      const e = d.expected![i], c = comparison.quantity_comparison[i], qa = sa.request.quantities[i].quantity, qb = sb.request.quantities[i].quantity;
      if (e.cell_id !== u.cell_id || e.stock_unit !== u.stock_unit || c.cell_id !== u.cell_id || c.stock_unit !== u.stock_unit || c.expected_quantity !== e.quantity ||
        c.actor_a_quantity !== qa || c.actor_b_quantity !== qb || c.actor_a_matches_expected !== (qa === e.quantity) ||
        c.actor_b_matches_expected !== (qb === e.quantity) || c.statements_match !== (qa === qb)) invalid();
      agrees &&= qa === e.quantity && qb === e.quantity;
    });
    d.containers.forEach((c, i) => {
      const result = comparison.container_comparison[i], pa = sa.request.container_checks[i].presence, pb = sb.request.container_checks[i].presence;
      if (result.container_id !== c.container_id || result.actor_a_presence !== pa || result.actor_b_presence !== pb) invalid();
      agrees &&= pa === "present" && pb === "present";
    });
    if (comparison.agreement !== agrees) invalid();
  }
  if (d.history_state === "collecting") { if (d.terminal !== null) invalid(); }
  else {
    const t = d.terminal;
    if (!t || t.history_state !== d.history_state || t.recorded_at < d.captured_at || t.recorded_at > d.read_at ||
      (d.own_statement && d.own_statement.recorded_at > t.recorded_at) || d.statements?.some(s => s.recorded_at > t.recorded_at)) invalid();
    if (d.history_state === "cancelled") { if (t.kind !== "cancellation" || (both && t.reason === null)) invalid(); }
    else if (t.kind !== "outcome" || t.reason !== null || (d.history_state !== "stale" && (!both || d.comparison!.agreement !== (d.history_state === "agreement")))) invalid();
  }
}

/** Raw, bounded, closed display data only. No network, principal minting or write authority. */
export function parseCountReadReply(raw: Uint8Array, input: unknown): CountReadReply {
  try {
    const request = parseCountRequest("read", input), exact = decodeExactJson(snapshotBytes(raw));
    preflight(exact);
    const parsed = replySchema.safeParse(protocolNumbers(exact));
    if (!parsed.success) invalid();
    // Zod3 under the repository's non-strict TS mode infers optional object fields.
    // Runtime strict schemas above require every field before this typed boundary.
    const reply = parsed.data as unknown as CountReadReply;
    checkRelations(reply, request.actor_id, request.count_id);
    return freeze(reply);
  } catch { return invalid(); }
}

/** Snapshot/freeze happens before await; verifies only the viewer's original thin receipt. */
export async function verifyCountReadReply(raw: Uint8Array, input: unknown): Promise<CountReadReply> {
  const reply = parseCountReadReply(raw, input), own = reply.data.own_statement;
  if (own) await verifyCountSavedReply("statement", own.request, { schema_version: 1, state: "saved", data: { receipt: own.receipt } });
  return reply;
}
