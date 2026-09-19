import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { downloadReviewedOriginal } from "../imports/attachment-chart-api";
import type { ReleaseApiAttachment } from "../../../../supabase/functions/_shared/record-release-api-attachments";

interface ApiOriginalPreviewDownloadsProps {
  originals: ReleaseApiAttachment[];
  actor: string;
  petId: string;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
}

// Parent mounts this only for active staff and keys it by actor, patient and preview.
// Cleanup invalidates in-flight bytes before any browser download can occur.
export function ApiOriginalPreviewDownloads({
  originals, actor, petId, disabled, onBusyChange,
}: ApiOriginalPreviewDownloadsProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const generation = useRef(0);
  const running = useRef(false);
  const urls = useRef<string[]>([]);

  useEffect(() => {
    const invalidate = () => {
      generation.current++;
      running.current = false;
      for (const url of urls.current) URL.revokeObjectURL(url);
      urls.current = [];
      onBusyChange(false);
    };
    const hide = () => {
      invalidate();
      setBusy(false);
      setNotice("");
    };
    window.addEventListener("pagehide", hide);
    return () => {
      window.removeEventListener("pagehide", hide);
      invalidate();
    };
  }, [onBusyChange]);

  async function download(original: ReleaseApiAttachment) {
    if (disabled || running.current) return;
    const epoch = generation.current;
    const current = () => epoch === generation.current;
    running.current = true;
    setBusy(true);
    onBusyChange(true);
    setError("");
    setNotice("");
    for (const url of urls.current) URL.revokeObjectURL(url);
    urls.current = [];
    try {
      const record = original.record;
      const capture = original.capture;
      const mime = capture.mime_type;
      if (record.pet_id !== petId ||
        (mime !== "application/pdf" && mime !== "image/jpeg" && mime !== "image/png")) {
        throw new Error("Original identity differs");
      }
      if (capture.pet_id !== petId || record.capture_hash !== capture.capture_hash ||
        record.request_id !== capture.request_id) throw new Error("Capture identity differs");
      const { blob } = await downloadReviewedOriginal(actor, petId, record.id, capture.capture_hash);
      const checksum = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())),
        byte => byte.toString(16).padStart(2, "0")).join("");
      if (blob.size !== capture.file_size || blob.type !== mime || checksum !== capture.content_sha256)
        throw new Error("Preview original differs");
      // The server rechecks active staff access and source identity; also reject a changed
      // browser session or an unmounted/replaced preview after the awaited read.
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (!current()) return;
      if (sessionError || data.session?.user.id !== actor) throw new Error("Actor changed");
      const url = URL.createObjectURL(blob);
      urls.current.push(url);
      const link = document.createElement("a");
      link.href = url;
      link.download = `ezyvet-original-${record.attachment_external_id}.${mime === "application/pdf" ? "pdf" : mime === "image/png" ? "png" : "jpg"}`;
      link.rel = "noopener noreferrer";
      link.click();
      setNotice("Original downloaded after checksum verification. Open and review the file before confirming the package.");
    } catch {
      if (current()) setError("Original download failed. The selected file could not be verified. Try again before confirming the package.");
    } finally {
      if (current()) {
        running.current = false;
        setBusy(false);
        onBusyChange(false);
      }
    }
  }

  return (
    <section aria-label="Selected API original downloads" className="space-y-2 rounded-md border p-3">
      <p className="text-sm">
        The preview describes the originals; download and open each selected
        file to review its contents. Downloading does not approve a record
        or confirm this package.
      </p>
      {originals.map((original) => (
        <Button key={original.record.id} type="button" variant="outline"
          className="h-auto whitespace-normal text-left"
          disabled={disabled || busy}
          onClick={() => void download(original)}>
          Download selected API original: {original.record.title || original.record.attachment_external_id} · version {original.record.version}
        </Button>
      ))}
      {busy && <p role="status">Downloading and verifying selected original…</p>}
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
