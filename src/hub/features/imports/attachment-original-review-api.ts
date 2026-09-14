import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { matchesDocumentSignature } from "../documents/file-validation";
import {
  candidatePage,
  historyPage,
  reviewAction,
  reviewIntent,
} from "./attachment-original-review-state";
import type {
  ReviewIntent,
  ReviewCursor,
  OriginalReviewCandidate,
  ApiOriginalRecord,
} from "./attachment-original-review-state";
interface Database {
  public: {
    Tables: Record<never, never>;
    Views: Record<never, never>;
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
    Functions: {
      [key: string]: { Args: Record<string, unknown>; Returns: unknown };
    };
  };
}
const db = supabase as unknown as SupabaseClient<Database>;
async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await db.rpc(name, args);
  if (error)
    throw new Error(
      "Original review unavailable. Recover the original action.",
    );
  return data;
}
const pageArgs = (pet: string, cursor: ReviewCursor | null) => ({
  p_pet_id: pet,
  p_before_at: cursor?.before_at ?? null,
  p_before_id: cursor?.before_id ?? null,
  p_limit: 20,
});
export async function readOriginalHistory(
  pet: string,
  cursor: ReviewCursor | null,
) {
  return historyPage(
    await rpc("read_ezyvet_attachment_original_history", pageArgs(pet, cursor)),
    pet,
  );
}
export async function listOriginalCandidates(
  pet: string,
  cursor: ReviewCursor | null,
) {
  return candidatePage(
    await rpc(
      "list_ezyvet_attachment_original_candidates",
      pageArgs(pet, cursor),
    ),
    pet,
  );
}
export async function recoverOriginalAction(
  p: ReviewIntent,
  pet: string,
  actor: string,
) {
  return reviewAction(
    await rpc("recover_ezyvet_attachment_review_action", {
      p_id: p.args.p_id,
      p_pet_id: pet,
    }),
    pet,
    actor,
    p,
  );
}
export async function submitOriginalAction(
  p: ReviewIntent,
  pet: string,
  actor: string,
  abandon = false,
) {
  const names = abandon
    ? {
        approve: "abandon_ezyvet_attachment_original_approval",
        acknowledge: "abandon_ezyvet_attachment_original_acknowledgment",
        withdraw: "abandon_ezyvet_attachment_original_withdrawal",
      }
    : {
        approve: "approve_ezyvet_attachment_original",
        acknowledge: "acknowledge_ezyvet_attachment_original",
        withdraw: "withdraw_ezyvet_attachment_original",
      };
  return reviewAction(
    await rpc(names[p.kind], reviewIntent(p, pet).args),
    pet,
    actor,
    p,
  );
}
export async function downloadOriginal(
  value: OriginalReviewCandidate | ApiOriginalRecord,
  actor: string,
  admitted: boolean,
): Promise<Blob> {
  const { data, error } = await supabase.auth.getSession();
  if (error || data.session?.user.id !== actor)
    throw new Error("Actor changed");
  const r = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${admitted ? "retrieve-reviewed-ezyvet-attachment" : "capture-ezyvet-attachment"}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${data.session.access_token}`,
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(
        admitted
          ? { record_id: (value as ApiOriginalRecord).id, pet_id: value.pet_id }
          : { action: "retrieve", request_id: value.capture_request_id },
      ),
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(30000),
    },
  );
  if (r.status !== 200 || !r.body) throw new Error("Original unavailable");
  const bytes = new Uint8Array(value.file_size);
  let count = 0;
  const reader = r.body.getReader();
  try {
    while (true) {
      const c = await reader.read();
      if (c.done) break;
      if (count + c.value.byteLength > bytes.length)
        throw new Error("Original size differs");
      bytes.set(c.value, count);
      count += c.value.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const hash = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
  if (
    count !== bytes.length ||
    hash !== value.content_sha256 ||
    !matchesDocumentSignature(bytes, value.mime_type)
  )
    throw new Error("Original verification failed");
  return new Blob([bytes], { type: value.mime_type });
}
