import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { matchesDocumentSignature } from "../documents/file-validation";
import {
  captureIntentSchema,
  captureMappingPage,
  capturePage,
  validateCapture,
} from "./attachment-capture-state";
import type {
  CaptureIntent,
  CaptureCursor,
  CaptureScope,
  OriginalCapture,
} from "./attachment-capture-state";
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
const client = supabase as unknown as SupabaseClient<Database>;
async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await client.rpc(name, args);
  if (error)
    throw new Error("Capture data unavailable. Recover the original request.");
  return data;
}
export async function prepareCapture(
  intent: CaptureIntent,
  actor: string,
  mapping: CaptureScope,
) {
  return validateCapture(
    await rpc("prepare_ezyvet_attachment_capture", {
      ...captureIntentSchema.parse(intent),
    }),
    actor,
    mapping,
    intent,
  );
}
export async function recoverCapture(
  id: string,
  actor: string,
  mapping: CaptureScope,
  intent?: CaptureIntent,
) {
  const value = await rpc("recover_ezyvet_attachment_capture", {
    p_id: id,
    p_animal_link_id: mapping.link_id,
  });
  return value === null
    ? null
    : validateCapture(value, actor, mapping, intent ?? id);
}
export async function listCaptures(
  actor: string,
  mapping: CaptureScope,
  cursor: CaptureCursor | null,
) {
  return capturePage(
    await rpc("list_ezyvet_attachment_captures", {
      p_animal_link_id: mapping.link_id,
      p_before_at: cursor?.before_at ?? null,
      p_before_id: cursor?.before_id ?? null,
      p_limit: 20,
    }),
    actor,
    mapping,
  );
}
export async function captureAction(action: "capture" | "discard", id: string) {
  const { error } = await supabase.functions.invoke(
    "capture-ezyvet-attachment",
    { body: { action, request_id: id } },
  );
  if (error)
    throw new Error(
      "Capture response unconfirmed. Recover the original request.",
    );
}
export async function retrieveCapture(c: OriginalCapture): Promise<Blob> {
  if (c.status !== "ready" || !c.capture) throw new Error("Original not ready");
  const { data: auth, error } = await supabase.auth.getSession();
  if (error || auth.session?.user.id !== c.requested_by)
    throw new Error("Original actor required");
  // Functions SDK decodes image responses as text; preserve every byte with a bounded raw response.
  const response = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/capture-ezyvet-attachment`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${auth.session.access_token}`,
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action: "retrieve", request_id: c.id }),
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(30000),
    },
  );
  if (response.status !== 200 || !response.body)
    throw new Error("Original file unavailable");
  const output = new Uint8Array(c.capture.file_size);
  let size = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (size + chunk.value.byteLength > output.byteLength)
        throw new Error("Original file size differs");
      output.set(chunk.value, size);
      size += chunk.value.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  if (size !== output.byteLength) throw new Error("Original file size differs");
  const bytes = output.buffer;
  const digest = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
  if (
    digest !== c.capture.content_sha256 ||
    !matchesDocumentSignature(new Uint8Array(bytes), c.capture.mime_type)
  )
    throw new Error("Original file verification failed");
  return new Blob([bytes], { type: c.capture.mime_type });
}
export async function abandonCapturePreparation(
  intent: CaptureIntent,
  actor: string,
  mapping: CaptureScope,
) {
  return validateCapture(
    await rpc("abandon_ezyvet_attachment_capture_preparation", {
      ...captureIntentSchema.parse(intent),
    }),
    actor,
    mapping,
    intent,
  );
}
export async function listCaptureMappings(cursor: CaptureCursor | null) {
  return captureMappingPage(
    await rpc("list_ezyvet_attachment_capture_mappings", {
      p_before_at: cursor?.before_at ?? null,
      p_before_id: cursor?.before_id ?? null,
      p_limit: 20,
    }),
  );
}
