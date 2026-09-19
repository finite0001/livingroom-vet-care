import { supabase } from "@/integrations/supabase/client";
import { readAttachmentBytes } from "../../../../supabase/functions/ezyvet-import/attachment-bytes";
export async function downloadReviewedOriginal(
  actor: string,
  pet: string,
  record: string,
  captureHash: string,
) {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (data.session?.user.id !== actor) throw new Error("Session changed");
  const signal = AbortSignal.timeout(30000);
  const response = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/retrieve-reviewed-ezyvet-original`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${data.session.access_token}`,
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        record_id: record,
        pet_id: pet,
        capture_hash: captureHash,
      }),
      redirect: "error",
      cache: "no-store",
      signal,
    },
  );
  const expected = response.headers.get("X-Content-SHA256");
  if (
    response.headers.get("X-Capture-Hash") !== captureHash ||
    !expected ||
    !/^[a-f0-9]{64}$/.test(expected)
  ) {
    await response.body?.cancel().catch(() => {});
    throw new Error("Reviewed original differs");
  }
  const file = await readAttachmentBytes(
    response,
    response.headers.get("Content-Type"),
    signal,
  );
  if (file.sha256 !== expected)
    throw new Error("Reviewed original checksum differs");
  const after = await supabase.auth.getSession();
  if (after.error) throw after.error;
  if (after.data.session?.user.id !== actor) throw new Error("Session changed");
  return {
    blob: new Blob([file.bytes], { type: file.mimeType }),
    filename: `reviewed-original-${record}.${file.mimeType === "application/pdf" ? "pdf" : file.mimeType === "image/png" ? "png" : "jpg"}`,
  };
}
