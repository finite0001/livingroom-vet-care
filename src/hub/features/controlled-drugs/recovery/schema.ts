import { z } from "zod";
import { validUnicode } from "../record-review/exact-json.ts";
import { registerId as id, registerHash as hash } from "../register/schema.ts";
import { parseCountPublicReceipt, parseCountRequest, type CountPublicReceipt } from "../count/count-request-schema.ts";

const text = (limit: number) => z.string().min(1).refine(value => Array.from(value).length <= limit && validUnicode(value) && value.trim().length > 0 && !Array.from(value).some(char => { const code = char.charCodeAt(0); return code < 32 || code >= 127 && code <= 159; }));
const instant = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/).refine(value => Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value);
const serverTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/).refine(value => value.slice(0, 4) !== "0000" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value.slice(0, 23) + "Z");
const empty = z.object({}).strict();
const native = z.object({ boot: serverTime, database_oid: z.string().regex(/^[1-9][0-9]*$/).max(10), database_name: text(63) }).strict();
const scope = z.object({ product_id: id, site_id: id }).strict();
const inventory = z.object({ products: z.array(id).max(256), scopes: z.array(scope).max(256) }).strict();
const head = { head_id: id, head_hash: hash };
const parentReceipt = z.custom<CountPublicReceipt>(value => { try { parseCountPublicReceipt(value); return true; } catch { return false; } }).transform(parseCountPublicReceipt);
const parentStart = z.unknown().transform(value => parseCountRequest("start", value));
export const recoveryAction = z.enum(["arm", "backup_prepare", "source_resume", "begin_epoch", "start_count", "preserve_evidence", "acknowledge_evidence", "release"]);
export type RecoveryAction = z.infer<typeof recoveryAction>;
export const recoveryPointer = z.object({ schema_version: z.literal(1), actor_id: id, operation_id: id, action: recoveryAction }).strict();
export interface RecoveryPointer extends z.infer<typeof recoveryPointer> {}
const request = recoveryPointer.extend({ expected_head_id: id, expected_head_hash: hash });
const agreement = scope.extend({ count_id: id, outcome_id: id }).strict();
const releasedAgreement = agreement.extend({ outcome_hash: hash, count_marker_hash: hash, boundary_hash: hash }).strict();
const acknowledgmentRef = z.object({ evidence_id: id, acknowledgment_id: id }).strict();
const releasedEvidence = acknowledgmentRef.extend({ evidence_hash: hash, acknowledgment_hash: hash }).strict();
const base64 = z.string().min(4).max(2796204).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/);
export const evidenceInput = scope.extend({ reported_occurred_at: instant, claim: text(4000), filename: text(200).refine(value => !/[/\\]/.test(value)),
  mime: z.enum(["application/json", "text/plain", "application/pdf", "image/png", "image/jpeg"]), base64 }).strict();
export const recoveryRequest = z.discriminatedUnion("action", [
  request.extend({ action: z.literal("arm"), data: z.object({ capture_hash: hash }).strict() }).strict(),
  request.extend({ action: z.literal("backup_prepare"), data: empty }).strict(),
  request.extend({ action: z.literal("source_resume"), data: empty }).strict(),
  request.extend({ action: z.literal("begin_epoch"), data: z.object({ marker_id: id, marker_hash: hash, external_capsule_sha256: hash, external_archive_sha256: hash }).strict() }).strict(),
  request.extend({ action: z.literal("start_count"), data: z.object({ request: parentStart }).strict() }).strict(),
  request.extend({ action: z.literal("preserve_evidence"), data: evidenceInput }).strict(),
  request.extend({ action: z.literal("acknowledge_evidence"), data: z.object({ evidence_id: id, evidence_hash: hash, acknowledged: z.literal(true), review_note: text(2000) }).strict() }).strict(),
  request.extend({ action: z.literal("release"), data: z.object({ agreements: z.array(agreement).max(256), acknowledgments: z.array(acknowledgmentRef).max(64), history_review_note: text(4000) }).strict() }).strict(),
]);
export type RecoveryRequest = z.infer<typeof recoveryRequest>;
const saved = recoveryPointer.extend({ state: z.literal("saved"), request_hash: hash, receipt_hash: hash });
const marker = z.object({ schema_version: z.literal(1), domain: z.literal("lrv-narcotics-backup-preparation-v1"), marker_id: id, arm_id: id,
  ...head, source: native, recorded_at: serverTime, capture_hash: hash }).strict();
export const recoveryReceipt = z.discriminatedUnion("action", [
  saved.extend({ action: z.literal("arm"), data: z.object({ ...head, mode: z.literal("armed"), arm_id: id, capture_hash: hash }).strict() }).strict(),
  saved.extend({ action: z.literal("backup_prepare"), data: z.object({ marker, marker_hash: hash }).strict() }).strict(),
  saved.extend({ action: z.literal("source_resume"), data: z.object({ ...head, mode: z.literal("idle") }).strict() }).strict(),
  saved.extend({ action: z.literal("begin_epoch"), data: z.object({ ...head, arm_id: id, epoch_id: id, mode: z.literal("armed"), started_at: serverTime, native_receiver: native }).strict() }).strict(),
  saved.extend({ action: z.literal("start_count"), data: z.object({ count_id: id, epoch_id: id, count_receipt: parentReceipt }).strict() }).strict(),
  saved.extend({ action: z.literal("preserve_evidence"), data: z.object({ evidence_id: id, evidence_hash: hash, bytes_hash: hash, basis: z.literal("staff_reported") }).strict() }).strict(),
  saved.extend({ action: z.literal("acknowledge_evidence"), data: z.object({ acknowledgment_id: id, evidence_id: id, evidence_hash: hash, acknowledgment_hash: hash }).strict() }).strict(),
  saved.extend({ action: z.literal("release"), data: z.object({ ...head, mode: z.literal("idle"), arm_id: id, epoch_id: id, agreements: z.array(releasedAgreement).max(256),
    reviewed_evidence: z.array(releasedEvidence).max(64), history_review_note: text(4000), existing_stock_restrictions_preserved: z.literal(true) }).strict() }).strict(),
]);
export type RecoveryReceipt = z.infer<typeof recoveryReceipt>;
export const recoveryPointerReply = recoveryPointer.extend({ state: z.enum(["pending", "saved", "abandoned"]), receipt: recoveryReceipt.nullable() }).strict();
export interface RecoveryPointerReply extends z.infer<typeof recoveryPointerReply> {}
export const recoveryIdentityRequest = z.object({ schema_version: z.literal(1), actor_id: id }).strict();
export const recoveryPreflight = z.object({ schema_version: z.literal(1), state: z.literal("ready"), ...head, capture_hash: hash, inventory }).strict();
export interface RecoveryPreflight extends z.infer<typeof recoveryPreflight> {}
export const evidenceDocument = z.object({ schema_version: z.literal(1), domain: z.literal("lrv-narcotics-recovery-evidence-v1"), evidence_id: id,
  arm_id: id, epoch_id: id, ...scope.shape, actor_id: id, session_id: id, recorded_at: serverTime, reported_occurred_at: serverTime,
  claim: text(4000), basis: z.literal("staff_reported"), filename: evidenceInput.shape.filename, mime: evidenceInput.shape.mime,
  byte_length: z.number().int().min(1).max(2097152), bytes_hash: hash, record_hash: hash }).strict();
export const acknowledgmentDocument = z.object({ schema_version: z.literal(1), domain: z.literal("lrv-narcotics-recovery-acknowledgment-v1"),
  acknowledgment_id: id, epoch_id: id, evidence_id: id, evidence_hash: hash, actor_id: id, session_id: id, recorded_at: serverTime,
  review_note: text(2000), meaning_version: z.literal("1"),
  meaning: z.literal("I reviewed this exact file and the staff-reported account. This acknowledgment does not certify the file as a recovered original database event."), record_hash: hash }).strict();
export const recoveryStatus = z.object({ schema_version: z.literal(1), actor_id: id, session_id: id, is_admin: z.boolean(), fresh_session: z.boolean(),
  mode: z.enum(["idle", "armed"]), ...head, arm_id: id.nullable(), epoch_id: id.nullable(), epoch_started_at: serverTime.nullable(),
  latest_epoch_started_at: serverTime.nullable(), needs_new_epoch: z.boolean(), native_server: native, scopes: z.array(scope).max(256),
  evidence: z.array(z.object({ evidence: evidenceDocument, acknowledgment: acknowledgmentDocument.nullable() }).strict()).max(64) }).strict();
export interface RecoveryStatus extends z.infer<typeof recoveryStatus> {}
export const recoveryEvidenceDownload = z.object({ schema_version: z.literal(1), evidence: evidenceDocument, base64 }).strict();
