import { supabase } from "@/integrations/supabase/client";
import { captureRpc } from "./attachment-capture-api";
import { parseReviewHistory } from "./attachment-review-history";
import {
  parseAttachmentDecision,
  parseAttachmentDecisionOutcome,
} from "./attachment-decision-state";
import type { AttachmentDecision } from "./attachment-decision-state";
import type { OriginalCapture } from "./attachment-capture-state";
import type { ReviewCursor } from "./attachment-review-history";
async function session(actor: string) {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (data.session?.user.id !== actor) throw new Error("Session changed");
}
export async function listDecisionHistory(
  capture: OriginalCapture,
  actor: string,
  cursor: ReviewCursor | null,
) {
  await session(actor);
  const result = await captureRpc("list_ezyvet_attachment_record_versions", {
    p_request_id: capture.id,
    p_pet_id: capture.pet_id,
    p_before_at: cursor?.before_at ?? null,
    p_before_id: cursor?.before_id ?? null,
    p_limit: 20,
  });
  await session(actor);
  return parseReviewHistory(result, capture, cursor);
}
export async function actOnAttachmentDecision(
  mode: "submit" | "recover" | "cancel",
  value: AttachmentDecision,
  capture: OriginalCapture,
) {
  const op = parseAttachmentDecision(value, capture, value.actor);
  await session(op.actor);
  const scope = {
    p_id: op.id,
    p_request_id: op.request,
    p_pet_id: op.pet,
    p_capture_hash: op.captureHash,
  };
  const result = await captureRpc(
    mode === "submit"
      ? "approve_ezyvet_attachment_record"
      : mode === "cancel"
        ? "cancel_ezyvet_attachment_approval"
        : "recover_ezyvet_attachment_approval",
    mode === "submit"
      ? {
          ...scope,
          p_previous_record_id: op.previous,
          p_title: op.title,
          p_review_reason: op.reason,
          p_attest: true,
        }
      : mode === "cancel"
        ? { ...scope, p_confirmed: true }
        : scope,
  );
  await session(op.actor);
  return parseAttachmentDecisionOutcome(
    mode === "submit"
      ? { status: "approved", record: result, cancellation: null }
      : result,
    op,
    capture,
  );
}
