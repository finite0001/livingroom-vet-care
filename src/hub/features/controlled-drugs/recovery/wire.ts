import { ExactJsonNumber, protocolInteger, validUnicode, type ExactJson } from "../record-review/exact-json.ts";
import { decodeRegisterJson } from "../register/exact-json.ts";
import { registerSha } from "../register/wire.ts";
import { digestCountReceipt, verifyCountSavedReply } from "../count/count-wire.ts";
import { recoveryEvidenceDownload, recoveryPointer, recoveryPointerReply, recoveryPreflight, recoveryReceipt, recoveryRequest, recoveryStatus,
  type RecoveryPointer, type RecoveryReceipt, type RecoveryRequest } from "./schema.ts";

function invalid(): never { throw new Error("Recovery evidence could not be verified. Check the original operation before continuing."); }
function protocol(value: ExactJson): unknown {
  if (value instanceof ExactJsonNumber) return protocolInteger(value, 0, 2097152);
  if (Array.isArray(value)) return value.map(protocol);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, protocol(item)]));
  return value;
}
/** Finite codec used only after closed recovery schemas. Clinical amounts are strings. */
export function recoveryJsonbText(value: unknown, depth = 0): string {
  if (depth > 64) return invalid();
  if (value === null) return "null";
  if (value === true || value === false) return String(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0 || value > 2097152 || Object.is(value, -0)) return invalid();
    return String(value);
  }
  if (typeof value === "string") {
    if (!validUnicode(value) || value.includes("\0")) return invalid();
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(item => recoveryJsonbText(item, depth + 1)).join(", ")}]`;
  if (!value || typeof value !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return invalid();
  const keys = Object.keys(value).sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0));
  if (keys.some(key => !/^[a-z_][a-z0-9_]*$/.test(key))) return invalid();
  return `{${keys.map(key => `${JSON.stringify(key)}: ${recoveryJsonbText((value as Record<string, unknown>)[key], depth + 1)}`).join(", ")}}`;
}
async function hash(domain: string, value: unknown) { return registerSha(new TextEncoder().encode(recoveryJsonbText({ domain, value }))); }
const same = (a: unknown, b: unknown) => recoveryJsonbText(a) === recoveryJsonbText(b);
function uniqueScopes(scopes: readonly { product_id?: string; site_id?: string }[]) {
  if (scopes.some(item => typeof item.product_id !== "string" || typeof item.site_id !== "string")) invalid();
  if (new Set(scopes.map(item => `${item.product_id}:${item.site_id}`)).size !== scopes.length) invalid();
}
function unhash<T extends { record_hash?: string }>(value: T) { const { record_hash: excluded, ...body } = value; if (!excluded) invalid(); return body; }
export async function verifyRecoveryReceipt(input: unknown, pointerInput: RecoveryPointer, originalInput?: RecoveryRequest): Promise<RecoveryReceipt> {
  const result = recoveryReceipt.parse(input), pointer = recoveryPointer.parse(pointerInput);
  if (result.actor_id !== pointer.actor_id || result.operation_id !== pointer.operation_id || result.action !== pointer.action) invalid();
  const { receipt_hash: receiptHash, ...body } = result;
  if (await hash("narcotics-recovery-receipt-v1", body) !== receiptHash) invalid();
  const original = originalInput === undefined ? undefined : recoveryRequest.parse(originalInput);
  if (original && (original.actor_id !== pointer.actor_id || original.operation_id !== pointer.operation_id || original.action !== pointer.action ||
    await hash("narcotics-recovery-request-v1", original) !== result.request_hash)) invalid();
  switch (result.action) {
    case "arm":
      if (result.data.head_id !== result.operation_id || result.data.arm_id !== result.operation_id || original?.action === "arm" && result.data.capture_hash !== original.data.capture_hash) invalid();
      break;
    case "backup_prepare":
      if (result.data.marker.marker_id !== result.operation_id || result.data.marker.arm_id !== result.data.marker.head_id ||
        await hash("narcotics-backup-preparation-v1", result.data.marker) !== result.data.marker_hash ||
        original && (result.data.marker.head_id !== original.expected_head_id || result.data.marker.head_hash !== original.expected_head_hash)) invalid();
      break;
    case "source_resume": case "begin_epoch": case "release":
      if (result.data.head_id !== result.operation_id) invalid();
      if (result.action === "begin_epoch" && (result.data.epoch_id !== result.operation_id || result.data.started_at <= result.data.native_receiver.boot)) invalid();
      if (result.action === "release") {
        uniqueScopes(result.data.agreements);
        if (new Set(result.data.reviewed_evidence.map(item => item.evidence_id)).size !== result.data.reviewed_evidence.length) invalid();
        if (original?.action === "release" && (!same([...original.data.agreements].sort((a, b) => `${a.product_id}:${a.site_id}`.localeCompare(`${b.product_id}:${b.site_id}`)), result.data.agreements.map(({ product_id, site_id, count_id, outcome_id }) => ({ product_id, site_id, count_id, outcome_id })).sort((a, b) => `${a.product_id}:${a.site_id}`.localeCompare(`${b.product_id}:${b.site_id}`))) ||
          !same([...original.data.acknowledgments].sort((a, b) => a.evidence_id.localeCompare(b.evidence_id)), result.data.reviewed_evidence.map(({ evidence_id, acknowledgment_id }) => ({ evidence_id, acknowledgment_id }))) ||
          original.data.history_review_note !== result.data.history_review_note)) invalid();
      }
      break;
    case "start_count": {
      const parent = result.data.count_receipt;
      if (parent.action !== "start" || parent.operation_id !== result.operation_id || parent.actor_id !== result.actor_id || parent.count_id !== result.data.count_id ||
        parent.result_ref.id !== result.data.count_id || parent.receipt_digest !== await digestCountReceipt(parent)) invalid();
      if (original?.action === "start_count") await verifyCountSavedReply("start", original.data.request, { schema_version: 1, state: "saved", data: { receipt: parent } });
      break;
    }
    case "preserve_evidence":
      if (result.data.evidence_id !== result.operation_id) invalid();
      if (original?.action === "preserve_evidence" && await registerSha(originalFile(original.data.base64)) !== result.data.bytes_hash) invalid();
      break;
    case "acknowledge_evidence":
      if (result.data.acknowledgment_id !== result.operation_id || original?.action === "acknowledge_evidence" &&
        (result.data.evidence_id !== original.data.evidence_id || result.data.evidence_hash !== original.data.evidence_hash)) invalid();
  }
  return result;
}
export function decodeRecovery(raw: Uint8Array): unknown { return protocol(decodeRegisterJson(raw)); }
export async function verifyRecoveryPointer(raw: Uint8Array, pointerInput: RecoveryPointer) {
  const pointer = recoveryPointer.parse(pointerInput), reply = recoveryPointerReply.parse(decodeRecovery(raw));
  if (!same(pointer, { schema_version: reply.schema_version, actor_id: reply.actor_id, operation_id: reply.operation_id, action: reply.action })) invalid();
  if (reply.state === "saved") {
    if (reply.receipt === null) invalid();
    await verifyRecoveryReceipt(reply.receipt, pointer);
  } else if (reply.receipt !== null) invalid();
  return reply;
}
export function verifyRecoveryPreflight(raw: Uint8Array) {
  const value = recoveryPreflight.parse(decodeRecovery(raw)); uniqueScopes(value.inventory.scopes);
  if (new Set(value.inventory.products).size !== value.inventory.products.length || value.inventory.scopes.some(item => !value.inventory.products.includes(item.product_id))) invalid();
  return value;
}
export async function verifyRecoveryStatus(raw: Uint8Array, actorId: string, sessionId: string) {
  const value = recoveryStatus.parse(decodeRecovery(raw));
  if (value.actor_id !== actorId || value.session_id !== sessionId || (value.mode === "idle") !== (value.arm_id === null) ||
    value.epoch_id !== null && (value.mode !== "armed" || value.epoch_started_at === null || value.latest_epoch_started_at !== value.epoch_started_at) ||
    value.epoch_id === null && value.epoch_started_at !== null || value.needs_new_epoch && (value.mode !== "armed" || value.epoch_id === null || value.fresh_session)) invalid();
  uniqueScopes(value.scopes);
  if (value.mode === "idle" && (value.epoch_id !== null || value.evidence.length > 0 || value.scopes.length > 0) || new Set(value.evidence.map(item => item.evidence.evidence_id)).size !== value.evidence.length) invalid();
  for (const item of value.evidence) {
    const evidence = item.evidence, acknowledgment = item.acknowledgment;
    if (evidence.arm_id !== value.arm_id || evidence.reported_occurred_at > evidence.recorded_at ||
      !value.scopes.some(scope => scope.product_id === evidence.product_id && scope.site_id === evidence.site_id) ||
      await hash("narcotics-recovery-evidence-v1", unhash(evidence)) !== evidence.record_hash) invalid();
    if (acknowledgment && (acknowledgment.evidence_id !== evidence.evidence_id || acknowledgment.evidence_hash !== evidence.record_hash ||
      acknowledgment.epoch_id !== value.epoch_id || acknowledgment.actor_id === evidence.actor_id || acknowledgment.recorded_at < evidence.recorded_at ||
      value.epoch_started_at === null || acknowledgment.recorded_at <= value.epoch_started_at ||
      await hash("narcotics-recovery-acknowledgment-v1", unhash(acknowledgment)) !== acknowledgment.record_hash)) invalid();
  }
  return value;
}
function originalFile(value: string): Uint8Array {
  const binary = atob(value);
  if (binary.length < 1 || binary.length > 2097152 || btoa(binary) !== value) invalid();
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}
export async function verifyRecoveryDownload(raw: Uint8Array, evidenceId: string) {
  const value = recoveryEvidenceDownload.parse(decodeRecovery(raw)), evidence = value.evidence, bytes = originalFile(value.base64);
  if (evidence.evidence_id !== evidenceId || evidence.byte_length !== bytes.length || await registerSha(bytes) !== evidence.bytes_hash ||
    await hash("narcotics-recovery-evidence-v1", unhash(evidence)) !== evidence.record_hash) invalid();
  return { evidence, bytes };
}
